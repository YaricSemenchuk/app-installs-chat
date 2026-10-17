import { Injectable } from "@nestjs/common";
import { extractMentions, type MessageDto, type MessagesPageDto } from "@teamchat/shared";
import { toMessageDto } from "../common/mappers.js";
import { PrismaService } from "../db/prisma.service.js";
import type { conversations, users } from "../generated/prisma/client.js";
import { EventsService } from "../realtime/events.service.js";
import { RealtimeHub } from "../realtime/hub.service.js";
import { PresenceService } from "../realtime/presence.service.js";
import { assertCanPost, assertMember, isAdmin, isChannel, loadAccess } from "./access.js";

type MentionKind = "user" | "here" | "channel" | "everyone";

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly hub: RealtimeHub,
    private readonly presence: PresenceService,
  ) {}

  async list(me: users, conversationId: string, q: { before?: number; after?: number; limit: number }): Promise<MessagesPageDto> {
    await loadAccess(this.prisma, me, conversationId);
    const feed = { conversation_id: conversationId, OR: [{ parent_id: null }, { also_in_channel: true }] };
    const take = q.limit + 1;
    const include = { message_mentions: { select: { user_id: true } } } as const;

    let rows;
    if (q.after !== undefined) {
      rows = await this.prisma.messages.findMany({ where: { ...feed, seq: { gt: q.after } }, orderBy: { seq: "asc" }, take, include });
    } else {
      rows = await this.prisma.messages.findMany({
        where: q.before !== undefined ? { ...feed, seq: { lt: q.before } } : feed,
        orderBy: { seq: "desc" },
        take,
        include,
      });
      rows.reverse();
    }
    const hasMore = rows.length > q.limit;
    if (hasMore) {
      if (q.after !== undefined) rows.pop();
      else rows.shift();
    }
    return { messages: rows.map((m) => toMessageDto(m, m.message_mentions.map((x) => x.user_id))), hasMore };
  }

  // Кого задело сообщение: явные @люди из участников, а @here / @channel раскрываются в получателей.
  private async recipients(me: users, conv: conversations, text: string): Promise<Map<string, MentionKind>> {
    const { userIds, broadcast } = extractMentions(text);
    const out = new Map<string, MentionKind>();
    if (userIds.length === 0 && broadcast.length === 0) return out;

    const members = (
      await this.prisma.conversation_members.findMany({ where: { conversation_id: conv.id }, select: { user_id: true } })
    ).map((m) => m.user_id);
    const memberSet = new Set(members);

    const broadcastAllowed = isChannel(conv) && (conv.allow_channel_mentions || isAdmin(me));
    if (broadcastAllowed) {
      const online = this.presence.snapshot();
      for (const kind of broadcast) {
        for (const uid of members) {
          if (uid === me.id) continue;
          if (kind === "here" && online[uid] !== "active") continue;
          out.set(uid, kind === "everyone" && !conv.is_general ? "channel" : kind);
        }
      }
    }
    for (const uid of userIds) if (uid !== me.id && memberSet.has(uid)) out.set(uid, "user");
    return out;
  }

  async send(me: users, conversationId: string, input: { clientMsgId: string; text: string }): Promise<MessageDto> {
    const access = await loadAccess(this.prisma, me, conversationId);
    assertCanPost(me, access);
    const text = input.text.trim();
    const mentions = await this.recipients(me, access.conv, text);
    const isDm = !isChannel(access.conv);

    const { message, event } = await this.prisma.$transaction(async (tx) => {
      await this.events.lock(tx);
      // Повтор после обрыва связи: возвращаем уже сохранённое сообщение, новое событие не пишем.
      const existing = await tx.messages.findFirst({
        where: { user_id: me.id, client_msg_id: input.clientMsgId },
        include: { message_mentions: { select: { user_id: true } } },
      });
      if (existing) return { message: toMessageDto(existing, existing.message_mentions.map((m) => m.user_id)), event: null };

      const created = await tx.messages.create({
        data: { conversation_id: conversationId, user_id: me.id, client_msg_id: input.clientMsgId, text },
      });
      if (mentions.size > 0) {
        await tx.message_mentions.createMany({
          data: [...mentions].map(([user_id, kind]) => ({ message_id: created.id, user_id, kind })),
        });
      }
      await tx.$executeRaw`
        update conversation_members set last_read_seq = greatest(last_read_seq, ${created.seq})
         where conversation_id = ${conversationId}::uuid and user_id = ${me.id}::uuid`;
      // ЛС появляется у собеседников с первым сообщением (и снова — если кто-то его скрыл).
      if (isDm) {
        await tx.conversation_members.updateMany({ where: { conversation_id: conversationId, is_open: false }, data: { is_open: true } });
      }
      const message = toMessageDto(created, [...mentions.keys()]);
      const event = await this.events.append(tx, "message.created", { conversationId }, message);
      return { message, event };
    });

    if (event) this.hub.publish([event]);
    return message;
  }

  // Курсор прочитанного только растёт и не уходит дальше последнего сообщения разговора.
  async markRead(me: users, conversationId: string, seq: number): Promise<{ lastReadSeq: number }> {
    const access = await loadAccess(this.prisma, me, conversationId);
    const membership = assertMember(access);
    const result = await this.prisma.$transaction(async (tx) => {
      await this.events.lock(tx);
      const rows = await tx.$queryRaw<{ last_read_seq: bigint }[]>`
        update conversation_members cm
           set last_read_seq = least(${seq}::bigint, coalesce((select max(m.seq) from messages m where m.conversation_id = cm.conversation_id), 0))
         where cm.conversation_id = ${conversationId}::uuid and cm.user_id = ${me.id}::uuid
           and cm.last_read_seq < least(${seq}::bigint, coalesce((select max(m.seq) from messages m where m.conversation_id = cm.conversation_id), 0))
        returning cm.last_read_seq`;
      if (rows.length === 0) return { lastReadSeq: Number(membership.last_read_seq), event: null };
      const lastReadSeq = Number(rows[0]!.last_read_seq);
      const event = await this.events.append(tx, "read.updated", { userId: me.id }, { conversationId, lastReadSeq });
      return { lastReadSeq, event };
    });
    if (result.event) this.hub.publish([result.event]);
    return { lastReadSeq: result.lastReadSeq };
  }
}
