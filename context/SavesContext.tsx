import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { seedCollections, seedSaves } from '@/constants/seed';
import { Collection, NewSave, SavedItem, SaveType } from '@/types';
import { matchesSave } from '@/utils/saves';

const STORAGE_KEY = '@savesy/v1';
type Store = { saves: SavedItem[]; collections: Collection[] };
type ContextValue = Store & {
  ready: boolean;
  addSave: (save: NewSave) => SavedItem;
  updateSave: (id: string, changes: Partial<SavedItem>) => void;
  deleteSave: (id: string) => void;
  toggleFavorite: (id: string) => void;
  addCollection: (name: string) => Collection;
  deleteCollection: (id: string) => void;
  searchSaves: (query: string, type?: SaveType) => SavedItem[];
  getRediscoverItem: (excludedId?: string) => SavedItem | undefined;
};

const SavesContext = createContext<ContextValue | null>(null);

export function SavesProvider({ children }: PropsWithChildren) {
  const [store, setStore] = useState<Store>({ saves: seedSaves, collections: seedCollections });
  const [ready, setReady] = useState(false);

  useEffect(() => { AsyncStorage.getItem(STORAGE_KEY).then((value) => {
    if (value) { try { setStore(JSON.parse(value) as Store); } catch { /* keep friendly seed data */ } }
    setReady(true);
  }); }, []);
  useEffect(() => { if (ready) void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(store)); }, [ready, store]);

  const update = useCallback((fn: (current: Store) => Store) => setStore(fn), []);
  const value = useMemo<ContextValue>(() => ({
    ...store, ready,
    addSave: (input) => { const item: SavedItem = { ...input, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date().toISOString(), isFavorite: false }; update(s => ({ ...s, saves: [item, ...s.saves] })); return item; },
    updateSave: (id, changes) => update(s => ({ ...s, saves: s.saves.map(item => item.id === id ? { ...item, ...changes } : item) })),
    deleteSave: (id) => update(s => ({ ...s, saves: s.saves.filter(item => item.id !== id) })),
    toggleFavorite: (id) => update(s => ({ ...s, saves: s.saves.map(item => item.id === id ? { ...item, isFavorite: !item.isFavorite } : item) })),
    addCollection: (name) => { const item = { id: `${Date.now()}`, name: name.trim(), createdAt: new Date().toISOString() }; update(s => ({ ...s, collections: [...s.collections, item] })); return item; },
    deleteCollection: (id) => update(s => ({ collections: s.collections.filter(c => c.id !== id), saves: s.saves.map(item => item.collectionId === id ? { ...item, collectionId: undefined } : item) })),
    searchSaves: (query, type) => store.saves.filter(item => (!type || item.type === type) && matchesSave(item, query)),
    getRediscoverItem: (excludedId) => [...store.saves].filter(item => item.id !== excludedId).sort((a, b) => new Date(a.lastRediscoveredAt ?? a.createdAt).getTime() - new Date(b.lastRediscoveredAt ?? b.createdAt).getTime())[0],
  }), [ready, store, update]);
  return <SavesContext.Provider value={value}>{children}</SavesContext.Provider>;
}

export function useSaves() {
  const value = useContext(SavesContext);
  if (!value) throw new Error('useSaves must be used inside SavesProvider');
  return value;
}
