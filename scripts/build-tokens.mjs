// Генерирует apps/web/src/styles/tokens.css из replica/design/tokens.json и tokens.dark.json.
// Источник правды — JSON (его проверяет contrast.py); CSS руками не редактируем.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const light = JSON.parse(readFileSync(join(root, "replica/design/tokens.json"), "utf8"));
const dark = JSON.parse(readFileSync(join(root, "replica/design/tokens.dark.json"), "utf8"));
const out = join(root, "apps/web/src/styles/tokens.css");

const isMeta = (key) => key.startsWith("_");
const px = (n) => (n === 0 ? "0" : `${n}px`);

function colors(map) {
  return Object.entries(map)
    .filter(([k]) => !isMeta(k))
    .map(([k, v]) => `  --color-${k}: ${v};`)
    .join("\n");
}

function scales(t) {
  const lines = [];
  lines.push(`  --font-sans: ${t.font.sans};`, `  --font-mono: ${t.font.mono};`);
  for (const [name, s] of Object.entries(t.type)) {
    if (isMeta(name)) continue;
    lines.push(
      `  --type-${name}-size: ${px(s.size)};`,
      `  --type-${name}-line: ${px(s.line)};`,
      `  --type-${name}-weight: ${s.weight};`,
    );
  }
  t.space.forEach((v) => lines.push(`  --space-${v}: ${px(v)};`));
  for (const [k, v] of Object.entries(t.radius)) lines.push(`  --radius-${k}: ${px(v)};`);
  for (const [k, v] of Object.entries(t.size)) lines.push(`  --size-${k}: ${px(v)};`);
  for (const [k, v] of Object.entries(t.layout)) {
    if (isMeta(k)) continue;
    if (typeof v === "number") lines.push(`  --layout-${k}: ${px(v)};`);
    else for (const [kk, vv] of Object.entries(v)) lines.push(`  --layout-${k}-${kk}: ${px(vv)};`);
  }
  for (const [k, v] of Object.entries(t.shadow)) lines.push(`  --shadow-${k}: ${v};`);
  for (const [k, v] of Object.entries(t.motion)) if (!isMeta(k)) lines.push(`  --motion-${k}: ${v};`);
  return lines.join("\n");
}

const css = `/* Сгенерировано scripts/build-tokens.mjs из replica/design/tokens*.json. Не редактировать руками. */

:root {
${scales(light)}
}

:root,
:root[data-theme="light"] {
  color-scheme: light;
${colors(light.color)}
}

:root[data-theme="dark"] {
  color-scheme: dark;
${colors(dark.color)}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
${colors(dark.color).replace(/^/gm, "  ")}
  }
}
`;

writeFileSync(out, css);
console.log(`tokens.css: ${out}`);
