import type { ReactNode } from "react";
import {
  Bookmark,
  Download,
  Ellipsis,
  FileText,
  Forward,
  MessageSquareText,
  SmilePlus,
} from "lucide-react";
import { cx } from "../lib/cx";
import { Avatar } from "../ui/Avatar";
import { IconButton } from "../ui/IconButton";
import s from "./Message.module.scss";

export type Reaction = { emoji: string; count: number; mine?: boolean; who: string };
export type MessageState = "default" | "hover" | "mentionsMe" | "highlighted" | "sending" | "failed";

type Props = {
  id: string;
  author: string;
  time: string;
  isoTime: string;
  continuation?: boolean;
  status?: string;
  state?: MessageState;
  edited?: boolean;
  reactions?: Reaction[];
  thread?: { names: string[]; count: number; last: string; unread?: boolean };
  fullTime?: string;
  onRetry?: () => void;
  onDiscard?: () => void;
  children: ReactNode;
};

export function Message({
  id,
  author,
  time,
  isoTime,
  continuation = false,
  status,
  state = "default",
  edited = false,
  reactions,
  thread,
  fullTime,
  onRetry,
  onDiscard,
  children,
}: Props) {
  return (
    <article
      className={cx(s.message, continuation && s.continuation, s[state])}
      aria-label={`${author}, ${time}`}
      tabIndex={-1}
      data-id={id}
    >
      <div className={s.gutter}>
        {continuation ? (
          <time className={s.gutterTime} dateTime={isoTime} title={fullTime}>
            {time}
          </time>
        ) : (
          <Avatar name={author} size="l" decorative />
        )}
      </div>
      <div className={s.main}>
        {!continuation && (
          <div className={s.meta}>
            <span className={s.author}>{author}</span>
            {status && (
              <span className={s.status} aria-label={`статус ${status}`}>
                {status}
              </span>
            )}
            <time className={s.time} dateTime={isoTime} title={fullTime}>
              {time}
            </time>
          </div>
        )}
        <div className={cx(s.body, edited && s.bodyEdited)}>
          {children}
          {edited && <span className={s.edited}> (изменено)</span>}
        </div>
        {state === "sending" && <p className={s.note}>Отправляется…</p>}
        {state === "failed" && (
          <p className={cx(s.note, s.failedNote)}>
            Не отправлено ·{" "}
            <button type="button" onClick={onRetry}>
              Повторить
            </button>{" "}
            ·{" "}
            <button type="button" onClick={onDiscard}>
              Удалить
            </button>
          </p>
        )}
        {reactions && reactions.length > 0 && (
          <div className={s.reactions}>
            {reactions.map((r) => (
              <ReactionPill key={r.emoji} {...r} />
            ))}
            <button type="button" className={cx(s.reaction, s.reactionAdd)} aria-label="Добавить реакцию">
              <SmilePlus />
            </button>
          </div>
        )}
        {thread && <ThreadSummary {...thread} />}
      </div>
      <MessageActions />
    </article>
  );
}

export function ReactionPill({ emoji, count, mine = false, who }: Reaction) {
  return (
    <button
      type="button"
      className={cx(s.reaction, mine && s.reactionMine)}
      aria-pressed={mine}
      aria-label={`Реакция ${emoji}, ${count}${mine ? ", вы среди них" : ""}`}
      title={who}
    >
      <span className={s.reactionEmoji}>{emoji}</span>
      <span className={s.reactionCount}>{count}</span>
    </button>
  );
}

export function ThreadSummary({ names, count, last, unread }: { names: string[]; count: number; last: string; unread?: boolean }) {
  return (
    <button type="button" className={s.thread}>
      <span className={s.threadAvatars}>
        {names.slice(0, 5).map((n) => (
          <Avatar key={n} name={n} size="m" decorative />
        ))}
      </span>
      {unread && <span className={s.threadDot} aria-label="есть новые ответы" />}
      <span className={s.threadCount}>
        {count} {plural(count, "ответ", "ответа", "ответов")}
      </span>
      <span className={s.threadLast}>{last}</span>
    </button>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function MessageActions() {
  return (
    <div className={s.actions} role="toolbar" aria-label="Действия с сообщением">
      {["👍", "✅", "👀"].map((e) => (
        <button key={e} type="button" className={s.quickReaction} aria-label={`Реакция ${e}`}>
          {e}
        </button>
      ))}
      <span className={s.actionsDivider} />
      <IconButton label="Добавить реакцию" shortcut="R" size="xs">
        <SmilePlus />
      </IconButton>
      <IconButton label="Ответить в треде" shortcut="T" size="xs">
        <MessageSquareText />
      </IconButton>
      <IconButton label="Переслать" shortcut="F" size="xs">
        <Forward />
      </IconButton>
      <IconButton label="Сохранить" shortcut="A" size="xs">
        <Bookmark />
      </IconButton>
      <IconButton label="Ещё" size="xs">
        <Ellipsis />
      </IconButton>
    </div>
  );
}

export function MentionChip({ name, me = false }: { name: string; me?: boolean }) {
  return <span className={cx(s.mention, me && s.mentionMe)}>@{name}</span>;
}

export function InlineCode({ children }: { children: ReactNode }) {
  return <code className={s.code}>{children}</code>;
}

export function CodeBlock({ children }: { children: string }) {
  return <pre className={s.codeBlock}>{children}</pre>;
}

export function FileCard({ name, kind, size }: { name: string; kind: string; size: string }) {
  return (
    <div className={s.file}>
      <span className={s.fileIcon}>
        <FileText />
      </span>
      <span className={s.fileText}>
        <span className={s.fileName}>{name}</span>
        <span className={s.fileMeta}>
          {kind} · {size}
        </span>
      </span>
      <IconButton label="Скачать" size="s">
        <Download />
      </IconButton>
    </div>
  );
}

export function SystemMessage({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className={s.system}>
      <span className={s.systemIcon}>{icon}</span>
      <span>{children}</span>
    </div>
  );
}

export function DateDivider({ label }: { label: string }) {
  return (
    <div className={s.dateDivider} role="separator" aria-label={label}>
      <span>{label}</span>
    </div>
  );
}

export function UnreadDivider() {
  return (
    <div className={s.unreadDivider} role="separator" aria-label="Новые сообщения">
      <span>Новые</span>
    </div>
  );
}
