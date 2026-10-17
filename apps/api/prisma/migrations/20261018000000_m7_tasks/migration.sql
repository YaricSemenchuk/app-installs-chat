-- M7: задачи из Jira и макеты из Figma. Сами задачи и комментарии в базе не храним: их читают из Jira и Figma
-- при открытии (с коротким кэшем в памяти). Здесь только откуда их брать для канала и превью макетов.

-- Что показывать во вкладке «Задачи» канала: JQL для Jira и файлы Figma, комментарии из которых — правки по дизайну.
create table channel_task_sources (
  conversation_id uuid primary key references conversations(id) on delete cascade,
  jira_jql text check (char_length(jira_jql) between 1 and 2000),
  figma_files text[] not null default '{}' check (cardinality(figma_files) <= 10), -- ключи файлов Figma
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on channel_task_sources (updated_by);
create trigger channel_task_sources_updated_at before update on channel_task_sources
  for each row execute function set_updated_at();

-- Превью макета: имя файла, имя кадра и картинка в нашем хранилище. Ссылки Figma на картинки живут недолго,
-- а лимиты её API маленькие, поэтому один раз скачиваем и раздаём сами. node_id '' — превью всего файла.
create table figma_previews (
  id uuid primary key default gen_random_uuid(),
  file_key text not null check (file_key ~ '^[A-Za-z0-9]{10,128}$'),
  node_id text not null default '' check (node_id = '' or node_id ~ '^[0-9]+:[0-9]+$'),
  status text not null default 'pending' check (status in ('pending', 'ready', 'forbidden', 'missing', 'failed')),
  file_name text not null default '',
  node_name text not null default '',
  image_key text, -- объект в хранилище (figma/<id>/<версия>.webp)
  width int,
  height int,
  last_modified timestamptz, -- когда файл последний раз меняли в Figma
  fetched_at timestamptz,
  retry_at timestamptz, -- Figma ответила 429 или упала: раньше не спрашиваем
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (file_key, node_id)
);
create trigger figma_previews_updated_at before update on figma_previews
  for each row execute function set_updated_at();

-- Карточка ссылки на Figma в сообщении опирается на превью; остальные поля unfurl остаются для обычных ссылок.
alter table message_unfurls add column figma_preview_id uuid references figma_previews(id) on delete set null;
create index on message_unfurls (figma_preview_id);
