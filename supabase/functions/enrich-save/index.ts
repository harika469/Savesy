// Smart Saves: turns a saved link into a clean title, tags, summary and recipe/place/product details.
//
// Deploy:  supabase functions deploy enrich-save --no-verify-jwt
//          supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   (optional: ANTHROPIC_MODEL)
// JWT verification at the gateway is off because requests carry Clerk tokens; the function
// authenticates them through the database instead (consume_ai_credit runs as the caller, so
// Supabase validates the Clerk token and row-level security applies).

import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  buildUserMessage, EnrichRequest, EnrichResponse, isSafePublicUrl, normalizeSmartResult, oembedContext,
  oembedEndpoint, pageContext, PlanInfo, SMART_SCHEMA, SYSTEM_PROMPT,
} from '../_shared/enrich.ts';

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-opus-5-5';
const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: EnrichResponse, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const BROWSER_UA = 'Mozilla/5.0 (compatible; SavesyBot/1.0; +https://savesy.app/bot)';

/** Fetches with a timeout and a size cap, following redirects only to public addresses. */
async function safeFetch(url: string, accept: string, maxBytes = 1_500_000): Promise<string | undefined> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!isSafePublicUrl(current)) return undefined;
    const res = await fetch(current, { redirect: 'manual', headers: { 'User-Agent': BROWSER_UA, Accept: accept }, signal: AbortSignal.timeout(6000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location')!, current).toString();
      continue;
    }
    if (!res.ok || !res.body) return undefined;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); size += value.length;
    }
    await reader.cancel().catch(() => undefined);
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) { bytes.set(c.subarray(0, Math.min(c.length, size - offset)), offset); offset += c.length; if (offset >= size) break; }
    return new TextDecoder().decode(bytes);
  }
  return undefined;
}

async function linkContext(url: string): Promise<string> {
  const parts: string[] = [];
  const oembed = oembedEndpoint(url);
  if (oembed) {
    try {
      const text = await safeFetch(oembed, 'application/json', 200_000);
      if (text) parts.push(oembedContext(JSON.parse(text)));
    } catch { /* fall back to the page */ }
  }
  try {
    const html = await safeFetch(url, 'text/html,application/xhtml+xml');
    if (html) parts.push(pageContext(html));
  } catch { /* unreadable page: Claude works from the link and the person's own title/note */ }
  return parts.filter(Boolean).join('\n');
}

async function askClaude(req: EnrichRequest, context: string) {
  const response = await anthropic.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    // Retries on Anthropic's recommended model if a safety classifier declines the request.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SMART_SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserMessage(req, context) }],
  });
  if (response.stop_reason === 'refusal') throw new Error('declined');
  const text = response.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('');
  return normalizeSmartResult(JSON.parse(text));
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return reply({ ok: false, reason: 'bad_request', message: 'Use POST.' }, 405);

  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return reply({ ok: false, reason: 'unauthorized', message: 'Sign in to use Smart Saves.' }, 401);

  let body: EnrichRequest;
  try { body = await request.json(); } catch { return reply({ ok: false, reason: 'bad_request', message: 'Invalid request.' }, 400); }
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  if (!url || url.length > 4000 || !isSafePublicUrl(url)) return reply({ ok: false, reason: 'bad_request', message: 'That link can’t be read.' }, 400);
  const req: EnrichRequest = { url, title: typeof body.title === 'string' ? body.title.slice(0, 300) : undefined, note: typeof body.note === 'string' ? body.note.slice(0, 1000) : undefined };

  // Runs as the caller: Supabase validates the Clerk token, the function enforces the plan allowance.
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const credit = await asUser.rpc('consume_ai_credit');
  if (credit.error) return reply({ ok: false, reason: 'unauthorized', message: 'Sign in again to use Smart Saves.' }, 401);
  const plan = credit.data as PlanInfo & { allowed: boolean; user_id: string };
  const planInfo: PlanInfo = { plan: plan.plan, used: plan.used, limit: plan.limit };
  if (!plan.allowed) {
    return reply({ ok: false, reason: 'limit', message: plan.plan === 'pro' ? 'You’ve hit this month’s fair-use limit.' : `You’ve used all ${plan.limit} free Smart Saves this month.`, plan: planInfo }, 402);
  }

  const userId = plan.user_id; // verified by the database, not decoded here
  const refund = async () => {
    if (!userId) return;
    await createClient(SUPABASE_URL, SERVICE_KEY).rpc('refund_ai_credit', { uid: userId });
  };

  try {
    const result = await askClaude(req, await linkContext(url));
    if (!result) { await refund(); return reply({ ok: false, reason: 'failed', message: 'Couldn’t make sense of that link.' }, 422); }
    return reply({ ok: true, result, plan: planInfo });
  } catch (e) {
    console.error('enrich-save failed', e instanceof Error ? e.message : e);
    await refund();
    return reply({ ok: false, reason: 'failed', message: 'Smart Save didn’t work this time. You weren’t charged a credit.' }, 502);
  }
});
