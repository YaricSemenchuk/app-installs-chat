// Эмодзи: набор грузится отдельным чанком при старте приложения (≈100 КБ), до этого реакции
// показываются кодом «:+1:». Данные — scripts/build-emoji.mjs.
import { create } from "zustand";

export type Emoji = { char: string; name: string; group: number; label: string; keywords: string };
export type EmojiIndex = {
  all: Emoji[];
  groups: { id: number; title: string }[];
  byName: Map<string, Emoji>;
  byChar: Map<string, Emoji>;
};

export const useEmoji = create<{ index: EmojiIndex | null }>(() => ({ index: null }));

let loading: Promise<EmojiIndex> | null = null;

const bare = (char: string) => char.replace(/️/g, "");

export function loadEmoji(): Promise<EmojiIndex> {
  loading ??= import("./emoji-data.json").then(({ default: data }) => {
    const all = (data.emoji as [string, string, number, string, string][]).map(([char, name, group, label, keywords]) => ({
      char,
      name,
      group,
      label,
      keywords: `${label} ${keywords}`.toLowerCase(),
    }));
    const groups = (data.groups as (string | null)[]).flatMap((title, id) => (title ? [{ id, title }] : []));
    const index: EmojiIndex = {
      all,
      groups,
      byName: new Map(all.map((e) => [e.name, e])),
      byChar: new Map(all.map((e) => [bare(e.char), e])),
    };
    useEmoji.setState({ index });
    return index;
  });
  return loading;
}

export function emojiChar(index: EmojiIndex | null, name: string): string {
  return index?.byName.get(name)?.char ?? `:${name}:`;
}

// Поиск: код с начала, потом название, потом любое слово, потом вхождение где угодно.
export function searchEmoji(index: EmojiIndex, query: string, limit = 64): Emoji[] {
  const q = query.trim().toLowerCase().replace(/^:/, "");
  if (!q) return [];
  const ranked: [number, number, Emoji][] = [];
  index.all.forEach((e, order) => {
    let rank = -1;
    if (e.name.startsWith(q)) rank = 0;
    else if (e.label.toLowerCase().startsWith(q)) rank = 1;
    else if (e.keywords.split(" ").some((w) => w.startsWith(q))) rank = 2;
    else if (e.name.includes(q) || e.keywords.includes(q)) rank = 3;
    if (rank >= 0) ranked.push([rank, order, e]);
  });
  return ranked
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .slice(0, limit)
    .map((x) => x[2]);
}

// Недавние — в браузере, у каждого свои. Первые три — быстрые реакции на ленте.
const RECENT_KEY = "teamchat.recentEmoji";
const RECENT_MAX = 24;
const DEFAULT_RECENT = ["+1", "white_check_mark", "eyes", "joy", "tada", "pray", "heart", "fire"];

export const useRecentEmoji = create<{ names: string[] }>(() => ({ names: readRecent() }));

function readRecent(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    if (Array.isArray(stored) && stored.every((x) => typeof x === "string")) {
      return [...new Set([...stored, ...DEFAULT_RECENT])].slice(0, RECENT_MAX);
    }
  } catch {
    // нет доступа к хранилищу — просто без памяти
  }
  return DEFAULT_RECENT;
}

export function rememberEmoji(name: string) {
  const names = [name, ...useRecentEmoji.getState().names.filter((n) => n !== name)].slice(0, RECENT_MAX);
  useRecentEmoji.setState({ names });
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(names));
  } catch {
    // см. выше
  }
}

// Сообщение только из 1–3 эмодзи показываем крупно.
const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("ru", { granularity: "grapheme" }) : null;
const PICTO = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

export function isEmojiOnly(text: string): boolean {
  const t = text.replace(/\s+/g, "");
  if (!t || !segmenter) return false;
  const parts = [...segmenter.segment(t)];
  return parts.length <= 3 && parts.every((p) => PICTO.test(p.segment));
}
