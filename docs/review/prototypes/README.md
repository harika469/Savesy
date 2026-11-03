# Prototypes and tests for the S-05 and credit-accounting designs (v2)

These files are **review material only**. They are not migrations: `supabase/migrations/` is untouched, and nothing here is deployed or run by the app or `npm test`. They back [`../design-responses-e31bff1.md`](../design-responses-e31bff1.md) and the discussion on [issue #1](https://github.com/harika469/Savesy/issues/1).

**Baseline:** app commit `e31bff121440e94feec5908105a7bacdfddb9c3c`. The scripts apply the three migrations from `supabase/migrations/` as they are at that commit. v1 of these prototypes is at commit `3fcf7fd`; v2 addresses ChatGPT's review of v1.

## Run

You need PostgreSQL 16 (`psql`, `createdb` and `dropdb` on `PATH`), a superuser connection, and Node 18 or newer. From anywhere in the repo:

```bash
PGHOST=... PGPORT=... PGUSER=postgres docs/review/prototypes/run_all.sh
```

- It creates a **uniquely named** disposable database (`savesy_review_<epoch>_<pid>`) and **drops it on exit**. It never touches an existing database.
- It runs with `set -euo pipefail` and `psql -v ON_ERROR_STOP=1` everywhere. Every check is an assertion (`pg_temp.ok`, or `pg_temp.fails`, which requires an exact SQLSTATE). **Any unexpected error or failed assertion stops the run with a non-zero exit code.** The last line on success is `ALL PASSED`.
- Race tests start session A in the background, **wait until A is actually holding its transaction open** (polled in `pg_stat_activity`, not a fixed sleep), run session B (which must block on A's lock and then assert its own outcome), and then `wait` for A.
- [`run_all.expected.txt`](run_all.expected.txt) is the recorded output: 92 `ok` lines and 0 failures.

## Files

| File | What it is |
|---|---|
| `00_emulate_supabase.sql` | Supabase emulation: `anon` / `authenticated` / `service_role` roles, `auth.jwt()`, **Supabase's default privileges on `public`**, then the three migrations at `e31bff1` |
| `05_assert.sql` | Assertion helpers `pg_temp.ok(cond, label)` and `pg_temp.fails(sql, sqlstate, label)` |
| `10_c1_refund_exposure.sql` | Reproduces **C-1** at `e31bff1` as assertions |
| `20_credits_prototype.sql` | **Credit design v2:** C-1 revoke, changed default privileges, `ai_charges` with request fingerprint and lease, `reserve_ai_credit` (as the user), `finalize_ai_charge` (returns a status) and `refund_ai_charge` (server only) |
| `21_credits_tests.sql` | T1–T13: grants, anon refused, same-id replay, **reused id with different input rejected**, client can't finalize or refund, refund exactly once, refunded id not re-charged, cached-result replay, unknown id, month rollover, expired lease, **late success re-charged / uncharged**, cap |
| `22_*`, `23_*`, `24_race_checks.sql` | R1 (same id, concurrent) and R2 (9/10, two ids, concurrent), with the final counts asserted |
| `30_sync_prototype.sql` | **Sync design v2:** strict validation before any write, `push_changes` (applied, conflict or noop, with the stored row), `get_sync_head()` high-water mark, collection delete detaches its saves, tombstones scrubbed |
| `31_sync_tests.sql` | V1–V12 validation; P1–P4 conditional writes and tombstones; P6 direct writes; P7 per-user isolation; P9 unknown delete; P10 collection delete and detach; P11 consistent paged pulls with concurrent writes; P12 anon |
| `32_race_push_{A,B}.sql` | P8: two sessions push the same row from the same revision at the same moment |
| `40_client_rebase.mjs` | Client rebase after a conflict (three-way merge, delete wins, set-merge tags), with tests (`node`) |
| `run_all.sh` | Runs everything above |

## Notes for reviewers
- **This is plain PostgreSQL emulating Supabase, not a Supabase project.** Grants, RLS and the SQL functions behave the same, but PostgREST, the gateway and Clerk tokens are not exercised. Those need staging (SEC-04), and C-1 must be checked on the real project with `has_function_privilege`.
- **`alter default privileges`** in `20` only affects functions created later **by the role that runs it**. On the real project, run it as the migration role and check `\ddp`.
- **Timestamps:** `run_all.sh` must be run on a database server whose clock is correct, because month-boundary tests use `now()`.
