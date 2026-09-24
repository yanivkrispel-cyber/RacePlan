// engine.jsx — shared race-pacing model + useRacePlan hook + formatters.
// Exported to window so each variation script (own Babel scope) can read it.
// No UI here — pure logic so all four skins share one source of truth.

// ── time / pace formatting ─────────────────────────────────────────────
const pad2 = (n) => String(n).padStart(2, '0');

function formatPace(sec) {
  if (!isFinite(sec) || sec <= 0) return '0:00';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
}

function formatClock(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(r)}` : `${m}:${pad2(r)}`;
}

function parsePace(str) {
  if (typeof str === 'number') return str;
  const m = String(str).trim().match(/^(\d+):(\d{1,2})$/);
  if (!m) return NaN;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// "H:MM:SS" → seconds; "MM:SS" → seconds; "MM" → minutes. Inverse of formatClock
// for the 3-part form. Returns NaN on garbage.
function parseClock(str) {
  if (typeof str === 'number') return str;
  const p = String(str).trim().split(':').map((x) => parseInt(x, 10));
  if (!p.length || p.some((n) => !isFinite(n) || n < 0)) return NaN;
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return p[0] * 60 + p[1];
  return p[0] * 60;
}

const formatKm = (n) => Number(n).toFixed(2);
const round2 = (n) => Math.round(n * 100) / 100;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

let _uid = 0;
const uid = () => `s${++_uid}`;

// ── localStorage persistence ───────────────────────────────────────────
const LS_PLAN = 'rp-plan-v1';
const LS_RACE = 'rp-race';
const LS_TRAINER = 'rp-trainer';

function _loadPlan() {
  try {
    const raw = localStorage.getItem(LS_PLAN);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!Array.isArray(data.s) || !data.s.length) return null;
    return {
      segments: data.s.map(([d, p]) => ({
        id: uid(),
        distance: clamp(round2(+d || 1), 0.05, 99),
        paceSec: clamp(Math.round(+p || 300), 120, 900),
      })),
      preset: data.p ?? null,
      course: data.c ?? null,
    };
  } catch { return null; }
}

function _savePlan(segments, activePreset, course) {
  try {
    localStorage.setItem(LS_PLAN, JSON.stringify({
      s: segments.map(s => [round2(s.distance), s.paceSec]),
      p: activePreset,
      c: course || null,
    }));
  } catch {}
}

function clearSavedPlan() {
  try { localStorage.removeItem(LS_PLAN); } catch {}
}

// ── distance presets (km) ──────────────────────────────────────────────
// `nameKey` is an i18n key; the on-chip numeric label is derived from `km` by
// the UI (via window.UNITS) so it follows the metric/imperial setting.
const PRESETS = [
  { km: 42.2, nameKey: 'preset.marathon' },
  { km: 21.1, nameKey: 'preset.half' },
  { km: 15,   nameKey: null },
  { km: 10,   nameKey: null },
  { km: 5,    nameKey: null },
];

function defaultSegments() {
  return [
    { id: uid(), distance: 1.00, paceSec: 305 },
    { id: uid(), distance: 2.00, paceSec: 302 },
    { id: uid(), distance: 2.05, paceSec: 300 },
    { id: uid(), distance: 2.00, paceSec: 295 },
    { id: uid(), distance: 2.00, paceSec: 290 },
    { id: uid(), distance: 1.05, paceSec: 285 },
  ];
}

function generatePlan(totalKm) {
  const base = 300;
  const block = totalKm <= 6 ? 1 : totalKm <= 16 ? 2 : totalKm <= 22 ? 3 : 5;
  const segs = [];
  let remaining = totalKm;
  const opener = Math.min(1, totalKm);
  segs.push({ d: opener, p: base + 8 });
  remaining = round2(remaining - opener);
  let i = 0;
  while (remaining > 0.001) {
    const d = round2(Math.min(block, remaining));
    remaining = round2(remaining - d);
    segs.push({ d, p: base + 4 - i * 3 });
    i++;
  }
  return segs.map((s) => ({ id: uid(), distance: round2(s.d), paceSec: clamp(Math.round(s.p), 165, 540) }));
}

// ── locking the plan's total distance to the loaded course ─────────────
// When a route is loaded its distance comes from the file and shouldn't drift
// as the runner reshapes the plan. The rule: the LAST segment is the remainder
// (target − everything above it), so editing any other segment moves distance
// between it and the tail instead of changing the race. Paces are left alone —
// only kilometres move, so the finish time shifts a little on its own.
const MIN_SEG = 0.05;

// Re-derive the tail so Σ distances === target. A no-op without a target, or
// when the head has already eaten the whole course (the callers clamp so that
// can't happen, but a restored plan might arrive that way). A lone segment IS
// the course, so it takes the target outright.
function settleRemainder(list, target) {
  if (!(target > 0) || !Array.isArray(list) || !list.length) return list;
  if (list.length === 1) {
    return list[0].distance === target ? list : [{ ...list[0], distance: target }];
  }
  const lastIdx = list.length - 1;
  let head = 0;
  for (let i = 0; i < lastIdx; i++) head += list[i].distance;
  const rest = round2(target - round2(head));
  if (!(rest >= MIN_SEG)) return list;
  if (list[lastIdx].distance === rest) return list;
  return list.map((s, i) => (i === lastIdx ? { ...s, distance: rest } : s));
}

// Biggest distance segment `idx` may take while the lock holds: the target less
// what the other head segments already claim, less the remainder's minimum.
function lockedCeiling(list, idx, target) {
  const lastIdx = list.length - 1;
  let others = 0;
  for (let i = 0; i < lastIdx; i++) if (i !== idx) others += list[i].distance;
  return round2(target - round2(others) - MIN_SEG);
}

// The ceiling as the UI needs it: 0 when there's no lock, or when `id` is the
// remainder row (which isn't editable at all).
function lockedSegmentMax(list, id, target) {
  if (!(target > 0) || !Array.isArray(list) || list.length < 2) return 0;
  const idx = list.findIndex((s) => s.id === id);
  if (idx < 0 || idx === list.length - 1) return 0;
  return Math.max(MIN_SEG, Math.min(99, lockedCeiling(list, idx, target)));
}

// Set one segment's distance, honouring the lock when `target` is set.
function withDistance(list, id, km, target) {
  const idx = list.findIndex((s) => s.id === id);
  if (idx < 0) return list;
  const locked = target > 0;
  // The remainder isn't editable — and with a single segment it's the whole course.
  if (locked && idx === list.length - 1) return list;
  const hi = locked ? Math.max(MIN_SEG, Math.min(99, lockedCeiling(list, idx, target))) : 99;
  const d = clamp(round2(km), MIN_SEG, hi);
  if (d === list[idx].distance) return list;
  const next = list.map((s, i) => (i === idx ? { ...s, distance: d } : s));
  return locked ? settleRemainder(next, target) : next;
}

// ── derive everything the UI needs from raw segments ───────────────────
function computePlan(segments) {
  let cumDist = 0;
  let cumTime = 0;
  let totalDist = 0;
  let totalTime = 0;
  for (const s of segments) {
    totalDist = round2(totalDist + s.distance);
    totalTime += s.distance * s.paceSec;
  }
  const avgPace = totalDist > 0 ? totalTime / totalDist : 0;

  const rows = segments.map((s, idx) => {
    const segTime = s.distance * s.paceSec;
    cumDist = round2(cumDist + s.distance);
    cumTime += segTime;
    const delta = s.paceSec - avgPace;
    let zone;
    if (delta > 5) zone = 'easy';
    else if (delta < -5) zone = 'fast';
    else zone = 'target';
    return { ...s, index: idx + 1, segTime, cumDist, cumTime, delta, zone };
  });

  return { rows, totalDist, totalTime, avgPace };
}

// `labelKey` is an i18n key; resolve with window.I18N.t at render time.
const ZONES = {
  easy:   { labelKey: 'zone.easy',   key: 'easy' },
  target: { labelKey: 'zone.target', key: 'target' },
  fast:   { labelKey: 'zone.fast',   key: 'fast' },
};

// ── the hook ───────────────────────────────────────────────────────────
function useRacePlan(initial, initialPreset) {
  // Load saved plan once — both state initializers read from same snapshot
  const [[initSegs, initPreset, initCourse]] = React.useState(() => {
    if (initial) return [initial, initialPreset ?? 10, null];
    const saved = _loadPlan();
    return saved ? [saved.segments, saved.preset ?? 10, saved.course] : [defaultSegments(), 10, null];
  });

  const [segments, setSegments] = React.useState(initSegs);
  const [activePreset, setActivePreset] = React.useState(initPreset);
  const [course, setCourse] = React.useState(initCourse);

  const plan = React.useMemo(() => computePlan(segments), [segments]);

  // Total-distance lock. Engaged by default whenever the plan already spans the
  // loaded course, so a restored free-form plan is never snapped behind the
  // user's back — they opt in with the lock toggle, which settles it there and then.
  const [lockOn, setLockOn] = React.useState(false);
  const lockTarget = lockOn && course && course.dist > 0 ? round2(course.dist) : 0;
  // Read by the setSegments callbacks below, which are memoized with no deps.
  const lockRef = React.useRef(0);
  lockRef.current = lockTarget;

  // Re-evaluate the default only when the course itself changes — not on every
  // segment edit, which would flip the lock off the moment the user unlocks and
  // starts editing.
  const courseKey = course ? `${course.name || ''}|${round2(course.dist || 0)}` : '';
  React.useEffect(() => {
    const target = course && course.dist > 0 ? round2(course.dist) : 0;
    const total = round2(segments.reduce((a, s) => a + s.distance, 0));
    setLockOn(target > 0 && Math.abs(total - target) <= 0.05);
  }, [courseKey]);

  // Persist whenever plan (or its loaded route) changes
  React.useEffect(() => { _savePlan(segments, activePreset, course); }, [segments, activePreset, course]);

  const setTotalLock = React.useCallback((on) => {
    const target = course && course.dist > 0 ? round2(course.dist) : 0;
    if (!on || !(target > 0)) { setLockOn(false); return; }
    setLockOn(true);
    setSegments((ss) => settleRemainder(ss, target));
  }, [course]);

  const api = React.useMemo(() => ({
    setSegmentDistance: (id, km) => setSegments((ss) => withDistance(ss, id, km, lockRef.current)),
    stepDistance: (id, delta) => setSegments((ss) => {
      const cur = ss.find((s) => s.id === id);
      return cur ? withDistance(ss, id, cur.distance + delta, lockRef.current) : ss;
    }),
    setSegmentPace: (id, sec) => setSegments((ss) =>
      ss.map((s) => s.id === id ? { ...s, paceSec: clamp(Math.round(sec), 120, 900) } : s)),
    stepPace: (id, delta) => setSegments((ss) =>
      ss.map((s) => s.id === id ? { ...s, paceSec: clamp(s.paceSec + delta, 120, 900) } : s)),
    addSegment: () => setSegments((ss) => {
      const last = ss[ss.length - 1];
      const target = lockRef.current;
      if (!(target > 0) || !last) {
        return [...ss, { id: uid(), distance: 1.0, paceSec: last ? last.paceSec : 300 }];
      }
      // Locked: carve the new segment out of the remainder rather than appending
      // a kilometre the course doesn't have.
      const take = round2(Math.min(1, Math.max(MIN_SEG, last.distance / 2)));
      if (round2(last.distance - take) < MIN_SEG) return ss;
      return settleRemainder([
        ...ss.slice(0, -1),
        { ...last, distance: round2(last.distance - take) },
        { id: uid(), distance: take, paceSec: last.paceSec },
      ], target);
    }),
    // Locked: the remainder absorbs the deleted segment's distance, so dropping
    // a segment reshapes the plan instead of shortening the race.
    removeSegment: (id) => setSegments((ss) => (ss.length > 1
      ? settleRemainder(ss.filter((s) => s.id !== id), lockRef.current)
      : ss)),
    reset: () => {
      clearSavedPlan();
      setSegments(defaultSegments());
      setActivePreset(10);
      setCourse(null);
    },
    applyPreset: (km) => {
      setActivePreset(km);
      setCourse(null);
      setSegments(km === 10 ? defaultSegments() : generatePlan(km));
    },
    loadGpx: (segs, meta) => {
      if (segs && segs.length) {
        setSegments(segs.map((s) => ({ id: uid(), distance: round2(s.distance), paceSec: clamp(Math.round(s.paceSec), 120, 900) })));
        setActivePreset(null);
        setCourse(meta || null);
      }
    },
    loadCourse: (meta) => setCourse(meta || null),
    clearCourse: () => setCourse(null),
    // Replace every segment's distance/pace, keeping ids stable by position so
    // React keys don't churn (used for live boundary dragging on the chart).
    replaceSegments: (list) => setSegments((ss) => (Array.isArray(list) && list.length
      // Boundary drags already preserve the total; settling only absorbs the
      // rounding drift so a long drag can't walk the course distance away.
      ? settleRemainder(list.map((s, i) => ({
          id: (ss[i] && ss[i].id) || uid(),
          distance: clamp(round2(+s.distance || MIN_SEG), MIN_SEG, 99),
          paceSec: clamp(Math.round(+s.paceSec || 300), 120, 900),
        })), lockRef.current)
      : ss)),
    // Restore a fully-serialized plan (used by share URL)
    restorePlan: (data) => {
      if (Array.isArray(data.s) && data.s.length) {
        setSegments(data.s.map(([d, p]) => ({
          id: uid(),
          distance: clamp(round2(+d || 1), 0.05, 99),
          paceSec: clamp(Math.round(+p || 300), 120, 900),
        })));
      }
      if (data.p !== undefined) setActivePreset(data.p ?? null);
    },
  }), []);

  // `lockable` says the toggle should be offered at all; `totalLocked` whether
  // it's currently holding.
  const lockable = !!(course && course.dist > 0);
  return {
    segments, plan, activePreset, course, ...api,
    lockable, totalLocked: lockTarget > 0, lockTarget, setTotalLock,
  };
}

Object.assign(window, {
  formatPace, formatClock, parsePace, parseClock, formatKm, round2, clamp,
  PRESETS, ZONES, defaultSegments, generatePlan, computePlan, useRacePlan,
  clearSavedPlan, settleRemainder, withDistance, lockedSegmentMax,
});
