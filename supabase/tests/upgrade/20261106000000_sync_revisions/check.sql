-- After 20261106000000 (and every later migration) has run on the populated database.
\i supabase/tests/assert.sql
\pset tuples_only on

-- Nothing lost, nothing added, nothing changed
create temp view after_rows as
  select 'saves' as tbl, user_id, id, rev, deleted_at, md5((to_jsonb(s) - 'rev' - 'deleted_at')::text) as fp from public.saves s
  union all
  select 'collections', user_id, id, rev, deleted_at, md5((to_jsonb(c) - 'rev' - 'deleted_at')::text) from public.collections c;
select pg_temp.ok((select count(*) from upgrade_check.rows b full join after_rows a using (tbl, user_id, id) where a.id is null or b.id is null) = 0,
                  'U1 every row that existed before exists after, and no row was added');
select pg_temp.ok((select count(*) from upgrade_check.rows b join after_rows a using (tbl, user_id, id) where a.fp <> b.fp) = 0,
                  'U2 every row''s content is byte-for-byte unchanged (all columns except the new rev/deleted_at)');
select pg_temp.ok((select count(*) from after_rows where deleted_at is not null) = 0, 'U3 no existing row was turned into a tombstone');

-- Revisions: per user, exactly 1..N across both tables, heads match
select pg_temp.ok((select bool_and(ok) from (
                    select user_id, min(rev) = 1 and max(rev) = count(*) and count(distinct rev) = count(*) as ok from after_rows group by user_id) x),
                  'U4 every user''s rows are numbered 1..N with no gaps or duplicates across saves and collections');
select pg_temp.ok((select count(*) from public.sync_heads h join (select user_id, count(*) n from after_rows group by user_id) r using (user_id) where h.rev = r.n and h.floor_rev = 0)
                  = (select count(distinct user_id) from after_rows), 'U5 each user''s head equals their row count; floors start at 0');
select pg_temp.ok(not exists (select 1 from public.sync_heads where user_id = 'user_nosaves'), 'U5b users with no saves get no head until they first write');
select pg_temp.ok(not exists (
                    select 1 from after_rows a join after_rows b on a.user_id = b.user_id and a.rev < b.rev
                    join upgrade_check.rows ba on ba.tbl = a.tbl and ba.user_id = a.user_id and ba.id = a.id
                    join upgrade_check.rows bb on bb.tbl = b.tbl and bb.user_id = b.user_id and bb.id = b.id
                    where ba.updated_at > bb.updated_at),
                  'U6 revision order follows each row''s last change (oldest first)');
select pg_temp.ok((select max(rev) from public.collections where user_id = 'user_ties') < (select min(rev) from public.saves where user_id = 'user_ties'),
                  'U7 on identical timestamps the collection is numbered before the saves that point at it');

-- Everything else untouched; relationships intact
select pg_temp.ok((select count(*) from upgrade_check.other o join (
                    select 'entitlements' as tbl, md5(coalesce(string_agg(to_jsonb(e)::text, '|' order by user_id), '')) as fp from public.entitlements e
                    union all select 'ai_usage', md5(coalesce(string_agg(to_jsonb(u)::text, '|' order by user_id, month), '')) from public.ai_usage u
                    union all select 'pro_interest', md5(coalesce(string_agg(to_jsonb(p)::text, '|' order by user_id), '')) from public.pro_interest p) n using (tbl)
                  where o.fp = n.fp) = 3, 'U8 entitlements, ai_usage and pro_interest are untouched');
select pg_temp.ok(not exists (select 1 from public.saves s where s.collection_id is not null and not exists (select 1 from public.collections c where c.user_id = s.user_id and c.id = s.collection_id)),
                  'U9 every save''s collection still exists');

