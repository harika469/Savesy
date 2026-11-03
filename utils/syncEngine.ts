/**
 * Client side of the B1 sync protocol (push_changes / pull_changes), as pure functions plus one orchestrator.
 *
 * Data-safety rules (issue #1 / B2 acceptance):
 *  - Pending changes are DERIVED: an item is pending when it differs from the last server copy this phone saw
 *    (`meta.base`). Nothing is tracked with flags that could be lost, so an unsynced edit can't be forgotten.
 *  - Server rows are merged into the CURRENT state, so edits made while a sync is in flight are kept.
 *  - Same field changed here and on another device: the local value is kept, the item is marked as a visible
 *    conflict, and it is NOT pushed until the user chooses (keep mine / use theirs). Nothing is silently overwritten.
 *  - Deleted on another device while edited here: the local edit is kept as a visible conflict, never discarded.
 *  - Full re-download (resync): server state is authoritative; items this phone had synced that the server no longer
 *    has are removed (or become conflicts if edited locally) and are never re-uploaded. Never-synced local items upload.
 */
import { Collection, SavedItem } from '@/types';
import { collectionToPushRow, rowToCollection, rowToSave, sameValue, saveToPushRow, ServerRow, Table } from './sync';

export type { ServerRow, Table };
type Item = SavedItem | Collection;
export type Local = { saves: SavedItem[]; collections: Collection[] };

/** The last server copy of an item this phone saw: item null = the server has it as deleted (tombstone). */
export type BaseEntry = { rev: number; item: Item | null };
export type Conflict = {
  table: Table; id: string;
  kind: 'edited' | 'deletedRemotely';
  /** Fields changed both here and on another device (kind 'edited'). */
  fields: string[];
  /** The other device's version (null when it was deleted). */
  server: Item | null;
  at: string;
};
export type SyncMeta = {
  /** Highest revision pulled. */
  cursor: number;
  base: { saves: Record<string, BaseEntry>; collections: Record<string, BaseEntry> };
  conflicts: Conflict[];
  /** A full re-download is required (or was interrupted). */
  needsResync: boolean;
  /** Deletions made under the previous sync protocol, applied once the server copy is known. */
  legacyDeletes: { saves: string[]; collections: string[] };
};
export type EngineState = { local: Local; meta: SyncMeta };

export const emptyMeta = (): SyncMeta => ({ cursor: 0, base: { saves: {}, collections: {} }, conflicts: [], needsResync: false, legacyDeletes: { saves: [], collections: [] } });

export type PushChange = { table: Table; id: string; base_rev: number; op: 'upsert' | 'delete'; row?: Record<string, unknown> };
export type PushResult = { table: Table; id: string; status: 'applied' | 'conflict' | 'noop'; rev?: number; server?: ServerRow | null };
export type PullPage = { resync: boolean; head: number; floor: number; changes: { table: Table; row: ServerRow }[]; next_cursor: number; more: boolean };
export interface SyncTransport {
  pull(since: number, head: number | null, limit: number): Promise<PullPage>;
  push(changes: PushChange[]): Promise<PushResult[]>;
}

// ---------- item helpers ----------
const fromRow = (table: Table, row: ServerRow): Item | null =>
  row.deleted_at ? null : table === 'saves' ? rowToSave(row) : rowToCollection(row);
const toPushRow = (table: Table, item: Item) =>
  (table === 'saves' ? saveToPushRow(item as SavedItem) : collectionToPushRow(item as Collection)) as unknown as Record<string, unknown>;

