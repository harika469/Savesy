-- Sync prototype tests. Run after 30. Every check asserts; any failure stops the run (non-zero exit).
\i docs/review/prototypes/05_assert.sql
\pset tuples_only on
create function pg_temp.push(u text, changes text) returns jsonb language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, false);
  return public.push_changes(changes::jsonb);
end $$;
-- Reads the head THROUGH get_sync_head() as user u (sync_heads itself is invisible to users under RLS).
create function pg_temp.head(u text) returns bigint language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, false);
  return public.get_sync_head();
end $$;
grant execute on function pg_temp.push(text, text), pg_temp.head(text) to public;
set role authenticated;

-- V: validation happens before any write
select pg_temp.fails($$select pg_temp.push('uA', '[{"table":"saves","id":"k","base_rev":0,"op":"deleet"}]')$$, '22023', 'V1 unknown op rejected');
select pg_temp.fails($$select pg_temp.push('uA', '[{"table":"saves","id":"k","op":"upsert","row":{"url":"https://a","title":"t"}}]')$$, '22023', 'V2 missing base_rev rejected');
select pg_temp.fails($$select pg_temp.push('uA', '[{"table":"saves","id":"k","base_rev":-1,"op":"upsert","row":{"url":"https://a","title":"t"}}]')$$, '22023', 'V3 negative base_rev rejected');
select pg_temp.fails($$select pg_temp.push('uA', '[{"table":"saves","id":"k","base_rev":0,"op":"upsert","row":{"url":"https://a","title":"t"},"extra":1}]')$$, '22023', 'V4 unknown change key rejected');
select pg_temp.fails($$select pg_temp.push('uA', '[{"table":"saves","id":"k","base_rev":0,"op":"upsert","row":{"url":"https://a","title":"t","user_id":"uB"}}]')$$, '22023', 'V5 user_id inside row rejected');
select pg_temp.fails($$select pg_temp.push('uA', '[{"table":"saves","id":"k","base_rev":0,"op":"upsert","row":{"url":"https://a","title":"t","rev":99}}]')$$, '22023', 'V6 rev inside row rejected');
select pg_temp.fails($$select pg_temp.push('uA', '[{"table":"saves","id":"k","base_rev":0,"op":"delete","row":{}}]')$$, '22023', 'V7 delete with a row rejected');
select pg_temp.fails($$select pg_temp.push('uA', '[{"table":"users","id":"k","base_rev":0,"op":"delete"}]')$$, '22023', 'V8 unknown table rejected');
select pg_temp.fails($$select pg_temp.push('uA', '[]')$$, '22023', 'V9 empty batch rejected');
select pg_temp.fails($$select pg_temp.push('uA', (select json_agg(json_build_object('table','saves','id','b'||g,'base_rev',0,'op','delete'))::text from generate_series(1,201) g))$$, '22023', 'V10 batch over 200 rejected');
select pg_temp.fails($$select pg_temp.push('uA', '{"table":"saves"}')$$, '22023', 'V11 non-array rejected');
select pg_temp.fails($$select pg_temp.push('uA', '[{"table":"saves","id":"ok1","base_rev":0,"op":"upsert","row":{"url":"https://a","title":"t"}},{"table":"saves","id":"bad","base_rev":0,"op":"nope"}]')$$, '22023', 'V12 one bad change rejects the batch');
select pg_temp.ok(pg_temp.head('uA') = 0 and not exists (select 1 from public.saves where id = 'ok1'), 'V12 nothing from the rejected batch was written');

