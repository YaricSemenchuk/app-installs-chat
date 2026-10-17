// Состояние звонков в клиенте: идущие звонки по разговорам (для кнопок и значков), свой текущий звонок
// и входящий вызов. Источник правды — сервер: GET /calls при старте и после переподключения, дальше события.
import { create } from "zustand";
import { CALL_RING_SECONDS, type CallDto, type CallEventDto, type CallJoinDto, type CallsDto } from "@teamchat/shared";
import { api } from "../api/http";
import { getBoot } from "../data/boot";
import { toast } from "../ui/Toaster";

export type Session = CallJoinDto & { conversationId: string };
export type Incoming = { call: CallDto; from: string; until: number };

type State = {
  enabled: boolean;
  byConversation: Record<string, CallDto>;
  session: Session | null; // свой звонок: куда подключаться и с каким токеном
  joining: boolean;
  incoming: Incoming | null;
};

export const useCalls = create<State>(() => ({ enabled: false, byConversation: {}, session: null, joining: false, incoming: null }));

const set = useCalls.setState;
const get = useCalls.getState;
const nameOf = (id: string) => {
  const u = getBoot()?.users.find((x) => x.id === id);
  return u ? u.displayName || u.realName : "Собеседник";
};

export async function loadCalls(): Promise<void> {
  try {
    const { enabled, calls } = await api<CallsDto>("/calls");
    set((s) => {
      const byConversation = Object.fromEntries(calls.map((c) => [c.conversationId, c]));
      // Свой звонок закончился, пока не было связи: окно звонка закрываем.
      const session = s.session && byConversation[s.session.conversationId]?.id === s.session.call.id ? s.session : null;
      return { enabled, byConversation, session };
    });
  } catch {
    // не загрузилось — кнопки звонка просто не появятся
  }
}

export function applyCallEvent(e: CallEventDto): void {
  const s = get();
  switch (e.kind) {
    case "updated":
      set({
        byConversation: { ...s.byConversation, [e.call.conversationId]: e.call },
        session: s.session?.call.id === e.call.id ? { ...s.session, call: e.call } : s.session,
      });
      break;
    case "ended": {
      const { [e.conversationId]: _gone, ...rest } = s.byConversation;
      set({
        byConversation: rest,
        session: s.session?.call.id === e.callId ? null : s.session,
        incoming: s.incoming?.call.id === e.callId ? null : s.incoming,
      });
      break;
    }
    case "ring":
      // Уже в этом звонке (например, сам позвонил с другого устройства) — не звоним.
      if (s.session?.call.id === e.call.id) return;
      set({ incoming: { call: e.call, from: e.from, until: Date.now() + CALL_RING_SECONDS * 1000 } });
      break;
    case "ring.stop":
      if (s.incoming?.call.id === e.callId) set({ incoming: null });
      break;
    case "declined":
      if (s.session?.call.id === e.callId) toast(`${nameOf(e.userId)} отклоняет звонок`);
      break;
  }
}

// Начать звонок в разговоре или войти в идущий. Из другого звонка сначала выходим: звонок один.
export async function joinCall(conversationId: string): Promise<void> {
  const s = get();
  if (s.joining) return;
  if (s.session?.conversationId === conversationId) return;
  if (s.session) await leaveCall();
  set({ joining: true });
  try {
    const joined = await api<CallJoinDto>(`/conversations/${conversationId}/call`, { method: "POST", body: {} });
    set((st) => ({
      session: { ...joined, conversationId },
      byConversation: { ...st.byConversation, [conversationId]: joined.call },
      incoming: st.incoming?.call.id === joined.call.id ? null : st.incoming,
    }));
  } catch (err) {
    toast((err as Error).message || "Не получилось подключиться к звонку", "error");
  } finally {
    set({ joining: false });
  }
}

export async function leaveCall(): Promise<void> {
  const session = get().session;
  if (!session) return;
  set({ session: null });
  await api(`/calls/${session.call.id}/leave`, { method: "POST", body: {} }).catch(() => undefined);
}

export async function acceptIncoming(): Promise<void> {
  const incoming = get().incoming;
  if (!incoming) return;
  set({ incoming: null });
  await joinCall(incoming.call.conversationId);
}

export async function declineIncoming(): Promise<void> {
  const incoming = get().incoming;
  if (!incoming) return;
  set({ incoming: null });
  await api(`/calls/${incoming.call.id}/decline`, { method: "POST", body: {} }).catch(() => undefined);
}

// Закрыли вкладку посреди звонка: сообщаем серверу сразу, не дожидаясь сверки с LiveKit.
window.addEventListener("pagehide", () => {
  const session = get().session;
  if (!session) return;
  navigator.sendBeacon(`/api/calls/${session.call.id}/leave`, new Blob(["{}"], { type: "application/json" }));
});
