import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import {
  MAX_REACTIONS_PER_MESSAGE,
  THREAD_SUMMARY_USERS,
  canStillEdit,
  extractMentions,
  type EventDto,
  type MessageDeletedDto,
  type MessageDto,
  type MessageLinkDto,
  type MessagesPageDto,
  type ReactionEventDto,
  type RepliesPageDto,
  type SendMessageInput,
  type ThreadSummaryDto,
} from "@teamchat/shared";
import { toMessageDto } from "../common/mappers.js";
import { PrismaService, type Tx } from "../db/prisma.service.js";
import type { conversations, messages, users } from "../generated/prisma/client.js";
import { EventsService } from "../realtime/events.service.js";
import { RealtimeHub } from "../realtime/hub.service.js";
import { PresenceService } from "../realtime/presence.service.js";
import { assertCanPost, assertMember, isAdmin, isChannel, loadAccess, type Access } from "./access.js";

type MentionKind = "user" | "here" | "channel" | "everyone";

const MESSAGE_INCLUDE = {
  message_mentions: { select: { user_id: true } },
  reactions: { select: { emoji: true, user_id: true, created_at: true } },
} as const;

// Лента: сообщения верхнего уровня и ответы «также в канал»; удалённое — только если у него остались ответы.
const feedWhere = (conversationId: string) => ({
  conversation_id: conversationId,
  OR: [{ parent_id: null }, { also_in_channel: true }],
  AND: [{ OR: [{ deleted_at: null }, { reply_count: { gt: 0 } }] }],
});

const summaryOf = (p: messages): ThreadSummaryDto => ({
  conversationId: p.conversation_id,
  parentId: p.id,
  replyCount: p.reply_count,
  replyUserIds: p.reply_user_ids,
  lastReplyAt: p.last_reply_at?.toISOString() ?? null,
});

