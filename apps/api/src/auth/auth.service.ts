import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { PrismaService } from "../db/prisma.service.js";
import type { users } from "../generated/prisma/client.js";
import { MembershipService } from "../conversations/membership.service.js";
import { hashLoginCode, newLoginCode, newSessionToken, sameBytes, sha256 } from "./crypto.js";
import { MailService } from "./mail.service.js";

const CODE_TTL_MS = 10 * 60_000;
const CODE_MAX_ATTEMPTS = 5;
const CODES_PER_WINDOW = 5;
const CODES_WINDOW_MS = 15 * 60_000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
const SESSION_TOUCH_MS = 5 * 60_000;

export type SessionUser = { user: users; sessionId: string };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly membership: MembershipService,
  ) {}

  private domainAllowed(email: string, allowed: string[]): boolean {
    const domain = email.split("@")[1] ?? "";
    return allowed.includes(domain);
  }

  private async workspace() {
    const ws = await this.prisma.workspace_settings.findUnique({ where: { id: 1 } });
    if (!ws) throw new Error("workspace_settings is missing: bootstrap did not run");
    return ws;
  }

  // Всегда отвечает одинаково, чтобы по ответу нельзя было узнать, есть ли такой аккаунт.
  async startEmail(email: string): Promise<void> {
    const recent = await this.prisma.login_codes.count({
      where: { email, created_at: { gt: new Date(Date.now() - CODES_WINDOW_MS) } },
    });
    if (recent >= CODES_PER_WINDOW) {
      throw new HttpException("Слишком много запросов кода. Попробуйте через 15 минут", HttpStatus.TOO_MANY_REQUESTS);
    }

    const ws = await this.workspace();
    const user = await this.prisma.users.findUnique({ where: { email } });
    const allowed = user ? user.deactivated_at === null : this.domainAllowed(email, ws.allowed_email_domains);
    const code = newLoginCode();

    await this.prisma.login_codes.create({
      data: {
        email,
        code_hash: hashLoginCode(email, code),
        expires_at: new Date(Date.now() + CODE_TTL_MS),
        // Отказ тоже записываем (сразу погашенным), чтобы он участвовал в лимите частоты.
        consumed_at: allowed ? null : new Date(),
      },
    });

    if (allowed) {
      await this.mail.send({
        to: email,
        subject: `Код для входа: ${code}`,
        text: `Ваш код для входа в ${ws.name}: ${code}\n\nКод действует 10 минут. Если вы не пытались войти, просто проигнорируйте это письмо.`,
      });
    } else {
      await this.mail.send({
        to: email,
        subject: `Вход в ${ws.name}`,
        text: `С этим адресом пытались войти в ${ws.name}, но у него пока нет доступа. Попросите администратора прислать вам приглашение.`,
      });
    }
  }

  async verifyEmail(email: string, code: string, meta: { userAgent: string; ip: string | null }): Promise<{ token: string; user: users }> {
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

    const user = await this.findOrCreateUser(email);
    if (user.deactivated_at) throw new ForbiddenException("Доступ к этому аккаунту отключён");

    const token = newSessionToken();
    await this.prisma.sessions.create({
      data: {
        user_id: user.id,
        token_hash: sha256(token),
        user_agent: meta.userAgent.slice(0, 500),
        ip: meta.ip,
        expires_at: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    return { token, user };
  }

  private async findOrCreateUser(email: string): Promise<users> {
    const existing = await this.prisma.users.findUnique({ where: { email } });
    if (existing) return existing;

    const ws = await this.workspace();
    if (!this.domainAllowed(email, ws.allowed_email_domains)) {
      throw new ForbiddenException("У этого адреса нет доступа. Попросите приглашение у администратора");
    }
    return this.membership.createMember(email);
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
