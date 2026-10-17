import { Controller, Delete, Get, HttpCode, NotFoundException, Param, Put, Query, Req, Res, UseGuards, type PipeTransform } from "@nestjs/common";
import type { Request, Response } from "express";
import { DESKTOP_PLATFORMS, UploadInstallerQuery, type DesktopInfoDto, type DesktopPlatform, type InstallerDto } from "@teamchat/shared";
import { CurrentUser, SessionGuard } from "../auth/session.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { sendDelivery } from "../files/files.controller.js";
import type { users } from "../generated/prisma/client.js";
import { InstallersService } from "./installers.service.js";

const Platform: PipeTransform<string, DesktopPlatform> = {
  transform(v) {
    if (!(DESKTOP_PLATFORMS as readonly string[]).includes(v)) throw new NotFoundException("Нет такой платформы");
    return v as DesktopPlatform;
  },
};

// Скачать могут только вошедшие: приложение внутреннее, а /download открывается после входа.
@Controller()
@UseGuards(SessionGuard)
export class InstallersController {
  constructor(private readonly installers: InstallersService) {}

  @Get("desktop")
  info(): Promise<DesktopInfoDto> {
    return this.installers.info();
  }

  @Get("desktop/:platform/download")
  async download(@Param("platform", Platform) platform: DesktopPlatform, @Res() res: Response) {
    sendDelivery(res, await this.installers.download(platform));
  }

  // Сырые байты установщика (application/octet-stream), не JSON: см. jsonOnlyMutations в main.ts.
  @Put("admin/desktop/:platform")
  upload(
    @CurrentUser() me: users,
    @Param("platform", Platform) platform: DesktopPlatform,
    @Query(new ZodPipe(UploadInstallerQuery)) q: UploadInstallerQuery,
    @Req() req: Request,
  ): Promise<InstallerDto> {
    const length = req.headers["content-length"];
    return this.installers.upload(me, platform, q, req, length === undefined ? undefined : Number(length));
  }

  @Delete("admin/desktop/:platform")
  @HttpCode(204)
  remove(@CurrentUser() me: users, @Param("platform", Platform) platform: DesktopPlatform): Promise<void> {
    return this.installers.remove(me, platform);
  }
}
