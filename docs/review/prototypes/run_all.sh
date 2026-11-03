#!/usr/bin/env bash
# Re-runs every prototype and test on a fresh database. Usage (from repo root):
#   PGHOST=... PGPORT=... PGUSER=postgres docs/review/prototypes/run_all.sh
set -u
P="psql -X -q -v ON_ERROR_STOP=0 -d savesy_review"
D=docs/review/prototypes
dropdb --if-exists savesy_review && createdb savesy_review
psql -X -q -v ON_ERROR_STOP=1 -d savesy_review -f $D/00_emulate_supabase.sql >/dev/null
echo '##### 10 C-1 exposure at e31bff1';            $P -f $D/10_c1_refund_exposure.sql
psql -X -q -v ON_ERROR_STOP=1 -d savesy_review -f $D/20_credits_prototype.sql && echo '##### 20 credits prototype applied'
echo '##### 21 credit tests';                       $P -f $D/21_credits_tests.sql
echo '##### 22 R1 same id, concurrent';             ($P -At -f $D/22_race_same_id_A.sql &); sleep 0.3; $P -At -f $D/22_race_same_id_B.sql; sleep 1.5
$P -At -c "select 'r1 charges', count(*) from ai_charges where user_id='r1'; select 'r1 used', used from ai_usage where user_id='r1';"
echo '##### 23 R2 at 9/10, two ids concurrent';     $P -c "insert into ai_usage values ('r2', date_trunc('month', now())::date, 9);"
($P -At -f $D/23_race_cap_A.sql &); sleep 0.3; $P -At -f $D/23_race_cap_B.sql; sleep 1.5
$P -At -c "select 'r2 used', used from ai_usage where user_id='r2'; select 'r2 charges', count(*) from ai_charges where user_id='r2';"
psql -X -q -v ON_ERROR_STOP=1 -d savesy_review -f $D/30_sync_prototype.sql && echo '##### 30 sync prototype applied'
echo '##### 31 sync tests';                         $P -f $D/31_sync_tests.sql
echo '##### 32 P8 concurrent push of the same row'
$P -At -c "set role authenticated; set request.jwt.claims = '{\"sub\":\"uC\"}'; select push_changes('[{\"table\":\"saves\",\"id\":\"c1\",\"base_rev\":0,\"op\":\"upsert\",\"row\":{\"url\":\"https://c.com\",\"title\":\"v1\"}}]')->0->>'rev';"
($P -At -f $D/32_race_push_A.sql &); sleep 0.3; $P -At -f $D/32_race_push_B.sql; sleep 1.5
$P -At -c "select 'final', title, rev from saves where user_id='uC';"
