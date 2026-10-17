import { Body, Controller, Get, Patch, UseGuards } from "@nestjs/common";
import { UpdatePreferencesInput, type DesktopInfoDto, type PreferencesDto } from "@teamchat/shared";
import { CurrentUser, SessionGuard } from "../auth/session.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { config } from "../config.js";
import type { users } from "../generated/prisma/client.js";
import { PreferencesService } from "./preferences.service.js";

@Controller()
export class NotificationsController {
  constructor(private readonly preferences: PreferencesService) {}

  @Get("me/preferences")
  @UseGuards(SessionGuard)
  get(@CurrentUser() me: users): Promise<PreferencesDto> {
    return this.preferences.get(me);
  }

  @Patch("me/preferences")
  @UseGuards(SessionGuard)
  update(@CurrentUser() me: users, @Body(new ZodPipe(UpdatePreferencesInput)) body: UpdatePreferencesInput): Promise<PreferencesDto> {
    return this.preferences.update(me, body);
  }

  // Публично: страницу /download открывают и до входа.
  @Get("desktop")
  desktop(): DesktopInfoDto {
    return { version: config.DESKTOP_VERSION ?? null, macUrl: config.DESKTOP_MAC_URL ?? null, winUrl: config.DESKTOP_WIN_URL ?? null };
  }
}
