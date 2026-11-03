/**
 * Sync engine against an in-memory B1 server, with several simulated phones.
 * REQ-1..REQ-5 are the owner's B2 acceptance requirements (issue #1); the rest cover the engine generally.
 */
import { applyServerRow, emptyMeta, EngineState, fromLegacy, isDirty, pendingChanges, runSync } from '@/utils/syncEngine';
import { collection, Device, save, tick } from '../test-support/device';
import { FakeSyncServer } from '../test-support/fakeSyncServer';

const U = 'user_1';
let server: FakeSyncServer;
beforeEach(() => { server = new FakeSyncServer(); });

describe('basics', () => {
  it('uploads local creates and reports nothing pending only after the server acknowledged them', async () => {
    const a = new Device(server, U);
    a.add(save('s1', { title: 'Ramen', tags: ['food'] }));
    expect(pendingChanges(a.state)).toHaveLength(1);
    const out = await a.sync();
    expect(out).toEqual({ pending: 0, conflicts: 0 });
    expect(server.row(U, 'saves', 's1')).toMatchObject({ title: 'Ramen', rev: 1 });
    expect(a.state.meta.base.saves.s1.rev).toBe(1);
  });

  it('adopts the server form (timestamps as +00:00) without becoming permanently dirty', async () => {
    const a = new Device(server, U);
    a.add(save('s1'));
    await a.sync();
    expect(isDirty(a.state, 'saves', 's1')).toBe(false);
    const pushesBefore = server.pushes;
    expect(await a.sync()).toEqual({ pending: 0, conflicts: 0 });
    expect(server.pushes).toBe(pushesBefore); // nothing re-sent
  });

  it('a second device receives everything', async () => {
    const a = new Device(server, U);
    a.addCollection(collection('trips', 'Trips'));
    a.add(save('s1', { collectionId: 'trips' }));
    await a.sync();
    const b = new Device(server, U);
    await b.sync();
    expect(b.ids()).toEqual(['s1']);
    expect(b.get('s1')?.collectionId).toBe('trips');
    expect(b.state.local.collections.map(c => c.name)).toEqual(['Trips']);
  });

  it('edits to different fields on two devices both survive, with no conflict', async () => {
    const a = new Device(server, U); a.add(save('s1', { title: 'Ramen' })); await a.sync();
    const b = new Device(server, U); await b.sync();
    a.edit('s1', { title: 'Best ramen' }); await a.sync();
    b.edit('s1', { note: 'go on Sunday' });
    expect(await b.sync()).toEqual({ pending: 0, conflicts: 0 });
    await a.sync();
    for (const d of [a, b]) expect(d.get('s1')).toMatchObject({ title: 'Best ramen', note: 'go on Sunday' });
    expect(server.row(U, 'saves', 's1')).toMatchObject({ title: 'Best ramen', note: 'go on Sunday' });
  });

  it('tags merge as sets across devices', async () => {
    const a = new Device(server, U); a.add(save('s1', { tags: ['food', 'tokyo'] })); await a.sync();
    const b = new Device(server, U); await b.sync();
    a.edit('s1', { tags: ['food', 'tokyo', 'lunch'] }); await a.sync();
    b.edit('s1', { tags: ['tokyo', 'cheap'] }); await b.sync();
    expect([...(b.get('s1')?.tags ?? [])].sort()).toEqual(['cheap', 'lunch', 'tokyo']);
  });
});

