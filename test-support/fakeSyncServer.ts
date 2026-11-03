/**
 * In-memory stand-in for the B1 sync server (supabase/migrations/20261106000000_sync_revisions.sql), following its rules:
 * per-user revisions, conditional writes, noop deletes, scrubbed tombstones, collection delete detaching saves,
 * saves only pointing at live collections, keyset-paged pulls (no pinned head), floors and resync, explicit restore.
 * Plus failure injection, and the legacy (pre-B2) direct table API with B1's RLS (live rows only, writes refused).
 * The real SQL is tested separately in supabase/tests; B3 runs the client against real PostgreSQL.
 */
import type { PullPage, PushChange, PushResult, SyncTransport, Table } from '@/utils/syncEngine';
import type { ServerRow } from '@/utils/sync';

type Row = ServerRow;
type UserData = { head: number; floor: number; rows: Record<Table, Map<string, Row>> };

const pgTime = (v: unknown) => {
  // Postgres returns timestamptz like 2026-11-03T08:00:00.123+00:00; the client must cope with that format.
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? new Date().toISOString().replace('Z', '+00:00') : new Date(t).toISOString().replace('Z', '+00:00');
};

export class FakeSyncServer {
  users = new Map<string, UserData>();
  failNext: { pull?: Error; push?: Error } = {};
  /** Called before a push is applied (lets tests interleave another device mid-sync). */
  beforePush?: () => Promise<void> | void;
  /** Called before each pull page is served (lets tests write between pages). */
  beforePull?: (call: number) => Promise<void> | void;
  pushes = 0;
  pulls = 0;

  private user(uid: string): UserData {
    let u = this.users.get(uid);
    if (!u) { u = { head: 0, floor: 0, rows: { saves: new Map(), collections: new Map() } }; this.users.set(uid, u); }
    return u;
  }
  row(uid: string, table: Table, id: string) { return this.users.get(uid)?.rows[table].get(id); }
  live(uid: string, table: Table) { return [...(this.users.get(uid)?.rows[table].values() ?? [])].filter(r => !r.deleted_at); }

  transport(uid: string): SyncTransport {
    return {
      pull: async (since, limit, full) => {
        this.pulls++;
        if (this.beforePull) await this.beforePull(this.pulls);
        if (this.failNext.pull) { const e = this.failNext.pull; delete this.failNext.pull; throw e; }
        return this.pull(uid, since, limit, full);
      },
      push: async (changes) => {
        this.pushes++;
        if (this.beforePush) await this.beforePush();
        if (this.failNext.push) { const e = this.failNext.push; delete this.failNext.push; throw e; }
        return this.push(uid, changes);
      },
    };
  }

  pull(uid: string, since: number, limit: number, full = false): PullPage {
    const u = this.user(uid);
    if (!full && since > 0 && since < u.floor) return { resync: true, head: u.head, floor: u.floor, changes: [], next_cursor: 0, more: false };
    const lim = Math.min(Math.max(limit, 1), 500);
    const stream = (['collections', 'saves'] as Table[]).flatMap(t => [...u.rows[t].values()].filter(r => r.rev > since).map(r => ({ table: t, row: { ...r } })));
    stream.sort((a, b) => a.row.rev - b.row.rev);
    const page = stream.slice(0, lim);
    const last = page.length ? page[page.length - 1].row.rev : Math.max(since, u.head);
    return { resync: false, head: u.head, floor: u.floor, changes: page, next_cursor: last, more: stream.length > lim };
  }

