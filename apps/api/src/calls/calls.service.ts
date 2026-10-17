// Звонки (M6): медиа идёт через LiveKit, здесь — кто в каком звонке и токены для подключения.
// В разговоре не больше одного звонка. В ЛС новый звонок «звонит» остальным; в канале это созвон,
// к которому присоединяются сами. Состояние эфемерно для клиентов: события идут в комнату разговора
// мимо журнала, после переподключения клиент перечитывает GET /calls.
import { randomUUID } from "node:crypto";
import { ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { AccessToken, RoomServiceClient, WebhookReceiver } from "livekit-server-sdk";
import { CALL_EVENT, type CallDto, type CallEventDto, type CallJoinDto, type CallsDto } from "@teamchat/shared";
import { config } from "../config.js";
import { assertMember, loadAccess } from "../conversations/access.js";
import { PrismaService } from "../db/prisma.service.js";
import type { call_participants, calls, users } from "../generated/prisma/client.js";
import { RealtimeHub } from "../realtime/hub.service.js";

type CallRow = calls & { call_participants: call_participants[] };

const RECONCILE_EVERY_MS = 30_000;
// Только что выданный токен: человек ещё подключается к LiveKit, в списке комнаты его может не быть.
const CONNECT_GRACE_MS = 45_000;
const TOKEN_TTL = "6h";

const isDm = (kind: string) => kind === "dm" || kind === "group_dm";
const isNotFound = (err: unknown) => (err as { status?: number; code?: string }).status === 404 || (err as { code?: string }).code === "not_found";

@Injectable()
export class CallsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("calls");
  private readonly rooms: RoomServiceClient | null;
  private readonly webhooks: WebhookReceiver | null;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hub: RealtimeHub,
  ) {
    const { LIVEKIT_URL: url, LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret } = config;
    // API комнат живёт на том же хосте по https, клиенты подключаются по wss.
    this.rooms = url && key && secret ? new RoomServiceClient(url.replace(/^ws/, "http"), key, secret) : null;
    this.webhooks = key && secret ? new WebhookReceiver(key, secret) : null;
  }

  get enabled(): boolean {
    return this.rooms !== null;
  }

  onModuleInit() {
    if (!this.enabled) return;
    this.timer = setInterval(() => void this.reconcile().catch((err: Error) => this.log.warn(`reconcile: ${err.message}`)), RECONCILE_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  // Идущие звонки в разговорах, где человек состоит.
  async list(me: users): Promise<CallsDto> {
    const rows = await this.prisma.calls.findMany({
      where: { ended_at: null, conversations: { conversation_members: { some: { user_id: me.id } } } },
      include: { call_participants: true },
      orderBy: { created_at: "asc" },
    });
    return { enabled: this.enabled, calls: rows.map(toCallDto) };
  }

  // Начать звонок в разговоре или присоединиться к идущему.
  async join(me: users, conversationId: string): Promise<CallJoinDto> {
    if (!this.enabled) throw new ServiceUnavailableException("Звонки не настроены: серверу нужен LiveKit");
    const access = await loadAccess(this.prisma, me, conversationId);
    assertMember(access);
    if (access.conv.archived_at) throw new ForbiddenException("Канал в архиве");

    const { call, created } = await this.activeOrNew(me, conversationId);
    await this.prisma.call_participants.upsert({
      where: { call_id_user_id: { call_id: call.id, user_id: me.id } },
      create: { call_id: call.id, user_id: me.id },
      update: { joined_at: new Date(), left_at: null },
    });
    const dto = await this.dto(call.id);
    this.emit(conversationId, { kind: "updated", call: dto });
    if (created && isDm(access.conv.kind)) {
      const members = await this.prisma.conversation_members.findMany({ where: { conversation_id: conversationId }, select: { user_id: true } });
      for (const m of members) if (m.user_id !== me.id) this.hub.toUser(m.user_id, CALL_EVENT, { kind: "ring", call: dto, from: me.id } satisfies CallEventDto);
    } else if (!created) {
      // Принял на одном устройстве — на остальных перестаёт звонить.
      this.hub.toUser(me.id, CALL_EVENT, { kind: "ring.stop", callId: call.id } satisfies CallEventDto);
    }
    return { call: dto, url: config.LIVEKIT_URL!, token: await this.token(me, call.room) };
  }

  async leave(me: users, callId: string): Promise<void> {
    const call = await this.memberCall(me, callId);
    if (call.ended_at) return;
    await this.prisma.call_participants.updateMany({ where: { call_id: callId, user_id: me.id, left_at: null }, data: { left_at: new Date() } });
    await this.afterChange(callId);
  }

  // Отклонить входящий звонок в ЛС. В личке на двоих это конец звонка: звать больше некого.
  async decline(me: users, callId: string): Promise<void> {
    const call = await this.memberCall(me, callId);
    if (call.ended_at) return;
    this.hub.toUser(me.id, CALL_EVENT, { kind: "ring.stop", callId } satisfies CallEventDto);
    this.emit(call.conversation_id, { kind: "declined", callId, userId: me.id });
    const conv = await this.prisma.conversations.findUniqueOrThrow({ where: { id: call.conversation_id } });
    const others = call.call_participants.filter((p) => p.user_id !== me.id);
    if (conv.kind === "dm" && others.every((p) => p.user_id === call.started_by)) await this.end(callId);
  }

  // Вебхук LiveKit: самый быстрый способ узнать, что человек отключился (закрыл вкладку, пропала сеть).
  async webhook(body: string, auth: string | undefined): Promise<void> {
    if (!this.webhooks) throw new ServiceUnavailableException("Звонки не настроены");
    let event;
    try {
      event = await this.webhooks.receive(body, auth);
    } catch {
      throw new ForbiddenException("Подпись вебхука не сходится");
    }
    const room = event.room?.name;
    if (!room) return;
    const call = await this.prisma.calls.findUnique({ where: { room } });
    if (!call || call.ended_at) return;
    const userId = event.participant?.identity;
    if (event.event === "room_finished") {
      await this.end(call.id);
    } else if (event.event === "participant_left" && userId) {
      await this.prisma.call_participants.updateMany({ where: { call_id: call.id, user_id: userId, left_at: null }, data: { left_at: new Date() } });
      await this.afterChange(call.id);
    } else if (event.event === "participant_joined" && userId) {
      const updated = await this.prisma.call_participants.updateMany({ where: { call_id: call.id, user_id: userId }, data: { left_at: null } });
      if (updated.count > 0) this.emit(call.conversation_id, { kind: "updated", call: await this.dto(call.id) });
    }
  }

  // Сверка с LiveKit раз в полминуты: страхует от пропущенных вебхуков и закрытых без «Выйти» вкладок.
  async reconcile(): Promise<void> {
    if (!this.rooms) return;
    const active = await this.prisma.calls.findMany({ where: { ended_at: null }, include: { call_participants: true } });
    for (const call of active) {
      let present: Set<string>;
      try {
        present = new Set((await this.rooms.listParticipants(call.room)).map((p) => p.identity));
      } catch (err) {
        // Комнаты нет — никто так и не подключился или все ушли. Любая другая ошибка (LiveKit недоступен)
        // ничего не значит: не выкидываем людей из звонка, проверим в следующий раз.
        if (!isNotFound(err)) continue;
        present = new Set();
      }
      const stale = call.call_participants.filter((p) => !p.left_at && !present.has(p.user_id) && Date.now() - p.joined_at.getTime() > CONNECT_GRACE_MS);
      if (stale.length > 0) {
        await this.prisma.call_participants.updateMany({
          where: { call_id: call.id, user_id: { in: stale.map((p) => p.user_id) }, left_at: null },
          data: { left_at: new Date() },
        });
        await this.afterChange(call.id);
      }
    }
  }

  // ───────── внутреннее ─────────

  private async activeOrNew(me: users, conversationId: string): Promise<{ call: calls; created: boolean }> {
    const existing = await this.prisma.calls.findFirst({ where: { conversation_id: conversationId, ended_at: null } });
    if (existing) return { call: existing, created: false };
    try {
      const call = await this.prisma.calls.create({ data: { conversation_id: conversationId, started_by: me.id, room: `call-${randomUUID()}` } });
      return { call, created: true };
    } catch (err) {
      // Двое нажали «Позвонить» одновременно: уникальный индекс пропустил одного, второй присоединяется.
      const winner = await this.prisma.calls.findFirst({ where: { conversation_id: conversationId, ended_at: null } });
      if (!winner) throw err;
      return { call: winner, created: false };
    }
  }

  private async memberCall(me: users, callId: string): Promise<CallRow> {
    const call = await this.prisma.calls.findUnique({ where: { id: callId }, include: { call_participants: true } });
    if (!call) throw new NotFoundException("Звонок не найден");
    const member = await this.prisma.conversation_members.findUnique({
      where: { conversation_id_user_id: { conversation_id: call.conversation_id, user_id: me.id } },
    });
    if (!member) throw new NotFoundException("Звонок не найден");
    return call;
  }

  // После выхода кого-то: никого не осталось — звонок окончен, иначе всем новое состояние.
  private async afterChange(callId: string): Promise<void> {
    const call = await this.prisma.calls.findUniqueOrThrow({ where: { id: callId }, include: { call_participants: true } });
    if (call.ended_at) return;
    if (call.call_participants.every((p) => p.left_at)) await this.end(callId);
    else this.emit(call.conversation_id, { kind: "updated", call: toCallDto(call) });
  }

  private async end(callId: string): Promise<void> {
    const now = new Date();
    const ended = await this.prisma.calls.updateMany({ where: { id: callId, ended_at: null }, data: { ended_at: now } });
    if (ended.count === 0) return;
    await this.prisma.call_participants.updateMany({ where: { call_id: callId, left_at: null }, data: { left_at: now } });
    const call = await this.prisma.calls.findUniqueOrThrow({ where: { id: callId } });
    this.emit(call.conversation_id, { kind: "ended", callId, conversationId: call.conversation_id });
    // Комнату в LiveKit закрываем, чтобы там не остался кто-то с ещё живым токеном.
    await this.rooms?.deleteRoom(call.room).catch(() => undefined);
  }

  private async dto(callId: string): Promise<CallDto> {
    return toCallDto(await this.prisma.calls.findUniqueOrThrow({ where: { id: callId }, include: { call_participants: true } }));
  }

  private emit(conversationId: string, event: CallEventDto) {
    this.hub.toConversation(conversationId, CALL_EVENT, event);
  }

  private async token(me: users, room: string): Promise<string> {
    const at = new AccessToken(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET, {
      identity: me.id, // по id клиент находит человека в boot: имя, фото
      name: me.display_name || me.real_name,
      ttl: TOKEN_TTL,
    });
    at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true, canUpdateOwnMetadata: false });
    return at.toJwt();
  }
}

function toCallDto(c: CallRow): CallDto {
  return {
    id: c.id,
    conversationId: c.conversation_id,
    startedBy: c.started_by,
    startedAt: c.created_at.toISOString(),
    participantIds: c.call_participants.filter((p) => !p.left_at).map((p) => p.user_id),
  };
}
