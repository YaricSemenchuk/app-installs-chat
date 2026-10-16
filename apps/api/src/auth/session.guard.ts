import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { users } from "../generated/prisma/client.js";
import { AuthService, type SessionUser } from "./auth.service.js";

export const SESSION_COOKIE = "sid";

type AuthedRequest = Request & { auth?: SessionUser };

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const session = await this.auth.sessionUser(req.cookies?.[SESSION_COOKIE]);
    if (!session) throw new UnauthorizedException("Нужно войти");
    req.auth = session;
    return true;
  }
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): users => {
  const auth = ctx.switchToHttp().getRequest<AuthedRequest>().auth;
  if (!auth) throw new UnauthorizedException("Нужно войти");
  return auth.user;
});

export const CurrentSession = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const auth = ctx.switchToHttp().getRequest<AuthedRequest>().auth;
  if (!auth) throw new UnauthorizedException("Нужно войти");
  return auth.sessionId;
});
