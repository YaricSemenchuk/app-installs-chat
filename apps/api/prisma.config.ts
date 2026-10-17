import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Не env(): тот падает без переменной, а prisma generate при сборке Docker-образа базы не касается
    // и DATABASE_URL там нет. migrate deploy при старте получает адрес из окружения Railway.
    url: process.env.DATABASE_URL ?? "",
  },
});