export function getLocal(s: EngineState, table: Table, id: string): Item | null {
  return ((s.local[table] as Item[]).find(i => i.id === id)) ?? null;
}
function setLocal(s: EngineState, table: Table, id: string, item: Item | null): EngineState {
  const list = s.local[table] as Item[];
  const idx = list.findIndex(i => i.id === id);
  let next: Item[];
  if (item === null) next = idx < 0 ? list : list.filter(i => i.id !== id);
  else if (idx < 0) next = table === 'saves' ? [item, ...list] : [...list, item];
  else { next = list.slice(); next[idx] = item; }
  if (next === list) return s;
  return { ...s, local: { ...s.local, [table]: next } as Local };
}
function setBase(s: EngineState, table: Table, id: string, entry: BaseEntry | null): EngineState {
  const base = { ...s.meta.base[table] };
  if (entry) base[id] = entry; else delete base[id];
  return { ...s, meta: { ...s.meta, base: { ...s.meta.base, [table]: base } } };
}
const conflictOf = (s: EngineState, table: Table, id: string) => s.meta.conflicts.find(c => c.table === table && c.id === id);
function setConflict(s: EngineState, c: Conflict | null, table: Table, id: string): EngineState {
  const rest = s.meta.conflicts.filter(x => !(x.table === table && x.id === id));
  return { ...s, meta: { ...s.meta, conflicts: c ? [...rest, c] : rest } };
}
const legacyDeleted = (s: EngineState, table: Table, id: string) => s.meta.legacyDeletes[table].includes(id);
function dropLegacy(s: EngineState, table: Table, id: string): EngineState {
  if (!legacyDeleted(s, table, id)) return s;
  return { ...s, meta: { ...s.meta, legacyDeletes: { ...s.meta.legacyDeletes, [table]: s.meta.legacyDeletes[table].filter(x => x !== id) } } };
}

/** True when this phone has a change for the item that the server hasn't acknowledged. */
export function isDirty(s: EngineState, table: Table, id: string): boolean {
  const L = getLocal(s, table, id);
  const B = s.meta.base[table][id];
  if (!B) return !!L;                       // never synced: a local create
  if (B.item === null) return !!L;          // server has a tombstone: a local re-create / restore
  return !L || !sameValue(L, B.item);       // deleted here, or edited here
}

// ---------- three-way merge ----------
const CONFLICT_FIELDS: Record<Table, string[]> = {
  saves: ['url', 'title', 'note', 'type', 'source', 'imageUrl', 'collectionId', 'isFavorite', 'details'],
  collections: ['name'],
};
const later = (a?: string, b?: string) => (!a ? b : !b ? a : a > b ? a : b);

export function merge3(table: Table, base: Item | null, local: Item, server: Item): { merged: Item; fields: string[] } {
  const L = local as unknown as Record<string, unknown>, R = server as unknown as Record<string, unknown>;
  const B = base as unknown as Record<string, unknown> | null;
  const out: Record<string, unknown> = { ...L };
  const fields: string[] = [];
  for (const f of CONFLICT_FIELDS[table]) {
    const l = L[f], r = R[f];
    if (sameValue(l, r)) { out[f] = l; continue; }
    if (B && sameValue(l, B[f])) { out[f] = r; continue; }      // only the other device changed it
    if (B && sameValue(r, B[f])) { out[f] = l; continue; }      // only this device changed it
    out[f] = l; fields.push(f);                                  // both changed it: keep ours, report
  }
  if (table === 'saves') {
    const b = new Set(((B?.tags as string[]) ?? [])), l = new Set((L.tags as string[]) ?? []), r = new Set((R.tags as string[]) ?? []);
    const added = [...l].filter(t => !b.has(t)), removed = [...b].filter(t => !l.has(t));
    out.tags = [...new Set([...[...r].filter(t => !removed.includes(t)), ...added])];
    out.lastRediscoveredAt = later(L.lastRediscoveredAt as string | undefined, R.lastRediscoveredAt as string | undefined);
  }
  out.createdAt = R.createdAt ?? L.createdAt;
  out.updatedAt = later(L.updatedAt as string | undefined, R.updatedAt as string | undefined);
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return { merged: out as unknown as Item, fields };
}

