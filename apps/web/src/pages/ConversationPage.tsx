// S05/S06 — канал или личная переписка: шапка, лента, композер.
// Открытый канал можно смотреть до вступления; прочтение отмечается, когда низ ленты виден и окно в фокусе.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Hash, Lock, MessageCircle, MessageCircleQuestion, NotebookPen, Users } from "lucide-react";
import { isChannelKind, type BootDto, type ConversationDto } from "@teamchat/shared";
import { api } from "../api/http";
import { ChannelDetailsDialog } from "../channels/ChannelDetailsDialog";
import { ComposerInput, type Mentionable } from "../chat/ComposerInput";
import { ConversationHeader } from "../chat/ConversationHeader";
import { MessageList } from "../chat/MessageList";
import { displayOf, isOnline, updateConversation, useBoot, userName } from "../data/boot";
import { conversationTitle, dmPeople, isSelfDm, joinChannel, openDm } from "../data/conversations";
import { useMessages } from "../data/messages";
import { plural } from "../lib/format";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/Feedback";
import s from "./ConversationPage.module.scss";

const READ_DEBOUNCE_MS = 1000;

export function ConversationPage() {
  const { conversationId = "" } = useParams();
  const boot = useBoot().data;
  const known = boot?.conversations.find((c) => c.id === conversationId);
  // Не участник (заглянул из каталога): данные канала берём отдельным запросом.
  const outside = useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: () => api<ConversationDto>(`/conversations/${conversationId}`),
    enabled: !!boot && !known,
    retry: false,
  });
  const conv = known ?? outside.data;

  if (!boot) return null;
  if (!conv) {
    if (!known && outside.isPending) return null;
    return (
      <div className={s.missing}>
        <EmptyState icon={<MessageCircleQuestion />} title="Разговор не найден" text="Возможно, его удалили или вас в нём больше нет. Выберите разговор слева" />
      </div>
    );
  }
  return <Conversation key={conv.id} boot={boot} conv={conv} />;
}

