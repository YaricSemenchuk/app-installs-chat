// S05/S06 — канал или личная переписка: шапка, лента, композер; справа — тред (S07).
// Тред открыт — ?thread=<id родителя>; ссылка на сообщение — ?m=<id>, страница сама найдёт и подсветит его.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Hash, Lock, MessageCircle, MessageCircleQuestion, NotebookPen, Users } from "lucide-react";
import {
  canStillEdit,
  isChannelKind,
  matchRank,
  type BootDto,
  type ConversationDto,
  type DirectoryChannelDto,
  type MessageLinkDto,
} from "@teamchat/shared";
import { api } from "../api/http";
import { ChannelDetailsDialog } from "../channels/ChannelDetailsDialog";
import { ChatContext, type ChatCtx, type Editing } from "../chat/context";
import { ConversationHeader } from "../chat/ConversationHeader";
import { MessageList } from "../chat/MessageList";
import { ThreadPanel } from "../chat/ThreadPanel";
import { displayOf, isOnline, queryClient, updateConversation, useBoot, userName } from "../data/boot";
import { conversationTitle, dmPeople, isSelfDm, joinChannel, openDm } from "../data/conversations";
import { useMessages } from "../data/messages";
import { RichEditor, type Sources } from "../editor/RichEditor";
import type { SuggestItem } from "../editor/extensions";
import { plural } from "../lib/format";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/Feedback";
import { toast } from "../ui/Toaster";
import s from "./ConversationPage.module.scss";

const READ_DEBOUNCE_MS = 1000;
const HIGHLIGHT_MS = 4000;
const MAX_SUGGESTIONS = 8;

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

// Кого и что можно вставить в композер: люди, @here/@channel, каналы.
function useSources(boot: BootDto, conv: ConversationDto): Sources {
  const channel = isChannelKind(conv.kind);
  const latest = useRef({ boot, conv });
  latest.current = { boot, conv };

  return useMemo<Sources>(
    () => ({
      people: (query) => {
        const { boot: b, conv: c } = latest.current;
        const members = new Set(c.memberIds);
        const users: SuggestItem[] = b.users
          .filter((u) => !u.deactivated && u.id !== b.me.id)
          .sort((x, y) => Number(members.has(y.id)) - Number(members.has(x.id)) || displayOf(x).localeCompare(displayOf(y)))
          .map((u) => ({
            kind: "user",
            id: u.id,
            label: displayOf(u),
            hint: members.has(u.id) ? u.title || u.realName : channel ? "не в канале" : u.title,
          }));
        const broadcast: SuggestItem[] = channel
          ? [
              { kind: "here", id: "here", label: "here", hint: "все, кто сейчас в сети" },
              { kind: "channel", id: "channel", label: "channel", hint: "все участники канала" },
            ]
          : [];
        return rank([...users, ...broadcast], query, (it) => [it.label, "hint" in it ? it.hint : undefined]);
      },
      channels: async (query) => {
        const { boot: b } = latest.current;
        const mine = b.conversations.filter((c) => isChannelKind(c.kind));
        const listed = await queryClient
          .query({
            queryKey: ["directory", ""],
            queryFn: () => api<DirectoryChannelDto[]>("/conversations/browse"),
            staleTime: 60_000,
          })
          .catch(() => [] as DirectoryChannelDto[]);
        const all = new Map<string, { id: string; name: string; private: boolean; purpose: string }>();
        for (const c of [...mine, ...listed]) {
          if (c.name && !c.archived) all.set(c.id, { id: c.id, name: c.name, private: c.kind === "private", purpose: c.purpose });
        }
        const items: SuggestItem[] = [...all.values()].map((c) => ({
          kind: "conversation",
          id: c.id,
          label: c.name,
          private: c.private,
          hint: c.purpose || undefined,
        }));
        return rank(items, query, (it) => [it.label]);
      },
      names: {
        user: (id) => userName(latest.current.boot, id),
        conversation: (id) => latest.current.boot.conversations.find((c) => c.id === id)?.name ?? "канал",
      },
    }),
    [channel],
  );
}

function rank<T>(items: T[], query: string, keys: (it: T) => (string | undefined)[]): T[] {
  return items
    .map((it) => {
      const ranks = keys(it)
        .filter((k): k is string => !!k)
        .map((k) => matchRank(k, query))
        .filter((r) => r >= 0);
      return { it, r: ranks.length ? Math.min(...ranks) : -1 };
    })
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r)
    .slice(0, MAX_SUGGESTIONS)
    .map((x) => x.it);
}

