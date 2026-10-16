import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from "@nestjs/common";
import { EmailStartInput, EmailVerifyInput, type UserDto } from "@teamchat/shared";
import type { Request, Response } from "express";
import { toUserDto } from "../common/mappers.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { isProd } from "../config.js";
import { RealtimeHub } from "../realtime/hub.service.js";
import { AuthService, SESSION_TTL_MS } from "./auth.service.js";
import { CurrentSession, SESSION_COOKIE, SessionGuard } from "./session.guard.js";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly hub: RealtimeHub,
  ) {}

  @Post("email/start")
  @HttpCode(204)
  async start(@Body(new ZodPipe(EmailStartInput)) body: EmailStartInput): Promise<void> {
    await this.auth.startEmail(body.email);
  }

  @Post("email/verify")
  async verify(
    @Body(new ZodPipe(EmailVerifyInput)) body: EmailVerifyInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: UserDto }> {
    const { token, user } = await this.auth.verifyEmail(body.email, body.code, {
      userAgent: req.get("user-agent") ?? "",
      ip: req.ip ?? null,
    });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      path: "/",
      maxAge: SESSION_TTL_MS,
    });
    return { user: toUserDto(user) };
  }

  @Post("logout")
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async logout(@CurrentSession() sessionId: string, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.revoke(sessionId);
    this.hub.disconnectSession(sessionId);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
  }
}
