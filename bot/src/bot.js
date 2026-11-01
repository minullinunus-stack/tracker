"use strict";

const { Telegraf, Markup } = require("telegraf");
const escape = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const button = Markup.button.callback;
const bar = count => "■".repeat(count) + "□".repeat(10 - count);
const menu = () => Markup.inlineKeyboard([
  [button("📝 Дела", "tasks")],
  [button("📊 Прогресс", "progress"), button("🗓 Прогресс за неделю", "week")],
]);

function createBot({ token, ownerId, store }) {
  const bot = new Telegraf(token);
  const pending = new Map();
  const send = (ctx, text, keyboard = menu()) => ctx.reply(text, { parse_mode: "HTML", ...keyboard });
  const show = async (ctx, text, keyboard = menu()) => {
    if (!ctx.callbackQuery) return send(ctx, text, keyboard);
    try { return await ctx.editMessageText(text, { parse_mode: "HTML", ...keyboard }); }
    catch (error) {
      if (String(error.description || error.message).includes("message is not modified")) return;
      return send(ctx, text, keyboard);
    }
  };

  // Lists and free-text task entry are private to each user's direct chat.
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== "private" || !ctx.from || ctx.from.is_bot) return;
    if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
    await next();
  });

  function tasksView(ctx) {
    const rows = store.user(ctx.from.id).tasks.map((task, index) => [button(
      task ? `${store.completed(ctx.from.id, index) ? "✅" : "⬜"} ${index + 1}. ${task.text}` : `➕ ${index + 1}. Добавить дело`,
      `task:${index}`
    )]);
    rows.push([button("🏠 Главное меню", "menu")]);
    return show(ctx, "📝 <b>Твои 10 дел</b>\n\nВыбери клетку: добавь своё дело или открой существующее, чтобы завершить, изменить или удалить его 💪", Markup.inlineKeyboard(rows));
  }

  function taskView(ctx, slot) {
    const task = store.task(ctx.from.id, slot);
    if (!task) return askText(ctx, slot);
    const done = store.completed(ctx.from.id, slot);
    return show(ctx, `${done ? "✅" : "⬜"} <b>Дело ${slot + 1}</b>\n\n${escape(task.text)}\n\n${done ? "На сегодня выполнено. Отличная работа! 🎉" : "Один маленький шаг — и ты ближе к цели 🌱"}`,
      Markup.inlineKeyboard([
        [button(done ? "↩️ Отменить выполнение" : "✅ Завершить", `done:${slot}`)],
        [button("✏️ Изменить", `edit:${slot}`), button("🗑 Удалить", `delete:${slot}`)],
        [button("📝 Все дела", "tasks")],
      ]));
  }

  function askText(ctx, slot) {
    pending.set(ctx.from.id, slot);
    return show(ctx, `✍️ Напиши название дела для клетки <b>${slot + 1}</b> одним сообщением.\n\nДо 100 символов. Для отмены — /cancel.`,
      Markup.inlineKeyboard([[button("Отмена", "cancel")]]));
  }

  function progress(ctx) {
    const count = store.day(ctx.from.id).count;
    return show(ctx, `📊 <b>Твой прогресс сегодня</b>\n\n${bar(count)}\n<b>${count * 10}%</b> · выполнено ${count} из 10\n\n${count === 10 ? "Все дела сделаны — ты молодец! 🎉" : "Каждое выполненное дело — ещё 10%. Двигайся в своём темпе 🤍"}`);
  }

  function week(ctx) {
    const days = store.week(ctx.from.id);
    const total = days.reduce((sum, day) => sum + day.count, 0);
    return show(ctx, "🗓 <b>Прогресс за последние 7 дней</b>\n\n" + days.map(day => {
      const [, month, date] = day.date.split("-");
      return `${date}.${month}  ${bar(day.count)}  <b>${day.count * 10}%</b>`;
    }).join("\n") + `\n\nВыполнено: <b>${total} из 70</b>\nСредний прогресс: <b>${Math.round(total / 70 * 100)}%</b>\n\nДаже маленькие шаги складываются в большой путь 🌱\n<i>Дни без отметок показаны как 0%.</i>`);
  }

  bot.start(ctx => {
    pending.delete(ctx.from.id);
    return send(ctx, `Привет, ${escape(ctx.from.first_name || "друг")}! 👋\n\nЯ помогу следить за твоими 10 делами. Добавляй задачи, отмечай выполненное и наблюдай за прогрессом 🤍\n\n📝 <b>Дела</b> — твой список.\n📊 <b>Прогресс</b> — результаты за сегодня.\n🗓 <b>Прогресс за неделю</b> — последние 7 дней.\n\nНовый день начинается с чистых отметок, а названия дел и история остаются. Выбери кнопку 👇`);
  });
  bot.help(ctx => send(ctx, "🤍 <b>Как пользоваться</b>\n\n1. Открой «📝 Дела».\n2. Нажми пустую клетку и отправь название.\n3. Открой дело → «✅ Завершить».\n4. Смотри дневной и недельный прогресс.\n\nИзменить или удалить дело можно в его карточке.\n/cancel — отменить ввод\n/tasks — дела\n/progress — сегодня\n/week — последние 7 дней\n\n<i>Список бота и список на сайте хранятся отдельно.</i>"));
  bot.command("tasks", tasksView);
  bot.command("progress", progress);
  bot.command("week", week);
  bot.command("cancel", ctx => { pending.delete(ctx.from.id); return send(ctx, "Ввод отменён. Продолжим, когда будешь готов 🤍"); });
  bot.command("stats", ctx => String(ctx.from.id) === String(ownerId)
    ? send(ctx, `🔐 Пользователей в базе: ${Object.keys(store.data.users).length}`)
    : send(ctx, "Эта команда доступна только владельцу 🤍"));
  bot.action("menu", ctx => { pending.delete(ctx.from.id); return show(ctx, "🏠 <b>Главное меню</b>\n\nЧто сделаем дальше? 🤍"); });
  bot.action("cancel", ctx => { pending.delete(ctx.from.id); return tasksView(ctx); });
  for (const [name, action] of [["tasks", tasksView], ["progress", progress], ["week", week]]) {
    bot.action(name, ctx => { pending.delete(ctx.from.id); return action(ctx); });
  }
  bot.action(/^(task|done|edit|delete|remove):([0-9])$/, async ctx => {
    const [, action, raw] = ctx.match;
    const slot = Number(raw);
    pending.delete(ctx.from.id);
    if (action === "task") return taskView(ctx, slot);
    if (action === "edit") return askText(ctx, slot);
    if (!store.task(ctx.from.id, slot)) return tasksView(ctx);
    if (action === "done") { store.toggle(ctx.from.id, slot); return taskView(ctx, slot); }
    if (action === "remove") { store.remove(ctx.from.id, slot); return tasksView(ctx); }
    return show(ctx, "🗑 Удалить это дело?\n\n" + escape(store.task(ctx.from.id, slot).text) + "\n\nЕго отметка за сегодня тоже исчезнет. История прошлых дней останется.",
      Markup.inlineKeyboard([[button("Да, удалить", `remove:${slot}`), button("Оставить", `task:${slot}`)]]));
  });
  bot.on("callback_query", ctx => show(ctx, "Эта кнопка устарела. Открой дела заново 🙂"));
  bot.on("text", ctx => {
    const slot = pending.get(ctx.from.id);
    if (slot === undefined) return send(ctx, "Выбери «📝 Дела», затем клетку — и я сохраню твою задачу 🙂");
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return send(ctx, "Не узнал команду 🙂 Для отмены ввода — /cancel, для помощи — /help.");
    if (!text || text.length > 100) return send(ctx, "Название должно содержать от 1 до 100 символов. Попробуй ещё раз ✍️");
    store.setTask(ctx.from.id, slot, text);
    pending.delete(ctx.from.id);
    return send(ctx, "Сохранено! 🤍 Открой дело и нажми «✅ Завершить», когда справишься.",
      Markup.inlineKeyboard([[button("Открыть дело", `task:${slot}`)], [button("📝 Все дела", "tasks")]]));
  });
  bot.on("message", ctx => send(ctx, "Пришли название дела текстом, пожалуйста ✍️"));
  bot.catch(async (error, ctx) => {
    // Do not log request payloads or raw errors that may contain the bot token.
    console.error("Не удалось обработать обновление; проверьте права и доступность хранилища/API.");
    await send(ctx, "Не получилось выполнить действие. Попробуй ещё раз чуть позже 🤍").catch(() => {});
  });
  return bot;
}

module.exports = { createBot };
