// Разметка сообщений: что лежит в messages.text и как это читать. Общая для API и клиента.
//
// Блоки — по строкам:
//   ```            блок кода до строки, которая кончается на ```
//   > текст        цитата (подряд идущие строки — одна цитата)
//   - пункт        маркированный список («•» тоже), 1. пункт — нумерованный;
//                  вложенность — два пробела на уровень
//   всё остальное  строка-абзац; пустая строка — пустой абзац
// Внутри строки:
//   *жирный*  _курсив_  ~зачёркнутый~  `код`  <https://…|текст>  голые http(s)-ссылки
//   <@id> человек, <!here> <!channel> <!everyone>, <#id> канал
//   «\» перед знаком препинания делает его обычным символом.
//
// Маркер открывает выделение, только если перед ним не буква/цифра, а после — не пробел,
// и закрывает, если перед ним не пробел, а после — не буква/цифра. Так «snake_case» и «2*3*4»
// остаются текстом, как и в старых сообщениях, где разметки ещё не было.

export type Broadcast = "here" | "channel" | "everyone";

export type Inline =
  | { t: "text"; v: string }
  | { t: "bold" | "italic" | "strike"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; url: string; c: Inline[] }
  | { t: "user"; id: string }
  | { t: "broadcast"; v: Broadcast }
  | { t: "channel"; id: string };

export type ListItem = { c: Inline[]; sub?: ListBlock };
export type ListBlock = { t: "ul" | "ol"; start: number; items: ListItem[] };
export type Block = { t: "p"; c: Inline[] } | { t: "pre"; v: string } | { t: "quote"; lines: Inline[][] } | ListBlock;

