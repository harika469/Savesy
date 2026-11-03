-- Sync foundation (migration 20261106000000): validation, conditional writes, tombstones, pulls, purge, grants.
\i supabase/tests/assert.sql
\pset tuples_only on
create function pg_temp.push(u text, changes text) returns jsonb language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, false);
  return public.push_changes(changes::jsonb);
end $$;
create function pg_temp.pull(u text, since bigint, lim integer default 500, full_ boolean default false) returns jsonb language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, false);
  return public.pull_changes(since, lim, full_);
end $$;
create function pg_temp.head(u text) returns bigint language plpgsql as $$
begin return (pg_temp.pull(u, 0, 1))->>'head'; end $$;
create function pg_temp.ids(page jsonb) returns text language sql as $$
  select coalesce(string_agg(c->'row'->>'id', ',' order by (c->'row'->>'rev')::bigint), '') from jsonb_array_elements(page->'changes') c $$;
grant execute on function pg_temp.push(text, text), pg_temp.pull(text, bigint, integer, boolean), pg_temp.head(text), pg_temp.ids(jsonb) to public;

-- Grants
select pg_temp.ok(has_function_privilege('authenticated', 'public.push_changes(jsonb)', 'execute') and has_function_privilege('authenticated', 'public.pull_changes(bigint,integer,boolean)', 'execute'), 'G1 authenticated can push and pull');
select pg_temp.ok(not has_function_privilege('anon', 'public.push_changes(jsonb)', 'execute') and not has_function_privilege('anon', 'public.pull_changes(bigint,integer,boolean)', 'execute'), 'G2 anon cannot push or pull');
select pg_temp.ok(not has_function_privilege('authenticated', 'public.purge_tombstones(interval)', 'execute') and has_function_privilege('service_role', 'public.purge_tombstones(interval)', 'execute'), 'G3 purge is server-only');
select pg_temp.ok(not has_table_privilege('authenticated', 'public.saves', 'insert') and not has_table_privilege('authenticated', 'public.saves', 'update')
                  and not has_table_privilege('authenticated', 'public.saves', 'delete') and not has_table_privilege('authenticated', 'public.collections', 'delete'), 'G4 clients cannot write the tables directly');

set role authenticated;

-- A0: a request without a user (no subject, or an empty one) is refused before anything is read or written
select pg_temp.fails($$select pg_temp.pull('', 0)$$, '28000', 'A0 an empty subject cannot pull');
select pg_temp.fails($$select pg_temp.push('', '[{"table":"saves","id":"k","base_rev":0,"op":"upsert","row":{"url":"https://x","title":"x"}}]')$$, '28000', 'A0 an empty subject cannot push');
select set_config('request.jwt.claims', '{"role":"authenticated"}', false) \g /dev/null
select pg_temp.fails($$select public.pull_changes(0)$$, '28000', 'A0 no subject cannot pull');

