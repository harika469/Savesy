-- R1 session A: reserves request 9999… and holds its transaction (and the user's lock) open for 3 s.
set role authenticated; set request.jwt.claims = '{"sub":"r1"}';
begin;
select (public.reserve_ai_credit('99999999-9999-9999-9999-999999999999', repeat('a', 64)))->>'allowed' = 'true' as a_allowed \gset
\if :a_allowed
\else
  \echo 'not ok - R1 session A reserve not allowed'
  \quit 3
\endif
select pg_sleep(3);
commit;
