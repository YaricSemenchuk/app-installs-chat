// Figma через REST API персональным токеном: превью макетов и нерешённые комментарии. Только чтение.
// Лимиты у API маленькие, а ссылки на картинки живут недолго, поэтому превью (имя файла, кадра и картинку)
// храним у себя и обновляем не чаще раза в сутки; комментарии — в памяти на минуту.
import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import sharp from "sharp";
import { figmaFileUrl, type FigmaCommentDto, type FigmaRefDto } from "@teamchat/shared";
import { config, isProd } from "../config.js";
import { PrismaService } from "../db/prisma.service.js";
import type { figma_previews } from "../generated/prisma/client.js";
import { StorageService, type Delivery } from "../files/storage.js";

const TIMEOUT_MS = 20_000;
const FRESH_MS = 24 * 60 * 60_000;
const MISS_FRESH_MS = 10 * 60_000; // нет доступа или файла: скоро могут поделиться
const FAILED_RETRY_MS = 5 * 60_000;
const COMMENTS_TTL_MS = 60_000;
const COMMENTS_MAX = 100;
const IMAGE_WIDTH = 1024;
const RENDER_WIDTH = 1600; // Figma рисует чуть крупнее, sharp уменьшает до IMAGE_WIDTH
const RENDER_MAX_HEIGHT = 6000;
const IMAGE_MAX_BYTES = 20 * 1024 * 1024;

export class FigmaHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterS: number | null,
  ) {
    super(`figma ${status}`);
  }
}

type RawComment = {
  id: string;
  parent_id?: string | null;
  message: string;
  created_at: string;
  resolved_at?: string | null;
  user?: { handle?: string; img_url?: string };
  client_meta?: { node_id?: string } | null;
};

// Для ошибок, которые видит человек: доступ, лимит или сбой.
export function figmaErrorText(err: unknown): string {
  const status = err instanceof FigmaHttpError ? err.status : 0;
  if (status === 403) return "Figma не пускает к файлу: проверьте FIGMA_TOKEN и что файл открыт аккаунту этого токена";
  if (status === 404) return "Файл Figma не найден";
  if (status === 429) return "Figma просит подождать: слишком много запросов";
  return "Figma не отвечает, попробуйте позже";
}

@Injectable()
export class FigmaService {
  private readonly log = new Logger("figma");
  private readonly inflight = new Map<string, Promise<figma_previews>>();
  private readonly comments = new Map<string, { at: number; value: Promise<FigmaCommentDto[]> }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  get enabled(): boolean {
    return config.FIGMA_TOKEN !== undefined;
  }

  // Превью файла (nodeId null) или кадра. Свежее берём из базы; одновременные запросы одного превью ждут один ответ.
  async preview(ref: Pick<FigmaRefDto, "fileKey" | "nodeId">): Promise<figma_previews> {
    const node = ref.nodeId ?? "";
    const row = await this.prisma.figma_previews.findUnique({ where: { file_key_node_id: { file_key: ref.fileKey, node_id: node } } });
    if (row && !this.stale(row)) return row;
    if (!this.enabled) {
      return row ?? this.prisma.figma_previews.upsert({ where: { file_key_node_id: { file_key: ref.fileKey, node_id: node } }, create: { file_key: ref.fileKey, node_id: node }, update: {} });
    }
    const key = `${ref.fileKey}:${node}`;
    let pending = this.inflight.get(key);
    if (!pending) {
      pending = this.fetch(ref.fileKey, node, row).finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }
    return pending;
  }

  async image(id: string): Promise<(Delivery & { contentType: string; disposition: string }) | null> {
    const row = await this.prisma.figma_previews.findUnique({ where: { id } });
    if (!row?.image_key) return null;
    const opts = { contentType: "image/webp", disposition: 'inline; filename="figma.webp"' };
    return { ...(await this.storage.deliver(row.image_key, opts)), ...opts };
  }

