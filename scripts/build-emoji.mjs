// Набор эмодзи для пикера, «:»-автодополнения и реакций: node scripts/build-emoji.mjs
// Источник — emojibase-data (MIT): символы, русские и английские названия и теги, коды из github-набора.
// Картинок нет: эмодзи рисует системный шрифт. Пишет apps/web/src/emoji/emoji-data.json.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const data = (p) => JSON.parse(readFileSync(resolve(root, "node_modules/emojibase-data", p), "utf8"));

const ru = data("ru/data.json");
const en = new Map(data("en/data.json").map((e) => [e.hexcode, e]));
const github = data("en/shortcodes/github.json");
const emojibase = data("en/shortcodes/emojibase.json");

// Дальше 15.0 системные шрифты пока рисуют не везде (старые macOS и Windows 10 покажут квадратик).
const MAX_VERSION = 15;
const NAME_RE = /^[a-z0-9_+-]{1,100}$/;
// Группы emojibase по порядку; «компоненты» (тона кожи, причёски) отдельно не показываем.
const GROUPS = ["Смайлы и эмоции", "Люди и жесты", null, "Природа", "Еда и напитки", "Места и транспорт", "Занятия", "Предметы", "Символы", "Флаги"];

const list = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const seen = new Set();
const emoji = [];
for (const e of [...ru].sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9))) {
  if (e.group === undefined || GROUPS[e.group] === null || (e.version ?? 0) > MAX_VERSION) continue;
  const names = [...list(github[e.hexcode]), ...list(emojibase[e.hexcode])].filter((n) => NAME_RE.test(n));
  const name = names.find((n) => !seen.has(n)) ?? `u${e.hexcode.toLowerCase().replace(/-/g, "_")}`;
  seen.add(name);
  const english = en.get(e.hexcode);
  const keywords = [...new Set([...(e.tags ?? []), english?.label, ...(english?.tags ?? []), ...names.slice(1)].filter(Boolean))];
  // [символ, код для реакций, группа, название по-русски, слова для поиска]
  emoji.push([e.emoji, name, e.group, e.label, keywords.join(" ")]);
}

const out = resolve(root, "apps/web/src/emoji/emoji-data.json");
writeFileSync(out, JSON.stringify({ groups: GROUPS, emoji }));
console.log(`emoji: ${emoji.length} → ${out}`);
