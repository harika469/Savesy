/** Beta gating on the client: Smart Saves and Pro stay hidden unless the build flag is exactly "true". */
const ENV = process.env;
afterEach(() => { process.env = ENV; jest.resetModules(); });

function loadAi(flag: string | undefined, cloud = true) {
  process.env = { ...ENV, EXPO_PUBLIC_SMART_SAVES_ENABLED: flag };
  let mod!: typeof import('@/lib/ai');
  jest.isolateModules(() => {
    jest.doMock('@/lib/supabase', () => ({ cloudConfigured: cloud, getSupabase: () => null }));
    mod = require('@/lib/ai');
  });
  return mod;
}

describe('client flag', () => {
  it('is off when unset, even with cloud configured', () => expect(loadAi(undefined).smartSavesAvailable).toBe(false));
  it('is off for anything but "true"', () => { for (const v of ['', 'false', '1', 'TRUE']) expect(loadAi(v).smartSavesAvailable).toBe(false); });
  it('is on only for "true" with cloud configured', () => {
    expect(loadAi('true').smartSavesAvailable).toBe(true);
    expect(loadAi('true', false).smartSavesAvailable).toBe(false);
  });
});
