-- Sync foundation (migration 20261106000000): validation, conditional writes, tombstones, pulls, purge, grants.
\i supabase/tests/assert.sql
\pset tuples_only on
create function pg_temp.push(u text, changes text) returns jsonb language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, false);
  return public.push_changes(changes::jsonb);
end $$;
create function pg_temp.pull(u text, since bigint, head bigint default null, lim integer default 500) returns jsonb language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, false);
  return public.pull_changes(since, head, lim);
end $$;
create function pg_temp.head(u text) returns bigint language plpgsql as $$
begin return (pg_temp.pull(u, 0, null, 1))->>'head'; end $$;
create function pg_temp.ids(page jsonb) returns text language sql as $$
  select coalesce(string_agg(c->'row'->>'id', ',' order by (c->'row'->>'rev')::bigint), '') from jsonb_array_elements(page->'changes') c $$;
grant execute on function pg_temp.push(text, text), pg_temp.pull(text, bigint, bigint, integer), pg_temp.head(text), pg_temp.ids(jsonb) to public;

-- Grants
select pg_temp.ok(has_function_privilege('authenticated', 'public.push_changes(jsonb)', 'execute') and has_function_privilege('authenticated', 'public.pull_changes(bigint,bigint,integer)', 'execute'), 'G1 authenticated can push and pull');
select pg_temp.ok(not has_function_privilege('anon', 'public.push_changes(jsonb)', 'execute') and not has_function_privilege('anon', 'public.pull_changes(bigint,bigint,integer)', 'execute'), 'G2 anon cannot push or pull');
select pg_temp.ok(not has_function_privilege('authenticated', 'public.purge_tombstones(interval)', 'execute') and has_function_privilege('service_role', 'public.purge_tombstones(interval)', 'execute'), 'G3 purge is server-only');
select pg_temp.ok(not has_table_privilege('authenticated', 'public.saves', 'insert') and not has_table_privilege('authenticated', 'public.saves', 'update')
                  and not has_table_privilege('authenticated', 'public.saves', 'delete') and not has_table_privilege('authenticated', 'public.collections', 'delete'), 'G4 clients cannot write the tables directly');

set role authenticated;

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
select pg_temp.ok((pg_temp.push('uA', '[{"table":"saves","id":"s1","base_rev":5,"op":"upsert","row":{"url":"https://a.com","title":"restored on purpose"}}]'))->0->>'status' = 'applied', 'P4b an edit made on top of the tombstone (base = its rev) restores the save deliberately');

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

-- P11 pulls: one ordered stream across tables, pinned head, stable pages, nothing lost or repeated
select pg_temp.ok(jsonb_array_length(pg_temp.push('uP', (select json_agg(json_build_object('table','saves','id','p'||g,'base_rev',0,'op','upsert','row',json_build_object('url','https://p/'||g,'title','p'||g)))::text from generate_series(1,5) g))) = 5, 'P11 five saves');
select pg_temp.ok((pg_temp.push('uP', '[{"table":"collections","id":"c1","base_rev":0,"op":"upsert","row":{"name":"C1"}}]'))->0->>'rev' = '6', 'P11 a collection at rev 6');
select set_config('test.h1', pg_temp.head('uP')::text, false) \g /dev/null
-- another device writes while this one is paging
select pg_temp.ok((pg_temp.push('uP', '[{"table":"collections","id":"late","base_rev":0,"op":"upsert","row":{"name":"Late"}},{"table":"saves","id":"p1","base_rev":1,"op":"upsert","row":{"url":"https://p/1","title":"p1 edited"}}]'))->1->>'status' = 'applied', 'P11 concurrent writes land after the pinned head');
select pg_temp.ok(
  pg_temp.ids(pg_temp.pull('uP', 0, current_setting('test.h1')::bigint, 2)) = 'p2,p3'
  and pg_temp.ids(pg_temp.pull('uP', 3, current_setting('test.h1')::bigint, 2)) = 'p4,p5'
  and pg_temp.ids(pg_temp.pull('uP', 5, current_setting('test.h1')::bigint, 2)) = 'c1'
  and (pg_temp.pull('uP', 5, current_setting('test.h1')::bigint, 2))->>'more' = 'false'
  and (pg_temp.pull('uP', 3, current_setting('test.h1')::bigint, 2))->>'more' = 'true',
  'P11 round 1: pages p2,p3 / p4,p5 / c1 across both tables, more flags correct, later writes excluded');
select pg_temp.ok(pg_temp.ids(pg_temp.pull('uP', current_setting('test.h1')::bigint)) = 'late,p1', 'P11 round 2 from the old head brings the late collection and the edited p1');
select pg_temp.ok((pg_temp.pull('uP', 0, null, 9999))->'changes' is not null and jsonb_array_length((pg_temp.pull('uP', 0, null, 9999))->'changes') = 7, 'P11 the page size is capped at 500 (asked for 9999, got all 7)');
select pg_temp.fails($$select pg_temp.pull('uP', 0, 999)$$, '22023', 'P11 a head beyond the server head is rejected');
select pg_temp.fails($$select pg_temp.pull('uP', -1)$$, '22023', 'P11 a negative cursor is rejected');
select pg_temp.ok((pg_temp.pull('uZ', 0))->>'head' = '0' and (pg_temp.pull('uZ', 0))->'changes' = '[]'::jsonb, 'P11 a brand-new user pulls an empty stream');

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
reset role;
