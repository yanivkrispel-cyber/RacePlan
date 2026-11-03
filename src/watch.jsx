// watch.jsx — a RacePlan plan as a workout for the runner's watch. Pure: no React, no DOM, no network.
//
// One file, two users: the app (window.WATCHPLAN: the preview, the pace band) and the Cloud Functions
// (functions/watchplan.js is a byte copy, written by build/sync-functions.mjs and checked by
// test/watch.test.mjs), so what the runner previews is exactly what the server sends to Garmin.
//
// The segments are the runner's own (Kris 3.11.2026: "as planned in the app, not different, whatever the
// runner chose, even the same pace"): one watch step per plan segment, never merged (`merge: false`). The
// council's merging into a few long blocks (2 for a 5K up to 7 for a marathon) stays as `merge: true`.
// The council's other safety rules (artifact "תוכנית מרוץ לשעון", 26.10.2026) are the defaults here:
//   1. (merging, off: see above);
//   2. a range, not one number: ±5 s/km, wider on a climb; the first block is "not faster than";
//   3. alert only on "too fast": the slow end of every band is opened far past the pace (+60 s/km),
//      so a slow water-station kilometre never beeps the runner into a surge;
//   4. GPS drift: watches measure long, so every block is lengthened by 0.7 % (settable); the last
//      block is open and ends on the finish (lap / stop), never early;
//   5. a short cue per block ("Climb: hold effort");
//   6. (the night-before checklist lives in the UI / help page).
//
// The Garmin JSON follows the coach app's tested builder (AtheletsPayStats supabase/functions/_shared/
// garmin.ts toGarminWorkout, Training API V2 2.0): pace bands in metres per second, low = the slower end.

