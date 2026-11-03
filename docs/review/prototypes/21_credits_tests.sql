-- Credit prototype tests. Run after 20. Every check asserts; any failure stops the run (non-zero exit).
\i docs/review/prototypes/05_assert.sql
\pset tuples_only on
-- sha256 fingerprints for two different requests
\set h1 '''aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'''
\set h2 '''bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'''
create function pg_temp.used(u text) returns int language sql as $$ select coalesce((select used from public.ai_usage where user_id = u and month = date_trunc('month', now())::date), 0) $$;
create function pg_temp.status(u text, r uuid) returns text language sql as $$ select status from public.ai_charges where user_id = u and request_id = r $$;
grant execute on function pg_temp.used(text), pg_temp.status(text, uuid) to public;

-- T1 grants
select pg_temp.ok(not has_function_privilege('anon','public.refund_ai_credit(text)','execute') and not has_function_privilege('authenticated','public.refund_ai_credit(text)','execute'), 'T1 old refund_ai_credit: no longer callable by anon/authenticated');
select pg_temp.ok(has_function_privilege('authenticated','public.reserve_ai_credit(uuid,text)','execute') and not has_function_privilege('anon','public.reserve_ai_credit(uuid,text)','execute'), 'T1 reserve: authenticated only');
select pg_temp.ok(not has_function_privilege('authenticated','public.finalize_ai_charge(text,uuid,jsonb)','execute') and not has_function_privilege('authenticated','public.refund_ai_charge(text,uuid)','execute')
                  and has_function_privilege('service_role','public.finalize_ai_charge(text,uuid,jsonb)','execute') and has_function_privilege('service_role','public.refund_ai_charge(text,uuid)','execute'), 'T1 finalize/refund: service_role only');
