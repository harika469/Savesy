/**
 * The real SavesProvider with cloud sync on, an in-memory B1 server, and in-memory phone storage that can fail.
 * Covers account isolation (C-8, REQ-2), demo handling (S-03), awaitable sync and honest status (S-01, S-04),
 * storage failures (C-9) and migration from the previous storage format.
 */
import React from 'react';
import { FakeSyncServer } from '../test-support/fakeSyncServer';

const mockStore = new Map<string, string>();
const mockStorage = { failWrites: false };
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => mockStore.get(k) ?? null,
    setItem: async (k: string, v: string) => { if (mockStorage.failWrites) throw new Error('No space left on device'); mockStore.set(k, v); },
  },
}));
jest.mock('@/lib/supabase', () => ({ cloudConfigured: true }));
const mockServer: { current: FakeSyncServer; uid: string | null } = { current: new FakeSyncServer(), uid: null };
jest.mock('@/lib/cloudSync', () => ({
  friendlyCloudError: (m: string) => m,
  supabaseTransport: () => mockServer.current.transport(mockServer.uid!),
}));

import { SavesProvider, useSaves } from '@/context/SavesContext';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require('react-test-renderer');

let ctx: ReturnType<typeof useSaves>;
function Probe() { ctx = useSaves(); return null; }
const flush = async (n = 30) => { for (let i = 0; i < n; i++) await TestRenderer.act(async () => { await Promise.resolve(); }); };
let renderer: any;
async function mount(userId: string | null | undefined) {
  mockServer.uid = userId ?? null;
  await TestRenderer.act(async () => { renderer = TestRenderer.create(<SavesProvider userId={userId}><Probe /></SavesProvider>); });
  await flush();
}
async function setUser(userId: string | null) {
  mockServer.uid = userId;
  await TestRenderer.act(async () => { renderer.update(<SavesProvider userId={userId}><Probe /></SavesProvider>); });
  await flush();
}
const titles = () => ctx.saves.map(s => s.title).sort();
const serverTitles = (uid: string) => mockServer.current.live(uid, 'saves').map(r => String(r.title)).sort();

beforeEach(() => {
  jest.useFakeTimers();
  mockStore.clear(); mockStorage.failWrites = false;
  mockServer.current = new FakeSyncServer(); mockServer.uid = null;
});
afterEach(async () => { await TestRenderer.act(async () => { renderer?.unmount(); }); jest.useRealTimers(); });

describe('S-03 first sign-in and the demo', () => {
  it('the untouched demo is never uploaded into an account', async () => {
    await mount(null);
    expect(ctx.saves.length).toBeGreaterThan(0);                 // guest sees the demo
    await setUser('user_A');
    await TestRenderer.act(async () => { await ctx.syncNow(); });
    expect(serverTitles('user_A')).toEqual([]);
    expect(ctx.saves).toEqual([]);
  });

  it('saves made as a guest join the account and upload; the guest library is then empty', async () => {
    await mount(null);
    await TestRenderer.act(async () => { ctx.clearAll(); ctx.addSave({ url: 'https://g.com', title: 'Saved as guest', type: 'other', tags: [] }); });
    await setUser('user_A');
    await TestRenderer.act(async () => { await ctx.syncNow(); });
    expect(serverTitles('user_A')).toEqual(['Saved as guest']);
    await setUser(null);
    expect(ctx.saves).toEqual([]);
  });

  it('an edit made while the first sync is in flight is kept and uploaded', async () => {
    await mount(null);
    await TestRenderer.act(async () => { ctx.clearAll(); });
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const realPull = mockServer.current.pull.bind(mockServer.current);
    let first = true;
    mockServer.current.pull = ((...a: Parameters<FakeSyncServer['pull']>) => { if (first) { first = false; return gate.then(() => realPull(...a)) as never; } return realPull(...a); }) as never;
    mockServer.current.transport = ((uid: string) => ({ pull: (s: number, h: number | null, l: number) => Promise.resolve(mockServer.current.pull(uid, s, h, l)), push: async (c: never) => mockServer.current.push(uid, c) })) as never;
    await setUser('user_A');                                     // first sync starts and waits on the gate
    await TestRenderer.act(async () => { ctx.addSave({ url: 'https://d.com', title: 'During first sync', type: 'other', tags: [] }); });
    release();
    await flush();
    await TestRenderer.act(async () => { await ctx.syncNow(); });
    expect(titles()).toEqual(['During first sync']);
    expect(serverTitles('user_A')).toEqual(['During first sync']);
  });
});

describe('C-8 / REQ-2 accounts never erase unsynced changes', () => {
  it('A\'s offline edit survives signing out, another account using the phone, and signing back in, then syncs', async () => {
    await mount('user_A');
    await TestRenderer.act(async () => { ctx.addSave({ url: 'https://a.com', title: 'A synced', type: 'other', tags: [] }); await ctx.syncNow(); });
    expect(serverTitles('user_A')).toEqual(['A synced']);

    mockServer.current.failNext.pull = new Error('Network request failed');
    await TestRenderer.act(async () => { ctx.updateSave(ctx.saves[0].id, { title: 'A edited offline' }); await ctx.syncNow(); });
    expect(ctx.cloud.state).toBe('error');
    expect(ctx.pendingCount).toBe(1);

    await setUser(null);                                         // signed out (or session expired)
    expect(titles()).not.toContain('A edited offline');            // A's library is not shown to the guest...
    await setUser('user_B');
    await TestRenderer.act(async () => { ctx.addSave({ url: 'https://b.com', title: 'B only', type: 'other', tags: [] }); await ctx.syncNow(); });
    expect(titles()).toEqual(['B only']);                         // ...nor to another account
    await setUser(null);
    await setUser('user_A');
    expect(titles()).toEqual(['A edited offline']);               // ...but it was never erased
    await TestRenderer.act(async () => { await ctx.syncNow(); });
    expect(serverTitles('user_A')).toEqual(['A edited offline']);
    expect(serverTitles('user_B')).toEqual(['B only']);
  });
});

