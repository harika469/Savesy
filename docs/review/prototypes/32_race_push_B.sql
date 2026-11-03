-- P8 session B: pushes the same row from the same rev while A holds the lock; must wait, then conflict.
\i docs/review/prototypes/05_assert.sql
\pset tuples_only on
set role authenticated; set request.jwt.claims = '{"sub":"uR"}';
select pg_temp.ok((public.push_changes('[{"table":"saves","id":"c1","base_rev":1,"op":"upsert","row":{"url":"https://c.com","title":"from B"}}]'))->0->>'status' = 'conflict', 'P8 concurrent push from the same rev conflicts');
reset role;
select pg_temp.ok((select title from public.saves where user_id = 'uR' and id = 'c1') = 'from A', 'P8 final row is A''s write');