function Conversation({ boot, conv }: { boot: BootDto; conv: ConversationDto }) {
  const navigate = useNavigate();
  const feed = useMessages((st) => st.feeds[conv.id]);
  const loadLatest = useMessages((st) => st.loadLatest);
  const send = useMessages((st) => st.send);
  const [atBottom, setAtBottom] = useState(true);
  const [details, setDetails] = useState<"about" | "members" | null>(null);
  const [joining, setJoining] = useState(false);
  // «Новые» считаются от курсора на момент открытия и не прыгают, пока человек читает.
  const [unreadAfterSeq] = useState(conv.isMember ? conv.lastReadSeq : Number.MAX_SAFE_INTEGER);
  const readTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Лента сбрасывается при вступлении (до него события канала не приходили) — тогда грузим заново.
  const loaded = feed?.loaded ?? false;
  useEffect(() => {
    if (!loaded) void loadLatest(conv.id);
  }, [conv.id, loaded, loadLatest]);

  const latestSeq = feed?.items.filter((m) => !m.local).at(-1)?.seq ?? 0;
  const needsRead = conv.isMember && latestSeq > conv.lastReadSeq;

  const markRead = useCallback(() => {
    if (!needsRead || !atBottom || document.visibilityState !== "visible" || !document.hasFocus()) return;
    clearTimeout(readTimer.current);
    readTimer.current = setTimeout(() => {
      updateConversation(conv.id, (c) => ({ ...c, lastReadSeq: Math.max(c.lastReadSeq, latestSeq), unreadCount: 0, mentionCount: 0 }));
      void api(`/conversations/${conv.id}/read`, { method: "POST", body: { seq: latestSeq } }).catch(() => undefined);
    }, READ_DEBOUNCE_MS);
  }, [conv.id, needsRead, atBottom, latestSeq]);

  useEffect(() => {
    markRead();
    window.addEventListener("focus", markRead);
    document.addEventListener("visibilitychange", markRead);
    return () => {
      window.removeEventListener("focus", markRead);
      document.removeEventListener("visibilitychange", markRead);
    };
  }, [markRead]);
  useEffect(() => () => clearTimeout(readTimer.current), []);

  const channel = isChannelKind(conv.kind);
  const title = conversationTitle(boot, conv);
  const people = channel ? [] : dmPeople(boot, conv);
  const self = isSelfDm(boot, conv);

  // Кого можно упомянуть: сначала участники разговора, потом остальные; @here/@channel — только в каналах.
  const mentionables = useMemo<Mentionable[]>(() => {
    const members = new Set(conv.memberIds);
    const users = boot.users
      .filter((u) => !u.deactivated && u.id !== boot.me.id)
      .sort((a, b) => Number(members.has(b.id)) - Number(members.has(a.id)) || displayOf(a).localeCompare(displayOf(b)))
      .map<Mentionable>((u) => ({
        kind: "user",
        id: u.id,
        label: displayOf(u),
        hint: members.has(u.id) ? u.title || u.realName : channel ? "не в канале" : u.title,
      }));
    if (!channel) return users;
    return [
      ...users,
      { kind: "here", label: "here", hint: "все, кто сейчас в сети" },
      { kind: "channel", label: "channel", hint: "все участники канала" },
    ];
  }, [boot.users, boot.me.id, conv.memberIds, channel]);

  const header = channel ? (
    <ConversationHeader
      name={conv.name ?? ""}
      icon={conv.kind === "private" ? <Lock /> : <Hash />}
      topic={conv.topic || conv.purpose}
      members={conv.memberIds.map((id) => userName(boot, id))}
      onDetails={conv.isMember ? () => setDetails("about") : undefined}
      onMembers={conv.isMember ? () => setDetails("members") : undefined}
    />
  ) : (
    <ConversationHeader
      name={self ? `${title} (вы)` : title}
      icon={
        conv.kind === "group_dm" ? (
          <Users />
        ) : people[0] ? (
          <Avatar name={displayOf(people[0])} id={people[0].id} size="m" presence={isOnline(boot, people[0].id) ? "active" : "away"} decorative />
        ) : undefined
      }
      topic={conv.kind === "group_dm" ? plural(conv.memberIds.length, "участник", "участника", "участников") : (people[0]?.title ?? "")}
    />
  );

  const intro = channel
    ? {
        icon: conv.kind === "private" ? <Lock /> : <Hash />,
        title: `Это начало #${conv.name}`,
        text: conv.purpose || "Здесь вся история канала: дальше в прошлое ничего нет",
      }
    : self
      ? { icon: <NotebookPen />, title: "Ваше личное место", text: "Заметки, ссылки и черновики для себя. Никто, кроме вас, это не видит" }
      : { icon: <MessageCircle />, title: `Это начало переписки: ${title}`, text: "Её видят только участники этой переписки" };

  async function join() {
    setJoining(true);
    try {
      await joinChannel(conv.id);
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className={s.page}>
      {header}
      <MessageList
        conversationId={conv.id}
        title={title}
        boot={boot}
        unreadAfterSeq={unreadAfterSeq}
        onAtBottomChange={setAtBottom}
        intro={intro}
        onMessageUser={(userId) => void openDm([userId]).then((c) => navigate(`/c/${c.id}`))}
      />
      {conv.isMember ? (
        <ComposerInput
          placeholder={channel ? `Сообщение в #${conv.name}` : `Сообщение: ${title}`}
          disabledReason={conv.archived ? "Канал в архиве, писать сюда нельзя" : undefined}
          mentionables={mentionables}
          onSend={(text) => void send(conv.id, boot.me.id, text)}
        />
      ) : (
        <div className={s.joinBar}>
          <span>
            Вы смотрите <strong>#{conv.name}</strong>. Чтобы писать, вступите в канал.
          </span>
          {!conv.archived && (
            <Button onClick={() => void join()} loading={joining}>
              Вступить в канал
            </Button>
          )}
        </div>
      )}
      {channel && conv.isMember && (
        <ChannelDetailsDialog boot={boot} conv={conv} open={details !== null} onOpenChange={(v) => !v && setDetails(null)} initialTab={details ?? "about"} />
      )}
    </div>
  );
}
