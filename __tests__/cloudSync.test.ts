/**
 * Runs the real sync code against an in-memory stand-in for the Supabase client
 * (only the calls Savesy makes), to check the full push/pull/delete round trip.
 */
import { syncWithCloud } from '@/lib/cloudSync';
import { SavedItem } from '@/types';
import { mergeStores } from '@/utils/sync';

type Row = Record<string, unknown> & { user_id: string; id: string };
const mockDb: Record<string, Row[]> = { saves: [], collections: [] };
let mockSession: { user: { id: string } } | null = null;
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
        if (row.user_id !== mockSession?.user.id) return { data: null, error: { message: 'row-level security' } };
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
  getSupabase: () => ({
    from: mockTable,
    auth: {
      getSession: async () => ({ data: { session: mockSession } }),
      signInAnonymously: async () => { mockSession = { user: { id: 'anon-1' } }; return { data: { user: mockSession.user }, error: null }; },
    },
  }),
}));

const save = (id: string, updatedAt: string, over: Partial<SavedItem> = {}): SavedItem => ({ id, url: `https://x.com/${id}`, title: id, type: 'other', tags: [], isFavorite: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt, ...over });
const none = { saves: [], collections: [] };

beforeEach(() => { mockDb.saves = []; mockDb.collections = []; mockSession = null; mockFailNext = false; });

it('signs in anonymously on first sync and uploads everything', async () => {
  const local = { saves: [save('a', '2026-01-01T00:00:00Z', { collectionId: 'k' })], collections: [{ id: 'k', name: 'K', createdAt: '2026-01-01T00:00:00.000Z' }] };
  const result = await syncWithCloud(local, none);
  expect(result.userId).toBe('anon-1');
  expect(result.uploaded).toBe(2);
  expect(mockDb.saves).toEqual([expect.objectContaining({ user_id: 'anon-1', id: 'a', collection_id: 'k' })]);
  expect(mockDb.collections).toEqual([expect.objectContaining({ user_id: 'anon-1', id: 'k', name: 'K' })]);
});

it('pulls newer cloud edits, pushes newer local edits, and applies deletions', async () => {
  await syncWithCloud({ saves: [save('a', '2026-01-01T00:00:00Z'), save('b', '2026-01-01T00:00:00Z'), save('c', '2026-01-01T00:00:00Z')], collections: [] }, none);
  // Another mockSession edits "b" in the cloud.
  mockDb.saves = mockDb.saves.map(r => r.id === 'b' ? { ...r, title: 'edited in cloud', updated_at: '2026-05-01T00:00:00+00:00' } : r);
  // Locally: "a" edited, "c" deleted.
  const local = { saves: [save('a', '2026-04-01T00:00:00Z', { title: 'edited here' }), save('b', '2026-01-01T00:00:00Z')], collections: [] };
  const tomb = { saves: ['c'], collections: [] };
  const result = await syncWithCloud(local, tomb);
  const merged = mergeStores(local, result.remote, tomb).store;
  expect(Object.fromEntries(merged.saves.map(s => [s.id, s.title]))).toEqual({ a: 'edited here', b: 'edited in cloud' });
  expect(mockDb.saves.map(r => [r.id, r.title]).sort()).toEqual([['a', 'edited here'], ['b', 'edited in cloud']]);
  expect(result.deletedConfirmed).toEqual(tomb);
});

it('reports failures instead of throwing away local data', async () => {
  mockSession = { user: { id: 'anon-1' } };
  mockFailNext = true;
  await expect(syncWithCloud({ saves: [save('a', '2026-01-01T00:00:00Z')], collections: [] }, none)).rejects.toThrow('Network request failed');
});

describe('friendlyCloudError', () => {
  const { friendlyCloudError } = jest.requireActual('@/lib/cloudSync') as typeof import('@/lib/cloudSync');
  it.each([
    ['TypeError: Failed to fetch', 'Can’t reach the cloud right now.'],
    ['Anonymous sign-ins are disabled', expect.stringContaining('Anonymous sign-ins are turned off')],
    ['relation "public.saves" does not exist', expect.stringContaining('tables are missing')],
    ['Something odd', 'Something odd.'],
  ])('%s', (input, out) => expect(friendlyCloudError(input)).toEqual(out));
});
