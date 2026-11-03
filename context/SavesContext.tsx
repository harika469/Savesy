import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { seedCollections, seedSaves } from '@/constants/seed';
import { friendlyCloudError, supabaseTransport } from '@/lib/cloudSync';
import { cloudConfigured } from '@/lib/supabase';
import { Collection, NewSave, SavedItem, SaveType } from '@/types';
import { mergeBackup, parseBackup, Store } from '@/utils/backup';
import { matchesSave, sameUrl } from '@/utils/saves';
import { Conflict, emptyMeta, EngineState, fromLegacy, Local, pendingCount, resolveConflict as resolveInEngine, runSync, Table } from '@/utils/syncEngine';

/*
 * Local storage (v2): one library per account plus one for guest use, so signing out or switching accounts never
 * erases anything (pending edits stay with their account and sync when it signs in again).
 *   @savesy/v2/guest, @savesy/v2/user:<clerk id>  -> { version: 2, engine: { local, meta }, demo }
 *   @savesy/v2/active                             -> last library shown (loads offline, before Clerk answers)
 * Each change is ONE write of one key (library and sync bookkeeping together), and write failures are reported.
 * The previous format (@savesy/v1 + @savesy/sync-v1) is migrated once into the matching library.
 */
const KEY = (scope: string) => `@savesy/v2/${scope}`;
const ACTIVE_KEY = '@savesy/v2/active';
const MIGRATED_KEY = '@savesy/v2/migrated-from-v1';
const LEGACY_STORE_KEY = '@savesy/v1';
const LEGACY_SYNC_KEY = '@savesy/sync-v1';
const SYNC_DELAY_MS = 1500;

type Persisted = { version: 2; engine: EngineState; demo: boolean };
type Scope = string; // 'guest' | `user:${id}`
const userScope = (id: string) => `user:${id}`;
const isUserScope = (s: Scope) => s.startsWith('user:');

const demoData = (): Persisted => ({ version: 2, engine: { local: { saves: seedSaves, collections: seedCollections }, meta: emptyMeta() }, demo: true });
const emptyData = (): Persisted => ({ version: 2, engine: { local: { saves: [], collections: [] }, meta: emptyMeta() }, demo: false });
const defaultFor = (scope: Scope) => (scope === 'guest' ? demoData() : emptyData());

function parsePersisted(raw: string | null): Persisted | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Persisted;
    const local = v?.engine?.local;
    if (v?.version !== 2 || !Array.isArray(local?.saves) || !Array.isArray(local?.collections) || !v.engine.meta) return null;
    return { version: 2, demo: !!v.demo, engine: { local: { saves: local.saves.map(s => ({ ...s, tags: s.tags ?? [] })), collections: local.collections }, meta: { ...emptyMeta(), ...v.engine.meta } } };
  } catch { return null; }
}
async function loadScope(scope: Scope): Promise<Persisted> {
  return parsePersisted(await AsyncStorage.getItem(KEY(scope))) ?? defaultFor(scope);
}
async function migrateFromV1(): Promise<Scope | undefined> {
  if (await AsyncStorage.getItem(MIGRATED_KEY)) return undefined;
  const [raw, rawSync] = await Promise.all([AsyncStorage.getItem(LEGACY_STORE_KEY), AsyncStorage.getItem(LEGACY_SYNC_KEY)]);
  let target: Scope | undefined;
  if (raw) {
    try {
      const store = JSON.parse(raw) as Store;
      if (Array.isArray(store?.saves) && Array.isArray(store?.collections)) {
        let sync: { owner?: string; demo?: boolean; tombstones?: { saves: string[]; collections: string[] } } = {};
        try { sync = rawSync ? JSON.parse(rawSync) : {}; } catch { sync = {}; }
        target = typeof sync.owner === 'string' ? userScope(sync.owner) : 'guest';
        if (!(await AsyncStorage.getItem(KEY(target)))) {
          const local: Local = { saves: store.saves.map(s => ({ ...s, tags: s.tags ?? [] })), collections: store.collections };
          const data: Persisted = { version: 2, engine: fromLegacy(local, sync.owner ? sync.tombstones : undefined), demo: sync.demo === true };
          await AsyncStorage.setItem(KEY(target), JSON.stringify(data));
          await AsyncStorage.setItem(ACTIVE_KEY, target);
        }
      }
    } catch { /* unreadable old data: leave it in place, untouched */ }
  }
  // The v1 keys are kept (not deleted) so an older build could still read them.
  await AsyncStorage.setItem(MIGRATED_KEY, '1');
  return target;
}

