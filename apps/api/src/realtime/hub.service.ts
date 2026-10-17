import { Injectable } from "@nestjs/common";
import type { EventDto, PresenceEventDto } from "@teamchat/shared";
import type { Server } from "socket.io";

export const rooms = {
  user: (id: string) => `user:${id}`,
  conversation: (id: string) => `conv:${id}`,
  session: (id: string) => `session:${id}`,
};

// Доставка событий в комнаты socket.io. Вызывается только после коммита транзакции.
@Injectable()
export class RealtimeHub {
  server: Server | null = null;

  publish(events: EventDto[]): void {
    if (!this.server) return;
    for (const ev of events) {
      if ("conversationId" in ev) this.server.to(rooms.conversation(ev.conversationId)).emit("events", [ev]);
      else if ("userId" in ev) this.server.to(rooms.user(ev.userId)).emit("events", [ev]);
      else this.server.emit("events", [ev]);
    }
  }

  // Эфемерное событие одному человеку на все его устройства (в журнал не пишется).
  toUser(userId: string, event: string, payload: unknown): void {
    this.server?.to(rooms.user(userId)).emit(event, payload);
  }

  joinConversation(userId: string, conversationId: string): void {
    this.server?.in(rooms.user(userId)).socketsJoin(rooms.conversation(conversationId));
  }

  leaveConversation(userId: string, conversationId: string): void {
    this.server?.in(rooms.user(userId)).socketsLeave(rooms.conversation(conversationId));
  }

  // Присутствие эфемерно и не пишется в журнал.
  emitPresence(payload: PresenceEventDto): void {
    this.server?.emit("presence", payload);
  }

  disconnectSession(sessionId: string): void {
    this.server?.in(rooms.session(sessionId)).disconnectSockets(true);
  }

  disconnectUser(userId: string): void {
    this.server?.in(rooms.user(userId)).disconnectSockets(true);
  }
}
