// S05 — канал: шапка, лента, композер. Прочтение отмечается, когда низ ленты виден и окно в фокусе.
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { MessageCircleQuestion } from "lucide-react";
import { api } from "../api/http";
import { ComposerInput } from "../chat/ComposerInput";
import { ConversationHeader } from "../chat/ConversationHeader";
import { MessageList } from "../chat/MessageList";
import { updateConversation, useBoot, userName } from "../data/boot";
import { useMessages } from "../data/messages";
import { EmptyState } from "../ui/Feedback";
import s from "./ConversationPage.module.scss";

const READ_DEBOUNCE_MS = 1000;

export function ConversationPage() {
  const { conversationId = "" } = useParams();
  const boot = useBoot().data;
  const conv = boot?.conversations.find((c) => c.id === conversationId);
  const feed = useMessages((st) => st.feeds[conversationId]);
  const loadLatest = useMessages((st) => st.loadLatest);
  const send = useMessages((st) => st.send);
  const [atBottom, setAtBottom] = useState(true);
  // «Новые» считаются от курсора на момент открытия и не прыгают, пока человек читает.
  const [unreadAfterSeq, setUnreadAfterSeq] = useState(conv?.lastReadSeq ?? 0);
  const readTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setUnreadAfterSeq(conv?.lastReadSeq ?? 0);
    setAtBottom(true);
    if (!useMessages.getState().feeds[conversationId]?.loaded) void loadLatest(conversationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  const latestSeq = feed?.items.filter((m) => !m.local).at(-1)?.seq ?? 0;
  const needsRead = !!conv && latestSeq > conv.lastReadSeq;

  const markRead = useCallback(() => {
    if (!conv || !needsRead || !atBottom || document.visibilityState !== "visible" || !document.hasFocus()) return;
    clearTimeout(readTimer.current);
    readTimer.current = setTimeout(() => {
      updateConversation(conv.id, (c) => ({ ...c, lastReadSeq: Math.max(c.lastReadSeq, latestSeq), unreadCount: 0 }));
      void api(`/conversations/${conv.id}/read`, { method: "POST", body: { seq: latestSeq } }).catch(() => undefined);
    }, READ_DEBOUNCE_MS);
  }, [conv, needsRead, atBottom, latestSeq]);

  useEffect(() => {
    markRead();
    window.addEventListener("focus", markRead);
    document.addEventListener("visibilitychange", markRead);
    return () => {
      window.removeEventListener("focus", markRead);
      document.removeEventListener("visibilitychange", markRead);
    };
  }, [markRead]);
  useEffect(() => () => clearTimeout(readTimer.current), [conversationId]);

  if (!boot) return null;
  if (!conv) {
    return (
      <div className={s.missing}>
        <EmptyState
          icon={<MessageCircleQuestion />}
          title="Разговор не найден"
          text="Возможно, его удалили или вас в нём больше нет. Выберите канал слева"
        />
      </div>
    );
  }

  const title = conv.kind === "public" || conv.kind === "private" ? `#${conv.name}` : "разговора";
  const members = conv.memberIds.map((id) => userName(boot, id));

  return (
    <div className={s.page}>
      <ConversationHeader name={conv.name ?? ""} topic={conv.topic || conv.purpose} members={members} />
      <MessageList
        key={conv.id}
        conversationId={conv.id}
        title={title}
        boot={boot}
        unreadAfterSeq={unreadAfterSeq}
        onAtBottomChange={setAtBottom}
      />
      <ComposerInput
        key={`composer-${conv.id}`}
        placeholder={`Сообщение в ${title}`}
        disabledReason={conv.archived ? "Канал в архиве, писать сюда нельзя" : undefined}
        onSend={(text) => void send(conv.id, boot.me.id, text)}
      />
    </div>
  );
}