-- P1-P3 conditional writes
select pg_temp.ok((pg_temp.push('uA', '[{"table":"saves","id":"s1","base_rev":0,"op":"upsert","row":{"url":"https://a.com","title":"v1"}}]'))->0->>'rev' = '1', 'P1 new save applied at rev 1');
select pg_temp.ok((pg_temp.push('uA', '[{"table":"saves","id":"s1","base_rev":1,"op":"upsert","row":{"url":"https://a.com","title":"edited on A"}}]'))->0->>'status' = 'applied', 'P2 phone A edit applied');
select pg_temp.ok((pg_temp.push('uA', '[{"table":"saves","id":"s1","base_rev":1,"op":"upsert","row":{"url":"https://a.com","title":"stale B","updated_at":"2099-01-01T00:00:00Z"}}]'))->0->>'status' = 'conflict', 'P2 stale push conflicts even with a future clock');
select pg_temp.ok((select title from public.saves where id = 's1') = 'edited on A', 'P2 server row not overwritten');
select pg_temp.ok((pg_temp.push('uA', '[{"table":"saves","id":"s1","base_rev":2,"op":"upsert","row":{"url":"https://a.com","title":"B after rebase"}}]'))->0->>'status' = 'applied', 'P3 rebased push applied');

-- P4 delete: tombstone scrubbed, late edit conflicts with the tombstone
select pg_temp.ok((pg_temp.push('uA', '[{"table":"saves","id":"s1","base_rev":3,"op":"delete"}]'))->0->>'status' = 'applied', 'P4 delete applied');
select pg_temp.ok((select deleted_at is not null and title = '' and url = '' and note is null and details is null from public.saves where id = 's1'), 'P4 tombstone content scrubbed');
select pg_temp.ok((pg_temp.push('uA', '[{"table":"saves","id":"s1","base_rev":3,"op":"upsert","row":{"url":"https://a.com","title":"resurrect?"}}]'))->0 #>> '{server,deleted_at}' is not null, 'P4 late edit gets a conflict carrying the tombstone');

-- P9 delete of an id the server never had: no-op, no revision used
select pg_temp.ok((pg_temp.push('uA', '[{"table":"saves","id":"never","base_rev":0,"op":"delete"}]'))->0->>'status' = 'noop' and pg_temp.head('uA') = 4, 'P9 unknown delete is a no-op and the head stays at 4');

-- P6 direct writes refused
select set_config('request.jwt.claims', '{"sub":"uA"}', false) \g /dev/null
select pg_temp.fails($$insert into public.saves (id, url, title) values ('x', 'https://x', 'direct')$$, '42501', 'P6 direct insert refused by RLS');
update public.saves set title = 'direct' where id = 's1';
select pg_temp.ok((select title from public.saves where id = 's1') = '', 'P6 direct update changes nothing');

-- P7 isolation: same id under another user is a separate row; neither can see or change the other
select pg_temp.ok((pg_temp.push('uB', '[{"table":"saves","id":"s2","base_rev":0,"op":"upsert","row":{"url":"https://b.com","title":"uB s2"}}]'))->0->>'status' = 'applied', 'P7 uB creates s2');
select pg_temp.ok((pg_temp.push('uA', '[{"table":"saves","id":"s2","base_rev":0,"op":"upsert","row":{"url":"https://a.com","title":"uA s2"}}]'))->0->>'status' = 'applied', 'P7 uA creates its own s2 (ids are per user)');
select pg_temp.ok((pg_temp.push('uB', '[{"table":"saves","id":"s2","base_rev":5,"op":"delete"}]'))->0->>'status' = 'conflict', 'P7 uB pushing with uA''s revision number only conflicts against uB''s own row');
select set_config('request.jwt.claims', '{"sub":"uB"}', false) \g /dev/null
select pg_temp.ok((select count(*) from public.saves) = 1 and (select title from public.saves) = 'uB s2' and public.get_sync_head() = 1, 'P7 uB sees only its own row and its own head');
reset role;
select pg_temp.ok((select title from public.saves where user_id = 'uA' and id = 's2') = 'uA s2', 'P7 uA''s s2 untouched by uB');
set role authenticated;

-- P10 collection delete detaches its saves (each with a new revision); saves can't point at a deleted collection
select pg_temp.ok(jsonb_array_length(pg_temp.push('uC', '[{"table":"collections","id":"col","base_rev":0,"op":"upsert","row":{"name":"Trips"}},{"table":"saves","id":"a","base_rev":0,"op":"upsert","row":{"url":"https://a","title":"a","collection_id":"col"}},{"table":"saves","id":"b","base_rev":0,"op":"upsert","row":{"url":"https://b","title":"b","collection_id":"col"}}]')) = 3, 'P10 setup');
select pg_temp.ok((pg_temp.push('uC', '[{"table":"collections","id":"col","base_rev":1,"op":"delete"}]'))->0->>'status' = 'applied', 'P10 collection deleted');
reset role;
select pg_temp.ok((select bool_and(collection_id is null and rev > 4) from public.saves where user_id = 'uC'), 'P10 both saves detached with revisions after the delete');
select pg_temp.ok(pg_temp.head('uC') = 6, 'P10 head = 6 (3 writes + delete + 2 detaches)');
set role authenticated;
select pg_temp.ok((pg_temp.push('uC', '[{"table":"saves","id":"c","base_rev":0,"op":"upsert","row":{"url":"https://c","title":"c","collection_id":"col"}}]'))->0 #> '{server,collection_id}' = 'null'::jsonb, 'P10 a save pointing at a deleted collection is stored without it, and the client is told');

-- P11 consistent pull: read head, page each table with rev in (cursor, head]; writes after the head wait for the next round
select pg_temp.ok(jsonb_array_length(pg_temp.push('uP', (select json_agg(json_build_object('table','saves','id','p'||g,'base_rev',0,'op','upsert','row',json_build_object('url','https://p/'||g,'title','p'||g)))::text from generate_series(1,5) g))) = 5, 'P11 five saves');
select set_config('request.jwt.claims', '{"sub":"uP"}', false) \g /dev/null
select set_config('test.h1', public.get_sync_head()::text, false) \g /dev/null
-- another device writes while this one is paging
select pg_temp.ok((pg_temp.push('uP', '[{"table":"collections","id":"late","base_rev":0,"op":"upsert","row":{"name":"Late"}},{"table":"saves","id":"p1","base_rev":1,"op":"upsert","row":{"url":"https://p/1","title":"p1 edited"}}]'))->1->>'status' = 'applied', 'P11 concurrent writes land after the head');
select set_config('request.jwt.claims', '{"sub":"uP"}', false) \g /dev/null
-- Round 1 pages by cursor within (0, head]: p1 moved past the head when it was edited, so it is not in this round.
select pg_temp.ok(
  (select string_agg(id, ',' order by rev) from (select id, rev from public.saves where rev > 0 and rev <= current_setting('test.h1')::bigint order by rev limit 2) pg) = 'p2,p3'
  and (select string_agg(id, ',' order by rev) from (select id, rev from public.saves where rev > 3 and rev <= current_setting('test.h1')::bigint order by rev limit 2) pg) = 'p4,p5'
  and not exists (select 1 from public.saves where rev > 5 and rev <= current_setting('test.h1')::bigint)
  and not exists (select 1 from public.collections where rev > 0 and rev <= current_setting('test.h1')::bigint),
  'P11 round 1: pages p2,p3 then p4,p5 at stable boundaries; nothing written after the head appears');
-- Round 2 from the old head brings the latest p1 and the late collection: nothing is lost, nothing is seen twice.
select pg_temp.ok(
  (select string_agg(id || ':' || title, ',') from public.saves where rev > current_setting('test.h1')::bigint and rev <= public.get_sync_head()) = 'p1:p1 edited'
  and (select string_agg(id, ',') from public.collections where rev > current_setting('test.h1')::bigint and rev <= public.get_sync_head()) = 'late',
  'P11 round 2: the edited p1 and the late collection arrive in the next round');

-- anon cannot push
reset role; set role anon;
select pg_temp.fails($$select public.push_changes('[{"table":"saves","id":"z","base_rev":0,"op":"delete"}]')$$, '42501', 'P12 anon cannot push');
reset role;
