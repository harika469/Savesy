# Reelbox (Android, Kotlin + Jetpack Compose)

Native Android app from the Reelbox product handover: capture reels from Instagram / Facebook via
**Share → Reelbox**, auto-file them into folders, then search, add notes and track status.

Stack: Kotlin, Jetpack Compose (Material 3), Room (offline-first), Supabase Edge Function for oEmbed.

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

Without Supabase configured, every reel is saved for manual details (title + note). To enable oEmbed:

1. Create a Meta developer app with the oEmbed Read feature, then deploy `supabase/functions/oembed`
   (`supabase secrets set META_APP_ID=... META_APP_SECRET=...`).
2. Add to `local.properties` (not committed):
   ```
   supabase.url=https://<project>.supabase.co
   supabase.anonKey=<anon key>
   ```

The Edge Function is written but **not deployed or tested** against Meta's API.
