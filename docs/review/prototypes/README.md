# Prototypes and tests for the S-05 and credit-accounting designs

These files are **review material only**. They are not migrations: `supabase/migrations/` is untouched, and nothing here is deployed or run by the app or `npm test`. They back the design responses in [`../design-responses-e31bff1.md`](../design-responses-e31bff1.md) and on [issue #1](https://github.com/harika469/Savesy/issues/1).

**Baseline:** app commit `e31bff121440e94feec5908105a7bacdfddb9c3c`. The scripts apply the three migrations from `supabase/migrations/` as they are at that commit.

## Run

You need PostgreSQL 16 (`psql`, `createdb` and `dropdb` on `PATH`) and a superuser connection. From the repo root:

```bash
PGHOST=... PGPORT=... PGUSER=postgres docs/review/prototypes/run_all.sh
```

It creates a fresh database `savesy_review`, emulates a new Supabase project, applies the migrations, then runs everything below. The output recorded at the time of commit is in [`run_all.expected.txt`](run_all.expected.txt). `ERROR` lines in that output are **expected refusals** (permission denied or row-level security), each one under the test that checks for it.

## Files

| File | What it is |
|---|---|
| `00_emulate_supabase.sql` | Supabase emulation: `anon` / `authenticated` / `service_role` roles, `auth.jwt()`, **Supabase's default privileges on `public`**, then the three migrations at `e31bff1` |
| `10_c1_refund_exposure.sql` | Reproduces **C-1** at `e31bff1`: anyone can run `refund_ai_credit`, and a user refunds themselves back to 0 |
| `20_credits_prototype.sql` | **Credit design:** C-1 revoke, changed default privileges, `ai_charges`, `reserve_ai_credit` (as the user), `finalize_ai_charge` / `refund_ai_charge` (server only) |
| `21_credits_tests.sql` | T1–T10: grants, anon refused, same-id replay, client can't finalize or refund, refund exactly once, refunded id not re-charged, cached result replay, month rollover, stale reservation cleanup, cap |
| `22_race_same_id_{A,B}.sql` | R1: two sessions reserve the **same** request id at the same moment |
| `23_race_cap_{A,B}.sql` | R2: user at 9/10, two **different** ids at the same moment |
| `30_sync_prototype.sql` | **Sync design:** `rev` / `deleted_at`, `sync_heads`, read-only RLS, `push_changes` (conditional write, applied or conflict per change) |
| `31_sync_tests.sql` | P1–P7: insert, stale conflict with a future clock, rebase, delete beats a late edit, tombstone pull, direct writes refused, cross-user isolation |
| `32_race_push_{A,B}.sql` | P8: two sessions push the same row from the same revision at the same moment |
| `run_all.sh` | Runs all of the above in order on a fresh database |

## Notes for reviewers
- **T3 shows `used 0`.** `get_plan()` is `STABLE`, so when it's evaluated in the *same* SELECT as two `reserve_ai_credit` calls, it sees the statement's starting snapshot. T5, T7, R1 and R2 check the counts properly.
- **The race tests use timing.** Session A holds its transaction open with `pg_sleep(1.5)` while B runs. The results only prove ordering when B starts during that window (the script waits 0.3 s before starting B).
- **This is plain PostgreSQL emulating Supabase, not a Supabase project.** Grants, RLS and functions behave the same, but PostgREST, the Supabase gateway and Clerk tokens are not exercised. Those still need a staging project (SEC-04).
