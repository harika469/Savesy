-- C-1 (issue #1): refund_ai_credit(uid) is SECURITY DEFINER in the exposed public schema. Migration
-- 20261104000000 revoked it only from PUBLIC, but Supabase's default privileges grant EXECUTE on new
-- public functions directly to anon and authenticated, so any caller could reset any user's AI allowance.
-- After this, only service_role (the edge function's server key) can call it.
revoke execute on function public.refund_ai_credit(text) from public, anon, authenticated;

-- Signed-out callers have no use for the plan/credit functions (both raise 'not signed in' for them).
revoke execute on function public.get_plan(), public.consume_ai_credit() from public, anon;

-- Keep the intended grants explicit (idempotent).
grant execute on function public.get_plan(), public.consume_ai_credit() to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.refund_ai_credit(text) to service_role;
  end if;
end $$;

-- Rollback: none recommended. Re-granting refund_ai_credit to anon/authenticated re-opens C-1.
