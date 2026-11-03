#!/usr/bin/env bash
# Times the sync migration (20261106000000) on a large existing dataset. Not part of `npm run test:db` (slow).
# Usage (repo root): PGHOST=... PGPORT=... PGUSER=postgres bash supabase/tests/perf/migration_timing.sh [users] [saves_per_user]
# Measured 2026-11-03 (PostgreSQL 16, sandbox VM): 2,000 users x 250 saves + 6 collections = 512,000 rows, 173 MB:
#   total ~10 s; slowest statements 7.4 s (backfill of saves), 0.9 s and 0.6 s (unique indexes).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
USERS="${1:-2000}"; PER="${2:-250}"
DB="savesy_perf_$(date +%s)_$$"
trap 'dropdb --if-exists "$DB" >/dev/null 2>&1 || true' EXIT
createdb "$DB"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -d "$DB")
"${PSQL[@]}" -f supabase/tests/emulate_supabase.sql >/dev/null
for m in supabase/migrations/*.sql; do [[ "$(basename "$m" .sql)" < "20261106000000" ]] && "${PSQL[@]}" -f "$m" >/dev/null 2>&1; done
"${PSQL[@]}" <<SQL
insert into public.collections (user_id, id, name, created_at, updated_at)
select 'user_' || u, 'col' || c, 'Collection ' || c, now() - (c || ' days')::interval, now() - (c || ' days')::interval from generate_series(1, $USERS) u, generate_series(1, 6) c;
insert into public.saves (user_id, id, url, title, note, type, tags, collection_id, is_favorite, created_at, updated_at)
select 'user_' || u, 's' || g, 'https://example.com/' || u || '/' || g, 'Saved item ' || g, repeat('note ', 20), 'article', array['tag' || (g % 9)],
       case when g % 3 = 0 then 'col' || (1 + g % 6) end, g % 7 = 0, now() - (g || ' hours')::interval, now() - (g || ' minutes')::interval
from generate_series(1, $USERS) u, generate_series(1, $PER) g;
analyze;
SQL
echo "rows: $(psql -X -At -d "$DB" -c "select (select count(*) from public.saves) + (select count(*) from public.collections)")"
start=$(date +%s%N)
( echo '\timing on'; cat supabase/migrations/20261106000000_sync_revisions.sql ) | psql -X -v ON_ERROR_STOP=1 -d "$DB" -f - 2>/dev/null | grep '^Time:' | sort -t' ' -k2 -rn | head -3
echo "total: $(( ($(date +%s%N) - start) / 1000000 )) ms"
echo "rows left unnumbered: $(psql -X -At -d "$DB" -c "select count(*) from public.saves where rev = 0")"
