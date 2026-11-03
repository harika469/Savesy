-- PROTOTYPE ONLY (not a migration): idempotent AI charges. Run after 00 (10 optional).
-- v2 (after ChatGPT review of 3fcf7fd): request fingerprint (a reused id with different input is rejected),
-- explicit lease expiry, and finalize_ai_charge reports exactly what happened when inference outlives its lease.
\set ON_ERROR_STOP on
-- 1) Stop new public functions being callable by anon/authenticated by default. Affects functions created later
--    BY THE ROLE THAT RUNS THIS (check with \ddp in the real project; run as the migration role).
alter default privileges in schema public revoke execute on functions from anon, authenticated;
revoke execute on function public.refund_ai_credit(text) from anon, authenticated;   -- C-1 emergency fix

create table public.ai_charges (
  user_id      text        not null,
  request_id   uuid        not null,
  request_hash text        not null check (request_hash ~ '^[0-9a-f]{64}$'),  -- sha256 of the normalized request (computed by the edge function)
  month        date        not null,               -- the month the credit was taken from
  status       text        not null check (status in ('reserved','succeeded','refunded')),
  charged      boolean     not null default true,  -- false only when a late success could not be re-charged (see finalize)
  expires_at   timestamptz not null,               -- lease: after this, the reservation may be refunded
  result       jsonb,                              -- cached Smart Save result: a replay costs nothing (purge after N days)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, request_id)
);
alter table public.ai_charges enable row level security;   -- no policies: clients can't read or write it directly

create function public.ai_cap(p_user text) returns integer
language sql stable security definer set search_path = '' as $$
  select case when exists (select 1 from public.entitlements e where e.user_id = p_user and (e.expires_at is null or e.expires_at > pg_catalog.now()))
              then 500 else 10 end;
$$;

-- Refund every expired reservation of one user, once, against its recorded month. Caller must hold the user's lock.
create function public.ai_expire_leases(p_user text) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare n integer;
begin
  with stale as (
    update public.ai_charges set status = 'refunded', updated_at = pg_catalog.now()
    where user_id = p_user and status = 'reserved' and expires_at < pg_catalog.now()
    returning month)
  , dec as (
    update public.ai_usage u set used = greatest(u.used - s.n, 0)
    from (select month, count(*)::int n from stale group by month) s
    where u.user_id = p_user and u.month = s.month returning 1)
  select count(*) into n from stale;
  return n;
end $$;

-- Called AS THE USER (keeps the Clerk-token check at the database boundary). uid comes only from the verified JWT.
create function public.reserve_ai_credit(p_request_id uuid, p_request_hash text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid text := auth.jwt() ->> 'sub';
  this_month date := date_trunc('month', pg_catalog.now())::date;
  cap integer; used_now integer; existing public.ai_charges;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_request_id is null then raise exception 'request id required' using errcode = '22023'; end if;
  if p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then raise exception 'request hash required' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ai:' || uid));
  perform public.ai_expire_leases(uid);

  select * into existing from public.ai_charges where user_id = uid and request_id = p_request_id;
  if found then
    if existing.request_hash <> p_request_hash then
      raise exception 'request id reused for a different request' using errcode = '22023';
    end if;
    -- Idempotent replay: never charges twice, never re-runs paid inference for free.
    return jsonb_build_object('allowed', false, 'replay', existing.status, 'result', case when existing.status = 'succeeded' then existing.result end);
  end if;

  cap := public.ai_cap(uid);
  insert into public.ai_usage (user_id, month, used) values (uid, this_month, 0) on conflict do nothing;
  update public.ai_usage set used = used + 1 where user_id = uid and month = this_month and used < cap returning used into used_now;
  if used_now is null then
    return jsonb_build_object('allowed', false, 'reason', 'limit', 'plan', case when cap > 10 then 'pro' else 'free' end, 'limit', cap);
  end if;
  insert into public.ai_charges (user_id, request_id, request_hash, month, status, expires_at)
  values (uid, p_request_id, p_request_hash, this_month, 'reserved', pg_catalog.now() + interval '10 minutes');
  return jsonb_build_object('allowed', true, 'user_id', uid, 'used', used_now, 'limit', cap, 'plan', case when cap > 10 then 'pro' else 'free' end);
end $$;

-- Server only. Returns one of:
--   'finalized'          reserved -> succeeded (normal path)
--   'already_finalized'  a second finalize: nothing changes
--   'recharged'          the lease had expired and was refunded; a credit was taken again (current month) and the result stored
--   'uncharged'          the lease had expired and the user has no credit left; result stored, charged = false (cost absorbed, log it)
--   'not_found'          no such reservation for this user
create function public.finalize_ai_charge(p_user_id text, p_request_id uuid, p_result jsonb) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare st text; this_month date := date_trunc('month', pg_catalog.now())::date; used_now integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ai:' || p_user_id));
  select status into st from public.ai_charges where user_id = p_user_id and request_id = p_request_id for update;
  if not found then return 'not_found'; end if;
  if st = 'succeeded' then return 'already_finalized'; end if;
  if st = 'reserved' then
    update public.ai_charges set status = 'succeeded', result = p_result, updated_at = pg_catalog.now()
    where user_id = p_user_id and request_id = p_request_id;
    return 'finalized';
  end if;
  -- st = 'refunded': inference outlived its lease and the credit was already given back.
  insert into public.ai_usage (user_id, month, used) values (p_user_id, this_month, 0) on conflict do nothing;
  update public.ai_usage set used = used + 1 where user_id = p_user_id and month = this_month and used < public.ai_cap(p_user_id) returning used into used_now;
  update public.ai_charges set status = 'succeeded', result = p_result, charged = (used_now is not null),
         month = case when used_now is not null then this_month else month end, updated_at = pg_catalog.now()
  where user_id = p_user_id and request_id = p_request_id;
  return case when used_now is not null then 'recharged' else 'uncharged' end;
end $$;

-- Server only: reserved -> refunded exactly once, decrementing the RECORDED month. Returns false if nothing to refund.
create function public.refund_ai_charge(p_user_id text, p_request_id uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare m date;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ai:' || p_user_id));
  update public.ai_charges set status = 'refunded', updated_at = pg_catalog.now()
  where user_id = p_user_id and request_id = p_request_id and status = 'reserved'
  returning month into m;
  if m is null then return false; end if;
  update public.ai_usage set used = greatest(used - 1, 0) where user_id = p_user_id and month = m;
  return true;
end $$;

revoke all on function public.reserve_ai_credit(uuid, text), public.finalize_ai_charge(text, uuid, jsonb), public.refund_ai_charge(text, uuid),
  public.ai_cap(text), public.ai_expire_leases(text) from public, anon, authenticated;
grant execute on function public.reserve_ai_credit(uuid, text) to authenticated;
grant execute on function public.finalize_ai_charge(text, uuid, jsonb), public.refund_ai_charge(text, uuid) to service_role;
