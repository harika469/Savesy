/**
 * B3 end-to-end: the real client (utils/syncEngine + lib/cloudSync's Supabase transport) against real PostgreSQL with
 * every migration applied, through a PostgREST-like RPC layer (test-support/pgHarness.ts). No fake server anywhere.
 * Opt-in, because it needs PostgreSQL: SAVESY_PG=1 PGHOST=... PGPORT=... PGUSER=postgres npm run test:e2e
 * What this cannot cover (still needed on staging): real Clerk tokens through Supabase's API gateway, real network.
 */
import { supabaseTransport, friendlyCloudError } from '@/lib/cloudSync';
import { canonical } from '@/utils/sync';
import { pendingChanges, runSync } from '@/utils/syncEngine';
import { collection, Device, save, SyncServer } from '../test-support/device';
import { createDb, dropDb, liveRows, pgAvailable, purgeNow, rpcClient, sqlValue } from '../test-support/pgHarness';

const run = pgAvailable() ? describe : describe.skip;
jest.setTimeout(240_000);

let db = '';
let n = 0;
const uid = () => `user_e2e_${++n}_${Math.floor(Math.random() * 1e6)}`;

/** Hooks run before every RPC a device makes (to interleave other devices between pages). */
type Hook = (fn: string, args: Record<string, unknown>) => Promise<void> | void;
function pgServer(hooks: Map<string, Hook> = new Map()): SyncServer & { hooks: Map<string, Hook> } {
  return {
    hooks,
    transport: (u: string) => supabaseTransport(() => rpcClient(db, u, { before: (fn, args) => hooks.get(u)?.(fn, args) })),
  };
}
const head = async (u: string) => Number(await sqlValue(db, `select coalesce(max(rev), 0) from public.sync_heads where user_id = '${u}'`));
const pick = (row: Record<string, unknown>) => ({ id: row.id, title: row.title, note: row.note ?? undefined, collectionId: row.collection_id ?? undefined });
const pickLocal = (s: { id: string; title: string; note?: string; collectionId?: string }) => ({ id: s.id, title: s.title, note: s.note, collectionId: s.collectionId });
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** Deterministic RNG so a failing seed can be replayed. */
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