export type SearchOptions = { type?: SaveType; favoritesOnly?: boolean };
export type CloudStatus =
  | { state: 'off' }
  | { state: 'signedOut' }
  | { state: 'syncing' }
  | { state: 'pending'; count: number }
  | { state: 'synced'; at: string }
  | { state: 'attention'; conflicts: number }
  | { state: 'error'; message: string; at: string; pending: number };

type ContextValue = Store & {
  ready: boolean;
  cloud: CloudStatus;
  /** Changes on this phone the server hasn't acknowledged yet (excludes items waiting on a conflict decision). */
  pendingCount: number;
  /** Items changed both here and on another device (or deleted there while edited here). */
  conflicts: Conflict[];
  resolveConflict: (table: Table, id: string, choice: 'mine' | 'theirs') => void;
  /** Set when saving to this phone's storage failed; cleared by the next successful write. */
  storageError?: string;
  /** Syncs now (waiting for any sync in flight); resolves true only when the server has acknowledged everything. */
  syncNow: () => Promise<boolean>;
  addSave: (save: NewSave) => SavedItem;
  updateSave: (id: string, changes: Partial<SavedItem>) => void;
  deleteSave: (id: string) => void;
  toggleFavorite: (id: string) => void;
  addCollection: (name: string) => Collection;
  renameCollection: (id: string, name: string) => void;
  deleteCollection: (id: string) => void;
  searchSaves: (query: string, options?: SearchOptions) => SavedItem[];
  findByUrl: (url: string) => SavedItem | undefined;
  getRediscoverItem: (excludedId?: string) => SavedItem | undefined;
  /** Merges a backup's JSON into the library; throws a friendly Error if it isn't one. */
  importBackup: (json: string) => { addedSaves: number; addedCollections: number };
  resetToDemo: () => void;
  clearAll: () => void;
};

const SavesContext = createContext<ContextValue | null>(null);
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const now = () => new Date().toISOString();
class ScopeChanged extends Error {}

/**
 * `userId`: the signed-in Clerk user (null when signed out, undefined while Clerk is still loading).
 * The library always lives on the phone; with an account and cloud sync on, it also syncs to Supabase.
 */
