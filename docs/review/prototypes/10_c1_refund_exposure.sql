-- C-1 at e31bff1 (before 20 is applied): refund_ai_credit is callable by anon/authenticated. Run after 00.
\i docs/review/prototypes/05_assert.sql
\pset tuples_only on
select pg_temp.ok(has_function_privilege('authenticated', 'public.refund_ai_credit(text)', 'execute'), 'C-1: authenticated can execute refund_ai_credit at e31bff1');
select pg_temp.ok(has_function_privilege('anon', 'public.refund_ai_credit(text)', 'execute'), 'C-1: anon can execute refund_ai_credit at e31bff1');
set role authenticated; set request.jwt.claims = '{"sub":"user_X"}';
select pg_temp.ok((select count(*) from generate_series(1,10) where (public.consume_ai_credit())->>'allowed' = 'true') = 10, 'C-1: 10 free credits used');
select pg_temp.ok((public.consume_ai_credit())->>'allowed' = 'false', 'C-1: 11th refused');
select public.refund_ai_credit('user_X') from generate_series(1,10) \g /dev/null
select pg_temp.ok((public.consume_ai_credit())->>'allowed' = 'true', 'C-1: after refunding themselves, the user can spend again');
reset role; set role anon; set request.jwt.claims = '{}';
select public.refund_ai_credit('user_someone_else') \g /dev/null
select 'ok - C-1: anon called refund_ai_credit for another user without error';
reset role;
