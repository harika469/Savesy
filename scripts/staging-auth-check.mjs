#!/usr/bin/env node
// Checks the sync functions' authentication on a STAGING Supabase project with real Clerk tokens (ChatGPT review of
// PR #3: "API-level auth and privileges"). Never run against production. Prints PASS/FAIL per case, never prints tokens.
//
// Required environment:
//   STAGING_CONFIRM=yes                      (guard)
//   STAGING_SUPABASE_URL, STAGING_SUPABASE_PUBLISHABLE_KEY
//   TOKEN_A, TOKEN_B                         Clerk session tokens for two different staging test users
// Optional:
//   TOKEN_EXPIRED                            an expired Clerk token
//   TOKEN_OTHER_INSTANCE                     a token from a different Clerk instance (wrong issuer / audience)
// Usage: node scripts/staging-auth-check.mjs
import { createClient } from '@supabase/supabase-js';

const env = process.env;
if (env.STAGING_CONFIRM !== 'yes') { console.error('Set STAGING_CONFIRM=yes to confirm this is a staging project.'); process.exit(2); }
for (const k of ['STAGING_SUPABASE_URL', 'STAGING_SUPABASE_PUBLISHABLE_KEY', 'TOKEN_A', 'TOKEN_B']) {
  if (!env[k]) { console.error(`Missing ${k}`); process.exit(2); }
}
const client = (token) => createClient(env.STAGING_SUPABASE_URL, env.STAGING_SUPABASE_PUBLISHABLE_KEY, token === undefined ? {} : { accessToken: async () => token });
const forged = (t) => { const [h, p, s] = t.split('.'); return `${h}.${p}.${s.slice(0, -4)}${s.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA'}`; };
const id = `authcheck-${Date.now()}`;
let failed = 0;
const check = async (name, fn) => {
  try { const ok = await fn(); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; }
  catch (e) { console.log(`FAIL  ${name} (threw: ${e instanceof Error ? e.message.slice(0, 120) : 'error'})`); failed++; }
};
const pull = (c) => c.rpc('pull_changes', { p_since: 0, p_limit: 500 });
const push = (c, changes) => c.rpc('push_changes', { p_changes: changes });
const ids = (data) => (data?.changes ?? []).map((x) => x.row.id);

const A = client(env.TOKEN_A), B = client(env.TOKEN_B), anon = client(undefined);

await check('no token (publishable key only) cannot pull', async () => !!(await pull(anon)).error);
await check('no token cannot push', async () => !!(await push(anon, [{ table: 'saves', id, base_rev: 0, op: 'upsert', row: { url: 'https://x', title: 'x' } }])).error);
await check('forged token (bad signature) is rejected', async () => !!(await pull(client(forged(env.TOKEN_A)))).error);
if (env.TOKEN_EXPIRED) await check('expired token is rejected', async () => !!(await pull(client(env.TOKEN_EXPIRED))).error);
if (env.TOKEN_OTHER_INSTANCE) await check('token from another Clerk instance is rejected', async () => !!(await pull(client(env.TOKEN_OTHER_INSTANCE))).error);

await check('user A can push', async () => { const { data, error } = await push(A, [{ table: 'saves', id, base_rev: 0, op: 'upsert', row: { url: 'https://example.com/auth-check', title: 'auth check' } }]); return !error && data?.[0]?.status === 'applied'; });
await check('user A pulls their own row', async () => { const { data, error } = await pull(A); return !error && ids(data).includes(id); });
await check('user B does not see user A\'s row', async () => { const { data, error } = await pull(B); return !error && !ids(data).includes(id); });
await check('user B pushing the same id does not touch user A\'s row', async () => {
  const { data } = await push(B, [{ table: 'saves', id, base_rev: 0, op: 'upsert', row: { url: 'https://example.com/b', title: 'B' } }]);
  const a = await pull(A);
  const mine = (a.data?.changes ?? []).find((x) => x.row.id === id);
  await push(B, [{ table: 'saves', id, base_rev: data?.[0]?.rev ?? 0, op: 'delete' }]);
  return mine?.row.title === 'auth check';
});
await check('user A cannot write the table directly', async () => !!(await A.from('saves').insert({ id: `${id}-direct`, url: 'https://x', title: 'x' })).error);
await check('user A cannot purge tombstones', async () => !!(await A.rpc('purge_tombstones', { p_older_than: '90 days' })).error);
await check('user A cannot call refund_ai_credit (C-1)', async () => !!(await A.rpc('refund_ai_credit', { uid: 'someone' })).error);

// Clean up: delete the test row (leaves a tombstone, purged by retention later).
const rev = (await pull(A)).data?.changes?.find((x) => x.row.id === id)?.row.rev;
if (rev) await push(A, [{ table: 'saves', id, base_rev: rev, op: 'delete' }]);

console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
