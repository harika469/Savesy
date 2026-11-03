-- Effective function permissions after all migrations (C-1 and the default-privilege hardening).
\i supabase/tests/assert.sql
\pset tuples_only on

-- C-1: refund_ai_credit is server-only
select pg_temp.ok(not has_function_privilege('anon', 'public.refund_ai_credit(text)', 'execute'), 'C-1 anon cannot execute refund_ai_credit');
select pg_temp.ok(not has_function_privilege('authenticated', 'public.refund_ai_credit(text)', 'execute'), 'C-1 authenticated cannot execute refund_ai_credit');
select pg_temp.ok(has_function_privilege('service_role', 'public.refund_ai_credit(text)', 'execute'), 'C-1 service_role can execute refund_ai_credit');
select pg_temp.ok(not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                              where p.oid = 'public.refund_ai_credit(text)'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
                  'C-1 PUBLIC has no EXECUTE on refund_ai_credit');

-- Intended client grants still work
select pg_temp.ok(has_function_privilege('authenticated', 'public.consume_ai_credit()', 'execute') and has_function_privilege('authenticated', 'public.get_plan()', 'execute'), 'authenticated can execute consume_ai_credit and get_plan');
select pg_temp.ok(not has_function_privilege('anon', 'public.consume_ai_credit()', 'execute') and not has_function_privilege('anon', 'public.get_plan()', 'execute'), 'anon cannot execute consume_ai_credit or get_plan');

-- Audit: every SECURITY DEFINER function in public, and who outside the server can run it
create temp view definer_exec as
  select p.oid::regprocedure::text as fn, r.rolname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace, pg_roles r
  where n.nspname = 'public' and p.prosecdef and r.rolname in ('anon', 'authenticated') and has_function_privilege(r.rolname, p.oid, 'execute');
select pg_temp.ok(not exists (select 1 from definer_exec where rolname = 'anon'), 'audit: anon can execute no SECURITY DEFINER function in public');
select pg_temp.ok((select coalesce(array_agg(fn order by fn), '{}') from definer_exec where rolname = 'authenticated')
                  = array['consume_ai_credit()', 'get_plan()', 'pull_changes(bigint,bigint,integer)', 'push_changes(jsonb)'],
                  'audit: authenticated can execute exactly consume_ai_credit(), get_plan(), pull_changes(), push_changes()');

-- Behaviour: the attack from the review now fails; the normal path still works
set role authenticated; set request.jwt.claims = '{"sub":"user_X"}';
select pg_temp.ok((public.consume_ai_credit())->>'allowed' = 'true', 'signed-in user can still use a credit');
select pg_temp.fails($$select public.refund_ai_credit('user_X')$$, '42501', 'signed-in user cannot refund their own credit');
select pg_temp.fails($$select public.refund_ai_credit('user_someone_else')$$, '42501', 'signed-in user cannot refund another user');
reset role; set role anon; set request.jwt.claims = '{}';
select pg_temp.fails($$select public.refund_ai_credit('user_X')$$, '42501', 'anon cannot refund');
select pg_temp.fails($$select public.consume_ai_credit()$$, '42501', 'anon cannot use a credit');
reset role; set role service_role;
select pg_temp.ok((select public.refund_ai_credit('user_X')) is null, 'service_role can refund (the edge function path)');
reset role;
select pg_temp.ok((select used from public.ai_usage where user_id = 'user_X') = 0, 'refund by service_role returned the credit');

-- RLS still blocks self-granting Pro (unchanged by these migrations)
set role authenticated; set request.jwt.claims = '{"sub":"user_X"}';
select pg_temp.fails($$insert into public.entitlements (user_id) values ('user_X')$$, '42501', 'a user cannot make themselves Pro');
reset role;
