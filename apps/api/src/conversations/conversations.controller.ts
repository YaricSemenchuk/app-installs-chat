import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  AddMembersInput,
  BrowseQuery,
  CreateChannelInput,
  ListMessagesQuery,
  MarkReadInput,
  OpenDmInput,
  SendMessageInput,
  UpdateConversationInput,
  type BootDto,
  type ConversationDto,
  type DirectoryChannelDto,
  type MessageDto,
  type MessagesPageDto,
} from "@teamchat/shared";
import { ZodPipe } from "../common/zod.pipe.js";
import { CurrentUser, SessionGuard } from "../auth/session.guard.js";
import type { users } from "../generated/prisma/client.js";
import { ConversationsService } from "./conversations.service.js";
import { MessagesService } from "./messages.service.js";

const Id = new ParseUUIDPipe();

@Controller()
@UseGuards(SessionGuard)
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly messages: MessagesService,
  ) {}

  @Get("boot")
  boot(@CurrentUser() me: users): Promise<BootDto> {
    return this.conversations.boot(me);
  }

  // Порядок важен: browse и dm объявлены раньше маршрутов с :id.
  @Get("conversations/browse")
  browse(@CurrentUser() me: users, @Query(new ZodPipe(BrowseQuery)) q: BrowseQuery): Promise<DirectoryChannelDto[]> {
    return this.conversations.directory(me, q.query);
  }

  @Post("conversations")
  create(@CurrentUser() me: users, @Body(new ZodPipe(CreateChannelInput)) body: CreateChannelInput): Promise<ConversationDto> {
    return this.conversations.createChannel(me, body);
  }

  @Post("conversations/dm")
  dm(@CurrentUser() me: users, @Body(new ZodPipe(OpenDmInput)) body: OpenDmInput): Promise<ConversationDto> {
    return this.conversations.openDm(me, body.userIds);
  }

  @Get("conversations/:id")
  info(@CurrentUser() me: users, @Param("id", Id) id: string): Promise<ConversationDto> {
    return this.conversations.info(me, id);
  }

  @Patch("conversations/:id")
  update(
    @CurrentUser() me: users,
    @Param("id", Id) id: string,
    @Body(new ZodPipe(UpdateConversationInput)) body: UpdateConversationInput,
  ): Promise<ConversationDto> {
    return this.conversations.update(me, id, body);
  }

  @Post("conversations/:id/join")
  join(@CurrentUser() me: users, @Param("id", Id) id: string): Promise<ConversationDto> {
    return this.conversations.join(me, id);
  }

  @Post("conversations/:id/leave")
  @HttpCode(204)
  leave(@CurrentUser() me: users, @Param("id", Id) id: string): Promise<void> {
    return this.conversations.leave(me, id);
  }

  @Post("conversations/:id/members")
  addMembers(
    @CurrentUser() me: users,
    @Param("id", Id) id: string,
    @Body(new ZodPipe(AddMembersInput)) body: AddMembersInput,
  ): Promise<ConversationDto> {
    return this.conversations.addMembers(me, id, body.userIds);
  }

  @Delete("conversations/:id/members/:userId")
  removeMember(@CurrentUser() me: users, @Param("id", Id) id: string, @Param("userId", Id) userId: string): Promise<ConversationDto> {
    return this.conversations.removeMember(me, id, userId);
  }

  @Get("conversations/:id/messages")
  list(
    @CurrentUser() me: users,
    @Param("id", Id) id: string,
    @Query(new ZodPipe(ListMessagesQuery)) q: ListMessagesQuery,
  ): Promise<MessagesPageDto> {
    return this.messages.list(me, id, q);
  }

  @Post("conversations/:id/messages")
  send(
    @CurrentUser() me: users,
    @Param("id", Id) id: string,
    @Body(new ZodPipe(SendMessageInput)) body: SendMessageInput,
  ): Promise<MessageDto> {
    return this.messages.send(me, id, body);
  }

  @Post("conversations/:id/read")
  read(
    @CurrentUser() me: users,
    @Param("id", Id) id: string,
    @Body(new ZodPipe(MarkReadInput)) body: MarkReadInput,
  ): Promise<{ lastReadSeq: number }> {
    return this.messages.markRead(me, id, body.seq);
  }
}
