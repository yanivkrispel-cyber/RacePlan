// map.test.mjs — RouteMap must never fit the route to a zero-size container,
// and must fit it correctly as soon as a real size is available. The bug this
// guards: on the narrow (mobile) planner layout the map's tab starts hidden
// (display:none) behind the "plan" tab, so a fixed setTimeout(bootstrap, 0)
// asked Leaflet to fitBounds() into a 0×0 viewport at mount — Leaflet can't
// compute a zoom for that, so the map was stuck at the constructor's
// hardcoded fallback zoom (reads as "opens zoomed in, can't see the route")
// the whole time the user had it open. See src/map.jsx for the fix.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as babel from '@babel/core';
import assert from 'node:assert/strict';

function compile(file) {
  const code = readFileSync(file, 'utf8');
  return babel.transformSync(code, {
    filename: file,
    presets: [['@babel/preset-react', { runtime: 'classic' }]],
    babelrc: false, configFile: false,
  }).code;
}

function mountRouteMap({ startHidden }) {
  const effectQueue = [];
  const timers = [];
  let roInstance = null;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useRef: (init) => ({ current: init }),
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: (fn) => { effectQueue.push(fn); },
  };

  const fitBoundsCalls = [];
  const L = {
    map: (container) => ({
      invalidateSize: () => {},
      fitBounds: () => { fitBoundsCalls.push({ w: container.clientWidth, h: container.clientHeight }); },
      remove: () => {},
    }),
    tileLayer: () => ({ addTo() { return this; } }),
    layerGroup: () => ({ addTo() { return this; }, clearLayers() {} }),
    polyline: () => ({ addTo() { return this; }, getBounds: () => ({ plain: true }) }),
    circleMarker: () => ({ addTo() { return this; }, bindPopup() { return this; } }),
    latLngBounds: (track) => ({ track }),
  };

  class FakeResizeObserver {
    constructor(cb) { this.cb = cb; roInstance = this; }
    // Real ResizeObserver always delivers one callback shortly after
    // observe(), reporting the box's size at that moment — even if it never
    // changes again. map.jsx's bootstrap relies on exactly that guarantee for
    // the already-visible case (desktop, or a mobile tab that's already
    // active), so the fake has to keep the same contract to be faithful.
    observe(el) { this.el = el; this.cb([{ contentRect: { width: el.clientWidth, height: el.clientHeight } }]); }
    disconnect() {}
  }

  const ctx = {
    console, React, L, window: { L, ResizeObserver: FakeResizeObserver }, ResizeObserver: FakeResizeObserver,
    setTimeout: (fn) => { const h = { fn }; timers.push(h); return h; },
    clearTimeout: (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); },
  };
  vm.createContext(ctx);
  vm.runInContext(compile('src/map.jsx') + '\nthis.__RouteMap = RouteMap;', ctx);

  const container = { clientWidth: startHidden ? 0 : 300, clientHeight: startHidden ? 0 : 200 };
  const track = [[32, 34], [32.01, 34.01]];
  const profile = [{ d: 0, ele: 10 }, { d: 1, ele: 50 }];

  const el = ctx.__RouteMap({ track, profile, splits: [], height: '100%' });
  el.props.ref.current = container; // simulate React committing the <div ref> to a real node
  effectQueue.forEach((fn) => fn()); // simulate React running effects after commit
  timers.splice(0).forEach((h) => h.fn()); // flush any fallback timer (no-ResizeObserver browsers)

  return {
    fitBoundsCalls,
    revealAt(w, h) {
      container.clientWidth = w; container.clientHeight = h;
      if (roInstance) roInstance.cb([{ contentRect: { width: w, height: h } }]);
    },
  };
}

console.log('── RouteMap: fitBounds vs. container visibility ──');

// Visible immediately (desktop two-column layout, or a mobile map tab that
// happens to already be the active one) — fits right away, exactly once.
{
  const m = mountRouteMap({ startHidden: false });
  assert.equal(m.fitBoundsCalls.length, 1, 'fits once when the container is visible at mount');
  assert.ok(m.fitBoundsCalls[0].w > 0 && m.fitBoundsCalls[0].h > 0, 'fits against a real size, not 0×0');
}

// Hidden at mount (mobile: the map tab is not the default view) — must NOT
// fit against 0×0, and must fit exactly once as soon as the tab is opened.
{
  const m = mountRouteMap({ startHidden: true });
  assert.equal(m.fitBoundsCalls.length, 0, 'never fits while the container is still 0×0');
  m.revealAt(300, 200); // user switches to the map tab
  assert.equal(m.fitBoundsCalls.length, 1, 'fits exactly once as soon as a real size appears');
  assert.ok(m.fitBoundsCalls[0].w > 0 && m.fitBoundsCalls[0].h > 0, 'that fit used the real size');
  m.revealAt(500, 400); // a later resize (e.g. rotating the phone) must not re-fit and fight the user's pan/zoom
  assert.equal(m.fitBoundsCalls.length, 1, 'a later resize does not re-fit (would discard the user\'s pan/zoom)');
}

