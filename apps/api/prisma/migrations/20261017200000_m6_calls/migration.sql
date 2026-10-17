-- M6: звонки. Медиа идёт через LiveKit; здесь только кто, где и когда разговаривает.
-- В разговоре не больше одного идущего звонка: второй «начать» присоединяет к первому.
create table calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  started_by uuid references users(id) on delete set null,
  room text not null unique, -- имя комнаты в LiveKit
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index calls_one_active on calls (conversation_id) where ended_at is null;
create index on calls (started_by);
create trigger calls_updated_at before update on calls
  for each row execute function set_updated_at();

-- Повторный вход в тот же звонок обновляет строку: joined_at — последний вход, left_at null — сейчас в звонке.
create table call_participants (
  call_id uuid not null references calls(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (call_id, user_id)
);
create index on call_participants (user_id);
