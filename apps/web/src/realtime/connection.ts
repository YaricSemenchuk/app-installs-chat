// Одно WebSocket-соединение на вкладку. После каждого (пере)подключения — hello с курсором журнала,
// сервер досылает пропущенное. События применяются идемпотентно, повтор не вредит.
import { io, type Socket } from "socket.io-client";
import { create } from "zustand";
import {
  NOTIFICATION_EVENT,
  CALL_EVENT,
  TASKS_EVENT,
  type CallEventDto,
  type TasksEventDto,
  SOCKET_PATH,
  type BootDto,
  type ConversationDto,
  type EventDto,
  type NotificationDto,
  type PresenceEventDto,
} from "@teamchat/shared";
import { handleNotification } from "../notifications/notify";
import { applyCallEvent, loadCalls } from "../calls/store";
import { api } from "../api/http";
import { adminUsersKey, bootKey, getBoot, queryClient, updateBoot, updateConversation, upsertUser } from "../data/boot";

const ACTIVE_EVERY_MS = 60_000;
import { useMessages } from "../data/messages";
import { refreshChannelTasks } from "../data/tasks";

export type ConnectionStatus = "connecting" | "online" | "reconnecting" | "offline" | "restored";

export const useConnection = create<{ status: ConnectionStatus }>(() => ({ status: "connecting" }));
const setStatus = (status: ConnectionStatus) => useConnection.setState({ status });

// Публикация событий на сервере идёт после коммита и может слегка перепутать порядок,
// поэтому при догрузке берём запас назад, а дубли отсекаем по id.
const REPLAY_OVERLAP = 100;
const SEEN_LIMIT = 5000;

let socket: Socket | null = null;
let watermark = 0;
const seen = new Set<number>();
let restoredTimer: ReturnType<typeof setTimeout> | undefined;
let wasOnline = false;

function markSeen(id: number) {
  seen.add(id);
  if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value as number);
  watermark = Math.max(watermark, id);
}

// Правка и удаление могут добавить или снять непрочитанное упоминание — точные счётчики берём у сервера.
const countsTimers = new Map<string, ReturnType<typeof setTimeout>>();
function refreshCounts(conversationId: string) {
  clearTimeout(countsTimers.get(conversationId));
  countsTimers.set(
    conversationId,
    setTimeout(() => {
      countsTimers.delete(conversationId);
      void api<ConversationDto>(`/conversations/${conversationId}`)
        .then((c) => updateConversation(conversationId, (x) => ({ ...x, unreadCount: c.unreadCount, mentionCount: c.mentionCount, latestSeq: c.latestSeq })))
        .catch(() => undefined);
    }, 300),
  );
}

const unreadFor = (conversationId: string, seq: number, userId: string, me: string | undefined) => {
  const c = getBoot()?.conversations.find((x) => x.id === conversationId);
  return !!c && userId !== me && seq > c.lastReadSeq;
};

function apply(ev: EventDto) {
  if (seen.has(ev.id)) return;
  markSeen(ev.id);
  const me = getBoot()?.me.id;

  switch (ev.kind) {
    case "message.created": {
      const m = ev.payload;
      useMessages.getState().receive(m);
      // ЛС, которое собеседник только что открыл, нам ещё не известно — подтягиваем список.
      if (!getBoot()?.conversations.some((c) => c.id === m.conversationId)) {
        void queryClient.invalidateQueries({ queryKey: bootKey });
        break;
      }
      // Ответ только в треде счётчики разговора не трогает.
      if (m.parentId && !m.alsoInChannel) break;
      updateConversation(m.conversationId, (c) => {
        const latestSeq = Math.max(c.latestSeq, m.seq);
        if (m.userId === me) return { ...c, latestSeq, lastReadSeq: Math.max(c.lastReadSeq, m.seq) };
        // Считаем только то, чего boot ещё не знал: повтор при догрузке не удваивает счётчики.
        const fresh = m.seq > c.lastReadSeq && m.seq > c.latestSeq;
        const unread = fresh && m.subtype === null ? 1 : 0;
        const mention = fresh && me !== undefined && m.mentions.includes(me) ? 1 : 0;
        return { ...c, latestSeq, unreadCount: c.unreadCount + unread, mentionCount: c.mentionCount + mention };
      });
      break;
    }
    case "message.updated": {
      const m = ev.payload;
      useMessages.getState().applyUpdate(m);
      if ((!m.parentId || m.alsoInChannel) && unreadFor(m.conversationId, m.seq, m.userId, me)) refreshCounts(m.conversationId);
      break;
    }
    case "message.deleted": {
      const d = ev.payload;
      useMessages.getState().applyDelete(d);
      if (unreadFor(d.conversationId, d.seq, d.userId, me)) refreshCounts(d.conversationId);
      break;
    }
    case "thread.updated":
      useMessages.getState().applySummary(ev.payload);
      break;
    case "reaction.added":
    case "reaction.removed":
      useMessages.getState().applyReaction(ev.payload, ev.kind === "reaction.added");
      break;
    case "preferences.updated":
      updateBoot((b) => ({ ...b, preferences: ev.payload }));
      break;
    case "conversation.updated":
      updateConversation(ev.payload.id, (c) => ({ ...c, ...ev.payload }));
      break;
    case "read.updated": {
      const { conversationId, lastReadSeq } = ev.payload;
      updateConversation(conversationId, (c) => {
        if (lastReadSeq <= c.lastReadSeq) return c;
        const all = lastReadSeq >= c.latestSeq;
        return { ...c, lastReadSeq, unreadCount: all ? 0 : c.unreadCount, mentionCount: all ? 0 : c.mentionCount };
      });
      break;
    }
    case "user.created":
    case "user.updated":
      upsertUser(ev.payload);
      if (ev.payload.id === me) updateBoot((b) => ({ ...b, me: ev.payload }));
      void queryClient.invalidateQueries({ queryKey: adminUsersKey });
      break;
    case "member.left": {
      const { conversationId, userId } = ev.payload;
      if (userId === me) updateBoot((b) => ({ ...b, conversations: b.conversations.filter((c) => c.id !== conversationId) }));
      else updateConversation(conversationId, (c) => ({ ...c, memberIds: c.memberIds.filter((id) => id !== userId) }));
      break;
    }
    case "member.joined": {
      const { conversationId, userId } = ev.payload;
      const known = getBoot()?.conversations.some((c) => c.id === conversationId);
      if (!known && userId === me) void queryClient.invalidateQueries({ queryKey: bootKey });
      else
        updateConversation(conversationId, (c) =>
          c.memberIds.includes(userId) ? c : { ...c, memberIds: [...c.memberIds, userId] },
        );
      break;
    }
  }
}

