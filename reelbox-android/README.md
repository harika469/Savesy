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

## Enrichment (creator, caption, thumbnail)

`MetaOEmbedEnricher` calls Meta's oEmbed endpoints (`instagram_oembed`, `oembed_video`) straight from the
phone, with **no access token, no Meta app and no backend**. Meta lifted the token and App Review
requirement for public content in June 2026; the limit is 1,000 requests per endpoint per hour per caller.

- Private or deleted reels return an error, and the reel is kept as a manual card (title + note).
- Rate limit, outages and no network keep the reel pending; it is retried on the next app start.
- **Not yet verified against the live API**: what fields Meta returns today (caption, thumbnail) and whether
  Facebook *reels* work through `oembed_video`. Check with a real public reel before relying on it.
- Higher volume later: a token with App Review allows up to 5M requests/day, which would need a small server.
