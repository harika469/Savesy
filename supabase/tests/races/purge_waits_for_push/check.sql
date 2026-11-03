\i supabase/tests/assert.sql
\pset tuples_only on
select pg_temp.ok((select deleted_at is null and title = 'kept' from public.saves where user_id = 'uX' and id = 't'), 'race: the restored row is live afterwards');
select pg_temp.ok((select floor_rev from public.sync_heads where user_id = 'uX') = 0, 'race: the floor did not move');
