// Контракт между API и клиентами: входные схемы (zod), DTO ответов и события realtime.
import { z } from "zod";

export const MESSAGE_MAX_LENGTH = 40_000;
export const MESSAGES_PAGE_SIZE = 50;
export const LOGIN_CODE_LENGTH = 6;

// ───────────── inputs ─────────────

export const EmailStartInput = z.object({
  email: z.email().max(254).transform((v) => v.trim().toLowerCase()),
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

// ───────────── DTO ─────────────

export type Role = "primary_owner" | "owner" | "admin" | "member" | "guest";

export type UserDto = {
  id: string;
  email: string;
  displayName: string;
  realName: string;
  title: string;
  role: Role;
  tz: string;
  statusText: string;
  statusEmoji: string;
  deactivated: boolean;
};

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

export type WorkspaceDto = { name: string };

export type BootDto = {
  me: UserDto;
  workspace: WorkspaceDto;
  users: UserDto[];
  conversations: ConversationDto[];
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
  | { id: number; kind: "member.joined"; conversationId: string; payload: { conversationId: string; userId: string } };

export type EventKind = EventDto["kind"];

// Клиент → сервер
export type HelloPayload = { lastEventId: number };

// Сервер → клиент: "events" (пачка по возрастанию id), "synced" (догрузка закончена), "resync" (журнал короче — перезагрузить состояние)
export const SOCKET_PATH = "/ws";
