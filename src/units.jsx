// units.jsx — measurement-system layer (metric ↔ imperial) for RACE PLAN.
//
//   window.UNITS.system           → 'metric' | 'imperial'
//   window.UNITS.setSystem(s)     → switch + persist + re-render
//   window.UNITS.useUnits()       → React hook; re-renders on a switch
//
//   distance:   dispDist(km) / dispDistNum(km) / fmtDist(km) / parseDist(v)→km
//   pace:       dispPaceSec(secPerKm) / fmtPace(secPerKm) / parsePaceInput→secPerKm
//   elevation:  dispElev(m) / fmtElev(m) / elevInt(m)
//   labels:     distUnit() / paceUnit() / elevUnit() / speedUnit()
//
// The planner engine stays SI internally (km, sec/km, m). Everything here is a
// display / input boundary only, so no stored data changes.

const KM_PER_MI = 1.609344;
const M_PER_FT = 0.3048;

const RP_UNIT_SYSTEMS = ['metric', 'imperial'];

// ?units= > localStorage > locale default (en → imperial, else metric)
function resolveUnitSystem(opts) {
  opts = opts || {};
  const ok = (s) => RP_UNIT_SYSTEMS.indexOf(s) !== -1;
  if (ok(opts.query)) return opts.query;
  if (ok(opts.stored)) return opts.stored;
  return opts.locale === 'en' ? 'imperial' : 'metric';
}

// round to n decimals, drop trailing zeros for display via Intl later
function _round(n, d) { const p = Math.pow(10, d); return Math.round(n * p) / p; }

const UNITS = (() => {
  const win = typeof window !== 'undefined' ? window : {};
  let query = null;
  try { query = new URLSearchParams(win.location ? win.location.search : '').get('units'); } catch (e) {}
  let stored = null;
  try { stored = win.localStorage && win.localStorage.getItem('rp-units'); } catch (e) {}
  const locale = (win.I18N && win.I18N.locale) || 'he';

  let system = resolveUnitSystem({ query, stored, locale });
  if (query && RP_UNIT_SYSTEMS.indexOf(query) !== -1) {
    try { win.localStorage.setItem('rp-units', system); } catch (e) {}
  }

  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => { try { fn(); } catch (e) {} });
  const isImp = () => system === 'imperial';

  const T = (k, p) => (win.I18N ? win.I18N.t(k, p) : k);
  const num = (n, o) => (win.I18N ? win.I18N.fmtNumber(n, o) : String(n));

  // ── distance ────────────────────────────────────────────────────────
  const dispDist = (km) => (isImp() ? (+km || 0) / KM_PER_MI : (+km || 0));
  const parseDist = (v) => {
    // tolerate a locale decimal comma ("12,3")
    const n = parseFloat(typeof v === 'string' ? v.replace(',', '.') : v);
    if (!isFinite(n)) return NaN;
    return isImp() ? n * KM_PER_MI : n;
  };
  const dispDistNum = (km, d) => {
    const v = dispDist(km);
    const dec = d == null ? 2 : d;
    return num(_round(v, dec), { minimumFractionDigits: 0, maximumFractionDigits: dec });
  };
  const fmtDist = (km, d) => dispDistNum(km, d) + ' ' + T(isImp() ? 'units.mi' : 'units.km');
  const distUnit = () => T(isImp() ? 'units.mi' : 'units.km');

  // ── pace (stored sec per km) ────────────────────────────────────────
  const dispPaceSec = (secPerKm) => (isImp() ? (+secPerKm || 0) * KM_PER_MI : (+secPerKm || 0));
  const paceFromDisplaySec = (secPerUnit) => (isImp() ? (+secPerUnit || 0) / KM_PER_MI : (+secPerUnit || 0));
  const fmtPace = (secPerKm) => {
    const f = (win.formatPace || ((s) => String(Math.round(s))));
    return f(dispPaceSec(secPerKm));
  };
  const paceUnit = () => T(isImp() ? 'units.perMi' : 'units.perKm');
  // "m:ss" typed against the *display* unit → back to sec/km
  const parsePaceInput = (str) => {
    const f = (win.parsePace || (() => NaN));
    const disp = f(str);
    return isFinite(disp) ? paceFromDisplaySec(disp) : NaN;
  };

  // ── elevation ──────────────────────────────────────────────────────
  const dispElev = (m) => (isImp() ? (+m || 0) / M_PER_FT : (+m || 0));
  const elevInt = (m) => Math.round(dispElev(m));
  const fmtElev = (m) => num(elevInt(m)) + ' ' + T(isImp() ? 'units.ft' : 'units.m');
  const elevUnit = () => T(isImp() ? 'units.ft' : 'units.m');

  // ── speed (stored km/h) ────────────────────────────────────────────
  const dispSpeed = (kmh) => (isImp() ? (+kmh || 0) / KM_PER_MI : (+kmh || 0));
  const speedUnit = () => T(isImp() ? 'units.mph' : 'units.kmh');

  function setSystem(s) {
    if (RP_UNIT_SYSTEMS.indexOf(s) === -1 || s === system) return;
    system = s;
    try { win.localStorage.setItem('rp-units', s); } catch (e) {}
    notify();
    try {
      if (win.RP_FIREBASE && win.RP_FIREBASE.saveProfile) win.RP_FIREBASE.saveProfile({ units: s });
    } catch (e) {}
  }

  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  function useUnits() {
    const R = win.React;
    if (R && R.useSyncExternalStore) {
      R.useSyncExternalStore(subscribe, () => system, () => system);
    } else if (R && R.useState && R.useEffect) {
      const [, force] = R.useState(0);
      R.useEffect(() => subscribe(() => force((x) => x + 1)), []);
    }
    return { system, imperial: isImp() };
  }

  // Apply a signed-in user's saved unit preference when there is no local choice.
  try {
    if (win.RP_FIREBASE && win.RP_FIREBASE.ready) {
      win.RP_FIREBASE.ready.then(() => {
        try {
          const pu = win.RP_FIREBASE.profile && win.RP_FIREBASE.profile.units;
          let hadLocal = false;
          try { hadLocal = !!win.localStorage.getItem('rp-units'); } catch (e) {}
          if (pu && !hadLocal) setSystem(pu);
        } catch (e) {}
      }).catch(() => {});
    }
  } catch (e) {}

  return {
    get system() { return system; },
    get imperial() { return isImp(); },
    systems: RP_UNIT_SYSTEMS.slice(),
    setSystem, subscribe, useUnits,
    dispDist, parseDist, dispDistNum, fmtDist, distUnit,
    dispPaceSec, paceFromDisplaySec, fmtPace, paceUnit, parsePaceInput,
    dispElev, elevInt, fmtElev, elevUnit,
    dispSpeed, speedUnit,
    KM_PER_MI, M_PER_FT,
    _resolveUnitSystem: resolveUnitSystem,
  };
})();

if (typeof window !== 'undefined') window.UNITS = UNITS;
