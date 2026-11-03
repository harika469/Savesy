-- PROTOTYPE ONLY (not a migration): server revisions + conditional writes + tombstones. Run after 00.
-- v2 (after ChatGPT review of 3fcf7fd): strict input validation before any write, no head bump for
-- unknown deletes, collection delete detaches its saves, tombstones scrubbed, stored row returned on
-- apply, and get_sync_head() for a consistent pull high-water mark.
\set ON_ERROR_STOP on
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

-- Validates one change; raises 22023 with a reason. Pure function (no table access).
create function public.sync_validate_change(ch jsonb) returns void
language plpgsql immutable set search_path = '' as $$
declare
  tbl text; k text; allowed_row text[];
begin
  if jsonb_typeof(ch) <> 'object' then raise exception 'change must be an object' using errcode = '22023'; end if;
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

-- High-water mark for pulls: read it first, then page each table with  rev > cursor and rev <= head  ordered by rev.
-- Writes for a user are serialized and the head is bumped in the same transaction as the rows, so every rev <= head is committed.
create function public.get_sync_head() returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce((select rev from public.sync_heads where user_id = auth.jwt() ->> 'sub'), 0);
$$;

create function public.push_changes(p_changes jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid text := auth.jwt() ->> 'sub';
  ch jsonb; tbl text; cid text; base bigint; cur_rev bigint; next_rev bigint; out jsonb := '[]'::jsonb; srv jsonb; col_ok boolean; s record;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if jsonb_typeof(p_changes) is distinct from 'array' then raise exception 'changes must be an array' using errcode = '22023'; end if;
  if jsonb_array_length(p_changes) not between 1 and 200 then raise exception 'batch must have 1 to 200 changes' using errcode = '22023'; end if;
  -- Validate the WHOLE batch before writing anything.
  perform public.sync_validate_change(c) from jsonb_array_elements(p_changes) c;

  insert into public.sync_heads (user_id) values (uid) on conflict do nothing;
  perform 1 from public.sync_heads where user_id = uid for update;   -- serializes this user's writes => revisions commit in order
  for ch in select * from jsonb_array_elements(p_changes) loop
    tbl := ch->>'table'; cid := ch->>'id'; base := (ch->>'base_rev')::bigint;
    execute format('select rev from public.%I where user_id = $1 and id = $2', tbl) into cur_rev using uid, cid;

    if coalesce(cur_rev, 0) <> base then
      execute format('select to_jsonb(t) from public.%I t where user_id = $1 and id = $2', tbl) into srv using uid, cid;
      out := out || jsonb_build_object('table', tbl, 'id', cid, 'status', 'conflict', 'server', srv);
      continue;
    end if;

    if ch->>'op' = 'delete' and cur_rev is null then
      -- Never existed on the server: nothing to delete, no revision used.
      out := out || jsonb_build_object('table', tbl, 'id', cid, 'status', 'noop');
      continue;
    end if;

    update public.sync_heads set rev = rev + 1 where user_id = uid returning rev into next_rev;

    if ch->>'op' = 'delete' and tbl = 'saves' then
      -- Tombstone keeps only identity + rev; content is scrubbed (privacy, account deletion).
      update public.saves set deleted_at = now(), rev = next_rev, url = '', title = '', note = null, source = null, image_url = null,
        tags = '{}', collection_id = null, is_favorite = false, details = null, last_rediscovered_at = null
      where user_id = uid and id = cid;
    elsif ch->>'op' = 'delete' then
      update public.collections set deleted_at = now(), rev = next_rev, name = '·' where user_id = uid and id = cid;
      -- Detach live saves from the deleted collection, each with its own new revision so other devices learn it.
      for s in select id from public.saves where user_id = uid and collection_id = cid and deleted_at is null order by id loop
        update public.sync_heads set rev = rev + 1 where user_id = uid returning rev into next_rev;
        update public.saves set collection_id = null, rev = next_rev where user_id = uid and id = s.id;
      end loop;
    elsif tbl = 'saves' then
      -- A save may only point at a live collection of the same user; otherwise it is stored without one.
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

    -- Return the row as stored, so the client adopts server normalization (e.g. a cleared collection_id).
    execute format('select to_jsonb(t) - ''user_id'' from public.%I t where user_id = $1 and id = $2', tbl) into srv using uid, cid;
    out := out || jsonb_build_object('table', tbl, 'id', cid, 'status', 'applied', 'rev', (srv->>'rev')::bigint, 'server', srv);
  end loop;
  return out;
end $$;

revoke all on function public.push_changes(jsonb), public.get_sync_head(), public.sync_validate_change(jsonb) from public, anon, authenticated;
grant execute on function public.push_changes(jsonb), public.get_sync_head() to authenticated;
