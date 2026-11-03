-- Session B: pushes the same row from the same rev while A holds the lock: must wait, then conflict.
\i supabase/tests/assert.sql
\pset tuples_only on
set role authenticated; set request.jwt.claims = '{"sub":"uR"}';
select pg_temp.ok((public.push_changes('[{"table":"saves","id":"c1","base_rev":1,"op":"upsert","row":{"url":"https://c.com","title":"from B"}}]'))->0->>'status' = 'conflict', 'race: a concurrent push from the same rev conflicts');
reset role;
