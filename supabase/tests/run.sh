#!/usr/bin/env bash
# Database tests on uniquely named, disposable PostgreSQL databases that emulate Supabase (dropped on exit).
#  1. Fresh install: every migration in supabase/migrations, then every supabase/tests/*.test.sql.
#  2. Races:   supabase/tests/races/<name>/{A.sql,B.sql[,check.sql]}  (A must hold its transaction open with pg_sleep).
#  3. Upgrades: supabase/tests/upgrade/<migration name>/{seed.sql,check.sql}: migrations BEFORE <migration name>,
#               then seed.sql (realistic existing data), then <migration name> and every later migration, then check.sql.
# Any unexpected SQL error or failed assertion exits non-zero.
# Usage (repo root):  PGHOST=... PGPORT=... PGUSER=postgres npm run test:db
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
DBS=()
cleanup() { for d in "${DBS[@]:-}"; do [ -n "$d" ] && dropdb --if-exists "$d" >/dev/null 2>&1 || true; done; }
trap cleanup EXIT

# newdb runs in $(...), a subshell, so it can't register its database for cleanup: callers use mkdb instead.
newdb() { local d="savesy_test_$(date +%s)_$$_$RANDOM"; createdb "$d"; psql -X -q -v ON_ERROR_STOP=1 -d "$d" -f supabase/tests/emulate_supabase.sql >/dev/null; echo "$d"; }
migrate() { # migrate DB [only-before NAME | from NAME]
  local db="$1" mode="${2:-all}" name="${3:-}"
  for m in supabase/migrations/*.sql; do
    local base; base="$(basename "$m" .sql)"
    if [ "$mode" = before ] && [[ ! "$base" < "$name" ]]; then continue; fi
    if [ "$mode" = from ] && [[ "$base" < "$name" ]]; then continue; fi
    local log; log="$(psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$m" 2>&1 >/dev/null)" || { echo "not ok - migration $m failed:" >&2; echo "$log" | grep -v NOTICE >&2; exit 1; }
  done
}
mkdb() { DB="$(newdb)"; DBS+=("$DB"); }
run_sql() { psql -X -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" | sed '/^$/d'; }

echo "# 1. fresh install"
mkdb; migrate "$DB"; echo "applied $(ls supabase/migrations/*.sql | wc -l) migrations"
for t in supabase/tests/*.test.sql; do echo "## $t"; run_sql "$DB" "$t"; done

echo "# 2. races"
for dir in supabase/tests/races/*/; do
  [ -d "$dir" ] || continue
  mkdb; migrate "$DB"
  app="race_$$_$RANDOM"; echo "## $dir"
  PGAPPNAME="$app" psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$dir/A.sql" >/dev/null & pid=$!
  held=0
  for _ in $(seq 1 200); do
    if [ "$(psql -X -At -d "$DB" -c "select count(*) from pg_stat_activity where application_name = '$app' and query like '%pg_sleep%'")" = 1 ]; then held=1; break; fi
    sleep 0.05
  done
  [ "$held" = 1 ] || { echo "not ok - $dir A never reached its hold point" >&2; exit 1; }
  run_sql "$DB" "$dir/B.sql"
  wait "$pid"
  [ -f "$dir/check.sql" ] && run_sql "$DB" "$dir/check.sql"
done

echo "# 3. upgrades of populated databases"
for dir in supabase/tests/upgrade/*/; do
  [ -d "$dir" ] || continue
  name="$(basename "$dir")"
  [ -f "supabase/migrations/$name.sql" ] || { echo "not ok - $dir names no migration" >&2; exit 1; }
  mkdb; echo "## $dir"
  migrate "$DB" before "$name"; run_sql "$DB" "$dir/seed.sql"
  migrate "$DB" from "$name"; run_sql "$DB" "$dir/check.sql"
done
echo "ALL PASSED"
