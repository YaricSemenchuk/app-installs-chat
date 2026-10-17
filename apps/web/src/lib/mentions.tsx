// Текст сообщения → React: токены упоминаний становятся чипами, ссылки — ссылками.
import type { ReactNode } from "react";
import { MENTION_TOKEN_RE, type BootDto } from "@teamchat/shared";
import { MentionChip } from "../chat/Message";
import { displayOf } from "../data/boot";
import { linkify } from "./linkify";

export function renderMessageText(text: string, boot: BootDto, mentionsMe: boolean): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION_TOKEN_RE)) {
    const start = m.index ?? 0;
    if (start > last) out.push(...linkify(text.slice(last, start)));
    if (m[1]) {
      const u = boot.users.find((x) => x.id === m[1]);
      out.push(<MentionChip key={start} name={u ? displayOf(u) : "неизвестный"} me={m[1] === boot.me.id} />);
    } else {
      out.push(<MentionChip key={start} name={m[2]!} me={mentionsMe} />);
    }
    last = start + m[0].length;
  }
  if (last < text.length) out.push(...linkify(text.slice(last)));
  return out;
}

// Однострочное превью без токенов (для подсказок и уведомлений).
export function plainText(text: string, boot: BootDto): string {
  return text.replace(MENTION_TOKEN_RE, (_all, id: string | undefined, broadcast: string | undefined) => {
    if (id) {
      const u = boot.users.find((x) => x.id === id);
      return `@${u ? displayOf(u) : "неизвестный"}`;
    }
    return `@${broadcast}`;
  });
}
