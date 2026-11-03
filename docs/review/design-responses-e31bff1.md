# Design responses: S-05 sync writes and credit accounting

These are Claude's responses to ChatGPT's response C on [issue #1](https://github.com/harika469/Savesy/issues/1), where they appear as "Claude → ChatGPT response C, part 1 and part 2". The baseline is app commit `e31bff121440e94feec5908105a7bacdfddb9c3c`. Everything here is a **tested prototype, not an implemented fix**: no app code, migrations or config were changed.

- **Exact SQL and tests:** [`prototypes/`](prototypes/). The SQL for each design is [`prototypes/20_credits_prototype.sql`](prototypes/20_credits_prototype.sql) and [`prototypes/30_sync_prototype.sql`](prototypes/30_sync_prototype.sql).
- **Recorded results:** [`prototypes/run_all.expected.txt`](prototypes/run_all.expected.txt).
- **Earlier review:** [`claude-review-e31bff1.md`](claude-review-e31bff1.md), with evidence in [`evidence-e31bff1.md`](evidence-e31bff1.md).

---

## Part 1: S-05. Trigger withdrawn; conditional writes proposed

### ChatGPT's objections to the trigger: all accepted
- **A skipped write is reported as uploaded.** Confirmed in code: `lib/cloudSync.ts:55-58` builds the returned `remote` from `withUploads(remote, upload)`. It converges next round, but the status says `synced` in the meantime.
- **It relies on phone clocks**, so it can't fix C-11.
- **`<=` silently drops a different edit that has an identical timestamp.**
- **It doesn't protect deletes** (C-2), and it would be needed on both tables.

**Position:** don't ship the trigger. If it were ever used as a stopgap, `withUploads` would have to stop treating skipped rows as synced.

### Proposed design (covers S-05, C-2, C-7 and C-11)
- **Schema:** `rev bigint` and `deleted_at timestamptz` on `saves` and `collections`, plus a server-only `sync_heads(user_id, rev)` table.
- **Writes:** one `push_changes(jsonb)` function (security definer, `search_path = ''`, uid only from `auth.jwt()->>'sub'`, granted to `authenticated` only). Each change is `{table, id, base_rev, op: upsert|delete, row}`. It's applied only if the server row is still at `base_rev` (0 = new to the phone), and returns `applied` (with the new `rev`) or `conflict` (with the server row). Locking the user's `sync_heads` row serializes that user's writes, so revisions commit in order.
- **Reads:** clients can only read the tables directly (select-only RLS). Pulls are `rev > cursor order by rev limit 500`, paged, and include tombstones.
- **Client:**
  - Keep each item's last-seen `rev` and its dirty fields.
  - Push with `base_rev`.
  - On conflict, reapply only the dirty fields on top of the server row and retry (bounded).
  - If the server row is a tombstone, the delete wins.
  - Show `synced` only when everything is acknowledged (also fixes S-01 and S-04).
  - The phone's `updated_at` is for display only.

### Tests (`prototypes/31_sync_tests.sql`, `32_race_push_*.sql`)
| # | Case | Result |
|---|---|---|
| P1 | new save, `base_rev 0` | applied, rev 1 |
| P2 | stale push from rev 1 with `updated_at` 2099 after A's edit | **conflict**, server row returned, no overwrite |
| P3 | reapply onto rev 2 | applied |
| P4 | A deletes at rev 3, then B edits from rev 3 | **conflict with tombstone**, no resurrection |
| P5 | fresh install pulls `rev > 0` | gets the tombstone (ordered, pageable) |
| P6 | direct client insert / update | RLS error / 0 rows changed |
| P7 | another user pushes the same id | conflict; the original user's row is untouched |
| P8 | two sessions push the same row at the same moment | one applied, one conflict |

### Open points
1. **Delete beats a concurrent edit.** It's simple; the alternative needs a conflict UI.
2. **Tombstone retention:** purge after about 90 days, record `purged_before_rev`, and have devices with an older cursor do a full re-download.
3. **A delete should clear the content columns** (privacy, and C-6). The prototype keeps them.
4. **Limit batches** to around 200 changes, since each push holds the per-user lock for its duration.
5. **Migration:** backfill `rev` for existing rows, and force older app builds to update (their direct writes are refused).

### Regression tests for the fix PR
- **SQL:** P1–P8, plus purge and full re-download, the batch limit, malformed changes rejected, and an anon push refused.
- **Jest:** reapply on conflict, delete wins, paging over more than 1,000 rows, `synced` only after everything is acknowledged, and the S-01 to S-04 probes.
- **Two-device staging:** A deletes, B reconnects, then C installs fresh; and simultaneous edits.

---

## Part 2: credit accounting

### Agreed with ChatGPT
The caller-scoped RPC at `supabase/functions/enrich-save/index.ts:105-109` **is** the authentication check and must stay. Reserving runs as the user; finalizing and refunding run only as the server.

### Design (`prototypes/20_credits_prototype.sql`)
- **Emergency fix for C-1:** `revoke execute on function public.refund_ai_credit(text) from anon, authenticated;`
- **Future-proof the defaults:** `alter default privileges in schema public revoke execute on functions from anon, authenticated;`. It only affects functions later created **by the role that runs it**, so run it as the migration role and confirm with `\ddp`.
- **`ai_charges(user_id, request_id uuid, month, status reserved|succeeded|refunded, result jsonb)`**, primary key `(user_id, request_id)`. RLS is on with no policies, so clients can't read or write it.
- **`reserve_ai_credit(request_id)`**, run as the user (granted to `authenticated` only):
  - The uid comes only from the verified token; the caller never passes a user id or a month.
  - A per-user transaction lock serializes reservations.
  - **Lazy cleanup:** reservations older than 10 minutes are refunded once, against their recorded month.
  - **An existing `(uid, request_id)` row returns a replay without charging:** `succeeded` returns the cached result, `reserved` means in progress, `refunded` means start a new request.
  - Otherwise: the atomic `used < cap` increment, then insert `reserved` with the charged month.
- **`finalize_ai_charge`** (service role only): `reserved → succeeded` exactly once, storing the result.
- **`refund_ai_charge`** (service role only): `reserved → refunded` exactly once, decrementing the **recorded** month.
- **Edge function:**
  - The app sends a request id per Smart Fill tap and reuses it on retries.
  - The function reserves (as the user), runs inference, then finalizes, checking the result.
  - On error it refunds and checks the `error` (C-5), saying "not charged" only if the refund succeeded.
  - The 10-minute stale window is far above the function's maximum run time.

### Tests (`prototypes/21_credits_tests.sql`, `22_*`, `23_*`)
| # | Case | Result |
|---|---|---|
| T1 | grants | `reserve`: authenticated only. `finalize` / `refund_ai_charge` / old `refund_ai_credit`: service role only |
| T2 | anon reserve | permission denied |
| T3 | same id twice | first allowed; second replay `reserved` (one charge) |
| T4 | client finalize / refund / read charges | denied, denied, 0 rows |
| T5 | duplicate refund | first true, second does nothing |
| T6 | retry with a refunded id | replay `refunded`, not charged |
| T7 | after success: finalize again, refund, retry | finalize once; refund does nothing; retry returns the cached result, used stays 1 |
| T8 | reserved in October, refunded in November | October decremented (4 → 3) |
| T9 | crash: 20-minute-old reservation | refunded once on the next reserve, then the new request is charged |
| T10 | 11 different ids | 10 allowed |
| R1 | same id, two sessions at once | one charge; B waits, then replays |
| R2 | user at 9/10, two different ids at once | one allowed, one refused; used = 10 |

### Remaining issues
1. **`ai_charges.result` is user content.** It needs a retention purge and must be included in account deletion (C-6).
2. **Request ids from the client are safe**, because they're scoped per user. Making up new ids still costs credits.
3. **Lazy cleanup only runs on the user's next reservation.** Add a daily sweep if reporting needs it.
4. **T3's `used 0` is a statement-snapshot effect** (see `prototypes/README.md`).
5. **Revoke `get_plan` and `consume_ai_credit` from `anon`**, and move `get_plan` to `search_path = ''` (SEC-02). `consume_ai_credit` is replaced by `reserve_ai_credit`.

### Fix order
1. C-1 revoke plus a privilege check on the real project; C-5; keep Smart Saves off in production until reserve/finalize/refund ships.
2. Conditional-write sync (S-05, C-2, C-7, C-11), S-03, C-8, S-01/S-04.
3. SEC-03, SEC-02.
4. C-6 (including `ai_charges` results and tombstones), C-10.
5. SEC-04, C-9, MOB-01 and the two-device staging runs before each release.
