import { Collection, SavedItem } from '@/types';
import { liveTombstones, mergeStores, rowToSave, saveToRow } from '@/utils/sync';

const save = (id: string, updatedAt: string, over: Partial<SavedItem> = {}): SavedItem => ({ id, url: `https://x.com/${id}`, title: id, type: 'other', tags: [], isFavorite: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt, ...over });
const col = (id: string, updatedAt = '2026-01-01T00:00:00.000Z', name = id): Collection => ({ id, name, createdAt: '2026-01-01T00:00:00.000Z', updatedAt });

describe('mergeStores', () => {
  it('keeps the newer copy and uploads only what is newer or missing in the cloud', () => {
    const local = { saves: [save('a', '2026-02-01T00:00:00Z', { title: 'local A' }), save('b', '2026-01-01T00:00:00Z', { title: 'local B' }), save('c', '2026-01-05T00:00:00Z')], collections: [] };
    const remote = { saves: [save('a', '2026-01-15T00:00:00Z', { title: 'cloud A' }), save('b', '2026-03-01T00:00:00Z', { title: 'cloud B' }), save('d', '2026-01-02T00:00:00Z')], collections: [] };
    const { store, upload } = mergeStores(local, remote);
    const byId = Object.fromEntries(store.saves.map(s => [s.id, s.title]));
    expect(byId).toEqual({ a: 'local A', b: 'cloud B', c: 'c', d: 'd' });
    expect(upload.saves.map(s => s.id).sort()).toEqual(['a', 'c']);
  });
  it('keeps deleted things deleted even if the cloud still has them', () => {
    const { store, upload } = mergeStores({ saves: [], collections: [] }, { saves: [save('a', '2026-01-01T00:00:00Z')], collections: [col('k')] }, { saves: ['a'], collections: ['k'] });
    expect(store).toEqual({ saves: [], collections: [] });
    expect(upload).toEqual({ saves: [], collections: [] });
  });
  it('detaches saves from collections that no longer exist', () => {
    const { store } = mergeStores({ saves: [save('a', '2026-01-01T00:00:00Z', { collectionId: 'gone' })], collections: [] }, { saves: [], collections: [] });
    expect(store.saves[0].collectionId).toBeUndefined();
  });
  it('compares timestamps, not strings (cloud returns +00:00 offsets)', () => {
    const { store } = mergeStores({ saves: [save('a', '2026-01-01T10:00:00.000Z', { title: 'local' })], collections: [] }, { saves: [save('a', '2026-01-01T11:00:00+00:00', { title: 'cloud' })], collections: [] });
    expect(store.saves[0].title).toBe('cloud');
  });
});

it('liveTombstones forgets deletions of ids that came back', () => {
  expect(liveTombstones({ saves: [save('a', '')], collections: [col('k')] }, { saves: ['a', 'b'], collections: ['k', 'm'] })).toEqual({ saves: ['b'], collections: ['m'] });
});

it('round-trips a save through a database row', () => {
  const s = save('a', '2026-02-01T00:00:00.000Z', { note: 'n', imageUrl: 'https://i', tags: ['t'], collectionId: 'k', isFavorite: true, source: 'S', lastRediscoveredAt: '2026-03-01T00:00:00.000Z' });
  const row = saveToRow(s, 'user-1');
  expect(row).toMatchObject({ user_id: 'user-1', image_url: 'https://i', collection_id: 'k', is_favorite: true });
  expect(rowToSave({ ...row, updated_at: '2026-02-01T00:00:00+00:00' })).toEqual(s);
});

describe('planForAccount', () => {
  const { planForAccount, initialSyncMeta } = jest.requireActual('@/utils/sync') as typeof import('@/utils/sync');
  it('adopts guest data, keeps the same owner, and never mixes accounts', () => {
    expect(planForAccount(initialSyncMeta(), 'user_a')).toBe('adopt');
    expect(planForAccount({ ...initialSyncMeta(), owner: 'user_a' }, 'user_a')).toBe('same');
    expect(planForAccount({ ...initialSyncMeta(), owner: 'user_a' }, 'user_b')).toBe('switch');
  });
});
