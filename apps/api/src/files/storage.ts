// Где лежат байты файлов. Один интерфейс, два драйвера:
//   s3   — Railway Bucket (или любой S3-совместимый): скачивание редиректом на подписанную ссылку на 5 минут;
//   disk — каталог STORAGE_DIR для разработки и e2e: скачивание идёт потоком через API.
// Ключи объектов генерирует только сервер (files/<uuid>/…), из пользовательского ввода они не собираются.
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DeleteObjectsCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Injectable } from "@nestjs/common";
import { config } from "../config.js";

export type Delivery = { redirect: string } | { stream: Readable; size: number };
export type DeliverOptions = { contentType: string; disposition: string };

export interface StorageDriver {
  put(key: string, body: Readable, contentType: string): Promise<void>;
  putBuffer(key: string, body: Buffer, contentType: string): Promise<void>;
  remove(keys: string[]): Promise<void>;
  deliver(key: string, opts: DeliverOptions): Promise<Delivery>;
}

const SIGNED_URL_TTL_S = 300;

class DiskDriver implements StorageDriver {
  private readonly root = resolve(config.STORAGE_DIR);

  private path(key: string) {
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + "/")) throw new Error(`bad storage key: ${key}`);
    return p;
  }

  async put(key: string, body: Readable) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await pipeline(body, createWriteStream(p));
  }

  async putBuffer(key: string, body: Buffer) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await pipeline([body], createWriteStream(p));
  }

  async remove(keys: string[]) {
    await Promise.all(keys.map((k) => rm(this.path(k), { force: true })));
  }

  async deliver(key: string): Promise<Delivery> {
    const p = this.path(key);
    const { size } = await stat(p);
    return { stream: createReadStream(p), size };
  }
}

class S3Driver implements StorageDriver {
  private readonly bucket = config.BUCKET_NAME!;
  private readonly client = new S3Client({
    endpoint: config.BUCKET_ENDPOINT,
    region: config.BUCKET_REGION,
    forcePathStyle: config.BUCKET_FORCE_PATH_STYLE,
    credentials: { accessKeyId: config.BUCKET_ACCESS_KEY_ID!, secretAccessKey: config.BUCKET_SECRET_ACCESS_KEY! },
    // Новые SDK по умолчанию шлют CRC32 и aws-chunked — не все S3-совместимые хранилища это понимают.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  async put(key: string, body: Readable, contentType: string) {
    // Многочастная загрузка: память — пара частей по 8 МБ, а не весь файл.
    await new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: key, Body: body, ContentType: contentType },
      partSize: 8 * 1024 * 1024,
      queueSize: 2,
    }).done();
  }

  async putBuffer(key: string, body: Buffer, contentType: string) {
    await new Upload({ client: this.client, params: { Bucket: this.bucket, Key: key, Body: body, ContentType: contentType } }).done();
  }

  async remove(keys: string[]) {
    if (keys.length === 0) return;
    await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys.map((Key) => ({ Key })) } }));
  }

  async deliver(key: string, opts: DeliverOptions): Promise<Delivery> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentType: opts.contentType,
      ResponseContentDisposition: opts.disposition,
    });
    return { redirect: await getSignedUrl(this.client, command, { expiresIn: SIGNED_URL_TTL_S }) };
  }
}

@Injectable()
export class StorageService implements StorageDriver {
  private readonly driver: StorageDriver = config.STORAGE_DRIVER === "s3" ? new S3Driver() : new DiskDriver();

  put(key: string, body: Readable, contentType: string) {
    return this.driver.put(key, body, contentType);
  }
  putBuffer(key: string, body: Buffer, contentType: string) {
    return this.driver.putBuffer(key, body, contentType);
  }
  remove(keys: string[]) {
    return this.driver.remove(keys);
  }
  deliver(key: string, opts: DeliverOptions) {
    return this.driver.deliver(key, opts);
  }
}