  push(uid: string, changes: PushChange[]): PushResult[] {
    if (!Array.isArray(changes) || changes.length < 1 || changes.length > 200) throw Object.assign(new Error('batch must have 1 to 200 changes'), { code: '22023' });
    const u = this.user(uid);
    const out: PushResult[] = [];
    for (const ch of changes) {
      const cur = u.rows[ch.table].get(ch.id);
      if ((cur?.rev ?? 0) !== ch.base_rev) { out.push({ table: ch.table, id: ch.id, status: 'conflict', server: cur ? { ...cur } : null }); continue; }
      if (ch.op === 'delete' && (!cur || cur.deleted_at)) { out.push({ table: ch.table, id: ch.id, status: 'noop', server: cur ? { ...cur } : null }); continue; }
      if ((ch.op === 'upsert' && cur?.deleted_at) || (ch.op === 'restore' && !cur?.deleted_at)) { out.push({ table: ch.table, id: ch.id, status: 'conflict', server: cur ? { ...cur } : null }); continue; }
      const rev = ++u.head;
      if (ch.op === 'delete' && ch.table === 'saves') {
        u.rows.saves.set(ch.id, { id: ch.id, rev, deleted_at: pgTime(new Date().toISOString()), url: '', title: '', note: null, type: cur!.type, source: null, image_url: null, tags: [], collection_id: null, is_favorite: false, created_at: cur!.created_at, updated_at: cur!.updated_at, last_rediscovered_at: null, details: null });
      } else if (ch.op === 'delete') {
        u.rows.collections.set(ch.id, { ...cur!, id: ch.id, rev, deleted_at: pgTime(new Date().toISOString()), name: '·' });
        for (const s of [...u.rows.saves.values()].filter(s => s.collection_id === ch.id && !s.deleted_at).sort((a, b) => a.id.localeCompare(b.id))) {
          u.rows.saves.set(s.id, { ...s, collection_id: null, rev: ++u.head });
        }
      } else if (ch.table === 'saves') {
        const r = ch.row ?? {};
        const colOk = typeof r.collection_id === 'string' && !!u.rows.collections.get(r.collection_id) && !u.rows.collections.get(r.collection_id)!.deleted_at;
        u.rows.saves.set(ch.id, {
          id: ch.id, rev, deleted_at: null, url: r.url, title: r.title, note: r.note ?? null, type: r.type ?? 'other', source: r.source ?? null, image_url: r.image_url ?? null,
          tags: r.tags ?? [], collection_id: colOk ? r.collection_id : null, is_favorite: r.is_favorite ?? false,
          created_at: pgTime(r.created_at), updated_at: pgTime(r.updated_at), last_rediscovered_at: r.last_rediscovered_at ? pgTime(r.last_rediscovered_at) : null, details: r.details ?? null,
        });
      } else {
        const r = ch.row ?? {};
        u.rows.collections.set(ch.id, { id: ch.id, rev, deleted_at: null, name: r.name, created_at: pgTime(r.created_at), updated_at: pgTime(r.updated_at) });
      }
      out.push({ table: ch.table, id: ch.id, status: 'applied', rev, server: { ...u.rows[ch.table].get(ch.id)! } });
    }
    return out;
  }

  /** Server-side retention: drop tombstones and raise floors (purge_tombstones). */
  purgeTombstones(): number {
    let n = 0;
    for (const u of this.users.values()) {
      for (const t of ['saves', 'collections'] as Table[]) for (const [id, r] of u.rows[t]) if (r.deleted_at) { u.floor = Math.max(u.floor, r.rev); u.rows[t].delete(id); n++; }
    }
    return n;
  }

  /** The pre-B2 client's direct table access after B1: reads see live rows only; every write is refused. */
  legacyClient(uid: string) {
    const server = this;
    const rls = { message: 'new row violates row-level security policy for table', code: '42501' };
    const builder = (table: Table) => {
      let op: 'select' | 'delete' = 'select';
      const b = {
        select() { op = 'select'; return b; },
        delete() { op = 'delete'; return b; },
        eq() { return b; },
        in() { return b; },
        upsert: async () => ({ data: null, error: rls }),
        then(resolve: (v: unknown) => void) {
          if (op === 'delete') return resolve({ data: null, error: rls });
          resolve({ data: server.live(uid, table).map(r => ({ user_id: uid, ...r })), error: null });
        },
      };
      return b;
    };
    return { from: builder };
  }
}
