import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../generated/prisma/client.js";
import { config } from "../config.js";

export type Tx = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    // Адаптер передаёт даты без смещения, и Postgres читает их в часовом поясе сессии.
    // Сессия всегда в UTC — иначе на сервере с TimeZone=Europe/Kyiv всё записанное съезжает на 3 часа.
    super({ adapter: new PrismaPg({ connectionString: config.DATABASE_URL, options: "-c TimeZone=UTC" }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
