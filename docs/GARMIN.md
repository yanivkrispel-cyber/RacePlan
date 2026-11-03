# Send to watch (Garmin), switching it on

Built on branch `feat/watch-plan`. It stays OFF (`functions/.env` has `GARMIN_ENABLED=false`) until the steps
below are done. While it's off, a functions deploy is the same as before and never asks for Garmin secrets.

## What is built and tested
- `src/watch.jsx`: the plan → a few long blocks (2 for a 5K, 3 up to 12 km, 5 for a half, 7 for a marathon), with
  ranges, "too fast" alerts only, +0.7 % for GPS drift, an open last block, short cues, a pace band (`splits`),
  and a rehearsal run (`rehearsalOf`). It also builds the Garmin Training API JSON. `functions/watchplan.js` is a
  byte copy (`build/sync-functions.mjs`).
- `functions/garmin-core.js`, `functions/garmin.js`: OAuth2 PKCE, token refresh with rotation, send = create the
  workout + schedule it on race day (sending again replaces the earlier one), the rehearsal, disconnect (removes
  the workouts still ahead, deregisters), Garmin's deregistration and permission pushes, 20 sends a day per user.
- `functions/garmin-functions.js`: callables `garminConnect`, `garminStatus`, `garminPreview`, `garminSend`,
  `garminDisconnect`; HTTP `garminCallback` and `garminPush`.
- `firestore.rules`: a user can read only `garminLinks/{own uid}` and its `sent/`. Tokens and OAuth states are
  server-only.
- Tests: `test/watch.test.mjs`, `test/garmin.test.mjs` (the whole flow against a fake Firestore and a fake Garmin).
  Not yet run against the real Garmin.

## Status (3.11.2026)
- A second app under the CoachKrispel company is refused: "Basic-tier company can create only one app".
- So RacePlan applied as its own company: Starter access request form
  (`https://www.garmin.com/en-US/forms/StarterGarminConnectDeveloperAccess/`) sent 3.11.2026 as
  "RacePlan (CoachKrispel)", email `raceplan@coachkrispel.com` (a Zoho alias of yaniv.krispel@, so Garmin's
  mail lands in the normal inbox), Training API only, 100 to 1000 users. Waiting for Garmin's reply.
- 3.11.2026: the company was approved (account raceplan@coachkrispel.com), and the app "RacePlan" was
  added in it (Training API, redirect /api/garmin/callback). App status: Pending, waiting for Garmin.
- Starter tier: up to 1,000 connected users per company, Training and Courses API included.
- When the new account opens, the add-app form limits: description at most 450 characters, the data-use
  field at most 300.

## Steps only Kris can do
1. developerportal.garmin.com: register a SECOND app, "RacePlan", **Training API only** (WORKOUT_IMPORT). Do not
   reuse the coach app's keys: one notification URL per app, and that approval covers up to 100 coached athletes.
2. In the portal, check the user limit of the free tier, and the paid tier from April 2027, before opening it to
   everyone.
3. Redirect URI: `https://raceplan.coachkrispel.com/api/garmin/callback`.
   Push URLs (deregistrations, user permissions): `https://raceplan.coachkrispel.com/api/garmin/push?k=<WEBHOOK_KEY>`.
4. Secrets (any long random string for the webhook key):
   ```
   firebase functions:secrets:set GARMIN_CLIENT_ID
   firebase functions:secrets:set GARMIN_CLIENT_SECRET
   firebase functions:secrets:set GARMIN_WEBHOOK_KEY
   ```

## Then (Claude)
5. `GARMIN_ENABLED=true` in `functions/.env`, then `npm run deploy:functions`.
6. Add the hosting rewrites, only after the functions exist:
   `{ "source": "/api/garmin/callback", "function": "garminCallback" }`,
   `{ "source": "/api/garmin/push", "function": "garminPush" }` (before the `**` rewrite).
7. The app screen: preview, connect, send, rehearsal, pace band, the night-before checklist, a privacy page section.
8. First real send on Kris's watch. Check: the bands, that a slow block does not beep, OPEN on the last step, the
   +0.7 % drift, how the cue text looks on the watch (Hebrew too).

## Switch-on (3.11.2026: the RacePlan app is Approved)
Built: the closed list (`functions/.env` GARMIN_ALLOW, the owner first), `RP_FIREBASE.garminCall`, the Garmin
section in the card (connect, send on race day, rehearsal, disconnect), and the `/api/garmin/*` rewrites in
firebase.json. `GARMIN_ENABLED=true`. In order (Kris runs them; the order matters: the rewrites need the functions):
1. Garmin portal, app RacePlan: Show key, for the Client ID and the Client Secret.
2. `firebase functions:secrets:set GARMIN_CLIENT_ID`, `... GARMIN_CLIENT_SECRET`, `... GARMIN_WEBHOOK_KEY` (a long random string).
3. `firebase deploy --only functions,firestore:rules`
4. `npm run deploy:hosting`
5. API Configuration Tool (apis.garmin.com/tools): deregistration + user permissions push to
   `https://raceplan.coachkrispel.com/api/garmin/push?k=<GARMIN_WEBHOOK_KEY>`.
6. First send on Kris's watch.

## Done (3.11.2026, evening)
- Kris's Garmin connected; the first race-day workout reached his Garmin calendar.
- Push endpoints (apis.garmin.com/tools, Endpoint Configuration): Deregistrations and User Permissions Change,
  enabled, to `https://us-central1-raceplan-17e5b.cloudfunctions.net/garminPush/<GARMIN_WEBHOOK_KEY>`. Garmin's form
  drops a `?k=` query on save, so the key is the last path segment (b88a55e). Without or with a wrong key: 401 (tested).
- Fixed on the way: a doubled GARMIN_CLIENT_ID (now refused unless a UUID); the service worker served the app shell
  at /api/garmin/callback (988bdf3: /api/ is never the worker's). That sw.js fix needs a hosting deploy.
- Open: a run with the workout on the watch (all segments, only too-fast alerts, the last step ends at the finish).
