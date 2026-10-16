// Ленты сообщений по разговорам + неотправленные сообщения. Серверные данные приходят
// и из HTTP (страницы истории, ответ на отправку), и из событий — всё сливается по id.
import { create } from "zustand";
import { MESSAGES_PAGE_SIZE, type MessageDto, type MessagesPageDto } from "@teamchat/shared";
import { api } from "../api/http";

export type ChatMessage = MessageDto & { local?: "sending" | "failed" };

type Feed = {
  items: ChatMessage[]; // по возрастанию seq, неотправленные — в конце
  loaded: boolean;
  hasMoreBefore: boolean;
  loadingBefore: boolean;
  error: string | null;
};

const emptyFeed: Feed = { items: [], loaded: false, hasMoreBefore: false, loadingBefore: false, error: null };
// Неотправленные стоят после всех серверных, в порядке отправки.
let pendingOrder = Number.MAX_SAFE_INTEGER - 1_000_000;

function merge(items: ChatMessage[], incoming: MessageDto[]): ChatMessage[] {
  const byClientId = new Map(incoming.filter((m) => m.clientMsgId).map((m) => [m.clientMsgId, m]));
  const ids = new Set(incoming.map((m) => m.id));
  const kept = items.filter((m) => !ids.has(m.id) && !(m.local && byClientId.has(m.clientMsgId)));
  return [...kept, ...incoming].sort((a, b) => a.seq - b.seq);
}

type Store = {
  feeds: Record<string, Feed>;
  feed: (conversationId: string) => Feed;
  loadLatest: (conversationId: string) => Promise<void>;
  loadBefore: (conversationId: string) => Promise<void>;
  receive: (message: MessageDto) => void;
  send: (conversationId: string, userId: string, text: string) => Promise<void>;
  retry: (conversationId: string, clientMsgId: string) => Promise<void>;
  discard: (conversationId: string, clientMsgId: string) => void;
  reset: () => void;
};

export const useMessages = create<Store>((set, get) => {
  const patch = (id: string, fn: (f: Feed) => Feed) =>
    set((s) => ({ feeds: { ...s.feeds, [id]: fn(s.feeds[id] ?? emptyFeed) } }));

  async function post(conversationId: string, message: ChatMessage) {
    try {
      const saved = await api<MessageDto>(`/conversations/${conversationId}/messages`, {
        method: "POST",
        body: { clientMsgId: message.clientMsgId, text: message.text },
      });
      get().receive(saved);
    } catch {
      patch(conversationId, (f) => ({
        ...f,
        items: f.items.map((m) => (m.id === message.id ? { ...m, local: "failed" as const } : m)),
      }));
    }
  }

  return {
    feeds: {},
    feed: (id) => get().feeds[id] ?? emptyFeed,

    async loadLatest(id) {
      try {
        const page = await api<MessagesPageDto>(`/conversations/${id}/messages?limit=${MESSAGES_PAGE_SIZE}`);
        patch(id, (f) => ({ ...f, items: merge(f.items, page.messages), loaded: true, hasMoreBefore: page.hasMore, error: null }));
      } catch (err) {
        patch(id, (f) => ({ ...f, error: err instanceof Error ? err.message : "Не удалось загрузить сообщения" }));
      }
    },

    async loadBefore(id) {
      const f = get().feed(id);
      const oldest = f.items.find((m) => !m.local);
      if (!f.loaded || !f.hasMoreBefore || f.loadingBefore || !oldest) return;
      patch(id, (x) => ({ ...x, loadingBefore: true }));
      try {
        const page = await api<MessagesPageDto>(`/conversations/${id}/messages?limit=${MESSAGES_PAGE_SIZE}&before=${oldest.seq}`);
        patch(id, (x) => ({ ...x, items: merge(x.items, page.messages), hasMoreBefore: page.hasMore, loadingBefore: false }));
      } catch {
        patch(id, (x) => ({ ...x, loadingBefore: false }));
      }
    },

    receive(message) {
      const f = get().feeds[message.conversationId];
      if (!f?.loaded) return; // ленту загрузим целиком, когда её откроют
      patch(message.conversationId, (x) => ({ ...x, items: merge(x.items, [message]) }));
    },

    async send(conversationId, userId, text) {
      const clientMsgId = crypto.randomUUID();
      const message: ChatMessage = {
        id: clientMsgId,
        seq: ++pendingOrder,
        conversationId,
        userId,
        clientMsgId,
        subtype: null,
        text,
        createdAt: new Date().toISOString(),
        editedAt: null,
        local: "sending",
      };
      patch(conversationId, (f) => ({ ...f, items: [...f.items, message] }));
      await post(conversationId, message);
    },

    async retry(conversationId, clientMsgId) {
      const message = get().feed(conversationId).items.find((m) => m.local && m.clientMsgId === clientMsgId);
      if (!message) return;
      patch(conversationId, (f) => ({
        ...f,
        items: f.items.map((m) => (m.id === message.id ? { ...m, local: "sending" as const } : m)),
      }));
      await post(conversationId, message);
    },

    discard(conversationId, clientMsgId) {
      patch(conversationId, (f) => ({ ...f, items: f.items.filter((m) => !(m.local && m.clientMsgId === clientMsgId)) }));
    },

    reset: () => set({ feeds: {} }),
  };
});