export function SavesProvider({ children, userId }: PropsWithChildren<{ userId?: string | null }>) {
  const ref = useRef<{ scope: Scope; data: Persisted }>({ scope: 'guest', data: demoData() });
  const [, setVersion] = useState(0);
  const rerender = useCallback(() => setVersion(v => v + 1), []);
  const [ready, setReady] = useState(false);
  const [cloud, setCloud] = useState<CloudStatus>({ state: cloudConfigured ? 'signedOut' : 'off' });
  const [storageError, setStorageError] = useState<string>();
  const writeChain = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inflight = useRef<Promise<boolean> | null>(null);
  const queued = useRef(false);
  const switching = useRef<Promise<void> | null>(null);

  const persist = useCallback((scope: Scope, data: Persisted) => {
    const json = JSON.stringify(data);
    writeChain.current = writeChain.current
      .then(() => AsyncStorage.setItem(KEY(scope), json))
      .then(() => setStorageError(undefined))
      .catch((e: unknown) => setStorageError(e instanceof Error ? e.message : 'Saving to this phone failed.'));
  }, []);

  /** Applies a new library to `scope`: shown if it's the active one, always written to storage. */
  const commit = useCallback((scope: Scope, data: Persisted) => {
    if (ref.current.scope === scope) { ref.current = { scope, data }; rerender(); }
    persist(scope, data);
  }, [persist, rerender]);

  // ---------- sync ----------
  const syncActive = () => cloudConfigured && isUserScope(ref.current.scope);

  const runOnce = useCallback(async (): Promise<boolean> => {
    const scope = ref.current.scope;
    if (!cloudConfigured || !isUserScope(scope)) return false;
    setCloud({ state: 'syncing' });
    const guard = () => { if (ref.current.scope !== scope) throw new ScopeChanged(); };
    try {
      const out = await runSync({
        get: () => { guard(); return ref.current.data.engine; },
        apply: fn => { guard(); commit(scope, { ...ref.current.data, engine: fn(ref.current.data.engine) }); },
        transport: supabaseTransport(),
      });
      if (ref.current.scope !== scope) return false;
      const pending = pendingCount(ref.current.data.engine);
      if (out.conflicts > 0) setCloud({ state: 'attention', conflicts: out.conflicts });
      else if (pending > 0) setCloud({ state: 'pending', count: pending });
      else setCloud({ state: 'synced', at: now() });
      return out.conflicts === 0 && pending === 0;
    } catch (e) {
      if (e instanceof ScopeChanged) return false;
      if (ref.current.scope === scope) {
        setCloud({ state: 'error', message: friendlyCloudError(e instanceof Error ? e.message : 'Sync failed'), at: now(), pending: pendingCount(ref.current.data.engine) });
      }
      return false;
    }
  }, [commit]);

  /** Runs a sync, or waits for the one in flight plus one more round, so the result covers every edit made so far. */
  const requestSync = useCallback((): Promise<boolean> => {
    if (!syncActive()) return Promise.resolve(false);
    if (inflight.current) { queued.current = true; return inflight.current; }
    const loop = async () => {
      let ok = false;
      do { queued.current = false; ok = await runOnce(); } while (queued.current);
      return ok;
    };
    inflight.current = loop().finally(() => { inflight.current = null; });
    return inflight.current;
  }, [runOnce]);

  const scheduleSync = useCallback(() => {
    if (!syncActive()) return;
    setCloud({ state: 'pending', count: pendingCount(ref.current.data.engine) });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { void requestSync(); }, SYNC_DELAY_MS);
  }, [requestSync]);

  // ---------- loading and switching libraries ----------
  useEffect(() => {
    (async () => {
      try {
        const migrated = await migrateFromV1();
        const last = (await AsyncStorage.getItem(ACTIVE_KEY)) ?? migrated ?? 'guest';
        const scope = cloudConfigured ? last : 'guest';
        ref.current = { scope, data: await loadScope(scope) };
      } catch { /* storage unavailable: run in memory with the demo */ }
      setReady(true);
      rerender();
    })();
  }, [rerender]);

  const switchTo = useCallback(async (target: Scope) => {
    const data = await loadScope(target);
    if (isUserScope(target)) {
      // Saves made while signed out join the account (the untouched demo never does).
      const guest = ref.current.scope === 'guest' ? ref.current.data : await loadScope('guest');
      const guestItems = guest.engine.local;
      if (!guest.demo && (guestItems.saves.length || guestItems.collections.length)) {
        const taken = { saves: new Set(data.engine.local.saves.map(s => s.id)), collections: new Set(data.engine.local.collections.map(c => c.id)) };
        const idMap = new Map<string, string>();
        const collections = guestItems.collections.map(c => { if (!taken.collections.has(c.id)) return c; const id = newId(); idMap.set(c.id, id); return { ...c, id }; });
        const saves = guestItems.saves.map(s => {
          const moved = s.collectionId && idMap.has(s.collectionId) ? { ...s, collectionId: idMap.get(s.collectionId) } : s;
          return taken.saves.has(s.id) ? { ...moved, id: newId() } : moved;
        });
        data.engine = { ...data.engine, local: { saves: [...saves, ...data.engine.local.saves], collections: [...data.engine.local.collections, ...collections] } };
        persist(target, data);
        persist('guest', emptyData());
      }
    }
    ref.current = { scope: target, data };
    rerender();
    AsyncStorage.setItem(ACTIVE_KEY, target).catch(() => undefined);
  }, [persist, rerender]);

  useEffect(() => {
    if (!ready || !cloudConfigured || userId === undefined) return;   // Clerk still loading: keep the last library
    const target = userId ? userScope(userId) : 'guest';
    const done = () => { if (userId) void requestSync(); else setCloud({ state: 'signedOut' }); };
    if (target === ref.current.scope) { done(); return; }
    clearTimeout(timer.current);
    const p = (switching.current ?? Promise.resolve()).then(() => switchTo(target)).then(done);
    switching.current = p.finally(() => { if (switching.current === p) switching.current = null; });
  }, [ready, userId, switchTo, requestSync]);

  useEffect(() => {
    if (!ready || !cloudConfigured) return;
    const sub = AppState.addEventListener('change', state => { if (state === 'active') void requestSync(); });
    return () => { sub.remove(); clearTimeout(timer.current); };
  }, [ready, requestSync]);

  // ---------- edits ----------
  /** Every local change goes through here: one write, then a sync shortly after (when signed in with sync on). */
  const edit = useCallback((fn: (local: Local) => Local) => {
    const { scope, data } = ref.current;
    commit(scope, { ...data, demo: false, engine: { ...data.engine, local: fn(data.engine.local) } });
    scheduleSync();
  }, [commit, scheduleSync]);
  const editSave = (local: Local, id: string, fn: (item: SavedItem) => SavedItem): Local =>
    ({ ...local, saves: local.saves.map(item => item.id === id ? { ...fn(item), updatedAt: now() } : item) });

  const engine = ref.current.data.engine;
  const { saves, collections } = engine.local;

  const value = useMemo<ContextValue>(() => ({
    saves, collections, ready, cloud, storageError,
    pendingCount: pendingCount(engine),
    conflicts: engine.meta.conflicts,
    resolveConflict: (table, id, choice) => {
      const { scope, data } = ref.current;
      commit(scope, { ...data, engine: resolveInEngine(data.engine, table, id, choice) });
      scheduleSync();
    },
    syncNow: requestSync,
    addSave: (input) => { const t = now(); const item: SavedItem = { ...input, id: newId(), createdAt: t, updatedAt: t, isFavorite: false }; edit(l => ({ ...l, saves: [item, ...l.saves] })); return item; },
    updateSave: (id, changes) => edit(l => editSave(l, id, item => ({ ...item, ...changes }))),
    deleteSave: (id) => edit(l => ({ ...l, saves: l.saves.filter(item => item.id !== id) })),
    toggleFavorite: (id) => edit(l => editSave(l, id, item => ({ ...item, isFavorite: !item.isFavorite }))),
    addCollection: (name) => { const t = now(); const item = { id: newId(), name: name.trim(), createdAt: t, updatedAt: t }; edit(l => ({ ...l, collections: [...l.collections, item] })); return item; },
    renameCollection: (id, name) => edit(l => ({ ...l, collections: l.collections.map(c => c.id === id ? { ...c, name: name.trim(), updatedAt: now() } : c) })),
    deleteCollection: (id) => edit(l => ({ collections: l.collections.filter(c => c.id !== id), saves: l.saves.map(item => item.collectionId === id ? { ...item, collectionId: undefined, updatedAt: now() } : item) })),
    searchSaves: (query, options = {}) => saves
      .filter(item => (!options.type || item.type === options.type) && (!options.favoritesOnly || item.isFavorite) && matchesSave(item, query))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    findByUrl: (url) => saves.find(item => sameUrl(item.url, url)),
    getRediscoverItem: (excludedId) => [...saves].filter(item => item.id !== excludedId).sort((a, b) => new Date(a.lastRediscoveredAt ?? a.createdAt).getTime() - new Date(b.lastRediscoveredAt ?? b.createdAt).getTime())[0],
    importBackup: (json) => {
      const incoming = parseBackup(json);
      const result = mergeBackup({ saves, collections }, incoming);
      edit(l => mergeBackup(l, incoming).store);
      return { addedSaves: result.addedSaves, addedCollections: result.addedCollections };
    },
    resetToDemo: () => {
      const t = now();
      edit(() => ({ saves: seedSaves.map(s => ({ ...s, updatedAt: t })), collections: seedCollections.map(c => ({ ...c, updatedAt: t })) }));
    },
    clearAll: () => edit(() => ({ saves: [], collections: [] })),
  }), [saves, collections, engine, ready, cloud, storageError, commit, scheduleSync, requestSync, edit]);
  return <SavesContext.Provider value={value}>{children}</SavesContext.Provider>;
}

export function useSaves() {
  const value = useContext(SavesContext);
  if (!value) throw new Error('useSaves must be used inside SavesProvider');
  return value;
}
