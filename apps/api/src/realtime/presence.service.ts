import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { Presence } from "@teamchat/shared";
import { RealtimeHub } from "./hub.service.js";

const AWAY_AFTER_MS = 10 * 60_000;
const SWEEP_MS = 60_000;

// «В сети» = открыт хотя бы один клиент и человек что-то делал в последние 10 минут.
// Состояние в памяти: сервис один (см. architecture.md), после рестарта клиенты переподключатся.
@Injectable()
export class PresenceService implements OnModuleDestroy {
  private readonly sockets = new Map<string, Set<string>>();
  private readonly lastActive = new Map<string, number>();
  private readonly active = new Set<string>();
  private readonly sweep = setInterval(() => this.expire(), SWEEP_MS);

  constructor(private readonly hub: RealtimeHub) {
    this.sweep.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.sweep);
  }

  connected(userId: string, socketId: string): void {
    const set = this.sockets.get(userId) ?? new Set<string>();
    set.add(socketId);
    this.sockets.set(userId, set);
    this.touch(userId);
  }

  disconnected(userId: string, socketId: string): void {
    const set = this.sockets.get(userId);
    set?.delete(socketId);
    if (!set || set.size === 0) {
      this.sockets.delete(userId);
      this.set(userId, "away");
    }
  }

  touch(userId: string): void {
    if (!this.sockets.has(userId)) return;
    this.lastActive.set(userId, Date.now());
    this.set(userId, "active");
  }

  forget(userId: string): void {
    this.sockets.delete(userId);
    this.set(userId, "away");
  }

  snapshot(): Record<string, Presence> {
    return Object.fromEntries([...this.active].map((id) => [id, "active" as const]));
  }

  private expire(): void {
    const now = Date.now();
    for (const id of this.active) {
      if (now - (this.lastActive.get(id) ?? 0) > AWAY_AFTER_MS) this.set(id, "away");
    }
  }

  private set(userId: string, presence: Presence): void {
    const was = this.active.has(userId);
    if (presence === "active" && !was) this.active.add(userId);
    else if (presence === "away" && was) this.active.delete(userId);
    else return;
    this.hub.emitPresence({ userId, presence });
  }
}
