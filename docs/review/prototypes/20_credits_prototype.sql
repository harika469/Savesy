-- PROTOTYPE ONLY (not a migration): idempotent AI charges. Run after 00 (10 optional).
\set ON_ERROR_STOP on
-- ===== Prototype (scratch DB only): idempotent AI charges =====
-- 1) Stop new public functions being callable by anon/authenticated by default (defence for future migrations).
alter default privileges in schema public revoke execute on functions from anon, authenticated;
revoke execute on function public.refund_ai_credit(text) from anon, authenticated;   -- C-1 emergency fix

create table public.ai_charges (
  user_id    text        not null,
  request_id uuid        not null,
  month      date        not null,              -- the month actually charged
  status     text        not null check (status in ('reserved','succeeded','refunded')),
  result     jsonb,                              -- cached Smart Save result: a replay costs nothing
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
alter table public.ai_charges enable row level security;   -- no policies: clients can't read or write it directly

-- Called AS THE USER (keeps the Clerk-token check at the database boundary). uid comes only from the verified JWT.
create function public.reserve_ai_credit(p_request_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid text := auth.jwt() ->> 'sub';
  this_month date := date_trunc('month', pg_catalog.now())::date;
  is_pro boolean; cap integer; used_now integer; existing public.ai_charges;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_request_id is null then raise exception 'request id required' using errcode = '22023'; end if;
  -- Serialize this user's charges (also orders lazy cleanup below).
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ai:' || uid));
  -- Lazy cleanup: a reservation left by a crashed/timed-out run is refunded once.
  with stale as (
    update public.ai_charges set status = 'refunded', updated_at = pg_catalog.now()
    where user_id = uid and status = 'reserved' and created_at < pg_catalog.now() - interval '10 minutes'
    returning month)
  update public.ai_usage u set used = greatest(u.used - s.n, 0)
  from (select month, count(*)::int n from stale group by month) s
  where u.user_id = uid and u.month = s.month;

  select * into existing from public.ai_charges where user_id = uid and request_id = p_request_id;
  if found then  -- idempotent replay: never charges twice, never re-runs paid inference for free
    return jsonb_build_object('allowed', false, 'replay', existing.status, 'result', existing.result);
  end if;

  select exists (select 1 from public.entitlements e where e.user_id = uid and (e.expires_at is null or e.expires_at > pg_catalog.now())) into is_pro;
  cap := case when is_pro then 500 else 10 end;
  insert into public.ai_usage (user_id, month, used) values (uid, this_month, 0) on conflict do nothing;
  update public.ai_usage set used = used + 1 where user_id = uid and month = this_month and used < cap returning used into used_now;
  if used_now is null then
    return jsonb_build_object('allowed', false, 'reason', 'limit', 'plan', case when is_pro then 'pro' else 'free' end, 'limit', cap);
  end if;
  insert into public.ai_charges (user_id, request_id, month, status) values (uid, p_request_id, this_month, 'reserved');
  return jsonb_build_object('allowed', true, 'user_id', uid, 'used', used_now, 'limit', cap, 'plan', case when is_pro then 'pro' else 'free' end);
end $$;

-- Server only: reserved -> succeeded, exactly once.
create function public.finalize_ai_charge(p_user_id text, p_request_id uuid, p_result jsonb) returns boolean
language sql volatile security definer set search_path = '' as $$
  update public.ai_charges set status = 'succeeded', result = p_result, updated_at = pg_catalog.now()
  where user_id = p_user_id and request_id = p_request_id and status = 'reserved'
  returning true;
$$;

-- Server only: reserved -> refunded exactly once, decrementing the RECORDED month.
create function public.refund_ai_charge(p_user_id text, p_request_id uuid) returns boolean
language sql volatile security definer set search_path = '' as $$
  with c as (
    update public.ai_charges set status = 'refunded', updated_at = pg_catalog.now()
    where user_id = p_user_id and request_id = p_request_id and status = 'reserved'
    returning user_id, month)
  update public.ai_usage u set used = greatest(u.used - 1, 0) from c
  where u.user_id = c.user_id and u.month = c.month
  returning true;
$$;

revoke all on function public.reserve_ai_credit(uuid), public.finalize_ai_charge(text, uuid, jsonb), public.refund_ai_charge(text, uuid) from public, anon, authenticated;
grant execute on function public.reserve_ai_credit(uuid) to authenticated;
grant execute on function public.finalize_ai_charge(text, uuid, jsonb), public.refund_ai_charge(text, uuid) to service_role;
