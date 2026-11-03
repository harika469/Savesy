\i supabase/tests/assert.sql
\pset tuples_only on
select pg_temp.ok((select title || '@' || rev from public.saves where user_id = 'uR' and id = 'c1') = 'from A@2', 'race: the row is A''s write at rev 2');
select pg_temp.ok((select rev from public.sync_heads where user_id = 'uR') = 2, 'race: the losing push used no revision (head = 2)');
