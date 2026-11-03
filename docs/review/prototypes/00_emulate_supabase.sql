-- Emulates a fresh Supabase project on plain PostgreSQL 16, then applies the migrations at e31bff1.
-- Run from the repo root on an EMPTY database:  psql -d <db> -f docs/review/prototypes/00_emulate_supabase.sql
\set ON_ERROR_STOP on
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema auth; create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated;
-- Supabase's default privileges on public (the cause of C-1):
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
\i supabase/migrations/20261102000000_savesy_schema.sql
\i supabase/migrations/20261103000000_clerk_auth.sql
\i supabase/migrations/20261104000000_smart_saves.sql
