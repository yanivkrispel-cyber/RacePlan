# RacePlan as a Google Apps Script web app

The React app (`RacePlan.html` + `src/*.jsx`) still runs as-is on plain static
hosting. This adds a second target: a Google Apps Script web app with a public
URL and server-side storage for the athlete bank.

**Live URL:**
`https://script.google.com/macros/s/AKfycbymEZ1ClOZdly4acorn5lPrCHGXCD2ExjKGqa9q0SxuDD8aavnbektYa24ecM3MCUCffg/exec`

## Layout

| Path | Role |
|---|---|
| `build/build.mjs` | Transpiles `src/*.jsx` with `@babel/preset-react`, wraps each file in its own IIFE (they were separate `<script>` tags), inlines `image-slot.js` + a 256 px data-URI of `logo.png`. Writes the combined script to **`apps-script/AppJs.gs`** as `var RP_APP_JS = "…"`, and the small HTML shell to `apps-script/index.html`. |
| `build/index.template.html` | HTML shell: RTL `<html>`, Google Fonts + Leaflet from CDN, React UMD from CDN, two server-injected globals, and `<script src="…/exec?js=1">`. |
| `build/redeploy.mjs` | build → `clasp push` → new version → repoint the stable `/exec` URL. |
| `apps-script/Code.gs` | `doGet`: `?js=1` returns `RP_APP_JS` via **ContentService** (no sanitization); otherwise serves the templated shell, injecting `__RACEPLAN_SHARE__` (from `?s=`), `__RACEPLAN_EXEC_URL__`, and the `?js=1` URL. `rp_loadAthletes()` / `rp_saveAthletes(json)` store the calling user's athlete-bank JSON in **their own** `PropertiesService.getUserProperties()` (chunked at 8 KB — the per-value limit). |
| `apps-script/AppJs.gs` | Generated — the whole client script as a string constant. |
| `apps-script/index.html` | Generated — ~1.6 KB shell. |
| `apps-script/appsscript.json` | Web-app manifest — **`executeAs: USER_ACCESSING`**, `access: ANYONE` (= "anyone with a Google account"). |
| `.clasp.json` | `scriptId` + `rootDir: apps-script`. |

## Multi-user model

The web app is deployed **execute-as: the user accessing it**. So every visitor
runs the script as themselves:

- `PropertiesService.getUserProperties()` is automatically scoped to that
  visitor → a private athlete bank per Google account, synced across their
  devices, invisible to the owner and to other users.
- No shared spreadsheet, no server-side identity plumbing, no anonymous keys.
- Server quotas (script runtime, Properties ops) are spent on each visitor's
  own account, not the owner's.
- **Cost:** each user authorizes the script once — the Google "unverified app"
  consent screen (**Advanced → Continue**). It's unverified because the Cloud
  project isn't through Google's OAuth review (not worth it for a small
  audience). The only permission requested is running the script itself; no
  Drive/Sheets/email scopes (the code touches none).

The `?s=` share links are stateless (the plan is base64 in the URL) — they work
for anyone regardless of sign-in.

### First open inside the PWA wrapper

Google's consent screen sends `X-Frame-Options` and will **not** render inside
the `docs/` iframe. `docs/index.html` therefore shows a top-level **"התחברות עם
Google"** link (and a persistent "open in a tab" pill) when the app frame
doesn't come up within a few seconds — the user authorizes in a real tab once,
then the home-screen icon works normally.

## Why the client script is served separately

HtmlService sanitizes every page it serves — **including the contents of inline
`<script>` string literals** — and silently strips tag-like substrings
(`<style>…</style>`, `<img>`, `<svg>`, …). `image-slot.js` builds its shadow DOM
from exactly such strings, so ~11 KB vanished from the middle of the bundle and
it no longer parsed (`Uncaught SyntaxError` in `userCodeAppPanel`). ContentService
does **not** sanitize, so the script is served through `doGet(?js=1)` with
`MimeType.JAVASCRIPT` and loaded with `<script src>`. The tiny inline
`__RACEPLAN_SHARE__` / `__RACEPLAN_EXEC_URL__` block is fine inline — no tags.

