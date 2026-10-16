import { ForbiddenException, Injectable } from "@nestjs/common";
import type { EventDto } from "@teamchat/shared";
import { toMessageDto, toUserDto } from "../common/mappers.js";
import { PrismaService, type Tx } from "../db/prisma.service.js";
import type { users } from "../generated/prisma/client.js";
import { EventsService } from "../realtime/events.service.js";
import { RealtimeHub } from "../realtime/hub.service.js";

export type NewMember = {
  email: string;
  displayName?: string;
  googleSub?: string;
  // Приглашение тратит одно использование в той же транзакции, что и создание человека.
  inviteId?: string;
};

// Люди и их участие в каналах: вступление, выход, деактивация.
@Injectable()
export class MembershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly hub: RealtimeHub,
  ) {}

  async createMember(input: NewMember): Promise<users> {
    const { user, published } = await this.prisma.$transaction(async (tx) => {
      await this.events.lock(tx);

      let role = "member";
      let inviteChannels: string[] = [];
      if (input.inviteId) {
        const used = await tx.$queryRaw<{ role: string; channel_ids: string[]; email: string | null }[]>`
          update invites set use_count = use_count + 1
           where id = ${input.inviteId}::uuid and revoked_at is null and expires_at > now() and use_count < max_uses
          returning role, channel_ids, email`;
        const invite = used[0];
        if (!invite || (invite.email && invite.email.toLowerCase() !== input.email)) {
          throw new ForbiddenException("Приглашение уже недействительно. Попросите новое");
        }
        role = invite.role;
        inviteChannels = invite.channel_ids;
      }

      const user = await tx.users.create({
        data: {
          email: input.email,
          role,
          google_sub: input.googleSub ?? null,
          display_name: input.displayName?.slice(0, 80) || (input.email.split("@")[0] ?? input.email),
          user_preferences: { create: {} },
        },
      });
      if (input.inviteId) {
        await tx.invites.updateMany({
          where: { id: input.inviteId, accepted_user_id: null },
          data: { accepted_user_id: user.id },
        });
      }

      const published: EventDto[] = [await this.events.append(tx, "user.created", { broadcast: true }, toUserDto(user))];
      published.push(...(await this.joinDefaults(tx, user.id, inviteChannels)));
      return { user, published };
    });
    this.publishWithRooms(published);
    return user;
  }

  // #general, каналы по умолчанию и каналы из приглашения (только открытые и не в архиве).
  async joinDefaults(tx: Tx, userId: string, extraChannelIds: string[] = []): Promise<EventDto[]> {
    const channels = await tx.conversations.findMany({
      where: {
        kind: "public",
        archived_at: null,
        OR: [{ is_general: true }, { is_default: true }, { id: { in: extraChannelIds } }],
        conversation_members: { none: { user_id: userId } },
      },
    });
    const out: EventDto[] = [];
    for (const ch of channels) out.push(...(await this.join(tx, ch.id, userId)));
    return out;
  }

  // Вступление: строка участия, системное сообщение «теперь в канале» и события. Вызывать под lock().
  async join(tx: Tx, conversationId: string, userId: string): Promise<EventDto[]> {
    await tx.conversation_members.create({ data: { conversation_id: conversationId, user_id: userId } });
    const msg = await tx.messages.create({
      data: { conversation_id: conversationId, user_id: userId, subtype: "join" },
    });
    // Своё системное сообщение не делает канал непрочитанным.
    await tx.conversation_members.update({
      where: { conversation_id_user_id: { conversation_id: conversationId, user_id: userId } },
      data: { last_read_seq: msg.seq },
    });
    return [
      await this.events.append(tx, "member.joined", { conversationId }, { conversationId, userId }),
      await this.events.append(tx, "message.created", { conversationId }, toMessageDto(msg)),
    ];
  }

  // Выход из всех каналов (при деактивации). ЛС не трогаем: переписка остаётся у собеседника. Вызывать под lock().
  async leaveAllChannels(tx: Tx, userId: string): Promise<EventDto[]> {
    const memberships = await tx.conversation_members.findMany({
      where: { user_id: userId, conversations: { kind: { in: ["public", "private"] } } },
      select: { conversation_id: true },
    });
    const out: EventDto[] = [];
    for (const { conversation_id: conversationId } of memberships) {
      await tx.conversation_members.delete({
        where: { conversation_id_user_id: { conversation_id: conversationId, user_id: userId } },
      });
      out.push(await this.events.append(tx, "member.left", { conversationId }, { conversationId, userId }));
    }
    return out;
  }

  // Публикация после коммита + сокеты человека входят в новые комнаты / выходят из старых.
  publishWithRooms(published: EventDto[]): void {
    for (const ev of published) {
      if (ev.kind === "member.joined") this.hub.joinConversation(ev.payload.userId, ev.payload.conversationId);
    }
    this.hub.publish(published);
    for (const ev of published) {
      if (ev.kind === "member.left") this.hub.leaveConversation(ev.payload.userId, ev.payload.conversationId);
    }
  }
}
