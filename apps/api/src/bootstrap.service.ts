import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { config } from "./config.js";
import { PrismaService } from "./db/prisma.service.js";
import { EventsService } from "./realtime/events.service.js";

// Первый запуск: настройки рабочего пространства, первый владелец и #general. Идемпотентно.
@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly log = new Logger("Bootstrap");

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.events.lock(tx);

      const ws = await tx.workspace_settings.findUnique({ where: { id: 1 } });
      if (!ws) {
        await tx.workspace_settings.create({
          data: { name: config.WORKSPACE_NAME, allowed_email_domains: config.ALLOWED_EMAIL_DOMAINS },
        });
        this.log.log(`workspace «${config.WORKSPACE_NAME}» created`);
      }

      let owner = await tx.users.findFirst({ where: { role: "primary_owner" } });
      if (!owner) {
        const email = config.BOOTSTRAP_OWNER_EMAIL;
        owner = await tx.users.create({
          data: {
            email,
            role: "primary_owner",
            display_name: email.split("@")[0] ?? email,
            user_preferences: { create: {} },
          },
        });
        this.log.log(`primary owner ${email} created`);
      }

      const general = await tx.conversations.findFirst({ where: { is_general: true } });
      if (!general) {
        await tx.conversations.create({
          data: {
            kind: "public",
            name: "general",
            is_general: true,
            is_default: true,
            purpose: "Общий канал для всей команды",
            created_by: owner.id,
            conversation_members: { create: { user_id: owner.id } },
          },
        });
        this.log.log("#general created");
      }
    });
  }
}
