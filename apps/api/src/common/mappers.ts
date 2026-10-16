// Строки БД (snake_case, BigInt, Date) → DTO контракта из @teamchat/shared.
import type { EventDto, MessageDto, Role, UserDto } from "@teamchat/shared";
import type { events, messages, users } from "../generated/prisma/client.js";

export function toUserDto(u: users): UserDto {
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    realName: u.real_name,
    title: u.title,
    role: u.role as Role,
    tz: u.tz,
    statusText: u.status_text,
    statusEmoji: u.status_emoji,
    deactivated: u.deactivated_at !== null,
  };
}

export function toMessageDto(m: messages): MessageDto {
  return {
    id: m.id,
    seq: Number(m.seq),
    conversationId: m.conversation_id,
    userId: m.user_id,
    clientMsgId: m.client_msg_id,
    subtype: m.subtype,
    text: m.deleted_at ? "" : m.text,
    createdAt: m.created_at.toISOString(),
    editedAt: m.edited_at?.toISOString() ?? null,
  };
}

export function toEventDto(e: events): EventDto {
  const base = { id: Number(e.id), kind: e.kind, payload: e.payload };
  if (e.conversation_id) return { ...base, conversationId: e.conversation_id } as EventDto;
  if (e.user_id) return { ...base, userId: e.user_id } as EventDto;
  return base as EventDto;
}
