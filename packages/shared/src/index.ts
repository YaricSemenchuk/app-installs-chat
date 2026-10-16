// Контракт между API и клиентами: входные схемы (zod), DTO ответов и события realtime.
import { z } from "zod";

export const MESSAGE_MAX_LENGTH = 40_000;
export const MESSAGES_PAGE_SIZE = 50;
export const LOGIN_CODE_LENGTH = 6;

// ───────────── inputs ─────────────

const InviteToken = z.string().regex(/^[A-Za-z0-9_-]{20,100}$/);

export const EmailStartInput = z.object({
  email: z.email().max(254).transform((v) => v.trim().toLowerCase()),
  inviteToken: InviteToken.optional(),
});
export type EmailStartInput = z.infer<typeof EmailStartInput>;

export const EmailVerifyInput = z.object({
  email: z.email().max(254).transform((v) => v.trim().toLowerCase()),
  code: z.string().regex(/^\d{6}$/, "Код — 6 цифр"),
});
export type EmailVerifyInput = z.infer<typeof EmailVerifyInput>;

export const SendMessageInput = z.object({
  clientMsgId: z.uuid(),
  text: z
    .string()
    .max(MESSAGE_MAX_LENGTH)
    .refine((v) => v.trim().length > 0, "Пустое сообщение"),
});
export type SendMessageInput = z.infer<typeof SendMessageInput>;

export const ListMessagesQuery = z.object({
  before: z.coerce.number().int().positive().optional(),
  after: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(MESSAGES_PAGE_SIZE),
});
export type ListMessagesQuery = z.infer<typeof ListMessagesQuery>;

export const MarkReadInput = z.object({
  seq: z.number().int().nonnegative(),
});
export type MarkReadInput = z.infer<typeof MarkReadInput>;

// Тот же валидатор, что и на сервере: клиент не должен пропускать то, что API отвергнет.
export const isEmail = (v: string) => z.email().safeParse(v).success;

export const INVITE_TTL_DAYS = 30;
export const INVITE_LINK_MAX_USES = 400;
export const INVITE_EMAILS_PER_REQUEST = 50;

export const InviteCreateInput = z.object({
  emails: z
    .array(z.email().max(254).transform((v) => v.trim().toLowerCase()))
    .min(1, "Добавьте хотя бы один адрес")
    .max(INVITE_EMAILS_PER_REQUEST, `Не больше ${INVITE_EMAILS_PER_REQUEST} адресов за раз`),
  role: z.enum(["member", "admin"]).default("member"),
  channelIds: z.array(z.uuid()).max(20).default([]),
});
export type InviteCreateInput = z.infer<typeof InviteCreateInput>;

export const InviteLinkInput = z.object({
  days: z.number().int().min(1).max(INVITE_TTL_DAYS).default(INVITE_TTL_DAYS),
  maxUses: z.number().int().min(1).max(INVITE_LINK_MAX_USES).default(100),
  channelIds: z.array(z.uuid()).max(20).default([]),
});
export type InviteLinkInput = z.infer<typeof InviteLinkInput>;

const Name = (max: number) => z.string().trim().max(max);

export const OnboardingInput = z.object({
  displayName: Name(80).min(1, "Укажите, как вас называть"),
  realName: Name(80).default(""),
  title: Name(100).default(""),
  tz: z.string().max(64).optional(),
});
export type OnboardingInput = z.infer<typeof OnboardingInput>;

export const ProfileInput = z.object({
  displayName: Name(80).min(1, "Укажите, как вас называть").optional(),
  realName: Name(80).optional(),
  title: Name(100).optional(),
  pronouns: Name(30).optional(),
  tz: z.string().max(64).optional(),
});
export type ProfileInput = z.infer<typeof ProfileInput>;

export const RoleChangeInput = z.object({ role: z.enum(["owner", "admin", "member"]) });
export type RoleChangeInput = z.infer<typeof RoleChangeInput>;

// ───────────── DTO ─────────────

export type Role = "primary_owner" | "owner" | "admin" | "member" | "guest";

