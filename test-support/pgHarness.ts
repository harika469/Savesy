/**
 * B3 harness: a disposable PostgreSQL database set up like a Supabase project (supabase/tests/emulate_supabase.sql)
 * with every migration applied, plus an RPC client that behaves like PostgREST for one signed-in user:
 * each call is its own transaction, run as role `authenticated` with the user's JWT claims, and errors come back
 * as { error: { message } }. Lets the real client transport (lib/cloudSync.ts) and sync engine run against the real SQL.
 * Needs psql/createdb on PATH and PGHOST/PGPORT/PGUSER (a superuser) in the environment; see __tests__/e2e.pg.test.ts.
 */
import { execFileSync, spawn } from 'child_process';
import { readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');

export const pgAvailable = () => {
  if (process.env.SAVESY_PG !== '1') return false;
  try { execFileSync('psql', ['-X', '-At', '-d', 'postgres', '-c', 'select 1'], { stdio: 'pipe' }); return true; } catch { return false; }
};

/** Runs SQL as the database owner (setup, inspection, service jobs). Returns stdout. */
export function psql(db: string, sql: string, stdin?: string): Promise<{ out: string; err: string; code: number }> {
  return new Promise(resolve => {
    const p = spawn('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', db, ...(stdin === undefined ? ['-c', sql] : [])]);
    let out = '', err = '';
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (err += d));
    p.on('close', code => resolve({ out: out.trim(), err: err.trim(), code: code ?? 1 }));
    if (stdin !== undefined) p.stdin.end(stdin); else p.stdin.end();
  });
}
async function must(db: string, sql: string, stdin?: string) {
  const r = await psql(db, sql, stdin);
  if (r.code !== 0) throw new Error(`psql failed: ${r.err}`);
  return r.out;
}

export async function createDb(): Promise<string> {
  const db = `savesy_e2e_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  execFileSync('createdb', [db]);
  execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', join(ROOT, 'supabase/tests/emulate_supabase.sql')], { stdio: 'pipe' });
  for (const m of readdirSync(join(ROOT, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) {
    execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', join(ROOT, 'supabase/migrations', m)], { stdio: 'pipe' });
  }
  return db;
}
export const dropDb = (db: string) => execFileSync('dropdb', ['--if-exists', db]);

/** A dollar-quote tag that cannot occur in the payload. */
const quote = (text: string) => { let tag = 'q'; while (text.includes(`$${tag}$`)) tag += 'q'; return `$${tag}$${text}$${tag}$`; };

/** PostgREST-like client for one user: rpc(fn, namedArgs) → { data, error }. uid null = no login (the anon key only). */
export function rpcClient(db: string, uid: string | null, hooks: { before?: (fn: string, args: Record<string, unknown>) => Promise<void> | void } = {}) {
  return {
    async rpc(fn: string, args: Record<string, unknown>) {
      if (hooks.before) await hooks.before(fn, args);
      if (!/^[a-z_]+$/.test(fn)) throw new Error('bad function name');
      const named = Object.entries(args).map(([k, v]) => {
        if (!/^[a-z_]+$/.test(k)) throw new Error('bad argument name');
        const lit = typeof v === 'number' || typeof v === 'boolean' ? String(v) : `${quote(JSON.stringify(v))}::jsonb`;
        return `${k} => ${lit}`;
      }).join(', ');
      const role = uid === null ? 'anon' : 'authenticated';
      const claims = quote(JSON.stringify(uid === null ? { role } : { sub: uid, role }));
      const sql = `begin;\nset local role ${role};\nselect set_config('request.jwt.claims', ${claims}, true) \\g /dev/null\nselect public.${fn}(${named})::text;\ncommit;\n`;
      const r = await psql(db, '', sql);
      if (r.code !== 0) return { data: null, error: { message: r.err.replace(/^psql:[^:]*:\d+: /gm, '').replace(/^ERROR:\s*/m, '') } };
      return { data: JSON.parse(r.out), error: null };
    },
  };
}

/** The daily retention job, made to act now: ages existing tombstones past 7 days, then runs purge_tombstones as service_role. */
export async function purgeNow(db: string): Promise<number> {
  const out = await must(db, '', `update public.saves set deleted_at = now() - interval '8 days' where deleted_at is not null;
update public.collections set deleted_at = now() - interval '8 days' where deleted_at is not null;
set role service_role;
select public.purge_tombstones(interval '7 days');
`);
  return Number(out.split('\n').pop());
}

/** Live rows for a user, as the database holds them (owner view, bypassing RLS). */
export async function liveRows(db: string, uid: string, table: 'saves' | 'collections'): Promise<Record<string, unknown>[]> {
  const out = await must(db, `select coalesce(json_agg(to_jsonb(t) - 'user_id' order by id), '[]') from public.${table} t where user_id = ${quote(uid)} and deleted_at is null`);
  return JSON.parse(out);
}
export const sqlValue = (db: string, sql: string) => must(db, sql);