function Conversation({ boot, conv }: { boot: BootDto; conv: ConversationDto }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const threadId = params.get("thread");
  const linkTarget = params.get("m");
  const feed = useMessages((st) => st.feeds[conv.id]);
  const loadLatest = useMessages((st) => st.loadLatest);
  const send = useMessages((st) => st.send);
  const [atBottom, setAtBottom] = useState(true);
  const [details, setDetails] = useState<"about" | "members" | null>(null);
  const [joining, setJoining] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  // «Новые» считаются от курсора на момент открытия и не прыгают, пока человек читает.
  const [unreadAfterSeq] = useState(conv.isMember ? conv.lastReadSeq : Number.MAX_SAFE_INTEGER);
  const readTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sources = useSources(boot, conv);

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

  const highlight = useCallback((id: string) => {
    setHighlightId(id);
    setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), HIGHLIGHT_MS);
  }, []);

  const openThread = useCallback(
    (parentId: string, focusId?: string) => {
      setParams({ thread: parentId });
      if (focusId) highlight(focusId);
    },
    [setParams, highlight],
  );
  const closeThread = useCallback(() => setParams({}), [setParams]);

  // Ссылка на сообщение: тред — открываем его, лента — догружаем историю, пока сообщение не найдётся.
  useEffect(() => {
    if (!linkTarget) return;
    let cancelled = false;
    void (async () => {
      try {
        const link = await api<MessageLinkDto>(`/messages/${linkTarget}/link`);
        if (cancelled) return;
        if (link.conversationId !== conv.id) {
          navigate(`/c/${link.conversationId}?m=${linkTarget}`, { replace: true });
          return;
        }
        if (link.parentId) {
          setParams({ thread: link.parentId }, { replace: true });
          highlight(linkTarget);
          return;
        }
        const store = useMessages.getState();
        for (let i = 0; i < 60 && !cancelled; i++) {
          const f = store.feed(conv.id);
          if (f.loaded && (f.items.some((m) => m.id === linkTarget) || !f.hasMoreBefore)) break;
          if (!f.loaded) await store.loadLatest(conv.id);
          else if (f.loadingBefore) await new Promise((r) => setTimeout(r, 50));
          else await store.loadBefore(conv.id);
        }
        if (cancelled) return;
        highlight(linkTarget);
        setParams(threadId ? { thread: threadId } : {}, { replace: true });
      } catch {
        if (cancelled) return;
        toast("Сообщение не найдено: возможно, его удалили", "error");
        setParams({}, { replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkTarget, conv.id]);

  const channel = isChannelKind(conv.kind);
  const title = conversationTitle(boot, conv);
  const people = channel ? [] : dmPeople(boot, conv);
  const self = isSelfDm(boot, conv);
  const canPost = conv.isMember && !conv.archived;

  // ↑ в пустом поле — правка последнего своего сообщения, если окно правки ещё открыто.
  const editLast = useCallback(() => {
    const items = useMessages.getState().feed(conv.id).items;
    const mine = [...items]
      .reverse()
      .find((m) => m.userId === boot.me.id && !m.local && !m.deleted && m.subtype === null && !m.parentId);
    if (mine && canStillEdit(mine.createdAt, boot.workspace.messageEditWindowMinutes)) setEditing({ id: mine.id, where: "feed" });
  }, [conv.id, boot.me.id, boot.workspace.messageEditWindowMinutes]);

  const ctx: ChatCtx = {
    boot,
    conv,
    canPost,
    sources,
    editing,
    setEditing,
    highlightId,
    openThread,
    onMessageUser: (userId) => void openDm([userId]).then((c) => navigate(`/c/${c.id}`)),
  };

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
    <ChatContext.Provider value={ctx}>
      <div className={s.layout}>
        <div className={s.page}>
          {header}
          <MessageList
            conversationId={conv.id}
            title={title}
            boot={boot}
            unreadAfterSeq={unreadAfterSeq}
            onAtBottomChange={setAtBottom}
            intro={intro}
            focusId={highlightId}
          />
          {conv.isMember ? (
            <RichEditor
              placeholder={channel ? `Сообщение в #${conv.name}` : `Сообщение: ${title}`}
              disabledReason={conv.archived ? "Канал в архиве, писать сюда нельзя" : undefined}
              sources={sources}
              autoFocus={!threadId}
              onSubmit={(markup) => void send(conv.id, boot.me.id, markup)}
              onEditLast={editLast}
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
        </div>
        {threadId && <ThreadPanel key={threadId} parentId={threadId} onClose={closeThread} />}
      </div>
      {channel && conv.isMember && (
        <ChannelDetailsDialog boot={boot} conv={conv} open={details !== null} onOpenChange={(v) => !v && setDetails(null)} initialTab={details ?? "about"} />
      )}
    </ChatContext.Provider>
  );
}
