# Savesy

Savesy is a local-first Expo SDK 54 mobile app for saving the good things you find online—and actually finding them again. It includes:

- **Saving links** — paste from the clipboard, and Savesy reads the page's real title, site name and preview image (falling back to smart guesses from the URL when offline). It warns you before saving the same link twice.
- **Editing** — change any save's link, title, note, tags, type or collection.
- **Search** — multi-word search across titles, notes, tags, sources and URLs, with type and ♥ Favorites filters and one-tap popular tags.
- **Collections** — create, rename and delete them; deleting keeps the saves.
- **Rediscover** — a rotating pick of something you saved a while ago.
- **Share to Savesy** — tap Share in any app (browser, YouTube, Instagram, Maps…) and pick **Savesy** (Android) or **Save to Savesy** (iOS). The Save screen opens with the link, the page title and any extra shared text as the note. Needs a development or installed build, not Expo Go (see below).
- **Deep link** — `savesy://add?url=https://…` opens the Save screen with the link filled in (handy for iOS Shortcuts / Android share automations).
- **Cloud sync (Supabase)** — when configured, every change is synced to Supabase a moment later and when the app comes back to the foreground. No sign-up: each install gets its own anonymous account. The phone keeps a full copy, so Savesy works offline and catches up later. Without configuration it stays local-only.
- **Your stash** (tap the smiley on Home) — counts, plus backup: share or copy your whole library as a backup, restore it from the clipboard (merges, never overwrites), bring back the demo, or erase everything.
- Seeded demo content, on-device persistence, favorites, sharing and opening the original link.

## Run it

Requirements: Node.js 20.19.4 or newer and the Expo Go app on your phone.

```bash
npm install
npx expo start
```

The terminal will show a QR code. Connect your computer and phone to the same network, then:

- iOS: open the Camera app, scan the QR code, and open it in Expo Go.
- Android: open Expo Go, tap **Scan QR code**, and scan it.

You can also press `a` in the Expo terminal to open an installed Android emulator. A local iOS simulator requires macOS and Xcode. Press `w` to run the web preview; the intended experience is Android or iOS.

## Cloud sync with Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor** → paste and run [`supabase/migrations/20261102000000_savesy_schema.sql`](supabase/migrations/20261102000000_savesy_schema.sql). It creates `collections` and `saves` with row-level security so each account only sees its own rows. It's safe to re-run. (With the Supabase CLI: `supabase link` then `supabase db push`.)
3. **Authentication → Sign In / Providers** → turn on **Allow anonymous sign-ins**. Also consider enabling CAPTCHA or rate limits there, since anyone with the app can create an anonymous account.
4. Copy `.env.example` to `.env` and fill in the project URL and publishable (anon) key from **Project Settings → API**. Restart the dev server (`npm start -- --clear`).
5. For EAS builds, add the same two variables to the EAS environment (`eas env:create --name EXPO_PUBLIC_SUPABASE_URL --value … --environment preview`, and the same for the key) or to the `env` block of the build profile in `eas.json`.

Your stash (smiley on Home) shows the sync status and has a **Sync now** button.

How syncing works (`lib/cloudSync.ts`, `utils/sync.ts`):
- Ids are made on the phone, so saving works offline. Every change stamps `updatedAt`; when the phone and cloud disagree, the newer copy wins.
- Deletions are remembered until the cloud confirms them.
- An anonymous account lives on one install. Uninstalling or clearing app data starts a new account, so keep using **Share a backup** if you care about moving phones. Linking an email to the anonymous account is the natural next step for multi-device use.

## Share-to-Savesy builds

Receiving shares needs native code ([`expo-share-intent`](https://github.com/achorein/expo-share-intent)), so it doesn't work in Expo Go. Everything else still runs in Expo Go; there the share feature just stays off.

To try it on a phone, build with EAS (`npm install -g eas-cli`, then `eas login` and `eas init` once):

```bash
eas build --profile development --platform android   # dev client APK; then run the dev server with npm start
eas build --profile preview --platform android       # standalone installable APK
eas build --profile development --platform ios       # needs an Apple Developer account
```

With Android Studio or Xcode installed you can also build locally with `npm run android:dev` / `npm run ios:dev`.

Notes:
- `postinstall` runs `patch-package` to apply `patches/xcode+3.0.1.patch`, which the iOS share extension's config plugin needs.
- iOS adds a second target (`SavetoSavesy`) and the app group `group.com.harika469.savesy`. EAS sets up credentials for both; when it asks, accept creating the app group. Don't let EAS add an `appExtensions` entry to `app.json` (see the library's FAQ).
- Don't commit `ios/` or `android/`; they're generated by `expo prebuild`.

## Useful commands

```bash
npm run typecheck
npm test            # unit tests for link parsing, search, sharing and backups
npm run android
npm run ios
npm run web
```

Data is stored on-device with AsyncStorage under `@savesy/v1`. Clearing Expo Go's app data resets Savesy to its demo content.

## Project shape

- `app/` — Expo Router screens and navigation
- `components/` — reusable UI, save cards, collection cards, and doodles
- `context/` — typed state operations and persistence boundary
- `constants/seed.ts` — first-launch demo content
- `types/` — domain types
- `components/SaveForm.tsx` — the shared add/edit form
- `components/ShareIntentHandler.tsx` + `app/+native-intent.tsx` — receive shares from other apps
- `utils/` — link metadata and URL helpers, search, share parsing, backup/restore, and dates
- `lib/` — Supabase client and cloud sync
- `supabase/migrations/` — database schema and row-level security
- `__tests__/` — Jest unit tests (`jest-expo` preset)
