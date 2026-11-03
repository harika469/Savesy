#!/usr/bin/env bash
# Runs every prototype and test on a fresh, uniquely named, disposable database, then drops it.
# Exits non-zero on ANY unexpected SQL error or failed assertion. Usage (from the repo root):
#   PGHOST=... PGPORT=... PGUSER=postgres docs/review/prototypes/run_all.sh
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
D=docs/review/prototypes
DB="savesy_review_$(date +%s)_$$"
case "$DB" in savesy_review_*) ;; *) echo "refusing to use database $DB" >&2; exit 2 ;; esac
cleanup() { dropdb --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT
createdb "$DB"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -d "$DB")

run() { echo "## $1"; "${PSQL[@]}" -f "$D/$1" | sed '/^$/d'; }

# race A B: start A in the background, wait until A is holding its transaction open (in pg_sleep),
# run B (which must block on A's lock), then wait for A and fail if either session failed.
race() {
  local a="$1" b="$2" app="race_$$_$RANDOM"
  echo "## race $a + $b"
  PGAPPNAME="$app" "${PSQL[@]}" -f "$D/$a" >/dev/null & local pid=$!
  for _ in $(seq 1 100); do
    if [ "$("${PSQL[@]}" -At -c "select count(*) from pg_stat_activity where application_name = '$app' and query like '%pg_sleep%'")" = 1 ]; then break; fi
    sleep 0.05
  done
  [ "$("${PSQL[@]}" -At -c "select count(*) from pg_stat_activity where application_name = '$app' and query like '%pg_sleep%'")" = 1 ] || { echo "not ok - $a never reached its hold point" >&2; exit 1; }
  "${PSQL[@]}" -f "$D/$b" | sed '/^$/d'
  wait "$pid"
}

"${PSQL[@]}" -f "$D/00_emulate_supabase.sql" >/dev/null
run 10_c1_refund_exposure.sql
"${PSQL[@]}" -f "$D/20_credits_prototype.sql" >/dev/null && echo '## 20_credits_prototype.sql applied'
run 21_credits_tests.sql
"${PSQL[@]}" -c "insert into public.ai_usage values ('r2', date_trunc('month', now())::date, 9)" >/dev/null
race 22_race_same_id_A.sql 22_race_same_id_B.sql
race 23_race_cap_A.sql 23_race_cap_B.sql
run 24_race_checks.sql
"${PSQL[@]}" -f "$D/30_sync_prototype.sql" >/dev/null && echo '## 30_sync_prototype.sql applied'
run 31_sync_tests.sql
"${PSQL[@]}" -c "set role authenticated; set request.jwt.claims = '{\"sub\":\"uR\"}'; select public.push_changes('[{\"table\":\"saves\",\"id\":\"c1\",\"base_rev\":0,\"op\":\"upsert\",\"row\":{\"url\":\"https://c.com\",\"title\":\"v1\"}}]');" >/dev/null
race 32_race_push_A.sql 32_race_push_B.sql
node "$D/40_client_rebase.mjs"
echo "ALL PASSED"