(function () {
  const r2 = (x) => Math.round(x * 100) / 100;
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const clampN = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  const DEFAULTS = {
    merge: false,         // false = one step per plan segment (Kris 3.11.2026); true = the council's few blocks
    maxBlocks: null,      // merge only: null = by distance (blocksFor)
    mergeBelowSec: 3,     // neighbours closer than this in pace always merge
    minBlockKm: null,     // null = max(1, total / 20): shorter blocks always merge into a neighbour
    tolSec: 5,            // ± s/km around the block's pace
    climbTolPerPct: 2,    // extra s/km of tolerance per % of average climb grade
    maxTolSec: 15,        // the widest a band's fast side ever gets
    fastOnly: true,       // rule 3: the slow end opened by slowOpenSec
    slowOpenSec: 60,
    firstNotFaster: true, // rule 2: block 1's fast end is the pace itself
    driftPct: 0.7,        // rule 4
    openLast: true,       // the last block ends on lap / stop
    cues: null,           // per-block cues by index: the app sends its own language here (i18n.jsx);
                          // the automatic ones are English, the one script every Garmin model shows
  };

  const MAX_STEPS = 100;       // Garmin Training API: a single-sport workout holds at most 100 steps
  const PROVIDER = 'RacePlan';
  const PACE_MIN = 120, PACE_MAX = 900; // s/km a plan may hold (engine's roundPacesToGoal bounds)

  /** How many blocks a race of `km` gets at most (the council: 3 to 7 in a marathon, 2 to 3 in a 10K). */
  function blocksFor(km) {
    if (!(km > 0)) return 1;
    if (km <= 6) return 2;
    if (km <= 12) return 3;
    if (km <= 25) return 5;
    return 7;
  }

  function eleAt(profile, d) {
    if (!profile || !profile.length) return NaN;
    if (d <= profile[0].d) return profile[0].ele;
    const last = profile[profile.length - 1];
    if (d >= last.d) return last.ele;
    let lo = 0, hi = profile.length - 1;
    while (lo < hi - 1) { const m = (lo + hi) >> 1; if (profile[m].d <= d) lo = m; else hi = m; }
    const a = profile[lo], b = profile[hi];
    const t = b.d - a.d > 0 ? (d - a.d) / (b.d - a.d) : 0;
    return a.ele + t * (b.ele - a.ele);
  }

  /** Gain and loss (m) over [a, b] km of the profile, and the net grade in %. Null without a usable profile. */
  function terrainOf(profile, a, b) {
    if (!Array.isArray(profile) || profile.length < 2 || !profile.some((p) => isFinite(p.ele))) return null;
    const pts = [eleAt(profile, a)];
    for (const p of profile) if (p.d > a && p.d < b && isFinite(p.ele)) pts.push(p.ele);
    pts.push(eleAt(profile, b));
    if (!pts.every(isFinite)) return null;
    let gain = 0, loss = 0;
    for (let i = 1; i < pts.length; i++) { const dz = pts[i] - pts[i - 1]; if (dz > 0) gain += dz; else loss -= dz; }
    const distM = (b - a) * 1000;
    return { gain: Math.round(gain), loss: Math.round(loss), grade: distM > 0 ? ((pts[pts.length - 1] - pts[0]) / distM) * 100 : 0 };
  }

  const kindOf = (ter) => (!ter ? 'flat' : ter.grade >= 1.5 ? 'climb' : ter.grade <= -1.5 ? 'descent' : 'flat');

  /**
   * The plan's segments ([{distance km, paceSec}]) as a few long blocks. Each merge keeps the time: a
   * merged block's pace is its total time over its distance, so the finish time never moves.
   */
  function condense(segments, profile, opts) {
    const o = { ...DEFAULTS, ...(opts || {}) };
    const segs = (segments || []).filter((s) => s && s.distance > 0 && s.paceSec > 0);
    if (!segs.length) return [];
    let at = 0;
    let blocks = segs.map((s) => {
      const b = { a: at, b: at + s.distance, time: s.distance * s.paceSec };
      at += s.distance;
      return b;
    });
    const total = at;
    if (!o.merge) return blocks.map((b, i) => blockOf(b, i, total, profile));
    const max = o.maxBlocks > 0 ? o.maxBlocks : blocksFor(total);
    const minKm = o.minBlockKm > 0 ? o.minBlockKm : Math.max(1, total / 20);
    const paceOf = (b) => b.time / (b.b - b.a);
    const kindAt = (b) => kindOf(terrainOf(profile, b.a, b.b));

    // Each round merges the most alike neighbours: pairs holding a too-short block first (but still
    // the most alike of those, so a run of short segments on a climb joins up before it touches the
    // flat), then by pace difference plus a penalty when the terrain kind changes.
    while (blocks.length > 1) {
      let best = -1, bestTiny = false, bestCost = Infinity;
      for (let i = 0; i < blocks.length - 1; i++) {
        const x = blocks[i], y = blocks[i + 1];
        const tiny = Math.min(x.b - x.a, y.b - y.a) < minKm - 1e-9;
        const cost = Math.abs(paceOf(x) - paceOf(y)) + (kindAt(x) !== kindAt(y) ? 4 : 0);
        if ((tiny && !bestTiny) || (tiny === bestTiny && cost < bestCost)) { best = i; bestTiny = tiny; bestCost = cost; }
      }
      if (!bestTiny && blocks.length <= max && bestCost > o.mergeBelowSec) break;
      const x = blocks[best], y = blocks[best + 1];
      blocks = [...blocks.slice(0, best), { a: x.a, b: y.b, time: x.time + y.time }, ...blocks.slice(best + 2)];
    }

    return blocks.map((b, i) => blockOf(b, i, total, profile));
  }

  function blockOf(b, i, total, profile) {
    const ter = terrainOf(profile, b.a, b.b);
    return {
      index: i, startKm: r2(b.a), endKm: r2(b.b), distance: r2(b.b - b.a), time: b.time,
      paceSec: b.time / (b.b - b.a), kind: kindOf(ter),
      gain: ter ? ter.gain : null, loss: ter ? ter.loss : null, grade: ter ? r2(ter.grade) : null,
      total: r2(total),
    };
  }

  const CUES = {
    en: { first: 'Start: not faster', climb: 'Climb: hold effort', descent: 'Downhill: let go', flat: 'Steady: settle in', last: 'Finish: all in' },
  };

  /** The band, the distance on the watch and the cue for every block. */
  function watchBlocks(blocks, opts) {
    const o = { ...DEFAULTS, ...(opts || {}) };
    const words = CUES.en;
    const n = blocks.length;
    return blocks.map((b, i) => {
      const extra = b.kind === 'climb' ? Math.max(0, b.grade || 0) * o.climbTolPerPct : b.kind === 'descent' ? 3 : 0;
      const tol = Math.min(o.maxTolSec, o.tolSec + extra);
      const pace = b.paceSec;
      const fast = i === 0 && o.firstNotFaster ? pace : pace - tol;
      const slow = o.fastOnly ? pace + o.slowOpenSec : pace + tol;
      const auto = i === 0 && n > 1 ? words.first : i === n - 1 && n > 1 ? words.last : words[b.kind] || words.flat;
      const own = o.cues && typeof o.cues[i] === 'string' && o.cues[i].trim() ? o.cues[i].trim() : null;
      return {
        ...b,
        fastSec: Math.round(fast), slowSec: Math.round(slow), tolSec: r2(tol),
        watchMeters: Math.round(b.distance * 1000 * (1 + o.driftPct / 100)),
        open: o.openLast && i === n - 1 && n > 0,
        cue: (own || auto).slice(0, 24),
      };
    });
  }

  /** Clock times (s) every `stepKm` along the plan's own segments, and at the finish — the pace band. */
  function splits(segments, stepKm) {
    const step = stepKm > 0 ? stepKm : 5;
    const segs = (segments || []).filter((s) => s && s.distance > 0 && s.paceSec > 0);
    const out = [];
    let at = 0, clock = 0, next = step;
    for (const s of segs) {
      const end = at + s.distance;
      while (next < end - 1e-9) {
        out.push({ km: r2(next), sec: Math.round(clock + (next - at) * s.paceSec) });
        next += step;
      }
      clock += s.distance * s.paceSec;
      at = end;
    }
    if (segs.length) out.push({ km: r2(at), sec: Math.round(clock), finish: true });
    return out;
  }

  /** The first `km` of the plan, for a rehearsal long run 2 to 3 weeks out. */
  function rehearsalOf(segments, km) {
    const out = [];
    let left = km;
    for (const s of segments || []) {
      if (!(left > 0.0049)) break;
      const d = r2(Math.min(s.distance, left));
      if (d > 0) out.push({ ...s, distance: d });
      left = r2(left - d);
    }
    return out;
  }

  const fmt = (sec) => { const s = Math.round(sec); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const clock = (sec) => {
    const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
  };

  /**
   * The whole plan as a Garmin Training API workout: { workout, blocks, problems, notes }. A plan with
   * problems is never sent (as the coach app's builder: a wrong session on a watch is worse than none).
   *   plan = { name, date 'YYYY-MM-DD', segments: [{distance, paceSec}], profile?: [{d, ele}], opts? }
   */
  function toGarminWorkout(plan, opts) {
    const p = plan || {};
    const o = { ...DEFAULTS, ...(p.opts || {}), ...(opts || {}) };
    const problems = [], notes = [];
    if (p.date != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(p.date))) problems.push('date is not YYYY-MM-DD');
    const segs = Array.isArray(p.segments) ? p.segments : [];
    if (!segs.length) problems.push('no segments');
    segs.forEach((s, i) => {
      if (!(s && s.distance > 0 && s.distance < 300)) problems.push(`segments[${i}]: bad distance`);
      if (!(s && s.paceSec >= PACE_MIN && s.paceSec <= PACE_MAX)) problems.push(`segments[${i}]: pace out of ${PACE_MIN}..${PACE_MAX} s/km`);
    });
    if (o.driftPct < 0 || o.driftPct > 3) problems.push('driftPct must be 0..3');
    if (problems.length) return { workout: null, blocks: [], problems, notes };

    const blocks = watchBlocks(condense(segs, p.profile, o), o);
    if (blocks.length > MAX_STEPS) problems.push(`${blocks.length} steps, Garmin takes at most ${MAX_STEPS}`);
    if (o.fastOnly) notes.push(`slow end opened by ${o.slowOpenSec} s/km: only "too fast" alerts`);
    if (o.driftPct > 0) notes.push(`blocks lengthened by ${o.driftPct}% for GPS drift`);

    const steps = blocks.map((b, i) => ({
      type: 'WorkoutStep',
      stepOrder: i + 1,
      intensity: 'ACTIVE',
      description: b.cue || null,
      durationType: b.open ? 'OPEN' : 'DISTANCE',
      durationValue: b.open ? null : b.watchMeters,
      durationValueType: b.open ? null : 'METER',
      targetType: 'PACE',
      // metres per second; the low value is the slower speed
      targetValueLow: r3(1000 / clampN(b.slowSec, 60, 1800)),
      targetValueHigh: r3(1000 / clampN(b.fastSec, 60, 1800)),
      targetValueType: null,
    }));
    const total = blocks.reduce((t, b) => t + b.time, 0);
    const name = String(p.name || '').trim().slice(0, 80) || 'RacePlan';
    const description = [
      `Goal ${clock(total)}`,
      blocks.map((b) => `${b.startKm}-${b.endKm} km ${fmt(b.paceSec)}`).join(' | '),
      'RacePlan · raceplan.coachkrispel.com',
    ].join('\n').slice(0, 500);
    if (problems.length) return { workout: null, blocks, problems, notes };
    return {
      workout: {
        workoutName: name, description, sport: 'RUNNING',
        workoutProvider: PROVIDER, workoutSourceId: PROVIDER, isSessionTransitionEnabled: false,
        segments: [{ segmentOrder: 1, sport: 'RUNNING', steps }],
      },
      blocks, problems, notes,
    };
  }

  const API = { DEFAULTS, MAX_STEPS, PROVIDER, blocksFor, terrainOf, condense, watchBlocks, splits, rehearsalOf, toGarminWorkout, formatPace: fmt, formatClock: clock };
  if (typeof window !== 'undefined') window.WATCHPLAN = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
