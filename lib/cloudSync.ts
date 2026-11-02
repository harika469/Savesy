import type { Store } from '@/utils/backup';
import { CollectionRow, collectionToRow, mergeStores, rowToCollection, rowToSave, SaveRow, saveToRow, Tombstones } from '@/utils/sync';
import { getSupabase } from './supabase';

export type SyncResult = { remote: Store; userId: string; deletedConfirmed: Tombstones; uploaded: number };

/** Turns Supabase/network errors into something a person can act on. */
export function friendlyCloudError(message: string): string {
  if (/fetch|network|timed? ?out|ECONN/i.test(message)) return 'Can’t reach the cloud right now.';
  if (/anonymous sign-ins are disabled/i.test(message)) return 'Anonymous sign-ins are turned off in Supabase (Authentication → Sign In / Providers).';
  if (/does not exist|could not find the table|schema cache/i.test(message)) return 'The Savesy tables are missing in Supabase. Run supabase/migrations in the SQL editor.';
  if (/invalid api key|jwt|apikey/i.test(message)) return 'The Supabase key in this build isn’t valid.';
  return message.endsWith('.') ? message : `${message}.`;
}

async function ensureUser() {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Cloud sync is not configured.');
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) return { supabase, userId: session.user.id };
  // No account needed: each phone gets its own anonymous Supabase user.
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) throw new Error(error?.message ?? 'Could not sign in to the cloud.');
  return { supabase, userId: data.user.id };
}

const check = <T>({ data, error }: { data: T | null; error: { message: string } | null }) => {
  if (error) throw new Error(error.message);
  return data as T;
};

/**
 * One full round trip: push deletions, pull everything, merge with `local`, push what's newer here.
 * Returns the remote data so the caller can merge it into whatever the app state is *now*.
 */
export async function syncWithCloud(local: Store, tombstones: Tombstones): Promise<SyncResult> {
  const { supabase, userId } = await ensureUser();

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

  const { upload } = mergeStores(local, remote, tombstones);
  // Collections first, so saves can reference them.
  if (upload.collections.length) check(await supabase.from('collections').upsert(upload.collections.map(c => collectionToRow(c, userId)), { onConflict: 'user_id,id' }));
  if (upload.saves.length) check(await supabase.from('saves').upsert(upload.saves.map(s => saveToRow(s, userId)), { onConflict: 'user_id,id' }));

  // What the cloud holds now: what we downloaded, replaced by what we just uploaded.
  const withUploads = <T extends { id: string }>(down: T[], up: T[]) => [...new Map([...down, ...up].map(x => [x.id, x])).values()];
  return {
    remote: { saves: withUploads(remote.saves, upload.saves), collections: withUploads(remote.collections, upload.collections) },
    userId, deletedConfirmed: tombstones, uploaded: upload.saves.length + upload.collections.length,
  };
}
