# Architecture: внутренний чат команды (перестройка ядра Slack)

Основа: `replica/recon.md` (43 экрана, 25 флоу) и `replica/features.csv` (44 must, 40 should, 28 could).
Решения с владельцем продукта от 2026-10-17:
- стек NestJS + React/Vite + Prisma;
- вход через Google или код на email, только по приглашению;
- файлы до 100 МБ;
- десктоп-сборки пока без подписи;
- хостинг Railway.

Хранение истории — бессрочно, с ежедневными бэкапами (решение по умолчанию; поменять можно).

Имя продукта, домен и URL-схему для диплинков выберет `/replica-brand`. До этого здесь заглушки:
`chat.example.com` и `teamchat://`.

## Stack

| layer | choice | why |
| --- | --- | --- |
| web | React + TypeScript + Vite, SPA | команда уже пишет на React/Vite; SSR за логином не нужен; та же сборка открывается в Electron |
| UI state | TanStack Query (серверные данные) + Zustand (сессия, присутствие, набор текста) | события из WebSocket патчат кэш запросов, отдельный стор не дублирует данные |
| message list | react-virtuoso | виртуализация с обратной прокруткой и подгрузкой вверх, как нужно в чате |
| composer | TipTap (ProseMirror) + свои расширения mention / emoji / slash | форматирование, автодополнение `@ # : /`, сериализация в разметку клона |
| styling | CSS Modules (SCSS) + CSS-переменные из `/replica-design` | привычно команде; antd/MUI для чата не подходят: интерфейс целиком свой |
| API | NestJS 11 (Express), REST + WebSocket gateway | знакомо команде; модули, guards, pipes закрывают авторизацию и валидацию |
| validation | zod-схемы в `packages/shared` + ZodValidationPipe | одни и те же схемы на фронте и бэке, включая полезную нагрузку событий |
| realtime | socket.io через `@nestjs/platform-socket.io` | heartbeat, автопереподключение с backoff и комнаты из коробки; догрузку делаем сами по журналу `events` |
| database | Postgres 16 (Railway) | одна база на всё: данные, поиск, очередь задач |
| ORM | Prisma | знакомо команде; генерируемые колонки, частичные индексы и `nulls not distinct` живут в SQL-миграциях (`--create-only`), в Prisma-схеме это `Unsupported(...)` |
| search | Postgres FTS: `russian` + `english` tsvector, GIN; `pg_trgm` для имён | на 30 человек хватает с запасом; отдельный поисковый движок не нужен |
| auth | своя реализация: сессии в Postgres, httpOnly cookie; Google OAuth через `arctic`; email-код | два способа входа, инвайты и передача входа в Electron проще сделать самим, чем подгонять библиотеку |
| email | Resend по HTTPS API | коды входа и инвайты; свой домен с SPF/DKIM |
| jobs | pg-boss (очередь в той же Postgres) | без Redis и второго сервиса; отложенные задачи через `startAfter` |
| files | Railway Buckets (S3 API) через `@aws-sdk/client-s3` + presigned URL; `sharp` для миниатюр | бакет приватный, раздача только через подписанные ссылки после проверки доступа |
| desktop | Electron + electron-builder, грузит веб-клиент с сервера | интерфейс обновляется вместе с сайтом; сама оболочка меняется редко |
| hosting | Railway: 1 сервис + Postgres + Bucket | см. ниже |
| payments | — | внутренний инструмент, платежей нет |

Конкретные версии пакетов фиксируются при скаффолде (`/replica-build`), не здесь.

### Railway

```
chat.example.com ──► service "app"  (Dockerfile, 1 инстанс)
                      ├─ NestJS: /api/*, /ws (socket.io), раздача собранного SPA
                      ├─ pg-boss воркеры (в том же процессе)
                      ├─► Postgres (Railway)          DATABASE_URL
                      ├─► Bucket "files" (S3 API)     BUCKET_ENDPOINT / KEY / SECRET / NAME / REGION
                      └─► Resend (HTTPS)              RESEND_API_KEY, EMAIL_FROM
```

