import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import {
  ListMessagesQuery,
  MarkReadInput,
  SendMessageInput,
  type BootDto,
  type MessageDto,
  type MessagesPageDto,
} from "@teamchat/shared";
import { ZodPipe } from "../common/zod.pipe.js";
import { CurrentUser, SessionGuard } from "../auth/session.guard.js";
import type { users } from "../generated/prisma/client.js";
import { ConversationsService } from "./conversations.service.js";

@Controller()
@UseGuards(SessionGuard)
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get("boot")
  boot(@CurrentUser() me: users): Promise<BootDto> {
    return this.conversations.boot(me);
  }

  @Get("conversations/:id/messages")
  list(
    @CurrentUser() me: users,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query(new ZodPipe(ListMessagesQuery)) q: ListMessagesQuery,
  ): Promise<MessagesPageDto> {
    return this.conversations.listMessages(me, id, q);
  }

  @Post("conversations/:id/messages")
  send(
    @CurrentUser() me: users,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(SendMessageInput)) body: SendMessageInput,
  ): Promise<MessageDto> {
    return this.conversations.sendMessage(me, id, body);
  }

  @Post("conversations/:id/read")
  read(
    @CurrentUser() me: users,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(MarkReadInput)) body: MarkReadInput,
  ): Promise<{ lastReadSeq: number }> {
    return this.conversations.markRead(me, id, body.seq);
  }
}
