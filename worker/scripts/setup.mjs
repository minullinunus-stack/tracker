import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = process.argv[2];
if (!url || !/^https:\/\/[a-z0-9.-]+\.workers\.dev\/?$/.test(url)) {
  console.error("Запуск: npm run setup -- https://<worker>.<account>.workers.dev");
  process.exit(1);
}
try {
  const secret = fs.readFileSync(path.join(root, ".webhook-secret"), "utf8").trim();
  const response = await fetch(new URL("/setup", url), {
    method: "POST", headers: { "X-Setup-Secret": secret, "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) { console.error(result.error || "Не удалось настроить вебхук"); process.exitCode = 1; }
  else console.log(`Вебхук подключён: @${result.username}\n${result.url}\nВ очереди: ${result.pending}`);
} catch (_) { console.error("Не удалось настроить вебхук. Проверьте URL, сеть и наличие локального .webhook-secret."); process.exitCode = 1; }
