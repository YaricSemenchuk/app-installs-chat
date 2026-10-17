import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { CreateFileInput, ListFilesQuery, THUMB_SIZES, type FileDto, type FilesPageDto, type UploadTicketDto } from "@teamchat/shared";
import { CurrentUser, SessionGuard } from "../auth/session.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import type { users } from "../generated/prisma/client.js";
import { FilesService } from "./files.service.js";
import type { Delivery } from "./storage.js";

const Id = new ParseUUIDPipe();

@Controller("files")
@UseGuards(SessionGuard)
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  create(@CurrentUser() me: users, @Body(new ZodPipe(CreateFileInput)) body: CreateFileInput): Promise<UploadTicketDto> {
    return this.files.create(me, body);
  }

  // Сырые байты файла (application/octet-stream), не JSON: см. jsonOnlyMutations в main.ts.
  @Put(":id/content")
  upload(@CurrentUser() me: users, @Param("id", Id) id: string, @Req() req: Request): Promise<FileDto> {
    const length = req.headers["content-length"];
    return this.files.upload(me, id, req, length === undefined ? undefined : Number(length));
  }

  @Get()
  list(@CurrentUser() me: users, @Query(new ZodPipe(ListFilesQuery)) q: ListFilesQuery): Promise<FilesPageDto> {
    return this.files.list(me, q);
  }

  @Get(":id/download")
  async download(@CurrentUser() me: users, @Param("id", Id) id: string, @Query("inline") inline: string | undefined, @Res() res: Response) {
    sendDelivery(res, await this.files.download(me, id, inline === "1"));
  }

  @Get(":id/thumb/:size")
  async thumb(@CurrentUser() me: users, @Param("id", Id) id: string, @Param("size") size: string, @Res() res: Response) {
    const n = Number(size);
    if (!(THUMB_SIZES as readonly number[]).includes(n)) throw new BadRequestException("Нет такой миниатюры");
    sendDelivery(res, await this.files.thumb(me, id, n));
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@CurrentUser() me: users, @Param("id", Id) id: string): Promise<void> {
    return this.files.remove(me, id);
  }
}

// Бакет — редирект на подписанную ссылку (живёт 5 минут, кэшируем чуть меньше); диск — поток отсюда.
export function sendDelivery(res: Response, d: Delivery & { contentType: string; disposition: string }) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  if ("redirect" in d) {
    res.setHeader("Cache-Control", "private, max-age=240");
    res.redirect(302, d.redirect);
    return;
  }
  res.setHeader("Content-Type", d.contentType);
  res.setHeader("Content-Disposition", d.disposition);
  res.setHeader("Content-Length", String(d.size));
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  d.stream.on("error", () => res.destroy());
  d.stream.pipe(res);
}