console.log('  ok   fits only against a real size, and exactly once when revealed from hidden');

// ── Leaflet is loaded on demand (not from index.html) ──────────────────
// A RouteMap that mounts before Leaflet has arrived must not throw or build a
// half map; it must inject the script + stylesheet (the stylesheet *before*
// the app's dark restyle so the restyle still wins the cascade) and build the
// map once Leaflet is there.
async function mountBeforeLeaflet() {
  let effectQueue = [];
  const states = [];
  let hook = 0;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useRef: (init) => ({ current: init }),
    useState: (init) => {
      const i = hook++;
      if (!(i in states)) states[i] = typeof init === 'function' ? init() : init;
      return [states[i], (v) => { states[i] = v; }];
    },
    useEffect: (fn) => { effectQueue.push(fn); },
  };
  const mapCalls = [];
  const fitBoundsCalls = [];
  const L = {
    map: (container) => {
      mapCalls.push(container);
      return { invalidateSize: () => {}, fitBounds: () => { fitBoundsCalls.push(1); }, remove: () => {} };
    },
    tileLayer: () => ({ addTo() { return this; } }),
    layerGroup: () => ({ addTo() { return this; }, clearLayers() {} }),
    polyline: () => ({ addTo() { return this; }, getBounds: () => ({ plain: true }) }),
    circleMarker: () => ({ addTo() { return this; }, bindPopup() { return this; } }),
    latLngBounds: (track) => ({ track }),
  };
  class FakeResizeObserver {
    constructor(cb) { this.cb = cb; }
    observe(el) { this.cb([{ contentRect: { width: el.clientWidth, height: el.clientHeight } }]); }
    disconnect() {}
  }
  const headOps = [];
  const byId = {};
  const document = {
    readyState: 'loading', // page still loading: the idle prefetch hasn't fired
    createElement: (tag) => ({ tag }),
    getElementById: (id) => byId[id] || null,
    head: {
      appendChild: (el) => { headOps.push({ op: 'append', el }); if (el.id) byId[el.id] = el; },
      insertBefore: (el, ref) => { headOps.push({ op: 'insertBefore', el, ref }); },
    },
  };
  const win = { ResizeObserver: FakeResizeObserver, addEventListener: () => {} };
  const ctx = {
    console, React, window: win, document, ResizeObserver: FakeResizeObserver,
    setTimeout: (fn) => { fn(); return 0; }, clearTimeout: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(compile('src/map.jsx') + '\nthis.__RouteMap = RouteMap;', ctx);

  const container = { clientWidth: 300, clientHeight: 200 };
  const render = () => {
    hook = 0; effectQueue = [];
    const el = ctx.__RouteMap({ track: [[32, 34], [32.01, 34.01]], profile: null, splits: [], height: 300 });
    el.props.ref.current = container;
    effectQueue.forEach((fn) => fn());
  };

  render(); // mounts with no window.L
  const script = headOps.find((o) => o.el.tag === 'script');
  const link = headOps.find((o) => o.el.tag === 'link');
  const mapsBeforeLoad = mapCalls.length;

  win.L = L;          // the <script> finished executing…
  script.el.onload(); // …and fired load
  await new Promise((r) => setImmediate(r));
  render();           // React re-renders after setLeafletReady(true)

  return { mapsBeforeLoad, script, link, restyle: byId['rp-map-styles'], mapCalls, fitBoundsCalls };
}

{
  const m = await mountBeforeLeaflet();
  assert.equal(m.mapsBeforeLoad, 0, 'no map is built before Leaflet has loaded');
  assert.ok(m.script && /leaflet@1\.9\.4\/dist\/leaflet\.js$/.test(m.script.el.src), 'injects the pinned leaflet.js');
  assert.ok(m.script.el.integrity, 'leaflet.js keeps its SRI hash');
  assert.ok(m.link && /leaflet\.css$/.test(m.link.el.href) && m.link.el.integrity, 'injects leaflet.css with SRI');
  assert.equal(m.link.op, 'insertBefore', 'stylesheet is inserted, not appended…');
  assert.equal(m.link.ref, m.restyle, '…right before the app\'s dark restyle, so the restyle wins the cascade');
  assert.equal(m.mapCalls.length, 1, 'the map is built exactly once when Leaflet arrives');
  assert.equal(m.fitBoundsCalls.length, 1, 'and fits the route');
}
console.log('  ok   mounts before Leaflet → loads it on demand (SRI, cascade order) and builds the map once');

console.log('\n' + '='.repeat(60));
console.log('map: 3 passed, 0 failed');
