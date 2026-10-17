// Строки БД (snake_case, BigInt, Date) → DTO контракта из @teamchat/shared.
import { createHash } from "node:crypto";
import type {
  AdminUserDto,
  ConversationInfoDto,
  ConversationKind,
  EventDto,
  DesktopPlatform,
  FigmaPreviewDto,
  FigmaPreviewStatus,
  FileDto,
  InstallerDto,
  InviteDto,
  MessageDto,
  ReactionDto,
  Role,
  UnfurlDto,
  UserDto,
} from "@teamchat/shared";
import { figmaFileUrl } from "@teamchat/shared";
import type { conversations, desktop_installers, events, figma_previews, files, invites, message_unfurls, messages, users } from "../generated/prisma/client.js";

// Версия в адресе аватара — от ключа объекта: новое фото → новый адрес, старое можно кешировать надолго.
const avatarUrl = (u: users) => (u.avatar_key ? `/api/users/${u.id}/avatar?v=${createHash("sha1").update(u.avatar_key).digest("hex").slice(0, 12)}` : null);

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
    avatarUrl: avatarUrl(u),
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
export type FileRow = Pick<
  files,
  "id" | "name" | "mimetype" | "size_bytes" | "uploader_id" | "created_at" | "status" | "width" | "height" | "thumbnails" | "deleted_at"
>;

export function toFileDto(f: FileRow): FileDto {
  const thumbs = Object.keys((f.thumbnails ?? {}) as Record<string, string>)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  return {
    id: f.id,
    name: f.name,
    mimetype: f.mimetype,
    size: Number(f.size_bytes),
    uploaderId: f.uploader_id,
    createdAt: f.created_at.toISOString(),
    status: f.status === "ready" ? "ready" : "pending",
    image: f.width && f.height ? { width: f.width, height: f.height, thumbs } : null,
    deleted: f.deleted_at !== null,
  };
}

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

// Превью макета: картинка раздаётся через API, версия в адресе меняется вместе с картинкой.
export function toFigmaPreviewDto(p: figma_previews): FigmaPreviewDto {
  const nodeId = p.node_id || null;
  const image =
    p.image_key && p.width && p.height
      ? { url: `/api/figma/previews/${p.id}/image?v=${createHash("sha1").update(p.image_key).digest("hex").slice(0, 12)}`, width: p.width, height: p.height }
      : null;
  return {
    id: p.id,
    url: figmaFileUrl(p.file_key, nodeId),
    fileKey: p.file_key,
    nodeId,
    status: p.status as FigmaPreviewStatus,
    fileName: p.file_name,
    nodeName: p.node_name,
    image,
    lastModified: p.last_modified?.toISOString() ?? null,
  };
}

type UnfurlRow = message_unfurls & { figma_previews: figma_previews | null };

// Пока карточки бывают только у ссылок на Figma; карточка без превью не показывается.
function toUnfurls(rows: UnfurlRow[]): UnfurlDto[] {
  return rows
    .filter((u) => !u.hidden && u.figma_previews)
    .map((u) => ({ id: u.id, url: u.url, kind: "figma" as const, figma: toFigmaPreviewDto(u.figma_previews!) }));
}

// Что приходит из базы вместе с сообщением (см. MESSAGE_INCLUDE в messages.service).
export type MessageRow = messages & {
  message_mentions?: { user_id: string }[];
  reactions?: ReactionRow[];
  message_files?: { position: number; files: FileRow }[];
  message_unfurls?: UnfurlRow[];
};

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
    files: deleted ? [] : [...(m.message_files ?? [])].sort((a, b) => a.position - b.position).map((mf) => toFileDto(mf.files)),
    unfurls: deleted ? [] : toUnfurls(m.message_unfurls ?? []),
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
  files: [],
  unfurls: [],
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

export function toInstallerDto(r: desktop_installers): InstallerDto {
  const platform = r.platform as DesktopPlatform;
  return {
    platform,
    version: r.version,
    name: r.file_name,
    size: Number(r.size_bytes),
    uploadedAt: r.created_at.toISOString(),
    uploadedBy: r.uploaded_by,
    url: `/api/desktop/${platform}/download`,
  };
}
