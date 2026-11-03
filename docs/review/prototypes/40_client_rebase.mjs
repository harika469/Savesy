// PROTOTYPE ONLY: the client-side rebase after a `conflict` from push_changes. Run: node docs/review/prototypes/40_client_rebase.mjs
// Three-way merge of base (the server row at the client's base_rev), local (the client's version) and server (returned with the conflict).
// Policy: delete wins; different fields merge; the same field changed on both sides keeps the SERVER value and is reported
// (first committed write wins, matching the conditional-write semantics); tags merge as sets (both sides' additions and removals apply).
import assert from 'node:assert/strict';

const FIELDS = ['url', 'title', 'note', 'type', 'source', 'image_url', 'collection_id', 'is_favorite', 'details', 'last_rediscovered_at'];
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * @returns {{ action: 'push' | 'drop' | 'delete', row?: object, baseRev: number, conflicts: string[] }}
 *   push: resubmit `row` with base_rev = server.rev · drop: server deleted it, remove locally · delete: resubmit the local delete
 */
export function rebase(base, local, server) {
  if (server.deleted_at) return { action: 'drop', baseRev: server.rev, conflicts: [] };            // delete wins
  if (local.deleted) return { action: 'delete', baseRev: server.rev, conflicts: [] };               // local delete wins too
  const row = {}; const conflicts = [];
  for (const f of FIELDS) {
    const l = local[f], s = server[f], b = base[f];
    if (same(l, b)) row[f] = s;                         // only server changed (or neither)
    else if (same(s, b) || same(l, s)) row[f] = l;      // only local changed, or both made the same change
    else { row[f] = s; conflicts.push(f); }             // both changed differently: server wins, report it
  }
  const B = new Set(base.tags ?? []), L = new Set(local.tags ?? []), S = new Set(server.tags ?? []);
  const added = [...L].filter(t => !B.has(t)), removed = [...B].filter(t => !L.has(t));
  row.tags = [...new Set([...[...S].filter(t => !removed.includes(t)), ...added])].sort();
  return { action: 'push', row, baseRev: server.rev, conflicts };
}

// ---- tests ----
const base = { rev: 3, url: 'https://a', title: 'Ramen', note: 'try', tags: ['food', 'tokyo'], is_favorite: false, collection_id: 'trips' };
let r;

r = rebase(base, { ...base, title: 'Best ramen' }, { ...base, rev: 4, note: 'go on Sunday' });
assert.equal(r.action, 'push'); assert.equal(r.row.title, 'Best ramen'); assert.equal(r.row.note, 'go on Sunday'); assert.deepEqual(r.conflicts, []); assert.equal(r.baseRev, 4);
console.log('ok - different fields edited on two devices are both kept');

r = rebase(base, { ...base, title: 'Mine' }, { ...base, rev: 4, title: 'Theirs' });
assert.equal(r.row.title, 'Theirs'); assert.deepEqual(r.conflicts, ['title']);
console.log('ok - same field edited on both: server value kept, conflict reported');

r = rebase(base, { ...base, title: 'Same' }, { ...base, rev: 4, title: 'Same' });
assert.deepEqual(r.conflicts, []); assert.equal(r.row.title, 'Same');
console.log('ok - identical edits on both sides are not a conflict');

r = rebase(base, { ...base, tags: ['tokyo', 'cheap'] }, { ...base, rev: 4, tags: ['food', 'tokyo', 'lunch'] });
assert.deepEqual(r.row.tags, ['cheap', 'lunch', 'tokyo']);
console.log('ok - tags merge as sets: local removed "food" and added "cheap", server added "lunch"');

r = rebase(base, { ...base, is_favorite: true }, { ...base, rev: 4, deleted_at: '2026-11-03T08:00:00Z', title: '' });
assert.equal(r.action, 'drop');
console.log('ok - server tombstone wins over a local edit (no resurrection)');

r = rebase(base, { ...base, deleted: true }, { ...base, rev: 4, title: 'edited elsewhere' });
assert.equal(r.action, 'delete'); assert.equal(r.baseRev, 4);
console.log('ok - local delete wins over a server edit and is resubmitted at the server revision');

r = rebase(base, { ...base }, { ...base, rev: 4, collection_id: null });
assert.equal(r.row.collection_id, null); assert.deepEqual(r.conflicts, []);
console.log('ok - server-side detach (collection deleted) is adopted when the client did not touch the field');

r = rebase(base, { ...base, collection_id: 'eat' }, { ...base, rev: 4, collection_id: null });
assert.equal(r.row.collection_id, null); assert.deepEqual(r.conflicts, ['collection_id']);
console.log('ok - moving into a collection that was concurrently detached keeps the server value and reports it');
console.log('ALL PASSED');
