"use strict";

class TrackerModel {
  constructor({ timezone = "Europe/Moscow", now = () => new Date(), data } = {}) {
    this.now = now;
    this.format = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    });
    this.data = data || { version: 1, users: {} };
    if (this.data.version !== 1 || !this.data.users || typeof this.data.users !== "object") {
      throw new Error("Неподдерживаемый формат базы");
    }
  }

  dayKey() {
    const parts = Object.fromEntries(this.format.formatToParts(this.now()).map(p => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  user(id) {
    const key = String(id);
    if (!this.data.users[key]) this.data.users[key] = { tasks: Array(10).fill(null), days: {} };
    return this.data.users[key];
  }

  day(id) {
    const user = this.user(id);
    const key = this.dayKey();
    if (!user.days[key]) user.days[key] = { done: [], count: 0 };
    return user.days[key];
  }

  save() {}

  task(id, slot) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= 10) return null;
    return this.user(id).tasks[slot];
  }

  setTask(id, slot, text) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= 10) throw new Error("Неверная клетка");
    text = text.trim();
    if (!text || text.length > 100) throw new Error("Название должно содержать от 1 до 100 символов");
    const user = this.user(id);
    user.tasks[slot] = { id: user.tasks[slot]?.id || globalThis.crypto.randomUUID(), text };
    this.save();
  }

  toggle(id, slot) {
    const task = this.task(id, slot);
    if (!task) return false;
    const day = this.day(id);
    day.done = day.done.includes(task.id) ? day.done.filter(item => item !== task.id) : [...day.done, task.id];
    day.count = day.done.length;
    this.save();
    return true;
  }

  remove(id, slot) {
    const task = this.task(id, slot);
    if (!task) return false;
    const day = this.day(id);
    day.done = day.done.filter(item => item !== task.id);
    day.count = day.done.length;
    this.user(id).tasks[slot] = null;
    this.save();
    return true;
  }

  completed(id, slot) {
    const task = this.task(id, slot);
    return !!task && this.day(id).done.includes(task.id);
  }

  week(id) {
    const today = this.dayKey();
    const [year, month, date] = today.split("-").map(Number);
    const user = this.user(id);
    return Array.from({ length: 7 }, (_, i) => {
      const key = new Date(Date.UTC(year, month - 1, date - 6 + i)).toISOString().slice(0, 10);
      return { date: key, count: user.days[key]?.count || 0 };
    });
  }
}

module.exports = { TrackerModel };
