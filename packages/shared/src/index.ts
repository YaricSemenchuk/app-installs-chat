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

export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_FILES_PER_MESSAGE = 10;
export const THUMB_SIZES = [360, 720] as const;

const MessageText = z.string().max(MESSAGE_MAX_LENGTH);

// Пустой текст можно, только если к сообщению приложены файлы.
export const SendMessageInput = z
  .object({
    clientMsgId: z.uuid(),
    text: MessageText.default(""),
    parentId: z.uuid().optional(), // ответ в треде
    alsoInChannel: z.boolean().default(false), // ответ из треда показать и в ленте разговора
    fileIds: z.array(z.uuid()).max(MAX_FILES_PER_MESSAGE, `Не больше ${MAX_FILES_PER_MESSAGE} файлов в сообщении`).default([]),
  })
  .refine((v) => v.text.trim().length > 0 || v.fileIds.length > 0, { message: "Пустое сообщение", path: ["text"] });
export type SendMessageInput = z.infer<typeof SendMessageInput>;

// Текст правки может опустеть, если в сообщении есть файлы: это сервер проверяет сам.
export const EditMessageInput = z.object({ text: MessageText });
export type EditMessageInput = z.infer<typeof EditMessageInput>;

// Реакции храним по коду эмодзи (как :+1:), а не символом: так их можно сравнивать и считать.
export const EMOJI_NAME_RE = /^[a-z0-9_+-]{1,100}(::skin-tone-[2-6])?$/;
export const MAX_REACTIONS_PER_MESSAGE = 50;
export const ReactionInput = z.object({ emoji: z.string().regex(EMOJI_NAME_RE, "Неизвестный эмодзи") });
export type ReactionInput = z.infer<typeof ReactionInput>;

export const ListRepliesQuery = z.object({
  after: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListRepliesQuery = z.infer<typeof ListRepliesQuery>;

export const ThreadSubscriptionInput = z.object({ subscribed: z.boolean() });
export type ThreadSubscriptionInput = z.infer<typeof ThreadSubscriptionInput>;

export const THREAD_SUMMARY_USERS = 5;

// ───────────── уведомления и десктоп ─────────────

export type NotifyLevel = "all" | "mentions" | "nothing";

export type PreferencesDto = {
  notifyLevel: NotifyLevel; // всё / ЛС, упоминания и треды / ничего
  desktopNotifications: boolean; // показывать системные уведомления на этом аккаунте
  notifyThreadReplies: boolean; // ответы в тредах, за которыми слежу
  showMessagePreview: boolean; // текст сообщения в уведомлении
  sound: boolean;
};

export const DEFAULT_PREFERENCES: PreferencesDto = {
  notifyLevel: "mentions",
  desktopNotifications: true,
  notifyThreadReplies: true,
  showMessagePreview: true,
  sound: true,
};

export const UpdatePreferencesInput = z
  .object({
    notifyLevel: z.enum(["all", "mentions", "nothing"]),
    desktopNotifications: z.boolean(),
    notifyThreadReplies: z.boolean(),
    showMessagePreview: z.boolean(),
    sound: z.boolean(),
  })
  .partial();
export type UpdatePreferencesInput = z.infer<typeof UpdatePreferencesInput>;

// Сервер уже решил, что этого человека стоит уведомить; клиент лишь проверяет, не смотрит ли он сейчас на этот разговор.
export type NotificationDto = {
  messageId: string;
  conversationId: string;
  parentId: string | null;
  authorId: string;
  reason: "dm" | "mention" | "thread_reply" | "message";
  title: string;
  body: string;
  sound: boolean;
};
export const NOTIFICATION_EVENT = "notification";

const B64URL_43 = /^[A-Za-z0-9_-]{43}$/;
export const DesktopExchangeInput = z.object({
  code: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/),
  verifier: z.string().regex(B64URL_43, "Некорректный verifier"),
});
export type DesktopExchangeInput = z.infer<typeof DesktopExchangeInput>;
export const isDesktopChallenge = (v: unknown): v is string => typeof v === "string" && B64URL_43.test(v);

// Десктоп-приложение: установщики загружает администратор, вошедшие скачивают на /download.
export const DESKTOP_PLATFORMS = ["mac", "win"] as const;
export type DesktopPlatform = (typeof DESKTOP_PLATFORMS)[number];
export const INSTALLER_EXT: Record<DesktopPlatform, string> = { mac: ".dmg", win: ".exe" };
export const MAX_INSTALLER_BYTES = 512 * 1024 * 1024; // универсальный .dmg — около 230 МБ
export const DesktopVersion = z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/, "Версия вида 1.0.2");
// Версия из имени сборки: PromobileChat-1.0.2-mac.dmg → 1.0.2.
export const versionFromName = (name: string): string | null => name.match(/\d{1,4}\.\d{1,4}\.\d{1,4}/)?.[0] ?? null;
// Байты установщика идут телом PUT, имя и версия — в адресе.
export const UploadInstallerQuery = z.object({ version: DesktopVersion, name: z.string().trim().min(1).max(200) });
export type UploadInstallerQuery = z.infer<typeof UploadInstallerQuery>;
export type InstallerDto = {
  platform: DesktopPlatform;
  version: string;
  name: string;
  size: number;
  uploadedAt: string;
  uploadedBy: string | null; // id того, кто загрузил
  url: string; // скачать: /api/desktop/<platform>/download
};
export type DesktopInfoDto = Record<DesktopPlatform, InstallerDto | null>;
export const DESKTOP_PROTOCOL = "teamchat";

