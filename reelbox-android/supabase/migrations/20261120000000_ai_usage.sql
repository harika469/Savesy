-- Daily AI usage counters: one row per user per day, plus one app-wide row (the all-zero user id).
create table if not exists public.ai_usage (
  user_id uuid not null,
  day date not null default ((now() at time zone 'utc')::date),
  count integer not null default 0,
  primary key (user_id, day)
);

-- Only the service role (the Edge Function) may touch this table.
alter table public.ai_usage enable row level security;

-- Adds one use for today and returns true, or returns false when the limit is already reached.
create or replace function public.increment_ai_usage(p_user uuid, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  insert into public.ai_usage (user_id, day, count)
  values (p_user, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day)
  do update set count = public.ai_usage.count + 1
  where public.ai_usage.count < p_limit;
  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

revoke all on function public.increment_ai_usage(uuid, integer) from public, anon, authenticated;
grant execute on function public.increment_ai_usage(uuid, integer) to service_role;