Почему так:
- **Один origin** для API, WebSocket и SPA: cookie без CORS и без SameSite=None.
- **Один инстанс:** комнаты socket.io и присутствие живут в памяти. Если понадобится второй
  инстанс, добавляем `@socket.io/postgres-adapter`, схему менять не нужно.
- **Бэкапы:** ежедневная задача делает `pg_dump` в бакет и хранит копии 30 дней (в образе нужен
  `postgresql-client` той же мажорной версии). Плюс бэкапы Railway, если они есть на выбранном плане.

Остальные переменные окружения: `APP_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`BOOTSTRAP_OWNER_EMAIL` (первый владелец), `DESKTOP_SCHEME`.

### Репозиторий

```
apps/api       NestJS: модули auth, users, conversations, messages, files, search, activity,
               notifications, realtime (gateway), jobs, admin
apps/web       React SPA
apps/desktop   Electron: main + preload, без UI-кода
packages/shared  zod-схемы API и событий, парсер и рендер разметки сообщений (общие для фронта и бэка)
```

Монорепо на npm workspaces: pnpm на машине не установлен, а лишний инструмент ничего не даёт.

## Schema

Tables: 26 (`replica/schema.sql`, первая миграция; проверена на Postgres 16 тестами
ограничений). Access rules: проверки в слое данных API, без RLS.

| группа | таблицы |
| --- | --- |
| workspace | `workspace_settings` (одна строка: политики, разрешённые домены) |
| люди и вход | `users`, `user_preferences`, `sessions`, `login_codes`, `auth_handoffs`, `invites` |
| разговоры | `conversations` (каналы, ЛС, групповые ЛС), `conversation_members` (+ курсор прочитанного и настройки уведомлений), `sidebar_sections` |
| сообщения | `messages`, `message_mentions`, `reactions`, `files`, `message_files`, `message_unfurls`, `pins`, `bookmarks` |
| личное | `thread_subscriptions`, `activity_items`, `saved_items`, `reminders`, `scheduled_messages`, `drafts`, `custom_emoji` |
| realtime | `events` (журнал на 7 дней) |

Отложено до could-этапа: `usergroups`, гостевые ограничения по каналам, web-push подписки.

Ключевые решения в схеме:
- **Single-tenant.** Одна установка = одно рабочее пространство, поэтому `workspace_id` нигде
  нет. Владелец строки — `user_id` / `created_by` / `uploader_id`.
- **`messages.seq`** — глобальный `bigint identity`. Это порядок в ленте, курсор пагинации и курсор
  прочитанного (`conversation_members.last_read_seq`, `thread_subscriptions.last_read_seq`).
  Непрочитанное = сообщения с `seq` больше курсора.
- **Треды одного уровня.** У ответа есть `parent_id`. На родителе денормализованы `reply_count`,
  `reply_user_ids` (до 5), `last_reply_at`; они обновляются в той же транзакции, что и ответ.
- **ЛС уникальны по набору участников** (`dm_key` = отсортированные id), поэтому повторное открытие
  возвращает существующий разговор. Гонку двух одновременных открытий решает unique-индекс.
- **Имя канала** уникально среди всех каналов, включая архивные. Формат `^[a-z0-9_-]{1,80}$`.
  `#general` единственный, его нельзя архивировать.
- **Упоминания** хранятся в тексте токенами с id (`<@uuid>`, `<!here>`) и разворачиваются в
  `message_mentions` по получателям при отправке. Отсюда считаются бейджи упоминаний.
- **Поиск.** `messages.search_tsv` — генерируемая колонка: токены `<...>` вырезаются, поэтому
  uuid не попадают в индекс; объединены конфигурации `russian` и `english`.
- **Мягкое удаление.** Пользователей деактивируем (FK авторства `on delete restrict`), сообщения
  удаляем через `deleted_at` с очисткой текста, чтобы у треда осталась заглушка.
- **`events`** — журнал без FK. Каждое изменение пишет событие в той же транзакции под
  `pg_advisory_xact_lock`, поэтому порядок `events.id` совпадает с порядком коммитов и клиент не
  пропустит событие при догрузке. На 30 человек сериализация записи ничего не стоит.

### Правила доступа (одна проверка на запрос)

