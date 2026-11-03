/** A simulated phone: its own engine state, talking to a server (FakeSyncServer, or real PostgreSQL in B3) as one user. */
export type SyncServer = { transport(uid: string): SyncTransport };
import { Collection, SavedItem } from '@/types';
import { emptyMeta, EngineState, resolveConflict, runSync, SyncOutcome, SyncTransport, Table } from '@/utils/syncEngine';

let clock = Date.parse('2026-11-01T10:00:00.000Z');
export const tick = () => new Date((clock += 1000)).toISOString();

export function save(id: string, over: Partial<SavedItem> = {}): SavedItem {
  const t = tick();
  return { id, url: `https://example.com/${id}`, title: id, type: 'article', tags: [], isFavorite: false, createdAt: t, updatedAt: t, ...over };
}
export function collection(id: string, name = id): Collection { const t = tick(); return { id, name, createdAt: t, updatedAt: t }; }

export class Device {
  state: EngineState;
  constructor(public server: SyncServer, public uid: string, state?: EngineState, public pageSize = 500) {
    this.state = state ?? { local: { saves: [], collections: [] }, meta: emptyMeta() };
  }
  apply = (fn: (s: EngineState) => EngineState) => { this.state = fn(this.state); };
  sync(): Promise<SyncOutcome> {
    return runSync({ get: () => this.state, apply: this.apply, transport: this.server.transport(this.uid), pageSize: this.pageSize });
  }
  add(item: SavedItem) { this.apply(s => ({ ...s, local: { ...s.local, saves: [item, ...s.local.saves] } })); }
  addCollection(c: Collection) { this.apply(s => ({ ...s, local: { ...s.local, collections: [...s.local.collections, c] } })); }
  edit(id: string, changes: Partial<SavedItem>) {
    this.apply(s => ({ ...s, local: { ...s.local, saves: s.local.saves.map(x => (x.id === id ? { ...x, ...changes, updatedAt: tick() } : x)) } }));
  }
  remove(table: Table, id: string) { this.apply(s => ({ ...s, local: { ...s.local, [table]: (s.local[table] as { id: string }[]).filter(x => x.id !== id) } as EngineState['local'] })); }
  resolve(table: Table, id: string, choice: 'mine' | 'theirs') { this.apply(s => resolveConflict(s, table, id, choice)); }
  get(id: string) { return this.state.local.saves.find(s => s.id === id); }
  ids() { return this.state.local.saves.map(s => s.id).sort(); }
}