run('B3: the real client against real PostgreSQL', () => {
  beforeAll(async () => { db = await createDb(); });
  afterAll(() => { if (db) dropDb(db); });

  it('two phones: creates, edits, deletes and a collection delete reach both, and the server matches', async () => {
    const U = uid(); const server = pgServer();
    const a = new Device(server, U), b = new Device(server, U);
    a.addCollection(collection('c1', 'Food'));
    a.add(save('s1', { collectionId: 'c1' })); a.add(save('s2', { collectionId: 'c1' })); a.add(save('s3'));
    expect(await a.sync()).toEqual({ pending: 0, conflicts: 0 });
    await b.sync();
    expect(b.ids()).toEqual(['s1', 's2', 's3']);
    b.edit('s1', { note: 'from B' }); b.remove('saves', 's3'); await b.sync();
    a.edit('s1', { title: 'from A' }); a.remove('collections', 'c1'); await a.sync(); await b.sync(); await a.sync();
    for (const d of [a, b]) {
      expect(d.ids()).toEqual(['s1', 's2']);
      expect(d.get('s1')).toMatchObject({ title: 'from A', note: 'from B' });
      expect(d.get('s1')?.collectionId).toBeUndefined();
      expect(d.state.local.collections).toEqual([]);
    }
    expect((await liveRows(db, U, 'saves')).map(pick)).toEqual(b.state.local.saves.map(pickLocal).sort((x, y) => x.id.localeCompare(y.id)));
  });

  it('another account sees nothing of this one, and a request without a signed-in user is refused', async () => {
    const U = uid(), V = uid(); const server = pgServer();
    const a = new Device(server, U); a.add(save('private')); await a.sync();
    const v = new Device(server, V); expect(await v.sync()).toEqual({ pending: 0, conflicts: 0 });
    expect(v.ids()).toEqual([]);
    // V pushing to A's id creates V's own row; A's row is untouched.
    v.add(save('private', { title: 'V' })); await v.sync();
    expect((await liveRows(db, U, 'saves')).map(r => r.title)).toEqual(['private']);
    await expect(supabaseTransport(() => rpcClient(db, null)).pull(0, 10, true)).rejects.toThrow('permission denied for function pull_changes');
    await expect(supabaseTransport(() => rpcClient(db, null)).push([{ table: 'saves', id: 'private', base_rev: 0, op: 'delete' }])).rejects.toThrow('permission denied');
    await expect(supabaseTransport(() => rpcClient(db, '')).pull(0, 10, true)).rejects.toThrow('not signed in');
  });

  it('a collection with 1,200 saves is deleted in one request; every phone detaches them across pages', async () => {
    const U = uid(); const server = pgServer();
    const a = new Device(server, U);
    a.addCollection(collection('big'));
    for (let i = 0; i < 1200; i++) a.add(save(`b${String(i).padStart(4, '0')}`, { collectionId: 'big' }));
    await a.sync();
    const b = new Device(server, U); await b.sync();
    expect(b.state.local.saves.filter(s => s.collectionId === 'big')).toHaveLength(1200);
    a.remove('collections', 'big');
    const t0 = Date.now(); await a.sync(); const ms = Date.now() - t0;
    expect(ms).toBeLessThan(15_000);                           // includes the client round-trips; well inside a 60 s gateway limit
    await b.sync();
    expect(b.state.local.saves.filter(s => s.collectionId)).toHaveLength(0);
    expect(b.state.local.saves).toHaveLength(1200);
    expect(pendingChanges(b.state)).toEqual([]);
  });

  it('after a re-download caused by a purge, the following syncs are incremental again (no re-download loop)', async () => {
    const U = uid(); const server = pgServer();
    const a = new Device(server, U); for (const id of ['k1', 'k2', 'last']) a.add(save(id)); await a.sync();
    const b = new Device(server, U, undefined, 2); await b.sync();
    a.remove('saves', 'last'); await a.sync();                 // the newest revision is now a tombstone...
    await purgeNow(db);                                        // ...which is purged: floor = head
    let full = 0;
    server.hooks.set(U, (fn, args) => { if (fn === 'pull_changes' && args.p_since === 0) full++; });
    await b.sync();
    expect(b.ids()).toEqual(['k1', 'k2']);
    expect(full).toBe(1);
    full = 0; await b.sync(); await b.sync();
    expect(full).toBe(0);
    server.hooks.delete(U);
  });

  it('a deletion purged mid-download, of a row this phone already received, is not missed (no ghost item)', async () => {
    const U = uid(); const server = pgServer();
    const a = new Device(server, U); for (const id of ['g1', 'g2', 'g3', 'g4', 'g5', 'g6']) a.add(save(id)); await a.sync();
    const b = new Device(server, U, undefined, 2); await b.sync();
    a.remove('saves', 'g6'); await a.sync(); await purgeNow(db);        // B must re-download
    const first = b.state.local.saves.length;
    let injected = false, calls = 0;
    server.hooks.set(U, async (fn, args) => {
      if (fn !== 'pull_changes' || injected) return;
      // After B's first full page (which delivered the oldest rows): A deletes one of them and the purge removes the tombstone.
      if (args.p_since !== 0 && args.p_full === true && ++calls === 1) {
        injected = true;
        // The live row with the lowest revision: B received it on page 1.
        const victim = await sqlValue(db, `select id from public.saves where user_id = '${U}' and deleted_at is null order by rev limit 1`);
        a.remove('saves', victim); await runSync({ get: () => a.state, apply: a.apply, transport: supabaseTransport(() => rpcClient(db, U)) });
        await purgeNow(db);
      }
    });
    await b.sync();
    server.hooks.delete(U);
    expect(injected).toBe(true);
    expect(first).toBe(6);
    expect(b.ids()).toEqual(a.ids());
    expect(b.ids()).toEqual((await liveRows(db, U, 'saves')).map(r => String(r.id)).sort());
  });

  it('retry exhaustion: if purges keep landing mid-download, sync fails loudly and nothing local is lost; later it completes', async () => {
    const U = uid(); const server = pgServer();
    const a = new Device(server, U); for (let i = 0; i < 12; i++) a.add(save(`r${String(i).padStart(2, '0')}`)); await a.sync();
    const b = new Device(server, U, undefined, 3); await b.sync();
    a.remove('saves', 'r11'); await a.sync(); await purgeNow(db);
    b.edit('r01', { note: 'unsynced on B' }); b.add(save('new-on-b'));
    let k = 100;
    const aSync = () => runSync({ get: () => a.state, apply: a.apply, transport: supabaseTransport(() => rpcClient(db, U)) });
    server.hooks.set(U, async fn => {
      if (fn !== 'pull_changes') return;
      // Before every page: another phone adds one save and deletes another, and the retention job purges.
      a.add(save(`churn${k++}`)); a.remove('saves', [...a.state.local.saves].reverse().find(s => s.id !== 'r01')!.id);   // its oldest
      await aSync(); await purgeNow(db);
    });
    const pendingBefore = pendingChanges(b.state).map(c => `${c.op}:${c.id}`).sort();
    await expect(b.sync()).rejects.toThrow('kept asking for a re-download');
    server.hooks.delete(U);
    expect(b.state.meta.needsResync).toBe(true);
    expect(b.get('r01')?.note).toBe('unsynced on B');
    expect(b.get('new-on-b')).toBeDefined();
    expect(pendingChanges(b.state).map(c => `${c.op}:${c.id}`).sort()).toEqual(pendingBefore);
    // Once the churn stops, the same phone completes, uploads, and matches the server and the other phone.
    expect(await b.sync()).toEqual({ pending: 0, conflicts: 0 });
    const rows = await liveRows(db, U, 'saves');
    expect(rows.find(r => r.id === 'r01')?.note).toBe('unsynced on B');
    expect(rows.find(r => r.id === 'new-on-b')).toBeDefined();
    await aSync();
    expect(b.ids()).toEqual(rows.map(r => String(r.id)).sort());
    expect(a.ids()).toEqual(b.ids());
  });

  it('a download that fails partway keeps everything local and is not reported as synced; the retry completes', async () => {
    const U = uid(); const server = pgServer();
    const a = new Device(server, U); for (let i = 0; i < 12; i++) a.add(save(`f${String(i).padStart(2, '0')}`)); await a.sync();
    const b = new Device(server, U, undefined, 3); await b.sync();
    a.remove('saves', 'f00'); a.edit('f05', { title: 'edited on A' }); await a.sync(); await purgeNow(db);   // B must re-download
    b.edit('f01', { note: 'unsynced on B' }); b.remove('saves', 'f02');
    const cursorBefore = b.state.meta.cursor;
    let calls = 0;
    server.hooks.set(U, fn => { if (fn === 'pull_changes' && ++calls === 4) throw new Error('Network request failed'); });
    await expect(b.sync()).rejects.toThrow('Network request failed');
    server.hooks.delete(U);
    // Mid-download: nothing reconciled yet. f00 (purged elsewhere) is still here, the cursor did not move,
    // the re-download is still due, and B's own changes are intact and still pending.
    expect(b.get('f00')).toBeDefined();
    expect(b.state.meta.cursor).toBe(cursorBefore);
    expect(b.state.meta.needsResync).toBe(true);
    expect(b.get('f01')?.note).toBe('unsynced on B');
    expect(b.get('f02')).toBeUndefined();
    expect(pendingChanges(b.state).map(c => `${c.op}:${c.id}`).sort()).toEqual(['delete:f02', 'upsert:f01']);
    expect(await b.sync()).toEqual({ pending: 0, conflicts: 0 });
    expect(b.get('f00')).toBeUndefined();
    expect(b.get('f05')?.title).toBe('edited on A');
    const rows = await liveRows(db, U, 'saves');
    expect(rows.find(r => r.id === 'f01')?.note).toBe('unsynced on B');
    expect(rows.find(r => r.id === 'f02')).toBeUndefined();
  });

  it('"keep mine" on an item deleted elsewhere is the only way a restore is sent; repeated syncs never restore by themselves', async () => {
    const U = uid(); const server = pgServer();
    const a = new Device(server, U); a.add(save('x')); await a.sync();
    const b = new Device(server, U); await b.sync();
    a.remove('saves', 'x'); await a.sync();
    b.edit('x', { note: 'B wants this' });
    const ops: string[] = [];
    server.hooks.set(U, (fn, args) => { if (fn === 'push_changes') for (const c of args.p_changes as { op: string }[]) ops.push(c.op); });
    for (let i = 0; i < 3; i++) expect(await b.sync()).toEqual({ pending: 0, conflicts: 1 });
    expect(ops).toEqual([]);                                   // waiting on the user: nothing sent
    b.resolve('saves', 'x', 'mine'); expect(await b.sync()).toEqual({ pending: 0, conflicts: 0 });
    expect(ops).toEqual(['restore']);
    server.hooks.delete(U);
    await a.sync(); expect(a.get('x')?.note).toBe('B wants this');
  });

  it('a delete sent with a stale base gets a conflict; the other phone\'s newer edit is not lost, and the delete still wins', async () => {
    const U = uid(); const server = pgServer();
    const a = new Device(server, U); a.add(save('d')); await a.sync();
    const b = new Device(server, U); await b.sync();
    a.edit('d', { title: 'newer on A' }); await a.sync();
    let results: string[] = [];
    server.hooks.set(U, (fn, args) => { if (fn === 'push_changes') results = results.concat((args.p_changes as { op: string; base_rev: number }[]).map(c => `${c.op}@${c.base_rev}`)); });
    b.remove('saves', 'd');
    const out = await b.sync();
    server.hooks.delete(U);
    expect(out).toEqual({ pending: 0, conflicts: 0 });
    expect(results.length).toBeGreaterThanOrEqual(1);          // the client re-sent against the newer copy after pulling it
    expect(await liveRows(db, U, 'saves')).toEqual([]);
    await a.sync(); expect(a.ids()).toEqual([]);
  });

  // The release blocker from the re-review: a multi-page FULL re-download while another phone edits, deletes, adds,
  // deletes collections and the retention job purges, between every page. The downloading phone has its own unsynced
  // edits, creates and deletes. Every intermediate state is checked; at the end everything must converge.
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    it(`full re-download under concurrent churn never loses an unsynced change and converges (seed ${seed})`, async () => {
      const R = rng(seed); const U = uid(); const server = pgServer();
      const a = new Device(server, U);
      for (const c of ['c0', 'c1', 'c2', 'c3']) a.addCollection(collection(c));
      for (let i = 0; i < 40; i++) a.add(save(`s${String(i).padStart(2, '0')}`, { collectionId: R() < 0.6 ? `c${Math.floor(R() * 4)}` : undefined }));
      await a.sync();
      const b = new Device(server, U, undefined, 4);
      await b.sync();
      a.remove('saves', 's39'); await a.sync(); await purgeNow(db); // B must re-download

      // B's own unsynced work.
      const ids = b.ids();
      const bEdits = new Map<string, string>();
      for (const id of ids.filter(() => R() < 0.25)) { const v = `B note ${id} #${seed}`; b.edit(id, { note: v }); bEdits.set(id, v); }
      const bDeletes = ids.filter(id => !bEdits.has(id) && id !== 's39' && R() < 0.08);
      for (const id of bDeletes) b.remove('saves', id);
      for (let i = 0; i < 3; i++) { const id = `bnew${i}`; b.add(save(id, { note: `B new ${i}` })); bEdits.set(id, `B new ${i}`); }

      // Between B's pages: A does 1–3 random things and syncs; sometimes the retention job runs (at most twice).
      let purges = 0, aOps = 0, inDownload = false;
      const aSync = () => runSync({ get: () => a.state, apply: a.apply, transport: supabaseTransport(() => rpcClient(db, U)) });
      server.hooks.set(U, async (fn, args) => {
        if (fn !== 'pull_changes') return;
        if (args.p_since === 0) inDownload = true;
        if (!inDownload) return;
        const n = 1 + Math.floor(R() * 3);
        for (let i = 0; i < n; i++) {
          const live = a.state.local.saves; const r = R(); aOps++;
          if (r < 0.35 && live.length) { const s = live[Math.floor(R() * live.length)]; a.edit(s.id, { title: `A title ${aOps}` }); }
          else if (r < 0.5 && live.length) { const s = live[Math.floor(R() * live.length)]; a.edit(s.id, { note: `A note ${aOps}` }); }   // may collide with B's note
          else if (r < 0.7 && live.length) { const s = live[Math.floor(R() * live.length)]; a.remove('saves', s.id); }
          else if (r < 0.8 && a.state.local.collections.length) { const c = a.state.local.collections[Math.floor(R() * a.state.local.collections.length)]; a.remove('collections', c.id); }
          else a.add(save(`anew${aOps}`));
        }
        await aSync();
        if (purges < 2 && R() < 0.25) { purges++; await purgeNow(db); }
      });

      // Invariant on every state B passes through: until the server has acknowledged one of B's edits or creates
      // (B's base for it carries B's value), it is never dropped or overwritten. After that, A may legitimately
      // change or delete it, and the engine must then follow the server.
      const violations: string[] = [];
      const acked = new Set<string>();
      const apply = b.apply;
      b.apply = fn => {
        apply(fn);
        for (const [id, note] of bEdits) {
          if (acked.has(id)) continue;
          if ((b.state.meta.base.saves[id]?.item as { note?: string } | null | undefined)?.note === note) { acked.add(id); continue; }
          const item = b.get(id);
          if (!item) violations.push(`${id} removed before the server had it`);
          else if (item.note !== note) violations.push(`${id} note became ${JSON.stringify(item.note)} before the server had B's`);
        }
      };
      const first = await b.sync();
      server.hooks.delete(U);
      expect(violations.slice(0, 5)).toEqual([]);
      expect(first.pending).toBe(0);                            // everything not awaiting a decision was acknowledged

      // The user keeps their version of everything in conflict; then both phones settle.
      for (const c of [...b.state.meta.conflicts]) b.resolve(c.table, c.id, 'mine');
      expect(await b.sync()).toEqual({ pending: 0, conflicts: 0 });
      expect(violations.slice(0, 5)).toEqual([]);
      // Every one of B's unsynced edits and creates reached the server (A may have changed some afterwards).
      expect([...bEdits.keys()].filter(id => !acked.has(id))).toEqual([]);
      // A, which kept editing, takes the server's version of anything it now conflicts on; then both settle.
      await aSync();
      for (const c of [...a.state.meta.conflicts]) a.resolve(c.table, c.id, 'theirs');
      await aSync(); await b.sync();
      expect(await aSync()).toEqual({ pending: 0, conflicts: 0 });
      expect(await b.sync()).toEqual({ pending: 0, conflicts: 0 });

      // Convergence: both phones equal the server.
      const serverSaves = (await liveRows(db, U, 'saves')).map(pick);
      const serverCols = (await liveRows(db, U, 'collections')).map(r => r.id);
      for (const d of [a, b]) {
        const local = d.state.local.saves.map(pickLocal).sort((x, y) => x.id.localeCompare(y.id));
        expect(same(local, serverSaves)).toBe(true);
        expect(d.state.local.collections.map(c => c.id).sort()).toEqual(serverCols);
      }
      // B's own deletes are honoured (delete wins over A's concurrent edits).
      for (const id of bDeletes) expect(serverSaves.find(s => s.id === id)).toBeUndefined();
      // No row points at a deleted collection.
      for (const s of serverSaves) if (s.collectionId) expect(serverCols).toContain(s.collectionId);
      expect(await head(U)).toBeGreaterThan(0);
    });
  }
});