const FENCE = "```";
const QUOTE_RE = /^>(?: |$)/;
const LIST_RE = /^( *)(?:([-•])|(\d{1,9})\.) (.*)$/;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const USER_RE = new RegExp(`^<@(${UUID})>`);
const CHANNEL_RE = new RegExp(`^<#(${UUID})>`);
const BROADCAST_RE = /^<!(here|channel|everyone)>/;
// <url> или <url|подпись>; в подписи «>» и «|» экранированы.
const LINK_RE = /^<(https?:\/\/[^\s|<>]+)(?:\|((?:\\.|[^\\>])*))?>/;
const BARE_URL_RE = /^https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]}*_~]/;
const ASCII_PUNCT = /[!-/:-@[-`{-~]/;
const WORDISH = /[\p{L}\p{N}]/u;
const MARKS = { "*": "bold", _: "italic", "~": "strike" } as const;
type Delim = keyof typeof MARKS;

export function parseMarkup(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith(FENCE)) {
      const rest = line.slice(FENCE.length);
      if (rest.length > FENCE.length && rest.endsWith(FENCE)) {
        out.push({ t: "pre", v: rest.slice(0, -FENCE.length) });
        i++;
        continue;
      }
      const body = rest ? [rest] : [];
      i++;
      while (i < lines.length) {
        const l = lines[i]!;
        i++;
        if (l.endsWith(FENCE)) {
          const head = l.slice(0, -FENCE.length);
          if (head) body.push(head);
          break;
        }
        body.push(l);
      }
      out.push({ t: "pre", v: body.join("\n") });
      continue;
    }
    if (QUOTE_RE.test(line)) {
      const quoted: Inline[][] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i]!)) {
        quoted.push(parseInline(lines[i]!.replace(/^> ?/, "")));
        i++;
      }
      out.push({ t: "quote", lines: quoted });
      continue;
    }
    if (LIST_RE.test(line)) {
      const level = Math.floor(LIST_RE.exec(line)![1]!.length / 2);
      const { block, next } = parseList(lines, i, level);
      out.push(block);
      i = next;
      continue;
    }
    out.push({ t: "p", c: parseInline(line) });
    i++;
  }
  return out;
}

function parseList(lines: string[], start: number, depth: number): { block: ListBlock; next: number } {
  const first = LIST_RE.exec(lines[start]!)!;
  const ordered = first[3] !== undefined;
  const block: ListBlock = { t: ordered ? "ol" : "ul", start: ordered ? Number(first[3]) : 1, items: [] };
  let i = start;
  while (i < lines.length) {
    const m = LIST_RE.exec(lines[i]!);
    if (!m) break;
    const level = Math.floor(m[1]!.length / 2);
    if (level < depth) break;
    if (level > depth) {
      const { block: sub, next } = parseList(lines, i, level);
      const parent = block.items.at(-1);
      if (parent && !parent.sub) parent.sub = sub;
      else block.items.push({ c: [], sub });
      i = next;
      continue;
    }
    if ((m[3] !== undefined) !== ordered) break; // сменился тип списка — это уже следующий список
    block.items.push({ c: parseInline(m[4]!) });
    i++;
  }
  return { block, next: i };
}

export function parseInline(src: string): Inline[] {
  return new InlineParser(src).run();
}

// Предел работы на одну строку: огромное сообщение из одних «*» не должно вешать ленту.
const STEP_BUDGET = 200_000;

class InlineParser {
  private pos = 0;
  private steps = 0;
  // Неудачные попытки открыть выделение в этой позиции: повторно не пробуем.
  private readonly failed = new Set<string>();
  // Последняя позиция, где маркер может закрыться: после неё открывать бессмысленно.
  private readonly lastClose: Record<Delim, number>;
  constructor(private readonly s: string) {
    this.lastClose = { "*": -1, _: -1, "~": -1 };
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]!;
      if (ch in MARKS && this.canClose(i)) this.lastClose[ch as Delim] = i;
    }
  }

  run(): Inline[] {
    return this.seq(null, 0).nodes;
  }

  private seq(closer: Delim | null, depth: number): { nodes: Inline[]; closed: boolean } {
    const nodes: Inline[] = [];
    let text = "";
    const flush = () => {
      if (text) nodes.push({ t: "text", v: text });
      text = "";
    };
    const s = this.s;
    while (this.pos < s.length) {
      this.steps++;
      const ch = s[this.pos]!;
      const rest = s.slice(this.pos, this.pos + 400);

      if (ch === "\\" && this.pos + 1 < s.length && ASCII_PUNCT.test(s[this.pos + 1]!)) {
        text += s[this.pos + 1];
        this.pos += 2;
        continue;
      }
      if (closer && ch === closer && this.canClose(this.pos)) {
        this.pos++;
        flush();
        return { nodes, closed: true };
      }
      if (ch === "`") {
        const end = s.indexOf("`", this.pos + 1);
        if (end > this.pos + 1) {
          flush();
          nodes.push({ t: "code", v: s.slice(this.pos + 1, end) });
          this.pos = end + 1;
          continue;
        }
      }
      if (ch === "<") {
        const token = this.token(rest);
        if (token) {
          flush();
          nodes.push(token.node);
          this.pos += token.length;
          continue;
        }
      }
      if ((ch === "h" || ch === "H") && (this.pos === 0 || !WORDISH.test(s[this.pos - 1]!))) {
        const url = BARE_URL_RE.exec(rest)?.[0];
        if (url) {
          flush();
          nodes.push({ t: "link", url, c: [{ t: "text", v: url }] });
          this.pos += url.length;
          continue;
        }
      }
      if (ch in MARKS && this.mayOpen(ch as Delim, depth)) {
        const save = this.pos;
        this.pos++;
        const inner = this.seq(ch as Delim, depth + 1);
        if (inner.closed && inner.nodes.length > 0) {
          flush();
          nodes.push({ t: MARKS[ch as Delim], c: inner.nodes });
          continue;
        }
        this.failed.add(`${ch}${save}`);
        this.pos = save;
      }
      text += ch;
      this.pos++;
    }
    flush();
    return { nodes, closed: false };
  }

  private token(rest: string): { node: Inline; length: number } | null {
    let m = USER_RE.exec(rest);
    if (m) return { node: { t: "user", id: m[1]! }, length: m[0].length };
    m = CHANNEL_RE.exec(rest);
    if (m) return { node: { t: "channel", id: m[1]! }, length: m[0].length };
    m = BROADCAST_RE.exec(rest);
    if (m) return { node: { t: "broadcast", v: m[1] as Broadcast }, length: m[0].length };
    m = LINK_RE.exec(rest);
    if (m) {
      const label = m[2] === undefined || m[2] === "" ? [{ t: "text" as const, v: m[1]! }] : stripLinks(parseInline(m[2]));
      return { node: { t: "link", url: m[1]!, c: label }, length: m[0].length };
    }
    return null;
  }

  private mayOpen(d: Delim, depth: number): boolean {
    return (
      depth < 4 &&
      this.steps < STEP_BUDGET &&
      this.pos < this.lastClose[d] &&
      !this.failed.has(`${d}${this.pos}`) &&
      this.canOpen(this.pos)
    );
  }

  private canOpen(i: number): boolean {
    const next = this.s[i + 1];
    const prev = this.s[i - 1];
    return next !== undefined && !/\s/.test(next) && (prev === undefined || !WORDISH.test(prev));
  }

  private canClose(i: number): boolean {
    const prev = this.s[i - 1];
    const next = this.s[i + 1];
    return prev !== undefined && !/\s/.test(prev) && (next === undefined || !WORDISH.test(next));
  }
}

