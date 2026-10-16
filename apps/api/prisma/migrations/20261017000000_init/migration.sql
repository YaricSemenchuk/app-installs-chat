-- Схема клона Slack: одна установка = одно рабочее пространство (single-tenant).
-- Первая миграция. Требует Postgres 15+ (UNIQUE NULLS NOT DISTINCT).
-- Доступ проверяется в слое данных API (см. architecture.md → «Правила доступа»), RLS не используется.
--
-- Соглашения:
--   * id uuid default gen_random_uuid(); исключения — events.id и messages.seq (bigint identity,
--     это курсоры) и чистые таблицы-связки с составным ключом.
--   * Время — timestamptz в UTC.
--   * Авторство (кто написал, загрузил, создал) — on delete restrict: пользователей не удаляем,
--     а деактивируем. Личное состояние (сессии, черновики, закладки) — on delete cascade.
--   * updated_at обновляет триггер set_updated_at(), а не только Prisma.

create extension if not exists citext;
create extension if not exists pg_trgm;

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ───────────────────────────── workspace ─────────────────────────────

-- Единственная строка с настройками и политиками рабочего пространства.
create table workspace_settings (
  id smallint primary key default 1 check (id = 1),
  name text not null check (length(name) between 1 and 80),
  icon_key text,
  allowed_email_domains text[] not null default '{}',          -- вход через Google без инвайта для этих доменов
  who_can_create_channels text not null default 'everyone'
    check (who_can_create_channels in ('everyone', 'admins')),
  who_can_archive_channels text not null default 'everyone'
    check (who_can_archive_channels in ('everyone', 'admins')),
  who_can_invite text not null default 'everyone'
    check (who_can_invite in ('everyone', 'admins')),
  who_can_add_emoji text not null default 'everyone'
    check (who_can_add_emoji in ('everyone', 'admins')),
  message_edit_window_minutes int check (message_edit_window_minutes >= 0), -- null = всегда, 0 = никогда
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger workspace_settings_updated_at before update on workspace_settings
  for each row execute function set_updated_at();

-- ───────────────────────────── people & auth ─────────────────────────────

create table users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  google_sub text unique,                                       -- subject из Google ID token
  role text not null default 'member'
    check (role in ('primary_owner', 'owner', 'admin', 'member', 'guest')),
  display_name text not null check (length(display_name) between 1 and 80),
  real_name text not null default '' check (length(real_name) <= 80),
  title text not null default '' check (length(title) <= 100),
  pronouns text not null default '' check (length(pronouns) <= 30),
  phone text not null default '' check (length(phone) <= 30),
  avatar_key text,
  tz text not null default 'UTC',                               -- IANA, например Europe/Kyiv
  locale text not null default 'ru',
  status_text text not null default '' check (length(status_text) <= 100),
  status_emoji text not null default '',
  status_expires_at timestamptz,
  status_pauses_notifications boolean not null default false,
  dnd_until timestamptz,                                        -- ручная пауза уведомлений
  onboarded_at timestamptz,                                     -- null = профиль ещё не заполнен (S02)
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index users_one_primary_owner on users (role) where role = 'primary_owner';
create index users_display_name_trgm on users using gin (display_name gin_trgm_ops);
create index users_real_name_trgm on users using gin (real_name gin_trgm_ops);
create index users_status_expires_at on users (status_expires_at) where status_expires_at is not null;
create index users_dnd_until on users (dnd_until) where dnd_until is not null;
create trigger users_updated_at before update on users
  for each row execute function set_updated_at();

create table user_preferences (
  user_id uuid primary key references users (id) on delete cascade,
  notify_level text not null default 'mentions'
    check (notify_level in ('all', 'mentions')),                -- «Notify me about»
  notify_keywords text[] not null default '{}',
  desktop_notifications boolean not null default true,
  notification_sound text not null default 'default',
  show_message_preview boolean not null default true,
  notify_thread_replies boolean not null default true,
  -- рабочие часы уведомлений: {"days":[1,2,3,4,5],"from":"09:00","to":"19:00"}; null = всегда
  notification_schedule jsonb,
  badge_includes_thread_replies boolean not null default true,
  enter_sends boolean not null default true,                    -- false = отправка по ⌘Enter
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  ui jsonb not null default '{}',                               -- чисто клиентские мелочи
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger user_preferences_updated_at before update on user_preferences
  for each row execute function set_updated_at();

-- Сессия = случайный токен в httpOnly-cookie, в БД только sha256.
create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  token_hash bytea not null unique,
  client text not null default 'web' check (client in ('web', 'desktop')),
  user_agent text not null default '',
  ip inet,
  expires_at timestamptz not null,
  last_used_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sessions_user_id on sessions (user_id);
create index sessions_expires_at on sessions (expires_at);
create trigger sessions_updated_at before update on sessions
  for each row execute function set_updated_at();

-- Одноразовый 6-значный код входа по email. Без FK: пользователя может ещё не быть (инвайт).
create table login_codes (
  id uuid primary key default gen_random_uuid(),
  email citext not null,
  code_hash bytea not null,
  invite_id uuid,                                               -- инвайт, с которым пришли (проверяется в коде)
  attempts int not null default 0 check (attempts between 0 and 10),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index login_codes_email_created on login_codes (email, created_at desc);
create index login_codes_expires_at on login_codes (expires_at);

-- Передача входа из системного браузера в Electron (Google не пускает OAuth во встроенные окна).
create table auth_handoffs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  code_hash bytea not null unique,
  expires_at timestamptz not null,                              -- ~60 секунд
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index auth_handoffs_user_id on auth_handoffs (user_id);
create index auth_handoffs_expires_at on auth_handoffs (expires_at);

-- email задан = персональный инвайт; email null = ссылка-приглашение с лимитом использований.
create table invites (
  id uuid primary key default gen_random_uuid(),
  email citext,
  token_hash bytea not null unique,
  role text not null default 'member' check (role in ('admin', 'member', 'guest')),
  channel_ids uuid[] not null default '{}',                     -- куда добавить при входе; валидируется в коде
  invited_by uuid not null references users (id) on delete restrict,
  max_uses int not null default 1 check (max_uses between 1 and 400),
  use_count int not null default 0 check (use_count >= 0),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  accepted_user_id uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invites_uses_within_limit check (use_count <= max_uses),
  constraint invites_email_single_use check (email is null or max_uses = 1)
);
create index invites_invited_by on invites (invited_by);
create index invites_accepted_user_id on invites (accepted_user_id);
create index invites_email on invites (email) where email is not null;
create trigger invites_updated_at before update on invites
  for each row execute function set_updated_at();

-- ───────────────────────────── conversations ─────────────────────────────

create table conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('public', 'private', 'dm', 'group_dm')),
  name text,                                                    -- slug канала; свободное имя группового ЛС; null у ЛС
  dm_key text unique,                                           -- отсортированные id участников ЛС/группового ЛС
  topic text not null default '' check (length(topic) <= 250),
  topic_set_by uuid references users (id) on delete restrict,
  topic_set_at timestamptz,
  purpose text not null default '' check (length(purpose) <= 250),
  is_general boolean not null default false,
  is_default boolean not null default false,                    -- автоматически для новичков
  posting_policy text not null default 'everyone'
    check (posting_policy in ('everyone', 'admins')),
  allow_channel_mentions boolean not null default true,         -- @here / @channel
  created_by uuid not null references users (id) on delete restrict,
  archived_at timestamptz,
  archived_by uuid references users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversations_name_by_kind check (
    (kind in ('public', 'private') and name ~ '^[a-z0-9_-]{1,80}$')
    or (kind = 'group_dm' and (name is null or length(name) between 1 and 80))
    or (kind = 'dm' and name is null)
  ),
  constraint conversations_dm_key_by_kind check ((kind in ('dm', 'group_dm')) = (dm_key is not null)),
  constraint conversations_general_is_public check (not is_general or (kind = 'public' and archived_at is null)),
  constraint conversations_default_is_public check (not is_default or kind = 'public'),
  constraint conversations_dm_not_archived check (kind in ('public', 'private') or archived_at is null)
);
-- Имя канала уникально навсегда, архивные тоже держат имя (как у Slack).
create unique index conversations_channel_name on conversations (name) where kind in ('public', 'private');
create unique index conversations_one_general on conversations (is_general) where is_general;
create index conversations_kind on conversations (kind);
create index conversations_created_by on conversations (created_by);
create index conversations_topic_set_by on conversations (topic_set_by);
create index conversations_archived_by on conversations (archived_by);
create index conversations_name_trgm on conversations using gin (name gin_trgm_ops) where kind in ('public', 'private');
create trigger conversations_updated_at before update on conversations
  for each row execute function set_updated_at();

create table sidebar_sections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  emoji text not null default '',
  sort text not null default 'manual' check (sort in ('manual', 'alpha', 'recent')),
  position int not null default 0,
  collapsed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sidebar_sections_user_id on sidebar_sections (user_id, position);
create trigger sidebar_sections_updated_at before update on sidebar_sections
  for each row execute function set_updated_at();

-- Участие + личное состояние разговора: курсор прочитанного, уведомления, место в сайдбаре.
create table conversation_members (
  conversation_id uuid not null references conversations (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  is_manager boolean not null default false,
  last_read_seq bigint not null default 0,                      -- всё с messages.seq > этого — непрочитано
  notify_level text not null default 'default'
    check (notify_level in ('default', 'all', 'mentions', 'mute')),
  follow_all_threads boolean not null default false,
  section_id uuid references sidebar_sections (id) on delete set null,
  starred boolean not null default false,
  is_open boolean not null default true,                        -- видно ли ЛС в сайдбаре
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index conversation_members_user_id on conversation_members (user_id);
create index conversation_members_section_id on conversation_members (section_id);
create trigger conversation_members_updated_at before update on conversation_members
  for each row execute function set_updated_at();

-- ───────────────────────────── messages ─────────────────────────────

-- text хранит разметку клона: *жирный*, _курсив_, ~зачёркнутый~, `код`, ```блок```, > цитата, списки,
-- упоминания токенами с id: <@user-uuid> <#conversation-uuid> <!here> <!channel> <!everyone>.
-- Имена при рендере берутся из справочников, поэтому переименования не ломают старые сообщения.
create table messages (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity unique,               -- порядок, пагинация, курсоры прочитанного
  conversation_id uuid not null references conversations (id) on delete cascade,
  user_id uuid not null references users (id) on delete restrict,
  client_msg_id uuid,                                           -- идемпотентность повторной отправки
  subtype text check (subtype in (
    'join', 'leave', 'topic', 'purpose', 'rename', 'archive', 'unarchive', 'pin', 'unpin'
  )),                                                           -- null = обычное сообщение
  text text not null default '' check (length(text) <= 40000),
  parent_id uuid references messages (id) on delete cascade,   -- ответ в треде (один уровень)
  also_in_channel boolean not null default false,               -- ответ из треда показан и в канале
  forwarded_message_id uuid references messages (id) on delete set null,
  has_link boolean not null default false,
  reply_count int not null default 0 check (reply_count >= 0),
  reply_user_ids uuid[] not null default '{}',                  -- до 5 последних отвечавших
  last_reply_at timestamptz,
  edited_at timestamptz,
  deleted_at timestamptz,                                       -- мягкое удаление, текст очищается
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_tsv tsvector generated always as (
    to_tsvector('russian', regexp_replace(text, '<[^>]*>', ' ', 'g'))
    || to_tsvector('english', regexp_replace(text, '<[^>]*>', ' ', 'g'))
  ) stored,
  constraint messages_system_not_in_thread check (parent_id is null or subtype is null),
  constraint messages_broadcast_needs_parent check (not also_in_channel or parent_id is not null),
  constraint messages_replies_only_on_parent check (parent_id is null or reply_count = 0)
);
create unique index messages_client_msg_id on messages (user_id, client_msg_id) where client_msg_id is not null;
create index messages_conversation_seq on messages (conversation_id, seq);
-- лента канала: верхний уровень + ответы, отправленные «также в канал»
create index messages_channel_feed on messages (conversation_id, seq)
  where parent_id is null or also_in_channel;
create index messages_parent_seq on messages (parent_id, seq) where parent_id is not null;
create index messages_user_created on messages (user_id, created_at);
create index messages_forwarded_message_id on messages (forwarded_message_id) where forwarded_message_id is not null;
create index messages_search on messages using gin (search_tsv);
create trigger messages_updated_at before update on messages
  for each row execute function set_updated_at();

-- Кого задело сообщение. @here/@channel разворачиваются в строки на получателей при отправке.
create table message_mentions (
  message_id uuid not null references messages (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  kind text not null check (kind in ('user', 'here', 'channel', 'everyone', 'keyword')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index message_mentions_user_id on message_mentions (user_id, message_id);

create table reactions (
  message_id uuid not null references messages (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  emoji text not null check (emoji ~ '^[a-z0-9_+-]{1,100}(::skin-tone-[2-6])?$'),
  created_at timestamptz not null default now(),
  primary key (message_id, emoji, user_id)
);
create index reactions_user_id on reactions (user_id);

create table files (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid not null references users (id) on delete restrict,
  name text not null check (length(name) between 1 and 255),
  mimetype text not null,
  size_bytes bigint not null check (size_bytes between 0 and 104857600), -- 100 МБ
  storage_key text not null unique,
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  width int check (width > 0),
  height int check (height > 0),
  thumbnails jsonb not null default '{}',                       -- {"360": "key", "720": "key"}
  alt_text text not null default '' check (length(alt_text) <= 1000),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_tsv tsvector generated always as (to_tsvector('simple', name)) stored
);
create index files_uploader_created on files (uploader_id, created_at);
create index files_pending on files (created_at) where status = 'pending';
create index files_search on files using gin (search_tsv);
create trigger files_updated_at before update on files
  for each row execute function set_updated_at();

-- Файл существует один раз; каждое его появление в разговоре — сообщение.
create table message_files (
  message_id uuid not null references messages (id) on delete cascade,
  file_id uuid not null references files (id) on delete cascade,
  position smallint not null default 0 check (position between 0 and 9), -- до 10 файлов в сообщении
  primary key (message_id, file_id)
);
create index message_files_file_id on message_files (file_id);

create table message_unfurls (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages (id) on delete cascade,
  url text not null check (url ~ '^https?://'),
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  title text not null default '' check (length(title) <= 300),
  description text not null default '' check (length(description) <= 1000),
  site_name text not null default '' check (length(site_name) <= 100),
  image_url text check (image_url ~ '^https?://'),
  hidden boolean not null default false,
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (message_id, url)
);
create trigger message_unfurls_updated_at before update on message_unfurls
  for each row execute function set_updated_at();

create table pins (
  message_id uuid primary key references messages (id) on delete cascade,
  conversation_id uuid not null references conversations (id) on delete cascade,
  pinned_by uuid not null references users (id) on delete restrict,
  created_at timestamptz not null default now()
);
create index pins_conversation_created on pins (conversation_id, created_at desc);
create index pins_pinned_by on pins (pinned_by);

create table bookmarks (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations (id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  url text not null check (url ~ '^https?://' and length(url) <= 2000),
  emoji text not null default '',
  rank text not null,                                           -- лексикографический ключ ручной сортировки
  created_by uuid not null references users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bookmarks_conversation_rank on bookmarks (conversation_id, rank);
create index bookmarks_created_by on bookmarks (created_by);
create trigger bookmarks_updated_at before update on bookmarks
  for each row execute function set_updated_at();

-- ───────────────────────────── per-user state ─────────────────────────────

create table thread_subscriptions (
  user_id uuid not null references users (id) on delete cascade,
  parent_message_id uuid not null references messages (id) on delete cascade,
  subscribed boolean not null default true,
  last_read_seq bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, parent_message_id)
);
create index thread_subscriptions_parent on thread_subscriptions (parent_message_id);
create trigger thread_subscriptions_updated_at before update on thread_subscriptions
  for each row execute function set_updated_at();

-- Лента Activity и основа для решения «слать ли уведомление».
create table activity_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,  -- получатель
  kind text not null check (kind in ('mention', 'thread_reply', 'dm', 'reaction', 'reminder')),
  conversation_id uuid references conversations (id) on delete cascade,
  message_id uuid references messages (id) on delete cascade,
  actor_id uuid references users (id) on delete set null,
  emoji text,                                                   -- для kind = reaction
  reminder_id uuid,                                             -- для kind = reminder
  read_at timestamptz,
  cleared_at timestamptz,
  created_at timestamptz not null default now(),
  constraint activity_items_reaction_has_emoji check ((kind = 'reaction') = (emoji is not null))
);
create index activity_items_user_created on activity_items (user_id, created_at desc);
create index activity_items_user_unread on activity_items (user_id) where read_at is null and cleared_at is null;
create index activity_items_conversation_id on activity_items (conversation_id);
create index activity_items_message_id on activity_items (message_id);
create index activity_items_actor_id on activity_items (actor_id);
-- одна запись на сообщение для упоминаний/ответов/ЛС, одна на реакцию от человека
create unique index activity_items_once_per_message on activity_items (user_id, kind, message_id)
  where kind in ('mention', 'thread_reply', 'dm');
create unique index activity_items_once_per_reaction on activity_items (user_id, message_id, actor_id, emoji)
  where kind = 'reaction';

create table saved_items (
  user_id uuid not null references users (id) on delete cascade,
  message_id uuid not null references messages (id) on delete cascade,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);
create index saved_items_user_created on saved_items (user_id, created_at desc);
create index saved_items_message_id on saved_items (message_id);

create table reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  text text not null check (length(text) between 1 and 1000),
  message_id uuid references messages (id) on delete set null,
  remind_at timestamptz not null,
  recurrence text check (recurrence in ('daily', 'weekdays', 'weekly', 'monthly')), -- в часовом поясе пользователя
  fired_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reminders_user_id on reminders (user_id, remind_at);
create index reminders_due on reminders (remind_at) where completed_at is null;
create index reminders_message_id on reminders (message_id);
create trigger reminders_updated_at before update on reminders
  for each row execute function set_updated_at();

create table scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  conversation_id uuid not null references conversations (id) on delete cascade,
  parent_id uuid references messages (id) on delete cascade,
  text text not null check (length(text) <= 40000),
  file_ids uuid[] not null default '{}',
  post_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'sent', 'cancelled', 'failed')),
  sent_message_id uuid references messages (id) on delete set null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scheduled_messages_horizon check (post_at <= created_at + interval '120 days')
);
create index scheduled_messages_user_id on scheduled_messages (user_id, post_at);
create index scheduled_messages_due on scheduled_messages (post_at) where status = 'scheduled';
create index scheduled_messages_conversation_id on scheduled_messages (conversation_id);
create index scheduled_messages_parent_id on scheduled_messages (parent_id);
create index scheduled_messages_sent_message_id on scheduled_messages (sent_message_id);
create trigger scheduled_messages_updated_at before update on scheduled_messages
  for each row execute function set_updated_at();

-- Один черновик на разговор или тред; синхронизация между устройствами по updated_at.
create table drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  conversation_id uuid not null references conversations (id) on delete cascade,
  parent_id uuid references messages (id) on delete cascade,
  text text not null check (length(text) <= 40000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (user_id, conversation_id, parent_id)
);
create index drafts_conversation_id on drafts (conversation_id);
create index drafts_parent_id on drafts (parent_id);
create trigger drafts_updated_at before update on drafts
  for each row execute function set_updated_at();

create table custom_emoji (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (name ~ '^[a-z0-9_-]{1,100}$'),
  image_key text,
  alias_of_id uuid references custom_emoji (id) on delete cascade,
  created_by uuid not null references users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint custom_emoji_image_xor_alias check ((image_key is null) <> (alias_of_id is null))
);
create index custom_emoji_alias_of_id on custom_emoji (alias_of_id);
create index custom_emoji_created_by on custom_emoji (created_by);

-- ───────────────────────────── realtime log ─────────────────────────────

-- Журнал событий для realtime и догрузки после переподключения. Без FK: событие об удалённом
-- канале должно дойти. Запись идёт в той же транзакции, что и изменение, под
-- pg_advisory_xact_lock, поэтому порядок id совпадает с порядком коммитов. Хранится 7 дней.
create table events (
  id bigint generated always as identity primary key,
  kind text not null,                                           -- message.created, reaction.added, ...
  conversation_id uuid,                                         -- адресат: участники разговора
  user_id uuid,                                                 -- адресат: один пользователь (его устройства)
  broadcast boolean not null default false,                     -- адресат: все (профили, emoji, каналы)
  payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint events_has_audience check (
    (conversation_id is not null)::int + (user_id is not null)::int + broadcast::int = 1
  )
);
create index events_conversation_id on events (conversation_id, id) where conversation_id is not null;
create index events_user_id on events (user_id, id) where user_id is not null;
create index events_broadcast on events (id) where broadcast;
create index events_created_at on events (created_at);
