import { Body, Controller, Get, HttpCode, Logger, NotFoundException, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { EmailStartInput, EmailVerifyInput, type AuthProvidersDto, type UserDto } from "@teamchat/shared";
import type { CookieOptions, Request, Response } from "express";
import { toUserDto } from "../common/mappers.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { isProd } from "../config.js";
import { RealtimeHub } from "../realtime/hub.service.js";
import { AccessDenied, AuthService, SESSION_TTL_MS, type SessionMeta } from "./auth.service.js";
import { GOOGLE_STATE_COOKIE, GOOGLE_STATE_TTL_MS, GoogleAuthError, GoogleAuthService } from "./google.service.js";
import { CurrentSession, SESSION_COOKIE, SessionGuard } from "./session.guard.js";

const sessionCookie: CookieOptions = { httpOnly: true, sameSite: "lax", secure: isProd, path: "/", maxAge: SESSION_TTL_MS };
const googleCookie: CookieOptions = {
  httpOnly: true,
  sameSite: "lax", // возврат из Google — обычный переход по ссылке, lax-cookie придёт
  secure: isProd,
  path: "/api/auth/google",
  maxAge: GOOGLE_STATE_TTL_MS,
};

const metaOf = (req: Request): SessionMeta => ({ userAgent: req.get("user-agent") ?? "", ip: req.ip ?? null });

@Controller("auth")
export class AuthController {
  private readonly log = new Logger("Auth");

  constructor(
    private readonly auth: AuthService,
    private readonly google: GoogleAuthService,
    private readonly hub: RealtimeHub,
  ) {}

  @Get("providers")
  providers(): AuthProvidersDto {
    return { google: this.google.enabled };
  }

  @Post("email/start")
  @HttpCode(204)
  async start(@Body(new ZodPipe(EmailStartInput)) body: EmailStartInput): Promise<void> {
    await this.auth.startEmail(body.email, body.inviteToken);
  }

  @Post("email/verify")
  async verify(
    @Body(new ZodPipe(EmailVerifyInput)) body: EmailVerifyInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: UserDto }> {
    const { token, user } = await this.auth.verifyEmail(body.email, body.code, metaOf(req));
    res.cookie(SESSION_COOKIE, token, sessionCookie);
    return { user: toUserDto(user) };
  }

  @Get("google/start")
  googleStart(@Query("invite") invite: string | undefined, @Res() res: Response): void {
    if (!this.google.enabled) throw new NotFoundException("Вход через Google не настроен");
    const valid = invite && /^[A-Za-z0-9_-]{20,100}$/.test(invite) ? invite : undefined;
    const { url, cookie } = this.google.start(valid);
    res.cookie(GOOGLE_STATE_COOKIE, cookie, googleCookie);
    res.redirect(302, url);
  }

  // Все исходы — редирект: успех на /, ошибка на /signin?error=код (текст показывает клиент).
  @Get("google/callback")
  async googleCallback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const cookie = req.cookies?.[GOOGLE_STATE_COOKIE] as string | undefined;
    res.clearCookie(GOOGLE_STATE_COOKIE, { path: googleCookie.path });
    const fail = (reason: string) => res.redirect(302, `/signin?error=${reason}`);
    try {
      if (error) return fail("denied");
      const st = this.google.readState(cookie, state);
      if (!code) return fail("denied");
      const profile = await this.google.exchange(code, st.verifier);
      const { token } = await this.auth.signInWithGoogle(profile, st.invite, metaOf(req));
      res.cookie(SESSION_COOKIE, token, sessionCookie);
      res.redirect(302, "/");
    } catch (err) {
      if (err instanceof GoogleAuthError) return fail(err.code);
      if (err instanceof AccessDenied) return fail("no_access");
      this.log.error(err);
      return fail("unknown");
    }
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
