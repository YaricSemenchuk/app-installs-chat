// Кого уведомить о новом сообщении — решается здесь и только здесь (architecture.md → «Уведомления»).
// Сервер шлёт эфемерное событие notification в комнату человека; клиент показывает его, только если
// этот разговор сейчас не перед глазами. Офлайн уведомление теряется — так и задумано (без web push).
import { Injectable, Logger } from "@nestjs/common";
import { NOTIFICATION_EVENT, markupToPlainText, type MessageDto, type NotificationDto } from "@teamchat/shared";
import { PrismaService } from "../db/prisma.service.js";
import type { conversations } from "../generated/prisma/client.js";
import { RealtimeHub } from "../realtime/hub.service.js";
import { toPreferencesDto } from "./preferences.service.js";

const PREVIEW_MAX = 180;

export type Reason = NotificationDto["reason"];

@Injectable()
export class NotificationsService {
  private readonly log = new Logger("notifications");

  constructor(
    private readonly prisma: PrismaService,
    private readonly hub: RealtimeHub,
  ) {}

  // Вызывается после коммита и не держит ответ отправителю: ошибка здесь не должна терять сообщение.
  afterMessage(message: MessageDto, conv: conversations, mentioned: Set<string>): void {
    void this.notify(message, conv, mentioned).catch((err: Error) => this.log.warn(`notify ${message.id}: ${err.message}`));
  }

  private async notify(message: MessageDto, conv: conversations, mentioned: Set<string>): Promise<void> {
    if (message.subtype !== null) return;
    const members = await this.prisma.conversation_members.findMany({
      where: { conversation_id: conv.id, user_id: { not: message.userId }, users: { deactivated_at: null } },
      select: { user_id: true, users: { select: { user_preferences: true } } },
    });
    if (members.length === 0) return;

    const followers = message.parentId
      ? new Set(
          (
            await this.prisma.thread_subscriptions.findMany({
              where: { parent_message_id: message.parentId, subscribed: true },
              select: { user_id: true },
            })
          ).map((s) => s.user_id),
        )
      : new Set<string>();

    const isDm = conv.kind === "dm" || conv.kind === "group_dm";
    const inFeed = !message.parentId || message.alsoInChannel;
    const names = await this.names(conv, message);

    for (const m of members) {
      const prefs = toPreferencesDto(m.users.user_preferences);
      const reason = decide({
        isDm,
        inFeed,
        mentioned: mentioned.has(m.user_id),
        following: followers.has(m.user_id),
        prefs,
      });
      if (!reason) continue;
      const payload: NotificationDto = {
        messageId: message.id,
        conversationId: conv.id,
        parentId: message.parentId,
        authorId: message.userId,
        reason,
        title: names.title(m.user_id),
        body: prefs.showMessagePreview ? names.body : "Новое сообщение",
        sound: prefs.sound,
      };
      this.hub.toUser(m.user_id, NOTIFICATION_EVENT, payload);
    }
  }

  // Заголовок и текст: «#канал» и «Вера: текст», в ЛС — имя собеседника и сам текст, в треде — «Тред в #канал».
  private async names(conv: conversations, message: MessageDto) {
    const memberIds = (await this.prisma.conversation_members.findMany({ where: { conversation_id: conv.id }, select: { user_id: true } })).map(
      (m) => m.user_id,
    );
    const users = await this.prisma.users.findMany({ where: { id: { in: [...memberIds, ...mentionIds(message.text)] } } });
    const nameOf = (id: string) => {
      const u = users.find((x) => x.id === id);
      return u ? u.display_name || u.real_name || u.email : "кто-то";
    };
    const channelIds = [...message.text.matchAll(/<#([0-9a-f-]{36})>/g)].map((m) => m[1]!);
    const channels = channelIds.length
      ? await this.prisma.conversations.findMany({ where: { id: { in: channelIds } }, select: { id: true, name: true, kind: true } })
      : [];
    const text = markupToPlainText(message.text, {
      user: nameOf,
      channel: (id) => {
        const c = channels.find((x) => x.id === id);
        return c && c.kind === "public" && c.name ? c.name : "канал";
      },
    })
      .replace(/\s+/g, " ")
      .trim();
    const files = message.files.map((f) => f.name);
    const preview = text || (files.length ? `📎 ${files.join(", ")}` : "");
    const short = preview.length > PREVIEW_MAX ? `${preview.slice(0, PREVIEW_MAX - 1)}…` : preview;
    const author = nameOf(message.userId);
    const thread = message.parentId && !message.alsoInChannel;

    return {
      body: conv.kind === "dm" ? short : `${author}: ${short}`,
      title: (recipient: string) => {
        if (conv.kind === "public" || conv.kind === "private") return thread ? `Тред в #${conv.name}` : `#${conv.name}`;
        if (conv.kind === "dm") return thread ? `Тред: ${author}` : author;
        const others = memberIds.filter((id) => id !== recipient).map(nameOf);
        return thread ? `Тред: ${others.join(", ")}` : others.join(", ");
      },
    };
  }
}

// Правила по порядку: «ничего» и выключенные уведомления — тишина; ЛС и упоминания — всегда;
// ответ в треде, за которым следишь, — если не выключены; остальное в канале — только на уровне «всё».
export function decide(o: {
  isDm: boolean;
  inFeed: boolean;
  mentioned: boolean;
  following: boolean;
  prefs: { notifyLevel: string; desktopNotifications: boolean; notifyThreadReplies: boolean };
}): Reason | null {
  if (!o.prefs.desktopNotifications || o.prefs.notifyLevel === "nothing") return null;
  if (o.isDm) return "dm";
  if (o.mentioned) return "mention";
  if (o.following && o.prefs.notifyThreadReplies) return "thread_reply";
  if (o.inFeed && o.prefs.notifyLevel === "all") return "message";
  return null;
}

const mentionIds = (text: string) => [...text.matchAll(/<@([0-9a-f-]{36})>/g)].map((m) => m[1]!);
