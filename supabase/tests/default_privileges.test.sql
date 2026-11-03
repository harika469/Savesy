-- Migration 20261105000001: functions created later are not client-callable until a migration grants them.
\i supabase/tests/assert.sql
\pset tuples_only on
-- Default-privilege hardening: a function created by a later migration is not client-callable until granted
create function public.__probe_future_fn() returns int language sql as $$ select 1 $$;
select pg_temp.ok(not has_function_privilege('anon', 'public.__probe_future_fn()', 'execute') and not has_function_privilege('authenticated', 'public.__probe_future_fn()', 'execute'),
                  'future functions are not executable by anon/authenticated by default');
drop function public.__probe_future_fn();

