// Документ TipTap ↔ разметка сообщения (packages/shared/src/markup.ts).
// Туда — при отправке и сохранении правки, обратно — когда сообщение открывают на правку.
import type { JSONContent } from "@tiptap/core";
import {
  SAFE_URL_RE,
  escapeLineStart,
  escapeLinkLabel,
  escapeText,
  linkMarkup,
  mentionToken,
  parseMarkup,
  type Block,
  type Inline,
  type ListBlock,
} from "@teamchat/shared";

export type MentionKind = "user" | "here" | "channel" | "everyone" | "conversation";

// ───────────── документ → разметка ─────────────

const WRAP: Record<string, string> = { bold: "*", italic: "_", strike: "~" };
const MARK_ORDER = ["bold", "italic", "strike"];
const WORDISH = /[\p{L}\p{N}]/u;

export function docToMarkup(doc: JSONContent): string {
  const lines = (doc.content ?? []).flatMap((b) => block(b));
  // Пустые строки по краям не нужны, внутри — остаются, как человек их набрал.
  while (lines.length && lines[0]!.trim() === "") lines.shift();
  while (lines.length && lines.at(-1)!.trim() === "") lines.pop();
  return lines.join("\n");
}

function block(node: JSONContent): string[] {
  switch (node.type) {
    case "paragraph":
      return [escapeLineStart(inline(node.content ?? []))];
    case "codeBlock": {
      const code = (node.content ?? []).map((t) => t.text ?? "").join("");
      return ["```", ...code.split("\n"), "```"];
    }
    case "blockquote":
      return (node.content ?? []).flatMap((c) => block(c)).map((l) => (l ? `> ${l}` : ">"));
    case "bulletList":
    case "orderedList":
      return list(node, 0);
    default:
      return node.content ? node.content.flatMap((c) => block(c)) : [];
  }
}

function list(node: JSONContent, depth: number): string[] {
  const ordered = node.type === "orderedList";
  let n = Number(node.attrs?.start ?? 1);
  return (node.content ?? []).flatMap((item) => {
    const parts = item.content ?? [];
    const text = parts
      .filter((p) => p.type === "paragraph")
      .map((p) => inline(p.content ?? []))
      .join(" ");
    const subs = parts.filter((p) => p.type === "bulletList" || p.type === "orderedList");
    const marker = ordered ? `${n++}. ` : "- ";
    return [`${"  ".repeat(depth)}${marker}${text}`, ...subs.flatMap((s) => list(s, depth + 1))];
  });
}

const markTypes = (n: JSONContent) => new Set((n.marks ?? []).map((m) => m.type));
const hrefOf = (n: JSONContent) => {
  const href = n.marks?.find((m) => m.type === "link")?.attrs?.href;
  return typeof href === "string" && SAFE_URL_RE.test(href) ? href : null;
};

function inline(nodes: JSONContent[]): string {
  let out = "";
  for (let i = 0; i < nodes.length; ) {
    const href = hrefOf(nodes[i]!);
    if (href) {
      let j = i;
      while (j < nodes.length && hrefOf(nodes[j]!) === href) j++;
      out += linkMarkup(href, segment(nodes.slice(i, j), true, "|", ">"));
      i = j;
    } else {
      out += segment([nodes[i]!], false, out, nodeText(nodes[i + 1]));
      i++;
    }
  }
  return out;
}

// Текст соседа для проверки границ слова; упоминание пишется токеном «<…>».
const nodeText = (n: JSONContent | undefined) => (n?.type === "text" ? (n.text ?? "") : n ? "<" : "");

