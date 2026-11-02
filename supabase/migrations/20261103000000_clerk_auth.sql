-- Switch Savesy from Supabase anonymous users to Clerk accounts.
-- Clerk is connected as a Supabase third-party auth provider, so requests carry a
-- Clerk session token: auth.jwt()->>'sub' is the Clerk user id (e.g. "user_2abc…", text).
-- Safe to run on a fresh database (after the first migration) or on one that already has data.

drop policy if exists "own saves" on public.saves;
drop policy if exists "own collections" on public.collections;

alter table public.saves drop constraint if exists saves_user_id_collection_id_fkey;
alter table public.saves drop constraint if exists saves_user_id_fkey;
alter table public.collections drop constraint if exists collections_user_id_fkey;

alter table public.collections alter column user_id drop default;
alter table public.saves alter column user_id drop default;
alter table public.collections alter column user_id type text using user_id::text;
alter table public.saves alter column user_id type text using user_id::text;
alter table public.collections alter column user_id set default (auth.jwt() ->> 'sub');
alter table public.saves alter column user_id set default (auth.jwt() ->> 'sub');

alter table public.saves
  add constraint saves_user_id_collection_id_fkey
  foreign key (user_id, collection_id) references public.collections (user_id, id) on delete set null (collection_id);

create policy "own collections" on public.collections
  for all to authenticated
  using ((select auth.jwt() ->> 'sub') = user_id)
  with check ((select auth.jwt() ->> 'sub') = user_id);

create policy "own saves" on public.saves
  for all to authenticated
  using ((select auth.jwt() ->> 'sub') = user_id)
  with check ((select auth.jwt() ->> 'sub') = user_id);
