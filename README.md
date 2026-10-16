# Чат команды

Внутренний чат в духе Slack для команды до 30 человек: каналы, сообщения в реальном времени,
веб и (позже) десктоп на Electron. Как он устроен — `replica/architecture.md`, что уже есть — `replica/features.csv`
и `replica/build-log.md`.

```
apps/api         NestJS 12 + Prisma 7 + socket.io (ESM, TypeScript 6)
apps/web         React 19 + Vite, SPA; /design — дизайн-система
packages/shared  zod-схемы, DTO и события, общие для API и клиента
replica/         recon, архитектура, дизайн-система, журнал сборки
```

## Локально

Нужны Node.js 22.19+ и Postgres 15+.

```bash
createdb teamchat_dev
cp apps/api/.env.example apps/api/.env   # поправьте DATABASE_URL и AUTH_SECRET
npm install
npm run migrate -w @teamchat/api
npm run dev
```

Откройте http://localhost:5173. Первый владелец — `BOOTSTRAP_OWNER_EMAIL`, войти без приглашения
можно с адресов из `ALLOWED_EMAIL_DOMAINS`. Без `RESEND_API_KEY` письма не уходят наружу, а пишутся
в `apps/api/.dev-mail.log` — код входа берите оттуда.

Проверки:

```bash
npm run typecheck
npm run test:e2e        # нужен запущенный API (npm run dev)
```

Схема БД меняется SQL-миграцией в `apps/api/prisma/migrations/<дата>_<имя>/migration.sql`, затем
`npx prisma migrate deploy && npx prisma db pull && npx prisma generate` в `apps/api`.

## Railway

Один сервис из `Dockerfile` + Postgres. Миграции применяются при старте, healthcheck — `/healthz`.

1. New Project → Deploy from GitHub repo (или `railway up` из корня).
2. Add → Database → PostgreSQL.
3. Переменные сервиса:

| переменная | значение |
| --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `NODE_ENV` | `production` |
| `APP_URL` | публичный адрес сервиса, например `https://chat.example.com` |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `BOOTSTRAP_OWNER_EMAIL` | почта первого владельца |
| `WORKSPACE_NAME` | название рабочего пространства |
| `ALLOWED_EMAIL_DOMAINS` | домены, с которых можно войти без приглашения, через запятую |
| `RESEND_API_KEY` | ключ Resend (обязателен в production) |
| `EMAIL_FROM` | отправитель, домен подтверждён в Resend |

`PORT` Railway задаёт сам.
