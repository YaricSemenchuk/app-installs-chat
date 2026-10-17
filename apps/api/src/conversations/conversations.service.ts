import { BadRequestException, ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import type {
  BootDto,
  ConversationDto,
  CreateChannelInput,
  DirectoryChannelDto,
  EventDto,
  UpdateConversationInput,
} from "@teamchat/shared";
import { toConversationInfoDto, toMessageDto, toUserDto } from "../common/mappers.js";
import { PrismaService, type Tx } from "../db/prisma.service.js";
import { Prisma, type conversations, type users } from "../generated/prisma/client.js";
import { EventsService } from "../realtime/events.service.js";
import { PresenceService } from "../realtime/presence.service.js";
import { assertMember, canManage, isAdmin, isChannel, loadAccess } from "./access.js";
import { MembershipService } from "./membership.service.js";

type CountsRow = { conversation_id: string; last_read_seq: bigint; latest_seq: bigint; unread: bigint; mentions: bigint };

const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly membership: MembershipService,
    private readonly presence: PresenceService,
  ) {}

  // Непрочитанное и упоминания по моим разговорам одним запросом.
  private counts(userId: string, conversationId?: string) {
    return this.prisma.$queryRaw<CountsRow[]>`
      select cm.conversation_id,
             cm.last_read_seq,
             coalesce((select max(m.seq) from messages m where m.conversation_id = cm.conversation_id), 0) as latest_seq,
             (select count(*) from messages m
               where m.conversation_id = cm.conversation_id
                 and m.seq > cm.last_read_seq
                 and (m.parent_id is null or m.also_in_channel)
                 and m.user_id <> cm.user_id
                 and m.deleted_at is null
                 and m.subtype is null) as unread,
             (select count(*) from message_mentions mm join messages m on m.id = mm.message_id
               where mm.user_id = cm.user_id
                 and m.conversation_id = cm.conversation_id
                 and m.seq > cm.last_read_seq
                 and m.deleted_at is null) as mentions
        from conversation_members cm
       where cm.user_id = ${userId}::uuid
         and (${conversationId ?? null}::uuid is null or cm.conversation_id = ${conversationId ?? null}::uuid)`;
  }

  private toDto(c: conversations & { conversation_members: { user_id: string; is_manager: boolean }[] }, me: string, row?: CountsRow): ConversationDto {
    const mine = c.conversation_members.find((m) => m.user_id === me);
    return {
      ...toConversationInfoDto(c),
      memberIds: c.conversation_members.map((m) => m.user_id),
      isMember: Boolean(mine),
      isManager: Boolean(mine?.is_manager),
      lastReadSeq: Number(row?.last_read_seq ?? 0),
      latestSeq: Number(row?.latest_seq ?? 0),
      unreadCount: Number(row?.unread ?? 0),
      mentionCount: Number(row?.mentions ?? 0),
    };
  }

  async boot(me: users): Promise<BootDto> {
    // Сначала курсор журнала, потом состояние: всё, что закоммитится между ними, клиент догрузит
    // по событиям и применит идемпотентно.
    const [{ last }] = await this.prisma.$queryRaw<[{ last: bigint }]>`select coalesce(max(id), 0) as last from events`;

    const [ws, users, memberships, counts] = await Promise.all([
      this.prisma.workspace_settings.findUniqueOrThrow({ where: { id: 1 } }),
      this.prisma.users.findMany({ orderBy: { display_name: "asc" } }),
      this.prisma.conversation_members.findMany({
        where: { user_id: me.id },
        include: { conversations: { include: { conversation_members: { select: { user_id: true, is_manager: true } } } } },
      }),
      this.counts(me.id),
    ]);

    const byId = new Map(counts.map((r) => [r.conversation_id, r]));
    // ЛС показываем, если человек его не закрывал или там есть непрочитанное.
    const conversations = memberships
      .filter((m) => isChannel(m.conversations) || m.is_open || Number(byId.get(m.conversation_id)?.unread ?? 0) > 0)
      .map((m) => this.toDto(m.conversations, me.id, byId.get(m.conversation_id)));

    return {
      me: toUserDto(me),
      workspace: { name: ws.name, whoCanInvite: ws.who_can_invite === "admins" ? "admins" : "everyone" },
      users: users.map(toUserDto),
      conversations,
      presence: this.presence.snapshot(),
      lastEventId: Number(last),
    };
  }

  async info(me: users, id: string): Promise<ConversationDto> {
    await loadAccess(this.prisma, me, id);
    const [conv, rows] = await Promise.all([
      this.prisma.conversations.findUniqueOrThrow({
        where: { id },
        include: { conversation_members: { select: { user_id: true, is_manager: true } } },
      }),
      this.counts(me.id, id),
    ]);
    return this.toDto(conv, me.id, rows[0]);
  }

  async directory(me: users, query?: string): Promise<DirectoryChannelDto[]> {
    const rows = await this.prisma.conversations.findMany({
      where: { kind: "public", ...(query ? { name: { contains: query.toLowerCase() } } : {}) },
      include: { conversation_members: { select: { user_id: true } } },
      orderBy: [{ archived_at: { sort: "desc", nulls: "first" } }, { name: "asc" }],
      take: 200,
    });
    return rows.map((c) => ({
      ...toConversationInfoDto(c),
      memberCount: c.conversation_members.length,
      isMember: c.conversation_members.some((m) => m.user_id === me.id),
    }));
  }

  private async activeUsers(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const found = await this.prisma.users.findMany({ where: { id: { in: ids }, deactivated_at: null }, select: { id: true } });
    if (found.length !== new Set(ids).size) throw new BadRequestException("Кого-то из выбранных нет или его аккаунт отключён");
    return found.map((u) => u.id);
  }

  async createChannel(me: users, input: CreateChannelInput): Promise<ConversationDto> {
    const ws = await this.prisma.workspace_settings.findUniqueOrThrow({ where: { id: 1 } });
    if (ws.who_can_create_channels === "admins" && !isAdmin(me)) {
      throw new ForbiddenException("Создавать каналы могут только администраторы");
    }
    const others = (await this.activeUsers(input.memberIds)).filter((id) => id !== me.id);
    try {
      const { conv, published } = await this.prisma.$transaction(async (tx) => {
        await this.events.lock(tx);
        const conv = await tx.conversations.create({
          data: { kind: input.kind, name: input.name, purpose: input.purpose, created_by: me.id },
        });
        const published = await this.membership.join(tx, conv.id, me.id);
        await tx.conversation_members.update({
          where: { conversation_id_user_id: { conversation_id: conv.id, user_id: me.id } },
          data: { is_manager: true },
        });
        for (const id of others) published.push(...(await this.membership.join(tx, conv.id, id)));
        return { conv, published };
      });
      this.membership.publishWithRooms(published);
      return this.info(me, conv.id);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(`Канал #${input.name} уже есть. Выберите другое название`);
      throw err;
    }
  }

  // Системное сообщение об изменении (тема, описание, название) + событие, под lock().
  private async systemMessage(tx: Tx, conversationId: string, userId: string, subtype: string, text = ""): Promise<EventDto> {
    const msg = await tx.messages.create({ data: { conversation_id: conversationId, user_id: userId, subtype, text } });
    return this.events.append(tx, "message.created", { conversationId }, toMessageDto(msg));
  }

  async update(me: users, id: string, input: UpdateConversationInput): Promise<ConversationDto> {
    const access = await loadAccess(this.prisma, me, id);
    assertMember(access);
    const { conv } = access;
    if (!isChannel(conv)) throw new BadRequestException("У личной переписки нет названия и темы");
    if (conv.archived_at) throw new ForbiddenException("Канал в архиве");
    const rename = input.name !== undefined && input.name !== conv.name;
    if (rename && !canManage(me, access)) throw new ForbiddenException("Переименовать канал может его менеджер или администратор");

    try {
      const published = await this.prisma.$transaction(async (tx) => {
        await this.events.lock(tx);
        const out: EventDto[] = [];
        const data: Prisma.conversationsUpdateInput = {};
        if (rename) {
          data.name = input.name;
          out.push(await this.systemMessage(tx, id, me.id, "rename", input.name));
        }
        if (input.topic !== undefined && input.topic !== conv.topic) {
          Object.assign(data, { topic: input.topic, topic_set_at: new Date() });
          data.users_conversations_topic_set_byTousers = { connect: { id: me.id } };
          out.push(await this.systemMessage(tx, id, me.id, "topic", input.topic));
        }
        if (input.purpose !== undefined && input.purpose !== conv.purpose) {
          data.purpose = input.purpose;
          out.push(await this.systemMessage(tx, id, me.id, "purpose", input.purpose));
        }
        if (out.length === 0) return out;
        const updated = await tx.conversations.update({ where: { id }, data });
        out.push(await this.events.append(tx, "conversation.updated", { conversationId: id }, toConversationInfoDto(updated)));
        return out;
      });
      this.membership.publishWithRooms(published);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(`Канал #${input.name} уже есть`);
      throw err;
    }
    return this.info(me, id);
  }

  async join(me: users, id: string): Promise<ConversationDto> {
    const { conv, membership } = await loadAccess(this.prisma, me, id);
    if (membership) return this.info(me, id);
    if (conv.kind !== "public") throw new ForbiddenException("В закрытый канал можно попасть только по приглашению участника");
    if (conv.archived_at) throw new ForbiddenException("Канал в архиве");
    const published = await this.prisma.$transaction(async (tx) => {
      await this.events.lock(tx);
      return this.membership.join(tx, id, me.id);
    });
    this.membership.publishWithRooms(published);
    return this.info(me, id);
  }

  async leave(me: users, id: string): Promise<void> {
    const access = await loadAccess(this.prisma, me, id);
    assertMember(access);
    if (access.conv.is_general) throw new ForbiddenException("Из общего канала выйти нельзя");
    if (!isChannel(access.conv)) throw new BadRequestException("Личную переписку можно скрыть, но не покинуть");
    const published = await this.prisma.$transaction(async (tx) => {
      await this.events.lock(tx);
      return this.membership.leave(tx, id, me.id);
    });
    this.membership.publishWithRooms(published);
  }

  async addMembers(me: users, id: string, userIds: string[]): Promise<ConversationDto> {
    const access = await loadAccess(this.prisma, me, id);
    assertMember(access);
    if (!isChannel(access.conv)) throw new BadRequestException("В личную переписку людей не добавляют: начните новую");
    if (access.conv.archived_at) throw new ForbiddenException("Канал в архиве");
    const ids = await this.activeUsers(userIds);
    const published = await this.prisma.$transaction(async (tx) => {
      await this.events.lock(tx);
      const present = new Set(
        (await tx.conversation_members.findMany({ where: { conversation_id: id, user_id: { in: ids } }, select: { user_id: true } })).map(
          (m) => m.user_id,
        ),
      );
      const out: EventDto[] = [];
      for (const uid of ids) if (!present.has(uid)) out.push(...(await this.membership.join(tx, id, uid)));
      return out;
    });
    this.membership.publishWithRooms(published);
    return this.info(me, id);
  }

  async removeMember(me: users, id: string, userId: string): Promise<ConversationDto> {
    const access = await loadAccess(this.prisma, me, id);
    assertMember(access);
    if (userId === me.id) throw new BadRequestException("Чтобы выйти самому, используйте «Покинуть канал»");
    if (access.conv.is_general) throw new ForbiddenException("Из общего канала никого не удаляют");
    if (!isChannel(access.conv) || !canManage(me, access)) {
      throw new ForbiddenException("Удалять из канала может его менеджер или администратор");
    }
    const published = await this.prisma.$transaction(async (tx) => {
      await this.events.lock(tx);
      return this.membership.leave(tx, id, userId);
    });
    this.membership.publishWithRooms(published);
    return this.info(me, id);
  }

  // ЛС и групповые ЛС: один разговор на набор людей. Собеседникам он появится с первым сообщением.
  async openDm(me: users, userIds: string[]): Promise<ConversationDto> {
    const ids = [...new Set([me.id, ...(await this.activeUsers(userIds.filter((u) => u !== me.id)))])].sort();
    const dmKey = ids.join(",");
    const existing = await this.prisma.conversations.findUnique({ where: { dm_key: dmKey } });
    if (existing) {
      await this.prisma.conversation_members.updateMany({
        where: { conversation_id: existing.id, user_id: me.id, is_open: false },
        data: { is_open: true },
      });
      return this.info(me, existing.id);
    }
    try {
      const { conv, published } = await this.prisma.$transaction(async (tx) => {
        await this.events.lock(tx);
        const conv = await tx.conversations.create({
          data: { kind: ids.length > 2 ? "group_dm" : "dm", dm_key: dmKey, created_by: me.id },
        });
        const published: EventDto[] = [];
        for (const uid of ids) {
          await tx.conversation_members.create({ data: { conversation_id: conv.id, user_id: uid, is_open: uid === me.id } });
          published.push(await this.events.append(tx, "member.joined", { conversationId: conv.id }, { conversationId: conv.id, userId: uid }));
        }
        return { conv, published };
      });
      this.membership.publishWithRooms(published);
      return this.info(me, conv.id);
    } catch (err) {
      // Два одновременных открытия одного ЛС: второй получает уже созданный.
      if (isUniqueViolation(err)) return this.openDm(me, userIds);
      throw err;
    }
  }
}