-- T2 anon
set role anon; set request.jwt.claims = '{}';
select pg_temp.fails($$select public.reserve_ai_credit('00000000-0000-0000-0000-000000000001', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$, '42501', 'T2 anon cannot reserve');
reset role;
-- T3 same id twice = one charge
set role authenticated; set request.jwt.claims = '{"sub":"u1"}';
select pg_temp.ok((public.reserve_ai_credit('11111111-1111-1111-1111-111111111111', :h1))->>'allowed' = 'true', 'T3 first reserve allowed');
select pg_temp.ok((public.reserve_ai_credit('11111111-1111-1111-1111-111111111111', :h1))->>'replay' = 'reserved', 'T3 second reserve is a replay');
select pg_temp.ok(pg_temp.used('u1') = 1, 'T3 one charge');
-- T11 same id, different request
select pg_temp.fails($$select public.reserve_ai_credit('11111111-1111-1111-1111-111111111111', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')$$, '22023', 'T11 reusing an id for a different request is rejected');
select pg_temp.fails($$select public.reserve_ai_credit('11111111-1111-1111-1111-111111111112', 'not-a-hash')$$, '22023', 'T11 malformed hash rejected');
-- T4 client cannot finalize, refund, or read charges
select pg_temp.fails($$select public.finalize_ai_charge('u1','11111111-1111-1111-1111-111111111111','{}')$$, '42501', 'T4 client cannot finalize');
select pg_temp.fails($$select public.refund_ai_charge('u1','11111111-1111-1111-1111-111111111111')$$, '42501', 'T4 client cannot refund');
select pg_temp.ok((select count(*) from public.ai_charges) = 0, 'T4 client sees no charges');
reset role;
-- T5 refund exactly once
set role service_role;
select pg_temp.ok(public.refund_ai_charge('u1','11111111-1111-1111-1111-111111111111') = true, 'T5 first refund');
select pg_temp.ok(public.refund_ai_charge('u1','11111111-1111-1111-1111-111111111111') = false, 'T5 second refund does nothing');
reset role;
select pg_temp.ok(pg_temp.used('u1') = 0, 'T5 usage back to 0');
-- T6 refunded id is not charged again
set role authenticated; set request.jwt.claims = '{"sub":"u1"}';
select pg_temp.ok((public.reserve_ai_credit('11111111-1111-1111-1111-111111111111', :h1))->>'replay' = 'refunded', 'T6 refunded id replays as refunded');
select pg_temp.ok(pg_temp.used('u1') = 0, 'T6 not charged again');
reset role;
-- T7 success: finalize once, refund after success does nothing, retry returns cached result for free
set role authenticated; set request.jwt.claims = '{"sub":"u2"}';
select pg_temp.ok((public.reserve_ai_credit('22222222-2222-2222-2222-222222222222', :h1))->>'allowed' = 'true', 'T7 reserve');
reset role; set role service_role;
select pg_temp.ok(public.finalize_ai_charge('u2','22222222-2222-2222-2222-222222222222','{"title":"Pad Thai"}') = 'finalized', 'T7 finalize');
select pg_temp.ok(public.finalize_ai_charge('u2','22222222-2222-2222-2222-222222222222','{"title":"x"}') = 'already_finalized', 'T7 second finalize is a no-op');
select pg_temp.ok(public.refund_ai_charge('u2','22222222-2222-2222-2222-222222222222') = false, 'T7 refund after success does nothing');
select pg_temp.ok(public.finalize_ai_charge('u2','99999999-9999-9999-9999-999999999990','{}') = 'not_found', 'T7 finalize of an unknown id reports not_found');
reset role; set role authenticated; set request.jwt.claims = '{"sub":"u2"}';
select pg_temp.ok((public.reserve_ai_credit('22222222-2222-2222-2222-222222222222', :h1))->'result'->>'title' = 'Pad Thai', 'T7 retry returns the cached result');
select pg_temp.ok(pg_temp.used('u2') = 1, 'T7 usage stays 1');
reset role;
-- T8 month rollover: reserved in the previous month, refunded now -> previous month decremented
insert into public.ai_usage values ('u3', date_trunc('month', now() - interval '1 month')::date, 4);
insert into public.ai_charges (user_id, request_id, request_hash, month, status, expires_at)
values ('u3','33333333-3333-3333-3333-333333333333', repeat('a',64), date_trunc('month', now() - interval '1 month')::date, 'reserved', now() + interval '5 minutes');
set role service_role; select pg_temp.ok(public.refund_ai_charge('u3','33333333-3333-3333-3333-333333333333'), 'T8 refund'); reset role;
select pg_temp.ok((select used from public.ai_usage where user_id = 'u3' and month = date_trunc('month', now() - interval '1 month')::date) = 3, 'T8 recorded (previous) month decremented 4 -> 3');
-- T9 expired lease refunded once by the next reserve
insert into public.ai_usage values ('u4', date_trunc('month', now())::date, 10);
insert into public.ai_charges (user_id, request_id, request_hash, month, status, expires_at)
values ('u4','44444444-4444-4444-4444-444444444444', repeat('a',64), date_trunc('month', now())::date, 'reserved', now() - interval '1 minute');
set role authenticated; set request.jwt.claims = '{"sub":"u4"}';
select pg_temp.ok((public.reserve_ai_credit('55555555-5555-5555-5555-555555555555', :h1))->>'allowed' = 'true', 'T9 expired lease freed a credit');
reset role;
select pg_temp.ok(pg_temp.status('u4','44444444-4444-4444-4444-444444444444') = 'refunded' and pg_temp.used('u4') = 10, 'T9 old lease refunded once, new request charged');
-- T12 inference finishes AFTER its lease expired and was refunded, user has credit -> recharged
set role service_role;
select pg_temp.ok(public.finalize_ai_charge('u4','44444444-4444-4444-4444-444444444444','{"title":"late"}') = 'uncharged', 'T13 late success with no credit left -> uncharged (result kept, cost absorbed)');
reset role;
select pg_temp.ok(pg_temp.used('u4') = 10 and (select charged from public.ai_charges where user_id='u4' and request_id='44444444-4444-4444-4444-444444444444') = false, 'T13 usage unchanged, charged = false');
insert into public.ai_charges (user_id, request_id, request_hash, month, status, expires_at)
values ('u6','66666666-6666-6666-6666-666666666666', repeat('a',64), date_trunc('month', now())::date, 'refunded', now() - interval '1 minute');
set role service_role;
select pg_temp.ok(public.finalize_ai_charge('u6','66666666-6666-6666-6666-666666666666','{"title":"late"}') = 'recharged', 'T12 late success with credit left -> recharged');
reset role;
select pg_temp.ok(pg_temp.used('u6') = 1 and pg_temp.status('u6','66666666-6666-6666-6666-666666666666') = 'succeeded', 'T12 one credit taken, status succeeded');
-- T10 cap: 10 different ids, 11th refused
set role authenticated; set request.jwt.claims = '{"sub":"u5"}';
select pg_temp.ok((select count(*) from generate_series(1,11) where (public.reserve_ai_credit(gen_random_uuid(), repeat('c',64)))->>'allowed' = 'true') = 10, 'T10 10 allowed, 11th refused');
reset role;