const notFound = () => new NotFoundException("Сообщение не найдено");

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
    const feed = feedWhere(conversationId);
    const take = q.limit + 1;

    let rows;
    if (q.after !== undefined) {
      rows = await this.prisma.messages.findMany({
        where: { ...feed, seq: { gt: q.after } },
        orderBy: { seq: "asc" },
        take,
        include: MESSAGE_INCLUDE,
      });
    } else {
      rows = await this.prisma.messages.findMany({
        where: q.before !== undefined ? { ...feed, seq: { lt: q.before } } : feed,
        orderBy: { seq: "desc" },
        take,
        include: MESSAGE_INCLUDE,
      });
      rows.reverse();
    }
    const hasMore = rows.length > q.limit;
    if (hasMore) {
      if (q.after !== undefined) rows.pop();
      else rows.shift();
    }
    return { messages: rows.map((m) => toMessageDto(m)), hasMore };
  }

  // Сообщение и доступ к его разговору. Нет доступа на чтение — для человека его «нет».
  private async load(me: users, id: string) {
    const msg = await this.prisma.messages.findUnique({ where: { id }, include: MESSAGE_INCLUDE });
    if (!msg) throw notFound();
    let access: Access;
    try {
      access = await loadAccess(this.prisma, me, msg.conversation_id);
    } catch {
      throw notFound();
    }
    return { msg, access };
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

  async send(me: users, conversationId: string, input: SendMessageInput): Promise<MessageDto> {
    const access = await loadAccess(this.prisma, me, conversationId);
    assertCanPost(me, access);
    const text = input.text.trim();

    let parent: messages | null = null;
    if (input.parentId) {
      parent = await this.prisma.messages.findUnique({ where: { id: input.parentId } });
      if (!parent || parent.conversation_id !== conversationId || parent.parent_id || parent.subtype || parent.deleted_at) {
        throw new BadRequestException("На это сообщение нельзя ответить в треде");
      }
    }
    const alsoInChannel = parent !== null && input.alsoInChannel;
    const inFeed = parent === null || alsoInChannel;
    const mentions = await this.recipients(me, access.conv, text);
    const isDm = !isChannel(access.conv);

    const result = await this.prisma.$transaction(async (tx) => {
      await this.events.lock(tx);
      // Повтор после обрыва связи: возвращаем уже сохранённое сообщение, новое событие не пишем.
      const existing = await tx.messages.findFirst({
        where: { user_id: me.id, client_msg_id: input.clientMsgId },
        include: MESSAGE_INCLUDE,
      });
      if (existing) return { message: toMessageDto(existing), events: [] as EventDto[] };

      const created = await tx.messages.create({
        data: {
          conversation_id: conversationId,
          user_id: me.id,
          client_msg_id: input.clientMsgId,
          text,
          parent_id: parent?.id ?? null,
          also_in_channel: alsoInChannel,
        },
      });
      if (mentions.size > 0) {
        await tx.message_mentions.createMany({
          data: [...mentions].map(([user_id, kind]) => ({ message_id: created.id, user_id, kind })),
        });
      }
      // Своё сообщение в ленте читаем сразу. Ответ только в треде курсор ленты не двигает,
      // иначе непрочитанное в канале, пришедшее раньше, тихо стало бы прочитанным.
      if (inFeed) {
        await tx.$executeRaw`
          update conversation_members set last_read_seq = greatest(last_read_seq, ${created.seq})
           where conversation_id = ${conversationId}::uuid and user_id = ${me.id}::uuid`;
      }
      // ЛС появляется у собеседников с первым сообщением (и снова — если кто-то его скрыл).
      if (isDm) {
        await tx.conversation_members.updateMany({ where: { conversation_id: conversationId, is_open: false }, data: { is_open: true } });
      }
      const message = toMessageDto(created, [...mentions.keys()]);
      const events = [await this.events.append(tx, "message.created", { conversationId }, message)];
      if (parent) {
        const mentioned = [...mentions].filter(([, kind]) => kind === "user").map(([id]) => id);
        await this.follow(tx, parent, me.id, created.seq, mentioned);
        const summary = await this.recountThread(tx, parent.id);
        events.push(await this.events.append(tx, "thread.updated", { conversationId }, summary));
      }
      return { message, events };
    });

    if (result.events.length > 0) this.hub.publish(result.events);
    return result.message;
  }

  // Сводка треда на родителе — пересчётом по живым ответам: так она верна и после удалений.
  private async recountThread(tx: Tx, parentId: string): Promise<ThreadSummaryDto> {
    const replies = await tx.messages.findMany({
      where: { parent_id: parentId, deleted_at: null },
      orderBy: { seq: "desc" },
      select: { user_id: true, created_at: true },
    });
    const userIds: string[] = [];
    for (const r of replies) {
      if (!userIds.includes(r.user_id)) userIds.push(r.user_id);
      if (userIds.length === THREAD_SUMMARY_USERS) break;
    }
    const updated = await tx.messages.update({
      where: { id: parentId },
      data: { reply_count: replies.length, reply_user_ids: userIds, last_reply_at: replies[0]?.created_at ?? null },
    });
    return summaryOf(updated);
  }

  // За тредом следят: ответивший (и всё в треде им прочитано), упомянутые в ответе и автор родителя.
  // Автора родителя, который сам отписался, обратно не подписываем.
  private async follow(tx: Tx, parent: messages, replier: string, seq: bigint, mentioned: string[]) {
    for (const user_id of new Set([replier, ...mentioned])) {
      await tx.thread_subscriptions.upsert({
        where: { user_id_parent_message_id: { user_id, parent_message_id: parent.id } },
        create: { user_id, parent_message_id: parent.id, subscribed: true, last_read_seq: user_id === replier ? seq : 0n },
        update: user_id === replier ? { subscribed: true, last_read_seq: seq } : { subscribed: true },
      });
    }
    if (parent.user_id !== replier) {
      await tx.thread_subscriptions.createMany({
        data: [{ user_id: parent.user_id, parent_message_id: parent.id }],
        skipDuplicates: true,
      });
    }
  }

  async edit(me: users, id: string, text: string): Promise<MessageDto> {
    const { msg, access } = await this.load(me, id);
    assertCanPost(me, access);
    if (msg.user_id !== me.id) throw new ForbiddenException("Править можно только свои сообщения");
    if (msg.subtype || msg.deleted_at) throw new BadRequestException("Это сообщение нельзя изменить");
    const ws = await this.prisma.workspace_settings.findUniqueOrThrow({ where: { id: 1 } });
    if (!canStillEdit(msg.created_at, ws.message_edit_window_minutes)) {
      throw new ForbiddenException("Время на правку этого сообщения вышло");
    }
    const next = text.trim();
    if (next === msg.text) return toMessageDto(msg);
    const mentions = await this.recipients(me, access.conv, next);

    const { message, event } = await this.prisma.$transaction(async (tx) => {
      await this.events.lock(tx);
      await tx.message_mentions.deleteMany({ where: { message_id: id } });
      if (mentions.size > 0) {
        await tx.message_mentions.createMany({
          data: [...mentions].map(([user_id, kind]) => ({ message_id: id, user_id, kind })),
        });
      }
      const updated = await tx.messages.update({
        where: { id },
        data: { text: next, edited_at: new Date() },
        include: MESSAGE_INCLUDE,
      });
      const message = toMessageDto(updated);
      const event = await this.events.append(tx, "message.updated", { conversationId: msg.conversation_id }, message);
      return { message, event };
    });
    this.hub.publish([event]);
    return message;
  }

  // Мягкое удаление: текст, упоминания и реакции стираются, у треда остаётся заглушка родителя.
  async remove(me: users, id: string): Promise<void> {
    const { msg, access } = await this.load(me, id);
    if (msg.deleted_at) return;
    if (msg.subtype) throw new BadRequestException("Системные сообщения не удаляются");
    const mine = msg.user_id === me.id;
    if (!mine && !isAdmin(me)) throw new ForbiddenException("Удалять чужие сообщения могут только администраторы");
    if (mine) assertMember(access);

    const events = await this.prisma.$transaction(async (tx) => {
      await this.events.lock(tx);
      await tx.messages.update({ where: { id }, data: { deleted_at: new Date(), text: "" } });
      await tx.message_mentions.deleteMany({ where: { message_id: id } });
      await tx.reactions.deleteMany({ where: { message_id: id } });
      const payload: MessageDeletedDto = {
        id,
        conversationId: msg.conversation_id,
        parentId: msg.parent_id,
        seq: Number(msg.seq),
        userId: msg.user_id,
        mentions: msg.message_mentions.map((m) => m.user_id),
      };
      const audience = { conversationId: msg.conversation_id };
      const out = [await this.events.append(tx, "message.deleted", audience, payload)];
      if (msg.parent_id) out.push(await this.events.append(tx, "thread.updated", audience, await this.recountThread(tx, msg.parent_id)));
      return out;
    });
    this.hub.publish(events);
  }

  async replies(me: users, parentId: string, q: { after?: number; limit: number }): Promise<RepliesPageDto> {
    const { msg: parent, access } = await this.load(me, parentId);
    if (parent.parent_id) throw new BadRequestException("Это ответ, а не начало треда");
    const rows = await this.prisma.messages.findMany({
      where: { parent_id: parentId, deleted_at: null, ...(q.after !== undefined ? { seq: { gt: q.after } } : {}) },
      orderBy: { seq: "asc" },
      take: q.limit + 1,
      include: MESSAGE_INCLUDE,
    });
    const hasMore = rows.length > q.limit;
    if (hasMore) rows.pop();
    const sub = access.membership
      ? await this.prisma.thread_subscriptions.findUnique({
          where: { user_id_parent_message_id: { user_id: me.id, parent_message_id: parentId } },
        })
      : null;
    return { parent: toMessageDto(parent), replies: rows.map((r) => toMessageDto(r)), hasMore, subscribed: sub?.subscribed ?? false };
  }

  async link(me: users, id: string): Promise<MessageLinkDto> {
    const { msg } = await this.load(me, id);
    if (msg.deleted_at && msg.reply_count === 0) throw new NotFoundException("Сообщение удалено");
    return { conversationId: msg.conversation_id, messageId: msg.id, parentId: msg.parent_id, seq: Number(msg.seq) };
  }

  async react(me: users, id: string, emoji: string): Promise<void> {
    const { msg, access } = await this.load(me, id);
    assertMember(access);
    if (msg.deleted_at) throw new BadRequestException("Сообщение удалено");
    const events = await this.prisma.$transaction(async (tx) => {
      await this.events.lock(tx);
      const key = { message_id_emoji_user_id: { message_id: id, emoji, user_id: me.id } };
      if (await tx.reactions.findUnique({ where: key })) return [];
      const kinds = await tx.reactions.findMany({ where: { message_id: id }, distinct: ["emoji"], select: { emoji: true } });
      if (!kinds.some((k) => k.emoji === emoji) && kinds.length >= MAX_REACTIONS_PER_MESSAGE) {
        throw new BadRequestException(`На сообщении уже ${MAX_REACTIONS_PER_MESSAGE} разных реакций`);
      }
      await tx.reactions.create({ data: { message_id: id, emoji, user_id: me.id } });
      const payload: ReactionEventDto = { conversationId: msg.conversation_id, messageId: id, parentId: msg.parent_id, emoji, userId: me.id };
      return [await this.events.append(tx, "reaction.added", { conversationId: msg.conversation_id }, payload)];
    });
    if (events.length > 0) this.hub.publish(events);
  }

  async unreact(me: users, id: string, emoji: string): Promise<void> {
    const { msg, access } = await this.load(me, id);
    assertMember(access);
    const events = await this.prisma.$transaction(async (tx) => {
      await this.events.lock(tx);
      const { count } = await tx.reactions.deleteMany({ where: { message_id: id, emoji, user_id: me.id } });
      if (count === 0) return [];
      const payload: ReactionEventDto = { conversationId: msg.conversation_id, messageId: id, parentId: msg.parent_id, emoji, userId: me.id };
      return [await this.events.append(tx, "reaction.removed", { conversationId: msg.conversation_id }, payload)];
    });
    if (events.length > 0) this.hub.publish(events);
  }

  async setSubscription(me: users, parentId: string, subscribed: boolean): Promise<void> {
    const { msg, access } = await this.load(me, parentId);
    assertMember(access);
    if (msg.parent_id) throw new BadRequestException("Это ответ, а не начало треда");
    await this.prisma.thread_subscriptions.upsert({
      where: { user_id_parent_message_id: { user_id: me.id, parent_message_id: parentId } },
      create: { user_id: me.id, parent_message_id: parentId, subscribed },
      update: { subscribed },
    });
  }

  // Курсор прочитанного в треде — только у тех, кто за ним следит (для вида «Треды» в M6).
  async markThreadRead(me: users, parentId: string, seq: number): Promise<void> {
    const { access } = await this.load(me, parentId);
    assertMember(access);
    await this.prisma.thread_subscriptions.updateMany({
      where: { user_id: me.id, parent_message_id: parentId, last_read_seq: { lt: seq } },
      data: { last_read_seq: seq },
    });
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
