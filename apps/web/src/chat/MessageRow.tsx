// Живое сообщение в ленте и в треде: текст, правка на месте, реакции, сводка треда, действия (S15, S16).
import { useState, type ReactElement } from "react";
import { Ellipsis, Link2, LogIn, LogOut, MessageSquareText, Pencil, SmilePlus, Trash2 } from "lucide-react";
import { canStillEdit, isAdminRole, markupToPlainText } from "@teamchat/shared";
import { displayOf, isOnline, userName } from "../data/boot";
import { useMessages, type ChatMessage } from "../data/messages";
import { RichEditor } from "../editor/RichEditor";
import { EmojiPicker } from "../emoji/EmojiPicker";
import { Attachments } from "../files/Attachments";
import { FigmaUnfurls } from "../tasks/FigmaUnfurls";
import { emojiChar, rememberEmoji, useEmoji, useRecentEmoji } from "../emoji/emoji";
import { dayLabel, formatFull, formatTime, plural } from "../lib/format";
import { UserCard } from "../people/UserCard";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { IconButton } from "../ui/IconButton";
import { Menu, type MenuEntry } from "../ui/Menu";
import { Popover } from "../ui/Popover";
import { toast } from "../ui/Toaster";
import { useChat } from "./context";
import { Markup } from "./Markup";
import { Message, ReactionPill, SystemMessage, ThreadSummary } from "./Message";
import s from "./MessageRow.module.scss";
import ms from "./Message.module.scss";

const GROUP_WINDOW_MS = 5 * 60_000;

export type Place = "feed" | "thread" | "parent";

export function messageLink(m: Pick<ChatMessage, "id" | "conversationId">) {
  return `${location.origin}/c/${m.conversationId}?m=${m.id}`;
}

// Одно сообщение продолжает предыдущее: тот же автор, меньше 5 минут, без системных между ними.
export function continues(m: ChatMessage, prev: ChatMessage | undefined) {
  return (
    !!prev &&
    prev.subtype === null &&
    !prev.deleted &&
    prev.userId === m.userId &&
    !(m.alsoInChannel && m.parentId) &&
    new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS
  );
}

export function MessageRow({ message: m, prev, place }: { message: ChatMessage; prev?: ChatMessage; place: Place }) {
  const ctx = useChat();
  const { boot } = ctx;
  const author = userName(boot, m.userId);
  const [pinned, setPinned] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const edit = useMessages((st) => st.edit);
  const retry = useMessages((st) => st.retry);
  const discard = useMessages((st) => st.discard);

  const system = systemLine(m, author);
  if (system) return system;

  const me = boot.me.id;
  const mine = m.userId === me;
  const live = !m.local && !m.deleted;
  const editable = live && mine && m.subtype === null && ctx.canPost && canStillEdit(m.createdAt, boot.workspace.messageEditWindowMinutes);
  const deletable = live && m.subtype === null && (mine || isAdminRole(boot.me.role));
  const where = place === "feed" ? "feed" : "thread";
  const editing = ctx.editing?.id === m.id && ctx.editing.where === where;
  const mentionsMe = m.mentions.includes(me);
  const user = boot.users.find((u) => u.id === m.userId);
  const continuation = place !== "parent" && continues(m, prev);

  const state = m.local === "sending" ? "sending" : m.local === "failed" ? "failed" : ctx.highlightId === m.id ? "highlighted" : mentionsMe ? "mentionsMe" : "default";
  const edited = m.editedAt !== null ? <span className={ms.edited} title={`Изменено ${formatFull(m.editedAt)}`}> (изменено)</span> : null;

  let body;
  if (editing) {
    body = (
      <RichEditor
        variant="edit"
        placeholder="Изменить сообщение"
        initial={m.text}
        sources={ctx.sources}
        allowEmpty={m.files.length > 0}
        onSubmit={(markup) => {
          ctx.setEditing(null);
          if (markup !== m.text) void edit(m.id, markup);
        }}
        onCancel={() => ctx.setEditing(null)}
      />
    );
  } else if (m.deleted) {
    body = <p className={s.deleted}>Сообщение удалено</p>;
  } else {
    body = (
      <>
        {m.text.trim() !== "" ? <Markup text={m.text} boot={boot} mentionsMe={mentionsMe} suffix={edited} /> : edited}
        {m.files.length > 0 && <Attachments files={m.files} author={author} time={formatFull(m.createdAt)} />}
        {m.unfurls?.length > 0 && <FigmaUnfurls messageId={m.id} unfurls={m.unfurls} canHide={mine && !m.local} />}
      </>
    );
  }

  return (
    <>
      <Message
        id={m.id}
        author={author}
        authorId={m.userId}
        authorCard={
          user ? (
            <UserCard
              user={user}
              online={isOnline(boot, user.id)}
              onMessage={ctx.onMessageUser && !user.deactivated ? () => ctx.onMessageUser!(user.id) : undefined}
            />
          ) : undefined
        }
        time={formatTime(m.createdAt)}
        fullTime={formatFull(m.createdAt)}
        isoTime={m.createdAt}
        continuation={continuation}
        state={state}
        pinned={pinned}
        onRetry={m.clientMsgId ? () => void retry(m.conversationId, m.clientMsgId!) : undefined}
        onDiscard={m.clientMsgId ? () => discard(m.conversationId, m.clientMsgId!) : undefined}
        context={place === "feed" && m.parentId ? <ReplyContext message={m} /> : undefined}
        reactionsSlot={live && m.reactions.length > 0 ? <Reactions message={m} onPin={setPinned} /> : undefined}
        threadSlot={place === "feed" && m.replyCount > 0 ? <Summary message={m} /> : undefined}
        actions={
          live && !editing ? (
            <Actions
              message={m}
              place={place}
              editable={editable}
              deletable={deletable}
              onPin={setPinned}
              onEdit={() => ctx.setEditing({ id: m.id, where })}
              onDelete={() => setConfirmDelete(true)}
            />
          ) : (
            false
          )
        }
      >
        {body}
      </Message>
      {confirmDelete && <DeleteDialog message={m} onClose={() => setConfirmDelete(false)} />}
    </>
  );
}

