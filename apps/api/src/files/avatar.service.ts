// Фото профиля: из загруженной картинки делаем квадрат 256 px (webp) со своим ключом, исходный файл удаляем.
// Ключ случайный при каждой смене, поэтому адрес аватара можно кешировать надолго.
import { randomUUID } from "node:crypto";
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import sharp from "sharp";
import { PrismaService } from "../db/prisma.service.js";
import type { users } from "../generated/prisma/client.js";
import { StorageService } from "./storage.js";

const AVATAR_PX = 256;

@Injectable()
export class AvatarService {
  private readonly log = new Logger("avatars");

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async fromFile(me: users, fileId: string): Promise<string> {
    const f = await this.prisma.files.findUnique({ where: { id: fileId }, include: { _count: { select: { message_files: true } } } });
    const thumbs = (f?.thumbnails ?? {}) as Record<string, string>;
    const source = thumbs["720"] ?? thumbs["360"];
    if (!f || f.uploader_id !== me.id || f.status !== "ready" || f.deleted_at || f._count.message_files > 0 || !f.width || !source) {
      throw new BadRequestException("Для фото нужна картинка JPG, PNG, GIF или WebP, загруженная вами");
    }
    const square = await sharp(await this.storage.getBuffer(source))
      .resize(AVATAR_PX, AVATAR_PX, { fit: "cover", position: "attention" })
      .webp({ quality: 82 })
      .toBuffer();
    const key = `avatars/${me.id}/${randomUUID()}.webp`;
    await this.storage.putBuffer(key, square, "image/webp");
    // Исходник больше не нужен: в сообщениях его нет, а фото живёт отдельным объектом.
    await this.prisma.files.update({ where: { id: f.id }, data: { deleted_at: new Date() } });
    await this.storage.remove([f.storage_key, ...Object.values(thumbs)]).catch(() => undefined);
    return key;
  }

  async drop(key: string | null | undefined): Promise<void> {
    if (!key) return;
    await this.storage.remove([key]).catch((err: Error) => this.log.warn(`remove ${key}: ${err.message}`));
  }
}
