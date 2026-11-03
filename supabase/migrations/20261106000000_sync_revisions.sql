-- Sync foundation (issue #1: S-05, C-2, C-7, C-11). Replaces client-timestamp, last-write-wins upserts with:
--   * server-owned revisions: every write gets the next per-user revision (sync_heads), in commit order;
--   * conditional writes: push_changes applies a change only if the row is still at the client's base_rev,
--     otherwise it returns a conflict with the server row (no silent overwrite, no reliance on phone clocks);
--   * durable tombstones: deletes set deleted_at and scrub content, so every device learns about them;
--   * one ordered, paged pull stream across saves and collections (pull_changes);
--   * tombstone retention with a per-user floor (purge_tombstones, server only).
-- Clients can no longer write the tables directly (read-only RLS); all writes go through push_changes.
--
-- Existing data: every existing row is kept unchanged and numbered; see the backfill below.
-- Old app builds (before this sync client) can still read but their direct writes are refused.
-- Rollback: see the end of this file.

-- 1) Columns, nullable during backfill ------------------------------------------------------------
alter table public.saves add column rev bigint, add column deleted_at timestamptz;
alter table public.collections add column rev bigint, add column deleted_at timestamptz;

create table public.sync_heads (
  user_id   text   primary key,
  rev       bigint not null default 0,  -- last revision issued for this user
  floor_rev bigint not null default 0   -- tombstones at or below this revision may have been purged
);
alter table public.sync_heads enable row level security;   -- no policies: server functions only

-- 2) Backfill: number every existing row per user. Order: last change first-to-last, collections before saves on
--    ties (so a collection precedes the saves that point at it), then id for determinism.
with all_rows as (
  select user_id, 0 as kind, id, updated_at from public.collections
  union all
  select user_id, 1 as kind, id, updated_at from public.saves
), numbered as (
  select user_id, kind, id, row_number() over (partition by user_id order by updated_at, kind, id) as rn from all_rows
)
update public.collections c set rev = n.rn from numbered n where n.kind = 0 and c.user_id = n.user_id and c.id = n.id;

with all_rows as (
  select user_id, 0 as kind, id, updated_at from public.collections
  union all
  select user_id, 1 as kind, id, updated_at from public.saves
), numbered as (
  select user_id, kind, id, row_number() over (partition by user_id order by updated_at, kind, id) as rn from all_rows
)
update public.saves s set rev = n.rn from numbered n where n.kind = 1 and s.user_id = n.user_id and s.id = n.id;

insert into public.sync_heads (user_id, rev)
select user_id, max(rev) from (select user_id, rev from public.collections union all select user_id, rev from public.saves) r group by user_id;

alter table public.saves alter column rev set not null, alter column rev set default 0;
alter table public.collections alter column rev set not null, alter column rev set default 0;
create unique index saves_user_rev on public.saves (user_id, rev);
create unique index collections_user_rev on public.collections (user_id, rev);

-- 3) Read-only for clients; writes only through push_changes -----------------------------------------
drop policy if exists "own saves" on public.saves;
drop policy if exists "own collections" on public.collections;
create policy "read own saves" on public.saves for select to authenticated using ((select auth.jwt() ->> 'sub') = user_id);
create policy "read own collections" on public.collections for select to authenticated using ((select auth.jwt() ->> 'sub') = user_id);
revoke insert, update, delete, truncate on public.saves, public.collections from anon, authenticated;
revoke all on public.sync_heads from anon, authenticated;

-- 4) Validation (whole batch is checked before anything is written) ----------------------------------
create function public.sync_validate_change(ch jsonb) returns void
language plpgsql immutable set search_path = '' as $$
declare
  tbl text; k text; allowed_row text[];
begin
  if jsonb_typeof(ch) is distinct from 'object' then raise exception 'change must be an object' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(ch) loop
    if k not in ('table','id','base_rev','op','row') then raise exception 'unknown key %', k using errcode = '22023'; end if;
  end loop;
  tbl := ch->>'table';
  if tbl is null or tbl not in ('saves','collections') then raise exception 'bad table' using errcode = '22023'; end if;
  if jsonb_typeof(ch->'id') is distinct from 'string' or length(ch->>'id') not between 1 and 200 then raise exception 'bad id' using errcode = '22023'; end if;
  if jsonb_typeof(ch->'base_rev') is distinct from 'number' or (ch->>'base_rev') !~ '^[0-9]{1,18}$' then raise exception 'base_rev must be a non-negative integer' using errcode = '22023'; end if;
  if ch->>'op' is null or ch->>'op' not in ('upsert','delete') then raise exception 'op must be upsert or delete' using errcode = '22023'; end if;
  if ch->>'op' = 'delete' then
    if ch ? 'row' then raise exception 'delete takes no row' using errcode = '22023'; end if;
    return;
  end if;
  if jsonb_typeof(ch->'row') is distinct from 'object' then raise exception 'upsert needs a row object' using errcode = '22023'; end if;
  if pg_column_size(ch->'row') > 64000 then raise exception 'row too large' using errcode = '22023'; end if;
  allowed_row := case tbl
    when 'saves' then array['url','title','note','type','source','image_url','tags','collection_id','is_favorite','created_at','updated_at','last_rediscovered_at','details']
    else array['name','created_at','updated_at'] end;
  for k in select jsonb_object_keys(ch->'row') loop
    if not (k = any(allowed_row)) then raise exception 'field % not allowed in %', k, tbl using errcode = '22023'; end if;
  end loop;
  if tbl = 'saves' and (coalesce(ch->'row'->>'url','') = '' or coalesce(ch->'row'->>'title','') = '') then raise exception 'save needs url and title' using errcode = '22023'; end if;
  if tbl = 'collections' and coalesce(ch->'row'->>'name','') = '' then raise exception 'collection needs a name' using errcode = '22023'; end if;