async function resync() {
  seen.clear();
  useMessages.getState().reset();
  const boot = await queryClient.query({ queryKey: bootKey, queryFn: () => api<BootDto>("/boot"), staleTime: 0 });
  watermark = boot.lastEventId;
}

export function startRealtime(initialEventId: number, onUnauthorized: () => void): () => void {
  if (socket) return stopRealtime;
  watermark = initialEventId;
  setStatus("connecting");

  socket = io({ path: SOCKET_PATH, transports: ["websocket"], withCredentials: true });
  socket.on("connect", () => socket?.emit("hello", { lastEventId: Math.max(0, watermark - REPLAY_OVERLAP) }));
  socket.on("events", (batch: EventDto[]) => batch.forEach(apply));
  socket.on(NOTIFICATION_EVENT, (n: NotificationDto) => handleNotification(n));
  socket.on(CALL_EVENT, (e: CallEventDto) => applyCallEvent(e));
  socket.on(TASKS_EVENT, (e: TasksEventDto) => refreshChannelTasks(e.conversationId));
  socket.on("synced", () => {
    // Звонки эфемерны и в журнал не попадают: после (пере)подключения читаем их заново.
    void loadCalls();
    clearTimeout(restoredTimer);
    if (wasOnline) {
      setStatus("restored");
      restoredTimer = setTimeout(() => setStatus("online"), 2000);
    } else setStatus("online");
    wasOnline = true;
  });
  socket.on("resync", () => void resync().then(() => socket?.emit("hello", { lastEventId: watermark })));
  socket.on("presence", ({ userId, presence }: PresenceEventDto) => {
    updateBoot((b) => {
      const next = { ...b.presence };
      if (presence === "active") next[userId] = "active";
      else delete next[userId];
      return { ...b, presence: next };
    });
  });
  socket.on("unauthorized", onUnauthorized);
  socket.on("disconnect", (reason) => {
    if (reason === "io server disconnect") {
      // сервер закрыл сессию (выход, деактивация) — сам не переподключаемся
      onUnauthorized();
      return;
    }
    setStatus(navigator.onLine ? "reconnecting" : "offline");
  });
  socket.io.on("reconnect_attempt", () => setStatus(navigator.onLine ? "reconnecting" : "offline"));

  const offline = () => setStatus("offline");
  const online = () => {
    setStatus("reconnecting");
    socket?.connect();
  };
  window.addEventListener("offline", offline);
  window.addEventListener("online", online);

  // «Человек здесь»: любое действие в окне, но не чаще раза в минуту — сервер держит «в сети».
  let lastActive = 0;
  const activity = () => {
    if (!socket?.connected || !document.hasFocus() || Date.now() - lastActive < ACTIVE_EVERY_MS) return;
    lastActive = Date.now();
    socket.emit("active");
  };
  const activityEvents = ["pointerdown", "keydown", "focus", "pointermove"] as const;
  activityEvents.forEach((e) => window.addEventListener(e, activity, { passive: true }));

  // Для ручной проверки обрыва в разработке: window.__chatSocket.disconnect() / .connect()
  if (import.meta.env.DEV) (window as unknown as { __chatSocket?: Socket }).__chatSocket = socket;

  return () => {
    window.removeEventListener("offline", offline);
    window.removeEventListener("online", online);
    activityEvents.forEach((e) => window.removeEventListener(e, activity));
    stopRealtime();
  };
}

export function stopRealtime() {
  socket?.removeAllListeners();
  socket?.io.removeAllListeners();
  socket?.disconnect();
  socket = null;
  seen.clear();
  wasOnline = false;
}
