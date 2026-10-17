// S07 — панель треда справа: родитель, «N ответов», ответы, композер с «Также отправить в канал».
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Bell, BellOff, MessageSquareOff, X } from "lucide-react";
import { api } from "../api/http";
import { useMessages } from "../data/messages";
import { RichEditor } from "../editor/RichEditor";
import { plural } from "../lib/format";
import { EmptyState, Skeleton } from "../ui/Feedback";
import { IconButton } from "../ui/IconButton";
import { Checkbox } from "../ui/Toggle";
import { useChat } from "./context";
import { MessageRow } from "./MessageRow";
import s from "./ThreadPanel.module.scss";

export function ThreadPanel({ parentId, onClose }: { parentId: string; onClose: () => void }) {
  const ctx = useChat();
  const { boot, conv } = ctx;
  const thread = useMessages((st) => st.threads[parentId]);
  const loadThread = useMessages((st) => st.loadThread);
  const send = useMessages((st) => st.send);
  const setSubscribed = useMessages((st) => st.setSubscribed);
  const [alsoInChannel, setAlsoInChannel] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const scrolledToFocus = useRef(false);

  useEffect(() => {
    void loadThread(conv.id, parentId);
  }, [conv.id, parentId, loadThread]);

  const items = thread?.items ?? [];
  const lastSeq = items.filter((m) => !m.local).at(-1)?.seq ?? 0;

  // Всё в открытом треде прочитано: курсор пригодится виду «Треды».
  useEffect(() => {
    if (!thread?.loaded || !conv.isMember || lastSeq === 0) return;
    const t = setTimeout(() => void api(`/threads/${parentId}/read`, { method: "POST", body: { seq: lastSeq } }).catch(() => undefined), 800);
    return () => clearTimeout(t);
  }, [thread?.loaded, conv.isMember, parentId, lastSeq]);

  // Прокрутка: к подсвеченному ответу при переходе по ссылке, иначе вниз, если человек был внизу.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !thread?.loaded) return;
    const focus = ctx.highlightId ? el.querySelector<HTMLElement>(`[data-id="${ctx.highlightId}"]`) : null;
    if (focus && !scrolledToFocus.current) {
      focus.scrollIntoView({ block: "center" });
      scrolledToFocus.current = true;
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [items, thread?.loaded, ctx.highlightId]);

  const where = conv.name ? `#${conv.name}` : "переписку";
  const parent = thread?.parent;
  const canReply = ctx.canPost && !!parent && !parent.deleted && parent.subtype === null;

  return (
    <aside
      className={s.panel}
      aria-label="Тред"
      onKeyDown={(e) => {
        // Esc закрывает тред, если его не забрали раньше (правка, подсказки, меню).
        if (e.key === "Escape" && !e.defaultPrevented) onClose();
      }}
    >
      <header className={s.header}>
        <div className={s.titles}>
          <h2 className={s.title}>Тред</h2>
          <span className={s.caption}>{conv.name ? `#${conv.name}` : "личная переписка"}</span>
        </div>
        {thread?.loaded && conv.isMember && (
          <IconButton
            label={thread.subscribed ? "Не следить за тредом" : "Следить за тредом"}
            size="s"
            pressed={thread.subscribed}
            onClick={() => void setSubscribed(parentId, !thread.subscribed)}
          >
            {thread.subscribed ? <Bell /> : <BellOff />}
          </IconButton>
        )}
        <IconButton label="Закрыть тред" shortcut="Esc" size="s" onClick={onClose}>
          <X />
        </IconButton>
      </header>

      <div
        ref={scroller}
        className={s.body}
        onScroll={() => {
          const el = scroller.current;
          if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        role="log"
        aria-label="Ответы в треде"
      >
        {thread?.error && !thread.loaded && <EmptyState icon={<MessageSquareOff />} title="Тред не открылся" text={thread.error} />}
        {!thread?.loaded && !thread?.error && (
          <div className={s.skeleton} aria-busy="true">
            <Skeleton width={180} height={12} />
            <Skeleton width={280} height={12} />
          </div>
        )}
        {parent && <MessageRow message={parent} place="parent" />}
        {thread?.loaded && (
          <div className={s.divider} role="separator">
            <span>{items.length > 0 ? plural(items.length, "ответ", "ответа", "ответов") : "Ответов пока нет"}</span>
          </div>
        )}
        {items.map((m, i) => (
          <MessageRow key={m.clientMsgId ?? m.id} message={m} prev={items[i - 1]} place="thread" />
        ))}
      </div>

      {canReply ? (
        <RichEditor
          key={parentId}
          variant="thread"
          placeholder="Ответить в треде…"
          sources={ctx.sources}
          onSubmit={(markup) => {
            atBottom.current = true;
            void send(conv.id, boot.me.id, markup, { parentId, alsoInChannel });
            setAlsoInChannel(false);
          }}
          onEditLast={() => {
            const mine = [...items].reverse().find((m) => m.userId === boot.me.id && !m.local && !m.deleted);
            if (mine) ctx.setEditing({ id: mine.id, where: "thread" });
          }}
          below={
            <div className={s.also}>
              <Checkbox label={`Также отправить в ${where}`} checked={alsoInChannel} onCheckedChange={setAlsoInChannel} />
            </div>
          }
        />
      ) : (
        thread?.loaded && (
          <p className={s.readonly}>
            {parent?.deleted ? "Сообщение удалено — новые ответы в этот тред не принимаются" : "Чтобы ответить, вступите в канал"}
          </p>
        )
      )}
    </aside>
  );
}
