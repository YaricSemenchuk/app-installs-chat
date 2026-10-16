import { Injectable } from "@nestjs/common";
import type { EventDto } from "@teamchat/shared";
import { toMessageDto, toUserDto } from "../common/mappers.js";
import { PrismaService, type Tx } from "../db/prisma.service.js";
import type { users } from "../generated/prisma/client.js";
import { EventsService } from "../realtime/events.service.js";
import { RealtimeHub } from "../realtime/hub.service.js";

// Новые люди и их вступление в каналы.
@Injectable()
export class MembershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly hub: RealtimeHub,
  ) {}

  // Создаёт участника (вход по разрешённому домену) и добавляет в #general и каналы по умолчанию.
  async createMember(email: string): Promise<users> {
    const { user, published } = await this.prisma.$transaction(async (tx) => {
      await this.events.lock(tx);
      const user = await tx.users.create({
        data: { email, display_name: email.split("@")[0] ?? email, user_preferences: { create: {} } },
      });
      const published: EventDto[] = [await this.events.append(tx, "user.created", { broadcast: true }, toUserDto(user))];
      const channels = await tx.conversations.findMany({
        where: { kind: "public", archived_at: null, OR: [{ is_general: true }, { is_default: true }] },
      });
      for (const ch of channels) published.push(...(await this.join(tx, ch.id, user.id)));
      return { user, published };
    });
    for (const ev of published) {
      if (ev.kind === "member.joined") this.hub.joinConversation(user.id, ev.payload.conversationId);
    }
    this.hub.publish(published);
    return user;
  }

  // Вступление: строка участия, системное сообщение «вступил(а) в канал» и события. Вызывать под lock().
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
}
