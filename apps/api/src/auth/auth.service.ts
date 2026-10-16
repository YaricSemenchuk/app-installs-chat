import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { PrismaService } from "../db/prisma.service.js";
import type { invites, users } from "../generated/prisma/client.js";
import { MembershipService } from "../conversations/membership.service.js";
import { InvitesService } from "../invites/invites.service.js";
import { hashLoginCode, newLoginCode, newSessionToken, sameBytes, sha256 } from "./crypto.js";
import { MailService } from "./mail.service.js";

const CODE_TTL_MS = 10 * 60_000;
const CODE_MAX_ATTEMPTS = 5;
const CODES_PER_WINDOW = 5;
const CODES_WINDOW_MS = 15 * 60_000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
const SESSION_TOUCH_MS = 5 * 60_000;

export type SessionUser = { user: users; sessionId: string };
export type SessionMeta = { userAgent: string; ip: string | null };
export type GoogleProfile = { sub: string; email: string; name: string };

// Кто может войти без существующего аккаунта: по приглашению (персональному — только своему адресу)
// или с разрешённого домена. Деактивированных не пускает никто, кроме администратора, вернувшего доступ.
export class AccessDenied extends ForbiddenException {}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly membership: MembershipService,
    private readonly invites: InvitesService,
  ) {}

  private domainAllowed(email: string, allowed: string[]): boolean {
    return allowed.includes(email.split("@")[1] ?? "");
  }

  private async workspace() {
    const ws = await this.prisma.workspace_settings.findUnique({ where: { id: 1 } });
    if (!ws) throw new Error("workspace_settings is missing: bootstrap did not run");
    return ws;
  }

  // Может ли адрес войти; если нужен новый аккаунт — с каким приглашением.
  private async access(email: string, invite: invites | null): Promise<{ allowed: boolean; inviteId?: string }> {
    const user = await this.prisma.users.findUnique({ where: { email } });
    if (user) return { allowed: user.deactivated_at === null };
    if (invite && InvitesService.fits(invite, email)) return { allowed: true, inviteId: invite.id };
    const ws = await this.workspace();
    return { allowed: this.domainAllowed(email, ws.allowed_email_domains) };
  }

  // Всегда отвечает одинаково, чтобы по ответу нельзя было узнать, есть ли такой аккаунт.
  async startEmail(email: string, inviteToken?: string): Promise<void> {
    const recent = await this.prisma.login_codes.count({
      where: { email, created_at: { gt: new Date(Date.now() - CODES_WINDOW_MS) } },
    });
    if (recent >= CODES_PER_WINDOW) {
      throw new HttpException("Слишком много запросов кода. Попробуйте через 15 минут", HttpStatus.TOO_MANY_REQUESTS);
    }

    const ws = await this.workspace();
    const { allowed, inviteId } = await this.access(email, await this.invites.findValid(inviteToken));
    const code = newLoginCode();

    await this.prisma.login_codes.create({
      data: {
        email,
        code_hash: hashLoginCode(email, code),
        invite_id: inviteId ?? null,
        expires_at: new Date(Date.now() + CODE_TTL_MS),
        // Отказ тоже записываем (сразу погашенным), чтобы он участвовал в лимите частоты.
        consumed_at: allowed ? null : new Date(),
      },
    });

    await this.mail.send(
      allowed
        ? {
            to: email,
            subject: `Код для входа: ${code}`,
            text: `Ваш код для входа в ${ws.name}: ${code}\n\nКод действует 10 минут. Если вы не пытались войти, просто проигнорируйте это письмо.`,
          }
        : {
            to: email,
            subject: `Вход в ${ws.name}`,
            text: `С этим адресом пытались войти в ${ws.name}, но у него пока нет доступа. Попросите администратора прислать вам приглашение.`,
          },
    );
  }

  async verifyEmail(email: string, code: string, meta: SessionMeta): Promise<{ token: string; user: users }> {
    const invalid = () => new BadRequestException("Код неверный или устарел. Запросите новый");

    const row = await this.prisma.login_codes.findFirst({
      where: { email, consumed_at: null, expires_at: { gt: new Date() } },
      orderBy: { created_at: "desc" },
    });
    if (!row || row.attempts >= CODE_MAX_ATTEMPTS) throw invalid();

    if (!sameBytes(row.code_hash, hashLoginCode(email, code))) {
      await this.prisma.login_codes.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
      throw invalid();
    }
    // Гасим код атомарно: второй параллельный запрос с тем же кодом не пройдёт.
    const consumed = await this.prisma.login_codes.updateMany({
      where: { id: row.id, consumed_at: null },
      data: { consumed_at: new Date() },
    });
    if (consumed.count !== 1) throw invalid();

    const user = await this.findOrCreate(email, { inviteId: row.invite_id ?? undefined });
    return { token: await this.createSession(user.id, meta), user };
  }

  // Google: аккаунт ищем по sub, потом по почте (и привязываем sub), иначе создаём по приглашению или домену.
  async signInWithGoogle(profile: GoogleProfile, inviteToken: string | undefined, meta: SessionMeta) {
    let user = await this.prisma.users.findUnique({ where: { google_sub: profile.sub } });
    if (!user) {
      const byEmail = await this.prisma.users.findUnique({ where: { email: profile.email } });
      if (byEmail && !byEmail.google_sub) {
        user = await this.prisma.users.update({ where: { id: byEmail.id }, data: { google_sub: profile.sub } });
      } else if (byEmail) {
        throw new AccessDenied("К этому адресу уже привязан другой аккаунт Google");
      } else {
        const invite = await this.invites.findValid(inviteToken);
        const { allowed, inviteId } = await this.access(profile.email, invite);
        if (!allowed) throw new AccessDenied("У этого адреса нет доступа. Попросите приглашение у администратора");
        user = await this.membership.createMember({
          email: profile.email,
          displayName: profile.name,
          googleSub: profile.sub,
          inviteId,
        });
      }
    }
    if (user.deactivated_at) throw new AccessDenied("Доступ к этому аккаунту отключён");
    return { token: await this.createSession(user.id, meta), user };
  }

  private async findOrCreate(email: string, opts: { inviteId?: string }): Promise<users> {
    const existing = await this.prisma.users.findUnique({ where: { email } });
    if (existing) {
      if (existing.deactivated_at) throw new AccessDenied("Доступ к этому аккаунту отключён");
      return existing;
    }
    if (opts.inviteId) return this.membership.createMember({ email, inviteId: opts.inviteId });
    const ws = await this.workspace();
    if (!this.domainAllowed(email, ws.allowed_email_domains)) {
      throw new AccessDenied("У этого адреса нет доступа. Попросите приглашение у администратора");
    }
    return this.membership.createMember({ email });
  }

  private async createSession(userId: string, meta: SessionMeta): Promise<string> {
    const token = newSessionToken();
    await this.prisma.sessions.create({
      data: {
        user_id: userId,
        token_hash: sha256(token),
        user_agent: meta.userAgent.slice(0, 500),
        ip: meta.ip,
        expires_at: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    return token;
  }

  async sessionUser(token: string | undefined): Promise<SessionUser | null> {
    if (!token) return null;
    const session = await this.prisma.sessions.findUnique({ where: { token_hash: sha256(token) }, include: { users: true } });
    if (!session || session.revoked_at || session.expires_at < new Date() || session.users.deactivated_at) return null;
    if (Date.now() - session.last_used_at.getTime() > SESSION_TOUCH_MS) {
      await this.prisma.sessions.update({ where: { id: session.id }, data: { last_used_at: new Date() } });
    }
    return { user: session.users, sessionId: session.id };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.sessions.updateMany({ where: { id: sessionId, revoked_at: null }, data: { revoked_at: new Date() } });
  }
}