// Узлы одной ссылки или один узел вне ссылки. before/after — соседний текст: выделение посреди слова
// разметка выразить не может, и тогда оно просто теряется (лучше, чем звёздочки в тексте).
function segment(nodes: JSONContent[], inLink: boolean, before: string, after: string): string {
  const esc = inLink ? escapeLinkLabel : escapeText;
  let out = "";
  nodes.forEach((n, k) => {
    if (n.type === "mention") {
      out += mentionMarkup(n.attrs ?? {});
      return;
    }
    if (n.type !== "text" || !n.text) return;
    const marks = markTypes(n);
    const text = n.text;
    if (marks.has("code") && !text.includes("`")) {
      out += `\`${text}\``;
      return;
    }
    const [, lead = "", core = "", trail = ""] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text) ?? [];
    const prev = (before + out + lead).slice(-1);
    const next = trail ? " " : k + 1 < nodes.length ? nodeText(nodes[k + 1]).charAt(0) : after.charAt(0);
    const wraps = MARK_ORDER.filter((m) => marks.has(m)).map((m) => WRAP[m]!);
    const fits = core !== "" && !(prev && WORDISH.test(prev)) && !(next && WORDISH.test(next));
    const open = fits ? wraps.join("") : "";
    const close = fits ? [...wraps].reverse().join("") : "";
    out += `${esc(lead)}${open}${esc(core)}${close}${esc(trail)}`;
  });
  return out;
}

function mentionMarkup(attrs: Record<string, unknown>): string {
  const id = String(attrs.id ?? "");
  switch (attrs.kind as MentionKind) {
    case "conversation":
      return mentionToken.conversation(id);
    case "here":
      return mentionToken.here;
    case "channel":
      return mentionToken.channel;
    case "everyone":
      return mentionToken.everyone;
    default:
      return mentionToken.user(id);
  }
}

// ───────────── разметка → документ ─────────────

export type MentionNames = { user: (id: string) => string; conversation: (id: string) => string };

export function markupToDoc(text: string, names: MentionNames): JSONContent {
  const content = parseMarkup(text).map((b) => blockToJson(b, names));
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

function blockToJson(b: Block, names: MentionNames): JSONContent {
  switch (b.t) {
    case "p":
      return paragraph(b.c, names);
    case "pre":
      return { type: "codeBlock", content: b.v ? [{ type: "text", text: b.v }] : [] };
    case "quote":
      return { type: "blockquote", content: b.lines.map((l) => paragraph(l, names)) };
    default:
      return listToJson(b, names);
  }
}

function listToJson(b: ListBlock, names: MentionNames): JSONContent {
  return {
    type: b.t === "ol" ? "orderedList" : "bulletList",
    ...(b.t === "ol" ? { attrs: { start: b.start } } : {}),
    content: b.items.map((it) => ({
      type: "listItem",
      content: [paragraph(it.c, names), ...(it.sub ? [listToJson(it.sub, names)] : [])],
    })),
  };
}

function paragraph(nodes: Inline[], names: MentionNames): JSONContent {
  const content = inlineToJson(nodes, [], names);
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
}

type Mark = { type: string; attrs?: Record<string, unknown> };

function inlineToJson(nodes: Inline[], marks: Mark[], names: MentionNames): JSONContent[] {
  return nodes.flatMap((n): JSONContent[] => {
    switch (n.t) {
      case "text":
        return n.v ? [{ type: "text", text: n.v, ...(marks.length ? { marks } : {}) }] : [];
      case "code":
        return n.v ? [{ type: "text", text: n.v, marks: [{ type: "code" }] }] : [];
      case "bold":
      case "italic":
      case "strike":
        return inlineToJson(n.c, [...marks, { type: n.t }], names);
      case "link":
        return inlineToJson(n.c, [...marks, { type: "link", attrs: { href: n.url } }], names);
      case "user":
        return [{ type: "mention", attrs: { id: n.id, label: names.user(n.id), kind: "user" } }];
      case "channel":
        return [{ type: "mention", attrs: { id: n.id, label: names.conversation(n.id), kind: "conversation" } }];
      case "broadcast":
        return [{ type: "mention", attrs: { id: n.v, label: n.v, kind: n.v } }];
    }
  });
}
