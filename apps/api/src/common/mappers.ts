// Строки БД (snake_case, BigInt, Date) → DTO контракта из @teamchat/shared.
import type {
  AdminUserDto,
  ConversationInfoDto,
  ConversationKind,
  EventDto,
  InviteDto,
  MessageDto,
  Role,
  UserDto,
} from "@teamchat/shared";
import type { conversations, events, invites, messages, users } from "../generated/prisma/client.js";

export function toUserDto(u: users): UserDto {
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    realName: u.real_name,
    title: u.title,
    pronouns: u.pronouns,
    role: u.role as Role,
    tz: u.tz,
    statusText: u.status_text,
    statusEmoji: u.status_emoji,
    deactivated: u.deactivated_at !== null,
    onboarded: u.onboarded_at !== null,
  };
}

export function toAdminUserDto(u: users, lastSeenAt: Date | null): AdminUserDto {
  return { ...toUserDto(u), createdAt: u.created_at.toISOString(), lastSeenAt: lastSeenAt?.toISOString() ?? null };
}

export function toInviteDto(i: invites): InviteDto {
  return {
    id: i.id,
    kind: i.email ? "email" : "link",
    email: i.email,
    role: i.role as Role,
    invitedBy: i.invited_by,
    useCount: i.use_count,
    maxUses: i.max_uses,
    expiresAt: i.expires_at.toISOString(),
    createdAt: i.created_at.toISOString(),
  };
}

export function toMessageDto(m: messages, mentions: string[] = []): MessageDto {
  return {
    id: m.id,
    seq: Number(m.seq),
    conversationId: m.conversation_id,
    userId: m.user_id,
    clientMsgId: m.client_msg_id,
    subtype: m.subtype,
    text: m.deleted_at ? "" : m.text,
    mentions,
    createdAt: m.created_at.toISOString(),
    editedAt: m.edited_at?.toISOString() ?? null,
  };
}

export function toConversationInfoDto(c: conversations): ConversationInfoDto {
  return {
    id: c.id,
    kind: c.kind as ConversationKind,
    name: c.name,
    topic: c.topic,
    purpose: c.purpose,
    isGeneral: c.is_general,
    archived: c.archived_at !== null,
    createdBy: c.created_by,
    createdAt: c.created_at.toISOString(),
  };
}

export function toEventDto(e: events): EventDto {
  // В журнале лежат и события до M2, где у сообщения ещё не было mentions: при догоне их отдают как есть.
  const payload =
    e.kind === "message.created" && e.payload && typeof e.payload === "object" && !Array.isArray(e.payload)
      ? { mentions: [], ...e.payload }
      : e.payload;
  const base = { id: Number(e.id), kind: e.kind, payload };
  if (e.conversation_id) return { ...base, conversationId: e.conversation_id } as EventDto;
  if (e.user_id) return { ...base, userId: e.user_id } as EventDto;
  return base as EventDto;
}
