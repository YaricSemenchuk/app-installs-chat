// Что загружать вместе с сообщением, чтобы собрать MessageDto (common/mappers.ts → toMessageDto).
export const MESSAGE_INCLUDE = {
  message_mentions: { select: { user_id: true } },
  reactions: { select: { emoji: true, user_id: true, created_at: true } },
  message_files: { select: { position: true, files: true }, orderBy: { position: "asc" } },
  message_unfurls: { where: { hidden: false, figma_preview_id: { not: null } }, include: { figma_previews: true }, orderBy: { created_at: "asc" } },
} as const;
