import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import {
  INVITE_TTL_DAYS,
  isAdminRole,
  type InviteCreateInput,
  type InviteDto,
  type InviteLinkDto,
  type InviteLinkInput,
  type InvitePreviewDto,
  type InviteResultDto,
  type Role,
} from "@teamchat/shared";
import { newSessionToken, sha256 } from "../auth/crypto.js";
import { MailService } from "../auth/mail.service.js";
import { toInviteDto } from "../common/mappers.js";
import { config } from "../config.js";
import { PrismaService } from "../db/prisma.service.js";
import type { invites, users } from "../generated/prisma/client.js";

const DAY_MS = 24 * 60 * 60_000;
const INVITES_PER_DAY = 200;

const inviteUrl = (token: string) => `${config.APP_URL}/invite/${token}`;
const nameOf = (u: users) => u.real_name || u.display_name;

@Injectable()
export class InvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  // Действующее приглашение по токену из ссылки: не отозвано, не истекло, есть использования.
  async findValid(token: string | undefined): Promise<invites | null> {
    if (!token) return null;
    const invite = await this.prisma.invites.findUnique({ where: { token_hash: sha256(token) } });
    if (!invite || invite.revoked_at || invite.expires_at <= new Date() || invite.use_count >= invite.max_uses) return null;
    return invite;
  }

  // Подходит ли приглашение этому адресу: персональное — только своему, ссылка — любому.
  static fits(invite: invites, email: string): boolean {
    return !invite.email || invite.email.toLowerCase() === email;
  }

  async preview(token: string): Promise<InvitePreviewDto> {
    const invite = await this.findValid(token);
    if (!invite) throw new NotFoundException("Приглашение не найдено или уже недействительно");
    const [ws, inviter] = await Promise.all([
      this.prisma.workspace_settings.findUniqueOrThrow({ where: { id: 1 } }),
      this.prisma.users.findUniqueOrThrow({ where: { id: invite.invited_by } }),
    ]);
    return { workspaceName: ws.name, inviterName: nameOf(inviter), kind: invite.email ? "email" : "link", email: invite.email };
  }

  private async assertCanInvite(actor: users, role: Role): Promise<void> {
    const ws = await this.prisma.workspace_settings.findUniqueOrThrow({ where: { id: 1 } });
    const admin = isAdminRole(actor.role as Role);
    if (ws.who_can_invite === "admins" && !admin) throw new ForbiddenException("Приглашать могут только администраторы");
    if (role !== "member" && !admin) throw new ForbiddenException("Пригласить администратора может только администратор");
    const recent = await this.prisma.invites.count({
      where: { invited_by: actor.id, created_at: { gt: new Date(Date.now() - DAY_MS) } },
    });
    if (recent >= INVITES_PER_DAY) {
      throw new HttpException("Слишком много приглашений за сутки. Попробуйте завтра", HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async assertChannels(channelIds: string[]): Promise<void> {
    if (channelIds.length === 0) return;
    const found = await this.prisma.conversations.count({
      where: { id: { in: channelIds }, kind: "public", archived_at: null },
    });
    if (found !== new Set(channelIds).size) throw new BadRequestException("Добавлять при входе можно только в открытые каналы");
  }

  async create(actor: users, input: InviteCreateInput): Promise<InviteResultDto> {
    await this.assertCanInvite(actor, input.role);
    await this.assertChannels(input.channelIds);
    const ws = await this.prisma.workspace_settings.findUniqueOrThrow({ where: { id: 1 } });
    const results: InviteResultDto["results"] = [];

    for (const email of [...new Set(input.emails)]) {
      const existing = await this.prisma.users.findUnique({ where: { email } });
      if (existing) {
        results.push({ email, status: existing.deactivated_at ? "deactivated" : "already_member" });
        continue;
      }
      // Повторное приглашение заменяет старое: работает только последняя ссылка.
      await this.prisma.invites.updateMany({ where: { email, revoked_at: null }, data: { revoked_at: new Date() } });
      const token = newSessionToken();
      await this.prisma.invites.create({
        data: {
          email,
          token_hash: sha256(token),
          role: input.role,
          channel_ids: input.channelIds,
          invited_by: actor.id,
          max_uses: 1,
          expires_at: new Date(Date.now() + INVITE_TTL_DAYS * DAY_MS),
        },
      });
      await this.mail.send({
        to: email,
        subject: `${nameOf(actor)} приглашает вас в ${ws.name}`,
        text:
          `${nameOf(actor)} приглашает вас в чат команды ${ws.name}.\n\n` +
          `Принять приглашение: ${inviteUrl(token)}\n\n` +
          `Ссылка действует ${INVITE_TTL_DAYS} дней. Если вы не ждали этого письма, просто проигнорируйте его.`,
      });
      results.push({ email, status: "sent" });
    }
    return { results };
  }

  async createLink(actor: users, input: InviteLinkInput): Promise<InviteLinkDto> {
    if (!isAdminRole(actor.role as Role)) throw new ForbiddenException("Ссылки-приглашения создают администраторы");
    await this.assertCanInvite(actor, "member");
    await this.assertChannels(input.channelIds);
    const token = newSessionToken();
    const invite = await this.prisma.invites.create({
      data: {
        token_hash: sha256(token),
        role: "member",
        channel_ids: input.channelIds,
        invited_by: actor.id,
        max_uses: input.maxUses,
        expires_at: new Date(Date.now() + input.days * DAY_MS),
      },
    });
    return { url: inviteUrl(token), invite: toInviteDto(invite) };
  }

  async listActive(actor: users): Promise<InviteDto[]> {
    if (!isAdminRole(actor.role as Role)) throw new ForbiddenException("Список приглашений видят администраторы");
    const rows = await this.prisma.invites.findMany({
      where: { revoked_at: null, expires_at: { gt: new Date() } },
      orderBy: { created_at: "desc" },
    });
    return rows.filter((i) => i.use_count < i.max_uses).map(toInviteDto);
  }

  async revoke(actor: users, id: string): Promise<void> {
    if (!isAdminRole(actor.role as Role)) throw new ForbiddenException("Отзывать приглашения могут администраторы");
    const res = await this.prisma.invites.updateMany({ where: { id, revoked_at: null }, data: { revoked_at: new Date() } });
    if (res.count === 0) throw new NotFoundException("Приглашение не найдено");
  }
}