// Ссылка внутри подписи ссылки — просто текст.
function stripLinks(nodes: Inline[]): Inline[] {
  return nodes.map((n): Inline => {
    if (n.t === "link") return { t: "text", v: inlineText(n.c, () => "") };
    if (n.t === "bold" || n.t === "italic" || n.t === "strike") return { ...n, c: stripLinks(n.c) };
    return n;
  });
}

// ───────────── запись ─────────────

// Экранирование обычного текста: всё, что парсер мог бы принять за разметку.
export function escapeText(text: string): string {
  return text.replace(/[\\*_~`<]/g, "\\$&");
}

// Подпись ссылки: ещё «>» и «|», иначе они закроют ссылку раньше времени.
export function escapeLinkLabel(text: string): string {
  return text.replace(/[\\*_~`<>|]/g, "\\$&");
}

// Строка-абзац, которая сама по себе выглядит как начало блока, получает «\» перед маркером.
export function escapeLineStart(line: string): string {
  return line
    .replace(/^( *)([-•>])(?= |$)/, "$1\\$2")
    .replace(/^( *)(\d{1,9})\.(?= )/, "$1$2\\.")
    .replace(/^```/, "\\```");
}

export function linkMarkup(url: string, label: string): string {
  const safe = url.replace(/[|>\s]/g, encodeURIComponent);
  return label === "" || label === escapeLinkLabel(url) ? `<${safe}>` : `<${safe}|${label}>`;
}

export const SAFE_URL_RE = /^https?:\/\//i;

// ───────────── чтение ─────────────

export type Names = {
  user: (id: string) => string;
  channel: (id: string) => string;
};

export function inlineText(nodes: Inline[], name: (n: Inline) => string): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case "text":
        case "code":
          return n.v;
        case "bold":
        case "italic":
        case "strike":
        case "link":
          return inlineText(n.c, name);
        default:
          return name(n);
      }
    })
    .join("");
}

// Текст без разметки — для превью, подсказок и уведомлений.
export function markupToPlainText(src: string, names: Names): string {
  const name = (n: Inline) =>
    n.t === "user" ? `@${names.user(n.id)}` : n.t === "channel" ? `#${names.channel(n.id)}` : n.t === "broadcast" ? `@${n.v}` : "";
  const list = (b: ListBlock): string[] =>
    b.items.flatMap((it, i) => [`${b.t === "ol" ? `${b.start + i}.` : "•"} ${inlineText(it.c, name)}`, ...(it.sub ? list(it.sub) : [])]);
  return parseMarkup(src)
    .flatMap((b) => {
      switch (b.t) {
        case "p":
          return [inlineText(b.c, name)];
        case "pre":
          return [b.v];
        case "quote":
          return b.lines.map((l) => inlineText(l, name));
        default:
          return list(b);
      }
    })
    .join("\n");
}

// Кого упомянули: обход разметки, поэтому токены в коде и экранированные «\<@…>» не считаются.
export function extractMentions(text: string): { userIds: string[]; broadcast: Broadcast[] } {
  const userIds = new Set<string>();
  const broadcast = new Set<Broadcast>();
  const walk = (nodes: Inline[]) => {
    for (const n of nodes) {
      if (n.t === "user") userIds.add(n.id);
      else if (n.t === "broadcast") broadcast.add(n.v);
      else if (n.t === "bold" || n.t === "italic" || n.t === "strike" || n.t === "link") walk(n.c);
    }
  };
  const list = (b: ListBlock) => b.items.forEach((it) => (walk(it.c), it.sub && list(it.sub)));
  for (const b of parseMarkup(text)) {
    if (b.t === "p") walk(b.c);
    else if (b.t === "quote") b.lines.forEach(walk);
    else if (b.t === "ul" || b.t === "ol") list(b);
  }
  return { userIds: [...userIds], broadcast: [...broadcast] };
}
