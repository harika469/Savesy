\set ON_ERROR_STOP off
\echo '== T1 grants: who can execute what'
select f, r, has_function_privilege(r, f, 'execute') from
  unnest(array['public.refund_ai_credit(text)','public.reserve_ai_credit(uuid)','public.finalize_ai_charge(text,uuid,jsonb)','public.refund_ai_charge(text,uuid)']) f,
  unnest(array['anon','authenticated','service_role']) r order by 1,2;
\echo '== T2 anon / no sub cannot reserve'
set role anon; select reserve_ai_credit('00000000-0000-0000-0000-000000000001'); reset role;
\echo '== T3 same request id twice = one charge'
set role authenticated; set request.jwt.claims = '{"sub":"u1"}';
select reserve_ai_credit('11111111-1111-1111-1111-111111111111')->>'allowed' as first, reserve_ai_credit('11111111-1111-1111-1111-111111111111')->>'replay' as second_replay, (get_plan())->>'used' as used;
\echo '== T4 client cannot finalize, refund, or read charges'
select finalize_ai_charge('u1','11111111-1111-1111-1111-111111111111','{}');
select refund_ai_charge('u1','11111111-1111-1111-1111-111111111111');
select count(*) as visible_charges from ai_charges;
reset role;
\echo '== T5 refund exactly once (server)'
set role service_role;
select refund_ai_charge('u1','11111111-1111-1111-1111-111111111111') as first_refund, refund_ai_charge('u1','11111111-1111-1111-1111-111111111111') as second_refund;
select used from ai_usage where user_id='u1';
\echo '== T6 retry with a refunded id does not charge again'
reset role; set role authenticated; set request.jwt.claims = '{"sub":"u1"}';
select reserve_ai_credit('11111111-1111-1111-1111-111111111111')->>'replay' as replay, (get_plan())->>'used' as used;
reset role;
\echo '== T7 succeeded id replays the cached result for free; finalize only once'
set role authenticated; set request.jwt.claims = '{"sub":"u2"}'; select reserve_ai_credit('22222222-2222-2222-2222-222222222222')->>'allowed'; reset role;
set role service_role; select finalize_ai_charge('u2','22222222-2222-2222-2222-222222222222','{"title":"Pad Thai"}') as f1, finalize_ai_charge('u2','22222222-2222-2222-2222-222222222222','{"title":"x"}') as f2, refund_ai_charge('u2','22222222-2222-2222-2222-222222222222') as refund_after_success; reset role;
set role authenticated; set request.jwt.claims = '{"sub":"u2"}';
select reserve_ai_credit('22222222-2222-2222-2222-222222222222')->'result'->>'title' as cached_title, (get_plan())->>'used' as used; reset role;
\echo '== T8 month rollover: charge in Oct, refund in Nov decrements Oct'
insert into ai_usage values ('u3', date_trunc('month', now() - interval '1 month')::date, 4);
insert into ai_charges (user_id, request_id, month, status) values ('u3','33333333-3333-3333-3333-333333333333', date_trunc('month', now() - interval '1 month')::date, 'reserved');
set role service_role; select refund_ai_charge('u3','33333333-3333-3333-3333-333333333333'); reset role;
select month, used from ai_usage where user_id='u3';
\echo '== T9 stale reservation (crash) is refunded once by the next reserve'
insert into ai_usage values ('u4', date_trunc('month', now())::date, 10);
insert into ai_charges (user_id, request_id, month, status, created_at) values ('u4','44444444-4444-4444-4444-444444444444', date_trunc('month', now())::date, 'reserved', now() - interval '20 minutes');
set role authenticated; set request.jwt.claims = '{"sub":"u4"}';
select reserve_ai_credit('55555555-5555-5555-5555-555555555555')->>'allowed' as allowed_after_cleanup, (get_plan())->>'used' as used; reset role;
select request_id, status from ai_charges where user_id='u4' order by created_at;
\echo '== T10 cap still enforced: 10 different ids then the 11th refused'
set role authenticated; set request.jwt.claims = '{"sub":"u5"}';
select count(*) filter (where (reserve_ai_credit(gen_random_uuid()))->>'allowed' = 'true') as allowed from generate_series(1,11);
reset role;