// ---------- applying server rows ----------
export function applyServerRow(s: EngineState, table: Table, row: ServerRow): EngineState {
  const id = row.id;
  const B = s.meta.base[table][id];
  if (B && row.rev <= B.rev) return s;                           // already have this (or newer)
  const R = fromRow(table, row);
  const L = getLocal(s, table, id);
  const now = new Date().toISOString();

  // A deletion made under the previous protocol: keep it pending against this server copy.
  if (!B && !L && legacyDeleted(s, table, id)) {
    return dropLegacy(setBase(s, table, id, { rev: row.rev, item: R }), table, id);
  }

  const dirty = isDirty(s, table, id);
  const existing = conflictOf(s, table, id);
  let next = setBase(s, table, id, { rev: row.rev, item: R });

  if (!dirty && !existing) return setLocal(next, table, id, R);  // nothing pending here: take the server version

  if (!L) return next;                                            // deleted here: the delete stays pending (or is acknowledged)

  if (!R) {                                                       // deleted elsewhere, edited here: keep ours, make it visible
    return setConflict(next, { table, id, kind: 'deletedRemotely', fields: [], server: null, at: now }, table, id);
  }

  const { merged, fields } = merge3(table, existing ? (existing.server ?? B?.item ?? null) : (B?.item ?? null), L, R);
  next = setLocal(next, table, id, merged);
  const allFields = [...new Set([...(existing?.kind === 'edited' ? existing.fields : []), ...fields])];
  if (allFields.length || existing) {
    return setConflict(next, { table, id, kind: 'edited', fields: allFields, server: R, at: existing?.at ?? now }, table, id);
  }
  return next;
}

/** After a full re-download: anything this phone had synced that the server no longer has is gone there. */
export function reconcileResync(s: EngineState, seen: Set<string>): EngineState {
  let next = s;
  for (const table of ['saves', 'collections'] as Table[]) {
    for (const [id, B] of Object.entries(next.meta.base[table])) {
      if (seen.has(`${table}:${id}`)) continue;
      const L = getLocal(next, table, id);
      const dirty = isDirty(next, table, id);
      next = setBase(next, table, id, null);                      // the server has no row: a future push starts from 0
      if (!L || B.item === null) continue;
      if (!dirty && !conflictOf(next, table, id)) next = setLocal(next, table, id, null);
      else next = setConflict(next, { table, id, kind: 'deletedRemotely', fields: [], server: null, at: new Date().toISOString() }, table, id);
    }
  }
  return next;
}

// ---------- pushing ----------
const ORDER = (c: PushChange) => (c.table === 'collections' && c.op === 'upsert' ? 0 : c.table === 'saves' && c.op === 'upsert' ? 1 : c.table === 'saves' ? 2 : 3);

/** Changes to send now: everything pending except items waiting on a conflict decision. */
export function pendingChanges(s: EngineState): PushChange[] {
  const out: PushChange[] = [];
  for (const table of ['collections', 'saves'] as Table[]) {
    const ids = new Set([...(s.local[table] as Item[]).map(i => i.id), ...Object.keys(s.meta.base[table])]);
    for (const id of ids) {
      if (conflictOf(s, table, id) || !isDirty(s, table, id)) continue;
      const L = getLocal(s, table, id);
      const B = s.meta.base[table][id];
      if (L) out.push({ table, id, base_rev: B?.rev ?? 0, op: 'upsert', row: toPushRow(table, L) });
      else if (B?.item) out.push({ table, id, base_rev: B.rev, op: 'delete' });
    }
  }
  return out.sort((a, b) => ORDER(a) - ORDER(b));
}
export const pendingCount = (s: EngineState) => pendingChanges(s).length;

export function applyPushResults(s: EngineState, sent: { change: PushChange; snapshot: Item | null }[], results: PushResult[]): EngineState {
  let next = s;
  for (const r of results) {
    const entry = sent.find(x => x.change.table === r.table && x.change.id === r.id);
    if (!entry) continue;
    if (r.status === 'noop') { next = setBase(next, r.table, r.id, null); continue; }
    if (r.status === 'conflict') {
      if (r.server) next = applyServerRow(next, r.table, r.server as ServerRow);
      else next = { ...next, meta: { ...next.meta, needsResync: true } };   // the server has no row any more: reconcile fully
      continue;
    }
    // applied
    const row = r.server as ServerRow;
    const serverItem = fromRow(r.table, row);
    const current = getLocal(next, r.table, r.id);
    next = setBase(next, r.table, r.id, { rev: row.rev, item: serverItem });
    // Adopt the server's stored form (normalization) only if nothing changed here since the push was sent.
    if (sameValue(current, entry.snapshot)) next = setLocal(next, r.table, r.id, serverItem);
  }
  return next;
}

