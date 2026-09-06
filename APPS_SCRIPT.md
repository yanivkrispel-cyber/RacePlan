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
| `apps-script/Code.gs` | `doGet`: `?js=1` returns `RP_APP_JS` via **ContentService** (no sanitization); otherwise serves the templated shell, injecting `__RACEPLAN_SHARE__` (from `?s=`), `__RACEPLAN_EXEC_URL__`, `__RACEPLAN_USER__` ({email, tier}) and `__RACEPLAN_LOGGER__`. `rp_loadAthletes()` / `rp_saveAthletes(json)` — **owner only** (server-checked) — store the owner's athlete-bank JSON in their `PropertiesService.getUserProperties()`, chunked at 8 KB. |
| `apps-script/AppJs.gs` | Generated — the whole client script as a string constant. |
| `apps-script/index.html` | Generated — ~1.8 KB shell. |
| `apps-script/appsscript.json` | Manifest — **`executeAs: USER_ACCESSING`**, `access: ANYONE` (= "anyone with a Google account"), `oauthScopes: [userinfo.email]`. |
| `logger/` | **Separate** tiny Apps Script (own `.clasp.json`, scriptId `1dIk473c21O…`). `executeAs: USER_DEPLOYING` (runs as owner), `access: ANYONE_ANONYMOUS`. `doPost({email,token})` upserts a row into a **"RacePlan — users" sheet in the owner's Drive** (email · firstSeen · lastSeen · count). |
| `.clasp.json` | frontend `scriptId` + `rootDir: apps-script`. `logger/.clasp.json` for the logger. |

## Roles & usage log

The web app runs **as the visitor** (`executeAs: USER_ACCESSING`), and asks each
one to sign in (`access: ANYONE` + `oauthScopes: [userinfo.email]`), so
`Session.getActiveUser().getEmail()` gives their address.

- **owner** — email equals `RP_OWNER_EMAIL` (Script Property; default
  `yaniv.krispel@gmail.com`). Full app incl. the athlete bank, stored privately
  in the owner's UserProperties.
- **free** — everyone else. Personal race planning only (segments, pace, GPX,
  chart, map, share, print). The athlete-bank UI is hidden (`RP_IS_OWNER` in
  `planner-b.jsx`) **and** `rp_saveAthletes`/`rp_loadAthletes` refuse non-owners
  server-side.
- Plain static hosting (`RacePlan.html`) has no injected user → treated as
  owner (full) for local/dev.

**Usage log:** on load the client fires one fire-and-forget
`fetch(loggerUrl, {mode:'no-cors', body:{email, token}})` per browser per day.
The `logger/` web app (execute-as owner) writes it into the owner's
"RacePlan — users" sheet. The shared `token` (`DEFAULT_LOG_TOKEN` in both
`Code.gs` files; override via `RP_LOG_TOKEN` Script Property on both) only
deters drive-by bots — it's visible in the page source.

**Future paid tier:** add a `pro` check (email in a Script-Property list, or a
real registry) alongside the `owner` check — `tier` already flows to the client.

### One-time authorizations

1. **Owner, frontend** — the `userinfo.email` scope was added after the first
   deploy, and Apps Script does **not** re-prompt an already-authorized user; it
   just throws at runtime (→ owner silently sees the free view). Fix once:
   myaccount.google.com/permissions → remove "RacePlan" → reopen the link and
   approve (now includes "See your email address"). New users get the full
   consent on first visit automatically.
2. **Owner, logger** — open the logger `/exec` URL once and approve its Sheets +
   Drive scopes (it's a separate project). This creates the "RacePlan — users"
   sheet. Until then, usage-log POSTs silently no-op.

The `?s=` share links are stateless (plan is base64 in the URL) — they work for
anyone regardless of sign-in or role.

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
npm run push                 # build + clasp push (frontend code, not the /exec URL)
npm run redeploy -- "note"   # build + push + version + repoint the frontend /exec URL
```

The `logger/` project is its own clasp target and rarely changes:

```
cd logger && clasp push --force && clasp create-version "note" \
  && clasp redeploy <logger-deployment-id> -V <n> -d "note"
```

Changing `executeAs` between deployments does not change the `/exec` URL — the
stable deployment is repointed in place.

## Storage notes

- Athlete bank (**owner only**): the owner's
  `PropertiesService.getUserProperties()`, chunked at 8 KB across keys
  `rp_ab_0..k` with `rp_ab_n` = count. Per-user quota ≈ 500 KB
  (`rp_saveAthletes` refuses payloads over ~460 KB).
- The current working plan (`rp-plan-v1`), race name/date/time stay in
  `localStorage` on every target and for every role.
- Usage log: "RacePlan — users" sheet in the owner's Drive (created by the
  `logger/` project on its first successful POST). One row per email.
- No migration from earlier builds — data was intentionally reset.

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
