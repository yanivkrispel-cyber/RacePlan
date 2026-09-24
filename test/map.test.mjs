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
console.log('\n' + '='.repeat(60));
console.log('map: 2 passed, 0 failed');
