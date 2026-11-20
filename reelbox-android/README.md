# Reelbox (Android, Kotlin + Jetpack Compose)

Native Android app from the Reelbox product handover: capture reels from Instagram / Facebook via
**Share → Reelbox**, auto-file them into folders, then search, add notes and track status.

Stack: Kotlin, Jetpack Compose (Material 3), Room (offline-first), Meta oEmbed (tokenless).

## Build

Requires JDK 17+ and the Android SDK (platform 35, build-tools 35).

```bash
export ANDROID_HOME=/path/to/android-sdk
./gradlew :app:assembleDebug          # app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:testDebugUnitTest      # 31 unit tests (link parsing, classifier, search, Room repository)
```

Screens are rendered to `app/build/screenshots/*.png` by `ScreenshotTest` (no device needed).

## What works

- **Share → Reelbox** (`ShareActivity`): accepts shared text from Instagram / Facebook, saves instantly to
  Inbox, then fetches details and auto-files. Works even if the app was closed.
- Link parsing for Instagram (`reel`, `reels`, `p`, `tv`) and Facebook (`reel`, `watch?v=`, `videos`, `fb.watch`,
  `share/r`), tracking parameters removed.
- Duplicate detection ("Already saved in Recipes").
- Rules-based classifier (Recipes, Travel, Fashion, Home, Motivation; Inbox fallback), English + some Dutch.
- Offline queue: reels saved without a connection stay pending and are enriched on next launch.
- Home: search (typo-tolerant), stats, folder chips, 2-column grid. Detail: status, folder, note (500 chars),
  open original, delete. Add by link (+ button).

## Not built yet (see handover)

Reminders and weekly digest, accounts and Supabase sync, export / delete-my-data, settings, custom and
sub-folders, collections, affiliate "Act on this" cards (planned for month 3), Facebook/Instagram dedupe merge.

## Getting details for a reel (creator, caption, tags)

Meta's public (tokenless) oEmbed returns the embed HTML, which the app renders (see "Meta oEmbed" below), but not
separate creator / caption / thumbnail fields. Those details come from the user, so the app does this:

1. **Share → Reelbox** (or copy the link and open the app: a "Reel link copied. Save it?" card appears) saves the
   link to Inbox straight away.
2. The user takes a **screenshot of the reel and picks it** ("Fill in from a screenshot"): ML Kit reads the text on the
   phone (nothing is uploaded) and fills creator, caption, hashtags and audio; the screenshot becomes the thumbnail.
   OCR is best effort and not yet checked on real reel screenshots.
3. For long captions, the user taps **"Paste caption"** after copying the caption in Instagram (exact, fully searchable),
   or picks up to 5 screenshots taken while scrolling the caption; overlapping lines are merged.
4. And/or the user **says or types a few words** about it. Voice uses the phone's built-in speech recognition (no
   microphone permission). Reelbox makes a title, up to 5 tags and files it into a folder with the rules classifier.

`MetaOEmbedProvider` (kept and tested) fills creator and thumbnail automatically if Meta ever sends them; it is not
switched on by default (see `ReelboxApp.kt`), because a call per saved reel gains nothing while Meta sends HTML only.
Facebook reels via `oembed_video` have not been tested against the live service.

## AI organising (Supabase Edge Function)

After text arrives (pasted caption, scanned screenshot, spoken or typed words) Reelbox can call the `organise`
function. It returns a title, summary, category, tags, ingredients, places, products, suggested actions and
cooking time. Only that text and the creator name are sent, never the video, link or account details. The result
is cached on the reel and keyed by a hash of the text, so unchanged text is never sent again.
Without Supabase configured the button says "AI isn't set up" and everything else keeps working.

Status: the function, SQL and app code are written and unit-tested (11 Node tests for the function logic, plus
the app tests), but **not deployed and not run against real Supabase or an AI service yet**.

Setup:
1. Create a Supabase project (EU region) and install the Supabase CLI.
2. Dashboard -> Authentication -> Sign In / Providers -> enable **Allow anonymous sign-ins** (each install gets its
   own anonymous user so usage can be counted). Turning on CAPTCHA protection is recommended.
