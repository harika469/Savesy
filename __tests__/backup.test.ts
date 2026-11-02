import { seedCollections, seedSaves } from '@/constants/seed';
import { mergeBackup, parseBackup, serializeBackup, Store } from '@/utils/backup';

const demo: Store = { saves: seedSaves, collections: seedCollections };

it('round-trips a backup', () => {
  const text = serializeBackup(demo, new Date('2026-11-01T00:00:00Z'));
  expect(JSON.parse(text)).toMatchObject({ format: 'savesy-backup', version: 1, exportedAt: '2026-11-01T00:00:00.000Z' });
  expect(parseBackup(text)).toEqual(demo);
});

describe('parseBackup', () => {
  it('rejects non-backups with a friendly message', () => {
    expect(() => parseBackup('hello')).toThrow('doesn’t look like a Savesy backup');
    expect(() => parseBackup('{"saves": 3}')).toThrow('doesn’t look like a Savesy backup');
  });
  it('drops broken items and repairs fields', () => {
    const text = JSON.stringify({ collections: [{ id: 'c', name: 'Ok' }, { name: 'no id' }], saves: [
      { id: 'a', url: 'https://a.com', title: 'A', type: 'nonsense', tags: ['x', 5], collectionId: 'missing', isFavorite: 'yes' },
      { id: 'b', title: 'no url' },
    ] });
    const { saves, collections } = parseBackup(text);
    expect(collections.map(c => c.id)).toEqual(['c']);
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({ type: 'other', tags: ['x'], collectionId: undefined, isFavorite: false });
  });
});

describe('mergeBackup', () => {
  it('adds only new things and never overwrites', () => {
    const current: Store = { collections: [{ id: 'mine', name: '✈ Main character trips', createdAt: '' }], saves: [{ ...seedSaves[0], id: 'local', title: 'My edited title' }] };
    const { store, addedSaves, addedCollections } = mergeBackup(current, demo);
    expect(addedCollections).toBe(seedCollections.length - 1); // same-name collection reused
    expect(addedSaves).toBe(seedSaves.length - 1); // same link skipped
    expect(store.saves.find(s => s.id === 'local')?.title).toBe('My edited title');
    expect(store.saves.find(s => s.id === 'ghent-guide')?.collectionId).toBe('mine'); // remapped into the reused collection
  });
  it('is a no-op when importing the same data twice', () => {
    const once = mergeBackup({ saves: [], collections: [] }, demo).store;
    expect(mergeBackup(once, demo)).toMatchObject({ addedSaves: 0, addedCollections: 0 });
  });
});
