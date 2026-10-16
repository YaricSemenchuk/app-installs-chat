import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { BootDto, ConversationDto, ConversationKind, MessagesPageDto, MessageDto } from "@teamchat/shared";
import { toMessageDto, toUserDto } from "../common/mappers.js";
import { PrismaService } from "../db/prisma.service.js";
import type { users } from "../generated/prisma/client.js";
import { EventsService } from "../realtime/events.service.js";
import { RealtimeHub } from "../realtime/hub.service.js";
import { PresenceService } from "../realtime/presence.service.js";

type UnreadRow = { conversation_id: string; last_read_seq: bigint; latest_seq: bigint; unread: bigint };

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly hub: RealtimeHub,
    private readonly presence: PresenceService,
  ) {}

  async boot(me: users): Promise<BootDto> {
    // Сначала курсор журнала, потом состояние: всё, что закоммитится между ними, клиент догрузит
    // по событиям и применит идемпотентно.
    const [{ last }] = await this.prisma.$queryRaw<[{ last: bigint }]>`select coalesce(max(id), 0) as last from events`;

    const [ws, users, memberships, unread] = await Promise.all([
      this.prisma.workspace_settings.findUniqueOrThrow({ where: { id: 1 } }),
      this.prisma.users.findMany({ orderBy: { display_name: "asc" } }),
      this.prisma.conversation_members.findMany({
        where: { user_id: me.id },
        include: { conversations: { include: { conversation_members: { select: { user_id: true } } } } },
      }),
      this.prisma.$queryRaw<UnreadRow[]>`
        select cm.conversation_id,
               cm.last_read_seq,
               coalesce((select max(m.seq) from messages m where m.conversation_id = cm.conversation_id), 0) as latest_seq,
               (select count(*) from messages m
                 where m.conversation_id = cm.conversation_id
                   and m.seq > cm.last_read_seq
                   and (m.parent_id is null or m.also_in_channel)
                   and m.user_id <> cm.user_id
                   and m.deleted_at is null
                   and m.subtype is null) as unread
          from conversation_members cm
         where cm.user_id = ${me.id}::uuid`,
    ]);

    const unreadBy = new Map(unread.map((r) => [r.conversation_id, r]));
    const conversations: ConversationDto[] = memberships.map(({ conversations: c }) => {
      const u = unreadBy.get(c.id);
      return {
        id: c.id,
        kind: c.kind as ConversationKind,
        name: c.name,
        topic: c.topic,
        purpose: c.purpose,
        isGeneral: c.is_general,
        archived: c.archived_at !== null,
        memberIds: c.conversation_members.map((m) => m.user_id),
        lastReadSeq: Number(u?.last_read_seq ?? 0),
        latestSeq: Number(u?.latest_seq ?? 0),
        unreadCount: Number(u?.unread ?? 0),
      };
    });

    return {
      me: toUserDto(me),
      workspace: { name: ws.name, whoCanInvite: ws.who_can_invite === "admins" ? "admins" : "everyone" },
      users: users.map(toUserDto),
      conversations,
      presence: this.presence.snapshot(),
      lastEventId: Number(last),
    };
  }

  // В M0 читать и писать могут только участники разговора.
  private async requireMember(userId: string, conversationId: string) {
    const membership = await this.prisma.conversation_members.findUnique({
      where: { conversation_id_user_id: { conversation_id: conversationId, user_id: userId } },
      include: { conversations: true },
    });
    if (!membership) throw new NotFoundException("Разговор не найден");
    return membership;
  }

  async listMessages(
    me: users,
    conversationId: string,
    q: { before?: number; after?: number; limit: number },
  ): Promise<MessagesPageDto> {
    await this.requireMember(me.id, conversationId);
    const feed = { conversation_id: conversationId, OR: [{ parent_id: null }, { also_in_channel: true }] };
    const take = q.limit + 1;

    let rows;
    if (q.after !== undefined) {
      rows = await this.prisma.messages.findMany({ where: { ...feed, seq: { gt: q.after } }, orderBy: { seq: "asc" }, take });
    } else {
      rows = await this.prisma.messages.findMany({
        where: q.before !== undefined ? { ...feed, seq: { lt: q.before } } : feed,
        orderBy: { seq: "desc" },
        take,
      });
      rows.reverse();
    }
    const hasMore = rows.length > q.limit;
    if (hasMore) {
      if (q.after !== undefined) rows.pop();
      else rows.shift();
    }
    return { messages: rows.map(toMessageDto), hasMore };
  }

  async sendMessage(me: users, conversationId: string, input: { clientMsgId: string; text: string }): Promise<MessageDto> {
    const membership = await this.requireMember(me.id, conversationId);
    const conv = membership.conversations;
    if (conv.archived_at) throw new ForbiddenException("Канал в архиве");
    if (conv.posting_policy === "admins" && !["primary_owner", "owner", "admin"].includes(me.role)) {
      throw new ForbiddenException("Писать в этот канал могут только администраторы");
    }
    const text = input.text.trim();

    const { message, event } = await this.prisma.$transaction(async (tx) => {
      await this.events.lock(tx);
      // Повтор после обрыва связи: возвращаем уже сохранённое сообщение, новое событие не пишем.
      const existing = await tx.messages.findFirst({ where: { user_id: me.id, client_msg_id: input.clientMsgId } });
      if (existing) return { message: existing, event: null };

      const message = await tx.messages.create({
        data: { conversation_id: conversationId, user_id: me.id, client_msg_id: input.clientMsgId, text },
      });
      await tx.$executeRaw`
        update conversation_members set last_read_seq = greatest(last_read_seq, ${message.seq})
         where conversation_id = ${conversationId}::uuid and user_id = ${me.id}::uuid`;
      const event = await this.events.append(tx, "message.created", { conversationId }, toMessageDto(message));
      return { message, event };
    });

    if (event) this.hub.publish([event]);
    return toMessageDto(message);
  }

  // Курсор прочитанного только растёт и не уходит дальше последнего сообщения разговора.
  async markRead(me: users, conversationId: string, seq: number): Promise<{ lastReadSeq: number }> {
    await this.requireMember(me.id, conversationId);
    const result = await this.prisma.$transaction(async (tx) => {
      await this.events.lock(tx);
      const rows = await tx.$queryRaw<{ last_read_seq: bigint }[]>`
        update conversation_members cm
           set last_read_seq = least(${seq}::bigint, coalesce((select max(m.seq) from messages m where m.conversation_id = cm.conversation_id), 0))
         where cm.conversation_id = ${conversationId}::uuid and cm.user_id = ${me.id}::uuid
           and cm.last_read_seq < least(${seq}::bigint, coalesce((select max(m.seq) from messages m where m.conversation_id = cm.conversation_id), 0))
        returning cm.last_read_seq`;
      if (rows.length === 0) return { lastReadSeq: null, event: null };
      const lastReadSeq = Number(rows[0]!.last_read_seq);
      const event = await this.events.append(tx, "read.updated", { userId: me.id }, { conversationId, lastReadSeq });
      return { lastReadSeq, event };
    });
    if (result.event) this.hub.publish([result.event]);

    if (result.lastReadSeq !== null) return { lastReadSeq: result.lastReadSeq };
    const current = await this.requireMember(me.id, conversationId);
    return { lastReadSeq: Number(current.last_read_seq) };
  }
}