## Source changes (backward-compatible — static hosting still works)

- `src/planner-b.jsx` — share payload read from `window.__RACEPLAN_SHARE__` first
  (falls back to `#s=` hash); share links built from the injected `/exec` URL as
  `?s=`; `history.replaceState` wrapped in `try/catch` (throws in the sandbox);
  logo `src` uses `window.__RACEPLAN_LOGO__` when present.
- `src/athletes.jsx` — `AthleteDB` keeps its synchronous localStorage API; when
  `google.script.run` exists, localStorage becomes an offline mirror and the DB
  is pulled once (`rp_loadAthletes()`) and pushed debounced (`rp_saveAthletes(json)`)
  to the visitor's own UserProperties. All bridge calls are queued until after
  `window` load — calling `google.script.run` mid-parse makes it `document.write`
  an auth panel into a closed document and throw.

## Deploy / iterate

```
npm install                  # once — @babel/core, @babel/preset-react
npm run build                # regenerate apps-script/{index.html, AppJs.gs}
npm run push                 # build + clasp push (updates code, not the /exec URL)
npm run redeploy -- "note"   # build + push + version + repoint the /exec URL
```

Every user (owner included) authorizes **once** on first open — the unverified-app
consent screen, **Advanced → Continue**. It grants nothing beyond running the
script.

Changing `executeAs` between deployments does not change the `/exec` URL — the
stable deployment is repointed in place by `npm run redeploy`.

## Storage notes

- Athlete bank: the calling user's `PropertiesService.getUserProperties()`,
  chunked at 8 KB across keys `rp_ab_0..k` with `rp_ab_n` = count. Private per
  Google account, synced across that user's devices. Per-user quota ≈ 500 KB
  (`rp_saveAthletes` refuses payloads over ~460 KB — plenty unless someone
  stores dozens of GPX-course plans).
- The current working plan (`rp-plan-v1`), race name/date/time stay in
  `localStorage` on every target — only the athlete bank syncs to the server.
- Migration note: the pre-multi-user build kept data in a shared spreadsheet
  keyed by `e:<email>` / `k:<anonKey>`. That data is not read any more; the
  owner's bank survives via its `localStorage` mirror and re-lands in
  UserProperties on the next change. The old auto-created "RacePlan — athlete
  data" sheet in the owner's Drive can be deleted.

## Design system

Reskinned per `DESIGN_TOKENS.md`, dark adaptation (navy surfaces, gold accent,
cream text — not the literal light theme). Tokens are CSS custom properties on
`:root` in the injected `#rp-tokens` stylesheet (`src/shared.jsx`): palette,
spacing scale, radii, shadows, fonts (`--rp-font-display` Frank Ruhl Libre,
`--rp-font-ui` Heebo, `--rp-font-accent` Cormorant Garamond), motion, focus.
Pace zones: fast `#C15A2E` (danger) / target `#C9A24B` (gold) / easy `#8091BE`
(navy-muted) — no traffic-light red/green.

Responsive breakpoints are **`@container` queries** on `.rp-cq` (which has
`container-type: inline-size`), so the layout adapts to the app's own width —
including inside the Apps Script iframe — not just the viewport. Phones get:
3-line segment cards, a sticky horizontal-scroll action bar (`position: sticky`,
never `fixed` — `container-type` re-anchors fixed descendants to the container),
2-column compact stat cards, hidden wordmark, ≥40px touch targets.
`AthletePanel` and `CopyToast` are portaled to `<body>` for the same reason, and
their sheet styles use `@media` (viewport).

## Known minor item

Inside the Apps Script iframe, "שיתוף" copies the link via `navigator.clipboard`;
if the browser blocks that it falls back to a `prompt()` dialog. The link itself
(`?s=` decode) is verified working.
