import { normalizeDetails } from '@/supabase/functions/_shared/enrich';
import { Collection, SavedItem, SaveType } from '@/types';

export type Table = 'saves' | 'collections';

/** A row as the server returns it from push_changes / pull_changes (never includes user_id). */
export type ServerRow = { id: string; rev: number; deleted_at: string | null } & Record<string, unknown>;

/** Fields a client may send in push_changes rows (the server rejects anything else). */
export type SavePushRow = {
  url: string; title: string; note: string | null; type: SaveType; source: string | null; image_url: string | null; tags: string[];
  collection_id: string | null; is_favorite: boolean; created_at: string; updated_at: string; last_rediscovered_at: string | null; details: unknown;
};
export type CollectionPushRow = { name: string; created_at: string; updated_at: string };

const iso = (value: unknown) => {
  if (typeof value !== 'string' || !value) return undefined;
  const t = Date.parse(value);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
};
const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);

export const saveToPushRow = (s: SavedItem): SavePushRow => ({
  url: s.url, title: s.title, note: s.note ?? null, type: s.type, source: s.source ?? null, image_url: s.imageUrl ?? null, tags: s.tags,
  collection_id: s.collectionId ?? null, is_favorite: s.isFavorite, created_at: s.createdAt, updated_at: s.updatedAt ?? s.createdAt,
  last_rediscovered_at: s.lastRediscoveredAt ?? null, details: s.details ?? null,
});
export const collectionToPushRow = (c: Collection): CollectionPushRow => ({ name: c.name, created_at: c.createdAt, updated_at: c.updatedAt ?? c.createdAt });

export const rowToSave = (r: ServerRow): SavedItem => {
  const details = normalizeDetails(r.details);
  return {
    id: r.id, url: String(r.url ?? ''), title: String(r.title ?? ''), note: str(r.note), type: (r.type as SaveType) ?? 'other', source: str(r.source),
    imageUrl: str(r.image_url), tags: Array.isArray(r.tags) ? (r.tags as string[]) : [], collectionId: str(r.collection_id), isFavorite: r.is_favorite === true,
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(), updatedAt: iso(r.updated_at), lastRediscoveredAt: iso(r.last_rediscovered_at),
    ...(details ? { details } : {}),
  };
};
export const rowToCollection = (r: ServerRow): Collection => ({
  id: r.id, name: String(r.name ?? ''), createdAt: iso(r.created_at) ?? new Date(0).toISOString(), updatedAt: iso(r.updated_at),
});

/** Canonical form for comparing items: undefined fields dropped, keys sorted, timestamps normalized. */
export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v === undefined || v === null) continue;
      out[k] = canonical(v);
    }
    return out;
  }
  return value;
}
export const sameValue = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
