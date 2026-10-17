// Личные настройки уведомлений (S34). Строки нет — действуют значения по умолчанию.
import { Injectable } from "@nestjs/common";
import { DEFAULT_PREFERENCES, type NotifyLevel, type PreferencesDto, type UpdatePreferencesInput } from "@teamchat/shared";
import { PrismaService } from "../db/prisma.service.js";
import type { user_preferences, users } from "../generated/prisma/client.js";
import { EventsService } from "../realtime/events.service.js";
import { RealtimeHub } from "../realtime/hub.service.js";

export function toPreferencesDto(p: user_preferences | null | undefined): PreferencesDto {
  if (!p) return { ...DEFAULT_PREFERENCES };
  return {
    notifyLevel: p.notify_level as NotifyLevel,
    desktopNotifications: p.desktop_notifications,
    notifyThreadReplies: p.notify_thread_replies,
    showMessagePreview: p.show_message_preview,
    sound: p.notification_sound !== "none",
  };
}

@Injectable()
export class PreferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly hub: RealtimeHub,
  ) {}

  async get(me: users): Promise<PreferencesDto> {
    return toPreferencesDto(await this.prisma.user_preferences.findUnique({ where: { user_id: me.id } }));
  }

  // Изменения расходятся по остальным устройствам человека событием preferences.updated.
  async update(me: users, input: UpdatePreferencesInput): Promise<PreferencesDto> {
    const data = {
      ...(input.notifyLevel !== undefined && { notify_level: input.notifyLevel }),
      ...(input.desktopNotifications !== undefined && { desktop_notifications: input.desktopNotifications }),
      ...(input.notifyThreadReplies !== undefined && { notify_thread_replies: input.notifyThreadReplies }),
      ...(input.showMessagePreview !== undefined && { show_message_preview: input.showMessagePreview }),
      ...(input.sound !== undefined && { notification_sound: input.sound ? "default" : "none" }),
    };
    const { dto, event } = await this.prisma.$transaction(async (tx) => {
      await this.events.lock(tx);
      const row = await tx.user_preferences.upsert({ where: { user_id: me.id }, create: { user_id: me.id, ...data }, update: data });
      const dto = toPreferencesDto(row);
      return { dto, event: await this.events.append(tx, "preferences.updated", { userId: me.id }, dto) };
    });
    this.hub.publish([event]);
    return dto;
  }
}
