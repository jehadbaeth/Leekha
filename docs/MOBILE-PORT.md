# Mobile port: Android + iOS

The mobile apps are a **Capacitor shell around the existing `apps/web` build**.
There is no second UI. `capacitor.config.ts` points `webDir` straight at
`apps/web/dist`, so the apps run the exact same React bundle the browser does.

A screen-by-screen visual comparison against the live web app is published at
<https://claude.ai/code/artifact/6f46a5be-7f1f-4f7c-a8bb-919788e44c94>
(source and captures in `docs/mobile-parity/`).

## Why a wrapper and not a rewrite

The requirement was a direct port matching the webapp exactly in logic and
visuals. That is satisfiable *by construction* only if it is literally the same
code. The web UI is ~8.8k lines of Tailwind, container queries, CSS keyframe
animations and `dir=rtl` mirroring; a React Native or Flutter reimplementation
could approximate it but never match it, would take months, and would fork the
codebase so every future change had to be built twice.

The wrapper also leaves `packages/engine`, `packages/bots` and
`packages/protocol` completely untouched, so CLAUDE.md's purity rules and the
`pnpm test` / `pnpm sim` gate keep working unchanged.

## "The same backend works fine" was almost true

Two things genuinely break in a native webview. Both are fixed.

**1. The server URL.** `socket.ts` fell back to `window.location.origin`, which
in a native shell is the *local bundle*, not the server. Every socket and
`/api/*` call would have gone nowhere. Native builds now require an explicit
`VITE_SERVER_URL` (`apps/web/src/native.ts`, `resolveServerUrl`), and throw
loudly at startup if it is missing rather than failing later as a pile of
silent connection errors.

**2. The session cookie.** The session cookie is `SameSite=Lax`. From a native
webview every `/api/*` call is cross-site, and browsers refuse to attach a Lax
cookie to cross-site XHR, so login would appear to succeed and then `/api/me`
would 401 forever. `apps/server/src/auth.ts` now also accepts
`Authorization: Bearer <token>`, and `/api/register` and `/api/login` return
that token in the response body. The socket handshake accepts the same token via
socket.io's `auth` payload. **Web behaviour is unchanged** and still cookie
based; the token is only stored when `isNative()` is true. Covered by three new
tests in `apps/server/test/auth.test.ts`.

A third, subtler one was found while testing: `roomShare.ts` built invite links
from `window.location.origin`, so every invite sent from the app would have read
`https://localhost/?join=CODE` and been dead for the recipient. It now uses the
server URL on native.

## Native-only behaviour

Everything below is the complete list of places the app deliberately behaves
differently inside the shell. Everything else is identical code.

| Area | Behaviour |
| --- | --- |
| Service worker | Not registered on native, and any worker left by a previous build is actively unregistered. A SW caching against the bundle origin can ship stale JS with no "clear site data" escape hatch. |
| Install prompt | `beforeinstallprompt` never fires in the shell, so the banner is inert. An "install app" banner inside an installed app would be a visible mismatch. |
| Android back button | Screens register handlers via `registerBackHandler` and the highest priority one to return true wins, so an overlay always gets the press before the screen containing it. App.tsx owns the screen-level chain (admin panel, landing sub-screen, Leekha drawer, in-game how-to/settings, leave room); `TrixOnlineGame` registers its own overlay-priority handler because it owns its room drawer and a separate connection from the Leekha hook. Only a press at the bare menu closes the app. |
| Safe areas | `viewport-fit=cover` is stripped from `index.html` at build time, so the webview viewport *is* the safe area and every screen keeps the exact proportions it has on the web. The alternative (per-component `env(safe-area-inset-*)`) would have drifted from the web layout. |
| System bars | Status bar, navigation bar and the window background are all painted the table's felt green (`#0b3d2e`). The window background matters in landscape, where the letterbox beside the camera cutout would otherwise be white. |
| iOS audio | `AppDelegate` sets an `AVAudioSession` `.playback` category with `.mixWithOthers`. In iOS Safari, Web Audio plays with the ringer switch on silent; a WKWebView defaults to honouring it, which would silently kill the entire sound layer. `.mixWithOthers` keeps the player's own music going. Drop that call to respect the silent switch instead. |
| iOS microphone | `NSMicrophoneUsageDescription` is set. iOS terminates the app outright if `getUserMedia` is called without it, and the voice lobby calls it. |
| Android microphone | `RECORD_AUDIO` and `MODIFY_AUDIO_SETTINGS` declared; `android.hardware.microphone` marked not required so a device without one still installs. |

