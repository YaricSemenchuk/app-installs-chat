import { Module } from "@nestjs/common";
import { AuthController } from "./auth/auth.controller.js";
import { AuthService } from "./auth/auth.service.js";
import { MailService } from "./auth/mail.service.js";
import { SessionGuard } from "./auth/session.guard.js";
import { BootstrapService } from "./bootstrap.service.js";
import { ConversationsController } from "./conversations/conversations.controller.js";
import { ConversationsService } from "./conversations/conversations.service.js";
import { MembershipService } from "./conversations/membership.service.js";
import { PrismaService } from "./db/prisma.service.js";
import { HealthController } from "./health.controller.js";
import { EventsService } from "./realtime/events.service.js";
import { RealtimeHub } from "./realtime/hub.service.js";
import { RealtimeGateway } from "./realtime/realtime.gateway.js";

@Module({
  controllers: [AuthController, ConversationsController, HealthController],
  providers: [
    PrismaService,
    MailService,
    AuthService,
    SessionGuard,
    EventsService,
    RealtimeHub,
    RealtimeGateway,
    MembershipService,
    ConversationsService,
    BootstrapService,
  ],
})
export class AppModule {}
