# Handoff: emulator/simulator keeps failing during debugging

> Purpose: start a **fresh Claude session** with only the context needed to chase
> the emulator/simulator instability — without dragging along the unrelated
> body-composition feature work. Paste this file (or point the new session at it).

## 0. First thing the new session needs (NOT yet captured)

The actual error text/stack from the latest failure is **not in this doc** — it
wasn't captured before the context was cut. **Paste the new error here before
debugging:**

```
<<< PASTE the red-screen / Metro / Xcode / logcat output here >>>
```

Also confirm which target failed:
- [ ] iOS Simulator  (recent work used this — `com.aprid89.longeviq`)
- [ ] Android Emulator (the word "emulator" usually means this)

> ⚠️ "emulator" (Android) vs "simulator" (iOS) matters — the two known failure
> modes below are **Android-only**. If the failure was on the iOS simulator,
> neither known issue applies and it's a new investigation.

## 1. Environment

- Expo 53, React Native 0.79 (note: one memory mentions RN 0.83.4 patch — verify
  actual version with `cat package.json | grep react-native`).
- Bundle id: `com.aprid89.longeviq`
- Run commands (from CLAUDE.md):
  - iOS sim: `npm run ios` / `npx expo run:ios`
  - iOS device: `npx expo run:ios --device`
  - Android: `npm run android`
  - Clear iOS sim app data: `xcrun simctl uninstall <udid> com.aprid89.longeviq`
  - Clean iOS build: `npx expo prebuild --clean --platform ios`
- `postinstall: patch-package` applies `patches/` automatically on `npm install`.

## 2. Two KNOWN recurring failures (Android, dev-only) — rule these out first

### A. `ReactActivityDelegate.onKeyDown` NullPointerException  (dev-only noise)
- Stack: `java.lang.NullPointerException` at
  `com.facebook.react.ReactActivityDelegate.onKeyDown(:217)` →
  `Objects.requireNonNull(mReactDelegate)`, via
  `expo.modules.devmenu.detectors.InterceptingWindowCallback`.
- Cause: RN bug — `mReactDelegate` is nullable; a key event during reload/teardown
  throws. Worsened by **Metro restart churn + the emulator's hardware keyboard**
  feeding the dev-menu key detector. Dev-only; production never hits it; app
  auto-recovers (noise, not data loss).
- Fix in repo: `patches/react-native+0.83.4.patch` null-guards
  `onKeyDown/onKeyUp/onKeyLongPress`. **Requires a dev-client rebuild**
  (`npx expo run:android` / EAS dev build) — Fast Refresh will NOT apply it.
- Verify the patch is actually applied in the running build before re-chasing.

### B. Coach-image heap OOM  (Android, can freeze the app)
- Symptom: app freezes; crash may surface as SQLite `OutOfMemoryError` in
  unrelated screens (e.g. Progress > Training) because of inherited memory
  pressure — misleading.
- Cause: oversized coach images decode to ~64 MB each in RAM (4096² × 4 bytes).
- Mitigations already in place: images resized ≤1280px; `largeHeap: true` in
  app.json (needs native rebuild). Real fix: migrate coach `<Image>` →
  `expo-image` (downsamples to display size).
- Distinguish from A: this one has an **OutOfMemory / Bitmap** signature; A does not.

## 3. Likely-fresh causes if it's NOT A or B
- iOS simulator: red box from Metro (JS error), stale Metro cache
  (`npx expo start -c`), or a native module not in the simulator build.
- The recent feature work added `expo-image-picker` multi-select + camera flows.
  **The camera does not work in the iOS simulator** — `lib/camera-helper.ts`
  falls back to a bundled test image. If the failure is around photo
  capture/seeding, that's expected simulator behavior, not a bug.

## 4. Standard reset checklist
1. `watchman watch-del-all` (if installed)
2. `npx expo start -c`  (clear Metro cache)
3. Reinstall app on the device/sim (uninstall first)
4. If native code/patch changed: full rebuild (`npx expo run:ios|android`),
   not OTA / Fast Refresh.
5. iOS pod issues: `npx expo prebuild --clean --platform ios`.

## 5. Recommendation: move debugging to a real device — yes, for this work

For the features in flight (camera capture, photo-library picker, vertical-only
image checks, body-progress photos, HealthKit/wearables, push), a **real device
connected to the Mac is the better target**:
- The iOS **simulator has no camera** (camera-helper returns a fake image), so
  photo capture / orientation checks can't be tested there at all.
- Real RAM/GPU → representative of the OOM behavior; emulator AVDs are often
  RAM-starved and exaggerate freezes.
- HealthKit, notifications, real Photos library, performance all behave correctly.
- The Android onKeyDown NPE is largely an **emulator hardware-keyboard** artifact;
  a real device hits it far less.

Trade-offs: one-time setup (Apple provisioning / USB or Wi-Fi debugging, a
dev-client build via `npx expo run:ios --device` or EAS). Keep the simulator for
fast pure-UI iteration; use the device for anything native/camera/memory.

Suggested split: **device = native/camera/memory/perf; simulator = quick UI/layout.**

## 6. Quick start: run on the connected iPhone
1. Plug in iPhone (or same-Wi-Fi), trust the Mac, enable Developer Mode on iOS.
2. `npx expo run:ios --device`  → pick the device, sign with your Apple team.
3. Subsequent JS-only changes: `npx expo start --dev-client` and open the app.
