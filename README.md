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

Файлы локально лежат в `apps/api/.storage` (драйвер `disk`, по умолчанию). Чтобы проверить работу с бакетом,
задайте `STORAGE_DRIVER=s3` и переменные `BUCKET_*`, как на Railway.

Проверки:

```bash
npm run typecheck
npm test
```

`npm test` гоняет юнит-тесты разметки сообщений (`packages/shared`) и e2e. e2e сами создают базу `teamchat_test`
рядом с `DATABASE_URL` (пересоздают при каждом запуске), поднимают свой экземпляр API на порту 3201 и поддельный
Google на 3299 — dev-сервер для них не нужен. Только e2e — `npm run test:e2e`.

Набор эмодзи (`apps/web/src/emoji/emoji-data.json`) собран из emojibase-data и лежит в репозитории; после
обновления пакета пересоберите его: `npm run emoji`.

### Вход через Google

1. Google Cloud Console → APIs & Services → Credentials → OAuth client ID, тип «Web application».
2. Authorized redirect URI: `{APP_URL}/api/auth/google/callback` (локально `http://localhost:5173/api/auth/google/callback`).
3. `GOOGLE_CLIENT_ID` и `GOOGLE_CLIENT_SECRET` в `apps/api/.env` (или в переменных Railway). Без них кнопка не показывается.

Войти через Google может тот, у кого уже есть аккаунт с этой почтой, кто пришёл по приглашению или чей домен
в `ALLOWED_EMAIL_DOMAINS`.

Схема БД меняется SQL-миграцией в `apps/api/prisma/migrations/<дата>_<имя>/migration.sql`, затем
`npx prisma migrate deploy && npx prisma db pull && npx prisma generate` в `apps/api`.

## Railway

Один сервис из `Dockerfile` + Postgres + Bucket. Миграции применяются при старте, healthcheck — `/healthz`.

1. New Project → Deploy from GitHub repo (или `railway up` из корня).
2. Add → Database → PostgreSQL.
3. Add → Bucket (для файлов: диск контейнера стирается при каждом деплое, поэтому в production без бакета
   сервис не стартует).
4. Переменные сервиса:

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
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | необязательно: вход через Google |
| `STORAGE_DRIVER` | `s3` |
| `BUCKET_ENDPOINT`, `BUCKET_NAME`, `BUCKET_ACCESS_KEY_ID`, `BUCKET_SECRET_ACCESS_KEY` | из учётных данных бакета (вкладка Credentials); удобнее сослаться на переменные бакета через `${{…}}` |
| `BUCKET_REGION` | регион из учётных данных, по умолчанию `auto` |
| `BUCKET_FORCE_PATH_STYLE` | `true`, если хранилище не поддерживает адреса вида `bucket.host` |
| `DESKTOP_VERSION`, `DESKTOP_MAC_URL`, `DESKTOP_WIN_URL` | необязательно: последняя версия приложения и ссылки на установщики — для страницы `/download` и баннера «вышла новая версия» |

`PORT` Railway задаёт сам. Файлы загружаются через API потоком (CORS у бакета настраивать не нужно), а
скачиваются по подписанной ссылке на 5 минут после проверки доступа.

## Десктоп-приложение

`apps/desktop` — оболочка на Electron: окно грузит чат с сервера (интерфейс обновляется без переустановки),
плюс значок с непрочитанным, системные уведомления, трей, ссылки `teamchat://…` и вход через Google в системном
браузере. Это отдельный npm-проект со своим `package-lock.json`, в образ сервера он не попадает.

Запуск в разработке (чат на `npm run dev`, оболочка смотрит на `http://localhost:5173`):

```bash
npm --prefix apps/desktop install
npm run desktop
```

Установщики без подписи. Адрес чата вшивается в сборку переменной `TEAMCHAT_URL` (только https):

```bash
cd apps/desktop
TEAMCHAT_URL=https://chat.example.com npm run dist:mac
```

Получится `apps/desktop/release/PromobileChat-<версия>-mac.dmg` (универсальный: Apple Silicon и Intel).
Установщик для Windows (`dist:win`) собирается на Windows или в GitHub Actions: workflow `desktop` собирает оба,
адрес берёт из переменной репозитория `TEAMCHAT_URL`. На Mac с Apple Silicon `dist:win` падает с ошибкой
`-86`: NSIS-сборщику нужен Rosetta.

Чтобы люди узнали о новой версии, выложите установщики (Release на GitHub или бакет) и задайте на Railway
`DESKTOP_VERSION`, `DESKTOP_MAC_URL`, `DESKTOP_WIN_URL`: появятся ссылки на `/download`, а в старых версиях —
баннер. Версия берётся из `apps/desktop/package.json`.

Вход через Google в приложении использует тот же OAuth-клиент: браузер после входа открывает страницу
`/desktop-auth`, та передаёт одноразовый код в приложение. Код без секрета, который знает только
запустившее вход приложение, бесполезен.