// ───────────── части ─────────────

function ReplyContext({ message: m }: { message: ChatMessage }) {
  const ctx = useChat();
  const parent = useMessages((st) => (m.parentId ? st.find(m.parentId) : undefined));
  const names = { user: (id: string) => userName(ctx.boot, id), channel: (id: string) => ctx.boot.conversations.find((c) => c.id === id)?.name ?? "канал" };
  const snippet = parent && !parent.deleted ? markupToPlainText(parent.text, names).split("\n")[0] : null;
  return (
    <button type="button" className={s.replyContext} onClick={() => ctx.openThread(m.parentId!, m.id)}>
      <MessageSquareText />
      <span className={s.replyContextText}>{snippet ? `ответ в треде: ${snippet}` : "ответ в треде"}</span>
    </button>
  );
}

function Summary({ message: m }: { message: ChatMessage }) {
  const ctx = useChat();
  const ids = m.replyUserIds;
  const last = m.lastReplyAt ? `Последний ответ ${dayLabel(m.lastReplyAt).toLowerCase()} в ${formatTime(m.lastReplyAt)}` : "";
  return (
    <ThreadSummary
      names={ids.map((id) => userName(ctx.boot, id))}
      ids={ids}
      count={m.replyCount}
      last={last}
      onClick={() => ctx.openThread(m.id)}
    />
  );
}

function whoReacted(ids: string[], ctx: ReturnType<typeof useChat>): string {
  const names = ids.map((id) => (id === ctx.boot.me.id ? "вы" : userName(ctx.boot, id)));
  const shown = names.slice(0, 3).join(", ");
  return names.length > 3 ? `${shown} и ещё ${names.length - 3}` : shown;
}

function Reactions({ message: m, onPin }: { message: ChatMessage; onPin: (v: boolean) => void }) {
  const ctx = useChat();
  const index = useEmoji((st) => st.index);
  const toggle = useMessages((st) => st.toggleReaction);
  const me = ctx.boot.me.id;
  const canReact = ctx.conv.isMember;
  return (
    <div className={ms.reactions}>
      {m.reactions.map((r) => (
        <ReactionPill
          key={r.emoji}
          emoji={emojiChar(index, r.emoji)}
          count={r.userIds.length}
          mine={r.userIds.includes(me)}
          who={`${whoReacted(r.userIds, ctx)} · :${r.emoji}:`}
          disabled={!canReact}
          onClick={() => void toggle(m.id, r.emoji, me)}
        />
      ))}
      {canReact && (
        <ReactionPicker message={m} onPin={onPin}>
          <button type="button" className={`${ms.reaction} ${ms.reactionAdd}`} aria-label="Добавить реакцию">
            <SmilePlus />
          </button>
        </ReactionPicker>
      )}
    </div>
  );
}

function ReactionPicker({ message: m, onPin, children }: { message: ChatMessage; onPin: (v: boolean) => void; children: ReactElement }) {
  const ctx = useChat();
  const toggle = useMessages((st) => st.toggleReaction);
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        onPin(v);
      }}
      side="top"
      align="end"
      bare
      label="Реакция"
      trigger={children}
    >
      <EmojiPicker
        onPick={(e) => {
          rememberEmoji(e.name);
          setOpen(false);
          onPin(false);
          const mine = m.reactions.some((r) => r.emoji === e.name && r.userIds.includes(ctx.boot.me.id));
          if (!mine) void toggle(m.id, e.name, ctx.boot.me.id);
        }}
      />
    </Popover>
  );
}

