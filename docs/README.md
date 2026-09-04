# RacePlan — home-screen wrapper (PWA)

Why this exists: an Apps Script `/exec` page is served inside a Google-controlled
top-level document on `script.google.com`. You can't set a custom favicon /
`apple-touch-icon` / web-app manifest on it, so "Add to Home screen" of the raw
`/exec` URL only ever gets a generic letter tile and opens in a browser tab.

This folder is a tiny static site that:
- carries a real `manifest.webmanifest` + icons (from `appLogo.jpg`)
- full-screen `<iframe>`s the RacePlan `/exec` URL
- registers a service worker so Chrome offers **Install** and the shell works offline

Installed from *this* page, the home-screen entry gets the RPK icon, the name
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
| `appLogo.jpg` | icon source (1024×1024 RPK badge) |

Regenerate icons after replacing `appLogo.jpg`: `python build/pwa-icons.py`,
then commit and push.

## Install on the phone

**Android / Chrome**: open https://yanivkrispel-cyber.github.io/RacePlan/ → ⋮ menu → **Install app** (or "Add to Home screen"). Icon + name come from the manifest; it launches standalone.

**iPhone / Safari** (Chrome on iOS can't install PWAs): open the same URL → Share → **Add to Home Screen**. Icon comes from `apple-touch-icon.png`.

## If you redeploy the Apps Script to a NEW deployment id

The stable deployment id doesn't change on `npm run redeploy`, so the URL in
`index.html` keeps working. Only if you run `clasp create-deployment` again:
update the `<iframe src>` in `index.html`, commit, and push.