// ---------- conflicts ----------
export function resolveConflict(s: EngineState, table: Table, id: string, choice: 'mine' | 'theirs'): EngineState {
  const c = conflictOf(s, table, id);
  if (!c) return s;
  let next = setConflict(s, null, table, id);
  if (choice === 'theirs') next = setLocal(next, table, id, c.server);
  return next;                                                     // 'mine': the local version is now pending and gets pushed
}

// ---------- orchestration ----------
export type SyncIO = {
  get: () => EngineState;
  /** Applies a change to the CURRENT state (synchronously) — never to a snapshot. */
  apply: (fn: (s: EngineState) => EngineState) => void;
  transport: SyncTransport;
  pageSize?: number;
};
export type SyncOutcome = { pending: number; conflicts: number };

async function pullAll(io: SyncIO): Promise<void> {
  const limit = io.pageSize ?? 500;
  let resync = io.get().meta.needsResync;
  let since = resync ? 0 : io.get().meta.cursor;
  let head: number | null = null;
  const seen = new Set<string>();
  for (let guard = 0; guard < 100000; guard++) {
    const page = await io.transport.pull(since, head, limit);
    if (page.resync) {
      if (resync) throw new Error('The server asked for a re-download twice.');
      resync = true; since = 0; head = null; seen.clear();
      io.apply(s => ({ ...s, meta: { ...s.meta, needsResync: true } }));
      continue;
    }
    head = page.head;
    const rows = page.changes;
    const cursorAfter = page.next_cursor;
    io.apply(s => {
      let t = s;
      for (const c of rows) { seen.add(`${c.table}:${c.row.id}`); t = applyServerRow(t, c.table, c.row); }
      // During a re-download the cursor only moves when it completes, so an interruption restarts it safely.
      return resync ? t : { ...t, meta: { ...t.meta, cursor: Math.max(t.meta.cursor, cursorAfter) } };
    });
    since = cursorAfter;
    if (!page.more) break;
  }
  if (resync) {
    const finalHead = head ?? since;
    io.apply(s => { const t = reconcileResync(s, seen); return { ...t, meta: { ...t.meta, needsResync: false, cursor: finalHead } }; });
  }
}

/** One sync round: pull, push what's pending (up to 3 rounds), pull again. Throws on transport errors; state is never rolled back. */
export async function runSync(io: SyncIO): Promise<SyncOutcome> {
  await pullAll(io);
  for (let round = 0; round < 3; round++) {
    const changes = pendingChanges(io.get());
    if (!changes.length) break;
    for (let i = 0; i < changes.length; i += 200) {
      const batch = changes.slice(i, i + 200);
      const sent = batch.map(change => ({ change, snapshot: getLocal(io.get(), change.table, change.id) }));
      const results = await io.transport.push(batch);
      io.apply(s => applyPushResults(s, sent, results));
    }
    if (io.get().meta.needsResync) await pullAll(io);
  }
  await pullAll(io);
  const s = io.get();
  return { pending: pendingCount(s), conflicts: s.meta.conflicts.length };
}

/** Moves data from the previous protocol (no revisions) into the engine: nothing is marked as synced, so the first
 *  pull compares every item against the server; identical items become clean, differing fields become conflicts. */
export function fromLegacy(local: Local, legacyTombstones?: { saves: string[]; collections: string[] }): EngineState {
  return { local, meta: { ...emptyMeta(), legacyDeletes: { saves: legacyTombstones?.saves ?? [], collections: legacyTombstones?.collections ?? [] } } };
}

