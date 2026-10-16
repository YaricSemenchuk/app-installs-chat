import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import {
  InviteCreateInput,
  InviteLinkInput,
  type InviteDto,
  type InviteLinkDto,
  type InvitePreviewDto,
  type InviteResultDto,
} from "@teamchat/shared";
import { CurrentUser, SessionGuard } from "../auth/session.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import type { users } from "../generated/prisma/client.js";
import { InvitesService } from "./invites.service.js";

@Controller("invites")
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  // Публичный: страница /invite/:token показывает, кто и куда зовёт.
  @Get("preview/:token")
  preview(@Param("token") token: string): Promise<InvitePreviewDto> {
    return this.invites.preview(token);
  }

  @Post()
  @UseGuards(SessionGuard)
  create(@CurrentUser() me: users, @Body(new ZodPipe(InviteCreateInput)) body: InviteCreateInput): Promise<InviteResultDto> {
    return this.invites.create(me, body);
  }

  @Post("link")
  @UseGuards(SessionGuard)
  link(@CurrentUser() me: users, @Body(new ZodPipe(InviteLinkInput)) body: InviteLinkInput): Promise<InviteLinkDto> {
    return this.invites.createLink(me, body);
  }

  @Get()
  @UseGuards(SessionGuard)
  list(@CurrentUser() me: users): Promise<InviteDto[]> {
    return this.invites.listActive(me);
  }

  @Delete(":id")
  @HttpCode(204)
  @UseGuards(SessionGuard)
  revoke(@CurrentUser() me: users, @Param("id", new ParseUUIDPipe()) id: string): Promise<void> {
    return this.invites.revoke(me, id);
  }
}
