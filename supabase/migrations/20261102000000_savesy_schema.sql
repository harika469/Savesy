-- Savesy cloud storage.
-- Each person signs in anonymously from the app; every row belongs to auth.uid()
-- and row-level security keeps people from seeing each other's saves.
-- Ids are generated on the phone (so saves work offline), hence (user_id, id) keys.

create table if not exists public.collections (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id         text        not null,
  name       text        not null check (char_length(name) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.saves (
  user_id              uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id                   text        not null,
  url                  text        not null check (char_length(url) <= 4000),
  title                text        not null check (char_length(title) <= 1000),
  note                 text        check (char_length(note) <= 10000),
  type                 text        not null default 'other' check (type in ('article', 'video', 'product', 'place', 'social', 'other')),
  source               text,
  image_url            text,
  tags                 text[]      not null default '{}',
  collection_id        text,
  is_favorite          boolean     not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  last_rediscovered_at timestamptz,
  primary key (user_id, id),
  foreign key (user_id, collection_id) references public.collections (user_id, id) on delete set null (collection_id)
);

create index if not exists saves_user_created_idx on public.saves (user_id, created_at desc);

alter table public.collections enable row level security;
alter table public.saves enable row level security;

drop policy if exists "own collections" on public.collections;
create policy "own collections" on public.collections
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "own saves" on public.saves;
create policy "own saves" on public.saves
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.collections, public.saves to authenticated;
