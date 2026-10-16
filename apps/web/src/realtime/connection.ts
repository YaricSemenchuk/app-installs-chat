// Одно WebSocket-соединение на вкладку. После каждого (пере)подключения — hello с курсором журнала,
// сервер досылает пропущенное. События применяются идемпотентно, повтор не вредит.
import { io, type Socket } from "socket.io-client";
import { create } from "zustand";
import { SOCKET_PATH, type BootDto, type EventDto } from "@teamchat/shared";
import { api } from "../api/http";
import { bootKey, getBoot, queryClient, updateConversation, upsertUser } from "../data/boot";
import { useMessages } from "../data/messages";

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

function apply(ev: EventDto) {
  if (seen.has(ev.id)) return;
  markSeen(ev.id);
  const me = getBoot()?.me.id;

  switch (ev.kind) {
    case "message.created": {
      const m = ev.payload;
      useMessages.getState().receive(m);
      updateConversation(m.conversationId, (c) => {
        const latestSeq = Math.max(c.latestSeq, m.seq);
        if (m.userId === me) return { ...c, latestSeq, lastReadSeq: Math.max(c.lastReadSeq, m.seq) };
        // Считаем только то, чего boot ещё не знал: повтор при догрузке не удваивает счётчик.
        const counts = m.subtype === null && m.seq > c.lastReadSeq && m.seq > c.latestSeq;
        return { ...c, latestSeq, unreadCount: c.unreadCount + (counts ? 1 : 0) };
      });
      break;
    }
    case "read.updated": {
      const { conversationId, lastReadSeq } = ev.payload;
      updateConversation(conversationId, (c) =>
        lastReadSeq <= c.lastReadSeq ? c : { ...c, lastReadSeq, unreadCount: lastReadSeq >= c.latestSeq ? 0 : c.unreadCount },
      );
      break;
    }
    case "user.created":
      upsertUser(ev.payload);
      break;
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
  socket.on("synced", () => {
    clearTimeout(restoredTimer);
    if (wasOnline) {
      setStatus("restored");
      restoredTimer = setTimeout(() => setStatus("online"), 2000);
    } else setStatus("online");
    wasOnline = true;
  });
  socket.on("resync", () => void resync().then(() => socket?.emit("hello", { lastEventId: watermark })));
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

  // Для ручной проверки обрыва в разработке: window.__chatSocket.disconnect() / .connect()
  if (import.meta.env.DEV) (window as unknown as { __chatSocket?: Socket }).__chatSocket = socket;

  return () => {
    window.removeEventListener("offline", offline);
    window.removeEventListener("online", online);
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
