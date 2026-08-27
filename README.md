# Savesy

Savesy is a local-first mobile app for saving the good things you find online—and actually finding them again. V1 includes seeded demo saves, search and filters, collections, local persistence, favorites, deletion, sharing, original-link opening, and a rotating Rediscover pick.

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
- `utils/` — metadata inference, search, and date helpers
