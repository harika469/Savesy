/** Local-only beta (EXPO_PUBLIC_CLOUD_SYNC_ENABLED not "true"): one library on the phone, nothing ever reaches a server. */
import React from 'react';

const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: async (k: string) => mockStore.get(k) ?? null, setItem: async (k: string, v: string) => { mockStore.set(k, v); } } }));
jest.mock('@/lib/supabase', () => ({ cloudConfigured: false }));
const mockTransport = jest.fn(() => { throw new Error('a server was contacted in local-only mode'); });
jest.mock('@/lib/cloudSync', () => ({ friendlyCloudError: (m: string) => m, supabaseTransport: mockTransport }));

import { SavesProvider, useSaves } from '@/context/SavesContext';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require('react-test-renderer');

let ctx: ReturnType<typeof useSaves>;
function Probe() { ctx = useSaves(); return null; }
const flush = async () => { for (let i = 0; i < 20; i++) await TestRenderer.act(async () => { await Promise.resolve(); }); };

it('keeps one library on the phone, never contacts a server, and reports sync as off', async () => {
  jest.useFakeTimers();
  let r: any;
  await TestRenderer.act(async () => { r = TestRenderer.create(<SavesProvider userId={null}><Probe /></SavesProvider>); });
  await flush();
  expect(ctx.cloud).toEqual({ state: 'off' });
  await TestRenderer.act(async () => { ctx.addSave({ url: 'https://l.com', title: 'Local only', type: 'other', tags: [] }); });
  await TestRenderer.act(async () => { r.update(<SavesProvider userId="user_A"><Probe /></SavesProvider>); });
  await flush();
  expect(ctx.saves.map(s => s.title)).toContain('Local only');      // same library even if an account is signed in
  expect(await ctx.syncNow()).toBe(false);
  await TestRenderer.act(async () => { jest.advanceTimersByTime(10_000); });
  expect(mockTransport).not.toHaveBeenCalled();
  expect(JSON.parse(mockStore.get('@savesy/v2/guest')!).engine.local.saves.some((s: { title: string }) => s.title === 'Local only')).toBe(true);
  await TestRenderer.act(async () => { r.unmount(); });
  jest.useRealTimers();
});