-- V: validation happens before any write
select pg_temp.fails($$select pg_temp.push('uA', '[{"table":"saves","id":"k","base_rev":0,"op":"deleet"}]')$$, '22023', 'V1 unknown op rejected');
select pg_temp.fails($$select pg_temp.push('uA', '[{"table":"saves","id":"k","op":"upsert","row":{"url":"https://a","title":"t"}}]')$$, '22023', 'V2 missing base_rev rejected');
select pg_temp.fails($$select pg_temp.push('uA', '[{"table":"saves","id":"k","base_rev":-1,"op":"upsert","row":{"url":"https://a","title":"t"}}]')$$, '22023', 'V3 negative base_rev rejected');
select pg_temp.fails($$select pg_temp.push('uA', '[{"table":"saves","id":"k","base_rev":1.5,"op":"upsert","row":{"url":"https://a","title":"t"}}]')$$, '22023', 'V3b fractional base_rev rejected');
select pg_temp.fails($$select pg_temp.push('uA', '[{"table":"saves","id":"k","base_rev":0,"op":"upsert","row":{"url":"https://a","title":"t"},"extra":1}]')$$, '22023', 'V4 unknown change key rejected');
select pg_temp.fails($$select pg_temp.push('uA', '[{"table":"saves","id":"k","base_rev":0,"op":"upsert","row":{"url":"https://a","title":"t","user_id":"uB"}}]')$$, '22023', 'V5 user_id inside row rejected');
select pg_temp.fails($$select pg_temp.push('uA', '[{"table":"saves","id":"k","base_rev":0,"op":"upsert","row":{"url":"https://a","title":"t","rev":99}}]')$$, '22023', 'V6 rev inside row rejected');
select pg_temp.fails($$select pg_temp.push('uA', '[{"table":"saves","id":"k","base_rev":0,"op":"upsert","row":{"url":"https://a","title":"t","deleted_at":"2020-01-01"}}]')$$, '22023', 'V6b deleted_at inside row rejected');
select pg_temp.fails($$select pg_temp.push('uA', '[{"table":"saves","id":"k","base_rev":0,"op":"delete","row":{}}]')$$, '22023', 'V7 delete with a row rejected');
select pg_temp.fails($$select pg_temp.push('uA', '[{"table":"users","id":"k","base_rev":0,"op":"delete"}]')$$, '22023', 'V8 unknown table rejected');
select pg_temp.fails($$select pg_temp.push('uA', '[{"table":"saves","id":"","base_rev":0,"op":"delete"}]')$$, '22023', 'V8b empty id rejected');
select pg_temp.fails($$select pg_temp.push('uA', '[{"table":"saves","id":"k","base_rev":0,"op":"upsert","row":{"url":"","title":"t"}}]')$$, '22023', 'V8c save without url rejected');
select pg_temp.fails($$select pg_temp.push('uA', '[]')$$, '22023', 'V9 empty batch rejected');
select pg_temp.fails($$select pg_temp.push('uA', (select json_agg(json_build_object('table','saves','id','b'||g,'base_rev',0,'op','delete'))::text from generate_series(1,201) g))$$, '22023', 'V10 batch over 200 rejected');
select pg_temp.fails($$select pg_temp.push('uA', '{"table":"saves"}')$$, '22023', 'V11 non-array rejected');
select pg_temp.fails($$select pg_temp.push('uA', '[{"table":"saves","id":"ok1","base_rev":0,"op":"upsert","row":{"url":"https://a","title":"t"}},{"table":"saves","id":"bad","base_rev":0,"op":"nope"}]')$$, '22023', 'V12 one bad change rejects the batch');
select pg_temp.ok(pg_temp.head('uA') = 0 and (pg_temp.pull('uA', 0))->'changes' = '[]'::jsonb, 'V12 nothing from the rejected batch was written');

