/** The Pro screen in the beta build (EXPO_PUBLIC_SMART_SAVES_ENABLED unset, the default): no prices or purchase flow. */
import React from 'react';

jest.mock('@/lib/supabase', () => ({ cloudConfigured: true, getSupabase: () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), replace: jest.fn(), push: jest.fn(), canGoBack: () => true }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/Account', () => ({ useAccount: () => ({ configured: true, loaded: true, signedIn: true }) }));
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: async () => null, setItem: async () => undefined } }));

import ProScreen from '@/app/pro';
import { smartSavesAvailable } from '@/lib/ai';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require('react-test-renderer');

it('runs with the beta default (flag unset)', () => {
  expect(process.env.EXPO_PUBLIC_SMART_SAVES_ENABLED).toBeUndefined();
  expect(smartSavesAvailable).toBe(false);
});

it('shows no prices, plans or purchase-like button', async () => {
  let r: any;
  await TestRenderer.act(async () => { r = TestRenderer.create(<ProScreen />); });
  const text = r.root.findAll((n: any) => typeof n.props.children === 'string').map((n: any) => n.props.children as string).join(' | ');
  expect(text).toContain('Savesy Pro isn’t available yet');
  expect(text).not.toMatch(/\$\d/);
  expect(text).not.toMatch(/I WANT PRO|GET PRO|Yearly|Monthly/);
});
