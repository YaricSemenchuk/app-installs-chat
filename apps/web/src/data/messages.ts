// Ленты разговоров и треды + неотправленные сообщения. Серверные данные приходят и из HTTP
// (страницы истории, ответы на действия), и из событий — всё сливается по id, повтор не вредит.
import { create } from "zustand";
import {
  MESSAGES_PAGE_SIZE,
  type FileDto,
  type MessageDeletedDto,
  type MessageDto,
  type MessagesPageDto,
  type ReactionEventDto,
  type RepliesPageDto,
  type ThreadSummaryDto,
} from "@teamchat/shared";
import { api } from "../api/http";
import { toast } from "../ui/Toaster";

export type ChatMessage = MessageDto & { local?: "sending" | "failed" };

type Feed = {
  items: ChatMessage[]; // по возрастанию seq, неотправленные — в конце
  loaded: boolean;
  hasMoreBefore: boolean;
  loadingBefore: boolean;
  error: string | null;
};

type Thread = {
  conversationId: string;
  parent: ChatMessage | null;
  items: ChatMessage[]; // ответы по возрастанию seq
  loaded: boolean;
  subscribed: boolean;
  error: string | null;
};

const emptyFeed: Feed = { items: [], loaded: false, hasMoreBefore: false, loadingBefore: false, error: null };
const emptyThread = (conversationId: string): Thread => ({
  conversationId,
  parent: null,
  items: [],
  loaded: false,
  subscribed: false,
  error: null,
});
// Неотправленные стоят после всех серверных, в порядке отправки.
let pendingOrder = Number.MAX_SAFE_INTEGER - 1_000_000;
const REPLIES_PAGE = 200;

function merge(items: ChatMessage[], incoming: MessageDto[]): ChatMessage[] {
  const byClientId = new Map(incoming.filter((m) => m.clientMsgId).map((m) => [m.clientMsgId, m]));
  const ids = new Set(incoming.map((m) => m.id));
  const kept = items.filter((m) => !ids.has(m.id) && !(m.local && byClientId.has(m.clientMsgId)));
  return [...kept, ...incoming].sort((a, b) => a.seq - b.seq);
}

const errorText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

type SendOptions = { parentId?: string; alsoInChannel?: boolean; files?: FileDto[] };

type Store = {
  feeds: Record<string, Feed>;
  threads: Record<string, Thread>; // по id родителя
  feed: (conversationId: string) => Feed;
  loadLatest: (conversationId: string) => Promise<void>;
  loadBefore: (conversationId: string) => Promise<void>;
  loadThread: (conversationId: string, parentId: string) => Promise<void>;
  find: (id: string) => ChatMessage | undefined;
  // события
  receive: (message: MessageDto) => void;
  applyUpdate: (message: MessageDto) => void;
  applyDelete: (payload: MessageDeletedDto) => void;
  applySummary: (summary: ThreadSummaryDto) => void;
  applyReaction: (ev: ReactionEventDto, added: boolean) => void;
  // действия
  send: (conversationId: string, userId: string, text: string, opts?: SendOptions) => Promise<void>;
  retry: (conversationId: string, clientMsgId: string) => Promise<void>;
  discard: (conversationId: string, clientMsgId: string) => void;
  edit: (id: string, text: string) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
  toggleReaction: (id: string, emoji: string, userId: string) => Promise<void>;
  setSubscribed: (parentId: string, subscribed: boolean) => Promise<void>;
  forget: (conversationId: string) => void;
  reset: () => void;
};