end $$;

-- 5) Writes ---------------------------------------------------------------------------------------------
-- One change: {"table":"saves"|"collections","id":..,"base_rev":N,"op":"upsert"|"delete","row":{...}}.
-- Applied only if the server row is still at base_rev (0 = "I have never seen it").
-- Result per change: applied (+ new rev and the stored row) | conflict (+ server row) | noop (delete of an unknown id).
create function public.push_changes(p_changes jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid text := auth.jwt() ->> 'sub';
  ch jsonb; tbl text; cid text; base bigint; cur_rev bigint; next_rev bigint; out jsonb := '[]'::jsonb; srv jsonb; col_ok boolean; s record;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if jsonb_typeof(p_changes) is distinct from 'array' then raise exception 'changes must be an array' using errcode = '22023'; end if;
  if jsonb_array_length(p_changes) not between 1 and 200 then raise exception 'batch must have 1 to 200 changes' using errcode = '22023'; end if;
  perform public.sync_validate_change(c) from jsonb_array_elements(p_changes) c;

  insert into public.sync_heads (user_id) values (uid) on conflict do nothing;
  perform 1 from public.sync_heads where user_id = uid for update;   -- serializes this user's writes => revisions commit in order

  for ch in select * from jsonb_array_elements(p_changes) loop
    tbl := ch->>'table'; cid := ch->>'id'; base := (ch->>'base_rev')::bigint;
    execute format('select rev from public.%I where user_id = $1 and id = $2', tbl) into cur_rev using uid, cid;

    if coalesce(cur_rev, 0) <> base then
      execute format('select to_jsonb(t) - ''user_id'' from public.%I t where user_id = $1 and id = $2', tbl) into srv using uid, cid;
      out := out || jsonb_build_object('table', tbl, 'id', cid, 'status', 'conflict', 'server', srv);
      continue;
    end if;

    if ch->>'op' = 'delete' and cur_rev is null then
      out := out || jsonb_build_object('table', tbl, 'id', cid, 'status', 'noop');
      continue;
    end if;

    update public.sync_heads set rev = rev + 1 where user_id = uid returning rev into next_rev;

    if ch->>'op' = 'delete' and tbl = 'saves' then
      update public.saves set deleted_at = now(), rev = next_rev, url = '', title = '', note = null, source = null, image_url = null,
        tags = '{}', collection_id = null, is_favorite = false, details = null, last_rediscovered_at = null
      where user_id = uid and id = cid;
    elsif ch->>'op' = 'delete' then
      update public.collections set deleted_at = now(), rev = next_rev, name = '·' where user_id = uid and id = cid;
      for s in select id from public.saves where user_id = uid and collection_id = cid and deleted_at is null order by id loop
        update public.sync_heads set rev = rev + 1 where user_id = uid returning rev into next_rev;
        update public.saves set collection_id = null, rev = next_rev where user_id = uid and id = s.id;
      end loop;
    elsif tbl = 'saves' then
      select exists (select 1 from public.collections where user_id = uid and id = ch->'row'->>'collection_id' and deleted_at is null) into col_ok;
      insert into public.saves (user_id, id, url, title, note, type, source, image_url, tags, collection_id, is_favorite, created_at, updated_at, last_rediscovered_at, details, rev, deleted_at)
      select uid, cid, r.url, r.title, r.note, coalesce(r.type, 'other'), r.source, r.image_url, coalesce(r.tags, '{}'),
             case when col_ok then r.collection_id end, coalesce(r.is_favorite, false),
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

    execute format('select to_jsonb(t) - ''user_id'' from public.%I t where user_id = $1 and id = $2', tbl) into srv using uid, cid;
    out := out || jsonb_build_object('table', tbl, 'id', cid, 'status', 'applied', 'rev', (srv->>'rev')::bigint, 'server', srv);
  end loop;
  return out;
end $$;

-- 6) Reads ----------------------------------------------------------------------------------------------
-- One ordered stream across both tables. First call: pass p_since (0 for a fresh device) and no head; the
-- response pins `head`. Next pages: pass the returned next_cursor as p_since and the same head, until more = false.
-- Every revision <= head is committed (writes are serialized per user and bump the head in the same transaction),
-- so paging within (since, head] never misses or repeats a row. Writes after the head arrive in the next round.
-- If p_since is below the user's floor (tombstones purged), the response says resync = true: re-download from 0.
create function public.pull_changes(p_since bigint, p_head bigint default null, p_limit integer default 500) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  uid text := auth.jwt() ->> 'sub';
  cur_head bigint; cur_floor bigint; head bigint; lim integer; page jsonb; last_rev bigint; more boolean;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_since is null or p_since < 0 then raise exception 'p_since must be >= 0' using errcode = '22023'; end if;
  select coalesce(max(h.rev), 0), coalesce(max(h.floor_rev), 0) into cur_head, cur_floor from public.sync_heads h where h.user_id = uid;
  if p_since > 0 and p_since < cur_floor then
    return jsonb_build_object('resync', true, 'head', cur_head, 'floor', cur_floor, 'changes', '[]'::jsonb, 'next_cursor', 0, 'more', false);
  end if;
  head := coalesce(p_head, cur_head);
  if head > cur_head or head < p_since then raise exception 'bad head' using errcode = '22023'; end if;
  lim := least(greatest(coalesce(p_limit, 500), 1), 500);

  with stream as (
    select 'collections'::text as tbl, c.rev, to_jsonb(c) - 'user_id' as row from public.collections c where c.user_id = uid and c.rev > p_since and c.rev <= head
    union all
    select 'saves'::text, s.rev, to_jsonb(s) - 'user_id' from public.saves s where s.user_id = uid and s.rev > p_since and s.rev <= head
  ), pg as (select * from stream order by rev limit lim)
  select coalesce(jsonb_agg(jsonb_build_object('table', tbl, 'row', row) order by rev), '[]'::jsonb), max(rev) into page, last_rev from pg;

  last_rev := coalesce(last_rev, head);
  more := exists (select 1 from public.collections where user_id = uid and rev > last_rev and rev <= head)
       or exists (select 1 from public.saves where user_id = uid and rev > last_rev and rev <= head);
  return jsonb_build_object('resync', false, 'head', head, 'floor', cur_floor, 'changes', page, 'next_cursor', last_rev, 'more', more);
