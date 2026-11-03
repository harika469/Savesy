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

So an old app can't damage server data, but its unsynced changes wait until the person updates.

## Order
1. **Staging:** apply all migrations (`20261105*`, then `20261106000000`). Run `npm run test:db` locally and `supabase/tests/staging/check_grants.sql` in the staging SQL editor.
2. **Build the B2 app with sync OFF** (`EXPO_PUBLIC_CLOUD_SYNC_ENABLED` unset). Install it on the internal devices. Nothing syncs yet; local data migrates to the new format on first launch.
3. **Build with sync ON, pointed at staging**, and run the B3 checks: two-device sync, account switching, offline and recovery, Android cold and warm start, real Clerk tokens.
4. **Owner decision (go/no-go).** If anything fails, ship the **local-only beta**: the same app with sync OFF. Saving, collections, search, share-to-Savesy and backups all work.
5. **Production** (only after approval): apply the migrations, then distribute the sync-ON build. Ask anyone with an older build to update first, because their unsynced changes wait until they do.

## Rollback
- **App:** ship the sync-OFF build. Each phone's data stays on the phone.
- **Server:** see the footer of the B1 migration. It's clean only before any phone has synced through `push_changes`; after that, rolling back loses deletion records, so prefer the app-side switch.