describe('REQ-4 conflicts are visible; the unsynced change is preserved', () => {
  async function conflicted() {
    const a = new Device(server, U); a.add(save('s1', { title: 'Ramen' })); await a.sync();
    const b = new Device(server, U); await b.sync();
    a.edit('s1', { title: 'From A' }); await a.sync();
    b.edit('s1', { title: 'From B' });
    const out = await b.sync();
    return { a, b, out };
  }

  it('same field on two devices: B keeps its value, a conflict is recorded, nothing is overwritten', async () => {
    const { b, out } = await conflicted();
    expect(out.conflicts).toBe(1);
    expect(b.get('s1')?.title).toBe('From B');                              // B's unsynced change preserved
    expect(b.state.meta.conflicts[0]).toMatchObject({ table: 'saves', id: 's1', kind: 'edited', fields: ['title'] });
    expect((b.state.meta.conflicts[0].server as { title: string }).title).toBe('From A');
    expect(server.row(U, 'saves', 's1')?.title).toBe('From A');               // and the server isn't overwritten either
    expect(pendingChanges(b.state)).toHaveLength(0);                          // conflicted items are not pushed
  });

  it('non-conflicting fields from the other device are still merged into the conflicted item', async () => {
    const a = new Device(server, U); a.add(save('s1', { title: 'Ramen' })); await a.sync();
    const b = new Device(server, U); await b.sync();
    a.edit('s1', { title: 'From A', note: 'note from A' }); await a.sync();
    b.edit('s1', { title: 'From B' }); await b.sync();
    expect(b.get('s1')).toMatchObject({ title: 'From B', note: 'note from A' });
  });

  it('the conflict survives later syncs and further server changes until the user decides', async () => {
    const { a, b } = await conflicted();
    a.edit('s1', { isFavorite: true }); await a.sync();
    await b.sync();
    expect(b.state.meta.conflicts).toHaveLength(1);
    expect(b.get('s1')).toMatchObject({ title: 'From B', isFavorite: true });
  });

  it('"keep mine" pushes the local value', async () => {
    const { a, b } = await conflicted();
    b.resolve('saves', 's1', 'mine');
    expect(await b.sync()).toEqual({ pending: 0, conflicts: 0 });
    expect(server.row(U, 'saves', 's1')?.title).toBe('From B');
    await a.sync();
    expect(a.get('s1')?.title).toBe('From B');
  });

  it('"use theirs" takes the other device\'s version', async () => {
    const { b } = await conflicted();
    b.resolve('saves', 's1', 'theirs');
    expect(await b.sync()).toEqual({ pending: 0, conflicts: 0 });
    expect(b.get('s1')?.title).toBe('From A');
    expect(server.row(U, 'saves', 's1')?.title).toBe('From A');
  });
});

describe('deletes', () => {
  it('a delete reaches the other device and never comes back (C-2)', async () => {
    const a = new Device(server, U); a.add(save('s1')); a.add(save('s2')); await a.sync();
    const b = new Device(server, U); await b.sync();
    a.remove('saves', 's1'); await a.sync();
    await b.sync();
    expect(b.ids()).toEqual(['s2']);
    await b.sync(); await a.sync();
    expect(server.live(U, 'saves').map(r => r.id)).toEqual(['s2']);
    expect(a.ids()).toEqual(['s2']);
  });

  it('REQ-4: deleted on A while edited on B: B keeps its edit as a visible conflict, not re-uploaded until decided', async () => {
    const a = new Device(server, U); a.add(save('s1', { title: 'Ramen' })); await a.sync();
    const b = new Device(server, U); await b.sync();
    a.remove('saves', 's1'); await a.sync();
    b.edit('s1', { note: 'important' });
    const out = await b.sync();
    expect(out.conflicts).toBe(1);
    expect(b.get('s1')?.note).toBe('important');
    expect(b.state.meta.conflicts[0]).toMatchObject({ kind: 'deletedRemotely', server: null });
    expect(server.row(U, 'saves', 's1')?.deleted_at).toBeTruthy();          // still deleted on the server
    b.resolve('saves', 's1', 'mine'); await b.sync();                          // user restores it
    expect(server.row(U, 'saves', 's1')).toMatchObject({ deleted_at: null, note: 'important' });
    await a.sync();
    expect(a.get('s1')?.note).toBe('important');
  });

  it('deleted here while edited elsewhere: the local delete is kept (delete wins) and pushed against the newer copy', async () => {
    const a = new Device(server, U); a.add(save('s1')); await a.sync();
    const b = new Device(server, U); await b.sync();
    a.edit('s1', { title: 'edited on A' }); await a.sync();
    b.remove('saves', 's1');
    expect(await b.sync()).toEqual({ pending: 0, conflicts: 0 });
    expect(server.row(U, 'saves', 's1')?.deleted_at).toBeTruthy();
  });
});

