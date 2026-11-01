"use strict";

const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });
const { Store } = require("./store");
const { createBot } = require("./bot");

const token = process.env.BOT_TOKEN?.trim();
const ownerId = process.env.OWNER_ID?.trim();
if (!token || !/^\d+:[\w-]+$/.test(token) || !ownerId || !/^\d+$/.test(ownerId)) {
  console.error("Заполните BOT_TOKEN и числовой OWNER_ID в bot/.env. Скопируйте шаблон .env.example.");
  process.exit(1);
}

let bot;
try {
  const store = new Store(path.join(__dirname, "..", "storage", "tasks.json"), {
    timezone: process.env.TIMEZONE || "Europe/Moscow",
  });
  bot = createBot({ token, ownerId, store });
} catch (_) {
  console.error("Не удалось открыть базу или определить часовой пояс. Проверьте TIMEZONE и bot/storage/tasks.json; не удаляйте базу без резервной копии.");
  process.exit(1);
}

bot.launch({ dropPendingUpdates: false }, () => console.log("🤍 Трекер запущен. Откройте бота и отправьте /start. Для остановки — Ctrl+C."))
  .catch(() => { console.error("Бот не запустился. Проверьте токен, доступ к Telegram и отсутствие другого запущенного экземпляра."); process.exitCode = 1; });
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
