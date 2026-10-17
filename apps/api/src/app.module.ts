import { Module } from "@nestjs/common";
import { AuthController } from "./auth/auth.controller.js";
import { AuthService } from "./auth/auth.service.js";
import { GoogleAuthService } from "./auth/google.service.js";
import { MailService } from "./auth/mail.service.js";
import { SessionGuard } from "./auth/session.guard.js";
import { BootstrapService } from "./bootstrap.service.js";
import { ConversationsController } from "./conversations/conversations.controller.js";
import { MessagesController } from "./conversations/messages.controller.js";
import { ConversationsService } from "./conversations/conversations.service.js";
import { MessagesService } from "./conversations/messages.service.js";
import { MembershipService } from "./conversations/membership.service.js";
import { PrismaService } from "./db/prisma.service.js";
import { FilesController } from "./files/files.controller.js";
import { FilesService } from "./files/files.service.js";
import { StorageService } from "./files/storage.js";
import { HealthController } from "./health.controller.js";
import { InvitesController } from "./invites/invites.controller.js";
import { InvitesService } from "./invites/invites.service.js";
import { EventsService } from "./realtime/events.service.js";
import { RealtimeHub } from "./realtime/hub.service.js";
import { PresenceService } from "./realtime/presence.service.js";
import { RealtimeGateway } from "./realtime/realtime.gateway.js";
import { SearchController } from "./search/search.controller.js";
import { SearchService } from "./search/search.service.js";
import { UsersController } from "./users/users.controller.js";
import { UsersService } from "./users/users.service.js";

@Module({
  controllers: [AuthController, ConversationsController, MessagesController, FilesController, SearchController, InvitesController, UsersController, HealthController],
  providers: [
    PrismaService,
    MailService,
    AuthService,
    GoogleAuthService,
    SessionGuard,
    EventsService,
    RealtimeHub,
    PresenceService,
    RealtimeGateway,
    MembershipService,
    InvitesService,
    ConversationsService,
    MessagesService,
    StorageService,
    FilesService,
    SearchService,
    UsersService,
    BootstrapService,
  ],
})
export class AppModule {}