  // Нерешённые комментарии верхнего уровня из файлов канала, новые сверху. Файл, который не прочитался, не роняет остальные.
  async openComments(fileKeys: string[]): Promise<{ comments: FigmaCommentDto[]; error: string | null }> {
    const results = await Promise.allSettled(fileKeys.map((k) => this.fileComments(k)));
    const comments = results
      .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, COMMENTS_MAX);
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    const error =
      failed.length === 0
        ? null
        : failed.length === results.length
          ? figmaErrorText(failed[0]!.reason)
          : `Не удалось прочитать комментарии из ${failed.length} файл(ов): ${figmaErrorText(failed[0]!.reason)}`;
    return { comments, error };
  }

  private stale(row: figma_previews): boolean {
    const now = Date.now();
    if (row.retry_at && row.retry_at.getTime() > now) return false;
    if (!row.fetched_at) return true;
    const age = now - row.fetched_at.getTime();
    if (row.status === "ready") return age >= FRESH_MS;
    if (row.status === "forbidden" || row.status === "missing") return age >= MISS_FRESH_MS;
    return true;
  }

  private fileComments(fileKey: string): Promise<FigmaCommentDto[]> {
    const hit = this.comments.get(fileKey);
    if (hit && Date.now() - hit.at < COMMENTS_TTL_MS) return hit.value;
    const value = (async () => {
      const [{ comments }, file] = await Promise.all([
        this.api<{ comments: RawComment[] }>(`/v1/files/${fileKey}/comments`),
        this.preview({ fileKey, nodeId: null }).catch(() => null),
      ]);
      const replies = new Map<string, number>();
      for (const c of comments) if (c.parent_id) replies.set(c.parent_id, (replies.get(c.parent_id) ?? 0) + 1);
      return comments
        .filter((c) => !c.parent_id && !c.resolved_at)
        .map((c) => {
          const nodeId = c.client_meta?.node_id && /^\d+:\d+$/.test(c.client_meta.node_id) ? c.client_meta.node_id : null;
          return {
            id: c.id,
            fileKey,
            fileName: file?.file_name || "Файл Figma",
            nodeId,
            text: c.message,
            author: { handle: c.user?.handle ?? "Кто-то", avatarUrl: c.user?.img_url || null },
            createdAt: new Date(c.created_at).toISOString(),
            replyCount: replies.get(c.id) ?? 0,
            url: `${figmaFileUrl(fileKey, nodeId)}#${encodeURIComponent(c.id)}`,
          };
        });
    })();
    const entry = { at: Date.now(), value };
    this.comments.set(fileKey, entry);
    value.catch(() => {
      if (this.comments.get(fileKey) === entry) this.comments.delete(fileKey);
    });
    return value;
  }

  private async fetch(fileKey: string, node: string, prev: figma_previews | null): Promise<figma_previews> {
    const where = { file_key_node_id: { file_key: fileKey, node_id: node } };
    try {
      let fileName = "";
      let nodeName = "";
      let lastModified: string | undefined;
      let src: string | null = null;
      if (node) {
        type Doc = { name: string; absoluteBoundingBox?: { width: number; height: number } | null };
        const res = await this.api<{ name: string; lastModified?: string; nodes: Record<string, { document?: Doc } | null> }>(
          `/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(node)}&depth=1`,
        );
        fileName = res.name;
        lastModified = res.lastModified;
        const doc = res.nodes[node]?.document;
        if (doc) {
          nodeName = doc.name;
          const box = doc.absoluteBoundingBox;
          const scale = box && box.width > 0 ? Math.min(2, RENDER_WIDTH / box.width, RENDER_MAX_HEIGHT / Math.max(1, box.height)) : 1;
          const img = await this.api<{ images: Record<string, string | null> }>(
            `/v1/images/${fileKey}?ids=${encodeURIComponent(node)}&format=png&scale=${Math.max(0.05, Math.round(scale * 100) / 100)}`,
          );
          src = img.images[node] ?? null;
        }
      }
      // Весь файл, страница или кадр, который Figma не нарисовала: обложка файла.
      if (!src) {
        const meta = await this.api<{ file: { name: string; thumbnail_url?: string; last_touched_at?: string } }>(`/v1/files/${fileKey}/meta`);
        fileName = meta.file.name;
        lastModified ??= meta.file.last_touched_at;
        src = meta.file.thumbnail_url ?? null;
      }
      const image = src ? await this.storeImage(src) : null;
      const data = {
        status: "ready",
        file_name: fileName.slice(0, 500),
        node_name: nodeName.slice(0, 500),
        image_key: image?.key ?? prev?.image_key ?? null,
        width: image?.width ?? prev?.width ?? null,
        height: image?.height ?? prev?.height ?? null,
        last_modified: lastModified ? new Date(lastModified) : null,
        fetched_at: new Date(),
        retry_at: null,
      };
      const row = await this.prisma.figma_previews.upsert({ where, create: { file_key: fileKey, node_id: node, ...data }, update: data });
      if (image && prev?.image_key && prev.image_key !== image.key) await this.storage.remove([prev.image_key]).catch(() => undefined);
      return row;
    } catch (err) {
      const status = err instanceof FigmaHttpError ? err.status : 0;
      if (status !== 403 && status !== 404 && status !== 429) this.log.warn(`preview ${fileKey} ${node}: ${(err as Error).message}`);
      // 429 и сбои не перетирают готовое превью: показываем старое и спрашиваем позже.
      const retryMs = status === 429 ? ((err as FigmaHttpError).retryAfterS ?? 60) * 1000 : FAILED_RETRY_MS;
      const failure =
        status === 403 || status === 404
          ? { status: status === 403 ? "forbidden" : "missing", fetched_at: new Date(), retry_at: null }
          : { status: prev?.status === "ready" ? "ready" : status === 429 ? "pending" : "failed", retry_at: new Date(Date.now() + retryMs) };
      return this.prisma.figma_previews.upsert({ where, create: { file_key: fileKey, node_id: node, ...failure }, update: failure });
    }
  }

  // Картинку отдаёт Figma ссылкой на своё хранилище; скачиваем, уменьшаем и кладём к себе.
  private async storeImage(src: string): Promise<{ key: string; width: number; height: number } | null> {
    // Ссылку даёт API Figma; в production — только https (поддельная Figma в разработке и e2e отдаёт http).
    if (!src.startsWith("https://") && isProd) return null;
    try {
      const res = await fetch(src, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok || !res.body) return null;
      if (Number(res.headers.get("content-length") ?? 0) > IMAGE_MAX_BYTES) return null;
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of res.body) {
        size += chunk.length;
        if (size > IMAGE_MAX_BYTES) return null;
        chunks.push(chunk);
      }
      const { data, info } = await sharp(Buffer.concat(chunks), { limitInputPixels: 100_000_000 })
        .resize({ width: IMAGE_WIDTH, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer({ resolveWithObject: true });
      const key = `figma/${randomUUID()}.webp`;
      await this.storage.putBuffer(key, data, "image/webp");
      return { key, width: info.width, height: info.height };
    } catch (err) {
      this.log.warn(`image: ${(err as Error).message}`);
      return null;
    }
  }

  private async api<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${config.FIGMA_API_URL}${path}`, { headers: { "X-Figma-Token": config.FIGMA_TOKEN! }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new FigmaHttpError(0, null);
    }
    if (res.ok) return (await res.json()) as T;
    const retry = Number(res.headers.get("retry-after"));
    throw new FigmaHttpError(res.status, Number.isFinite(retry) && retry > 0 ? Math.min(retry, 3600) : null);
  }
}
