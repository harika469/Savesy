// Supabase Edge Function: resolves a public Instagram / Facebook reel link to title, author and thumbnail
// using Meta's oEmbed API. The Meta app token stays in Supabase secrets, never in the Android app.
//
//   supabase secrets set META_APP_ID=... META_APP_SECRET=...
//   supabase functions deploy oembed
//
// NOTE: Meta requires a registered app with the "oEmbed Read" feature. Private or deleted reels return an
// error, which the app turns into a "Private / manual" card. This function has not been deployed or
// tested yet; verify it against your Meta app before relying on it.

const GRAPH = "https://graph.facebook.com/v21.0";

Deno.serve(async (req) => {
  const url = new URL(req.url).searchParams.get("url");
  if (!url) return json({ error: "missing url" }, 400);

  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return json({ error: "bad url" }, 400);
  }
  const isInstagram = host === "instagram.com" || host === "instagr.am";
  const isFacebook = host === "facebook.com" || host === "fb.watch";
  if (!isInstagram && !isFacebook) return json({ error: "unsupported host" }, 400);

  const token = `${Deno.env.get("META_APP_ID")}|${Deno.env.get("META_APP_SECRET")}`;
  const endpoint = isInstagram ? "instagram_oembed" : "oembed_video";
  const upstream = await fetch(`${GRAPH}/${endpoint}?url=${encodeURIComponent(url)}&access_token=${encodeURIComponent(token)}&omitscript=true`);
  if (!upstream.ok) return json({ error: "unavailable" }, upstream.status >= 500 ? 502 : 404);

  const data = await upstream.json();
  return json({
    title: data.title ?? "",
    author_name: data.author_name ?? "",
    author_url: data.author_url ?? "",
    thumbnail_url: data.thumbnail_url ?? "",
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
