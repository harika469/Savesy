# Savesy

Savesy is a local-first Expo SDK 54 mobile app for saving the good things you find online—and actually finding them again. It includes:

- **Saving links** — paste from the clipboard, and Savesy reads the page's real title, site name and preview image (falling back to smart guesses from the URL when offline). It warns you before saving the same link twice.
- **Editing** — change any save's link, title, note, tags, type or collection.
- **Search** — multi-word search across titles, notes, tags, sources and URLs, with type and ♥ Favorites filters and one-tap popular tags.
- **Collections** — create, rename and delete them; deleting keeps the saves.
- **Rediscover** — a rotating pick of something you saved a while ago.
- **Deep link** — `savesy://add?url=https://…` opens the Save screen with the link filled in (handy for iOS Shortcuts / Android share automations).
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

## Useful commands

```bash
npm run typecheck
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
- `utils/` — link metadata fetching and URL helpers, search, and date helpers
