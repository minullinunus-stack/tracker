import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import worker, { TrackerStorage } from "../src/index.js";

test("authenticated webhook, persisted input, cold restart, duplicate updates and safe API retry", async t => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const sql = { exec(query, ...args) {
    const statement = db.prepare(query);
    if (/^SELECT/i.test(query)) return { toArray: () => statement.all(...args) };
    statement.run(...args); return { toArray: () => [] };
  } };
  const state = { storage: { sql, transactionSync(fn) {
    db.exec("BEGIN"); try { fn(); db.exec("COMMIT"); } catch (error) { db.exec("ROLLBACK"); throw error; }
  } } };
  const env = { BOT_TOKEN: "123456:TEST_ONLY", OWNER_ID: "42", WEBHOOK_SECRET: "test-secret", TIMEZONE: "Europe/Moscow" };
  let storage = new TrackerStorage(state, env);
  env.TRACKER = { idFromName: name => name, get: () => ({ fetch: (url, init) => storage.fetch(new Request(url, init)) }) };
  const calls = [];
  let failSend = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.ok(String(url).startsWith("https://api.telegram.org/"));
    const method = String(url).split("/").at(-1);
    const payload = JSON.parse(options.body); calls.push({ method, payload });
    if (failSend && method === "editMessageText") return Response.json({ ok: false, description: "Temporary failure" }, { status: 503 });
    return Response.json({ ok: true, result: method === "getMe" ? { username: "test_tracker_bot" }
      : method === "getWebhookInfo" ? { url: "https://test.workers.dev/telegram", pending_update_count: 0 }
      : { message_id: 1 } });
  };
  t.after(() => { globalThis.fetch = realFetch; });
  let sequence = 0;
  function update(text, callback = false, id = 42) {
    const from = { id, is_bot: false, first_name: "<Друг>" };
    const message = { message_id: 1, from, chat: { id, type: "private" }, text };
    return { update_id: ++sequence, ...(callback ? { callback_query: { id: String(sequence), from, message, data: text } } : { message }) };
  }
  function post(data, secret = env.WEBHOOK_SECRET) {
    return worker.fetch(new Request("https://test.workers.dev/telegram", { method: "POST", headers: {
      "X-Telegram-Bot-Api-Secret-Token": secret,
    }, body: JSON.stringify(data) }), env);
  }
  const user = id => JSON.parse(sql.exec("SELECT data FROM users WHERE id = ?", String(id)).toArray()[0].data);
  assert.equal((await post(update("/start"), "wrong")).status, 403);
  assert.equal(sql.exec("SELECT * FROM users").toArray().length, 0);
  assert.equal((await post({})).status, 400);
  assert.equal((await post(update("/start"))).status, 200);
  assert.match(calls.at(-1).payload.text, /&lt;Друг&gt;/);
  await post(update("task:0", true)); assert.equal(user(42).pending, 0);
  storage = new TrackerStorage(state, env); // Simulate eviction between callback and reply.
  await post(update("Прочитать книгу")); assert.equal(user(42).tasks[0].text, "Прочитать книгу");
  assert.equal(user(42).pending, null);
  const completion = update("done:0", true);
  await post(completion); await post(completion);
  assert.equal(Object.values(user(42).days)[0].count, 1);
  const undo = update("done:0", true);
  failSend = true; assert.equal((await post(undo)).status, 503);
  assert.equal(Object.values(user(42).days)[0].count, 0);
  failSend = false; storage = new TrackerStorage(state, env);
  assert.equal((await post(undo)).status, 200);
  assert.equal(Object.values(user(42).days)[0].count, 0); // Retry must not toggle a second time.
  await post(update("task:0", true, 99)); await post(update("Чужое дело", false, 99));
  assert.equal(user(99).tasks[0].text, "Чужое дело"); assert.equal(user(42).tasks[0].text, "Прочитать книгу");
  await post(update("edit:0", true)); await post(update("<b>Изменить</b>"));
  await post(update("task:0", true)); assert.match(calls.at(-1).payload.text, /&lt;b&gt;Изменить&lt;\/b&gt;/);
  await post(update("progress", true)); assert.match(calls.at(-1).payload.text, /0%/);
  await post(update("week", true)); assert.match(calls.at(-1).payload.text, /из 70/);
  await post(update("delete:0", true)); assert.ok(user(42).tasks[0]);
  await post(update("remove:0", true)); assert.equal(user(42).tasks[0], null);
  await post(update("task:1", true)); await post(update("/cancel")); assert.equal(user(42).pending, null);
  for (const call of calls) {
    if (call.payload.text) assert.ok(call.payload.text.length <= 4096);
    for (const row of call.payload.reply_markup?.inline_keyboard || []) {
      for (const button of row) assert.ok(Buffer.byteLength(button.callback_data) <= 64);
    }
  }
  assert.equal((await worker.fetch(new Request("https://test.workers.dev/setup", { method: "POST" }), env)).status, 403);
  const setup = await worker.fetch(new Request("https://test.workers.dev/setup", { method: "POST", headers: { "X-Setup-Secret": env.WEBHOOK_SECRET } }), env);
  assert.equal((await setup.json()).username, "test_tracker_bot");
  assert.equal(calls.findLast(call => call.method === "setWebhook").payload.drop_pending_updates, false);
  assert.equal(calls.findLast(call => call.method === "setWebhook").payload.secret_token, env.WEBHOOK_SECRET);
  const health = await worker.fetch(new Request("https://test.workers.dev/"), {});
  assert.equal((await health.json()).configured, false);
});
