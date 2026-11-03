#!/usr/bin/env bash
# Database tests: applies every migration in supabase/migrations (in order) to a fresh, uniquely named
# PostgreSQL database that emulates Supabase, runs every supabase/tests/*.test.sql, then drops the database.
# Any unexpected SQL error or failed assertion exits non-zero.
# Usage (repo root):  PGHOST=... PGPORT=... PGUSER=postgres npm run test:db
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
DB="savesy_test_$(date +%s)_$$"
cleanup() { dropdb --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT
createdb "$DB"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -d "$DB")
"${PSQL[@]}" -f supabase/tests/emulate_supabase.sql >/dev/null
for m in supabase/migrations/*.sql; do "${PSQL[@]}" -f "$m" >/dev/null 2>&1 || { echo "not ok - migration $m failed" >&2; "${PSQL[@]}" -f "$m" >/dev/null; exit 1; }; echo "applied $m"; done
for t in supabase/tests/*.test.sql; do echo "## $t"; "${PSQL[@]}" -f "$t" | sed '/^$/d'; done
echo "ALL PASSED"