function Actions({
  message: m,
  place,
  editable,
  deletable,
  onPin,
  onEdit,
  onDelete,
}: {
  message: ChatMessage;
  place: Place;
  editable: boolean;
  deletable: boolean;
  onPin: (v: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const ctx = useChat();
  const index = useEmoji((st) => st.index);
  const recent = useRecentEmoji((st) => st.names).slice(0, 3);
  const toggle = useMessages((st) => st.toggleReaction);
  const me = ctx.boot.me.id;
  const canReact = ctx.conv.isMember && m.subtype === null;
  const canThread = place === "feed" && m.subtype === null && !m.parentId && ctx.conv.isMember;

  const menu: MenuEntry[] = [
    ...(editable ? [{ kind: "item" as const, label: "Изменить", icon: <Pencil />, kbd: "↑", onSelect: onEdit }] : []),
    {
      kind: "item",
      label: "Скопировать ссылку",
      icon: <Link2 />,
      onSelect: () =>
        void navigator.clipboard.writeText(messageLink(m)).then(
          () => toast("Ссылка на сообщение скопирована"),
          () => toast("Не удалось скопировать ссылку", "error"),
        ),
    },
    ...(deletable
      ? [{ kind: "separator" as const }, { kind: "item" as const, label: "Удалить", icon: <Trash2 />, danger: true, opensDialog: true, onSelect: onDelete }]
      : []),
  ];

  return (
    <div className={ms.actions} role="toolbar" aria-label="Действия с сообщением">
      {canReact &&
        recent.map((name) => {
          const char = emojiChar(index, name);
          const mine = m.reactions.some((r) => r.emoji === name && r.userIds.includes(me));
          return (
            <button
              key={name}
              type="button"
              className={ms.quickReaction}
              aria-label={`${mine ? "Убрать реакцию" : "Реакция"} ${char}`}
              aria-pressed={mine}
              onClick={() => {
                rememberEmoji(name);
                void toggle(m.id, name, me);
              }}
            >
              {char}
            </button>
          );
        })}
      {canReact && <span className={ms.actionsDivider} />}
      {canReact && (
        <ReactionPicker message={m} onPin={onPin}>
          <IconButton label="Добавить реакцию" size="xs">
            <SmilePlus />
          </IconButton>
        </ReactionPicker>
      )}
      {canThread && (
        <IconButton label="Ответить в треде" size="xs" onClick={() => ctx.openThread(m.id)}>
          <MessageSquareText />
        </IconButton>
      )}
      <Menu
        onOpenChange={onPin}
        trigger={
          <IconButton label="Ещё" size="xs">
            <Ellipsis />
          </IconButton>
        }
        items={menu}
      />
    </div>
  );
}

function DeleteDialog({ message: m, onClose }: { message: ChatMessage; onClose: () => void }) {
  const ctx = useChat();
  const remove = useMessages((st) => st.remove);
  const [busy, setBusy] = useState(false);
  const names = { user: (id: string) => userName(ctx.boot, id), channel: (id: string) => ctx.boot.conversations.find((c) => c.id === id)?.name ?? "канал" };
  const preview = markupToPlainText(m.text, names);
  const others = m.userId !== ctx.boot.me.id;
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="Удалить сообщение?"
      description={
        m.replyCount > 0
          ? "Ответы в треде останутся, а вместо сообщения будет пометка «Сообщение удалено»."
          : others
            ? `Это сообщение ${displayOf(ctx.boot.users.find((u) => u.id === m.userId) ?? ctx.boot.me)}. Вернуть его не получится.`
            : "Вернуть его не получится."
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await remove(m.id);
              setBusy(false);
              onClose();
            }}
          >
            Удалить
          </Button>
        </>
      }
    >
      <blockquote className={s.deletePreview}>{preview.length > 300 ? `${preview.slice(0, 300)}…` : preview || "Пустое сообщение"}</blockquote>
    </Dialog>
  );
}

// Системные строки ленты: вход, выход, тема, описание, название.
function systemLine(m: ChatMessage, author: string) {
  switch (m.subtype) {
    case "join":
      return <SystemMessage icon={<LogIn />}>{author} теперь в канале</SystemMessage>;
    case "leave":
      return <SystemMessage icon={<LogOut />}>{author} вышел(а) из канала</SystemMessage>;
    case "topic":
      return <SystemMessage icon={<Pencil />}>{m.text ? `${author} сменил(а) тему: «${m.text}»` : `${author} убрал(а) тему`}</SystemMessage>;
    case "purpose":
      return <SystemMessage icon={<Pencil />}>{m.text ? `${author} обновил(а) описание: «${m.text}»` : `${author} убрал(а) описание`}</SystemMessage>;
    case "rename":
      return <SystemMessage icon={<Pencil />}>{`${author} переименовал(а) канал в #${m.text}`}</SystemMessage>;
    default:
      return null;
  }
}

export const replyCountLabel = (n: number) => plural(n, "ответ", "ответа", "ответов");