-- Existing data is fully usable through the new sync functions
create function pg_temp.pull(u text, since bigint, head bigint default null, lim integer default 500) returns jsonb language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', u)::text, false); return public.pull_changes(since, head, lim); end $$;
create function pg_temp.push(u text, changes text) returns jsonb language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', u)::text, false); return public.push_changes(changes::jsonb); end $$;
grant execute on function pg_temp.pull(text, bigint, bigint, integer), pg_temp.push(text, text) to public;
set role authenticated;
create temp table pulled (tbl text, id text, rev bigint);
do $$
declare cursor_rev bigint := 0; head bigint; page jsonb; pages int := 0;
begin
  loop
    page := pg_temp.pull('user_big', cursor_rev, head, 500);
    head := (page->>'head')::bigint; pages := pages + 1;
    insert into pulled select c->>'table', c->'row'->>'id', (c->'row'->>'rev')::bigint from jsonb_array_elements(page->'changes') c;
    cursor_rev := (page->>'next_cursor')::bigint;
    exit when (page->>'more')::boolean = false;
    if pages > 10 then raise exception 'paging did not finish'; end if;
  end loop;
  perform set_config('test.pages', pages::text, false);
end $$;
select pg_temp.ok(current_setting('test.pages') = '3' and (select count(*) from pulled) = 1203 and (select count(distinct (tbl, id)) from pulled) = 1203,
                  'U10 a fresh device pulls all 1,203 rows of the 1,200-save user in 3 pages, each exactly once');
reset role;
select pg_temp.ok((select count(*) from pulled p join upgrade_check.rows b on b.tbl = p.tbl and b.user_id = 'user_big' and b.id = p.id) = 1203, 'U10 the pulled ids are exactly the existing rows');
set role authenticated;
select pg_temp.ok((pg_temp.pull('user_demo', 0))->'changes' @> '[{"table":"saves","row":{"id":"ramen","note":"Add chili crisp. 🌶️ 辛い"}}]'::jsonb, 'U11 pulled content matches the original (unicode note intact)');

select set_config('test.rev', (select rev::text from public.saves where user_id = 'user_demo' and id = 'ramen'), false) \g /dev/null
select pg_temp.ok((pg_temp.push('user_demo', format('[{"table":"saves","id":"ramen","base_rev":%s,"op":"upsert","row":{"url":"https://example.com/ramen","title":"Sesame ramen v2","tags":["ramen"]}}]', current_setting('test.rev'))))->0->>'rev' = '11',
                  'U12 an existing save is editable with its backfilled revision; the new revision follows the head (10 -> 11)');
select pg_temp.ok((pg_temp.push('user_demo', '[{"table":"saves","id":"green-dress","base_rev":1,"op":"upsert","row":{"url":"https://x","title":"stale"}}]'))->0->>'status' = 'conflict',
                  'U13 an edit based on a wrong revision is a conflict, not an overwrite');
select pg_temp.ok((pg_temp.push('user_demo', format('[{"table":"collections","id":"trips","base_rev":%s,"op":"delete"}]', (select rev from public.collections where user_id = 'user_demo' and id = 'trips'))))->0->>'status' = 'applied',
                  'U14 an existing collection can be deleted with its backfilled revision');
-- separate statement: a check inside the same SELECT would read the snapshot from before the push
select pg_temp.ok((select collection_id is null and rev = 13 from public.saves where user_id = 'user_demo' and id = 'prague-pasta'),
                  'U14 its existing save is detached with a new revision (13)');

-- Old app builds after the upgrade: can read, can no longer write directly (their writes fail loudly, nothing is erased)
select set_config('request.jwt.claims', '{"sub":"user_demo"}', false) \g /dev/null
select pg_temp.ok((select count(*) from public.saves) = 6, 'U15 an old client can still read its saves');
select pg_temp.fails($$insert into public.saves (user_id, id, url, title) values ('user_demo', 'new', 'https://n', 'n') on conflict (user_id, id) do update set title = excluded.title$$, '42501', 'U16 an old client''s upsert is refused');
select pg_temp.fails($$delete from public.saves where id = 'focus-playlist'$$, '42501', 'U17 an old client''s hard delete is refused');
select pg_temp.ok(not exists (select 1 from public.collections where id = 'trips'), 'U18 an old client does not see the deleted collection as a blank item');
reset role;
select pg_temp.ok(exists (select 1 from public.saves where user_id = 'user_demo' and id = 'focus-playlist'), 'U17 nothing was erased by the refused delete');
