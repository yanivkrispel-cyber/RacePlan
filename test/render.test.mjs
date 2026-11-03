// Runs the built bundle against a fake React that actually invokes function
// components, so every render body executes. Catches reference errors — a hook
// reading state declared further down the component, a dropped import — that
// Babel compiles happily and that only show up as a blank screen.
//
// Runs against web/app.js, so `npm run build` has to have run first (the test
// script does that). The fake React is stateless: every hook returns its
// initial value and effects never run, so this proves the render paths
// execute, not that they behave. It is a crash net, not a UI test.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const noop = () => {};
const el = () => ({ style: {}, classList: { add: noop, remove: noop }, dataset: {},
  appendChild: noop, removeChild: noop, setAttribute: noop, getAttribute: () => null,
  addEventListener: noop, removeEventListener: noop, remove: noop,
  getBoundingClientRect: () => ({ width: 1200, height: 800, top: 0, left: 0 }),
  clientWidth: 1200, clientHeight: 800, textContent: '', innerHTML: '', children: [],
  querySelector: () => null, querySelectorAll: () => [], focus: noop, click: noop });

const store = new Map();
let depth = 0;
const React = {
  createElement: (type, props, ...children) => {
    const p = Object.assign({}, props);
    if (children.length) p.children = children.length === 1 ? children[0] : children;
    if (typeof type === 'function') {
      if (depth > 60) return { type: 'depth-limit', props: {} };
      depth++;
      try { return type(p); } finally { depth--; }
    }
    return { type, props: p, children };
  },
  Fragment: 'Fragment',
  useState: (init) => [typeof init === 'function' ? init() : init, noop],
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useRef: (v) => ({ current: v === undefined ? null : v }),
  useEffect: noop,
  useLayoutEffect: noop,
  useImperativeHandle: noop,
  useReducer: (r, i) => [i, noop],
  useContext: () => ({}),
  forwardRef: (fn) => (props) => fn(props, { current: null }),
  memo: (fn) => fn,
  createContext: () => ({ Provider: 'P', Consumer: 'C' }),
};

const ctx = {
  console, React,
  ReactDOM: { createPortal: (n) => n, createRoot: () => ({ render: noop }), render: noop },
  document: Object.assign(el(), {
    createElement: el, createElementNS: el, getElementById: () => null,
    head: el(), body: el(), documentElement: el(),
    addEventListener: noop, removeEventListener: noop,
  }),
  localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
  navigator: { language: 'he', userAgent: 'node', clipboard: { writeText: () => Promise.resolve() } },
  location: { href: 'http://x/', hash: '', pathname: '/', search: '' },
  history: { replaceState: noop },
  fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
  ResizeObserver: class { observe() {} disconnect() {} unobserve() {} },
  IntersectionObserver: class { observe() {} disconnect() {} },
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
  performance: { now: () => 0 },
  requestAnimationFrame: () => 0, cancelAnimationFrame: noop,
  setTimeout, clearTimeout, setInterval, clearInterval,
  addEventListener: noop, removeEventListener: noop,
  alert: noop, print: noop, getComputedStyle: () => ({ getPropertyValue: () => '' }),
  Image: class {}, HTMLElement: class {}, CustomEvent: class {}, Event: class {}, Blob: class {},
  customElements: { define: noop, get: () => undefined },
  URL: { createObjectURL: () => '', revokeObjectURL: noop },
  URLSearchParams, TextDecoder, atob, btoa,
};
ctx.window = ctx;
ctx.globalThis = ctx;
// A second, identical sandbox with the lime skin switched on (the skin is
// read once, when the bundle loads, so it needs its own context).
const lime = Object.assign({}, ctx, { RP_LIME: true });
lime.window = lime; lime.globalThis = lime;
const BUNDLE = readFileSync(process.argv[2] || 'web/app.js', 'utf8');
vm.createContext(ctx);
vm.runInContext(BUNDLE, ctx, { filename: 'app.js' });
vm.createContext(lime);
vm.runInContext(BUNDLE, lime, { filename: 'app.js' });

const COURSE = { name: 'R', dist: 10, gain: 120, loss: 110, lat: 32, lon: 34, source: 'r.gpx',
  track: [[32, 34], [32.01, 34.01], [32.02, 34.02]],
  profile: [{ d: 0, ele: 10 }, { d: 5, ele: 80 }, { d: 10, ele: 20 }] };

// PlannerBApp is module-private; window.PlannerB is the only export, and its
// router only reaches the planner when it sees a shared plan.
ctx.__RACEPLAN_SHARE__ = 'x';
lime.__RACEPLAN_SHARE__ = 'x';

