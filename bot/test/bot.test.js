"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Telegram } = require("telegraf");
const { Store } = require("../src/store");
const { createBot } = require("../src/bot");

test("Telegram flows: add, edit, complete, undo, delete, reports, cancel, owner and user isolation", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-bot-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new Store(path.join(directory, "tasks.json"), { now: () => new Date("2026-11-01T12:00:00Z") });
  const bot = createBot({ token: "123456:TEST_ONLY", ownerId: "42", store });
  bot.botInfo = { id: 123456, is_bot: true, username: "test_tracker_bot", first_name: "Тест" };
  const calls = [];
  const original = Telegram.prototype.callApi;
  Telegram.prototype.callApi = async function(method, payload) {
    calls.push({ method, payload });
    return { message_id: 1, chat: { id: payload.chat_id, type: "private" } };
  };
  t.after(() => { Telegram.prototype.callApi = original; });
  let sequence = 0;
  async function update(text, { callback = false, id = 42, chatType = "private" } = {}) {
    calls.length = 0;
    const from = { id, first_name: "<Друг>", is_bot: false };
    const message = { message_id: 1, date: 1, chat: { id, type: chatType }, from, text };
    if (text.startsWith("/")) message.entities = [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }];
    await bot.handleUpdate({ update_id: ++sequence,
      ...(callback ? { callback_query: { id: String(sequence), from, chat_instance: "test", message, data: text } } : { message }) });
    for (const call of calls) {
      if (call.payload.text) assert.ok(call.payload.text.length <= 4096);
      for (const row of call.payload.reply_markup?.inline_keyboard || []) {
        for (const button of row) assert.ok(Buffer.byteLength(button.callback_data) <= 64);
      }
    }
    return calls.findLast(call => ["sendMessage", "editMessageText"].includes(call.method))?.payload;
  }
  const click = (text, options = {}) => update(text, { ...options, callback: true });
  let response = await update("/start");
  assert.match(response.text, /&lt;Друг&gt;/);
  assert.deepEqual(response.reply_markup.inline_keyboard.flat().map(b => b.text), ["📝 Дела", "📊 Прогресс", "🗓 Прогресс за неделю"]);
  response = await click("tasks");
  assert.equal(response.reply_markup.inline_keyboard.length, 11);
  for (let slot = 0; slot < 10; slot++) {
    await click(`task:${slot}`);
    await update(slot === 0 ? "<b>Прочитать</b>" : `Дело ${slot + 1}`);
    response = await click(`done:${slot}`);
    assert.match(response.text, /выполнено/);
  }
  response = await click("task:0");assert.match(response.text, /&lt;b&gt;Прочитать&lt;\/b&gt;/);
  response = await click("progress");assert.match(response.text, /100%/);
  response = await click("week");assert.match(response.text, /10 из 70/);assert.match(response.text, /14%/);
  await click("done:0");response = await update("/progress");assert.match(response.text, /90%/);
  await click("edit:0");await update("a".repeat(101));assert.equal(store.task(42, 0).text, "<b>Прочитать</b>");
  await update("Изменённое дело");assert.equal(store.task(42, 0).text, "Изменённое дело");
  response = await click("task:0", { id: 99 });assert.match(response.text, /Напиши название/);
  await update("Моё отдельное дело", { id: 99 });assert.equal(store.task(42, 0).text, "Изменённое дело");
  await click("delete:1");assert.notEqual(store.task(42, 1), null);
  await click("remove:1");assert.equal(store.task(42, 1), null);
  response = await click("progress");assert.match(response.text, /80%/);
  await click("task:1");await update("/cancel");await update("Не задача");assert.equal(store.task(42, 1), null);
  response = await update("/stats", { id: 99 });assert.match(response.text, /только владельцу/);
  response = await update("/stats");assert.match(response.text, /Пользователей/);
  response = await click("old:callback");assert.match(response.text, /устарела/);
  response = await update("/start", { chatType: "group" });assert.equal(response, undefined);
});
