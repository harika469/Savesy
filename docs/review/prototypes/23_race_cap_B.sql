-- R2 session B: a different request at the same moment; must wait, then be refused at the cap.
\i docs/review/prototypes/05_assert.sql
\pset tuples_only on
set role authenticated; set request.jwt.claims = '{"sub":"r2"}';
select pg_temp.ok((public.reserve_ai_credit('bbbbbbbb-0000-0000-0000-000000000002', repeat('b', 64)))->>'reason' = 'limit', 'R2 concurrent second request refused at the cap');
reset role;