const flat = (node, out = []) => {
  if (node == null || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((n) => flat(n, out)); return out; }
  if (node.props && node.props.className) out.push(String(node.props.className));
  if (node.props) flat(node.props.children, out);
  flat(node.children, out);
  return out;
};

const cases = [
  ['planner without a route', { s: [[5, 300], [5, 290]], p: 10 }, false],
  ['planner with a route', { s: [[5, 300], [5, 290]], p: 10, c: COURSE }, true],
];

let failed = 0;
let total = 0;
for (const [skin, w] of [['classic', ctx], ['lime', lime]])
for (const [name, saved, expectVisual] of cases) {
  total++;
  store.clear();
  store.set('rp-plan-v1', JSON.stringify(saved));
  try {
    const out = w.PlannerB();
    const classes = flat(out).join(' ');
    if (!classes.includes('rp-planner-wrap')) throw new Error('planner did not render at all');
    const hasCol = classes.includes('rp-visual-col');
    if (expectVisual && !hasCol) throw new Error('visual column missing with a route loaded');
    if (!expectVisual && hasCol) throw new Error('visual column rendered without a route');
    console.log('  ok   ' + skin + ': ' + name);
  } catch (e) {
    failed++;
    console.log('  FAIL ' + skin + ': ' + name + ': ' + e.name + ': ' + e.message);
    if (process.env.SMOKE_TRACE) console.log(e.stack);
  }
}
console.log('\n' + '='.repeat(60));
// lime-only screens: the Hub (no shared plan → the router lands there) with a
// plan in progress on race day, and race-day mode in each of its phases.
const dayOf = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const extra = [
  ['lime: hub with a plan on race day', () => {
    store.clear();
    store.set('rp-plan-v1', JSON.stringify({ s: [[5, 300], [5, 290]], p: 10 }));
    store.set('rp-race-date', dayOf(new Date())); store.set('rp-race-time', '07:00');
    lime.__RACEPLAN_SHARE__ = null;
    try { return lime.PlannerB(); } finally { lime.__RACEPLAN_SHARE__ = 'x'; }
  }],
  ...['before', 'running', 'nodate'].map((ph) => ['lime: race-day ' + ph, () => {
    const rows = lime.computePlan([{ id: 'a', distance: 5, paceSec: 300 }, { id: 'b', distance: 5, paceSec: 290 }]).rows;
    const d = new Date(Date.now() + (ph === 'before' ? 3600e3 : -600e3));
    const time = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    return lime.RP_LIME_UI.RaceDayScreen({ raceName: 'R', raceDate: ph === 'nodate' ? '' : dayOf(d), raceTime: time,
      rows, totalTime: 2950, weather: { temp: 20, humidityPct: 60, windSpeed: 10 }, onClose: () => {} });
  }]),
];
for (const [name, fn] of extra) {
  total++;
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + ': ' + e.name + ': ' + e.message); if (process.env.SMOKE_TRACE) console.log(e.stack); }
}
// the pure race-day timing
{
  const U = lime.RP_LIME_UI;
  const start = U.raceStartMs('2027-02-27', '05:30');
  const st = U.raceDayState('2027-02-27', '05:30', 3600, start - 60e3);
  const pos = U.planPosition(lime.computePlan([{ id: 'a', distance: 5, paceSec: 300 }, { id: 'b', distance: 5, paceSec: 290 }]).rows, 1600);
  const checks = [
    [st.phase === 'before' && st.toStartSec === 60, 'one minute before the gun'],
    [U.raceDayState('2027-02-27', '05:30', 3600, start + 1800e3).phase === 'running', 'running half way'],
    [U.raceDayState('2027-02-27', '05:30', 3600, start + 7300e3).phase === 'after', 'after finish + 1h'],
    [U.raceDayState('', '05:30', 3600) === null, 'no date gives null'],
    [pos.index === 1 && Math.abs(pos.dist - (5 + 100 / 290)) < 1e-9, 'plan position 1600s in'],
    [!U.raceDayAutoOpen('2027-02-27', '05:30', 3600, start - 86400e3), 'no auto-open the day before'],
    [U.raceDayAutoOpen('2027-02-27', '05:30', 3600, start - 3 * 3600e3), 'auto-open at 02:30 on the day'],
  ];
  for (const [ok, name] of checks) { total++; if (ok) console.log('  ok   lime timing: ' + name); else { failed++; console.log('  FAIL lime timing: ' + name); } }
}
console.log('render: ' + (total - failed) + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
