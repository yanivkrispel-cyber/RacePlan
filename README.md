# RacePlan

מתכנן קצב לריצה (RTL, Hebrew) — React 18 UMD + Babel standalone, no bundler.
Built for Coach Krispel: pace-per-segment planning, GPX course import with an
elevation-aware pace chart and route map, a per-athlete plan bank, and
shareable links.

Three ways to run it:

| Target | What it is | Where |
|---|---|---|
| **Static hosting** | The original app — plain HTML + `src/*.jsx`, transpiled in-browser | `RacePlan.html` |
| **Google Apps Script web app** | Same app, packaged as a single-file Apps Script project with server-side athlete-bank storage (Google Sheet) | `apps-script/`, see [`APPS_SCRIPT.md`](APPS_SCRIPT.md) |
| **Home-screen PWA wrapper** | A tiny static site that iframes the Apps Script web app with a real icon/manifest, so "Add to Home Screen" gives a proper app icon | `docs/`, see [`docs/README.md`](docs/README.md) — published via GitHub Pages at https://yanivkrispel-cyber.github.io/RacePlan/ |

## Design

Visual design follows [`DESIGN_TOKENS.md`](DESIGN_TOKENS.md) (dark adaptation:
navy surfaces, gold accent, cream text — see the file for the full palette,
type, spacing and motion rules). Source of the token sheet: `Design System
Sheet.dc.html`.

## Develop

```
npm install                  # once — @babel/core, @babel/preset-react
npm test                     # pure-function tests (engine.jsx, gpx.jsx)
```

Static target: just open `RacePlan.html` through any local static server
(no build step — it transpiles JSX in the browser).

Apps Script target:

```
npm run build                 # regenerate apps-script/{index.html, AppJs.gs}
npm run push                  # build + clasp push (code only, not the live URL)
npm run redeploy -- "note"    # build + push + version + repoint the live /exec URL
```

See [`APPS_SCRIPT.md`](APPS_SCRIPT.md) for the full architecture (why the
client script is served via ContentService instead of inlined, the Sheet-backed
athlete sync, deploy/auth notes).

## Project layout

```
src/*.jsx           React source (shared by every target)
image-slot.js        <image-slot> web component (logo drag-drop, editor-only)
RacePlan.html         static-hosting entry point
build/                 build scripts (Apps Script bundle, PWA icons)
apps-script/            Code.gs + manifest (AppJs.gs/index.html are generated)
docs/                    PWA wrapper, published via GitHub Pages
test/                     pure-function tests
```
