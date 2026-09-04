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
    };
  } catch { return null; }
}

function _savePlan(segments, activePreset) {
  try {
    localStorage.setItem(LS_PLAN, JSON.stringify({
      s: segments.map(s => [round2(s.distance), s.paceSec]),
      p: activePreset,
    }));
  } catch {}
}

function clearSavedPlan() {
  try { localStorage.removeItem(LS_PLAN); } catch {}
}

// ── distance presets (km) ──────────────────────────────────────────────
const PRESETS = [
  { km: 42.2, label: '42.2', name: 'מרתון' },
  { km: 21.1, label: '21.1', name: 'חצי מרתון' },
  { km: 15,   label: '15',   name: '15 ק"מ' },
  { km: 10,   label: '10',   name: '10 ק"מ' },
  { km: 5,    label: '5',    name: '5 ק"מ' },
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

const ZONES = {
  easy:   { label: 'קל',   key: 'easy' },
  target: { label: 'מטרה', key: 'target' },
  fast:   { label: 'מהיר', key: 'fast' },
};

// ── the hook ───────────────────────────────────────────────────────────
function useRacePlan(initial, initialPreset) {
  // Load saved plan once — both state initializers read from same snapshot
  const [[initSegs, initPreset]] = React.useState(() => {
    if (initial) return [initial, initialPreset ?? 10];
    const saved = _loadPlan();
    return saved ? [saved.segments, saved.preset ?? 10] : [defaultSegments(), 10];
  });

  const [segments, setSegments] = React.useState(initSegs);
  const [activePreset, setActivePreset] = React.useState(initPreset);
  const [course, setCourse] = React.useState(null);

  const plan = React.useMemo(() => computePlan(segments), [segments]);

  // Persist whenever plan changes
  React.useEffect(() => { _savePlan(segments, activePreset); }, [segments, activePreset]);

  const api = React.useMemo(() => ({
    setSegmentDistance: (id, km) => setSegments((ss) =>
      ss.map((s) => s.id === id ? { ...s, distance: clamp(round2(km), 0.05, 99) } : s)),
    stepDistance: (id, delta) => setSegments((ss) =>
      ss.map((s) => s.id === id ? { ...s, distance: clamp(round2(s.distance + delta), 0.05, 99) } : s)),
    setSegmentPace: (id, sec) => setSegments((ss) =>
      ss.map((s) => s.id === id ? { ...s, paceSec: clamp(Math.round(sec), 120, 900) } : s)),
    stepPace: (id, delta) => setSegments((ss) =>
      ss.map((s) => s.id === id ? { ...s, paceSec: clamp(s.paceSec + delta, 120, 900) } : s)),
    addSegment: () => setSegments((ss) => {
      const last = ss[ss.length - 1];
      return [...ss, { id: uid(), distance: 1.0, paceSec: last ? last.paceSec : 300 }];
    }),
    removeSegment: (id) => setSegments((ss) => ss.length > 1 ? ss.filter((s) => s.id !== id) : ss),
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

  return { segments, plan, activePreset, course, ...api };
}

Object.assign(window, {
  formatPace, formatClock, parsePace, formatKm, round2, clamp,
  PRESETS, ZONES, defaultSegments, generatePlan, computePlan, useRacePlan,
  clearSavedPlan,
});
