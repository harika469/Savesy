// Verbatim copy of lib/cloudSync.ts at e31bff1 (the sync client in app builds before B2), kept only so the
// rollout test can run the real old client against a B1 server. Only import paths were changed.
import type { Store } from '@/utils/backup';
import { CollectionRow, collectionToRow, mergeStores, rowToCollection, rowToSave, SaveRow, saveToRow, Tombstones } from './sync';
import { getSupabase } from './supabase';

/** `replacedLocal`: the cloud copy should replace this phone's data instead of merging with it. */
export type SyncResult = { remote: Store; userId: string; deletedConfirmed: Tombstones; uploaded: number; replacedLocal: boolean };

/** Turns Supabase/network errors into something a person can act on. */
export function friendlyCloudError(message: string): string {
  if (/fetch|network|timed? ?out|ECONN/i.test(message)) return 'Can’t reach the cloud right now.';
  if (/jwt|jws|token|PGRST301|PGRST302/i.test(message)) return 'Supabase didn’t accept your login. Check that Clerk is added as a third-party auth provider in Supabase.';
  if (/does not exist|could not find the table|schema cache/i.test(message)) return 'The Savesy tables are missing in Supabase. Run supabase/migrations in the SQL editor.';
  if (/invalid api key|apikey/i.test(message)) return 'The Supabase key in this build isn’t valid.';
  return message.endsWith('.') ? message : `${message}.`;
}

function client() {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Cloud sync is not configured.');
  return supabase;
}

const check = <T>({ data, error }: { data: T | null; error: { message: string } | null }) => {
  if (error) throw new Error(error.message);
  return data as T;
};

/**
 * One full round trip: push deletions, pull everything, merge with `local`, push what's newer here.
 * Returns the remote data so the caller can merge it into whatever the app state is *now*.
 */
export async function syncWithCloud(local: Store, tombstones: Tombstones, userId: string, options: { keepCloudIfNotEmpty?: boolean } = {}): Promise<SyncResult> {
  const supabase = client();

  if (tombstones.saves.length) check(await supabase.from('saves').delete().eq('user_id', userId).in('id', tombstones.saves));
  if (tombstones.collections.length) check(await supabase.from('collections').delete().eq('user_id', userId).in('id', tombstones.collections));

  const [savesRes, collectionsRes] = await Promise.all([
    supabase.from('saves').select('*').eq('user_id', userId),
    supabase.from('collections').select('*').eq('user_id', userId),
  ]);
  const remote: Store = {
    saves: check<SaveRow[]>(savesRes).map(rowToSave),
    collections: check<CollectionRow[]>(collectionsRes).map(rowToCollection),
  };

  // Untouched demo content shouldn't be pushed into an account that already has saves.
  const replacedLocal = !!options.keepCloudIfNotEmpty && (remote.saves.length > 0 || remote.collections.length > 0);
  if (replacedLocal) local = { saves: [], collections: [] };
  const { upload } = mergeStores(local, remote, tombstones);
  // Collections first, so saves can reference them.
  if (upload.collections.length) check(await supabase.from('collections').upsert(upload.collections.map(c => collectionToRow(c, userId)), { onConflict: 'user_id,id' }));
  if (upload.saves.length) check(await supabase.from('saves').upsert(upload.saves.map(s => saveToRow(s, userId)), { onConflict: 'user_id,id' }));

  // What the cloud holds now: what we downloaded, replaced by what we just uploaded.
  const withUploads = <T extends { id: string }>(down: T[], up: T[]) => [...new Map([...down, ...up].map(x => [x.id, x])).values()];
  return {
    remote: { saves: withUploads(remote.saves, upload.saves), collections: withUploads(remote.collections, upload.collections) },
    userId, deletedConfirmed: tombstones, uploaded: upload.saves.length + upload.collections.length, replacedLocal,
  };
}
