import { Logger } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from "@nestjs/websockets";
import { SOCKET_PATH } from "@teamchat/shared";
import type { Server, Socket } from "socket.io";
import { AuthService } from "../auth/auth.service.js";
import { SESSION_COOKIE } from "../auth/session.guard.js";
import { toEventDto } from "../common/mappers.js";
import { appOrigin } from "../config.js";
import { PrismaService } from "../db/prisma.service.js";
import { RealtimeHub, rooms } from "./hub.service.js";
import { PresenceService } from "./presence.service.js";

const CATCH_UP_LIMIT = 1000;

type SocketData = { userId: string; ready: Promise<boolean> };

function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

@WebSocketGateway({ path: SOCKET_PATH, serveClient: false })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly log = new Logger("Realtime");

  constructor(
    private readonly hub: RealtimeHub,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
  ) {}

  afterInit(server: Server): void {
    this.hub.server = server;
  }

  handleConnection(socket: Socket): void {
    const data = socket.data as SocketData;
    // hello может прийти раньше, чем закончится вход в комнаты, поэтому он ждёт ready.
    data.ready = this.authenticate(socket).catch((err: unknown) => {
      this.log.error(err);
      socket.disconnect(true);
      return false;
    });
  }

  private async authenticate(socket: Socket): Promise<boolean> {
    // Браузер всегда шлёт Origin; чужой Origin — попытка подключиться с чужого сайта.
    const origin = socket.handshake.headers.origin;
    if (origin && origin !== appOrigin) {
      socket.disconnect(true);
      return false;
    }
    const session = await this.auth.sessionUser(readCookie(socket.handshake.headers.cookie, SESSION_COOKIE));
    if (!session) {
      socket.emit("unauthorized");
      socket.disconnect(true);
      return false;
    }
    const memberships = await this.prisma.conversation_members.findMany({
      where: { user_id: session.user.id },
      select: { conversation_id: true },
    });
    (socket.data as SocketData).userId = session.user.id;
    await socket.join([
      rooms.user(session.user.id),
      rooms.session(session.sessionId),
      ...memberships.map((m) => rooms.conversation(m.conversation_id)),
    ]);
    if (socket.connected) this.presence.connected(session.user.id, socket.id);
    return true;
  }

  handleDisconnect(socket: Socket): void {
    const { userId } = socket.data as Partial<SocketData>;
    if (userId) this.presence.disconnected(userId, socket.id);
  }

  // Клиент шлёт, пока человек что-то делает в окне (не чаще раза в минуту).
  @SubscribeMessage("active")
  async active(@ConnectedSocket() socket: Socket): Promise<void> {
    const data = socket.data as SocketData;
    if (await data.ready) this.presence.touch(data.userId);
  }

  // Догрузка: всё из журнала после lastEventId, что адресовано этому пользователю.
  @SubscribeMessage("hello")
  async hello(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<void> {
    const data = socket.data as SocketData;
    if (!(await data.ready)) return;
    const lastEventId = typeof body === "object" && body && "lastEventId" in body ? Number(body.lastEventId) : NaN;
    if (!Number.isSafeInteger(lastEventId) || lastEventId < 0) {
      socket.emit("resync");
      return;
    }

    const [{ min }] = await this.prisma.$queryRaw<[{ min: bigint | null }]>`select min(id) as min from events`;
    if (min !== null && lastEventId < Number(min) - 1) {
      socket.emit("resync"); // журнал уже обрезан, догрузить нечем
      return;
    }

    const conversationIds = (
      await this.prisma.conversation_members.findMany({ where: { user_id: data.userId }, select: { conversation_id: true } })
    ).map((m) => m.conversation_id);

    const rows = await this.prisma.events.findMany({
      where: {
        id: { gt: BigInt(lastEventId) },
        OR: [{ conversation_id: { in: conversationIds } }, { user_id: data.userId }, { broadcast: true }],
      },
      orderBy: { id: "asc" },
      take: CATCH_UP_LIMIT + 1,
    });
    if (rows.length > CATCH_UP_LIMIT) {
      socket.emit("resync");
      return;
    }
    if (rows.length > 0) socket.emit("events", rows.map(toEventDto));
    socket.emit("synced");
  }
}
