// Разметка сообщения → React-элементы. HTML из текста не вставляется никогда: только узлы
// парсера из @teamchat/shared, ссылки — только http(s).
import { Fragment, memo, useMemo, type ReactNode } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { SAFE_URL_RE, parseMarkup, type BootDto, type ConversationDto, type Inline, type ListBlock } from "@teamchat/shared";
import { api } from "../api/http";
import { displayOf } from "../data/boot";
import { cx } from "../lib/cx";
import { isEmojiOnly } from "../emoji/emoji";
import { MentionChip } from "./Message";
import s from "./Markup.module.scss";

type Ctx = { boot: BootDto; mentionsMe: boolean; hl: RegExp | null };

// Подсветка совпадений поиска: только целые слова, регистр не важен.
function highlighter(words: string[] | undefined): RegExp | null {
  const clean = (words ?? []).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return clean.length ? new RegExp(`(?<![\\p{L}\\p{N}])(${clean.join("|")})(?![\\p{L}\\p{N}])`, "giu") : null;
}

function marked(text: string, hl: RegExp | null): ReactNode {
  if (!hl) return text;
  const parts = text.split(hl);
  return parts.length === 1 ? text : parts.map((p, i) => (i % 2 === 1 ? <mark key={i} className={s.mark}>{p}</mark> : p));
}

// suffix — «(изменено)»: продолжает последнюю строку, а не уходит на новую.
export const Markup = memo(function Markup({
  text,
  boot,
  mentionsMe,
  suffix,
  highlight,
}: {
  text: string;
  boot: BootDto;
  mentionsMe: boolean;
  suffix?: ReactNode;
  highlight?: string[];
}) {
  const blocks = useMemo(() => parseMarkup(text), [text]);
  const hl = useMemo(() => highlighter(highlight), [highlight]);
  const ctx: Ctx = { boot, mentionsMe, hl };
  const only = blocks.length === 1 && blocks[0]!.t === "p" ? blocks[0]!.c : null;
  const big = only !== null && only.every((n) => n.t === "text") && isEmojiOnly(only.map((n) => (n.t === "text" ? n.v : "")).join(""));

  return (
    <div className={cx(s.markup, big && s.big)}>
      {blocks.map((b, i) => {
        const last = i === blocks.length - 1;
        switch (b.t) {
          case "p":
            return (
              <p key={i}>
                {b.c.length > 0 ? inline(b.c, ctx) : <br />}
                {last && suffix}
              </p>
            );
          case "pre":
            return (
              <pre key={i} className={s.pre}>
                {b.v}
              </pre>
            );
          case "quote":
            return (
              <blockquote key={i} className={s.quote}>
                {b.lines.map((l, j) => (
                  <p key={j}>{l.length > 0 ? inline(l, ctx) : <br />}</p>
                ))}
              </blockquote>
            );
          default:
            return <List key={i} block={b} ctx={ctx} />;
        }
      })}
      {blocks.at(-1)?.t !== "p" && suffix}
    </div>
  );
});

function List({ block, ctx }: { block: ListBlock; ctx: Ctx }) {
  const items = block.items.map((it, i) => (
    <li key={i}>
      {inline(it.c, ctx)}
      {it.sub && <List block={it.sub} ctx={ctx} />}
    </li>
  ));
  return block.t === "ol" ? (
    <ol className={s.list} start={block.start}>
      {items}
    </ol>
  ) : (
    <ul className={s.list}>{items}</ul>
  );
}

function inline(nodes: Inline[], ctx: Ctx): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case "text":
        return <Fragment key={i}>{marked(n.v, ctx.hl)}</Fragment>;
      case "bold":
        return <strong key={i}>{inline(n.c, ctx)}</strong>;
      case "italic":
        return <em key={i}>{inline(n.c, ctx)}</em>;
      case "strike":
        return <s key={i}>{inline(n.c, ctx)}</s>;
      case "code":
        return (
          <code key={i} className={s.code}>
            {n.v}
          </code>
        );
      case "link":
        return SAFE_URL_RE.test(n.url) ? (
          <a key={i} href={n.url} target="_blank" rel="noopener noreferrer">
            {inline(n.c, ctx)}
          </a>
        ) : (
          <Fragment key={i}>{inline(n.c, ctx)}</Fragment>
        );
      case "user": {
        const u = ctx.boot.users.find((x) => x.id === n.id);
        return <MentionChip key={i} name={u ? displayOf(u) : "неизвестный"} me={n.id === ctx.boot.me.id} />;
      }
      case "broadcast":
        return <MentionChip key={i} name={n.v} me={ctx.mentionsMe} />;
      case "channel":
        return <ChannelChip key={i} id={n.id} boot={ctx.boot} />;
    }
  });
}

// #канал: свой — из boot, открытый чужой — запросом, закрытый чужой — без названия.
function ChannelChip({ id, boot }: { id: string; boot: BootDto }) {
  const known = boot.conversations.find((c) => c.id === id);
  const fetched = useQuery({
    queryKey: ["conversation", id],
    queryFn: () => api<ConversationDto>(`/conversations/${id}`),
    enabled: !known,
    retry: false,
    staleTime: Infinity,
  });
  const name = known?.name ?? fetched.data?.name;
  if (!name) return <span className={s.channel}>{fetched.isPending ? "#…" : "#закрытый канал"}</span>;
  return (
    <Link className={s.channel} to={`/c/${id}`}>
      #{name}
    </Link>
  );
}
