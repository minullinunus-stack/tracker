import model from "../../bot/src/model.js";

const { TrackerModel } = model;
const escape = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const button = (text, callback_data) => ({ text, callback_data });
const keyboard = rows => ({ inline_keyboard: rows });
const menu = () => keyboard([
  [button("📝 Дела", "tasks")],
  [button("📊 Прогресс", "progress"), button("🗓 Прогресс за неделю", "week")],
]);
const bar = count => "■".repeat(count) + "□".repeat(10 - count);

// Pure update reducer: database commits its result before sending API requests.
// Text entry lives in the user record, never in an ephemeral process variable.
export function handleUpdate(update, previous, { ownerId, timezone = "Europe/Moscow", now } = {}) {
  const callback = update.callback_query;
  const message = callback?.message || update.message;
  const from = callback?.from || message?.from;
  if (!from || from.is_bot || message?.chat?.type !== "private") return null;
  const id = String(from.id);
  const data = previous ? structuredClone(previous) : { tasks: Array(10).fill(null), days: {}, pending: null };
  const store = new TrackerModel({ timezone, now, data: { version: 1, users: { [id]: data } } });
  const jobs = [];
  const send = (text, markup = menu()) => {
    const method = callback ? "editMessageText" : "sendMessage";
    jobs.push({ method, payload: { chat_id: message.chat.id, ...(callback ? { message_id: message.message_id } : {}),
      text, parse_mode: "HTML", reply_markup: markup } });
  };
  function tasks() {
    send("📝 <b>Твои 10 дел</b>\n\nВыбери клетку: добавь дело или открой существующее, чтобы завершить, изменить или удалить его 💪",
      keyboard([...data.tasks.map((task, slot) => [button(task
        ? `${store.completed(id, slot) ? "✅" : "⬜"} ${slot + 1}. ${task.text}`
        : `➕ ${slot + 1}. Добавить дело`, `task:${slot}`)]), [button("🏠 Главное меню", "menu")]]));
  }
  function ask(slot) {
    data.pending = slot;
    send(`✍️ Напиши название дела для клетки <b>${slot + 1}</b> одним сообщением.\n\nДо 100 символов. Для отмены — /cancel.`, keyboard([[button("Отмена", "cancel")]]));
  }
  function detail(slot) {
    const task = store.task(id, slot);
    if (!task) return ask(slot);
    const done = store.completed(id, slot);
    send(`${done ? "✅" : "⬜"} <b>Дело ${slot + 1}</b>\n\n${escape(task.text)}\n\n${done ? "На сегодня выполнено. Отличная работа! 🎉" : "Один маленький шаг — и ты ближе к цели 🌱"}`,
      keyboard([[button(done ? "↩️ Отменить выполнение" : "✅ Завершить", `done:${slot}`)],
        [button("✏️ Изменить", `edit:${slot}`), button("🗑 Удалить", `delete:${slot}`)], [button("📝 Все дела", "tasks")]]));
  }
  function progress() {
    const count = store.day(id).count;
    send(`📊 <b>Твой прогресс сегодня</b>\n\n${bar(count)}\n<b>${count * 10}%</b> · выполнено ${count} из 10\n\n${count === 10 ? "Все дела сделаны — ты молодец! 🎉" : "Каждое выполненное дело — ещё 10%. Двигайся в своём темпе 🤍"}`);
  }
  function week() {
    const days = store.week(id);
    const total = days.reduce((sum, day) => sum + day.count, 0);
    send("🗓 <b>Прогресс за последние 7 дней</b>\n\n" + days.map(day => {
      const [, month, date] = day.date.split("-");
      return `${date}.${month}  ${bar(day.count)}  <b>${day.count * 10}%</b>`;
    }).join("\n") + `\n\nВыполнено: <b>${total} из 70</b>\nСредний прогресс: <b>${Math.round(total / 70 * 100)}%</b>\n\nДаже маленькие шаги складываются в большой путь 🌱\n<i>Дни без отметок показаны как 0%.</i>`);
  }
  const text = String(update.message?.text || "").trim();
  const command = /^\/([a-z]+)(?:@\w+)?(?:\s|$)/i.exec(text)?.[1]?.toLowerCase();
  const action = callback?.data || command;
  if (callback) jobs.push({ method: "answerCallbackQuery", payload: { callback_query_id: callback.id } });
  if (["start", "menu", "tasks", "progress", "week", "cancel"].includes(action)) data.pending = null;
  if (action === "start") {
    send(`Привет, ${escape(from.first_name || "друг")}! 👋\n\nЯ помогу следить за твоими 10 делами. Добавляй задачи, отмечай выполненное и наблюдай за прогрессом 🤍\n\n📝 <b>Дела</b> — твой список.\n📊 <b>Прогресс</b> — за сегодня.\n🗓 <b>Прогресс за неделю</b> — последние 7 дней.\n\nС новым днём отметки начинаются заново, а дела и история остаются 🌱`);
  } else if (action === "menu") send("🏠 <b>Главное меню</b>\n\nЧто сделаем дальше? 🤍");
  else if (action === "tasks" || action === "cancel") tasks();
  else if (action === "progress") progress();
  else if (action === "week") week();
  else if (action === "help") send("🤍 <b>Как пользоваться</b>\n\nОткрой «📝 Дела», выбери пустую клетку и отправь название. В карточке дела есть «✅ Завершить», изменение и удаление.\n\n/tasks — дела\n/progress — сегодня\n/week — последние 7 дней\n/cancel — отменить ввод\n\n<i>Списки бота и сайта хранятся отдельно.</i>");
  else if (action === "stats") {
    send(id === String(ownerId) ? "🔐 Бот работает в Cloudflare Workers. Дела и история сохраняются в постоянной базе 🤍" : "Эта команда доступна только владельцу 🤍");
  } else if (callback) {
    const match = /^(task|done|edit|delete|remove):([0-9])$/.exec(action || "");
    data.pending = null;
    if (!match) send("Эта кнопка устарела. Открой дела заново 🙂");
    else {
      const [, kind, raw] = match;
      const slot = Number(raw);
      if (kind === "task") detail(slot);
      else if (kind === "edit") ask(slot);
      else if (!store.task(id, slot)) tasks();
      else if (kind === "done") { store.toggle(id, slot); detail(slot); }
      else if (kind === "remove") { store.remove(id, slot); tasks(); }
      else send("🗑 Удалить это дело?\n\n" + escape(store.task(id, slot).text) + "\n\nЕго отметка за сегодня исчезнет. История прошлых дней останется.",
        keyboard([[button("Да, удалить", `remove:${slot}`), button("Оставить", `task:${slot}`)]]));
    }
  } else if (text.startsWith("/")) send("Не узнал команду 🙂 Для отмены — /cancel, для помощи — /help.");
  else if (Number.isInteger(data.pending)) {
    if (!text || text.length > 100) send("Напиши название текстом: от 1 до 100 символов ✍️");
    else {
      const slot = data.pending;
      store.setTask(id, slot, text);
      data.pending = null;
      send("Сохранено! 🤍 Открой дело и нажми «✅ Завершить», когда справишься.", keyboard([[button("Открыть дело", `task:${slot}`)], [button("📝 Все дела", "tasks")]]));
    }
  } else send("Выбери «📝 Дела», затем клетку — и я сохраню твою задачу 🙂");
  return { id, data, jobs };
}
