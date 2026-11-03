# Sync rollout runbook (B1 server + B2 client)

**Status: not started. Every step needs the owner's approval. Do not run any step against production until it has passed on staging.**

B1 (`supabase/migrations/20261106000000_sync_revisions.sql`) and B2 (this app version) only work together. The server change stops older app versions from writing (by design), so the order matters.

## What an older app version does after the server change
Verified in `__tests__/rollout.test.ts` (the real sync client from `e31bff1` against B1's rules):

| Situation on the old app | Result |
|---|---|
| Nothing to upload | Syncs normally; deleted saves are **not** shown as blank items (B1 hides tombstones from direct reads) |
| Still has a save deleted elsewhere | Its re-upload is refused; the delete is not undone; the old app's own data is untouched |
| Has an unsynced edit | Refused loudly ("Couldn't sync"); the server keeps its data; the edit stays on that phone |
| Has an unsynced delete | Refused; nothing is hard-deleted |
| **After updating the app** | Its library migrates; nothing is lost; old-app edits and saves deleted elsewhere appear as *changed on another device* for the person to decide |

So an old app can't damage server data, but it is **not fully compatible**: from the moment B1 is applied it can no longer upload, and any change made on it waits on that phone until the person updates.

### Upgrade instructions for testers on an older build
1. **Before the server change:** open the old app while online and wait for *Synced* (Settings shows the time). Anything unsynced at that moment can only be uploaded after updating.
2. **After the server change:** the old app shows *Couldn't sync* on any edit. Install the new build **over** the old one (update, don't uninstall first).
3. On first launch the new build migrates the library and syncs. Anything edited in the old app that was also changed elsewhere shows as *changed on another device* for the person to decide. Nothing is chosen automatically.

### Limits (stated honestly)
- **Uninstalling the old app, or clearing its data, before updating deletes its unsynced changes.** They only ever existed on that phone. Tell testers not to do this.
- A tester who never updates keeps working locally, but nothing they change reaches the cloud or their other phones.
- Rolling the server back after phones have used `push_changes` loses deletion records (see Rollback).

## Automated end-to-end checks (B3, no staging needed)
`npm run test:e2e` (needs a local PostgreSQL; see `__tests__/e2e.pg.test.ts`) runs the real sync client and its Supabase transport against real PostgreSQL with every migration applied, through a PostgREST-like layer (one transaction per call, role `authenticated`, JWT claims). It covers:
- two phones;
- isolation between accounts and anonymous requests;
- deleting a collection with 1,200 saves;
- purges before, during and between download pages, including a purge before every page until the client gives up, and then recovers;
- a download that fails partway;
- "keep mine" as the only way a restore is sent;
- stale-base deletes;
- six seeded runs of a multi-page full re-download while another phone edits, deletes, adds and deletes collections, and the retention job purges, between every page. Every intermediate state is checked: an unsynced change is never dropped before the server has it. At the end both phones equal the server.

They do **not** replace step 3: real Clerk tokens through Supabase's gateway, real devices and networks, and the migration's run time on staging data.

## Order
1. **Staging:** apply all migrations (`20261105*`, then `20261106000000`). Run `npm run test:db` locally and `supabase/tests/staging/check_grants.sql` in the staging SQL editor.
2. **Build the B2 app with sync OFF** (`EXPO_PUBLIC_CLOUD_SYNC_ENABLED` unset). Install it on the internal devices. Nothing syncs yet; local data migrates to the new format on first launch.
3. **Build with sync ON, pointed at staging**, and run the B3 checks: two-device sync, account switching, offline and recovery, Android cold and warm start, real Clerk tokens.
4. **Owner decision (go/no-go).** If anything fails, ship the **local-only beta**: the same app with sync OFF. Saving, collections, search, share-to-Savesy and backups all work.
5. **Production** (only after approval): apply the migrations, then distribute the sync-ON build. Ask anyone with an older build to update first, because their unsynced changes wait until they do.

## Rollback
- **App:** ship the sync-OFF build. Each phone's data stays on the phone.
- **Server:** see the footer of the B1 migration. It's clean only before any phone has synced through `push_changes`; after that, rolling back loses deletion records, so prefer the app-side switch.
