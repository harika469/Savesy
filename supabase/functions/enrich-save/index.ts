// Smart Saves: turns a saved link into a clean title, tags, summary and recipe/place/product details.
//
// Deploy:  supabase functions deploy enrich-save --no-verify-jwt
//          supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   (optional: ANTHROPIC_MODEL)
// OFF unless SMART_SAVES_ENABLED=true is set as a function secret. While off, every request is answered
// with 503 before any credit, page fetch or Claude call (see ../_shared/enrichHandler.ts).
// JWT verification at the gateway is off because requests carry Clerk tokens; the function
// authenticates them through the database instead (consume_ai_credit runs as the caller, so
// Supabase validates the Clerk token and row-level security applies).

import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  buildUserMessage, EnrichRequest, isSafePublicUrl, normalizeSmartResult, oembedContext,
  oembedEndpoint, pageContext, SMART_SCHEMA, SYSTEM_PROMPT,
} from '../_shared/enrich.ts';
import { handleEnrich, smartSavesEnabled } from '../_shared/enrichHandler.ts';

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-opus-5-5';
// Bounded: one attempt of at most 60 s plus one retry keeps the worst case far below any reservation lease.
const anthropic = new Anthropic({ timeout: 60_000, maxRetries: 1 }); // reads ANTHROPIC_API_KEY
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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
  // Read per request so flipping the secret takes effect without redeploying code.
  const enabled = smartSavesEnabled(Deno.env.get('SMART_SAVES_ENABLED'));
  const { status, body } = await handleEnrich(
    { method: request.method, authorization: request.headers.get('Authorization'), readJson: () => request.json() },
    {
      enabled,
      consumeCredit: async (authorization) =>
        await createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authorization } } }).rpc('consume_ai_credit'),
      refundCredit: async (userId) => await createClient(SUPABASE_URL, SERVICE_KEY).rpc('refund_ai_credit', { uid: userId }),
      linkContext,
      askClaude,
      log: (message, detail) => console.error(message, detail ?? ''),
    },
  );
  if (body === null) return new Response('ok', { headers: cors });
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
});
