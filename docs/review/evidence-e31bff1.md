# Evidence for the Claude review of `e31bff1`

Everything below was run against commit `e31bff121440e94feec5908105a7bacdfddb9c3c` with an unmodified working tree. Nothing here is part of the app or the test suite. These files are kept as Markdown so `npm test` and `tsc` don't pick them up. After approval, the probes can become regression tests in a fix PR.

Findings: [`claude-review-e31bff1.md`](claude-review-e31bff1.md). Discussion: [issue #1](https://github.com/harika469/Savesy/issues/1).

## 1. Sync race probes (S-01 to S-04)

They render the real `SavesProvider` with `syncWithCloud` replaced by a fake that can pause a sync mid-flight. To run them, save the block as `races.test.tsx` **outside** the repo, then from the repo root:

```bash
npx jest --rootDir "$PWD" --roots "$PWD" /path/to/dir --modulePaths "$PWD/node_modules" --testPathPattern races
```

Result at `e31bff1` (the `act()` warnings printed after the run are React test noise, not failures):

```
✓ S-01: syncNow during an in-flight sync resolves false immediately (does not await)
✓ S-02: a sync started for A that finishes after switching to B does not touch B
✓ S-03: a save added while the first-sign-in demo replacement is in flight is lost
✓ S-04: status says synced while an edit made during the sync has not been uploaded
```

````tsx
/**
 * Review probes for issue #1 (ChatGPT S-01..S-04). Runs the real SavesProvider at e31bff1
 * with syncWithCloud replaced by a controllable fake, so in-flight syncs can be paused.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

type Call = { local: any; tomb: any; uid: string; opts: any; resolve: (r: any) => void; reject: (e: any) => void };
const mockCalls: Call[] = [];
jest.mock('@/lib/cloudSync', () => ({
  friendlyCloudError: (m: string) => m,
  syncWithCloud: (local: any, tomb: any, uid: string, opts: any) => new Promise((resolve, reject) => { mockCalls.push({ local, tomb, uid, opts, resolve, reject }); }),
}));
jest.mock('@/lib/supabase', () => ({ cloudConfigured: true, authConfigured: true }));
jest.mock('@react-native-async-storage/async-storage', () => {
  const mem = new Map<string, string>();
  return { __esModule: true, default: {
    getItem: async (k: string) => mem.get(k) ?? null,
    setItem: async (k: string, v: string) => { mem.set(k, v); },
    clear: () => mem.clear(),
  } };
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import { SavesProvider, useSaves } from '@/context/SavesContext';

let ctx: ReturnType<typeof useSaves>;
function Probe() { ctx = useSaves(); return null; }
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); }); };
const result = (remote: any, over: any = {}) => ({ remote, userId: 'x', deletedConfirmed: { saves: [], collections: [] }, uploaded: 0, replacedLocal: false, ...over });
const remoteSave = (id: string) => ({ id, url: `https://r.com/${id}`, title: id, type: 'other', tags: [], isFavorite: false, createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z' });

async function mount(userId: string | null | undefined) {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<SavesProvider userId={userId}><Probe /></SavesProvider>); });
  await flush();
  return r;
}

beforeEach(() => { mockCalls.length = 0; (AsyncStorage as any).clear(); });

test('S-01: syncNow during an in-flight sync resolves false immediately (does not await)', async () => {
  await mount('user_A');
  expect(mockCalls).toHaveLength(1); // sign-in sync in flight
  let settled: boolean | undefined;
  await act(async () => { ctx.syncNow().then(v => { settled = v; }); });
  await flush();
  expect(settled).toBe(false);            // reported as "not synced"…
  await act(async () => { mockCalls[0].resolve(result({ saves: [], collections: [] })); });
  await flush();
  expect(ctx.cloud.state).not.toBe('error'); // …even though the sync it raced with succeeded
});

test('S-02: a sync started for A that finishes after switching to B does not touch B', async () => {
  const r = await mount('user_A');
  expect(mockCalls[0].uid).toBe('user_A');
  await act(async () => { r.update(<SavesProvider userId="user_B"><Probe /></SavesProvider>); });
  await flush();
  expect(ctx.saves).toHaveLength(0); // switch cleared A's local data
  await act(async () => { mockCalls[0].resolve(result({ saves: [remoteSave('A_secret')], collections: [] }, { userId: 'user_A' })); });
  await flush();
  expect(ctx.saves.map(s => s.id)).not.toContain('A_secret'); // stale A result discarded (SavesContext.tsx:109)
  expect(mockCalls[1].uid).toBe('user_B');                      // queued rerun is for B
  expect(mockCalls[1].local.saves).toHaveLength(0);              // and B's upload carries none of A's data
});

test('S-03: a save added while the first-sign-in demo replacement is in flight is lost', async () => {
  await mount('user_A'); // fresh install: demo untouched -> keepCloudIfNotEmpty
  expect(mockCalls[0].opts.keepCloudIfNotEmpty).toBe(true);
  await act(async () => { ctx.addSave({ url: 'https://new.com', title: 'Saved during sync', type: 'other', tags: [] }); });
  expect(ctx.saves.some(s => s.title === 'Saved during sync')).toBe(true);
  await act(async () => { mockCalls[0].resolve(result({ saves: [remoteSave('cloud_1')], collections: [] }, { replacedLocal: true })); });
  await flush();
  expect(ctx.saves.map(s => s.title)).toEqual(['cloud_1']); // the new save is gone
});

test('S-04: status says synced while an edit made during the sync has not been uploaded', async () => {
  jest.useFakeTimers();
  try {
    await mount('user_A');
    await act(async () => { mockCalls[0].resolve(result({ saves: [], collections: [] })); });
    await flush();
    // second sync in flight, user edits meanwhile
    await act(async () => { ctx.syncNow(); });
    await act(async () => { ctx.addSave({ url: 'https://e.com', title: 'edit during sync', type: 'other', tags: [] }); });
    await act(async () => { mockCalls[1].resolve(result({ saves: [], collections: [] })); });
    await flush();
    expect(mockCalls[1].local.saves.some((s: any) => s.title === 'edit during sync')).toBe(false); // not in that upload
    expect(ctx.cloud.state).toBe('synced');                                                     // yet shown as synced
    await act(async () => { jest.advanceTimersByTime(1600); });
    await flush();
    expect(mockCalls).toHaveLength(3);                                                           // debounced follow-up starts ~1.5s later
    expect(ctx.cloud.state).toBe('syncing');
  } finally { jest.useRealTimers(); }
});
````

## 2. Merge and private-address probes (C-2, C-3 / SEC-03)

Run with `npx tsx --tsconfig <repo>/tsconfig.json probe.ts` (adjust the import paths).

````ts
import { mergeStores } from '/home/user/Savesy/utils/sync';
import { isSafePublicUrl } from '/home/user/Savesy/supabase/functions/_shared/enrich';
const save = (id: string, updatedAt: string) => ({ id, url: `https://x.com/${id}`, title: id, type: 'other' as const, tags: [], isFavorite: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt });

// F: cross-device delete. Phone A deleted "a" and the cloud confirmed it. Phone B never saw the delete.
const phoneB = { saves: [save('a', '2026-01-01T00:00:00Z'), save('b', '2026-01-01T00:00:00Z')], collections: [] };
const cloudAfterA = { saves: [save('b', '2026-01-01T00:00:00Z')], collections: [] };
const r = mergeStores(phoneB, cloudAfterA);
console.log('B keeps:', r.store.saves.map(s => s.id), '| B uploads:', r.upload.saves.map(s => s.id));

// SSRF: hostname-only checks
for (const u of ['http://127.0.0.1.nip.io/', 'http://2130706433/', 'http://0x7f.1/', 'http://[::ffff:127.0.0.1]/', 'http://localtest.me/', 'http://169.254.169.254.nip.io/'])
  console.log('isSafePublicUrl', u, '->', isSafePublicUrl(u), '| parsed host:', new URL(u).hostname);
````

Output at `e31bff1`:

```
B keeps: [ 'a', 'b' ] | B uploads: [ 'a' ]
isSafePublicUrl http://127.0.0.1.nip.io/ -> true | parsed host: 127.0.0.1.nip.io
isSafePublicUrl http://2130706433/ -> false | parsed host: 127.0.0.1
isSafePublicUrl http://0x7f.1/ -> false | parsed host: 127.0.0.1
isSafePublicUrl http://[::ffff:127.0.0.1]/ -> false | parsed host: [::ffff:7f00:1]
isSafePublicUrl http://localtest.me/ -> true | parsed host: localtest.me
isSafePublicUrl http://169.254.169.254.nip.io/ -> true | parsed host: 169.254.169.254.nip.io
```

## 3. Database: Supabase-like setup and privileges (C-1 / SEC-01)

This runs on a **fresh, empty** PostgreSQL 16 database. It emulates a new Supabase project: the `anon`, `authenticated` and `service_role` roles, an `auth` schema with `auth.jwt()`, and Supabase's **default privileges on `public`**. It then applies the three migrations from `supabase/migrations/` (adjust the `\i` paths).

```sql
\set ON_ERROR_STOP on
-- Emulate a fresh Supabase project: auth schema, roles, and Supabase's default privileges on public.
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema auth; create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
\i /tmp/savesy-pgtest/20261102000000_savesy_schema.sql
\i /tmp/savesy-pgtest/20261103000000_clerk_auth.sql
\i /tmp/savesy-pgtest/20261104000000_smart_saves.sql
\echo '--- who can execute refund_ai_credit:'
select r.rolname, has_function_privilege(r.rolname, 'public.refund_ai_credit(text)', 'execute') from pg_roles r where r.rolname in ('anon','authenticated','service_role');
\echo '--- attacker (signed-in user_X) burns 10 credits, then refunds themselves:'
set role authenticated; set request.jwt.claims = '{"sub":"user_X"}';
select count(*) filter (where (consume_ai_credit())->>'allowed' = 'true') as allowed_of_10 from generate_series(1,10);
select (consume_ai_credit())->>'allowed' as eleventh_allowed;
select refund_ai_credit('user_X') from generate_series(1,10);
select (consume_ai_credit())->>'allowed' as allowed_after_self_refund, get_plan();
\echo '--- anon can also call it for any user id:'
reset role; set role anon; select refund_ai_credit('user_someone_else'); reset role;
```

Output at `e31bff1`:

```
--- who can execute refund_ai_credit:
 authenticated | t
 anon          | t
 service_role  | t
--- attacker (signed-in user_X) burns 10 credits, then refunds themselves:
 allowed_of_10 = 10
 eleventh_allowed = false
 (refund_ai_credit('user_X') x10)
 allowed_after_self_refund = true | {"plan": "free", "used": 0, "limit": 10}
--- anon can also call it for any user id:
 (succeeds)
```

### 3b. Row-level security under the same defaults (what held up)

```sql
set role authenticated; set request.jwt.claims = '{"sub":"user_X"}';
\echo '--- self-grant Pro:'
insert into entitlements (user_id) values ('user_X');
\echo '--- reset own usage directly:'
update ai_usage set used = 0 where user_id = 'user_X';
select 'rows updated visible as' as note, used from ai_usage where user_id = 'user_X';
\echo '--- write a save into another user:'
insert into saves (user_id, id, url, title) values ('user_Y', 'z', 'https://a', 'x');
reset role; set role anon;
\echo '--- anon reads saves:'
select count(*) from saves;
```

Output: inserting into `entitlements` gets an RLS error; the direct `ai_usage` update changes nothing (`used` stays 1); inserting a save for `user_Y` gets an RLS error; `anon` sees 0 saves.

### 3c. Stale upsert, candidate trigger, refund month and search_path (S-05, SEC-01, SEC-02)

This runs in the same database after 3. The trigger here was tested **only in the scratch database**. It is not in the repo.

```sql
\set ON_ERROR_STOP on
set role authenticated; set request.jwt.claims = '{"sub":"user_S"}';
\echo '--- S-05: phone A writes the newer version (12:00); phone B then upserts an older snapshot (11:00)'
insert into saves (id, url, title, updated_at) values ('s', 'https://a.com', 'NEWER from phone A', '2026-11-03T12:00:00Z');
insert into saves (id, url, title, updated_at) values ('s', 'https://a.com', 'older from phone B', '2026-11-03T11:00:00Z')
  on conflict (user_id, id) do update set title = excluded.title, updated_at = excluded.updated_at;
select title, updated_at from saves where id = 's';
reset role;
\echo '--- candidate minimal fix (scratch DB only): keep the stored row when the incoming one is not newer'
create or replace function public.keep_newer_save() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.updated_at <= old.updated_at then return null; end if;  -- skip stale write
  return new;
end $$;
create trigger saves_keep_newer before update on public.saves for each row execute function public.keep_newer_save();
set role authenticated; set request.jwt.claims = '{"sub":"user_S"}';
update saves set title = 'NEWER from phone A', updated_at = '2026-11-03T12:00:00Z' where id = 's';
insert into saves (id, url, title, updated_at) values ('s', 'https://a.com', 'older from phone B', '2026-11-03T11:00:00Z')
  on conflict (user_id, id) do update set title = excluded.title, updated_at = excluded.updated_at;
select 'with trigger' as run, title, updated_at from saves where id = 's';
insert into saves (id, url, title, updated_at) values ('s', 'https://a.com', 'even newer', '2026-11-03T13:00:00Z')
  on conflict (user_id, id) do update set title = excluded.title, updated_at = excluded.updated_at;
select 'newer still applies' as run, title from saves where id = 's';
reset role;
\echo '--- SEC-01: direct consume by a signed-in user only affects that user'
set role authenticated; set request.jwt.claims = '{"sub":"user_Q"}';
select consume_ai_credit()->>'user_id' as consumed_for;
reset role;
\echo '--- SEC-01: refund always targets the CURRENT month (charge recorded in October, refund in November)'
insert into ai_usage (user_id, month, used) values ('user_M', date_trunc('month', now() - interval '1 month')::date, 5);
select refund_ai_credit('user_M');
select month, used from ai_usage where user_id = 'user_M' order by month;
\echo '--- SEC-02: schema privileges relevant to search_path hijack'
select r, has_schema_privilege(r, 'public', 'CREATE') as can_create_in_public from unnest(array['anon','authenticated']) r;
select proname, proconfig from pg_proc where proname in ('get_plan','consume_ai_credit','refund_ai_credit');
```

Output at `e31bff1`:

```
S-05 without trigger: title = "older from phone B" @ 11:00   (newer 12:00 row overwritten)
with trigger:         title = "NEWER from phone A" @ 12:00   (stale write skipped)
newer still applies:  title = "even newer"
SEC-01 direct consume: consumed_for = user_Q (caller only)
SEC-01 refund month:   2026-10-01 | 5   (October charge not refunded; refund targets current month)
SEC-02: anon / authenticated CREATE on public = f / f; functions have search_path=public
```

Anon key used as the bearer token (SEC-04): `set role anon; select consume_ai_credit();` gives `ERROR: not signed in`, so the edge function returns 401 (`enrich-save/index.ts:108`).
