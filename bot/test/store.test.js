"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Store } = require("../src/store");

test("10 cells, daily rollover, persistence, seven calendar days and isolated users", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ten-tasks-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "tasks.json");
  let now = new Date("2026-10-31T20:59:00Z"); // 23:59 in Moscow
  const store = new Store(file, { now: () => now });
  assert.equal(store.user(1).tasks.length, 10);
  for (let i = 0; i < 10; i++) { store.setTask(1, i, "Дело " + i); store.toggle(1, i); }
  assert.equal(store.day(1).count, 10);
  assert.equal(store.day(2).count, 0);
  store.setTask(1, 0, "Новое название");
  assert.equal(store.day(1).count, 10);
  now = new Date("2026-10-31T21:01:00Z");
  assert.equal(store.dayKey(), "2026-11-01");
  assert.equal(store.day(1).count, 0);
  assert.equal(store.task(1, 0).text, "Новое название");
  store.toggle(1, 0);
  store.remove(1, 0);
  assert.equal(store.day(1).count, 0);
  assert.equal(store.week(1).find(day => day.date === "2026-10-31").count, 10);
  assert.deepEqual(store.week(1).map(day => day.date), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
  store.setTask(1, 0, "Новое дело в той же клетке");
  assert.equal(store.completed(1, 0), false);
  const restored = new Store(file, { now: () => now });
  assert.equal(restored.task(1, 0).text, "Новое дело в той же клетке");
  assert.equal(restored.week(1)[5].count, 10);
  assert.equal(restored.task(2, 0), null);
  assert.equal(store.toggle(1, 20), false);
  assert.throws(() => store.setTask(1, 10, "лишнее"));
  assert.throws(() => store.setTask(1, 0, "   "));
  assert.throws(() => store.setTask(1, 0, "a".repeat(101)));
});

test("invalid stored JSON is reported rather than replaced", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ten-tasks-bad-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "tasks.json");
  fs.writeFileSync(file, "broken JSON");
  assert.throws(() => new Store(file));
  assert.equal(fs.readFileSync(file, "utf8"), "broken JSON");
});
