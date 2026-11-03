// Request handling for the enrich-save edge function, kept free of Deno/npm imports so Jest can test
// every decision (feature flag, auth, allowance, refunds) with injected dependencies.
import { EnrichRequest, EnrichResponse, isSafePublicUrl, PlanInfo, SmartResult } from './enrich.ts';

/** Smart Saves run only when SMART_SAVES_ENABLED is exactly "true". Anything else (unset, "1", "yes") keeps them off. */
export function smartSavesEnabled(value: string | undefined | null): boolean {
  return value === 'true';
}

export type CreditResult = { data: unknown; error: unknown };

export type EnrichDeps = {
  /** Server-side feature flag. When false, nothing below is called: no credit, no page fetch, no Claude. */
  enabled: boolean;
  /** consume_ai_credit as the CALLER (the database validates the Clerk token). */
  consumeCredit: (authorization: string) => Promise<CreditResult>;
  /** refund_ai_credit as the server (service role). */
  refundCredit: (userId: string) => Promise<{ error: unknown }>;
  linkContext: (url: string) => Promise<string>;
  askClaude: (req: EnrichRequest, context: string) => Promise<SmartResult | undefined>;
  log: (message: string, detail?: unknown) => void;
};

export type HandlerInput = { method: string; authorization: string | null; readJson: () => Promise<unknown> };
export type HandlerOutput = { status: number; body: EnrichResponse | null };

const fail = (status: number, reason: Extract<EnrichResponse, { ok: false }>['reason'], message: string, plan?: PlanInfo): HandlerOutput =>
  ({ status, body: { ok: false, reason, message, ...(plan ? { plan } : {}) } });

export async function handleEnrich(input: HandlerInput, deps: EnrichDeps): Promise<HandlerOutput> {
  if (input.method === 'OPTIONS') return { status: 200, body: null };
  if (input.method !== 'POST') return fail(405, 'bad_request', 'Use POST.');
  // Feature flag first: a disabled deployment never touches credits, pages or Claude.
  if (!deps.enabled) return fail(503, 'disabled', 'Smart Saves aren’t available yet.');

  const auth = input.authorization;
  if (!auth?.startsWith('Bearer ')) return fail(401, 'unauthorized', 'Sign in to use Smart Saves.');

  let body: Partial<EnrichRequest>;
  try { body = (await input.readJson()) as Partial<EnrichRequest>; } catch { return fail(400, 'bad_request', 'Invalid request.'); }
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  if (!url || url.length > 4000 || !isSafePublicUrl(url)) return fail(400, 'bad_request', 'That link can’t be read.');
  const req: EnrichRequest = {
    url,
    title: typeof body.title === 'string' ? body.title.slice(0, 300) : undefined,
    note: typeof body.note === 'string' ? body.note.slice(0, 1000) : undefined,
  };

  // Runs as the caller: Supabase validates the Clerk token, the database enforces the plan allowance.
  const credit = await deps.consumeCredit(auth);
  if (credit.error) return fail(401, 'unauthorized', 'Sign in again to use Smart Saves.');
  const plan = credit.data as PlanInfo & { allowed: boolean; user_id: string };
  const planInfo: PlanInfo = { plan: plan.plan, used: plan.used, limit: plan.limit };
  if (!plan.allowed) {
    return fail(402, 'limit', plan.plan === 'pro' ? 'You’ve hit this month’s fair-use limit.' : `You’ve used all ${plan.limit} free Smart Saves this month.`, planInfo);
  }

  // Returns true only if the credit really went back (C-5: never claim "not charged" otherwise).
  const refund = async (): Promise<boolean> => {
    try {
      const { error } = await deps.refundCredit(plan.user_id);
      if (error) { deps.log('refund_ai_credit failed', error); return false; }
      return true;
    } catch (e) {
      deps.log('refund_ai_credit threw', e instanceof Error ? e.message : e);
      return false;
    }
  };

  try {
    const result = await deps.askClaude(req, await deps.linkContext(url));
    if (!result) {
      const refunded = await refund();
      return fail(422, 'failed', refunded ? 'Couldn’t make sense of that link. You weren’t charged a credit.' : 'Couldn’t make sense of that link.');
    }
    return { status: 200, body: { ok: true, result, plan: planInfo } };
  } catch (e) {
    deps.log('enrich-save failed', e instanceof Error ? e.message : e);
    const refunded = await refund();
    return fail(502, 'failed', refunded ? 'Smart Save didn’t work this time. You weren’t charged a credit.' : 'Smart Save didn’t work this time.');
  }
}
