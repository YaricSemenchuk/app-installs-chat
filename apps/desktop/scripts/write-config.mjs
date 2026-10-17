// Адрес чата вшивается в сборку: TEAMCHAT_URL=https://chat.example.com npm run dist:mac
// В разработке без переменной — Vite на localhost:5173 (он же проксирует API).
import { writeFileSync } from "node:fs";

const url = process.env.TEAMCHAT_URL ?? "http://localhost:5173";
const parsed = new URL(url);
if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
  console.error(`TEAMCHAT_URL: нужен https (или localhost для разработки), а не ${url}`);
  process.exit(1);
}
writeFileSync(new URL("../dist/config.json", import.meta.url), JSON.stringify({ url: parsed.origin }));
console.log(`desktop → ${parsed.origin}`);
