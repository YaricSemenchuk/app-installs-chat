import "reflect-metadata";
import { existsSync } from "node:fs";
import type { Server } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { IoAdapter } from "@nestjs/platform-socket.io";
import cookieParser from "cookie-parser";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module.js";
import { config, isProd } from "./config.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
// Байты файла приходят как есть. Это PUT: кросс-сайтом без CORS-preflight браузер его не отправит.
const RAW_UPLOAD = /^\/api\/(files\/[0-9a-f-]{36}\/content|admin\/desktop\/(mac|win|linux))$/;

// Изменяющие запросы принимаем только как JSON: обычная HTML-форма с чужого сайта так не отправит.
// POST — всегда JSON (форма умеет только GET/POST); DELETE/PUT/PATCH без тела браузер кросс-сайтом
// без CORS-preflight не отправит, им достаточно JSON, когда тело есть.
function jsonOnlyMutations(req: Request, res: Response, next: NextFunction): void {
  const hasBody = Number(req.headers["content-length"] ?? 0) > 0 || req.headers["transfer-encoding"] !== undefined;
  const needsJson = req.method === "POST" || hasBody;
  const rawUpload = (req.method === "PUT" && RAW_UPLOAD.test(req.path)) || (req.method === "POST" && req.path === "/api/livekit/webhook");
  if (req.path.startsWith("/api/") && !SAFE_METHODS.has(req.method) && needsJson && !rawUpload && !req.is("application/json")) {
    res.status(415).json({ statusCode: 415, message: "Нужен Content-Type: application/json" });
    return;
  }
  next();
}

async function main(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.set("trust proxy", 1); // Railway стоит перед приложением прокси
  app.useBodyParser("json", { limit: "256kb" });
  app.use(cookieParser());
  app.use(jsonOnlyMutations);
  app.setGlobalPrefix("api", { exclude: ["healthz"] });
  app.useWebSocketAdapter(new IoAdapter(app));
  app.enableShutdownHooks();

  // В production этот же сервис отдаёт собранный SPA: один origin для API, WebSocket и страниц.
  const webDist = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  if (isProd && existsSync(webDist)) {
    app.useStaticAssets(webDist, { index: false, maxAge: "1h" });
    const indexHtml = join(webDist, "index.html");
    // Только настоящие переходы по страницам: браузер просит text/html, у пути нет расширения.
    // Иначе healthcheck (Accept: */*) получил бы index.html и считал бы сервис живым даже без БД.
    app.use((req: Request, res: Response, next: NextFunction) => {
      const isPage =
        req.method === "GET" &&
        (req.headers.accept ?? "").includes("text/html") &&
        !extname(req.path) &&
        !/^\/(api|ws|healthz)(\/|$)/.test(req.path);
      if (isPage) res.sendFile(indexHtml);
      else next();
    });
  }

  // Установщик в 230 МБ с медленного канала грузится дольше пяти минут — стандартного лимита Node на запрос.
  (app.getHttpServer() as Server).requestTimeout = 20 * 60_000;
  await app.listen(config.PORT, "0.0.0.0");
}

void main();