Вся работа с разговорами идёт через `ConversationAccess` в `apps/api`:

| проверка | правило |
| --- | --- |
| `canRead(user, conv)` | участник, или `kind = 'public'` (просмотр канала до вступления и поиск) |
| `canPost(user, conv)` | участник; канал не в архиве; `posting_policy = 'admins'` → роль admin+ |
| `canManage(user, conv)` | `is_manager` в канале или роль admin+; для `#general` только admin+ |
| `canEditMessage(user, msg)` | автор и окно правки из `workspace_settings` не истекло |
| `canDeleteMessage(user, msg)` | автор, или admin+ |
| `canReadFile(user, file)` | файл расшарен хотя бы в один разговор, где `canRead` |
| роль admin+ | `owner`, `primary_owner`, `admin`; деактивированный пользователь не проходит ни одну проверку |

Правила для всех запросов:
- **Аутентификация.** Guard проверяет сессию на каждом запросе и при подключении WebSocket.
- **Деактивация.** Отзываются все сессии, сокеты пользователя рвутся сразу.
- **Комнаты WebSocket.** Сокет подписывается на комнаты только своих разговоров. При вступлении,
  выходе или удалении из канала сервер сам добавляет или убирает комнату.
- **Списки разговоров** (`boot`, поиск, Activity) фильтруются JOIN-ом по `conversation_members`
  в том же SQL, а не постфильтром в коде.

## API

Все маршруты под `/api`. Тело и ответ — JSON по zod-схемам из `packages/shared`.
«member» = любой активный пользователь, «admin» = admin / owner / primary_owner,
«conv» = проходит `canRead`/`canPost` для разговора, «author» = автор сообщения.

### Вход и люди

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| POST /auth/email/start | отправить 6-значный код на email | anyone | email, inviteToken? | 204 (всегда, без утечки, есть ли email) | F02, F01 |
| POST /auth/email/verify | проверить код, создать сессию | anyone | email, code | user, needsOnboarding | F02, F01 |
| GET /auth/google/start | редирект в Google | anyone | inviteToken?, client=web/desktop | 302 | F02, F01 |
| GET /auth/google/callback | обмен кода, сессия; для desktop — handoff-код | anyone | code, state | 302 в SPA или `teamchat://auth?code=` | F02 |
| POST /auth/desktop/exchange | обменять handoff-код на сессию внутри Electron | anyone | code | user | F02, F25 |
| POST /auth/logout | закрыть текущую сессию | member | — | 204 | — |
| GET /auth/sessions | мои сессии | member | — | sessions[] | — |
| DELETE /auth/sessions/:id | выйти на устройстве | member | — | 204 | — |
| DELETE /auth/sessions | выйти везде, кроме текущего | member | — | 204 | — |
| GET /invites/preview/:token | превью инвайта: workspace, кто пригласил | anyone | — | invite preview | F01 |
| GET /auth/providers | какие способы входа включены (Google) | anyone | — | { google } | F02 |
| POST /me/onboarding | заполнить профиль при первом входе, вступить в каналы по умолчанию и из инвайта | member | displayName, realName, avatarFileId? | user | F01 |
| GET /boot | старт приложения: я, настройки, все пользователи, мои разговоры со счётчиками непрочитанного и упоминаний, разделы, emoji, последний `events.id` | member | — | boot payload | все |
| PATCH /me/profile | имя, должность, часовой пояс, аватар | member | fields | user | — |
| PUT /me/status | статус: эмодзи, текст, срок, пауза на время статуса | member | emoji, text, expiresAt?, pauseNotifications | user | F20 |
| DELETE /me/status | очистить статус | member | — | 204 | F20 |
| PUT /me/dnd | пауза уведомлений до времени | member | until | user | F20 |
| DELETE /me/dnd | снять паузу | member | — | 204 | F20 |
| PATCH /me/preferences | глобальные настройки уведомлений, тема, Enter | member | fields | preferences | F19 |
| GET /users/:id | профиль человека | member | — | user | — |

