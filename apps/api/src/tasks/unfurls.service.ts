// Карточки ссылок на Figma в сообщениях. Сообщение уходит сразу, а превью собирается после коммита
// и приходит всем событием message.updated. Правка пересобирает карточки: убранные ссылки — без карточек.
import { ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { FIGMA_UNFURLS_PER_MESSAGE, extractLinks, parseFigmaUrl, type FigmaRefDto } from "@teamchat/shared";
import { toMessageDto } from "../common/mappers.js";
import { MESSAGE_INCLUDE } from "../conversations/message-include.js";
import { PrismaService } from "../db/prisma.service.js";
import type { users } from "../generated/prisma/client.js";
import { EventsService } from "../realtime/events.service.js";
import { RealtimeHub } from "../realtime/hub.service.js";
import { FigmaService } from "./figma.service.js";

const figmaRefs = (text: string): FigmaRefDto[] => {
  const seen = new Set<string>();
  const refs: FigmaRefDto[] = [];
  for (const url of extractLinks(text)) {
    const ref = parseFigmaUrl(url);
    if (!ref || seen.has(ref.url)) continue;
    seen.add(ref.url);
    refs.push(ref);
  }
  return refs.slice(0, FIGMA_UNFURLS_PER_MESSAGE);
};

@Injectable()
export class UnfurlsService {
  private readonly log = new Logger("unfurls");

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly hub: RealtimeHub,
    private readonly figma: FigmaService,
  ) {}

  // После отправки или правки, не дожидаясь: ответ на отправку не ждёт Figma.
  refresh(messageId: string, text: string, hadUnfurls = false): void {
    if (!this.figma.enabled || (!hadUnfurls && !text.includes("figma.com"))) return;
    void this.run(messageId).catch((err: Error) => this.log.warn(`${messageId}: ${err.message}`));
  }

  // Убрать карточку может только автор сообщения; ссылка в тексте остаётся.
  async hide(me: users, messageId: string, unfurlId: string): Promise<void> {
    const unfurl = await this.prisma.message_unfurls.findUnique({ where: { id: unfurlId }, include: { messages: true } });
    if (!unfurl || unfurl.message_id !== messageId || unfurl.messages.deleted_at) throw new NotFoundException("Карточка не найдена");
    if (unfurl.messages.user_id !== me.id) throw new ForbiddenException("Убрать карточку может только автор сообщения");
    if (unfurl.hidden) return;
    const event = await this.prisma.$transaction(async (tx) => {
      await this.events.lock(tx);
      await tx.message_unfurls.update({ where: { id: unfurlId }, data: { hidden: true } });
      const full = await tx.messages.findUniqueOrThrow({ where: { id: messageId }, include: MESSAGE_INCLUDE });
      return this.events.append(tx, "message.updated", { conversationId: full.conversation_id }, toMessageDto(full));
    });
    this.hub.publish([event]);
  }

  private async run(messageId: string): Promise<void> {
    const msg = await this.prisma.messages.findUnique({ where: { id: messageId }, include: { message_unfurls: true } });
    if (!msg || msg.deleted_at) return;
    const refs = figmaRefs(msg.text);
    const wanted = new Set(refs.map((r) => r.url));
    const stale = msg.message_unfurls.filter((u) => !wanted.has(u.url));
    const missing = refs.filter((r) => !msg.message_unfurls.some((u) => u.url === r.url));
    if (stale.length === 0 && missing.length === 0) return;

    const previews = await Promise.all(missing.map((r) => this.figma.preview(r).catch(() => null)));
    // Карточку без доступа к файлу не показываем: ссылка в тексте и так есть.
    const add = missing.flatMap((r, i) => (previews[i]?.status === "ready" ? [{ ref: r, preview: previews[i]! }] : []));
    if (stale.length === 0 && add.length === 0) return;

    const event = await this.prisma.$transaction(async (tx) => {
      await this.events.lock(tx);
      // Пока ходили в Figma, сообщение могли изменить или удалить: тогда карточки соберёт следующий проход.
      const cur = await tx.messages.findUnique({ where: { id: messageId }, select: { text: true, deleted_at: true } });
      if (!cur || cur.deleted_at || cur.text !== msg.text) return null;
      if (stale.length > 0) await tx.message_unfurls.deleteMany({ where: { id: { in: stale.map((u) => u.id) } } });
      if (add.length > 0) {
        await tx.message_unfurls.createMany({
          data: add.map(({ ref, preview }) => ({
            message_id: messageId,
            url: ref.url,
            status: "ready",
            site_name: "Figma",
            title: preview.file_name,
            description: preview.node_name,
            figma_preview_id: preview.id,
            fetched_at: new Date(),
          })),
          skipDuplicates: true,
        });
      }
      const full = await tx.messages.findUniqueOrThrow({ where: { id: messageId }, include: MESSAGE_INCLUDE });
      return this.events.append(tx, "message.updated", { conversationId: full.conversation_id }, toMessageDto(full));
    });
    if (event) this.hub.publish([event]);
  }
}
