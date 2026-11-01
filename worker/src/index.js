import { handleUpdate } from "./handler.js";

async function telegram(env, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(10000),
  });
  const body = await response.json();
  if (!body.ok) {
    const error = new Error("Telegram request failed");
    error.description = body.description || "";
    throw error;
  }
  return body.result;
}

const ready = env => !!env.BOT_TOKEN && /^\d+$/.test(env.OWNER_ID || "") && !!env.WEBHOOK_SECRET;

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === "/" && request.method === "GET") {
      return Response.json({ ok: true, service: "ten-tasks-bot", configured: ready(env) });
    }
    if (path === "/setup" && request.method === "POST") {
      if (!env.WEBHOOK_SECRET || request.headers.get("X-Setup-Secret") !== env.WEBHOOK_SECRET) return new Response("Forbidden", { status: 403 });
      if (!ready(env)) return Response.json({ ok: false, error: "Add BOT_TOKEN and OWNER_ID in Cloudflare secrets" }, { status: 503 });
      try {
        const me = await telegram(env, "getMe", {});
        const url = new URL("/telegram", request.url).href;
        const current = await telegram(env, "getWebhookInfo", {});
        if (current.url && current.url !== url) {
          return Response.json({ ok: false, error: "This bot already has another webhook. Verify BOT_TOKEN before switching it." }, { status: 409 });
        }
        await telegram(env, "setWebhook", { url, secret_token: env.WEBHOOK_SECRET,
          allowed_updates: ["message", "callback_query"], max_connections: 1, drop_pending_updates: false });
        const webhook = await telegram(env, "getWebhookInfo", {});
        return Response.json({ ok: true, username: me.username, url: webhook.url, pending: webhook.pending_update_count });
      } catch (_) { return Response.json({ ok: false, error: "Telegram setup failed; verify BOT_TOKEN and API access" }, { status: 502 }); }
    }
    if (path !== "/telegram") return new Response("Not found", { status: 404 });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (!env.WEBHOOK_SECRET || request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) return new Response("Forbidden", { status: 403 });
    if (!ready(env)) return new Response("Not configured", { status: 503 });
    const raw = await request.text();
    if (raw.length > 1048576) return new Response("Too large", { status: 413 });
    let update;
    try { update = JSON.parse(raw); } catch (_) { return new Response("Invalid JSON", { status: 400 }); }
    if (!update || !Number.isSafeInteger(update.update_id) || update.update_id < 0) return new Response("Invalid update", { status: 400 });
    const object = env.TRACKER.get(env.TRACKER.idFromName("tracker-production"));
    try {
      return await object.fetch("https://storage.internal/update", { method: "POST", body: JSON.stringify(update) });
    } catch (_) { return new Response("Retry later", { status: 503 }); }
  },
};

export class TrackerStorage {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sql = state.storage.sql;
    this.queue = Promise.resolve();
    this.sql.exec("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, data TEXT NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS updates (update_id INTEGER PRIMARY KEY, jobs TEXT NOT NULL, created INTEGER NOT NULL)");
  }

  fetch(request) {
    const operation = this.queue.then(() => this.process(request));
    this.queue = operation.catch(() => {});
    return operation;
  }

  async process(request) {
    const update = await request.json();
    const existing = this.sql.exec("SELECT jobs FROM updates WHERE update_id = ?", update.update_id).toArray()[0];
    let jobs;
    if (existing) jobs = JSON.parse(existing.jobs);
    else {
      const from = update.callback_query?.from || update.message?.from;
      const row = from && this.sql.exec("SELECT data FROM users WHERE id = ?", String(from.id)).toArray()[0];
      const result = handleUpdate(update, row ? JSON.parse(row.data) : null, {
        ownerId: this.env.OWNER_ID, timezone: this.env.TIMEZONE || "Europe/Moscow",
      });
      jobs = result?.jobs || [];
      this.state.storage.transactionSync(() => {
        if (result) this.sql.exec("INSERT INTO users(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data", result.id, JSON.stringify(result.data));
        this.sql.exec("INSERT INTO updates(update_id,jobs,created) VALUES(?,?,?)", update.update_id, JSON.stringify(jobs), Date.now());
      });
    }
    while (jobs.length) {
      const { method, payload } = jobs[0];
      try {
        await telegram(this.env, method, payload);
      } catch (error) {
        if (method === "answerCallbackQuery" || error.description?.includes("message is not modified")) {
          // Expired callbacks and already-rendered messages need no retry.
        } else if (method === "editMessageText" && /message to edit not found|message can't be edited/i.test(error.description || "")) {
          const { message_id, ...rest } = payload;
          await telegram(this.env, "sendMessage", rest);
        } else return new Response("Retry later", { status: 503 });
      }
      jobs.shift();
      this.sql.exec("UPDATE updates SET jobs = ? WHERE update_id = ?", JSON.stringify(jobs), update.update_id);
    }
    this.sql.exec("DELETE FROM updates WHERE jobs = '[]' AND created < ?", Date.now() - 7 * 86400000);
    return new Response("OK");
  }
}
