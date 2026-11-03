-- Defence in depth for C-1: functions created by future migrations are NOT callable by clients unless the
-- migration grants them explicitly. Applies to functions created later by the role running migrations
-- (on Supabase: postgres). Check with \ddp after applying.
--
-- Two statements are needed. PostgreSQL grants EXECUTE on every new function to PUBLIC globally, and a
-- schema-scoped ALTER DEFAULT PRIVILEGES cannot revoke a global default, so the PUBLIC grant must be removed
-- globally; Supabase's schema-level grants to anon/authenticated are removed for public.
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

-- Consequence for future migrations: every function meant for clients needs an explicit
--   grant execute on function public.<name>(<args>) to authenticated;
-- Rollback (restores the previous defaults):
--   alter default privileges grant execute on functions to public;
--   alter default privileges in schema public grant execute on functions to anon, authenticated;
