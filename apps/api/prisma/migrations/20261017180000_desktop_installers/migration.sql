-- Установщики десктоп-приложения: администратор загружает .dmg и .exe, вошедшие сотрудники скачивают их на /download.
-- Храним только последнюю сборку для каждой платформы; сам файл лежит в хранилище под своим ключом.
create table desktop_installers (
  platform text primary key check (platform in ('mac', 'win')),
  version text not null check (version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$'),
  file_name text not null check (length(file_name) between 1 and 200),
  size_bytes bigint not null check (size_bytes > 0),
  storage_key text not null,
  uploaded_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on desktop_installers (uploaded_by);
create trigger desktop_installers_updated_at before update on desktop_installers
  for each row execute function set_updated_at();
