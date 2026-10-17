// Иконки из знака AppInstalls (brand/appinstalls-mark.svg): фавикон и иконка для iPhone в вебе, иконки приложения
// для macOS, Linux (набор размеров) и Windows, значок в строке меню macOS. Запуск: node scripts/build-icons.mjs (из корня).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const root = join(import.meta.dirname, "..");
const BLUE = "#4858A8"; // фирменный синий AppInstalls
const mark = readFileSync(join(root, "brand/appinstalls-mark.svg"), "utf8");
const MARK_W = 50.7692;
const MARK_H = 32;
// Внутренности знака без обёртки <svg>, перекрашенные в нужный цвет. fill="none" — как у корня исходника,
// иначе кольцо без своей заливки закрасится чёрным.
const shapes = (color) => `<g fill="none">${mark.replace(/<svg[^>]*>|<\/svg>/g, "").replaceAll(BLUE, color)}</g>`;

// Знак по центру квадрата size×size шириной width.
function placed(size, width, color) {
  const scale = width / MARK_W;
  const x = (size - width) / 2;
  const y = (size - MARK_H * scale) / 2;
  return `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(4)})">${shapes(color)}</g>`;
}

const svg = (size, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${body}</svg>`;

// Синий скруглённый квадрат с белым знаком: веб, Linux, Windows.
const square = svg(1024, `<rect width="1024" height="1024" rx="232" fill="${BLUE}"/>${placed(1024, 560, "#fff")}`);
// macOS: по сетке Apple тело иконки 824 из 1024 с прозрачными полями.
const mac = svg(1024, `<rect x="100" y="100" width="824" height="824" rx="185" fill="${BLUE}"/>${placed(1024, 452, "#fff")}`);
// iOS сам скругляет углы: квадрат без скругления.
const touch = svg(1024, `<rect width="1024" height="1024" fill="${BLUE}"/>${placed(1024, 560, "#fff")}`);
// Строка меню macOS: чёрный знак на прозрачном фоне (template — система сама перекрасит под тему).
const tray = (size) => svg(size, placed(size, size * 0.94, "#000"));

const png = (source, size, file) => sharp(Buffer.from(source)).resize(size, size).png().toFile(join(root, file));

writeFileSync(join(root, "apps/web/public/favicon.svg"), square + "\n");
await png(touch, 180, "apps/web/public/apple-touch-icon.png");
await png(square, 1024, "apps/desktop/build/icon.png");
await png(mac, 1024, "apps/desktop/build/icon-mac.png");
await png(square, 512, "apps/desktop/assets/icon.png");
await png(tray(16), 16, "apps/desktop/assets/trayTemplate.png");
await png(tray(32), 32, "apps/desktop/assets/trayTemplate@2x.png");
writeFileSync(join(root, "apps/desktop/assets/tray.svg"), tray(32) + "\n");
// Linux: набор стандартных размеров для темы hicolor — в доке и меню Ubuntu иконка не размывается.
mkdirSync(join(root, "apps/desktop/build/icons"), { recursive: true });
for (const size of [16, 32, 48, 64, 128, 256, 512]) await png(square, size, `apps/desktop/build/icons/${size}x${size}.png`);
console.log("icons: web favicon + touch icon, desktop icon/icon-mac, Linux set, window icon, tray template");
