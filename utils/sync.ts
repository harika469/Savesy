import { Collection, SavedItem, SaveType } from '@/types';
import type { Store } from './backup';

export type Tombstones = { saves: string[]; collections: string[] };
export const emptyTombstones = (): Tombstones => ({ saves: [], collections: [] });

/** A deleted id that is back on the phone (re-added, restored, demo reset) is no longer deleted. */
export function liveTombstones(local: Store, t: Tombstones): Tombstones {
  const saves = new Set(local.saves.map(s => s.id)); const collections = new Set(local.collections.map(c => c.id));
  return { saves: t.saves.filter(id => !saves.has(id)), collections: t.collections.filter(id => !collections.has(id)) };
}

export type SaveRow = {
  user_id?: string; id: string; url: string; title: string; note: string | null; type: SaveType; source: string | null;
  image_url: string | null; tags: string[]; collection_id: string | null; is_favorite: boolean;
  created_at: string; updated_at: string; last_rediscovered_at: string | null;
};
export type CollectionRow = { user_id?: string; id: string; name: string; created_at: string; updated_at: string };

const iso = (value: string | null | undefined) => {
  if (!value) return undefined;
  const t = Date.parse(value);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
};

export const saveToRow = (s: SavedItem, userId: string): SaveRow => ({
  user_id: userId, id: s.id, url: s.url, title: s.title, note: s.note ?? null, type: s.type, source: s.source ?? null,
  image_url: s.imageUrl ?? null, tags: s.tags, collection_id: s.collectionId ?? null, is_favorite: s.isFavorite,
  created_at: s.createdAt, updated_at: s.updatedAt ?? s.createdAt, last_rediscovered_at: s.lastRediscoveredAt ?? null,
});

export const rowToSave = (r: SaveRow): SavedItem => ({
  id: r.id, url: r.url, title: r.title, note: r.note ?? undefined, type: r.type, source: r.source ?? undefined,
  imageUrl: r.image_url ?? undefined, tags: r.tags ?? [], collectionId: r.collection_id ?? undefined, isFavorite: !!r.is_favorite,
  createdAt: iso(r.created_at) ?? new Date().toISOString(), updatedAt: iso(r.updated_at), lastRediscoveredAt: iso(r.last_rediscovered_at),
});

export const collectionToRow = (c: Collection, userId: string): CollectionRow => ({ user_id: userId, id: c.id, name: c.name, created_at: c.createdAt, updated_at: c.updatedAt ?? c.createdAt });
export const rowToCollection = (r: CollectionRow): Collection => ({ id: r.id, name: r.name, createdAt: iso(r.created_at) ?? new Date().toISOString(), updatedAt: iso(r.updated_at) });

const stamp = (x: { updatedAt?: string; createdAt: string }) => Date.parse(x.updatedAt ?? x.createdAt) || 0;

function mergeList<T extends { id: string; updatedAt?: string; createdAt: string }>(local: T[], remote: T[], deleted: string[]) {
  const gone = new Set(deleted);
  const remoteById = new Map(remote.map(r => [r.id, r]));
  const merged: T[] = [];
  const upload: T[] = [];
  const seen = new Set<string>();
  for (const item of local) {
    if (gone.has(item.id)) continue;
    seen.add(item.id);
    const other = remoteById.get(item.id);
    if (!other || stamp(item) > stamp(other)) { merged.push(item); upload.push(item); }
    else merged.push(other);
  }
  for (const item of remote) if (!seen.has(item.id) && !gone.has(item.id)) merged.push(item);
  return { merged, upload };
}

/**
 * Two-way merge: for each id the copy with the newer updatedAt wins. Items only on this
 * phone (or newer here) are returned in `upload`; deleted ids stay deleted.
 */
export function mergeStores(local: Store, remote: Store, tombstones: Tombstones = emptyTombstones()) {
  const collections = mergeList(local.collections, remote.collections, tombstones.collections);
  const saves = mergeList(local.saves, remote.saves, tombstones.saves);
  const collectionIds = new Set(collections.merged.map(c => c.id));
  // A save can't point at a collection that no longer exists.
  const fix = (s: SavedItem) => s.collectionId && !collectionIds.has(s.collectionId) ? { ...s, collectionId: undefined } : s;
  return {
    store: { collections: collections.merged, saves: saves.merged.map(fix).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) },
    upload: { collections: collections.upload, saves: saves.upload.map(fix) },
  };
}
