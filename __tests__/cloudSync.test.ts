/**
 * Runs the real sync code against an in-memory stand-in for the Supabase client
 * (only the calls Savesy makes), to check the full push/pull/delete round trip.
 */
import { syncWithCloud } from '@/lib/cloudSync';
import { SavedItem } from '@/types';
import { mergeStores } from '@/utils/sync';

type Row = Record<string, unknown> & { user_id: string; id: string };
const mockDb: Record<string, Row[]> = { saves: [], collections: [] };
let mockUser = 'user_clerk_1'; // the user the Clerk token belongs to; RLS rejects other user_ids
let mockFailNext = false;

function mockTable(name: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let action: 'select' | 'delete' = 'select';
  const builder = {
    select: () => { action = 'select'; return builder; },
    delete: () => { action = 'delete'; return builder; },
    eq: (col: string, v: unknown) => { filters.push(r => r[col] === v); return builder; },
    in: (col: string, vs: unknown[]) => { filters.push(r => vs.includes(r[col])); return builder; },
    upsert: async (rows: Row[]) => {
      for (const row of rows) {
        if (row.user_id !== mockUser) return { data: null, error: { message: 'new row violates row-level security policy' } };
        mockDb[name] = [...mockDb[name].filter(r => !(r.user_id === row.user_id && r.id === row.id)), row];
      }
      return { data: null, error: null };
    },
    then: (resolve: (v: unknown) => void) => {
      if (mockFailNext) { mockFailNext = false; return resolve({ data: null, error: { message: 'Network request failed' } }); }
      const match = (r: Row) => filters.every(f => f(r));
      if (action === 'delete') { mockDb[name] = mockDb[name].filter(r => !match(r)); return resolve({ data: null, error: null }); }
      resolve({ data: mockDb[name].filter(match).map(r => ({ ...r })), error: null });
    },
  };
  return builder;
}

jest.mock('@/lib/supabase', () => ({
  cloudConfigured: true,
  getSupabase: () => ({ from: mockTable }),
}));

const save = (id: string, updatedAt: string, over: Partial<SavedItem> = {}): SavedItem => ({ id, url: `https://x.com/${id}`, title: id, type: 'other', tags: [], isFavorite: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt, ...over });
const none = { saves: [], collections: [] };

beforeEach(() => { mockDb.saves = []; mockDb.collections = []; mockUser = 'user_clerk_1'; mockFailNext = false; });

it('uploads everything for the signed-in Clerk user on first sync', async () => {
  const local = { saves: [save('a', '2026-01-01T00:00:00Z', { collectionId: 'k' })], collections: [{ id: 'k', name: 'K', createdAt: '2026-01-01T00:00:00.000Z' }] };
  const result = await syncWithCloud(local, none, 'user_clerk_1');
  expect(result.userId).toBe('user_clerk_1');
  expect(result.uploaded).toBe(2);
  expect(result.replacedLocal).toBe(false);
  expect(mockDb.saves).toEqual([expect.objectContaining({ user_id: 'user_clerk_1', id: 'a', collection_id: 'k' })]);
  expect(mockDb.collections).toEqual([expect.objectContaining({ user_id: 'user_clerk_1', id: 'k', name: 'K' })]);
});

it('pulls newer cloud edits, pushes newer local edits, and applies deletions', async () => {
  await syncWithCloud({ saves: [save('a', '2026-01-01T00:00:00Z'), save('b', '2026-01-01T00:00:00Z'), save('c', '2026-01-01T00:00:00Z')], collections: [] }, none, 'user_clerk_1');
  // Another mockSession edits "b" in the cloud.
  mockDb.saves = mockDb.saves.map(r => r.id === 'b' ? { ...r, title: 'edited in cloud', updated_at: '2026-05-01T00:00:00+00:00' } : r);
  // Locally: "a" edited, "c" deleted.
  const local = { saves: [save('a', '2026-04-01T00:00:00Z', { title: 'edited here' }), save('b', '2026-01-01T00:00:00Z')], collections: [] };
  const tomb = { saves: ['c'], collections: [] };
  const result = await syncWithCloud(local, tomb, 'user_clerk_1');
  const merged = mergeStores(local, result.remote, tomb).store;
  expect(Object.fromEntries(merged.saves.map(s => [s.id, s.title]))).toEqual({ a: 'edited here', b: 'edited in cloud' });
  expect(mockDb.saves.map(r => [r.id, r.title]).sort()).toEqual([['a', 'edited here'], ['b', 'edited in cloud']]);
  expect(result.deletedConfirmed).toEqual(tomb);
});

it('reports failures instead of throwing away local data', async () => {
  mockFailNext = true;
  await expect(syncWithCloud({ saves: [save('a', '2026-01-01T00:00:00Z')], collections: [] }, none, 'user_clerk_1')).rejects.toThrow('Network request failed');
});

it('only reads and writes the signed-in user’s rows', async () => {
  mockDb.saves = [{ user_id: 'user_other', id: 'x', url: 'https://o.com', title: 'Not yours', type: 'other', tags: [], is_favorite: false, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' } as never];
  const result = await syncWithCloud({ saves: [], collections: [] }, none, 'user_clerk_1');
  expect(result.remote.saves).toEqual([]);
  // A token for one user can't write another user's rows.
  mockUser = 'user_other';
  await expect(syncWithCloud({ saves: [save('a', '2026-01-01T00:00:00Z')], collections: [] }, none, 'user_clerk_1')).rejects.toThrow('row-level security');
});

it('drops untouched demo content when the account already has saves', async () => {
  mockDb.saves = [{ user_id: 'user_clerk_1', id: 'mine', url: 'https://m.com', title: 'Mine', type: 'other', tags: [], is_favorite: false, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' } as never];
  const demo = { saves: [save('demo', '2026-01-01T00:00:00Z')], collections: [] };
  const result = await syncWithCloud(demo, none, 'user_clerk_1', { keepCloudIfNotEmpty: true });
  expect(result.replacedLocal).toBe(true);
  expect(result.remote.saves.map(s => s.id)).toEqual(['mine']);
  expect(mockDb.saves.map(r => r.id)).toEqual(['mine']);
});

it('keeps the demo when the account is brand new', async () => {
  const result = await syncWithCloud({ saves: [save('demo', '2026-01-01T00:00:00Z')], collections: [] }, none, 'user_clerk_1', { keepCloudIfNotEmpty: true });
  expect(result.replacedLocal).toBe(false);
  expect(mockDb.saves.map(r => r.id)).toEqual(['demo']);
});

describe('friendlyCloudError', () => {
  const { friendlyCloudError } = jest.requireActual('@/lib/cloudSync') as typeof import('@/lib/cloudSync');
  it.each([
    ['TypeError: Failed to fetch', 'Can’t reach the cloud right now.'],
    ['JWSError JWSInvalidSignature', expect.stringContaining('third-party auth provider')],
    ['relation "public.saves" does not exist', expect.stringContaining('tables are missing')],
    ['Something odd', 'Something odd.'],
  ])('%s', (input, out) => expect(friendlyCloudError(input)).toEqual(out));
});