3. `supabase link --project-ref <ref>` then `supabase db push` (creates the daily usage counters).
4. `supabase secrets set ANTHROPIC_API_KEY=... ` (optional: `AI_MODEL`, `DAILY_LIMIT=30`, `GLOBAL_DAILY_LIMIT=3000`,
   `AI_ENABLED=false` as an off switch), then `supabase functions deploy organise` (`supabase/config.toml` sets `verify_jwt = false` because the function checks the caller itself).
5. Add `supabase.url` and `supabase.anonKey` to `local.properties` and rebuild the app.
6. Set a monthly spend limit with the AI provider.

Cost protection: a per-user daily cap and an app-wide daily cap are enforced in Postgres. Anonymous accounts are
cheap to create, so the app-wide cap and the provider spend limit are the real safety net.

Dashboard-only setup (no CLI): SQL Editor -> paste `supabase/migrations/20261120000000_ai_usage.sql` and run; Edge Functions -> Secrets ->
add `ANTHROPIC_API_KEY`; Edge Functions -> Deploy a new function -> Via Editor -> name `organise`, paste
`supabase/functions/organise/index.single.ts`, and turn off "Verify JWT".

Function tests: `node --experimental-strip-types --test supabase/functions/organise/logic.test.ts`

## Meta oEmbed (current rules, checked Nov 2026)

On 15 June 2026 Meta removed the access-token and App Review requirement for **public** oEmbed requests
(Meta's Graph API reference for oEmbed Post / oEmbed Video, and the 15 June 2026 developer blog post). Reelbox uses it as follows:

- `OEmbedClient` (OkHttp) calls `https://graph.facebook.com/v27.0/instagram_oembed` (Instagram) or `/oembed_video`
  (Facebook) with only the public reel link. It never sends an app token, an App ID or Secret, a cookie or any user
  identifier (a unit test asserts this). There is no scraping and no browser automation.
- The answer is the **embed HTML**. Unauthenticated, it normally has no separate creator, caption or thumbnail fields,
  so those still come from the user (pasted caption, screenshots, spoken words) and the AI step. If Meta does send
  `author_name`, `title` or `thumbnail_url`, `MetaOEmbedProvider` uses them.
- **Rendering**: tapping "Show the post here" on a reel fetches the embed, cleans it (scripts, inline event handlers
  and `javascript:` links removed), and shows it in a locked-down WebView: a strict Content-Security-Policy, only the
  official Instagram / Facebook script, HTTPS and Instagram/Facebook hosts only, no file or content access, no
  popups, no third-party cookies, links out open in the browser.
- **Fallback**: if oEmbed is rate limited or its answer can't be read, the app shows the basic embed page instead
  (`/embed/captioned/` for Instagram, the Facebook video plugin). "Not showing? Use the basic view" switches by hand.
- **Private, removed or unavailable posts** (HTTP 4xx): a clear message, the reel is flagged unavailable (reversible,
  nothing is deleted, caption/notes/tags stay), with "Try the basic view anyway" and "Open in Instagram".
  Rate limits and no connection get their own messages and a retry.
- Limits and terms: unauthenticated calls are rate limited (about 1,000 per endpoint per hour was reported at
  launch) and Meta's terms restrict oEmbed data to displaying the embed. Reelbox therefore stores only the user's own
  text, not data taken from the embed.
- A Meta developer app is **not needed**. Meta's token-based route (higher limits) still requires App Review and a verified business.

Providers are interchangeable: implement `MetadataProvider` and pass it to `ReelRepository`.

## Manual test checklist (needs a real phone: not done yet)

Automated tests cover the logic (106), but nothing has run on a device or emulator. On a phone, check:
1. Open a reel's page, tap "Show the Instagram post here": the post renders (creator, caption, media). Try one public reel, one private and one deleted.
2. "Not showing? Use the basic view" switches to the fallback; "Hide post" collapses it.
3. Airplane mode: "Couldn't reach Instagram" and "Try again" works afterwards.
4. Tapping the creator name or "View more" opens the browser, not the WebView.
5. A removed or private post shows the unavailable message and the reel keeps its notes.
6. Share a reel from Instagram: Reelbox appears in the share sheet (scroll or tap More).
