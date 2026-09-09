# Heat/humidity pace adjustment

RACE PLAN can estimate how much a race's expected temperature and humidity
will slow down a target pace, and offers to rescale the plan's goal time to
match. It's an advisory, not an automatic override — nothing changes until
the user taps "Adjust pace for conditions".

## Source & attribution

The math and lookup tables are ported from
[johnjdavisiv/heat-adjusted-pace](https://github.com/johnjdavisiv/heat-adjusted-pace)
(MIT License, Copyright (c) 2025 John Davis, Running Writings), model version
`v2025-09-04`. It's a statistical model (GAM) fitted to 3,891 real marathon
performances (Mantzios et al. 2022), not a rule-of-thumb formula — see the
[original write-up](https://runningwritings.com/2025/04/heat-humidity-marathon-times.html)
for the full methodology.

**Key caveats carried over from the source model** (surfaced to the user via
`heat.disclaimer` / the extreme-condition warnings):
- Calibrated for **continuous, marathon-like effort**. Rest breaks (intervals)
  let heat dissipate, so it over-predicts the slowdown for broken workouts.
- Tends to be **optimistic** for non-heat-acclimated recreational runners
  (the "podium spot" sampling method in the source data skews toward runners
  who tolerate heat well).
- No adjustment in the ~2–13°C band; humidity barely matters below ~18°C.
- Out-of-distribution guard rails: flags extreme heat (≥32°C), freezing
  (≤0°C), and very low humidity (≤25%) as outside the range the model was
  actually tested on.

## Moving parts

| File | Role |
|------|------|
| `src/heat-tables.jsx` | `window.RP_HEAT_FINE_TABLE` / `window.RP_HEAT_INDEX_TABLE` — the lookup grids, copied verbatim from the source repo's published JSON. |
| `src/heat.jsx` | `window.RP_HEAT` — bilinear interpolation over the grid, `adjustedPaceSec()` / `paceDeltaSec()` (effort mode: ideal pace → actual pace in the heat), `warnings()`. |
| `src/planner-b.jsx` | Weather fetch (Open-Meteo) + `HeatAdvisoryCard` UI + `applyHeatAdjustment()`. |
| `test/heat.test.mjs` | Assertions ported from the source repo's own `test-engine.cjs`. |

Load order (`build/build.mjs` `JSX_FILES`): `units.jsx` → `heat-tables.jsx` →
`heat.jsx` → everything else (before `planner-b.jsx`, which reads
`window.RP_HEAT`).

## Weather source

No API key, no backend — plain `fetch()` calls to
[Open-Meteo](https://open-meteo.com/) from the browser:

- **Race ≤ 15 days out**: `api.open-meteo.com/v1/forecast` (hourly forecast
  for the race's date + start hour). `weather.source = 'forecast'`.
- **Race further out**: `archive-api.open-meteo.com/v1/archive`, averaging
  the same calendar date over the last 3 years at that location — a rough
  "typical conditions" estimate, clearly labelled as historical (not a live
  forecast) in the UI (`weather.historicalNote`). `weather.source =
  'historical-avg'`.

Location comes from `course.lat`/`course.lon` — already populated for both
GPX imports (`parseGpx`'s `startLat`/`startLon`) and route-library races
(`courseFromRace`), so no new user input is required.

## The effort-mode calculation

`RP_HEAT.paceDeltaSec(idealPaceSecPerKm, tempC, humidityPct)` treats the
plan's current average pace as the *ideal-conditions* target, and returns how
many seconds/km slower the same effort would run at the given conditions
(model math: it operates on log-speed, so the transform is multiplicative,
not additive).

**Important:** that baseline is frozen in React state
(`heatBaselinePace`) the moment a fresh weather reading arrives — not
recomputed from the plan's live average pace on every render. Otherwise,
after the user applies the suggestion, the plan's average pace already
includes the heat penalty, and re-running the same transform on it would
double-count the slowdown on the next render. The card also hides itself
(`heatApplied`) once used, until the next new weather reading (new
course/date/time) re-arms it.

Applying the suggestion computes an adjusted total goal time and reuses the
existing `scalePlanToGoal()` helper (same mechanism as the goal-time editor)
to rescale every segment's pace — it does not touch `buildPlanSegments`'
grade-adjustment or strategy logic at all; heat is purely an adjustment to
the goal time fed into that existing pipeline.

## Updating the model

If the upstream repo ships a new table version, regenerate
`src/heat-tables.jsx` from the new `heat_humidity_adjustments_fine_*.json` /
`heat_index_adjustments_*.json` files (see the inline comment at the top of
that file for the exact shape expected), then re-run `npm test` — the
optimum-point and monotonicity assertions in `test/heat.test.mjs` will catch
a malformed table.
