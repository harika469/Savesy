-- Assertion helpers (session-local). Include at the top of every test file with \i.
-- ok(cond, label): fails the run unless cond is true.  fails(sql, sqlstate, label): fails unless sql raises exactly that SQLSTATE.
\set ON_ERROR_STOP on
create or replace function pg_temp.ok(cond boolean, label text) returns text language plpgsql as $$
begin
  if cond is not true then raise exception 'not ok - %', label using errcode = 'P0001'; end if;
  return 'ok - ' || label;
end $$;
create or replace function pg_temp.fails(sql text, state text, label text) returns text language plpgsql as $$
declare got text;
begin
  begin execute sql; exception when others then got := sqlstate; end;
  if got is distinct from state then
    raise exception 'not ok - % (expected SQLSTATE %, got %)', label, state, coalesce(got, 'no error') using errcode = 'P0001';
  end if;
  return 'ok - ' || label || ' (SQLSTATE ' || state || ')';
end $$;
grant execute on function pg_temp.ok(boolean, text), pg_temp.fails(text, text, text) to public;
