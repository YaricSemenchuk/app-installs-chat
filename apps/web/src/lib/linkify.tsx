import type { ReactNode } from "react";

// Только http(s): никаких javascript: и data: в ссылках из сообщений.
const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}]/g;

export function linkify(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    out.push(
      <a key={start} href={match[0]} target="_blank" rel="noopener noreferrer">
        {match[0]}
      </a>,
    );
    last = start + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
