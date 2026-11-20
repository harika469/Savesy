// Supabase Edge Function `organise`: turns text the user supplied (caption, scanned text, note) into
// structured information with an AI model. The AI key stays here; the app only holds the public anon key.
//
// Not deployed or tested against real Supabase / AI services yet (see README).
//
//   supabase secrets set ANTHROPIC_API_KEY=... [AI_MODEL=claude-haiku-5-5] [DAILY_LIMIT=30] [GLOBAL_DAILY_LIMIT=3000]
//   supabase db push
//   supabase functions deploy organise        # config.toml sets verify_jwt=false; this function checks the caller itself
//
// Also enable Authentication -> Sign In / Providers -> "Allow anonymous sign-ins" in the dashboard.

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildRequest, extractToolInput, normalise, validateInput } from "./logic.ts";

const GLOBAL_KEY = "00000000-0000-0000-0000-000000000000";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (Deno.env.get("AI_ENABLED") === "false") return json({ error: "AI is switched off" }, 503);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Who is calling? Each app install is an anonymous Supabase user.
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) return json({ error: "sign in required" }, 401);

  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const input = validateInput(body);
  if (!input.ok) return json({ error: input.error }, 400);

  // Spending caps: an app-wide daily cap first (anonymous accounts are cheap to create), then one per user.
  const globalLimit = Number(Deno.env.get("GLOBAL_DAILY_LIMIT") ?? 3000);
  const userLimit = Number(Deno.env.get("DAILY_LIMIT") ?? 30);
  const globalOk = await admin.rpc("increment_ai_usage", { p_user: GLOBAL_KEY, p_limit: globalLimit });
  const userOk = await admin.rpc("increment_ai_usage", { p_user: auth.user.id, p_limit: userLimit });
  if (globalOk.error || userOk.error) return json({ error: "usage check failed" }, 500);
  if (!globalOk.data || !userOk.data) return json({ error: "daily limit reached" }, 429);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "AI key not configured" }, 503);

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(buildRequest(input.value, Deno.env.get("AI_MODEL") ?? "claude-haiku-5-5")),
    signal: AbortSignal.timeout(25_000),
  }).catch(() => null);
  if (!upstream || !upstream.ok) return json({ error: "AI service unavailable" }, 502);

  const toolInput = extractToolInput(await upstream.json());
  if (!toolInput) return json({ error: "AI gave no usable answer" }, 502);
  return json({ result: normalise(toolInput, input.value.folders) });
});