end $$;

-- 7) Tombstone retention (server only, e.g. a daily scheduled job) -----------------------------------------
-- Deletes tombstones older than p_older_than and raises each affected user's floor to the highest purged revision.
create function public.purge_tombstones(p_older_than interval) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare n integer := 0; m integer;
begin
  if p_older_than < interval '7 days' then raise exception 'retention must be at least 7 days' using errcode = '22023'; end if;
  with gone as (
    delete from public.saves where deleted_at is not null and deleted_at < now() - p_older_than returning user_id, rev
  ), gone_c as (
    delete from public.collections where deleted_at is not null and deleted_at < now() - p_older_than returning user_id, rev
  ), all_gone as (select * from gone union all select * from gone_c)
  , floors as (
    update public.sync_heads h set floor_rev = greatest(h.floor_rev, g.max_rev)
    from (select user_id, max(rev) as max_rev from all_gone group by user_id) g where h.user_id = g.user_id returning 1
  )
  select count(*) into m from all_gone;
  n := n + m;
  return n;
end $$;

-- 8) Grants (explicit; migration 20261105000001 means nothing is client-callable by default) -------------
revoke all on function public.sync_validate_change(jsonb), public.push_changes(jsonb), public.pull_changes(bigint, bigint, integer),
  public.purge_tombstones(interval) from public, anon, authenticated;
grant execute on function public.push_changes(jsonb), public.pull_changes(bigint, bigint, integer) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.purge_tombstones(interval) to service_role;
  end if;
end $$;

-- Rollback (only before any client has written through push_changes; afterwards tombstones would be lost):
--   drop function public.purge_tombstones(interval), public.pull_changes(bigint, bigint, integer),
--     public.push_changes(jsonb), public.sync_validate_change(jsonb);
--   drop policy "read own saves" on public.saves; drop policy "read own collections" on public.collections;
--   (recreate the "own saves"/"own collections" policies from 20261103000000 and re-grant insert/update/delete)
--   delete from public.saves where deleted_at is not null; delete from public.collections where deleted_at is not null;
--   drop table public.sync_heads; drop index saves_user_rev, collections_user_rev;
--   alter table public.saves drop column rev, drop column deleted_at; alter table public.collections drop column rev, drop column deleted_at;