## Building

```bash
cd apps/mobile
pnpm install
pnpm run sync                 # builds apps/web with VITE_SERVER_URL, then cap sync
pnpm run open:android         # or: cd android && ./gradlew assembleDebug
```

`VITE_SERVER_URL` defaults to the Tailscale Funnel deployment. Override it for
another backend:

```bash
VITE_SERVER_URL=https://your-server pnpm run sync
```

Toolchain actually used here: **JDK 21** (Capacitor 7 rejects 17 with
`invalid source release: 21`), Android SDK 35, Capacitor 7.6.9. Capacitor 8 was
available but needs JDK 21+/SDK 36.

### Developing against a local server

Use an **HTTPS** dev server. The webview serves the app from `https://localhost`,
so a plain-HTTP dev server is blocked as mixed content regardless of any
cleartext policy. A debug-only `network_security_config.xml` permits cleartext to
`10.0.2.2` / `localhost` / LAN, but that alone is not sufficient. See the comment
in that file.

## Status

**Android: built, installed and verified** on an API 35 emulator against the
live backend. Verified: room creation and seating on the real server, a local
match vs bots through passing, bot replies (so the `botWorker` Web Worker runs
in the webview), follow-suit legality, trick resolution, confirm-before-play,
session resume across restart, the Trix local and online tables, a Trix online room
on the live server, hardware back at every level (overlay, room, menu), Arabic/RTL,
landscape, felt system bars, no audio decode errors, and a logged-in session
surviving a cold restart against the deployed backend.

**iOS: builds, launches and reaches the backend.** Verified on an iPhone 17 Pro
simulator (iOS 26.5, Xcode 26.6): compiles clean, renders the picker with correct
safe-area insets under the Dynamic Island, and its socket reached the live server
(the app's display name appears in the server's own `telemetry_sessions` table).

```bash
cd apps/mobile/ios/App && pod install      # already run
cd apps/mobile && npx cap open ios         # NOTE: from apps/mobile, not ios/App
```

Three things are still **not** verified on iOS and need a physical iPhone:

- Interactive flows. `simctl` has no tap command, and driving the simulator via
  AppleScript needs accessibility permission that cannot be granted headlessly.
- The silent-switch audio behaviour, which is the whole point of the
  `AVAudioSession` call in `AppDelegate` and needs a real ringer switch.
- The microphone permission prompt, which a simulator fakes.

The app is also unsigned (`CODE_SIGNING_ALLOWED=NO` for the simulator build), so
a signing team must be set in Xcode before it runs on a device.

## Open items

- ~~The bearer-token server change is not deployed.~~ **Deployed 2026-09-14.**
  Production returns a token on login, and the app was verified end to end: log
  in, force-stop, relaunch, still signed in, and `/api/history` authenticates
  through the bearer header. The accounts/history DB survived the redeploy.
- `scripts/build-web.mjs` hardcodes the Tailscale Funnel URL as its default. For
  a store release that bakes a homelab address into a binary that cannot be
  changed without resubmitting. Point it at a stable domain before shipping.
- Apple review guideline 4.2 rejects thin webview wrappers. The offline vs-bots
  play, haptics, native audio session and real icons/splash are a reasonable
  defence, but it is a genuine risk worth knowing before submission.
- App Links / Universal Links are not set up, so a shared invite link opens the
  web client rather than the app. That matches current behaviour; wiring it would
  need `assetlinks.json` / AASA files served by the backend.
