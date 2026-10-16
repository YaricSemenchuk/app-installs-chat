import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../generated/prisma/client.js";
import { config } from "../config.js";

export type Tx = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaPg({ connectionString: config.DATABASE_URL }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
