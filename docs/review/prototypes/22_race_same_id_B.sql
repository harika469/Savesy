-- R1 session B: started while A holds the lock; must wait, then see A's reservation as a replay (no second charge).
\i docs/review/prototypes/05_assert.sql
\pset tuples_only on
set role authenticated; set request.jwt.claims = '{"sub":"r1"}';
select pg_temp.ok((public.reserve_ai_credit('99999999-9999-9999-9999-999999999999', repeat('a', 64)))->>'replay' = 'reserved', 'R1 concurrent same-id reserve is a replay');
reset role;