describe('REQ-3 collection deletion', () => {
  it('all affected saves update locally even when the changes arrive across several pages', async () => {
    const a = new Device(server, U);
    a.addCollection(collection('trips'));
    for (let i = 1; i <= 7; i++) a.add(save(`s${i}`, { collectionId: 'trips' }));
    await a.sync();
    const b = new Device(server, U, undefined, 2);                             // pages of 2
    await b.sync();
    expect(b.state.local.saves.every(s => s.collectionId === 'trips')).toBe(true);
    a.remove('collections', 'trips');
    a.apply(s => ({ ...s, local: { ...s.local, saves: s.local.saves.map(x => ({ ...x, collectionId: undefined })) } }));
    await a.sync();
    const pullsBefore = server.pulls;
    expect(await b.sync()).toEqual({ pending: 0, conflicts: 0 });
    expect(server.pulls - pullsBefore).toBeGreaterThanOrEqual(4);              // tombstone + 7 detached saves at 2 per page
    expect(b.state.local.collections).toHaveLength(0);
    expect(b.state.local.saves).toHaveLength(7);
    expect(b.state.local.saves.every(s => s.collectionId === undefined)).toBe(true);
  });

  it('a save edited locally while its collection was deleted elsewhere keeps the edit and loses the collection', async () => {
    const a = new Device(server, U); a.addCollection(collection('trips')); a.add(save('s1', { collectionId: 'trips' })); await a.sync();
    const b = new Device(server, U); await b.sync();
    a.remove('collections', 'trips'); await a.sync();
    b.edit('s1', { note: 'mine' });
    expect(await b.sync()).toEqual({ pending: 0, conflicts: 0 });
    expect(b.get('s1')).toMatchObject({ note: 'mine', collectionId: undefined });
    expect(server.row(U, 'saves', 's1')).toMatchObject({ note: 'mine', collection_id: null });
  });
});

describe('REQ-1 full re-download reconciles deletions', () => {
  it('items deleted (and purged) on the server are removed here and not re-uploaded; edited ones become conflicts; new ones upload', async () => {
    const a = new Device(server, U);
    for (const id of ['keep', 'gone', 'gone-edited']) a.add(save(id));
    await a.sync();
    const b = new Device(server, U); await b.sync();
    a.remove('saves', 'gone'); a.remove('saves', 'gone-edited'); await a.sync();
    server.purgeTombstones();                                                // tombstones gone: B can't learn the deletes incrementally
    b.edit('gone-edited', { note: 'edited offline' });
    b.add(save('brand-new'));
    const out = await b.sync();
    expect(b.state.meta.needsResync).toBe(false);
    expect(b.ids()).toEqual(['brand-new', 'gone-edited', 'keep']);
    expect(out.conflicts).toBe(1);
    expect(b.state.meta.conflicts[0]).toMatchObject({ id: 'gone-edited', kind: 'deletedRemotely' });
    expect(server.row(U, 'saves', 'gone')).toBeUndefined();                  // NOT re-uploaded
    expect(server.row(U, 'saves', 'gone-edited')).toBeUndefined();           // not re-uploaded until the user decides
    expect(server.row(U, 'saves', 'brand-new')?.deleted_at).toBeNull();      // never-synced item uploaded
  });

  it('an interrupted re-download restarts from the beginning and still reconciles', async () => {
    const a = new Device(server, U); a.add(save('keep')); a.add(save('gone')); await a.sync();
    const b = new Device(server, U, undefined, 1); await b.sync();
    a.remove('saves', 'gone'); await a.sync(); server.purgeTombstones();
    let calls = 0;
    const realPull = server.pull.bind(server);
    server.pull = (...args) => { if (++calls === 2) throw new Error('network'); return realPull(...args); };
    await expect(b.sync()).rejects.toThrow('network');
    expect(b.state.meta.needsResync).toBe(true);                              // remembered across the failure
    server.pull = realPull;
    await b.sync();
    expect(b.ids()).toEqual(['keep']);
    expect(server.row(U, 'saves', 'gone')).toBeUndefined();
  });
});

