-- After R1 and R2 have both finished.
\i docs/review/prototypes/05_assert.sql
\pset tuples_only on
select pg_temp.ok((select count(*) from public.ai_charges where user_id = 'r1') = 1 and (select used from public.ai_usage where user_id = 'r1') = 1, 'R1 exactly one charge, used = 1');
select pg_temp.ok((select count(*) from public.ai_charges where user_id = 'r2') = 1 and (select used from public.ai_usage where user_id = 'r2') = 10, 'R2 exactly one charge, used = 10');
