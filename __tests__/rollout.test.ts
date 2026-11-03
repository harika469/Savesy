/**
 * Coordinated rollout (REQ-5): the app's PREVIOUS sync client (verbatim copy from e31bff1) still installed on a phone
 * after the B1 migration, against a server with B1's rules (direct writes refused; direct reads see live rows only).
 * Then the same phone after updating the app.
 */
import { syncWithCloud as legacySync } from '../test-support/legacy-e31bff1/cloudSync';
import { setLegacySupabase } from '../test-support/legacy-e31bff1/supabase';
import { emptyTombstones } from '../test-support/legacy-e31bff1/sync';
import { fromLegacy } from '@/utils/syncEngine';
import { Device, save } from '../test-support/device';
import { FakeSyncServer } from '../test-support/fakeSyncServer';

const U = 'user_1';
let server: FakeSyncServer;
let s1: ReturnType<typeof save>, s2: ReturnType<typeof save>, s3: ReturnType<typeof save>;
const snapshot = () => JSON.stringify([...server.users.get(U)!.rows.saves.values()].sort((a, b) => a.id.localeCompare(b.id)));

beforeEach(async () => {
  server = new FakeSyncServer();
  setLegacySupabase(server.legacyClient(U));
  // An updated phone creates three saves, then deletes s3 (a tombstone on the server).
  const updated = new Device(server, U);
  s1 = save('s1', { title: 'One' }); s2 = save('s2', { title: 'Two' }); s3 = save('s3', { title: 'Three' });
  updated.add(s1); updated.add(s2); updated.add(s3); await updated.sync();
  updated.remove('saves', 's3'); await updated.sync();
});

describe('an older app still installed after the B1 migration', () => {
  it('with nothing to upload it syncs, and does NOT show the deleted save as a blank item', async () => {
    const out = await legacySync({ saves: [s1, s2], collections: [] }, emptyTombstones(), U);
    expect(out.remote.saves.map(s => s.id).sort()).toEqual(['s1', 's2']);
    expect(out.remote.saves.every(s => s.title !== '')).toBe(true);
  });

  it('still holding the save deleted elsewhere: its re-upload is refused, so the delete is not undone', async () => {
    const before = snapshot();
    const local = { saves: [s1, s2, s3], collections: [] };
    const frozen = JSON.stringify(local);
    await expect(legacySync(local, emptyTombstones(), U)).rejects.toThrow(/row-level security/);
    expect(snapshot()).toBe(before);                      // server unchanged: s3 is still deleted
    expect(JSON.stringify(local)).toBe(frozen);             // the old app's local data is untouched
  });

  it('an edit made in the old app is refused by the server (loudly), and the server keeps its data', async () => {
    const before = snapshot();
    const edited = { ...s1, title: 'Edited in the old app', updatedAt: '2099-01-01T00:00:00.000Z' };
    await expect(legacySync({ saves: [edited, s2], collections: [] }, emptyTombstones(), U)).rejects.toThrow(/row-level security/);
    expect(snapshot()).toBe(before);
  });

  it('a delete made in the old app is refused, so it cannot hard-delete anything', async () => {
    const before = snapshot();
    await expect(legacySync({ saves: [s1], collections: [] }, { saves: ['s2'], collections: [] }, U)).rejects.toThrow(/row-level security/);
    expect(snapshot()).toBe(before);
    expect(server.row(U, 'saves', 's2')?.deleted_at).toBeNull();
  });
});

describe('the same phone after updating the app', () => {
  it('its old library migrates: nothing is lost, the old-app edit and the save deleted elsewhere are shown as conflicts, nothing is resurrected', async () => {
    const edited = { ...s1, title: 'Edited in the old app' };
    const phone = new Device(server, U, fromLegacy({ saves: [edited, s2, s3], collections: [] }));
    const out = await phone.sync();
    expect(phone.ids()).toEqual(['s1', 's2', 's3']);                                  // nothing silently dropped
    expect(phone.get('s1')?.title).toBe('Edited in the old app');                       // the unsynced edit is kept
    expect(out.conflicts).toBe(2);
    expect(phone.state.meta.conflicts.map(c => `${c.id}:${c.kind}`).sort()).toEqual(['s1:edited', 's3:deletedRemotely']);
    expect(server.row(U, 'saves', 's3')?.deleted_at).toBeTruthy();                    // not re-uploaded
    phone.resolve('saves', 's1', 'mine'); phone.resolve('saves', 's3', 'theirs');
    expect(await phone.sync()).toEqual({ pending: 0, conflicts: 0 });
    expect(server.row(U, 'saves', 's1')?.title).toBe('Edited in the old app');
    expect(phone.ids()).toEqual(['s1', 's2']);
  });

  it('the new app against a server WITHOUT the B1 migration fails loudly and keeps everything', async () => {
    const phone = new Device(server, U);
    phone.add(save('local'));
    const before = JSON.stringify(phone.state);
    const { runSync } = jest.requireActual('@/utils/syncEngine') as typeof import('@/utils/syncEngine');
    await expect(runSync({ get: () => phone.state, apply: phone.apply, transport: {
      pull: async () => { throw new Error('Could not find the function public.pull_changes(p_full, p_limit, p_since)'); },
      push: async () => { throw new Error('unreachable'); },
    } })).rejects.toThrow('pull_changes');
    expect(JSON.stringify(phone.state)).toBe(before);
  });
});
