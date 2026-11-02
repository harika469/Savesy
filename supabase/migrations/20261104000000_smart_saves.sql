-- Smart Saves (AI enrichment) + the Free/Pro plan.
-- Free accounts get a monthly allowance of smart saves; Pro is unlimited (with a fair-use cap).
-- Allowance checks happen here, in the database, so the app can't be patched to skip them.

-- Structured details extracted by AI (recipe / place / product).
alter table public.saves add column if not exists details jsonb;

-- Who is Pro. Written only by the server (payment webhooks / admin), never by the app.
create table if not exists public.entitlements (
  user_id    text        primary key,
  plan       text        not null default 'pro' check (plan in ('pro')),
  source     text        not null default 'manual', -- 'revenuecat', 'manual', 'promo'
  expires_at timestamptz,                           -- null = no expiry
  updated_at timestamptz not null default now()
);

-- Smart saves used per account per month.
create table if not exists public.ai_usage (
  user_id text not null,
  month   date not null,
  used    integer not null default 0 check (used >= 0),
  primary key (user_id, month)
);

-- "I want Pro" taps: a fake-door test that measures demand before payments exist.
create table if not exists public.pro_interest (
  user_id    text        primary key default (auth.jwt() ->> 'sub'),
  plan       text        not null check (plan in ('monthly', 'yearly')),
  created_at timestamptz not null default now()
);

alter table public.entitlements enable row level security;
alter table public.ai_usage enable row level security;
alter table public.pro_interest enable row level security;

drop policy if exists "read own entitlement" on public.entitlements;
create policy "read own entitlement" on public.entitlements for select to authenticated using ((select auth.jwt() ->> 'sub') = user_id);
drop policy if exists "read own usage" on public.ai_usage;
create policy "read own usage" on public.ai_usage for select to authenticated using ((select auth.jwt() ->> 'sub') = user_id);
drop policy if exists "own pro interest" on public.pro_interest;
create policy "own pro interest" on public.pro_interest for all to authenticated
  using ((select auth.jwt() ->> 'sub') = user_id) with check ((select auth.jwt() ->> 'sub') = user_id);
grant select on public.entitlements, public.ai_usage to authenticated;
grant select, insert, update on public.pro_interest to authenticated;

create or replace function public.savesy_limits(pro boolean) returns integer
language sql immutable as $$ select case when pro then 500 else 10 end $$;

-- Current plan and this month's usage, for the app's Pro screen.
create or replace function public.get_plan() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  uid text := auth.jwt() ->> 'sub';
  is_pro boolean;
  used_now integer;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select exists (select 1 from entitlements e where e.user_id = uid and (e.expires_at is null or e.expires_at > now())) into is_pro;
  select coalesce((select u.used from ai_usage u where u.user_id = uid and u.month = date_trunc('month', now())::date), 0) into used_now;
  return jsonb_build_object('plan', case when is_pro then 'pro' else 'free' end, 'used', used_now, 'limit', savesy_limits(is_pro));
end $$;

-- Atomically takes one smart save from this month's allowance.
-- Returns {allowed, plan, used, limit}; allowed=false when the allowance is used up.
create or replace function public.consume_ai_credit() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  uid text := auth.jwt() ->> 'sub';
  this_month date := date_trunc('month', now())::date;
  is_pro boolean;
  cap integer;
  used_now integer;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select exists (select 1 from entitlements e where e.user_id = uid and (e.expires_at is null or e.expires_at > now())) into is_pro;
  cap := savesy_limits(is_pro);
  insert into ai_usage (user_id, month, used) values (uid, this_month, 0) on conflict do nothing;
  update ai_usage set used = used + 1 where user_id = uid and month = this_month and used < cap returning used into used_now;
  if used_now is null then
    select used into used_now from ai_usage where user_id = uid and month = this_month;
    return jsonb_build_object('allowed', false, 'plan', case when is_pro then 'pro' else 'free' end, 'used', used_now, 'limit', cap, 'user_id', uid);
  end if;
  return jsonb_build_object('allowed', true, 'plan', case when is_pro then 'pro' else 'free' end, 'used', used_now, 'limit', cap, 'user_id', uid);
end $$;

-- Gives a credit back when enrichment fails. Server-only (service role).
create or replace function public.refund_ai_credit(uid text) returns void
language sql volatile security definer set search_path = public as $$
  update ai_usage set used = greatest(used - 1, 0) where user_id = uid and month = date_trunc('month', now())::date;
$$;

revoke all on function public.get_plan(), public.consume_ai_credit(), public.refund_ai_credit(text) from public;
grant execute on function public.get_plan(), public.consume_ai_credit() to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.refund_ai_credit(text) to service_role;
  end if;
end $$;
