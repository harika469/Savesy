import type { PullPage, PushChange, PushResult, SyncTransport } from '@/utils/syncEngine';
import { getSupabase } from './supabase';

/** Turns Supabase/network errors into something a person can act on. */
export function friendlyCloudError(message: string): string {
  if (/fetch|network|timed? ?out|ECONN/i.test(message)) return 'Can’t reach the cloud right now.';
  if (/pull_changes|push_changes|could not find the function/i.test(message)) return 'The Savesy server hasn’t been updated for this version of the app yet.';
  if (/jwt|jws|token|PGRST301|PGRST302/i.test(message)) return 'Supabase didn’t accept your login. Check that Clerk is added as a third-party auth provider in Supabase.';
  if (/does not exist|could not find the table|schema cache/i.test(message)) return 'The Savesy tables are missing in Supabase. Run supabase/migrations in the SQL editor.';
  if (/invalid api key|apikey/i.test(message)) return 'The Supabase key in this build isn’t valid.';
  return message.endsWith('.') ? message : `${message}.`;
}

type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> };

/** The B1 sync protocol over Supabase RPC (push_changes / pull_changes). Requests carry the Clerk token.
 *  `getClient` is only overridden by tests (B3 runs this exact transport against real PostgreSQL). */
export function supabaseTransport(getClient: () => RpcClient | null = getSupabase): SyncTransport {
  const client = () => {
    const supabase = getClient();
    if (!supabase) throw new Error('Cloud sync is not configured.');
    return supabase;
  };
  return {
    async pull(since, limit, full): Promise<PullPage> {
      const { data, error } = await client().rpc('pull_changes', { p_since: since, p_limit: limit, p_full: full });
      if (error) throw new Error(error.message);
      return data as PullPage;
    },
    async push(changes: PushChange[]): Promise<PushResult[]> {
      const { data, error } = await client().rpc('push_changes', { p_changes: changes });
      if (error) throw new Error(error.message);
      return data as PushResult[];
    },
  };
}
