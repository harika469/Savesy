import { Collection, SavedItem, SaveType } from '@/types';
import { normalizeDetails } from '@/supabase/functions/_shared/enrich';
import { sameUrl } from './saves';

export type Store = { saves: SavedItem[]; collections: Collection[] };
export const BACKUP_FORMAT = 'savesy-backup';
export const BACKUP_VERSION = 1;

const saveTypes: SaveType[] = ['article', 'video', 'product', 'place', 'social', 'other'];
const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

export function serializeBackup(store: Store, now = new Date()) {
  return JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString(), ...store }, null, 2);
}

function cleanSave(raw: unknown): SavedItem | undefined {
  const v = raw as Partial<SavedItem> | null;
  if (!v || !isString(v.id) || !isString(v.url) || !isString(v.title)) return undefined;
  return {
    id: v.id, url: v.url, title: v.title,
    note: isString(v.note) ? v.note : undefined,
    type: saveTypes.includes(v.type as SaveType) ? v.type as SaveType : 'other',
    source: isString(v.source) ? v.source : undefined,
    imageUrl: isString(v.imageUrl) ? v.imageUrl : undefined,
    tags: Array.isArray(v.tags) ? v.tags.filter(isString) : [],
    collectionId: isString(v.collectionId) ? v.collectionId : undefined,
    isFavorite: v.isFavorite === true,
    createdAt: isString(v.createdAt) && !Number.isNaN(Date.parse(v.createdAt)) ? v.createdAt : new Date().toISOString(),
    lastRediscoveredAt: isString(v.lastRediscoveredAt) ? v.lastRediscoveredAt : undefined,
    ...(normalizeDetails(v.details) ? { details: normalizeDetails(v.details) } : {}),
  };
}

function cleanCollection(raw: unknown): Collection | undefined {
  const v = raw as Partial<Collection> | null;
  if (!v || !isString(v.id) || !isString(v.name)) return undefined;
  return { id: v.id, name: v.name, createdAt: isString(v.createdAt) ? v.createdAt : new Date().toISOString() };
}

/** Accepts a Savesy backup (or the raw stored shape) and returns clean data, or throws a friendly error. */
export function parseBackup(text: string): Store {
  let data: unknown;
  try { data = JSON.parse(text.trim()); } catch { throw new Error('That doesn’t look like a Savesy backup.'); }
  const v = data as Partial<Store> | null;
  if (!v || !Array.isArray(v.saves) || !Array.isArray(v.collections)) throw new Error('That doesn’t look like a Savesy backup.');
  const collections = v.collections.map(cleanCollection).filter((c): c is Collection => !!c);
  const ids = new Set(collections.map(c => c.id));
  const saves = v.saves.map(cleanSave).filter((s): s is SavedItem => !!s)
    .map(s => s.collectionId && !ids.has(s.collectionId) ? { ...s, collectionId: undefined } : s);
  return { saves, collections };
}

/**
 * Adds a backup to what's already here without losing anything: saves with an id or link
 * that already exists are skipped, and collections with the same name are reused.
 */
export function mergeBackup(current: Store, incoming: Store): { store: Store; addedSaves: number; addedCollections: number } {
  const collections = [...current.collections];
  const collectionIdMap = new Map<string, string>();
  let addedCollections = 0;
  for (const c of incoming.collections) {
    const existing = collections.find(x => x.id === c.id || x.name.trim().toLowerCase() === c.name.trim().toLowerCase());
    if (existing) collectionIdMap.set(c.id, existing.id);
    else { collections.push(c); collectionIdMap.set(c.id, c.id); addedCollections++; }
  }
  const saves = [...current.saves];
  let addedSaves = 0;
  for (const s of incoming.saves) {
    if (saves.some(x => x.id === s.id || sameUrl(x.url, s.url))) continue;
    saves.push({ ...s, collectionId: s.collectionId ? collectionIdMap.get(s.collectionId) : undefined });
    addedSaves++;
  }
  saves.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { store: { saves, collections }, addedSaves, addedCollections };
}
