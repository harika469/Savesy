\set ON_ERROR_STOP off
set role authenticated; set request.jwt.claims = '{"sub":"uA"}';
\echo '== P1 new save (base 0) applies at rev 1'
select push_changes('[{"table":"saves","id":"s1","base_rev":0,"op":"upsert","row":{"url":"https://a.com","title":"v1"}}]');
\echo '== P2 phone A edits from rev 1 -> applied (rev 2); phone B still at rev 1 -> CONFLICT, server row returned, no overwrite'
select push_changes('[{"table":"saves","id":"s1","base_rev":1,"op":"upsert","row":{"url":"https://a.com","title":"edited on A"}}]')->0->>'status' as a;
select push_changes('[{"table":"saves","id":"s1","base_rev":1,"op":"upsert","row":{"url":"https://a.com","title":"stale B","updated_at":"2099-01-01T00:00:00Z"}}]')->0 #>> '{status}' as b_status_even_with_future_clock;
select title, rev from saves where id='s1';
\echo '== P3 B rebases onto rev 2 (its changed fields on top of the server row) -> applied'
select push_changes('[{"table":"saves","id":"s1","base_rev":2,"op":"upsert","row":{"url":"https://a.com","title":"B after rebase"}}]')->0->>'status';
\echo '== P4 delete (C-2): A deletes at rev 3; B edits from rev 3 too late -> conflict with tombstone'
select push_changes('[{"table":"saves","id":"s1","base_rev":3,"op":"delete"}]')->0->>'status' as a_delete;
select push_changes('[{"table":"saves","id":"s1","base_rev":3,"op":"upsert","row":{"url":"https://a.com","title":"resurrect?"}}]')->0 #>> '{server,deleted_at}' is not null as b_sees_tombstone;
\echo '== P5 a fresh device pulls everything since rev 0 and learns the deletion (incremental, ordered, pageable)'
select id, title, rev, deleted_at is not null as deleted from saves where rev > 0 order by rev limit 500;
\echo '== P6 direct client writes are refused (only push_changes writes)'
insert into saves (id, url, title) values ('x', 'https://x', 'direct');
update saves set title = 'direct' where id = 's1';
select title from saves where id = 's1';
\echo '== P7 another user cannot touch uA rows'
set request.jwt.claims = '{"sub":"uB"}';
select push_changes('[{"table":"saves","id":"s1","base_rev":4,"op":"upsert","row":{"url":"https://b.com","title":"B hijack"}}]')->0->>'status' as uB_result;
reset role; select user_id, id, title, rev from saves where id='s1' order by user_id;
