import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "./db/prisma.service.js";

@Controller("healthz")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<{ ok: true }> {
    try {
      await this.prisma.$queryRaw`select 1`;
    } catch {
      throw new ServiceUnavailableException("database is unreachable");
    }
    return { ok: true };
  }
}
