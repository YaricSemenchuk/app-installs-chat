// Строки БД (snake_case, BigInt, Date) → DTO контракта из @teamchat/shared.
import type {
  AdminUserDto,
  ConversationInfoDto,
  ConversationKind,
  EventDto,
  InviteDto,
  MessageDto,
  ReactionDto,
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

type ReactionRow = { emoji: string; user_id: string; created_at: Date };

// Реакции одной кнопкой на эмодзи: эмодзи — в порядке первой реакции, люди — в порядке, как ставили.
export function groupReactions(rows: ReactionRow[]): ReactionDto[] {
  const byEmoji = new Map<string, string[]>();
  for (const r of [...rows].sort((a, b) => a.created_at.getTime() - b.created_at.getTime())) {
    const list = byEmoji.get(r.emoji) ?? [];
    list.push(r.user_id);
    byEmoji.set(r.emoji, list);
  }
  return [...byEmoji].map(([emoji, userIds]) => ({ emoji, userIds }));
}

// Что приходит из базы вместе с сообщением (см. MESSAGE_INCLUDE в messages.service).
export type MessageRow = messages & { message_mentions?: { user_id: string }[]; reactions?: ReactionRow[] };

export function toMessageDto(m: MessageRow, mentions?: string[]): MessageDto {
  const deleted = m.deleted_at !== null;
  return {
    id: m.id,
    seq: Number(m.seq),
    conversationId: m.conversation_id,
    userId: m.user_id,
    clientMsgId: m.client_msg_id,
    subtype: m.subtype,
    text: deleted ? "" : m.text,
    mentions: deleted ? [] : (mentions ?? m.message_mentions?.map((x) => x.user_id) ?? []),
    createdAt: m.created_at.toISOString(),
    editedAt: m.edited_at?.toISOString() ?? null,
    deleted,
    parentId: m.parent_id,
    alsoInChannel: m.also_in_channel,
    replyCount: m.reply_count,
    replyUserIds: m.reply_user_ids,
    lastReplyAt: m.last_reply_at?.toISOString() ?? null,
    reactions: deleted ? [] : groupReactions(m.reactions ?? []),
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

// Поля сообщения, которых не было в событиях, записанных раньше (M0–M2): журнал догоняют как есть,
// поэтому недостающее подставляем здесь, на границе контракта.
const MESSAGE_DEFAULTS: Omit<MessageDto, "id" | "seq" | "conversationId" | "userId" | "clientMsgId" | "subtype" | "text" | "createdAt" | "editedAt"> = {
  mentions: [],
  deleted: false,
  parentId: null,
  alsoInChannel: false,
  replyCount: 0,
  replyUserIds: [],
  lastReplyAt: null,
  reactions: [],
};

export function toEventDto(e: events): EventDto {
  const isMessage = e.kind === "message.created" || e.kind === "message.updated";
  const payload =
    isMessage && e.payload && typeof e.payload === "object" && !Array.isArray(e.payload) ? { ...MESSAGE_DEFAULTS, ...e.payload } : e.payload;
  const base = { id: Number(e.id), kind: e.kind, payload };
  if (e.conversation_id) return { ...base, conversationId: e.conversation_id } as EventDto;
  if (e.user_id) return { ...base, userId: e.user_id } as EventDto;
  return base as EventDto;
}