describe('REQ-2 pending edits survive offline work and failures', () => {
  it('offline edits are kept through failed pulls and pushes and upload once the network is back', async () => {
    const a = new Device(server, U); a.add(save('s1')); await a.sync();
    a.edit('s1', { title: 'offline edit' }); a.add(save('s2'));
    server.failNext.pull = new Error('Network request failed');
    await expect(a.sync()).rejects.toThrow('Network');
    server.failNext.push = new Error('Network request failed');
    await expect(a.sync()).rejects.toThrow('Network');
    expect(a.get('s1')?.title).toBe('offline edit');
    expect(pendingChanges(a.state).map(c => c.id).sort()).toEqual(['s1', 's2']);
    expect(await a.sync()).toEqual({ pending: 0, conflicts: 0 });
    expect(server.row(U, 'saves', 's1')?.title).toBe('offline edit');
  });

  it('an edit made while a push is in flight is kept and sent in the next round', async () => {
    const a = new Device(server, U); a.add(save('s1')); await a.sync();
    a.edit('s1', { title: 'first' });
    let once = true;
    server.beforePush = () => { if (once) { once = false; a.edit('s1', { title: 'second (during push)' }); } };
    expect(await a.sync()).toEqual({ pending: 0, conflicts: 0 });
    expect(a.get('s1')?.title).toBe('second (during push)');
    expect(server.row(U, 'saves', 's1')?.title).toBe('second (during push)');
  });

  it('pending edits survive a restart (state round-trips through JSON)', async () => {
    const a = new Device(server, U); a.add(save('s1')); await a.sync();
    a.edit('s1', { title: 'unsynced' });
    const restarted = new Device(server, U, JSON.parse(JSON.stringify(a.state)));
    expect(pendingChanges(restarted.state)).toHaveLength(1);
    await restarted.sync();
    expect(server.row(U, 'saves', 's1')?.title).toBe('unsynced');
  });

  it('a conflict survives a restart', async () => {
    const a = new Device(server, U); a.add(save('s1')); await a.sync();
    const b = new Device(server, U); await b.sync();
    a.edit('s1', { title: 'A' }); await a.sync(); b.edit('s1', { title: 'B' }); await b.sync();
    const restarted = new Device(server, U, JSON.parse(JSON.stringify(b.state)));
    expect(await restarted.sync()).toEqual({ pending: 0, conflicts: 1 });
    expect(restarted.get('s1')?.title).toBe('B');
  });

  it('against a server without the B1 migration, sync fails loudly and nothing local changes', async () => {
    const a = new Device(server, U); a.add(save('s1'));
    const before = JSON.stringify(a.state);
    const noB1 = { pull: async () => { throw new Error('Could not find the function public.pull_changes'); }, push: async () => { throw new Error('unreachable'); } };
    await expect(runSync({ get: () => a.state, apply: a.apply, transport: noB1 })).rejects.toThrow('pull_changes');
    expect(JSON.stringify(a.state)).toBe(before);
  });
});

describe('migrating data from the previous sync protocol', () => {
  it('identical items become clean (nothing re-sent), differing fields become conflicts, previous-protocol deletes are honoured', async () => {
    const a = new Device(server, U);
    const same = save('same', { title: 'Same' }), diff = save('diff', { title: 'server' }), del = save('deleted-before');
    a.add(same); a.add(diff); a.add(del); await a.sync();
    const legacy = fromLegacy(
      { saves: [same, { ...diff, title: 'local version' }, save('local-only')], collections: [] },
      { saves: ['deleted-before'], collections: [] },
    );
    const b = new Device(server, U, legacy);
    const out = await b.sync();
    expect(out.conflicts).toBe(1);
    expect(b.state.meta.conflicts[0]).toMatchObject({ id: 'diff', kind: 'edited', fields: ['title'] });
    expect(b.get('diff')?.title).toBe('local version');
    expect(server.row(U, 'saves', 'local-only')?.deleted_at).toBeNull();
    expect(server.row(U, 'saves', 'deleted-before')?.deleted_at).toBeTruthy();
    expect(b.ids()).toEqual(['diff', 'local-only', 'same']);
  });
});

describe('isolation and ordering', () => {
  it('another user\'s data never reaches this device', async () => {
    const a = new Device(server, 'user_A'); a.add(save('s1', { title: 'A only' })); await a.sync();
    const b = new Device(server, 'user_B'); await b.sync();
    expect(b.ids()).toEqual([]);
  });

  it('an older server row never overwrites a newer one already applied', () => {
    let s: EngineState = { local: { saves: [], collections: [] }, meta: emptyMeta() };
    const row = (rev: number, title: string) => ({ id: 's1', rev, deleted_at: null, url: 'https://x', title, tags: [], is_favorite: false, created_at: tick(), updated_at: tick() });
    s = applyServerRow(s, 'saves', row(5, 'newer'));
    s = applyServerRow(s, 'saves', row(3, 'older'));
    expect(s.local.saves[0].title).toBe('newer');
  });
});
