import type { EnrichRequest, EnrichResponse, PlanInfo, SmartResult } from '@/supabase/functions/_shared/enrich';
import { normalizeSmartResult } from '@/supabase/functions/_shared/enrich';
import { cloudConfigured, getSupabase } from './supabase';

export type { PlanInfo, SmartResult };
/**
 * Smart Saves are OFF in builds unless EXPO_PUBLIC_SMART_SAVES_ENABLED=true. This only hides the UI;
 * the edge function enforces its own server-side flag (SMART_SAVES_ENABLED), so an old or modified
 * app still can't spend credits or reach Claude while it's off.
 */
export function smartSavesFlag(value: string | undefined): boolean { return value === 'true'; }
export const smartSavesAvailable = cloudConfigured && smartSavesFlag(process.env.EXPO_PUBLIC_SMART_SAVES_ENABLED);

export class SmartSaveError extends Error {
  constructor(message: string, readonly reason: 'disabled' | 'limit' | 'unauthorized' | 'bad_request' | 'failed' | 'offline', readonly plan?: PlanInfo) { super(message); }
}

/** Asks the server to read the link and organize it. Uses one Smart Save from the monthly allowance. */
export async function enrichLink(input: EnrichRequest): Promise<{ result: SmartResult; plan: PlanInfo }> {
  const supabase = getSupabase();
  if (!supabase) throw new SmartSaveError('Smart Saves need an account.', 'unauthorized');
  const { data, error } = await supabase.functions.invoke<EnrichResponse>('enrich-save', { body: input });
  // Non-2xx replies (limit reached, etc.) still carry our JSON body on error.context.
  let body: EnrichResponse | null = data ?? null;
  if (error) {
    const ctx = (error as { context?: Response }).context;
    try { body = ctx && typeof ctx.json === 'function' ? await ctx.json() as EnrichResponse : null; } catch { body = null; }
    if (!body) throw new SmartSaveError('Can’t reach Smart Saves right now.', 'offline');
  }
  if (!body) throw new SmartSaveError('Smart Save didn’t work this time.', 'failed');
  if (!body.ok) throw new SmartSaveError(body.message, body.reason, body.plan);
  const result = normalizeSmartResult(body.result);
  if (!result) throw new SmartSaveError('Smart Save didn’t work this time.', 'failed');
  return { result, plan: body.plan };
}

export async function getPlan(): Promise<PlanInfo | undefined> {
  const supabase = getSupabase();
  if (!supabase) return undefined;
  const { data, error } = await supabase.rpc('get_plan');
  return error ? undefined : data as PlanInfo;
}

/** Records "I want Pro" (fake-door test: real demand, before payments exist). */
export async function registerProInterest(plan: 'monthly' | 'yearly'): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { error } = await supabase.from('pro_interest').upsert({ plan }, { onConflict: 'user_id' });
  return !error;
}
