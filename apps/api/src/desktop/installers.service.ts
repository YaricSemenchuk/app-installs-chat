// Установщики десктоп-приложения: администратор загружает .dmg и .exe потоком в хранилище, вошедшие скачивают.
// Для каждой платформы хранится только последняя сборка; прежний файл удаляется после замены.
import { randomUUID } from "node:crypto";
import { PassThrough, Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, PayloadTooLargeException } from "@nestjs/common";
import {
  INSTALLER_EXT,
  MAX_INSTALLER_BYTES,
  isAdminRole,
  type DesktopInfoDto,
  type DesktopPlatform,
  type InstallerDto,
  type Role,
  type UploadInstallerQuery,
} from "@teamchat/shared";
import { toInstallerDto } from "../common/mappers.js";
import { PrismaService } from "../db/prisma.service.js";
import { disposition } from "../files/files.service.js";
import { StorageService, type Delivery } from "../files/storage.js";
import type { users } from "../generated/prisma/client.js";

const CONTENT_TYPE: Record<DesktopPlatform, string> = {
  mac: "application/x-apple-diskimage",
  win: "application/vnd.microsoft.portable-executable",
};
const NOT_INSTALLER: Record<DesktopPlatform, string> = {
  mac: "Это не образ диска macOS (.dmg)",
  win: "Это не программа для Windows (.exe)",
};

// Проверка по содержимому, а не только по имени: .exe начинается с «MZ»,
// у образа .dmg (UDIF) последние 512 байт — служебный блок с подписью «koly».
function looksLike(platform: DesktopPlatform, head: Buffer, tail: Buffer): boolean {
  if (platform === "win") return head.subarray(0, 2).toString("latin1") === "MZ";
  return tail.length === 512 && tail.subarray(0, 4).toString("latin1") === "koly";
}

@Injectable()
export class InstallersService {
  private readonly log = new Logger("installers");

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async info(): Promise<DesktopInfoDto> {
    const info: DesktopInfoDto = { mac: null, win: null };
    for (const row of await this.prisma.desktop_installers.findMany()) info[row.platform as DesktopPlatform] = toInstallerDto(row);
    return info;
  }

  async upload(me: users, platform: DesktopPlatform, q: UploadInstallerQuery, body: Readable, contentLength: number | undefined): Promise<InstallerDto> {
    this.assertAdmin(me);
    const ext = INSTALLER_EXT[platform];
    if (!q.name.toLowerCase().endsWith(ext)) throw new BadRequestException(`Нужен файл ${ext}`);
    if (contentLength === undefined || !Number.isInteger(contentLength) || contentLength <= 0) {
      throw new BadRequestException("Нужен размер файла в заголовке Content-Length");
    }
    if (contentLength > MAX_INSTALLER_BYTES) throw new PayloadTooLargeException("Установщик больше 512 МБ");

    const key = `desktop/${platform}/${randomUUID()}${ext}`;
    let received = 0;
    let head = Buffer.alloc(0);
    let tail = Buffer.alloc(0);
    const counter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        received += chunk.length;
        if (received > contentLength) {
          done(new PayloadTooLargeException("Файл больше заявленного размера"));
          return;
        }
        if (head.length < 2) head = Buffer.concat([head, chunk.subarray(0, 2 - head.length)]);
        // Копия, а не срез: срез держал бы в памяти весь кусок потока.
        tail = chunk.length >= 512 ? Buffer.from(chunk.subarray(-512)) : Buffer.concat([tail, chunk]).subarray(-512);
        done(null, chunk);
      },
    });
    const out = new PassThrough();
    try {
      await Promise.all([pipeline(body, counter, out), this.storage.put(key, out, CONTENT_TYPE[platform])]);
    } catch (err) {
      await this.storage.remove([key]).catch(() => undefined);
      if (err instanceof PayloadTooLargeException) throw err;
      this.log.warn(`upload ${platform} failed: ${(err as Error).message}`);
      throw new BadRequestException("Загрузка прервалась, попробуйте ещё раз");
    }
    const problem = received !== contentLength ? "Файл пришёл не целиком, попробуйте ещё раз" : !looksLike(platform, head, tail) ? NOT_INSTALLER[platform] : null;
    if (problem) {
      await this.storage.remove([key]).catch(() => undefined);
      throw new BadRequestException(problem);
    }

    const data = { version: q.version, file_name: q.name, size_bytes: BigInt(received), storage_key: key, uploaded_by: me.id };
    const old = await this.prisma.desktop_installers.findUnique({ where: { platform } });
    const row = await this.prisma.desktop_installers.upsert({ where: { platform }, create: { platform, ...data }, update: { ...data, created_at: new Date() } });
    if (old) await this.drop(old.storage_key);
    this.log.log(`${platform} ${q.version} (${received} bytes) uploaded by ${me.id}`);
    return toInstallerDto(row);
  }

  async download(platform: DesktopPlatform): Promise<Delivery & { contentType: string; disposition: string }> {
    const row = await this.prisma.desktop_installers.findUnique({ where: { platform } });
    if (!row) throw new NotFoundException("Установщик ещё не загружен");
    const opts = { contentType: CONTENT_TYPE[platform], disposition: disposition("attachment", row.file_name) };
    return { ...(await this.storage.deliver(row.storage_key, opts)), ...opts };
  }

  async remove(me: users, platform: DesktopPlatform): Promise<void> {
    this.assertAdmin(me);
    const row = await this.prisma.desktop_installers.findUnique({ where: { platform } });
    if (!row) return;
    await this.prisma.desktop_installers.delete({ where: { platform } });
    await this.drop(row.storage_key);
  }

  private assertAdmin(me: users) {
    if (!isAdminRole(me.role as Role)) throw new ForbiddenException("Установщики загружают администраторы");
  }

  private async drop(key: string) {
    await this.storage.remove([key]).catch((err: Error) => this.log.warn(`remove ${key}: ${err.message}`));
  }
}