-- P1-P3 conditional writes
select pg_temp.ok((pg_temp.push('uA', '[{"table":"saves","id":"s1","base_rev":0,"op":"upsert","row":{"url":"https://a.com","title":"v1"}}]'))->0->>'rev' = '1', 'P1 new save applied at rev 1');
select pg_temp.ok((pg_temp.push('uA', '[{"table":"saves","id":"s1","base_rev":1,"op":"upsert","row":{"url":"https://a.com","title":"edited on A"}}]'))->0->>'status' = 'applied', 'P2 phone A edit applied');
select pg_temp.ok((pg_temp.push('uA', '[{"table":"saves","id":"s1","base_rev":1,"op":"upsert","row":{"url":"https://a.com","title":"stale B","updated_at":"2099-01-01T00:00:00Z"}}]'))->0->>'status' = 'conflict', 'P2 stale push conflicts even with a future clock');
select pg_temp.ok((pg_temp.push('uA', '[{"table":"saves","id":"s1","base_rev":1,"op":"upsert","row":{"url":"https://a.com","title":"stale B"}}]'))->0 #>> '{server,title}' = 'edited on A', 'P2 the conflict carries the server row');
select pg_temp.ok((pg_temp.push('uA', '[{"table":"saves","id":"s1","base_rev":2,"op":"upsert","row":{"url":"https://a.com","title":"B after rebase"}}]'))->0->>'status' = 'applied', 'P3 rebased push applied');
select pg_temp.ok((pg_temp.push('uA', '[{"table":"saves","id":"s9","base_rev":0,"op":"upsert","row":{"url":"https://a.com","title":"x"}}]'))->0 #> '{server}' ? 'user_id' = false, 'P3b responses never include user_id');

-- P4 delete: tombstone scrubbed, late edit conflicts with the tombstone
select pg_temp.ok((pg_temp.push('uA', '[{"table":"saves","id":"s1","base_rev":3,"op":"delete"}]'))->0->>'status' = 'applied', 'P4 delete applied');
reset role;
select pg_temp.ok((select deleted_at is not null and title = '' and url = '' and note is null and details is null and tags = '{}' from public.saves where user_id = 'uA' and id = 's1'), 'P4 tombstone content scrubbed');
set role authenticated;
select pg_temp.ok((pg_temp.push('uA', '[{"table":"saves","id":"s1","base_rev":3,"op":"upsert","row":{"url":"https://a.com","title":"resurrect?"}}]'))->0 #>> '{server,deleted_at}' is not null, 'P4 late edit gets a conflict carrying the tombstone');
select pg_temp.ok((pg_temp.push('uA', '[{"table":"saves","id":"s1","base_rev":5,"op":"upsert","row":{"url":"https://a.com","title":"silently undo?"}}]'))->0->>'status' = 'conflict', 'P4b an ordinary upsert at the tombstone''s revision cannot undo a delete (conflict)');
select set_config('test.h', pg_temp.head('uA')::text, false) \g /dev/null
select pg_temp.ok((pg_temp.push('uA', '[{"table":"saves","id":"s1","base_rev":5,"op":"delete"}]'))->0->>'status' = 'noop' and pg_temp.head('uA') = current_setting('test.h')::bigint, 'P4d deleting an already-deleted row (e.g. a retried request) is a noop and uses no revision');
select pg_temp.ok((pg_temp.push('uA', '[{"table":"saves","id":"s1","base_rev":4,"op":"delete"}]'))->0 #>> '{server,deleted_at}' is not null, 'P4e a delete replayed with the pre-delete revision gets a conflict carrying the tombstone');
select pg_temp.ok((pg_temp.push('uA', '[{"table":"saves","id":"s1","base_rev":5,"op":"restore","row":{"url":"https://a.com","title":"restored on purpose"}}]'))->0 #>> '{server,title}' = 'restored on purpose', 'P4f an explicit restore brings the deleted save back');
reset role;
select pg_temp.ok((select deleted_at is null and title = 'restored on purpose' from public.saves where user_id = 'uA' and id = 's1'), 'P4f the restored row is live');
set role authenticated;
select pg_temp.ok((pg_temp.push('uA', '[{"table":"saves","id":"s1","base_rev":6,"op":"restore","row":{"url":"https://a.com","title":"x"}}]'))->0->>'status' = 'conflict', 'P4g restore on a live row is a conflict');
select pg_temp.fails($$select pg_temp.push('uA', '[{"table":"saves","id":"s1","base_rev":6,"op":"restore"}]')$$, '22023', 'P4h restore without a row is rejected');

-- P4c tombstones are invisible to direct reads (older app builds) but delivered by pull_changes
select set_config('request.jwt.claims', '{"sub":"uA"}', false) \g /dev/null
select pg_temp.ok((pg_temp.push('uA', '[{"table":"saves","id":"gone","base_rev":0,"op":"upsert","row":{"url":"https://g","title":"gone"}}]'))->0->>'status' = 'applied', 'P4c setup');
select set_config('test.gone', (pg_temp.pull('uA', 0))->>'head', false) \g /dev/null
select pg_temp.ok((pg_temp.push('uA', format('[{"table":"saves","id":"gone","base_rev":%s,"op":"delete"}]', current_setting('test.gone'))))->0->>'status' = 'applied', 'P4c deleted');
select set_config('request.jwt.claims', '{"sub":"uA"}', false) \g /dev/null
select pg_temp.ok(not exists (select 1 from public.saves where id = 'gone'), 'P4c a direct read (older app) does not see the tombstone');
select pg_temp.ok((pg_temp.pull('uA', current_setting('test.gone')::bigint))->'changes' @> '[{"table":"saves","row":{"id":"gone"}}]'::jsonb, 'P4c pull_changes delivers the tombstone');

-- P9 delete of an id the server never had
select set_config('test.h', pg_temp.head('uA')::text, false) \g /dev/null
select pg_temp.ok((pg_temp.push('uA', '[{"table":"saves","id":"never","base_rev":0,"op":"delete"}]'))->0->>'status' = 'noop' and pg_temp.head('uA') = current_setting('test.h')::bigint, 'P9 unknown delete is a no-op and uses no revision');
select pg_temp.ok((pg_temp.push('uA', '[{"table":"saves","id":"never","base_rev":3,"op":"delete"}]'))->0->>'status' = 'conflict', 'P9b unknown delete with a non-zero base is a conflict');

-- P6 direct writes refused
select set_config('request.jwt.claims', '{"sub":"uA"}', false) \g /dev/null
select pg_temp.fails($$insert into public.saves (id, url, title) values ('x', 'https://x', 'direct')$$, '42501', 'P6 direct insert refused');
select pg_temp.fails($$update public.saves set title = 'direct' where id = 's1'$$, '42501', 'P6 direct update refused');
select pg_temp.fails($$delete from public.saves where id = 's1'$$, '42501', 'P6 direct delete refused (old-client hard deletes can no longer erase data)');

-- P7 isolation
select pg_temp.ok((pg_temp.push('uB', '[{"table":"saves","id":"s2","base_rev":0,"op":"upsert","row":{"url":"https://b.com","title":"uB s2"}}]'))->0->>'status' = 'applied', 'P7 uB creates s2');
select pg_temp.ok((pg_temp.push('uA', '[{"table":"saves","id":"s2","base_rev":0,"op":"upsert","row":{"url":"https://a.com","title":"uA s2"}}]'))->0->>'status' = 'applied', 'P7 uA creates its own s2 (ids are per user)');
select pg_temp.ok(pg_temp.ids(pg_temp.pull('uB', 0)) = 's2' and (pg_temp.pull('uB', 0))->'changes'->0 #>> '{row,title}' = 'uB s2' and pg_temp.head('uB') = 1, 'P7 uB pulls only its own row and head');
select set_config('request.jwt.claims', '{"sub":"uB"}', false) \g /dev/null
select pg_temp.ok((select count(*) from public.saves) = 1, 'P7 RLS: uB reads only its own rows directly');
reset role;
select pg_temp.ok((select title from public.saves where user_id = 'uA' and id = 's2') = 'uA s2', 'P7 uA''s s2 untouched by uB');
set role authenticated;

-- P10 collection delete detaches saves; saves can't point at a deleted or foreign collection
select pg_temp.ok(jsonb_array_length(pg_temp.push('uC', '[{"table":"collections","id":"col","base_rev":0,"op":"upsert","row":{"name":"Trips"}},{"table":"saves","id":"a","base_rev":0,"op":"upsert","row":{"url":"https://a","title":"a","collection_id":"col"}},{"table":"saves","id":"b","base_rev":0,"op":"upsert","row":{"url":"https://b","title":"b","collection_id":"col"}}]')) = 3, 'P10 setup');
select pg_temp.ok((pg_temp.push('uC', '[{"table":"collections","id":"col","base_rev":1,"op":"delete"}]'))->0->>'status' = 'applied', 'P10 collection deleted');
select pg_temp.ok(pg_temp.ids(pg_temp.pull('uC', 4)) = 'a,b' and (select bool_and(c #>> '{row,collection_id}' is null) from jsonb_array_elements((pg_temp.pull('uC', 4))->'changes') c), 'P10 both saves detached, each with a new revision after the delete');
select pg_temp.ok((pg_temp.push('uC', '[{"table":"saves","id":"c","base_rev":0,"op":"upsert","row":{"url":"https://c","title":"c","collection_id":"col"}}]'))->0 #> '{server,collection_id}' = 'null'::jsonb, 'P10 a save pointing at a deleted collection is stored without it');
select pg_temp.ok((pg_temp.push('uC', '[{"table":"saves","id":"d","base_rev":0,"op":"upsert","row":{"url":"https://d","title":"d","collection_id":"trips_of_uA"}}]'))->0 #> '{server,collection_id}' = 'null'::jsonb, 'P10b a save cannot point at a collection the user does not have');

-- P11 pulls: keyset paging stays complete while another device writes between pages (ChatGPT review of #3, blocker 1)
-- Setup: p1..p6 (revs 1-6), collection c1 (7), q1, q2 in c1 (8, 9).
select pg_temp.ok(jsonb_array_length(pg_temp.push('uP', (select json_agg(json_build_object('table','saves','id','p'||g,'base_rev',0,'op','upsert','row',json_build_object('url','https://p/'||g,'title','p'||g)))::text from generate_series(1,6) g))) = 6, 'P11 setup: six saves');
select pg_temp.ok(jsonb_array_length(pg_temp.push('uP', '[{"table":"collections","id":"c1","base_rev":0,"op":"upsert","row":{"name":"C1"}},{"table":"saves","id":"q1","base_rev":0,"op":"upsert","row":{"url":"https://q/1","title":"q1","collection_id":"c1"}},{"table":"saves","id":"q2","base_rev":0,"op":"upsert","row":{"url":"https://q/2","title":"q2","collection_id":"c1"}}]')) = 3, 'P11 setup: a collection with two saves');
create temp table delivered (tbl text, id text, rev bigint, row jsonb);
grant all on delivered to public;
do $$
declare cursor_rev bigint := 0; page jsonb; pages int := 0;
begin
  loop
    page := pg_temp.pull('uP', cursor_rev, 3);
    insert into delivered select c->>'table', c->'row'->>'id', (c->'row'->>'rev')::bigint, c->'row' from jsonb_array_elements(page->'changes') c;
    cursor_rev := (page->>'next_cursor')::bigint; pages := pages + 1;
    if pages = 1 then
      -- Another device, between page 1 and page 2: edit a row not yet delivered (p5), delete one (p4),
      -- delete the collection (detaching q1, q2), and edit a row already delivered (p2).
      perform pg_temp.push('uP', '[{"table":"saves","id":"p5","base_rev":5,"op":"upsert","row":{"url":"https://p/5","title":"p5 edited mid-download"}}]');
      perform pg_temp.push('uP', '[{"table":"saves","id":"p4","base_rev":4,"op":"delete"}]');
      perform pg_temp.push('uP', '[{"table":"collections","id":"c1","base_rev":7,"op":"delete"}]');
      perform pg_temp.push('uP', '[{"table":"saves","id":"p2","base_rev":2,"op":"upsert","row":{"url":"https://p/2","title":"p2 edited after delivery"}}]');
    end if;
    exit when (page->>'more')::boolean = false;
    if pages > 20 then raise exception 'paging did not finish'; end if;
  end loop;
  perform set_config('test.pages', pages::text, false);
end $$;
reset role;
create temp view server_now as
  select 'saves' as tbl, id, rev from public.saves where user_id = 'uP' union all select 'collections', id, rev from public.collections where user_id = 'uP';
select pg_temp.ok(not exists (select 1 from server_now s where not exists (select 1 from delivered d where d.tbl = s.tbl and d.id = s.id and d.rev = s.rev)),
                  'P11 every row the server holds now was delivered at its CURRENT revision (nothing missed)');
select pg_temp.ok((select row->>'title' from delivered where id = 'p5' order by rev desc limit 1) = 'p5 edited mid-download', 'P11 the row edited before it was paged arrives with the new content');
select pg_temp.ok((select row->>'deleted_at' is not null from delivered where id = 'p4' order by rev desc limit 1), 'P11 the row deleted before it was paged arrives as a tombstone');
select pg_temp.ok((select bool_and(row->>'collection_id' is null) from (select distinct on (id) row from delivered where id in ('q1','q2') order by id, rev desc) x)
                  and (select row->>'deleted_at' is not null from delivered where id = 'c1' order by rev desc limit 1), 'P11 the deleted collection and both detached saves arrive');
select pg_temp.ok((select count(*) from delivered where id = 'p2') = 2 and (select row->>'title' from delivered where id = 'p2' order by rev desc limit 1) = 'p2 edited after delivery', 'P11 a row edited after delivery is delivered again with the new content');
select pg_temp.ok((select count(*) = count(distinct (tbl, id, rev)) from delivered), 'P11 no row version was delivered twice');
select set_config('test.total', (select count(*) from server_now)::text, false) \g /dev/null
set role authenticated;
select pg_temp.ok(jsonb_array_length((pg_temp.pull('uP', 0, 9999))->'changes') = current_setting('test.total')::int, 'P11 the page size is capped at 500 (asked for 9999, got all rows)');
select pg_temp.fails($$select pg_temp.pull('uP', -1)$$, '22023', 'P11 a negative cursor is rejected');
select pg_temp.ok((pg_temp.pull('uZ', 0))->>'head' = '0' and (pg_temp.pull('uZ', 0))->'changes' = '[]'::jsonb and (pg_temp.pull('uZ', 0))->>'more' = 'false', 'P11 a brand-new user pulls an empty stream');

-- P12 anon
reset role; set role anon;
select pg_temp.fails($$select public.push_changes('[{"table":"saves","id":"z","base_rev":0,"op":"delete"}]')$$, '42501', 'P12 anon cannot push');
select pg_temp.fails($$select public.pull_changes(0)$$, '42501', 'P12 anon cannot pull');
reset role;

-- R: tombstone retention and resync
set role authenticated;
select pg_temp.ok(jsonb_array_length(pg_temp.push('uT', '[{"table":"saves","id":"t1","base_rev":0,"op":"upsert","row":{"url":"https://t","title":"t1"}},{"table":"saves","id":"t2","base_rev":0,"op":"upsert","row":{"url":"https://t","title":"t2"}}]')) = 2, 'R setup');
select pg_temp.ok((pg_temp.push('uT', '[{"table":"saves","id":"t1","base_rev":1,"op":"delete"}]'))->0->>'rev' = '3', 'R t1 deleted at rev 3');
reset role;
update public.saves set deleted_at = now() - interval '100 days' where user_id = 'uT' and id = 't1';
set role authenticated;
select pg_temp.fails($$select public.purge_tombstones('90 days')$$, '42501', 'R clients cannot purge');
reset role; set role service_role;
select pg_temp.fails($$select public.purge_tombstones('1 day')$$, '22023', 'R retention below 7 days refused');
select pg_temp.ok(public.purge_tombstones('90 days') = 1, 'R one old tombstone purged');
reset role;
select pg_temp.ok(not exists (select 1 from public.saves where user_id = 'uT' and id = 't1') and exists (select 1 from public.saves where user_id = 'uT' and id = 't2'), 'R only the tombstone was removed');
set role authenticated;
select pg_temp.ok((pg_temp.pull('uT', 1))->>'resync' = 'true', 'R a device whose cursor (1) is below the floor (3) is told to resync');
select pg_temp.ok((pg_temp.pull('uT', 0))->>'resync' = 'false' and pg_temp.ids(pg_temp.pull('uT', 0)) = 't2', 'R a full re-download from 0 works');
select pg_temp.ok((pg_temp.pull('uT', 3))->>'resync' = 'false', 'R a device at or above the floor continues normally');
-- R2: a purge between two pages of a download (ChatGPT review of #3, blocker 2)
select pg_temp.ok(jsonb_array_length(pg_temp.push('uQ', '[{"table":"saves","id":"r1","base_rev":0,"op":"upsert","row":{"url":"https://r","title":"r1"}},{"table":"saves","id":"r2","base_rev":0,"op":"upsert","row":{"url":"https://r","title":"r2"}},{"table":"saves","id":"r3","base_rev":0,"op":"upsert","row":{"url":"https://r","title":"r3"}}]')) = 3, 'R2 setup');
select pg_temp.ok((pg_temp.push('uQ', '[{"table":"saves","id":"r3","base_rev":3,"op":"delete"}]'))->0->>'rev' = '4', 'R2 r3 deleted at rev 4');
select set_config('test.p1', (pg_temp.pull('uQ', 0, 1))->>'next_cursor', false) \g /dev/null
reset role;
update public.saves set deleted_at = now() - interval '100 days' where user_id = 'uQ' and id = 'r3';
set role service_role; select public.purge_tombstones('90 days') \g /dev/null
reset role; set role authenticated;
select pg_temp.ok(current_setting('test.p1') = '1' and (pg_temp.pull('uQ', current_setting('test.p1')::bigint, 1))->>'resync' = 'true',
                  'R2 the device''s next page (cursor 1 < floor 4) is told to resync, so it cannot miss the purged deletion');
-- R3: a FULL download from 0 must page past the floor (found by the B2 engine test: without p_full a re-download
-- could never get beyond page 1 after any purge)
select set_config('test.c', '0', false) \g /dev/null
do $$
declare page jsonb; pages int := 0; got text := '';
begin
  loop
    page := pg_temp.pull('uQ', current_setting('test.c')::bigint, 1, true);
    if (page->>'resync')::boolean then raise exception 'full download was told to resync on page %', pages + 1; end if;
    got := got || coalesce((select string_agg(c->'row'->>'id', ',') from jsonb_array_elements(page->'changes') c), '') || ';';
    perform set_config('test.c', page->>'next_cursor', false); pages := pages + 1;
    exit when (page->>'more')::boolean = false;
    if pages > 10 then raise exception 'did not finish'; end if;
  end loop;
  perform set_config('test.got', got, false);
end $$;
select pg_temp.ok(current_setting('test.got') = 'r1;r2;', 'R3 a full download pages past the floor (pages: r1, r2) and the purged r3 is simply absent');
select pg_temp.ok((pg_temp.pull('uQ', 1, 1, false))->>'resync' = 'true', 'R3 the same cursor in an incremental pull is still told to resync');
-- R4: the last page's cursor is the head, so after that download incremental pulls work (no re-download loop;
-- found by the B3 end-to-end tests: r3, the newest revision, was a purged tombstone above r2).
select pg_temp.ok((pg_temp.pull('uQ', 1, 1, true))->>'next_cursor' = '4' and (pg_temp.pull('uQ', 1, 1, true))->>'more' = 'false',
  'R4 the last page of a full download ends at the head (4), past the purged r3');
select pg_temp.ok((pg_temp.pull('uQ', 4, 1, false))->>'resync' = 'false', 'R4 an incremental pull from there is not told to resync');
select pg_temp.ok((pg_temp.pull('uQ', 0, 1, true))->>'next_cursor' = '1', 'R4 a page with more rows after it still ends at its last row');
reset role;