### Разговоры

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| GET /conversations/browse | каталог публичных каналов (и архивных) | member | query?, archived? | conversations[] | F09 |
| POST /conversations | создать канал (политика `who_can_create_channels`) | member | kind, name, purpose? | conversation | F08 |
| POST /conversations/dm | открыть ЛС / групповое ЛС (идемпотентно) | member | userIds (1–8) | conversation | F07 |
| GET /conversations/:id | детали | conv | — | conversation | — |
| PATCH /conversations/:id | имя, тема, описание, политика постинга, @here/@channel | conv manager | fields | conversation | F08 |
| POST /conversations/:id/join | вступить в публичный | member | — | membership | F09 |
| POST /conversations/:id/leave | выйти (не #general) | conv | — | 204 | — |
| GET /conversations/:id/members | участники | conv | cursor? | users[] | — |
| POST /conversations/:id/members | добавить людей | conv | userIds | 204 | F08 |
| DELETE /conversations/:id/members/:userId | удалить из канала | conv manager | — | 204 | — |
| POST /conversations/:id/archive | архивировать | conv manager / политика | — | conversation | F23 |
| POST /conversations/:id/unarchive | разархивировать | admin | — | conversation | F23 |
| PATCH /conversations/:id/membership | мои настройки: уведомления, раздел, звёздочка, видимость ЛС | conv | notifyLevel?, sectionId?, starred?, isOpen?, followAllThreads? | membership | F19 |
| POST /conversations/:id/read | сдвинуть курсор прочитанного (монотонно, дебаунс 5 с на клиенте) | conv | seq | 204 | F04, F15 |
| POST /conversations/:id/unread | отметить непрочитанным с сообщения | conv | messageId | 204 | F17 |
| GET /conversations/:id/pins | закреплённое | conv | — | messages[] | F21 |
| GET /conversations/:id/bookmarks | закладки | conv | — | bookmarks[] | F21 |
| POST /conversations/:id/bookmarks | добавить закладку (≤100) | conv | title, url, emoji? | bookmark | F21 |
| PATCH /bookmarks/:id | изменить или переставить | conv | title?, url?, rank? | bookmark | F21 |
| DELETE /bookmarks/:id | удалить | conv | — | 204 | F21 |
| GET /sidebar-sections | мои разделы | member | — | sections[] | — |
| POST /sidebar-sections | создать раздел | member | name, emoji? | section | — |
| PATCH /sidebar-sections/:id | переименовать, сортировка, позиция, свёрнут | member | fields | section | — |
| DELETE /sidebar-sections/:id | удалить раздел | member | — | 204 | — |

### Сообщения, треды, реакции

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| GET /conversations/:id/messages | лента: до/после `seq` или вокруг сообщения | conv | before?, after?, around?, limit ≤100 | messages[] (+ реакции, файлы, unfurls, сводки тредов) | F04, F13 |
| POST /conversations/:id/messages | отправить (идемпотентно по `clientMsgId`); упоминания, Activity, уведомления, unfurl-задача | conv post | clientMsgId, text, parentId?, alsoInChannel?, fileIds? | message | F04, F05, F06, F10 |
| PATCH /messages/:id | правка (окно правки) | author | text | message | F12 |
| DELETE /messages/:id | удалить (мягко) | author / admin | — | 204 | F12 |
| GET /messages/:id/replies | ответы треда | conv | after?, limit | messages[] | F06 |
| POST /messages/:id/reactions | поставить реакцию | conv | emoji | 204 | F11 |
| DELETE /messages/:id/reactions/:emoji | снять реакцию | conv | — | 204 | F11 |
| POST /messages/:id/pin | закрепить | conv | — | 204 | F21 |
| DELETE /messages/:id/pin | открепить | conv | — | 204 | F21 |
| POST /messages/:id/forward | переслать в другой разговор | conv (источник и цель) | conversationId, text? | message | F22 |
| GET /messages/:id/link | разрешить permalink: разговор, тред, seq | conv | — | location | F25 |
| POST /messages/:id/unfurls/:unfurlId/hide | убрать превью ссылки | author | — | 204 | — |
| GET /threads | вид «Треды»: мои треды, непрочитанные сверху | member | cursor? | threads[] | — |
| PUT /threads/:parentId/subscription | подписаться / отписаться | conv | subscribed | 204 | — |
| POST /threads/:parentId/read | курсор прочитанного треда | conv | seq | 204 | — |

### Файлы и поиск

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| POST /files | начать загрузку: строка `pending` + presigned PUT | member | name, size (≤100 МБ), mimetype | fileId, uploadUrl, headers | F10 |
| POST /files/:id/complete | проверить объект (HEAD: размер совпадает), `ready`, задача на миниатюры | uploader | — | file | F10 |
| GET /files | вид «Файлы» | member | type?, query?, cursor? | files[] (только доступные) | — |
| GET /files/:id/download | 302 на presigned GET (5 мин) после `canReadFile` | member | — | 302 | F10 |
| GET /files/:id/thumb/:size | 302 на миниатюру | member | — | 302 | F10 |
| DELETE /files/:id | удалить файл | uploader / admin | — | 204 | — |
| GET /search/messages | поиск с модификаторами `in: from: has: before: after: on: during: is:thread`, `"фраза"`, `-слово`, `слов*` | member | q, cursor? | hits[] с подсветкой | F13 |
| GET /search/files | поиск файлов по имени | member | q, cursor? | files[] | F13 |

Быстрый переключатель ⌘K и поиск людей/каналов работают на клиенте: `/boot` уже отдаёт всех
пользователей и все доступные разговоры (их сотни, не миллионы).

### Непрочитанное, Activity, личное

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| GET /unreads | вид «Непрочитанное»: группы по разговорам | member | sort? | groups[] | F15 |
| POST /read-all | отметить всё прочитанным | member | — | 204 | F15 |
| GET /activity | лента Activity | member | filter?, unreadOnly?, cursor? | items[] | F16 |
| POST /activity/read | отметить элементы прочитанными | member | ids или all | 204 | F16 |
| POST /activity/clear | убрать из ленты | member | ids | 204 | F16 |
| GET /saved | сохранённое | member | cursor? | items[] | F17 |
| PUT /saved/:messageId | сохранить / отметить выполненным | member | completed? | 204 | F17 |
| DELETE /saved/:messageId | убрать | member | — | 204 | F17 |
| GET /reminders | мои напоминания | member | — | reminders[] | F17 |
| POST /reminders | создать (на сообщение или текст) | member | text, remindAt, messageId?, recurrence? | reminder | F17 |
| PATCH /reminders/:id | перенести / выполнить | member | remindAt?, completed? | reminder | F17 |
| DELETE /reminders/:id | удалить | member | — | 204 | F17 |
| GET /scheduled-messages | запланированные | member | — | items[] | F18 |
| POST /scheduled-messages | запланировать (≤120 дней) | conv post | conversationId, text, postAt, parentId?, fileIds? | item | F18 |
| PATCH /scheduled-messages/:id | изменить текст / время | owner of item | text?, postAt? | item | F18 |
| POST /scheduled-messages/:id/send-now | отправить сейчас | owner of item | — | message | F18 |
| DELETE /scheduled-messages/:id | отменить (вернуть в черновики) | owner of item | — | 204 | F18 |
| GET /drafts | мои черновики | member | — | drafts[] | — |
| PUT /drafts | сохранить черновик (выигрывает более поздний `updatedAt`) | conv | conversationId, parentId?, text, updatedAt | draft | — |
| DELETE /drafts/:id | удалить черновик | member | — | 204 | — |

### Emoji и админка

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| POST /emoji | добавить своё emoji (картинка или алиас) | политика `who_can_add_emoji` | name, fileId? или aliasOf? | emoji | — |
| DELETE /emoji/:id | удалить (своё; admin — любое) | member / admin | — | 204 | — |
| POST /invites | пригласить по email (письмо через Resend) | политика `who_can_invite` | emails[], role, channelIds[] | invites[] | F03 |
| POST /invites/link | создать ссылку-приглашение | admin | expiresAt, maxUses ≤400, channelIds[] | url | F03 |
| GET /invites | активные инвайты | admin | — | invites[] | F03 |
| DELETE /invites/:id | отозвать | admin | — | 204 | F03 |
| GET /admin/users | люди с ролями и статусом | admin | query? | users[] | F24 |
| PATCH /admin/users/:id | сменить роль (owner+ меняет admin) | admin | role | user | — |
| POST /admin/users/:id/deactivate | деактивировать: отзыв сессий, разрыв сокетов, выход из каналов | admin (не на owner) | — | 204 | F24 |
| POST /admin/users/:id/reactivate | вернуть доступ | admin | — | 204 | F24 |
| GET /admin/settings | настройки и политики | admin | — | settings | — |
| PATCH /admin/settings | изменить настройки | admin | fields | settings | — |
| PATCH /admin/conversations/:id | канал по умолчанию, удалить, сделать приватным | admin | isDefault?, … | conversation | — |
| GET /healthz | проверка живости для Railway | anyone | — | 200 | — |

Итого: 100 REST-маршрутов (без дублей), плюс WebSocket.

### WebSocket (`/ws`, socket.io)

Клиент → сервер:

| сообщение | что делает |
| --- | --- |
| `hello { lastEventId }` | сервер шлёт пропущенные события из `events` с `id > lastEventId` для комнат пользователя. Если журнал короче (больше 7 дней), отвечает `resync`, и клиент заново зовёт `/boot` |
| `typing { conversationId, parentId? }` | эфемерно, ретранслируется в комнату с троттлингом 3 с |
| `active` | раз в минуту, пока окно в фокусе или есть ввод; без него через 10 мин → away |

Сервер → клиент:
- события журнала: `message.created/updated/deleted`, `thread.updated` (сводка на родителе),
  `reaction.added/removed`, `pin.added/removed`, `member.joined/left`,
  `conversation.created/updated/archived/deleted`, `read.updated` (мой курсор с другого устройства),
  `user.updated` (профиль, статус, деактивация), `emoji.updated`, `activity.created`;
- эфемерные: `typing`, `presence { userId, state }`;
- `notification { title, body, conversationId, messageId }` — сервер уже решил, что уведомлять
  надо; клиент показывает его, только если этот разговор сейчас не открыт и окно не в фокусе;
- `resync`, `session.revoked`.

Входящих вебхуков нет; исходящих в v1 тоже (боты и вебхуки — отдельный этап).

### Jobs (pg-boss)

| задача | когда | что делает |
| --- | --- | --- |
| `send-scheduled-message` | `startAfter = post_at` + страховочный проход раз в минуту | `update ... set status='sent' where status='scheduled' returning`: отправляет ровно один воркер |
| `fire-reminder` | `startAfter = remind_at` + проход раз в минуту | Activity + уведомление; для повторяющихся считает следующее время в часовом поясе пользователя |
| `expire-status-and-dnd` | раз в минуту | очищает истёкшие статусы и паузы, шлёт `user.updated` |
| `make-thumbnails` | после `files/:id/complete` | sharp → 360/720/1024 px, `width/height`, ключи в `files.thumbnails` |
| `unfurl-links` | после отправки сообщения со ссылкой | безопасный fetch (см. ниже), Open Graph → `message_unfurls` |
| `send-email` | по запросу | коды входа и инвайты через Resend, ретраи с backoff |
| `cleanup` | ежедневно 04:00 UTC | `events` старше 7 дней; истёкшие `login_codes`, `auth_handoffs`, `sessions`; `files` в `pending` старше суток (вместе с объектом в бакете) |
| `backup-db` | ежедневно 03:00 UTC | `pg_dump` → gzip → бакет `backups/`, хранить 30 дней |

## Electron

- **Окно.** `BrowserWindow` грузит `APP_URL` с `contextIsolation: true`, `sandbox: true`,
  `nodeIntegration: false`. Навигация разрешена только на свой origin. Внешние ссылки
  открываются через `shell.openExternal`, только `http(s)` и `mailto`.
- **Preload** отдаёт узкий API `window.desktop`: `setBadge(n)`, `notify({...})` (клик фокусирует
  окно и открывает разговор), `onDeepLink(cb)`, `platform`.
- **Протокол `teamchat://`.** Регистрируется через `setAsDefaultProtocolClient`, плюс
  single-instance lock. Ссылки: `channel?id=`, `message?id=`, `auth?code=`.
- **Трей и меню-бар:** закрытие окна прячет приложение, бейдж = непрочитанное.
- **Вход через Google** открывается в системном браузере, потому что Google блокирует OAuth во
  встроенных окнах. После колбэка сервер редиректит на `teamchat://auth?code=…` (код живёт 60 с,
  одноразовый), и Electron меняет его на сессию через `/auth/desktop/exchange`.
  Вход по email-коду работает прямо в окне.
- **Без подписи.** Установщики `.dmg` и `.exe` (nsis).
  - macOS при первом запуске потребует «Открыть» через контекстное меню.
  - Windows покажет SmartScreen («Подробнее → Выполнить в любом случае»).
  - Автообновления оболочки нет: при выходе новой версии веб-клиент показывает баннер со
    ссылкой на `/download`. Сам интерфейс обновляется без переустановки, потому что грузится с сервера.

## The parts that bite

- **Часовые пояса.** Всё хранится в UTC. Расписание уведомлений, «напомнить завтра в 9»,
  повторяющиеся напоминания и «Сегодня/Вчера» в ленте считаются в `users.tz` с учётом перехода на
  летнее время (Luxon на сервере и клиенте).
- **Идемпотентность.**
  - `clientMsgId` + unique-индекс: повтор после обрыва возвращает то же сообщение.
  - Реакции — первичный ключ.
  - Курсор прочитанного только растёт (`greatest`), кроме явного «отметить непрочитанным».
  - Отложенные сообщения и напоминания забираются через `update ... where status=... returning`.
- **Гонки.**
  - `reply_count` меняется атомарным `update ... set reply_count = reply_count + 1` в транзакции ответа.
  - Одновременное открытие одного ЛС решает unique `dm_key` с `on conflict`.
  - Имя канала — unique-индекс, ошибка 23505 превращается в `name_taken`.
  - Порядок событий — advisory lock.
- **Realtime на Railway.** Соединение может оборваться в любой момент. Клиент переподключается
  (socket.io), шлёт `hello { lastEventId }` и догружает пропущенное. Неотправленные сообщения ждут
  в очереди клиента и уходят после переподключения с тем же `clientMsgId`. Баннер S43 показывает состояние.
- **Лимиты частоты** (`@nestjs/throttler`, в памяти, один инстанс):
  - `/auth/email/start`: 5 запросов за 15 мин на email и 20 на IP;
  - ввод кода: 5 попыток на код;
  - отправка сообщений: 10 в секунду на пользователя;
  - unfurl: не чаще 1 раза на URL в 10 минут.
- **Файлы.**
  - 100 МБ проверяются трижды: в запросе на загрузку, в CHECK в базе и по фактическому
    размеру объекта при `complete`.
  - Inline отдаются только `png/jpg/gif/webp`; остальное, включая SVG и HTML, идёт с
    `Content-Disposition: attachment`, чтобы файл из чата не исполнил скрипт.
  - CORS бакета разрешает PUT только с `APP_URL`.
- **SSRF в превью ссылок.**
  - DNS резолвится заранее; приватные, loopback, link-local и metadata-адреса блокируются
    (`ipaddr.js`), каждый редирект проверяется заново, максимум 3 редиректа.
  - Таймаут 5 с, ответ не больше 1 МБ, читается только `text/html`.
  - Картинка превью не проксируется через сервер, отдаётся по исходному URL.
- **XSS в сообщениях.** Разметка рендерится в React-элементы через парсер из `packages/shared`,
  никакого `dangerouslySetInnerHTML`. В ссылках разрешены только `http(s)` и `mailto`.
- **CSRF.** Cookie `SameSite=Lax`, `httpOnly`, `Secure`; изменяющие запросы только с
  `Content-Type: application/json`. У WebSocket проверяется `Origin`.
- **Поиск.** Права проверяются в том же SQL (JOIN на участие или публичный канал), а не
  постфильтром. Иначе ломается пагинация и утекают сниппеты из приватных каналов.
- **Уведомления.**
  - Решение «уведомлять ли» принимается на сервере в одном месте: глобальный уровень,
    уровень разговора, mute, DND и статус с паузой, расписание, ключевые слова, подписка на тред.
  - Бейдж и счётчики в сайдбаре считаются из тех же данных, чтобы не расходились.
- **Email-доставляемость.** Свой домен в Resend с SPF/DKIM/DMARC; код живёт 10 минут.
  Отправка по HTTPS API, SMTP не используется.
- **Удаление данных (GDPR).** Деактивация сохраняет переписку: это данные компании. Полное
  удаление человека — отдельная админ-операция на could-этапе: анонимизация профиля с сохранением сообщений.
- **Мультитенантность** не нужна: одна установка на компанию.
- **Офлайн-режима нет**, кроме очереди отправки и локального черновика.

## Build order

1. **Vertical slice (M0)** — некрасиво, но целиком, задеплоено на Railway.
   - Флоу: вход по email-коду (первый владелец из `BOOTSTRAP_OWNER_EMAIL`), `#general`,
     отправка и мгновенное получение сообщений двумя людьми, подгрузка истории, переподключение с догрузкой.
   - Screens: S01, S03, S04 (минимум), S05, S43.
   - Tables: `workspace_settings`, `users`, `user_preferences`, `sessions`, `login_codes`,
     `conversations`, `conversation_members`, `messages`, `events`.
   - Routes: `/auth/email/start`, `/auth/email/verify`, `/auth/logout`, `/boot`,
     `GET/POST /conversations/:id/messages`, `/conversations/:id/read`, `/healthz`, `/ws`
     (`hello`, `message.created`).
   - Доказывает: Nest + Prisma + Vite на Railway, cookie-аутентификацию, WebSocket с догрузкой,
     письма через Resend.
2. **Must-haves**, по областям:
   - **M1 Люди.**
     - Инвайты по email и ссылке, онбординг S02, вход через Google, роли, деактивация (S36, S37),
       профиль S31, присутствие.
     - Tables: `invites`; routes: `/invites*`, `/auth/google/*`, `/me/*`, `/admin/users*`.
   - **M2 Разговоры.**
     - Создание каналов, каталог, вступление и выход, участники, ЛС и групповые ЛС, тема и
       описание, защита `#general`, сайдбар с разделами Каналы/ЛС.
     - Курсоры прочитанного, счётчики непрочитанного и упоминаний, разделитель «Новые», ⌘K.
     - Screens: S04–S06, S08–S14, S27.
   - **M3 Сообщения.**
     - Композер TipTap: форматирование, `@`, `#`, `:`, эмодзи-пикер.
     - Правка и удаление, permalink, треды со сводками, реакции, синхронизация всего через события.
     - Tables: `message_mentions`, `reactions`, `thread_subscriptions`; screens S07, S15, S16, S18, S19.
   - **M4 Файлы и поиск.** Загрузка в бакет, миниатюры, превью, доступ к файлам, поиск по
     сообщениям. Tables: `files`, `message_files`; screen S26.
   - **M5 Уведомления и десктоп.**
     - Серверное решение об уведомлении, браузерные уведомления, глобальный уровень (S34).
     - Electron: бейдж, диплинки, вход через Google с handoff, трей; неподписанные установщики,
       страница `/download`.
     - Tables: `activity_items`, `auth_handoffs`; screen S41.
3. **Should-haves**, двумя пачками:
   - **M6:** вид «Треды», Activity, сохранённое, напоминания, отложенная отправка, черновики,
     пересылка, пины и закладки, уведомления на разговор, пауза (DND), статусы, свои emoji.
   - **M7:** свои разделы сайдбара, превью ссылок, «печатает…», архив, каналы по умолчанию,
     политики, управление сессиями, тёмная тема, горячие клавиши, модификаторы поиска.

   Потом could-haves по `features.csv`.
4. **Fixes from replica-entrepreneur** — после его прогона по отзывам о Slack.

На каждом этапе REA проверяет наши собственные сборки:
- `capture_browser_scenario` / `capture_electron_scenario` — прогон флоу этапа;
- `inspect_electron_fuses` и `analyze_javascript_application` — проверка `.asar` на M5;
- `compare_web_screenshots` — сравнение с референсами в `replica/screens/`.
