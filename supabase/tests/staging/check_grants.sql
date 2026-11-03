-- READ-ONLY. Run in the Supabase SQL editor (staging first, then production) after applying the
-- 20261105* migrations. Every row in the first result must be false; the second lists what clients
-- can still execute; the third shows the default privileges that new functions will get.

-- 1) C-1: must be false, false, true
select has_function_privilege('anon', 'public.refund_ai_credit(text)', 'execute')          as anon_can_refund,
       has_function_privilege('authenticated', 'public.refund_ai_credit(text)', 'execute') as authenticated_can_refund,
       has_function_privilege('service_role', 'public.refund_ai_credit(text)', 'execute')  as service_role_can_refund;

-- 2) SECURITY DEFINER functions in public that anon/authenticated can execute.
--    Expected: authenticated -> consume_ai_credit(), get_plan(); anon -> none.
select p.oid::regprocedure as function, r.rolname as role
from pg_proc p join pg_namespace n on n.oid = p.pronamespace, pg_roles r
where n.nspname = 'public' and p.prosecdef and r.rolname in ('anon', 'authenticated')
  and has_function_privilege(r.rolname, p.oid, 'execute')
order by 2, 1;

-- 3) Default privileges for functions (should show no EXECUTE for PUBLIC/anon/authenticated
--    on entries owned by the role that runs migrations, normally postgres).
select pg_get_userbyid(d.defaclrole) as owner, coalesce(n.nspname, '(all schemas)') as schema, d.defaclacl
from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
where d.defaclobjtype = 'f'
order by 1, 2;