// ───────────── файлы и поиск ─────────────

export const CreateFileInput = z.object({
  name: z.string().trim().min(1, "У файла нет имени").max(255, "Слишком длинное имя файла"),
  size: z.number().int().min(0).max(MAX_FILE_BYTES, "Файл больше 100 МБ"),
  mimetype: z.string().trim().max(255).default(""),
});
export type CreateFileInput = z.infer<typeof CreateFileInput>;

export const ListFilesQuery = z.object({
  type: z.enum(["all", "images", "documents"]).default("all"),
  query: z.string().trim().max(200).optional(),
  mine: z.stringbool().default(false),
  before: z.string().max(200).optional(), // курсор из прошлой страницы (время и два id)
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListFilesQuery = z.infer<typeof ListFilesQuery>;

export const SearchMessagesQuery = z.object({
  q: z.string().trim().min(1, "Пустой запрос").max(500),
  conversationId: z.uuid().optional(),
  userId: z.uuid().optional(),
  before: z.coerce.number().int().positive().optional(), // seq последнего результата прошлой страницы
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchMessagesQuery = z.infer<typeof SearchMessagesQuery>;

// Окно правки из настроек пространства: null — править можно всегда.
export function canStillEdit(createdAt: string | Date, windowMinutes: number | null, now = Date.now()): boolean {
  if (windowMinutes === null) return true;
  return new Date(createdAt).getTime() + windowMinutes * 60_000 > now;
}

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
  avatarFileId: z.uuid().optional(), // загруженная картинка (POST /files), станет фото профиля
});
export type OnboardingInput = z.infer<typeof OnboardingInput>;

export const ProfileInput = z.object({
  displayName: Name(80).min(1, "Укажите, как вас называть").optional(),
  realName: Name(80).optional(),
  title: Name(100).optional(),
  pronouns: Name(30).optional(),
  tz: z.string().max(64).optional(),
  avatarFileId: z.uuid().nullable().optional(), // null — убрать фото
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
  avatarUrl: string | null; // квадратное фото 256 px; адрес меняется вместе с фото, поэтому кешируется надолго
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

export const isChannelKind = (k: ConversationKind) => k === "public" || k === "private";

// То, что видят все участники; рассылается событием conversation.updated.
export type ConversationInfoDto = {
  id: string;
  kind: ConversationKind;
  name: string | null;
  topic: string;
  purpose: string;
  isGeneral: boolean;
  archived: boolean;
  createdBy: string;
  createdAt: string;
};

export type ConversationDto = ConversationInfoDto & {
  memberIds: string[];
  // состояние текущего пользователя
  isMember: boolean;
  isManager: boolean;
  lastReadSeq: number;
  latestSeq: number;
  unreadCount: number;
  mentionCount: number;
};

export type DirectoryChannelDto = ConversationInfoDto & { memberCount: number; isMember: boolean };

export type ReactionDto = { emoji: string; userIds: string[] }; // в порядке, в каком ставили

export type FileDto = {
  id: string;
  name: string;
  mimetype: string;
  size: number; // байты
  uploaderId: string;
  createdAt: string;
  status: "pending" | "ready";
  // Только для картинок, которые сервер сам смог прочитать: размеры и готовые миниатюры (ширины из THUMB_SIZES).
  image: { width: number; height: number; thumbs: number[] } | null;
  deleted: boolean;
};

export type UploadTicketDto = { file: FileDto; uploadUrl: string }; // байты — PUT на uploadUrl

export type SharedFileDto = { file: FileDto; messageId: string; conversationId: string; userId: string; sharedAt: string };
export type FilesPageDto = { items: SharedFileDto[]; nextCursor: string | null };

export type SearchHitDto = { message: MessageDto; highlights: string[] }; // слова, которые совпали
export type SearchPageDto = { hits: SearchHitDto[]; nextCursor: number | null };

export type MessageDto = {
  id: string;
  seq: number;
  conversationId: string;
  userId: string;
  clientMsgId: string | null;
  subtype: string | null;
  text: string; // разметка, см. markup.ts; у удалённого — пусто
  mentions: string[]; // кого задело: @человек, а также раскрытые @here / @channel
  createdAt: string;
  editedAt: string | null;
  deleted: boolean; // удалённое остаётся в ленте, только если у него есть ответы
  parentId: string | null; // это ответ в треде
  alsoInChannel: boolean; // ответ, показанный и в ленте
  replyCount: number; // сводка треда на родителе
  replyUserIds: string[]; // последние ответившие, до THREAD_SUMMARY_USERS
  lastReplyAt: string | null;
  reactions: ReactionDto[];
  files: FileDto[]; // по порядку вложения
};

export type ThreadSummaryDto = Pick<MessageDto, "replyCount" | "replyUserIds" | "lastReplyAt"> & {
  conversationId: string;
  parentId: string;
};

export type RepliesPageDto = {
  parent: MessageDto;
  replies: MessageDto[]; // по возрастанию seq
  hasMore: boolean;
  subscribed: boolean; // слежу ли я за тредом
};

export type MessageLinkDto = { conversationId: string; messageId: string; parentId: string | null; seq: number };

export type ReactionEventDto = { conversationId: string; messageId: string; parentId: string | null; emoji: string; userId: string };
export type MessageDeletedDto = Pick<MessageDto, "id" | "conversationId" | "parentId" | "seq" | "userId" | "mentions">;

// ───────────── каналы, ЛС, упоминания ─────────────

export const CHANNEL_NAME_MAX = 80;
export const CHANNEL_NAME_RE = /^[a-z0-9_-]{1,80}$/;
export const DM_MAX_OTHERS = 8;

const translit: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", ґ: "g", д: "d", е: "e", ё: "e", є: "ie", ж: "zh", з: "z", и: "i", і: "i", ї: "i",
  й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
  ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "iu", я: "ia",
};

// Кириллица (ru/uk) → латиница, в нижнем регистре; остальные символы как есть.
export function transliterate(text: string): string {
  return [...text.toLowerCase()].map((ch) => translit[ch] ?? ch).join("");
}

// Поиск, которому всё равно, на какой раскладке имя и запрос: «бор» находит boris, «mark» — Марка.
// -1 — не подходит, 0 — начинается с запроса (такие выше), 1 — содержит его.
export function matchRank(text: string, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const hay = [text.toLowerCase(), transliterate(text)];
  const needles = [q, transliterate(q)];
  let rank = -1;
  for (const h of hay) {
    for (const n of needles) {
      if (h.startsWith(n)) return 0;
      if (h.includes(n)) rank = 1;
    }
  }
  return rank;
}

// Имя канала из того, что человек напечатал: строчные латинские буквы, цифры, «-» и «_»;
// кириллица транслитерируется, пробелы и прочее становятся дефисом.
export function normalizeChannelName(raw: string): string {
  return transliterate(raw)
    .replace(/[\s.]+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, CHANNEL_NAME_MAX);
}

export const CreateChannelInput = z.object({
  name: z.string().regex(CHANNEL_NAME_RE, "Только строчные латинские буквы, цифры, «-» и «_», до 80 символов"),
  kind: z.enum(["public", "private"]).default("public"),
  purpose: z.string().trim().max(250).default(""),
  memberIds: z.array(z.uuid()).max(100).default([]),
});
export type CreateChannelInput = z.infer<typeof CreateChannelInput>;

export const UpdateConversationInput = z.object({
  name: z.string().regex(CHANNEL_NAME_RE, "Только строчные латинские буквы, цифры, «-» и «_», до 80 символов").optional(),
  topic: z.string().trim().max(250).optional(),
  purpose: z.string().trim().max(250).optional(),
});
export type UpdateConversationInput = z.infer<typeof UpdateConversationInput>;

export const OpenDmInput = z.object({
  userIds: z.array(z.uuid()).max(DM_MAX_OTHERS, `В личной переписке не больше ${DM_MAX_OTHERS + 1} человек`),
});
export type OpenDmInput = z.infer<typeof OpenDmInput>;

export const AddMembersInput = z.object({ userIds: z.array(z.uuid()).min(1).max(100) });
export type AddMembersInput = z.infer<typeof AddMembersInput>;

export const BrowseQuery = z.object({ query: z.string().trim().max(80).optional() });
export type BrowseQuery = z.infer<typeof BrowseQuery>;

// Упоминания в тексте хранятся токенами с id, а не именами: переименования ничего не ломают.
export const mentionToken = {
  user: (id: string) => `<@${id}>`,
  conversation: (id: string) => `<#${id}>`,
  here: "<!here>",
  channel: "<!channel>",
  everyone: "<!everyone>",
} as const;

export * from "./markup.js";

export type WorkspaceDto = {
  name: string;
  whoCanInvite: "everyone" | "admins";
  messageEditWindowMinutes: number | null; // null — править можно всегда
};

export type BootDto = {
  me: UserDto;
  workspace: WorkspaceDto;
  users: UserDto[];
  conversations: ConversationDto[];
  presence: Record<string, Presence>; // только «в сети»; кого нет — тот away
  preferences: PreferencesDto;
  lastEventId: number;
};

export type MessagesPageDto = {
  messages: MessageDto[]; // по возрастанию seq
  hasMore: boolean; // есть ли ещё в запрошенном направлении
};

// ───────────── realtime ─────────────

export type EventDto =
  | { id: number; kind: "message.created"; conversationId: string; payload: MessageDto }
  | { id: number; kind: "message.updated"; conversationId: string; payload: MessageDto }
  | { id: number; kind: "message.deleted"; conversationId: string; payload: MessageDeletedDto }
  | { id: number; kind: "thread.updated"; conversationId: string; payload: ThreadSummaryDto }
  | { id: number; kind: "reaction.added"; conversationId: string; payload: ReactionEventDto }
  | { id: number; kind: "reaction.removed"; conversationId: string; payload: ReactionEventDto }
  | { id: number; kind: "read.updated"; userId: string; payload: { conversationId: string; lastReadSeq: number } }
  | { id: number; kind: "user.created"; payload: UserDto }
  | { id: number; kind: "user.updated"; payload: UserDto }
  | { id: number; kind: "member.joined"; conversationId: string; payload: { conversationId: string; userId: string } }
  | { id: number; kind: "member.left"; conversationId: string; payload: { conversationId: string; userId: string } }
  | { id: number; kind: "conversation.updated"; conversationId: string; payload: ConversationInfoDto }
  | { id: number; kind: "preferences.updated"; userId: string; payload: PreferencesDto };

export type EventKind = EventDto["kind"];

// Клиент → сервер: "hello" после (пере)подключения, "active" — человек что-то делает в окне (не чаще раза в минуту)
export type HelloPayload = { lastEventId: number };

// Сервер → клиент, мимо журнала: присутствие не хранится
export type PresenceEventDto = { userId: string; presence: Presence };

// Сервер → клиент: "events" (пачка по возрастанию id), "synced" (догрузка закончена), "resync" (журнал короче — перезагрузить состояние)
export const SOCKET_PATH = "/ws";

// ───────────── звонки ─────────────
// Медиа идёт через LiveKit (облако): сервер чата только выдаёт токены и знает, кто в каком звонке.
// В ЛС звонок «звонит» остальным участникам; в канале это созвон, к которому можно присоединиться.
export type CallDto = {
  id: string;
  conversationId: string;
  startedBy: string | null;
  startedAt: string;
  participantIds: string[]; // кто сейчас в звонке
};

export type CallsDto = { enabled: boolean; calls: CallDto[] };

// Ответ на «начать или присоединиться»: куда подключаться и с каким токеном.
export type CallJoinDto = { call: CallDto; url: string; token: string };

// Сервер → клиент, мимо журнала: состояние звонков эфемерно, после переподключения клиент заново читает GET /calls.
export const CALL_EVENT = "call";
export type CallEventDto =
  | { kind: "updated"; call: CallDto }
  | { kind: "ended"; callId: string; conversationId: string }
  // Входящий звонок в ЛС: показать окно с «Принять» и «Отклонить».
  | { kind: "ring"; call: CallDto; from: string }
  // Звонок больше не звонит этому человеку: принял на другом устройстве, отклонил или звонящий положил трубку.
  | { kind: "ring.stop"; callId: string }
  | { kind: "declined"; callId: string; userId: string };

// Сколько звонит вызов в ЛС, пока звонящий один.
export const CALL_RING_SECONDS = 45;
