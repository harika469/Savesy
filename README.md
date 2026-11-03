# Savesy

Savesy is a local-first Expo SDK 54 mobile app for saving the good things you find online—and actually finding them again. It includes:

- **Saving links** — paste from the clipboard, and Savesy reads the page's real title, site name and preview image (falling back to smart guesses from the URL when offline). It warns you before saving the same link twice.
- **Editing** — change any save's link, title, note, tags, type or collection.
- **Search** — multi-word search across titles, notes, tags, sources and URLs, with type and ♥ Favorites filters and one-tap popular tags.
- **Collections** — create, rename and delete them; deleting keeps the saves.
- **Rediscover** — a rotating pick of something you saved a while ago.
- **Share to Savesy** — tap Share in any app (browser, YouTube, Instagram, Maps…) and pick **Savesy** (Android) or **Save to Savesy** (iOS). The Save screen opens with the link, the page title and any extra shared text as the note. Needs a development or installed build, not Expo Go (see below).
- **Deep link** — `savesy://add?url=https://…` opens the Save screen with the link filled in (handy for iOS Shortcuts / Android share automations).
- **Accounts (Clerk) + cloud sync (Supabase)** — sign in with just your email and a one-time code (no passwords). Signed in, every change syncs to Supabase a moment later and when the app comes back to the foreground, so your saves follow you to any phone. Guest saves move into your account when you first sign in. The phone always keeps a full copy, so Savesy works offline. Without configuration it stays local-only.
- **Smart Saves (AI)** — one tap reads the link on the server (including TikTok, YouTube and X captions via oEmbed, and recipe/product JSON-LD) and Claude fills in a real title, tags, a short summary, and recipe ingredients, a place with an **Open in Maps** button, or a product and price. Free accounts get 10 a month; Pro is unlimited.
- **Savesy Pro screen** — shows this month's usage and the Pro plans. Payments aren't wired up yet: **I want Pro** records interest (a fake-door test) so you can measure demand before building billing. It says plainly that nothing is charged.
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

## Accounts and cloud sync (Clerk + Supabase)

Clerk handles sign-in; Supabase stores the saves. Supabase trusts Clerk's session tokens directly (Clerk is a Supabase *third-party auth provider*), and row-level security keeps each account's rows private.

**1. Clerk**
1. Create an application at [dashboard.clerk.com](https://dashboard.clerk.com).
2. **Configure → User & authentication → Email**: turn on **Sign-up with email** and **Sign-in with email** using **Email verification code**, keep **Verify at sign-up** on, and turn **Password** off. Savesy's sign-in screen is a passwordless email-code flow.
3. Enable the **Native API** (Configure → Native applications) — Clerk requires it for mobile apps.
4. Open the [Supabase integration setup](https://dashboard.clerk.com/setup/supabase), choose **Activate Supabase integration**, and copy the **Clerk domain**. This adds the `role: authenticated` claim Supabase needs.

**2. Supabase**
1. Create a project at [supabase.com](https://supabase.com).
2. **Authentication → Sign In / Providers → Add provider → Clerk**, and paste the Clerk domain.
3. **SQL Editor**: run both files in [`supabase/migrations/`](supabase/migrations/) in order. The second switches row ownership to Clerk user ids (`auth.jwt()->>'sub'`). Both are safe to re-run. (With the Supabase CLI: `supabase link` then `supabase db push`.)

**3. The app**
1. Copy `.env.example` to `.env` and fill in the Clerk publishable key and the Supabase URL + publishable key. Restart with `npm start -- --clear`.
2. For EAS builds, add the same variables to the EAS environment (`eas env:create --name EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY --value … --environment preview`, and likewise for the Supabase ones) or to the `env` block of the build profile in `eas.json`.

Login works in Expo Go. On first launch Savesy offers sign-in once; closing it keeps you in guest mode. Your stash (smiley on Home) has the account, sign-out and sync status.

How it behaves (`components/Account.tsx`, `lib/cloudSync.ts`, `utils/sync.ts`):
- Ids are made on the phone, so saving works offline. Every change stamps `updatedAt`; when the phone and cloud disagree, the newer copy wins. Deletions are remembered until the cloud confirms them.
- First sign-in: guest saves are added to the account. If you never touched the demo content and the account already has saves, the demo is dropped instead of being uploaded.
- Signing in as a different account on the same phone clears the previous account's data first, so accounts never mix.
- Sign out syncs first, warns if anything couldn't be uploaded, then clears the phone. Your saves stay in your account.
- Clerk only (no Supabase settings): you can sign in, but saves stay on the phone.

## Smart Saves and Pro

> **Beta (November 2026): Smart Saves and Pro are switched off.** The app hides them unless `EXPO_PUBLIC_SMART_SAVES_ENABLED=true`, and the edge function refuses every request with 503 (before any credit, page fetch or Claude call) unless its secret `SMART_SAVES_ENABLED=true` is set. Don't enable either until the credit redesign in issue #1 has passed staging.

Needs the Clerk + Supabase setup above.

1. Run `supabase/migrations/20261104000000_smart_saves.sql` (adds `saves.details`, `entitlements`, `ai_usage`, `pro_interest` and the `get_plan` / `consume_ai_credit` / `refund_ai_credit` functions). Allowances are enforced in the database: 10 Smart Saves a month on Free, 500 on Pro (fair use). Change them in `savesy_limits()`.
2. Deploy the function and give it a Claude API key:
   ```bash
   supabase functions deploy enrich-save --no-verify-jwt
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   ```
   `--no-verify-jwt` is required because requests carry Clerk tokens; the function authenticates them through the database (`consume_ai_credit` runs as the caller, so Supabase validates the token and RLS applies).
3. Model: defaults to `claude-opus-5-5` at low effort, with server-side refusal fallback. Each Smart Save is one short request (a few thousand input tokens). To trade quality for cost, set `supabase secrets set ANTHROPIC_MODEL=claude-haiku-5-5` and compare results on your own links first.
4. Make someone Pro by hand (until payments exist): `insert into entitlements (user_id, source) values ('user_…', 'manual');` with their Clerk user id. Set `expires_at` for trials.
5. Read demand: `select plan, count(*) from pro_interest group by plan;`

Code: `supabase/functions/enrich-save/` (server), `supabase/functions/_shared/enrich.ts` (prompt, JSON schema, page parsing, URL safety, result validation, shared with the app and tested by Jest), `lib/ai.ts`, `components/SmartSave.tsx`, `app/pro.tsx`. The function blocks private/internal addresses and caps page size and time.

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
npm run test:db     # database tests: applies every migration to a disposable PostgreSQL database that emulates Supabase (needs psql/createdb; set PGHOST/PGPORT/PGUSER)
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
- `lib/` — Supabase client (sends the Clerk token) and cloud sync
- `components/Account.tsx`, `app/sign-in.tsx` — Clerk provider and the email-code sign-in screen
- `supabase/migrations/` — database schema, row-level security, plan allowances
- `supabase/functions/` — the Smart Saves edge function and its shared logic
- `__tests__/` — Jest unit tests (`jest-expo` preset)
