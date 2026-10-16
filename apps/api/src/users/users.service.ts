import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import {
  canAssignRole,
  canManageUser,
  isAdminRole,
  type AdminUserDto,
  type OnboardingInput,
  type ProfileInput,
  type Role,
  type UserDto,
} from "@teamchat/shared";
import { toAdminUserDto, toUserDto } from "../common/mappers.js";
import { validTimeZone } from "../common/tz.js";
import { MembershipService } from "../conversations/membership.service.js";
import { PrismaService } from "../db/prisma.service.js";
import type { users } from "../generated/prisma/client.js";
import { EventsService } from "../realtime/events.service.js";
import { RealtimeHub } from "../realtime/hub.service.js";
import { PresenceService } from "../realtime/presence.service.js";

type UserPatch = Partial<Pick<users, "display_name" | "real_name" | "title" | "pronouns" | "tz" | "role" | "onboarded_at" | "deactivated_at">>;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly hub: RealtimeHub,
    private readonly membership: MembershipService,
    private readonly presence: PresenceService,
  ) {}

  // Изменение человека + событие user.updated для всех, в одной транзакции.
  private async update(userId: string, data: UserPatch): Promise<users> {
    const { user, event } = await this.prisma.$transaction(async (tx) => {
      await this.events.lock(tx);
      const user = await tx.users.update({ where: { id: userId }, data });
      const event = await this.events.append(tx, "user.updated", { broadcast: true }, toUserDto(user));
      return { user, event };
    });
    this.hub.publish([event]);
    return user;
  }

  async onboard(me: users, input: OnboardingInput): Promise<UserDto> {
    const user = await this.update(me.id, {
      display_name: input.displayName,
      real_name: input.realName,
      title: input.title,
      tz: validTimeZone(input.tz) ?? me.tz,
      onboarded_at: me.onboarded_at ?? new Date(),
    });
    return toUserDto(user);
  }

  async updateProfile(me: users, input: ProfileInput): Promise<UserDto> {
    const user = await this.update(me.id, {
      display_name: input.displayName,
      real_name: input.realName,
      title: input.title,
      pronouns: input.pronouns,
      tz: validTimeZone(input.tz),
    });
    return toUserDto(user);
  }

  // ───────────── администрирование ─────────────

  private assertAdmin(actor: users): void {
    if (!isAdminRole(actor.role as Role)) throw new ForbiddenException("Раздел доступен администраторам");
  }

  private async target(actor: users, id: string): Promise<users> {
    this.assertAdmin(actor);
    const target = await this.prisma.users.findUnique({ where: { id } });
    if (!target) throw new NotFoundException("Человек не найден");
    if (!canManageUser(actor.role as Role, target.role as Role)) {
      throw new ForbiddenException("Управлять можно только теми, у кого роль ниже вашей");
    }
    return target;
  }

  async listForAdmin(actor: users): Promise<AdminUserDto[]> {
    this.assertAdmin(actor);
    const [rows, seen] = await Promise.all([
      this.prisma.users.findMany({ orderBy: [{ deactivated_at: { sort: "desc", nulls: "first" } }, { display_name: "asc" }] }),
      this.prisma.sessions.groupBy({ by: ["user_id"], _max: { last_used_at: true } }),
    ]);
    const lastSeen = new Map(seen.map((s) => [s.user_id, s._max.last_used_at]));
    return rows.map((u) => toAdminUserDto(u, lastSeen.get(u.id) ?? null));
  }

  async changeRole(actor: users, id: string, role: Role): Promise<UserDto> {
    const target = await this.target(actor, id);
    if (!canAssignRole(actor.role as Role, target.role as Role, role)) {
      throw new ForbiddenException("Эту роль назначить нельзя: она не ниже вашей");
    }
    return toUserDto(await this.update(target.id, { role }));
  }

  // Деактивация: доступ закрыт сразу (сессии, сокеты), из каналов вышел, сообщения остаются.
  async deactivate(actor: users, id: string): Promise<UserDto> {
    const target = await this.target(actor, id);
    if (target.deactivated_at) return toUserDto(target);
    const { user, published } = await this.prisma.$transaction(async (tx) => {
      await this.events.lock(tx);
      const user = await tx.users.update({ where: { id: target.id }, data: { deactivated_at: new Date() } });
      await tx.sessions.updateMany({ where: { user_id: target.id, revoked_at: null }, data: { revoked_at: new Date() } });
      const published = await this.membership.leaveAllChannels(tx, target.id);
      published.push(await this.events.append(tx, "user.updated", { broadcast: true }, toUserDto(user)));
      return { user, published };
    });
    this.hub.disconnectUser(target.id);
    this.presence.forget(target.id);
    this.membership.publishWithRooms(published);
    return toUserDto(user);
  }

  async reactivate(actor: users, id: string): Promise<UserDto> {
    const target = await this.target(actor, id);
    if (!target.deactivated_at) return toUserDto(target);
    const { user, published } = await this.prisma.$transaction(async (tx) => {
      await this.events.lock(tx);
      const user = await tx.users.update({ where: { id: target.id }, data: { deactivated_at: null } });
      const published = [await this.events.append(tx, "user.updated", { broadcast: true }, toUserDto(user))];
      published.push(...(await this.membership.joinDefaults(tx, target.id)));
      return { user, published };
    });
    this.membership.publishWithRooms(published);
    return toUserDto(user);
  }
}
