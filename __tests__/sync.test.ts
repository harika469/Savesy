import { collectionToPushRow, rowToCollection, rowToSave, sameValue, saveToPushRow, ServerRow } from '@/utils/sync';
import { SavedItem } from '@/types';

const save: SavedItem = {
  id: 'p', url: 'https://x', title: 'Shirt', note: 'n', type: 'product', source: 'Shop', imageUrl: 'https://i', tags: ['t'], collectionId: 'k', isFavorite: true,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z', lastRediscoveredAt: '2026-03-01T00:00:00.000Z',
  details: { kind: 'product', name: 'Linen shirt', brand: 'Uniqlo', price: '39.90', currency: 'EUR', store: 'Uniqlo' },
};

it('push rows carry only the fields push_changes allows (no id, user_id, rev or deleted_at)', () => {
  expect(Object.keys(saveToPushRow(save)).sort()).toEqual(['collection_id', 'created_at', 'details', 'image_url', 'is_favorite', 'last_rediscovered_at', 'note', 'source', 'tags', 'title', 'type', 'updated_at', 'url']);
  expect(Object.keys(collectionToPushRow({ id: 'c', name: 'C', createdAt: 'x' })).sort()).toEqual(['created_at', 'name', 'updated_at']);
});

it('a save round-trips through a server row, including Postgres timestamp format and Smart Save details', () => {
  const row = { id: 'p', rev: 3, deleted_at: null, ...saveToPushRow(save), created_at: '2026-01-01T00:00:00+00:00', updated_at: '2026-02-01T00:00:00.000+00:00' } as ServerRow;
  expect(sameValue(rowToSave(row), save)).toBe(true);
  expect(rowToSave({ ...row, details: { kind: 'nonsense' } }).details).toBeUndefined();
});

it('a collection round-trips', () => {
  const c = { id: 'c', name: 'Trips', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' };
  expect(rowToCollection({ id: 'c', rev: 1, deleted_at: null, ...collectionToPushRow(c) })).toEqual(c);
});

it('sameValue ignores key order and undefined/null', () => {
  expect(sameValue({ a: 1, b: undefined, c: [1, { d: null, e: 2 }] }, { c: [1, { e: 2 }], a: 1 })).toBe(true);
  expect(sameValue({ a: 1 }, { a: 2 })).toBe(false);
});
