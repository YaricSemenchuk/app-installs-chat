// Правила доступа к разговору — в одном месте (architecture.md → «Правила доступа»).
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { isAdminRole, type Role } from "@teamchat/shared";
import type { PrismaService } from "../db/prisma.service.js";
import type { conversation_members, conversations, users } from "../generated/prisma/client.js";

export type Access = { conv: conversations; membership: conversation_members | null };

export const isChannel = (c: conversations) => c.kind === "public" || c.kind === "private";
export const isAdmin = (u: users) => isAdminRole(u.role as Role);

// Читать: участник или открытый канал. Чужие закрытые каналы и ЛС для постороннего «не существуют».
export async function loadAccess(prisma: PrismaService, me: users, id: string): Promise<Access> {
  const conv = await prisma.conversations.findUnique({ where: { id } });
  const membership = conv
    ? await prisma.conversation_members.findUnique({
        where: { conversation_id_user_id: { conversation_id: id, user_id: me.id } },
      })
    : null;
  if (!conv || (!membership && conv.kind !== "public")) throw new NotFoundException("Разговор не найден");
  return { conv, membership };
}

export function assertMember(a: Access): conversation_members {
  if (!a.membership) throw new ForbiddenException("Сначала вступите в канал");
  return a.membership;
}

export function assertCanPost(me: users, a: Access): void {
  assertMember(a);
  if (a.conv.archived_at) throw new ForbiddenException("Канал в архиве");
  if (a.conv.posting_policy === "admins" && !isAdmin(me)) {
    throw new ForbiddenException("Писать в этот канал могут только администраторы");
  }
}

export function canManage(me: users, a: Access): boolean {
  if (a.conv.is_general) return isAdmin(me);
  return isAdmin(me) || Boolean(a.membership?.is_manager);
}
