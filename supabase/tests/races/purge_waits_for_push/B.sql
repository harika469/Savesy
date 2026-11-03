-- Session B: a purge starts while A holds uX's lock. It must wait, then see the restored (live) row and purge nothing.
\i supabase/tests/assert.sql
\pset tuples_only on
set role service_role;
select pg_temp.ok(public.purge_tombstones('90 days') = 0, 'race: a purge that overlaps a push waits for it and does not delete the just-restored row');
reset role;
