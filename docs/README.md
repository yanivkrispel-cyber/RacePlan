# RacePlan — home-screen wrapper (PWA)

Why this exists: an Apps Script `/exec` page is served inside a Google-controlled
top-level document on `script.google.com`. You can't set a custom favicon /
`apple-touch-icon` / web-app manifest on it, so "Add to Home screen" of the raw
`/exec` URL only ever gets a generic letter tile and opens in a browser tab.

This folder is a tiny static site that:
- carries a real `manifest.webmanifest` + icons (from `LogoV2.png` at the repo root)
- full-screen `<iframe>`s the RacePlan `/exec` URL
- registers a service worker so Chrome offers **Install** and the shell works offline

Installed from *this* page, the home-screen entry gets the RACE PLAN icon, the name
"RacePlan", a navy splash, and opens standalone (no browser chrome).

It's published via **GitHub Pages** — this repo is configured to serve this
`docs/` folder at:

**https://yanivkrispel-cyber.github.io/RacePlan/**

(Settings → Pages → Source: *Deploy from a branch* → Branch `main`, folder `/docs`.
Pushing to `main` updates the published site — no separate deploy step.)

## Files
| file | purpose |
|---|---|
| `index.html` | the wrapper — iframes the `/exec` URL |
| `manifest.webmanifest` | name, icons, `display: standalone`, theme color |
| `sw.js` | minimal service worker (shell cache + install eligibility) |
| `icon-192.png` / `icon-512.png` | standard PWA icons |
| `icon-maskable-512.png` | Android adaptive icon (safe-zone padded) |
| `apple-touch-icon.png` | iOS home-screen icon (180×180) |
| `favicon-64.png` | browser tab icon |
(icon source is `LogoV2.png` at the repo root)

Regenerate icons after replacing `LogoV2.png`: `python build/pwa-icons.py`,
then commit and push.

## First open — Google sign-in

The RacePlan web app runs **as the person using it** (so each user's athlete
bank is private to their Google account). First open, Google asks each user to
authorize the script — and that consent screen refuses to load inside an iframe.

`index.html` handles this by context:

- **Installed PWA** (`display-mode: standalone`) — an iframe would be a
  third-party context and Chrome won't send the Google login cookies, so the
  app would hit the sign-in wall on every launch. The launch page instead does
  `location.replace('/exec')` immediately: first-party, cookies apply, the app
  opens with no spinner. (Chrome shows a thin origin bar because it's off the
  `github.io` scope — unavoidable with Apps Script.)
- **Browser tab** — keeps the framed, on-brand experience. The app posts
  `raceplan:ready` to `window.top` once it mounts and the overlay hides
  instantly. If it doesn't (not signed in), after ~3.5 s a
  **"פתח את RacePlan"** button opens `/exec` in a tab for the one-time
  **Advanced → Continue** consent.

The service worker serves navigations network-first so the launch page (which
carries this logic) is always fresh; bump `CACHE` in `sw.js` when it changes.

## Install on the phone

**Android / Chrome**: open https://yanivkrispel-cyber.github.io/RacePlan/ →
sign in once (see above) → ⋮ menu → **Install app** (or "Add to Home screen").
Icon + name come from the manifest; it launches standalone.

**iPhone / Safari** (Chrome on iOS can't install PWAs): open the same URL → sign
in once → Share → **Add to Home Screen**. Icon comes from `apple-touch-icon.png`.

## If you redeploy the Apps Script to a NEW deployment id

The stable deployment id doesn't change on `npm run redeploy`, so the URL in
`index.html` keeps working. Only if you run `clasp create-deployment` again:
update the `<iframe src>` in `index.html`, commit, and push.
