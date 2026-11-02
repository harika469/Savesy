import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { seedCollections, seedSaves } from '@/constants/seed';
import { friendlyCloudError, syncWithCloud } from '@/lib/cloudSync';
import { cloudConfigured } from '@/lib/supabase';
import { Collection, NewSave, SavedItem, SaveType } from '@/types';
import { mergeBackup, parseBackup, Store } from '@/utils/backup';
import { matchesSave, sameUrl } from '@/utils/saves';
import { emptyTombstones, liveTombstones, mergeStores, Tombstones } from '@/utils/sync';

const STORAGE_KEY = '@savesy/v1';
const SYNC_KEY = '@savesy/sync-v1';
const SYNC_DELAY_MS = 1500;

export type SearchOptions = { type?: SaveType; favoritesOnly?: boolean };
export type CloudStatus =
  | { state: 'off' }
  | { state: 'syncing' }
  | { state: 'synced'; at: string; userId: string }
  | { state: 'error'; message: string; at: string };

type ContextValue = Store & {
  ready: boolean;
  cloud: CloudStatus;
  syncNow: () => void;
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

function isStore(value: unknown): value is Store {
  const v = value as Store;
  return !!v && Array.isArray(v.saves) && Array.isArray(v.collections);
}

export function SavesProvider({ children }: PropsWithChildren) {
  const [store, setStore] = useState<Store>({ saves: seedSaves, collections: seedCollections });
  const [tombstones, setTombstones] = useState<Tombstones>(emptyTombstones);
  const [ready, setReady] = useState(false);
  const [cloud, setCloud] = useState<CloudStatus>({ state: cloudConfigured ? 'syncing' : 'off' });

  // Refs let the async sync read the latest state without re-creating callbacks.
  const storeRef = useRef(store); storeRef.current = store;
  const tombRef = useRef(tombstones); tombRef.current = tombstones;
  const syncing = useRef(false);
  const again = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    Promise.all([AsyncStorage.getItem(STORAGE_KEY), AsyncStorage.getItem(SYNC_KEY)])
      .then(([value, sync]) => {
        if (value) {
          try {
            const parsed: unknown = JSON.parse(value);
            if (isStore(parsed)) setStore({ collections: parsed.collections, saves: parsed.saves.map(s => ({ ...s, tags: s.tags ?? [] })) });
          } catch { /* keep friendly seed data */ }
        }
        if (sync) { try { const t = JSON.parse(sync).tombstones as Tombstones; if (t?.saves && t?.collections) setTombstones(t); } catch { /* ignore */ } }
      })
      .catch(() => { /* storage unavailable: run in memory */ })
      .finally(() => setReady(true));
  }, []);
  useEffect(() => { if (ready) AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(store)).catch(() => undefined); }, [ready, store]);
  useEffect(() => { if (ready) AsyncStorage.setItem(SYNC_KEY, JSON.stringify({ tombstones })).catch(() => undefined); }, [ready, tombstones]);

  const runSync = useCallback(async () => {
    if (!cloudConfigured) return;
    if (syncing.current) { again.current = true; return; }
    syncing.current = true;
    setCloud({ state: 'syncing' });
    try {
      const result = await syncWithCloud(storeRef.current, liveTombstones(storeRef.current, tombRef.current));
      // Merge into the *current* state so edits made while syncing aren't lost (they sync next round).
      setStore(current => mergeStores(current, result.remote, liveTombstones(current, tombRef.current)).store);
      // Forget deletions the cloud has confirmed, and any for ids that came back locally.
      const done = result.deletedConfirmed;
      setTombstones(t => liveTombstones(storeRef.current, { saves: t.saves.filter(id => !done.saves.includes(id)), collections: t.collections.filter(id => !done.collections.includes(id)) }));
      setCloud({ state: 'synced', at: now(), userId: result.userId });
    } catch (e) {
      setCloud({ state: 'error', message: friendlyCloudError(e instanceof Error ? e.message : 'Sync failed'), at: now() });
    } finally {
      syncing.current = false;
      if (again.current) { again.current = false; void runSync(); }
    }
  }, []);

  const scheduleSync = useCallback(() => {
    if (!cloudConfigured) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { void runSync(); }, SYNC_DELAY_MS);
  }, [runSync]);

  // Sync once loaded, and whenever the app comes back to the foreground.
  useEffect(() => {
    if (!ready || !cloudConfigured) return;
    void runSync();
    const sub = AppState.addEventListener('change', state => { if (state === 'active') void runSync(); });
    return () => { sub.remove(); clearTimeout(timer.current); };
  }, [ready, runSync]);

  /** Every local change goes through here: update state, then sync shortly after. */
  const update = useCallback((fn: (current: Store) => Store) => { setStore(fn); scheduleSync(); }, [scheduleSync]);
  const bury = useCallback((saves: string[], collections: string[] = []) => {
    if (!cloudConfigured || (!saves.length && !collections.length)) return;
    setTombstones(t => ({ saves: [...new Set([...t.saves, ...saves])], collections: [...new Set([...t.collections, ...collections])] }));
  }, []);
  const editSaves = (s: Store, id: string, fn: (item: SavedItem) => SavedItem) => ({ ...s, saves: s.saves.map(item => item.id === id ? { ...fn(item), updatedAt: now() } : item) });

  const value = useMemo<ContextValue>(() => ({
    ...store, ready, cloud,
    syncNow: () => { void runSync(); },
    addSave: (input) => { const t = now(); const item: SavedItem = { ...input, id: newId(), createdAt: t, updatedAt: t, isFavorite: false }; update(s => ({ ...s, saves: [item, ...s.saves] })); return item; },
    updateSave: (id, changes) => update(s => editSaves(s, id, item => ({ ...item, ...changes }))),
    deleteSave: (id) => { bury([id]); update(s => ({ ...s, saves: s.saves.filter(item => item.id !== id) })); },
    toggleFavorite: (id) => update(s => editSaves(s, id, item => ({ ...item, isFavorite: !item.isFavorite }))),
    addCollection: (name) => { const t = now(); const item = { id: newId(), name: name.trim(), createdAt: t, updatedAt: t }; update(s => ({ ...s, collections: [...s.collections, item] })); return item; },
    renameCollection: (id, name) => update(s => ({ ...s, collections: s.collections.map(c => c.id === id ? { ...c, name: name.trim(), updatedAt: now() } : c) })),
    deleteCollection: (id) => { bury([], [id]); update(s => ({ collections: s.collections.filter(c => c.id !== id), saves: s.saves.map(item => item.collectionId === id ? { ...item, collectionId: undefined, updatedAt: now() } : item) })); },
    searchSaves: (query, options = {}) => store.saves
      .filter(item => (!options.type || item.type === options.type) && (!options.favoritesOnly || item.isFavorite) && matchesSave(item, query))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    findByUrl: (url) => store.saves.find(item => sameUrl(item.url, url)),
    getRediscoverItem: (excludedId) => [...store.saves].filter(item => item.id !== excludedId).sort((a, b) => new Date(a.lastRediscoveredAt ?? a.createdAt).getTime() - new Date(b.lastRediscoveredAt ?? b.createdAt).getTime())[0],
    importBackup: (json) => {
      const incoming = parseBackup(json);
      const result = mergeBackup(store, incoming);
      update(s => mergeBackup(s, incoming).store);
      return { addedSaves: result.addedSaves, addedCollections: result.addedCollections };
    },
    resetToDemo: () => {
      const keep = new Set(seedSaves.map(s => s.id)); const keepC = new Set(seedCollections.map(c => c.id));
      bury(store.saves.filter(s => !keep.has(s.id)).map(s => s.id), store.collections.filter(c => !keepC.has(c.id)).map(c => c.id));
      const t = now();
      update(() => ({ saves: seedSaves.map(s => ({ ...s, updatedAt: t })), collections: seedCollections.map(c => ({ ...c, updatedAt: t })) }));
    },
    clearAll: () => { bury(store.saves.map(s => s.id), store.collections.map(c => c.id)); update(() => ({ saves: [], collections: [] })); },
  }), [store, ready, cloud, runSync, update, bury]);
  return <SavesContext.Provider value={value}>{children}</SavesContext.Provider>;
}

export function useSaves() {
  const value = useContext(SavesContext);
  if (!value) throw new Error('useSaves must be used inside SavesProvider');
  return value;
}
