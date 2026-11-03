-- R2 session A: user at 9/10 reserves one new request and holds its transaction open for 3 s.
set role authenticated; set request.jwt.claims = '{"sub":"r2"}';
begin;
select (public.reserve_ai_credit('aaaaaaaa-0000-0000-0000-000000000001', repeat('a', 64)))->>'allowed' = 'true' as a_allowed \gset
\if :a_allowed
\else
  \echo 'not ok - R2 session A reserve not allowed'
  \quit 3
\endif
select pg_sleep(3);
commit;