describe('S-01 / S-04 awaitable sync and honest status', () => {
  it('syncNow during an in-flight sync waits for it and a follow-up, and returns true only when everything is acknowledged', async () => {
    await mount('user_A');
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    mockServer.current.beforePush = () => gate;
    let first: boolean | undefined, second: boolean | undefined;
    await TestRenderer.act(async () => {
      ctx.addSave({ url: 'https://1.com', title: 'one', type: 'other', tags: [] });
      ctx.syncNow().then(v => { first = v; });
    });
    await flush();
    await TestRenderer.act(async () => {
      ctx.addSave({ url: 'https://2.com', title: 'two', type: 'other', tags: [] });
      ctx.syncNow().then(v => { second = v; });
    });
    expect(ctx.cloud.state).not.toBe('synced');
    expect(second).toBeUndefined();                               // doesn't return early (S-01)
    mockServer.current.beforePush = undefined; release();
    await flush();
    expect(first).toBe(true); expect(second).toBe(true);
    expect(serverTitles('user_A')).toEqual(['one', 'two']);
    expect(ctx.cloud.state).toBe('synced');
  });

  it('an edit after a completed sync switches the status from synced to pending immediately (S-04)', async () => {
    await mount('user_A');
    await TestRenderer.act(async () => { await ctx.syncNow(); });
    expect(ctx.cloud.state).toBe('synced');
    await TestRenderer.act(async () => { ctx.addSave({ url: 'https://x.com', title: 'x', type: 'other', tags: [] }); });
    expect(ctx.cloud).toEqual({ state: 'pending', count: 1 });
  });

  it('conflicts show as needing attention, never as synced; resolving them syncs', async () => {
    await mount('user_A');
    await TestRenderer.act(async () => { ctx.addSave({ url: 'https://c.com', title: 'Original', type: 'other', tags: [] }); await ctx.syncNow(); });
    const id = ctx.saves[0].id;
    const row = mockServer.current.row('user_A', 'saves', id)!;
    mockServer.current.push('user_A', [{ table: 'saves', id, base_rev: row.rev, op: 'upsert', row: { url: 'https://c.com', title: 'Other device', tags: [], is_favorite: false, created_at: row.created_at, updated_at: new Date().toISOString() } }]);
    await TestRenderer.act(async () => { ctx.updateSave(id, { title: 'This phone' }); });
    let ok: boolean | undefined;
    await TestRenderer.act(async () => { ok = await ctx.syncNow(); });
    expect(ok).toBe(false);
    expect(ctx.cloud).toEqual({ state: 'attention', conflicts: 1 });
    expect(titles()).toEqual(['This phone']);
    await TestRenderer.act(async () => { ctx.resolveConflict('saves', id, 'mine'); ok = await ctx.syncNow(); });
    expect(ok).toBe(true);
    expect(serverTitles('user_A')).toEqual(['This phone']);
  });
});

describe('C-9 storage failures are reported, not swallowed', () => {
  it('a failed write sets storageError; the next successful write clears it', async () => {
    await mount(null);
    mockStorage.failWrites = true;
    await TestRenderer.act(async () => { ctx.addSave({ url: 'https://f.com', title: 'f', type: 'other', tags: [] }); });
    await flush();
    expect(ctx.storageError).toMatch(/No space left/);
    mockStorage.failWrites = false;
    await TestRenderer.act(async () => { ctx.addSave({ url: 'https://g.com', title: 'g', type: 'other', tags: [] }); });
    await flush();
    expect(ctx.storageError).toBeUndefined();
  });

  it('the library and its sync bookkeeping are one write (one key per library)', async () => {
    await mount('user_A');
    await TestRenderer.act(async () => { ctx.addSave({ url: 'https://a.com', title: 'a', type: 'other', tags: [] }); await ctx.syncNow(); });
    const stored = JSON.parse(mockStore.get('@savesy/v2/user:user_A')!);
    expect(stored.engine.local.saves[0].title).toBe('a');
    expect(Object.keys(stored.engine.meta.base.saves)).toHaveLength(1);
  });
});

describe('migration from the previous storage format', () => {
  it('a signed-in user\'s old library moves into their account library; identical data syncs without conflicts or re-uploads', async () => {
    const save = { id: 's1', url: 'https://old.com', title: 'Old save', type: 'other', tags: [], isFavorite: false, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' };
    mockServer.current.push('user_A', [{ table: 'saves', id: 's1', base_rev: 0, op: 'upsert', row: { url: save.url, title: save.title, type: 'other', tags: [], is_favorite: false, created_at: save.createdAt, updated_at: save.updatedAt } }]);
    mockStore.set('@savesy/v1', JSON.stringify({ saves: [save], collections: [] }));
    mockStore.set('@savesy/sync-v1', JSON.stringify({ owner: 'user_A', demo: false, tombstones: { saves: [], collections: [] } }));
    await mount(undefined);                                       // Clerk not answered yet (e.g. offline)
    expect(titles()).toEqual(['Old save']);                        // last library shown straight away
    const pushes = mockServer.current.pushes;
    await setUser('user_A');
    await TestRenderer.act(async () => { await ctx.syncNow(); });
    expect(ctx.conflicts).toEqual([]);
    expect(mockServer.current.pushes).toBe(pushes);               // nothing re-uploaded
    expect(mockStore.get('@savesy/v1')).toBeTruthy();               // old data left in place
  });
});