export const useMessages = create<Store>((set, get) => {
  const patchFeed = (id: string, fn: (f: Feed) => Feed) =>
    set((s) => ({ feeds: { ...s.feeds, [id]: fn(s.feeds[id] ?? emptyFeed) } }));
  const patchThread = (parentId: string, conversationId: string, fn: (t: Thread) => Thread) =>
    set((s) => ({ threads: { ...s.threads, [parentId]: fn(s.threads[parentId] ?? emptyThread(conversationId)) } }));

  // Одно и то же сообщение может лежать в ленте, родителем треда и ответом в треде.
  function patchMessage(id: string, fn: (m: ChatMessage) => ChatMessage | null) {
    set((s) => {
      const feeds = { ...s.feeds };
      for (const [cid, f] of Object.entries(s.feeds)) {
        if (!f.items.some((m) => m.id === id)) continue;
        feeds[cid] = { ...f, items: f.items.flatMap((m) => (m.id === id ? (fn(m) ?? []) : [m])) };
      }
      const threads = { ...s.threads };
      for (const [pid, t] of Object.entries(s.threads)) {
        const inItems = t.items.some((m) => m.id === id);
        if (t.parent?.id !== id && !inItems) continue;
        threads[pid] = {
          ...t,
          parent: t.parent?.id === id ? (fn(t.parent) ?? { ...t.parent, deleted: true, text: "" }) : t.parent,
          items: inItems ? t.items.flatMap((m) => (m.id === id ? (fn(m) ?? []) : [m])) : t.items,
        };
      }
      return { feeds, threads };
    });
  }

  async function post(message: ChatMessage) {
    try {
      const saved = await api<MessageDto>(`/conversations/${message.conversationId}/messages`, {
        method: "POST",
        body: {
          clientMsgId: message.clientMsgId,
          text: message.text,
          fileIds: message.files.map((f) => f.id),
          ...(message.parentId ? { parentId: message.parentId, alsoInChannel: message.alsoInChannel } : {}),
        },
      });
      get().receive(saved);
    } catch {
      patchMessage(message.id, (m) => ({ ...m, local: "failed" }));
    }
  }

  return {
    feeds: {},
    threads: {},
    feed: (id) => get().feeds[id] ?? emptyFeed,

    async loadLatest(id) {
      try {
        const page = await api<MessagesPageDto>(`/conversations/${id}/messages?limit=${MESSAGES_PAGE_SIZE}`);
        patchFeed(id, (f) => ({ ...f, items: merge(f.items, page.messages), loaded: true, hasMoreBefore: page.hasMore, error: null }));
      } catch (err) {
        patchFeed(id, (f) => ({ ...f, error: errorText(err, "Не удалось загрузить сообщения") }));
      }
    },

    async loadBefore(id) {
      const f = get().feed(id);
      const oldest = f.items.find((m) => !m.local);
      if (!f.loaded || !f.hasMoreBefore || f.loadingBefore || !oldest) return;
      patchFeed(id, (x) => ({ ...x, loadingBefore: true }));
      try {
        const page = await api<MessagesPageDto>(`/conversations/${id}/messages?limit=${MESSAGES_PAGE_SIZE}&before=${oldest.seq}`);
        patchFeed(id, (x) => ({ ...x, items: merge(x.items, page.messages), hasMoreBefore: page.hasMore, loadingBefore: false }));
      } catch {
        patchFeed(id, (x) => ({ ...x, loadingBefore: false }));
      }
    },

    // Тред целиком: ответы страницами по 200, пока не кончатся.
    async loadThread(conversationId, parentId) {
      try {
        let after: number | undefined;
        let first = true;
        for (;;) {
          const page = await api<RepliesPageDto>(`/messages/${parentId}/replies?limit=${REPLIES_PAGE}${after ? `&after=${after}` : ""}`);
          patchThread(parentId, conversationId, (t) => ({
            ...t,
            parent: page.parent,
            items: merge(first ? t.items.filter((m) => m.local) : t.items, page.replies),
            subscribed: page.subscribed,
            loaded: true,
            error: null,
          }));
          first = false;
          if (!page.hasMore || page.replies.length === 0) break;
          after = page.replies.at(-1)!.seq;
        }
      } catch (err) {
        patchThread(parentId, conversationId, (t) => ({ ...t, error: errorText(err, "Не удалось открыть тред") }));
      }
    },

    find(id) {
      const s = get();
      for (const f of Object.values(s.feeds)) {
        const hit = f.items.find((m) => m.id === id);
        if (hit) return hit;
      }
      for (const t of Object.values(s.threads)) {
        if (t.parent?.id === id) return t.parent;
        const hit = t.items.find((m) => m.id === id);
        if (hit) return hit;
      }
      return undefined;
    },

    receive(message) {
      if (message.parentId) {
        const t = get().threads[message.parentId];
        if (t?.loaded) patchThread(message.parentId, message.conversationId, (x) => ({ ...x, items: merge(x.items, [message]) }));
        if (!message.alsoInChannel) return;
      }
      const f = get().feeds[message.conversationId];
      if (!f?.loaded) return; // ленту загрузим целиком, когда её откроют
      patchFeed(message.conversationId, (x) => ({ ...x, items: merge(x.items, [message]) }));
    },

    applyUpdate(message) {
      patchMessage(message.id, (m) => ({ ...m, ...message, local: undefined }));
    },

    applyDelete({ id }) {
      // У родителя с ответами остаётся заглушка, остальное исчезает.
      patchMessage(id, (m) => (m.parentId === null && m.replyCount > 0 ? { ...m, deleted: true, text: "", reactions: [], mentions: [] } : null));
    },

    applySummary(summary) {
      const { parentId, replyCount, replyUserIds, lastReplyAt } = summary;
      patchMessage(parentId, (m) => (m.deleted && replyCount === 0 ? null : { ...m, replyCount, replyUserIds, lastReplyAt }));
    },

    applyReaction({ messageId, emoji, userId }, added) {
      patchMessage(messageId, (m) => ({ ...m, reactions: toggle(m.reactions, emoji, userId, added) }));
    },

    async send(conversationId, userId, text, opts = {}) {
      const clientMsgId = crypto.randomUUID();
      const message: ChatMessage = {
        id: clientMsgId,
        seq: ++pendingOrder,
        conversationId,
        userId,
        clientMsgId,
        subtype: null,
        text,
        mentions: [],
        createdAt: new Date().toISOString(),
        editedAt: null,
        deleted: false,
        parentId: opts.parentId ?? null,
        alsoInChannel: Boolean(opts.parentId && opts.alsoInChannel),
        replyCount: 0,
        replyUserIds: [],
        lastReplyAt: null,
        reactions: [],
        files: opts.files ?? [],
        local: "sending",
      };
      // Ответивший следит за тредом (так решает и сервер).
      if (opts.parentId) patchThread(opts.parentId, conversationId, (t) => ({ ...t, items: [...t.items, message], subscribed: true }));
      else patchFeed(conversationId, (f) => ({ ...f, items: [...f.items, message] }));
      await post(message);
    },

    async retry(_conversationId, clientMsgId) {
      const message = Object.values(get().feeds)
        .flatMap((f) => f.items)
        .concat(Object.values(get().threads).flatMap((t) => t.items))
        .find((m) => m.local && m.clientMsgId === clientMsgId);
      if (!message) return;
      patchMessage(message.id, (m) => ({ ...m, local: "sending" }));
      await post(message);
    },

    discard(_conversationId, clientMsgId) {
      const message = get().find(clientMsgId);
      if (message?.local) patchMessage(message.id, () => null);
    },

    async edit(id, text) {
      const before = get().find(id);
      if (!before) return false;
      patchMessage(id, (m) => ({ ...m, text, editedAt: new Date().toISOString() }));
      try {
        get().applyUpdate(await api<MessageDto>(`/messages/${id}`, { method: "PATCH", body: { text } }));
        return true;
      } catch (err) {
        patchMessage(id, () => before);
        toast(errorText(err, "Не удалось сохранить правку"), "error");
        return false;
      }
    },

    async remove(id) {
      const m = get().find(id);
      try {
        await api(`/messages/${id}`, { method: "DELETE" });
        if (m) get().applyDelete({ id, conversationId: m.conversationId, parentId: m.parentId, seq: m.seq, userId: m.userId, mentions: m.mentions });
      } catch (err) {
        toast(errorText(err, "Не удалось удалить сообщение"), "error");
      }
    },

    async toggleReaction(id, emoji, userId) {
      const m = get().find(id);
      if (!m) return;
      const mine = m.reactions.some((r) => r.emoji === emoji && r.userIds.includes(userId));
      patchMessage(id, (x) => ({ ...x, reactions: toggle(x.reactions, emoji, userId, !mine) }));
      try {
        if (mine) await api(`/messages/${id}/reactions/${encodeURIComponent(emoji)}`, { method: "DELETE" });
        else await api(`/messages/${id}/reactions`, { method: "POST", body: { emoji } });
      } catch (err) {
        patchMessage(id, (x) => ({ ...x, reactions: toggle(x.reactions, emoji, userId, mine) }));
        toast(errorText(err, "Реакция не сохранилась"), "error");
      }
    },

    async setSubscribed(parentId, subscribed) {
      const t = get().threads[parentId];
      if (!t) return;
      patchThread(parentId, t.conversationId, (x) => ({ ...x, subscribed }));
      try {
        await api(`/threads/${parentId}/subscription`, { method: "PUT", body: { subscribed } });
      } catch (err) {
        patchThread(parentId, t.conversationId, (x) => ({ ...x, subscribed: !subscribed }));
        toast(errorText(err, "Не получилось"), "error");
      }
    },

    forget: (id) =>
      set((s) => {
        const { [id]: _drop, ...rest } = s.feeds;
        const threads = Object.fromEntries(Object.entries(s.threads).filter(([, t]) => t.conversationId !== id));
        return { feeds: rest, threads };
      }),

    reset: () => set({ feeds: {}, threads: {} }),
  };
});

function toggle(reactions: MessageDto["reactions"], emoji: string, userId: string, on: boolean): MessageDto["reactions"] {
  const has = reactions.some((r) => r.emoji === emoji);
  if (on && !has) return [...reactions, { emoji, userIds: [userId] }];
  return reactions
    .map((r) => {
      if (r.emoji !== emoji) return r;
      const without = r.userIds.filter((u) => u !== userId);
      return { ...r, userIds: on ? [...without, userId] : without };
    })
    .filter((r) => r.userIds.length > 0);
}
