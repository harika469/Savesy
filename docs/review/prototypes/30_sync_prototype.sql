-- PROTOTYPE ONLY (not a migration): server revisions + conditional writes + tombstones. Run after 00.
\set ON_ERROR_STOP on
-- ===== Prototype (scratch DB only): server revisions + compare-and-swap writes + tombstones =====
alter table public.saves add column rev bigint not null default 0, add column deleted_at timestamptz;
alter table public.collections add column rev bigint not null default 0, add column deleted_at timestamptz;
create index saves_user_rev on public.saves (user_id, rev);
create index collections_user_rev on public.collections (user_id, rev);
create table public.sync_heads (user_id text primary key, rev bigint not null default 0);
alter table public.sync_heads enable row level security;   -- no policies: server-only

-- Clients may only READ directly; every write goes through push_changes (so revisions stay ordered).
drop policy "own saves" on public.saves;
drop policy "own collections" on public.collections;
create policy "read own saves" on public.saves for select to authenticated using ((select auth.jwt() ->> 'sub') = user_id);
create policy "read own collections" on public.collections for select to authenticated using ((select auth.jwt() ->> 'sub') = user_id);

-- One change: {"table":"saves"|"collections","id":..,"base_rev":N,"op":"upsert"|"delete","row":{...}}
-- Applied only if the server row is still at base_rev (0 = "I've never seen it"). Returns applied/conflict per change.
create function public.push_changes(p_changes jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid text := auth.jwt() ->> 'sub';
  ch jsonb; tbl text; cid text; base bigint; cur_rev bigint; next_rev bigint; out jsonb := '[]'::jsonb; srv jsonb;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  insert into public.sync_heads (user_id) values (uid) on conflict do nothing;
  perform 1 from public.sync_heads where user_id = uid for update;   -- serializes this user's writes => revisions commit in order
  for ch in select * from jsonb_array_elements(p_changes) loop
    tbl := ch->>'table'; cid := ch->>'id'; base := coalesce((ch->>'base_rev')::bigint, 0);
    if tbl not in ('saves','collections') or cid is null then raise exception 'bad change' using errcode = '22023'; end if;
    execute format('select rev from public.%I where user_id = $1 and id = $2', tbl) into cur_rev using uid, cid;
    if coalesce(cur_rev, 0) <> base then
      execute format('select to_jsonb(t) from public.%I t where user_id = $1 and id = $2', tbl) into srv using uid, cid;
      out := out || jsonb_build_object('table', tbl, 'id', cid, 'status', 'conflict', 'server', srv);
      continue;
    end if;
    update public.sync_heads set rev = rev + 1 where user_id = uid returning rev into next_rev;
    if ch->>'op' = 'delete' then
      if cur_rev is null then
        out := out || jsonb_build_object('table', tbl, 'id', cid, 'status', 'applied', 'rev', null); continue;
      end if;
      execute format('update public.%I set deleted_at = now(), rev = $3 where user_id = $1 and id = $2', tbl) using uid, cid, next_rev;
    elsif tbl = 'saves' then
      insert into public.saves (user_id, id, url, title, note, type, source, image_url, tags, collection_id, is_favorite, created_at, updated_at, last_rediscovered_at, details, rev, deleted_at)
      select uid, cid, r.url, r.title, r.note, coalesce(r.type, 'other'), r.source, r.image_url, coalesce(r.tags, '{}'), r.collection_id, coalesce(r.is_favorite, false),
             coalesce(r.created_at, now()), coalesce(r.updated_at, now()), r.last_rediscovered_at, r.details, next_rev, null
      from jsonb_populate_record(null::public.saves, ch->'row') r
      on conflict (user_id, id) do update set url = excluded.url, title = excluded.title, note = excluded.note, type = excluded.type, source = excluded.source,
        image_url = excluded.image_url, tags = excluded.tags, collection_id = excluded.collection_id, is_favorite = excluded.is_favorite,
        updated_at = excluded.updated_at, last_rediscovered_at = excluded.last_rediscovered_at, details = excluded.details, rev = excluded.rev, deleted_at = null;
    else
      insert into public.collections (user_id, id, name, created_at, updated_at, rev, deleted_at)
      select uid, cid, r.name, coalesce(r.created_at, now()), coalesce(r.updated_at, now()), next_rev, null
      from jsonb_populate_record(null::public.collections, ch->'row') r
      on conflict (user_id, id) do update set name = excluded.name, updated_at = excluded.updated_at, rev = excluded.rev, deleted_at = null;
    end if;
    out := out || jsonb_build_object('table', tbl, 'id', cid, 'status', 'applied', 'rev', next_rev);
  end loop;
  return out;
end $$;
revoke all on function public.push_changes(jsonb) from public, anon;
grant execute on function public.push_changes(jsonb) to authenticated;
