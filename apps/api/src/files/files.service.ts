// Файлы: запись и загрузка байтов (через API потоком), миниатюры, доступ, вид «Файлы», удаление.
import { randomUUID } from "node:crypto";
import { PassThrough, Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import sharp from "sharp";
import {
  MAX_FILE_BYTES,
  THUMB_SIZES,
  type CreateFileInput,
  type FileDto,
  type FilesPageDto,
  type ListFilesQuery,
  type UploadTicketDto,
} from "@teamchat/shared";
import { toFileDto, toMessageDto, type FileRow } from "../common/mappers.js";
import { PrismaService } from "../db/prisma.service.js";
import { Prisma, type files, type users } from "../generated/prisma/client.js";
import { isAdmin } from "../conversations/access.js";
import { MESSAGE_INCLUDE } from "../conversations/message-include.js";
import { EventsService } from "../realtime/events.service.js";
import { RealtimeHub } from "../realtime/hub.service.js";
import { StorageService, type Delivery } from "./storage.js";

// Inline показываем только эти картинки — и только если sharp сам их прочитал. SVG, HTML и прочее —
// всегда скачиванием, чтобы файл из чата не выполнил скрипт в нашем origin.
const INLINE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const SHARP_FORMATS = new Set(["jpeg", "png", "gif", "webp"]);
const THUMB_SOURCE_MAX = 30 * 1024 * 1024; // картинки больше — без миниатюр, просто файлом
const PENDING_TTL_MS = 24 * 3600_000;
const CLEANUP_EVERY_MS = 3600_000;

const notFound = () => new NotFoundException("Файл не найден");

function cleanName(raw: string): string {
  const name = raw.replace(/[\u0000-\u001f\u007f/\\]/g, "_").trim();
  return name.slice(0, 255) || "файл";
}

function cleanMime(raw: string): string {
  const v = raw.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(v) ? v : "application/octet-stream";
}

// Имя файла для Content-Disposition: ASCII-запасной вариант + полное имя в UTF-8 (RFC 6266).
export function disposition(kind: "inline" | "attachment", name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

@Injectable()
export class FilesService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("files");
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly events: EventsService,
    private readonly hub: RealtimeHub,
  ) {}

  onModuleInit() {
    this.cleanupTimer = setInterval(() => void this.cleanupPending(), CLEANUP_EVERY_MS);
    this.cleanupTimer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.cleanupTimer);
  }

  async create(me: users, input: CreateFileInput): Promise<UploadTicketDto> {
    const id = randomUUID();
    const file = await this.prisma.files.create({
      data: {
        id,
        uploader_id: me.id,
        name: cleanName(input.name),
        mimetype: cleanMime(input.mimetype || "application/octet-stream"),
        size_bytes: BigInt(input.size),
        storage_key: `files/${id}/original`,
      },
    });
    return { file: toFileDto(file), uploadUrl: `/api/files/${id}/content` };
  }

  // Байты идут потоком прямо в хранилище; считаем их на лету и обрываем всё, что больше заявленного.
  async upload(me: users, id: string, body: Readable, contentLength: number | undefined): Promise<FileDto> {
    const f = await this.prisma.files.findUnique({ where: { id } });
    if (!f || f.uploader_id !== me.id || f.deleted_at) throw notFound();
    if (f.status !== "pending") throw new ConflictException("Этот файл уже загружен");
    const expected = Number(f.size_bytes);
    if (contentLength !== undefined && contentLength !== expected) {
      throw new BadRequestException("Размер файла не совпадает с заявленным");
    }

    const collectImage = INLINE_IMAGE_TYPES.has(f.mimetype) && expected <= THUMB_SOURCE_MAX;
    const chunks: Buffer[] = [];
    let received = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        received += chunk.length;
        if (received > expected || received > MAX_FILE_BYTES) {
          done(new PayloadTooLargeException("Файл больше заявленного размера"));
          return;
        }
        if (collectImage) chunks.push(chunk);
        done(null, chunk);
      },
    });
    const out = new PassThrough();
    try {
      await Promise.all([pipeline(body, counter, out), this.storage.put(f.storage_key, out, f.mimetype)]);
    } catch (err) {
      await this.storage.remove([f.storage_key]).catch(() => undefined);
      if (err instanceof PayloadTooLargeException) throw err;
      this.log.warn(`upload ${id} failed: ${(err as Error).message}`);
      throw new BadRequestException("Загрузка прервалась, попробуйте ещё раз");
    }
    if (received !== expected) {
      await this.storage.remove([f.storage_key]).catch(() => undefined);
      throw new BadRequestException("Файл пришёл не целиком, попробуйте ещё раз");
    }

    const image = collectImage ? await this.thumbnails(f, Buffer.concat(chunks)) : null;
    const ready = await this.prisma.files.update({
      where: { id },
      data: { status: "ready", ...(image ?? {}) },
    });
    return toFileDto(ready);
  }

  // Миниатюры 360 и 720 по большей стороне, webp, с учётом поворота из EXIF. Не прочиталось — значит не картинка.
  private async thumbnails(f: files, source: Buffer) {
    try {
      const meta = await sharp(source, { limitInputPixels: 100_000_000 }).metadata();
      if (!meta.format || !SHARP_FORMATS.has(meta.format) || !meta.width || !meta.height) return null;
      const rotated = (meta.orientation ?? 1) >= 5;
      const width = rotated ? meta.height : meta.width;
      const height = rotated ? meta.width : meta.height;
      const thumbnails: Record<string, string> = {};
      for (const size of THUMB_SIZES) {
        const buf = await sharp(source, { limitInputPixels: 100_000_000 })
          .rotate()
          .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer();
        const key = `files/${f.id}/thumb-${size}.webp`;
        await this.storage.putBuffer(key, buf, "image/webp");
        thumbnails[String(size)] = key;
      }
      return { width, height, thumbnails };
    } catch (err) {
      this.log.warn(`thumbnails for ${f.id} failed: ${(err as Error).message}`);
      return null;
    }
  }

  // Видеть файл может тот, кто его загрузил, и тот, кому виден хоть один живой разговор с ним.
  async loadReadable(me: users, id: string): Promise<files> {
    const rows = await this.prisma.$queryRaw<{ ok: number }[]>`
      select 1 as ok from files f
       where f.id = ${id}::uuid and f.deleted_at is null and f.status = 'ready'
         and (f.uploader_id = ${me.id}::uuid or exists (
           select 1 from message_files mf
             join messages m on m.id = mf.message_id
             join conversations c on c.id = m.conversation_id
             left join conversation_members cm on cm.conversation_id = c.id and cm.user_id = ${me.id}::uuid
            where mf.file_id = f.id and m.deleted_at is null and (cm.user_id is not null or c.kind = 'public')))`;
    if (rows.length === 0) throw notFound();
    return this.prisma.files.findUniqueOrThrow({ where: { id } });
  }

  async download(me: users, id: string, wantInline: boolean): Promise<Delivery & { contentType: string; disposition: string }> {
    const f = await this.loadReadable(me, id);
    const inline = wantInline && f.width !== null && INLINE_IMAGE_TYPES.has(f.mimetype);
    const opts = {
      contentType: inline ? f.mimetype : "application/octet-stream",
      disposition: disposition(inline ? "inline" : "attachment", f.name),
    };
    return { ...(await this.storage.deliver(f.storage_key, opts)), ...opts };
  }

  async thumb(me: users, id: string, size: number): Promise<Delivery & { contentType: string; disposition: string }> {
    const f = await this.loadReadable(me, id);
    const key = (f.thumbnails as Record<string, string>)[String(size)];
    if (!key) throw notFound();
    const opts = { contentType: "image/webp", disposition: disposition("inline", `${f.name}.webp`) };
    return { ...(await this.storage.deliver(key, opts)), ...opts };
  }

  // Вид «Файлы»: всё, что выложено в моих разговорах, свежее сверху.
  async list(me: users, q: ListFilesQuery): Promise<FilesPageDto> {
    const cursor = q.before ? decodeCursor(q.before) : null;
    const like = q.query ? `%${q.query.replace(/[\\%_]/g, "\\$&")}%` : null;
    const rows = await this.prisma.$queryRaw<
      (FileRow & { message_id: string; position: number; conversation_id: string; user_id: string; shared_at: Date; shared_at_exact: string })[]
    >`
      select f.id, f.name, f.mimetype, f.size_bytes, f.uploader_id, f.created_at, f.status, f.width, f.height, f.thumbnails, f.deleted_at,
             mf.message_id, mf.position, m.conversation_id, m.user_id, m.created_at as shared_at, m.created_at::text as shared_at_exact
        from message_files mf
        join files f on f.id = mf.file_id
        join messages m on m.id = mf.message_id
        join conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = ${me.id}::uuid
       where f.deleted_at is null and f.status = 'ready' and m.deleted_at is null
         and (${q.type}::text = 'all' or (${q.type}::text = 'images' and f.width is not null) or (${q.type}::text = 'documents' and f.width is null))
         and (${q.mine}::boolean = false or f.uploader_id = ${me.id}::uuid)
         and (${like}::text is null or f.name ilike ${like})
         ${
           cursor
             ? Prisma.sql`and ((m.created_at, mf.message_id) < (${cursor.at}::timestamptz, ${cursor.messageId}::uuid)
                           or ((m.created_at, mf.message_id) = (${cursor.at}::timestamptz, ${cursor.messageId}::uuid) and mf.position > ${cursor.position}))`
             : Prisma.empty
         }
       -- Свежие сообщения сверху, файлы внутри сообщения — в том порядке, в каком их приложили.
       order by m.created_at desc, mf.message_id desc, mf.position asc
       limit ${q.limit + 1}`;
    const more = rows.length > q.limit;
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => ({
        file: toFileDto(r),
        messageId: r.message_id,
        conversationId: r.conversation_id,
        userId: r.user_id,
        sharedAt: r.shared_at.toISOString(),
      })),
      nextCursor: more && last ? encodeCursor(last.shared_at_exact, last.message_id, last.position) : null,
    };
  }

  // Удалить файл может загрузивший или админ. Сообщения остаются, в них — пометка «файл удалён».
  async remove(me: users, id: string): Promise<void> {
    const f = await this.prisma.files.findUnique({ where: { id }, include: { message_files: { select: { message_id: true } } } });
    if (!f || f.deleted_at) throw notFound();
    if (f.uploader_id !== me.id && !isAdmin(me)) throw new ForbiddenException("Удалить файл может тот, кто его загрузил, или администратор");
    const messageIds = f.message_files.map((mf) => mf.message_id);
    const events = await this.prisma.$transaction(async (tx) => {
      await this.events.lock(tx);
      await tx.files.update({ where: { id }, data: { deleted_at: new Date() } });
      const affected = await tx.messages.findMany({ where: { id: { in: messageIds }, deleted_at: null }, include: MESSAGE_INCLUDE });
      return Promise.all(affected.map((m) => this.events.append(tx, "message.updated", { conversationId: m.conversation_id }, toMessageDto(m))));
    });
    if (events.length > 0) this.hub.publish(events);
    const keys = [f.storage_key, ...Object.values(f.thumbnails as Record<string, string>)];
    await this.storage.remove(keys).catch((err: Error) => this.log.warn(`remove objects for ${id}: ${err.message}`));
  }

  // Брошенные загрузки (вкладку закрыли до отправки) живут сутки.
  async cleanupPending(): Promise<void> {
    const stale = await this.prisma.files.findMany({
      where: { status: "pending", created_at: { lt: new Date(Date.now() - PENDING_TTL_MS) } },
      select: { id: true, storage_key: true },
      take: 500,
    });
    if (stale.length === 0) return;
    await this.storage.remove(stale.map((f) => f.storage_key)).catch(() => undefined);
    await this.prisma.files.deleteMany({ where: { id: { in: stale.map((f) => f.id) }, status: "pending" } });
  }
}

// Курсор — время сообщения в точности как в базе (текстом, без округления до Date), id сообщения и позиция файла.
function encodeCursor(at: string, messageId: string, position: number): string {
  return Buffer.from(`${at}|${messageId}|${position}`).toString("base64url");
}

function decodeCursor(raw: string): { at: string; messageId: string; position: number } {
  const [at, messageId, pos] = Buffer.from(raw, "base64url").toString().split("|");
  const position = Number(pos);
  if (!at || !/^\d{4}-\d{2}-\d{2}[ T][\d:.]+([+-]\d{2}(:?\d{2})?|Z)$/.test(at) || !messageId || !/^[0-9a-f-]{36}$/.test(messageId) || !Number.isInteger(position)) {
    throw new BadRequestException("Некорректный курсор");
  }
  return { at, messageId, position };
}
