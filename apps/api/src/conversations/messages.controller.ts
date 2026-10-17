import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import {
  EditMessageInput,
  ListRepliesQuery,
  MarkReadInput,
  ReactionInput,
  ThreadSubscriptionInput,
  type MessageDto,
  type MessageLinkDto,
  type RepliesPageDto,
} from "@teamchat/shared";
import { CurrentUser, SessionGuard } from "../auth/session.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import type { users } from "../generated/prisma/client.js";
import { UnfurlsService } from "../tasks/unfurls.service.js";
import { MessagesService } from "./messages.service.js";

const Id = new ParseUUIDPipe();
const Emoji = new ZodPipe(ReactionInput.shape.emoji);

// Действия над отдельным сообщением и тредом (лента и отправка — в ConversationsController).
@Controller()
@UseGuards(SessionGuard)
export class MessagesController {
  constructor(
    private readonly messages: MessagesService,
    private readonly unfurls: UnfurlsService,
  ) {}

  @Patch("messages/:id")
  edit(
    @CurrentUser() me: users,
    @Param("id", Id) id: string,
    @Body(new ZodPipe(EditMessageInput)) body: EditMessageInput,
  ): Promise<MessageDto> {
    return this.messages.edit(me, id, body.text);
  }

  @Delete("messages/:id")
  @HttpCode(204)
  remove(@CurrentUser() me: users, @Param("id", Id) id: string): Promise<void> {
    return this.messages.remove(me, id);
  }

  // Убрать карточку ссылки (превью Figma) из своего сообщения.
  @Post("messages/:id/unfurls/:unfurlId/hide")
  @HttpCode(204)
  hideUnfurl(@CurrentUser() me: users, @Param("id", Id) id: string, @Param("unfurlId", Id) unfurlId: string, @Body() _body: unknown): Promise<void> {
    return this.unfurls.hide(me, id, unfurlId);
  }

  @Get("messages/:id/link")
  link(@CurrentUser() me: users, @Param("id", Id) id: string): Promise<MessageLinkDto> {
    return this.messages.link(me, id);
  }

  @Get("messages/:id/replies")
  replies(
    @CurrentUser() me: users,
    @Param("id", Id) id: string,
    @Query(new ZodPipe(ListRepliesQuery)) q: ListRepliesQuery,
  ): Promise<RepliesPageDto> {
    return this.messages.replies(me, id, q);
  }

  @Post("messages/:id/reactions")
  @HttpCode(204)
  react(
    @CurrentUser() me: users,
    @Param("id", Id) id: string,
    @Body(new ZodPipe(ReactionInput)) body: ReactionInput,
  ): Promise<void> {
    return this.messages.react(me, id, body.emoji);
  }

  @Delete("messages/:id/reactions/:emoji")
  @HttpCode(204)
  unreact(@CurrentUser() me: users, @Param("id", Id) id: string, @Param("emoji", Emoji) emoji: string): Promise<void> {
    return this.messages.unreact(me, id, emoji);
  }

  @Put("threads/:parentId/subscription")
  @HttpCode(204)
  subscribe(
    @CurrentUser() me: users,
    @Param("parentId", Id) parentId: string,
    @Body(new ZodPipe(ThreadSubscriptionInput)) body: ThreadSubscriptionInput,
  ): Promise<void> {
    return this.messages.setSubscription(me, parentId, body.subscribed);
  }

  @Post("threads/:parentId/read")
  @HttpCode(204)
  read(
    @CurrentUser() me: users,
    @Param("parentId", Id) parentId: string,
    @Body(new ZodPipe(MarkReadInput)) body: MarkReadInput,
  ): Promise<void> {
    return this.messages.markThreadRead(me, parentId, body.seq);
  }
}
