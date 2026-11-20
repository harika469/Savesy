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

Tested on 20 Nov 2026: Meta's oEmbed works **without a token** (HTTP 200) but returns only an embed
placeholder (`html` saying "View this post on Instagram"): no title, author, caption or thumbnail. Reading
Instagram's pages directly would be scraping, which the handover rules out. So the app does this instead:

1. **Share → Reelbox** (or copy the link and open the app: a "Reel link copied. Save it?" card appears) saves the
   link to Inbox straight away.
2. The user takes a **screenshot of the reel and picks it** ("Fill in from a screenshot"): ML Kit reads the text on the
   phone (nothing is uploaded) and fills creator, caption, hashtags and audio; the screenshot becomes the thumbnail.
   OCR is best effort and not yet checked on real reel screenshots.
3. For long captions, the user taps **"Paste caption"** after copying the caption in Instagram (exact, fully searchable),
   or picks up to 5 screenshots taken while scrolling the caption; overlapping lines are merged.
4. And/or the user **says or types a few words** about it. Voice uses the phone's built-in speech recognition (no
   microphone permission). Reelbox makes a title, up to 5 tags and files it into a folder with the rules classifier.

`MetaOEmbedEnricher` is kept (and tested) for when a Meta token with oEmbed Read access exists, which does return
author and thumbnail; switch it on in `ReelboxApp.kt`. Facebook reels via `oembed_video` were not tested.