export type UserDto = {
  id: string;
  email: string;
  displayName: string;
  realName: string;
  title: string;
  pronouns: string;
  role: Role;
  tz: string;
  statusText: string;
  statusEmoji: string;
  deactivated: boolean;
  onboarded: boolean;
};

export const ROLE_RANK: Record<Role, number> = { guest: 0, member: 1, admin: 2, owner: 3, primary_owner: 4 };
export const isAdminRole = (role: Role) => ROLE_RANK[role] >= ROLE_RANK.admin;

// Менять роль и деактивировать можно только тех, кто ниже тебя; повысить — только до ранга ниже своего.
export const canManageUser = (actor: Role, target: Role) => ROLE_RANK[actor] >= ROLE_RANK.admin && ROLE_RANK[actor] > ROLE_RANK[target];
export const canAssignRole = (actor: Role, target: Role, next: Role) =>
  canManageUser(actor, target) && ROLE_RANK[next] < ROLE_RANK[actor] && next !== "primary_owner";

export type Presence = "active" | "away";

export type AdminUserDto = UserDto & { createdAt: string; lastSeenAt: string | null };

export type InviteDto = {
  id: string;
  kind: "email" | "link";
  email: string | null;
  role: Role;
  invitedBy: string;
  useCount: number;
  maxUses: number;
  expiresAt: string;
  createdAt: string;
};

export type InvitePreviewDto = {
  workspaceName: string;
  inviterName: string;
  kind: "email" | "link";
  email: string | null;
};

export type InviteResultDto = {
  results: Array<{ email: string; status: "sent" | "already_member" | "deactivated" }>;
};

export type InviteLinkDto = { url: string; invite: InviteDto };

export type AuthProvidersDto = { google: boolean };

export type ConversationKind = "public" | "private" | "dm" | "group_dm";

export type ConversationDto = {
  id: string;
  kind: ConversationKind;
  name: string | null;
  topic: string;
  purpose: string;
  isGeneral: boolean;
  archived: boolean;
  memberIds: string[];
  // состояние текущего пользователя
  lastReadSeq: number;
  latestSeq: number;
  unreadCount: number;
};

export type MessageDto = {
  id: string;
  seq: number;
  conversationId: string;
  userId: string;
  clientMsgId: string | null;
  subtype: string | null;
  text: string;
  createdAt: string;
  editedAt: string | null;
};

export type WorkspaceDto = { name: string; whoCanInvite: "everyone" | "admins" };

export type BootDto = {
  me: UserDto;
  workspace: WorkspaceDto;
  users: UserDto[];
  conversations: ConversationDto[];
  presence: Record<string, Presence>; // только «в сети»; кого нет — тот away
  lastEventId: number;
};

export type MessagesPageDto = {
  messages: MessageDto[]; // по возрастанию seq
  hasMore: boolean; // есть ли ещё в запрошенном направлении
};

// ───────────── realtime ─────────────

export type EventDto =
  | { id: number; kind: "message.created"; conversationId: string; payload: MessageDto }
  | { id: number; kind: "read.updated"; userId: string; payload: { conversationId: string; lastReadSeq: number } }
  | { id: number; kind: "user.created"; payload: UserDto }
  | { id: number; kind: "user.updated"; payload: UserDto }
  | { id: number; kind: "member.joined"; conversationId: string; payload: { conversationId: string; userId: string } }
  | { id: number; kind: "member.left"; conversationId: string; payload: { conversationId: string; userId: string } };

export type EventKind = EventDto["kind"];

// Клиент → сервер: "hello" после (пере)подключения, "active" — человек что-то делает в окне (не чаще раза в минуту)
export type HelloPayload = { lastEventId: number };

// Сервер → клиент, мимо журнала: присутствие не хранится
export type PresenceEventDto = { userId: string; presence: Presence };

// Сервер → клиент: "events" (пачка по возрастанию id), "synced" (догрузка закончена), "resync" (журнал короче — перезагрузить состояние)
export const SOCKET_PATH = "/ws";
