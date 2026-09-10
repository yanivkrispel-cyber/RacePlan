// route3d.jsx — an immersive 3D flyover of the route: the GPX track drawn as
// an elevation-exaggerated ribbon (so real climbs/descents are actually
// visible as relief, not just implied by color) colored by pace zone, with a
// runner marker that flies along it at the plan's real relative pace —
// faster on downhill/fast segments, slower on climbs — compressed into a
// short, watchable loop. Drag to orbit, wheel/pinch to zoom, or scrub.
//
// Three.js is lazy-loaded from a CDN only the first time this view opens —
// never on the initial page-load critical path (same pattern as the PDF
// export libs in exporting.jsx).
const t = (window.I18N && window.I18N.t) || ((k) => k);
const I18N = window.I18N;
const U = window.UNITS;
const ElevationChart = window.ElevationChart;
// Local dark-chrome palette for the side elevation chart — kept local
// (no cross-module dependency, see map.jsx for the same habit) rather than
// pulling in planner-b.jsx's themeB.
const ELEV_COLORS = { line: '#F5C24A', grid: 'rgba(255,255,255,.1)', textDim: 'rgba(255,255,255,.5)' };

const THREE_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
let _threePromise = null;
function ensureThree() {
  if (window.THREE) return Promise.resolve(window.THREE);
  if (_threePromise) return _threePromise;
  _threePromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = THREE_SRC; s.async = true;
    s.onload = () => resolve(window.THREE);
    s.onerror = () => { _threePromise = null; reject(new Error('failed to load three.js')); };
    document.head.appendChild(s);
  });
  return _threePromise;
}

// Same zone colors as themeB.zones in planner-b.jsx (kept local — see
// map.jsx / valueeditor.jsx for the same no-cross-module-dependency habit).
const ZONE_HEX = { fast: 0xC15A2E, target: 0xC9A24B, easy: 0x8091BE };
const TARGET_ANIM_SEC = 16; // full-course loop length, regardless of race duration

function _haversineKm(a, b) {
  const R = 6371, toRad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toRad, dLon = (b[1] - a[1]) * toRad;
  const la1 = a[0] * toRad, la2 = b[0] * toRad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

function _interpEle(profile, dKm) {
  if (!profile || !profile.length) return 0;
  if (dKm <= profile[0].d) return profile[0].ele;
  if (dKm >= profile[profile.length - 1].d) return profile[profile.length - 1].ele;
  let lo = 0, hi = profile.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (profile[mid].d <= dKm) lo = mid; else hi = mid;
  }
  const a = profile[lo], b = profile[hi];
  const f = b.d > a.d ? (dKm - a.d) / (b.d - a.d) : 0;
  return a.ele + f * (b.ele - a.ele);
}

function _zoneAt(rows, dKm) {
  for (const r of rows) if (dKm <= r.cumDist + 1e-6) return r.zone;
  return rows.length ? rows[rows.length - 1].zone : 'target';
}

// Resample the track to even distance steps (smooths out however the raw GPX
// points happened to be spaced) and attach interpolated elevation + a local
// planar (x, z) position in meters, anchored at the route's start point.
function buildSamples(track, profile, steps) {
  const cum = [0];
  for (let i = 1; i < track.length; i++) cum.push(cum[i - 1] + _haversineKm(track[i - 1], track[i]));
  const totalKm = cum[cum.length - 1] || 0.001;
  const lat0 = track[0][0], lon0 = track[0][1];
  const R = 6371000, rad = Math.PI / 180;
  const hasEle = Array.isArray(profile) && profile.some((p) => isFinite(p.ele));

  const out = [];
  for (let s = 0; s <= steps; s++) {
    const dKm = (s / steps) * totalKm;
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= dKm) lo = mid; else hi = mid;
    }
    const f = cum[hi] > cum[lo] ? (dKm - cum[lo]) / (cum[hi] - cum[lo]) : 0;
    const lat = track[lo][0] + (track[hi][0] - track[lo][0]) * f;
    const lon = track[lo][1] + (track[hi][1] - track[lo][1]) * f;
    const ele = hasEle ? _interpEle(profile, dKm) : 0;
    const x = (lon - lon0) * rad * R * Math.cos(lat0 * rad);
    const z = -(lat - lat0) * rad * R;
    out.push({ dKm, x, z, ele });
  }
  return { samples: out, totalKm };
}

// All the Three.js scene setup, the animation loop and the pointer/wheel
// orbit-camera controls. Returns a cleanup function that tears everything
// down; mutates `stateRef.current` with a `playing` flag and a `seek(frac)`
// function the React shell can drive from its own controls.
function mount3D(THREE, container, data, onProgress, stateRef) {
  const { track, profile, rows, totalDist } = data;
  if (!track || track.length < 2) throw new Error('route3d: no track');

  const STEPS = Math.max(60, Math.min(240, Math.round((totalDist || 5) * 24)));
  const { samples, totalKm } = buildSamples(track, profile, STEPS);

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minEle = Infinity, maxEle = -Infinity;
  samples.forEach((s) => {
    minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
    minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z);
    minEle = Math.min(minEle, s.ele); maxEle = Math.max(maxEle, s.ele);
  });
  const footprint = Math.max(maxX - minX, maxZ - minZ, 10);
  const TARGET_SIZE = 100; // world units the longest horizontal side maps to
  const scale = TARGET_SIZE / footprint;
  // Real elevation change is usually tiny next to horizontal distance — this
  // exaggeration is what turns a "flat-looking" route into visible relief,
  // the same trick physical relief maps use.
  const EXAGGERATION = 9;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;

  const points = samples.map((s) => new THREE.Vector3(
    (s.x - cx) * scale,
    (s.ele - minEle) * scale * EXAGGERATION,
    (s.z - cz) * scale,
  ));
  const curve = new THREE.CatmullRomCurve3(points);

  // ── Scene ──
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070d);
  scene.fog = new THREE.FogExp2(0x05070d, 0.0022);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0x8899bb, 0.65));
  const sun = new THREE.DirectionalLight(0xfff2d6, 0.9);
  sun.position.set(60, 90, 40);
  scene.add(sun);

  const grid = new THREE.GridHelper(TARGET_SIZE * 2.2, 22, 0x2a3346, 0x1a2030);
  grid.position.y = -0.4;
  scene.add(grid);

  // ── The ribbon, colored along its length by pace zone ──
  const tubeRadius = Math.max(0.35, TARGET_SIZE * 0.006);
  const tubularSegments = Math.max(150, STEPS * 2);
  const tubeGeo = new THREE.TubeGeometry(curve, tubularSegments, tubeRadius, 8, false);
  const uv = tubeGeo.attributes.uv;
  const colorArr = new Float32Array(uv.count * 3);
  const col = new THREE.Color();
  for (let i = 0; i < uv.count; i++) {
    const dKm = uv.getX(i) * totalKm;
    const zone = rows && rows.length ? _zoneAt(rows, dKm) : 'target';
    col.setHex(ZONE_HEX[zone] || ZONE_HEX.target);
    colorArr[i * 3] = col.r; colorArr[i * 3 + 1] = col.g; colorArr[i * 3 + 2] = col.b;
  }
  tubeGeo.setAttribute('color', new THREE.BufferAttribute(colorArr, 3));
  const tubeMesh = new THREE.Mesh(tubeGeo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.08 }));
  scene.add(tubeMesh);

  // "Already run" reveal — a brighter overlay whose draw range grows with
  // progress, so the travelled portion visibly lights up while playing.
  const revealGeo = tubeGeo.clone();
  revealGeo.setDrawRange(0, 0);
  const revealMesh = new THREE.Mesh(revealGeo, new THREE.MeshStandardMaterial({
    vertexColors: true, emissive: 0x14100a, emissiveIntensity: 0.4, roughness: 0.28, metalness: 0.18,
  }));
  scene.add(revealMesh);
  const revealIndexCount = revealGeo.index ? revealGeo.index.count : revealGeo.attributes.position.count;

  // ── Ground "shadow" ribbon + drop-lines, purely for depth cues ──
  const groundCurve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p.x, -0.35, p.z)));
  const groundGeo = new THREE.TubeGeometry(groundCurve, tubularSegments, tubeRadius * 0.8, 6, false);
  scene.add(new THREE.Mesh(groundGeo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 })));

  const dropMat = new THREE.LineBasicMaterial({ color: 0x3a4258, transparent: true, opacity: 0.5 });
  const DROP_COUNT = 14;
  for (let i = 1; i < DROP_COUNT; i++) {
    const idx = Math.round((i / DROP_COUNT) * (points.length - 1));
    const top = points[idx];
    const geo = new THREE.BufferGeometry().setFromPoints([top, new THREE.Vector3(top.x, -0.35, top.z)]);
    scene.add(new THREE.Line(geo, dropMat));
  }

  // ── Start / finish markers ──
  const markerGeo = new THREE.SphereGeometry(tubeRadius * 1.8, 16, 16);
  const startMesh = new THREE.Mesh(markerGeo, new THREE.MeshStandardMaterial({ color: 0x8091BE, emissive: 0x1a1f33 }));
  startMesh.position.copy(points[0]);
  scene.add(startMesh);
  const finishMesh = new THREE.Mesh(markerGeo, new THREE.MeshStandardMaterial({ color: 0xC15A2E, emissive: 0x2a0f05 }));
  finishMesh.position.copy(points[points.length - 1]);
  scene.add(finishMesh);

  // ── The runner ──
  const runner = new THREE.Mesh(
    new THREE.SphereGeometry(tubeRadius * 2.2, 20, 20),
    new THREE.MeshStandardMaterial({ color: 0xF5C24A, emissive: 0x6b4a10, emissiveIntensity: 1.1 }),
  );
  runner.add(new THREE.PointLight(0xF5C24A, 1.1, TARGET_SIZE * 0.4));
  scene.add(runner);

  // ── Hand-rolled orbit camera: pointer-drag to orbit, wheel/pinch to zoom ──
  let radius = TARGET_SIZE * 1.15;
  let azimuth = Math.PI * 0.22;
  let polar = Math.PI * 0.32;
  const target = new THREE.Vector3(0, TARGET_SIZE * 0.06, 0);
  let lastInteraction = 0;

  // Ground floor for the camera itself: never let orbiting bring the eye
  // below world y=0 — the route's own lowest point (everything is built on
  // (ele - minEle), so the course's deepest point already sits at y=0) —
  // recomputed every call since target/radius both drift (camera-follow,
  // zoom). GROUND_MARGIN keeps the camera a hair above the ground plane
  // rather than exactly grazing it.
  const GROUND_MARGIN = 0.6;
  function applyCamera() {
    const maxPolar = Math.acos(Math.max(-1, Math.min(1, (GROUND_MARGIN - target.y) / radius)));
    polar = Math.max(0.12, Math.min(maxPolar, polar));
    camera.position.set(
      target.x + radius * Math.sin(polar) * Math.sin(azimuth),
      target.y + radius * Math.cos(polar),
      target.z + radius * Math.sin(polar) * Math.cos(azimuth),
    );
    camera.lookAt(target);
  }
  applyCamera();

  const pointers = new Map();
  let dragLast = null;
  let pinchStartDist = null;
  let pinchStartRadius = null;

  function onPointerDown(e) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lastInteraction = performance.now();
    if (pointers.size === 1) dragLast = { x: e.clientX, y: e.clientY };
    if (pointers.size === 2) {
      const pts = [...pointers.values()];
      pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      pinchStartRadius = radius;
    }
    try { e.target.setPointerCapture(e.pointerId); } catch (err) {}
  }
  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lastInteraction = performance.now();
    if (pointers.size === 2 && pinchStartDist) {
      const pts = [...pointers.values()];
      const dist = Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
      radius = Math.max(TARGET_SIZE * 0.35, Math.min(TARGET_SIZE * 3.5, pinchStartRadius * (pinchStartDist / dist)));
      applyCamera();
      return;
    }
    if (dragLast && pointers.size === 1) {
      const dx = e.clientX - dragLast.x, dy = e.clientY - dragLast.y;
      dragLast = { x: e.clientX, y: e.clientY };
      azimuth -= dx * 0.006;
      polar -= dy * 0.006;
      applyCamera();
    }
  }
  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStartDist = null;
    if (pointers.size === 0) dragLast = null;
  }
  function onWheel(e) {
    e.preventDefault();
    lastInteraction = performance.now();
    radius = Math.max(TARGET_SIZE * 0.35, Math.min(TARGET_SIZE * 3.5, radius * (1 + e.deltaY * 0.0012)));
    applyCamera();
  }
  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', onPointerUp);
  container.addEventListener('pointercancel', onPointerUp);
  container.addEventListener('wheel', onWheel, { passive: false });

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  resize();
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(container);
  else window.addEventListener('resize', resize);

  // ── Playback: progress = fraction of totalDist travelled, driven by the
  // plan's real per-segment pace so the runner visibly speeds up/slows down.
  const checkpoints = [{ cumTime: 0, cumDist: 0 }].concat((rows || []).map((r) => ({ cumTime: r.cumTime, cumDist: r.cumDist })));
  const totalTime = checkpoints[checkpoints.length - 1].cumTime || 1;
  const speedMult = totalTime / TARGET_ANIM_SEC;
  let elapsed = 0;

  function distFractionAtTime(sec) {
    if (sec <= 0) return 0;
    if (sec >= totalTime) return 1;
    let lo = 0, hi = checkpoints.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (checkpoints[mid].cumTime <= sec) lo = mid; else hi = mid;
    }
    const a = checkpoints[lo], b = checkpoints[hi];
    const f = b.cumTime > a.cumTime ? (sec - a.cumTime) / (b.cumTime - a.cumTime) : 0;
    return Math.max(0, Math.min(1, (a.cumDist + (b.cumDist - a.cumDist) * f) / (totalDist || 1)));
  }

  function updateRunner(frac) {
    runner.position.copy(curve.getPointAt(Math.max(0, Math.min(1, frac))));
    revealGeo.setDrawRange(0, Math.round(revealIndexCount * frac));
    if (onProgress) onProgress(frac);
  }

  stateRef.current = {
    playing: true,
    seek(frac) { elapsed = frac * totalTime; updateRunner(frac); },
  };
  updateRunner(0);

  let raf = null;
  let lastT = performance.now();
  function tick(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    if (stateRef.current.playing) {
      elapsed += dt * speedMult;
      if (elapsed >= totalTime) elapsed = 0;
      const frac = distFractionAtTime(elapsed);
      updateRunner(frac);
      target.lerp(curve.getPointAt(frac), 0.04); // gentle camera follow
    }
    if (now - lastInteraction > 2600 && pointers.size === 0) azimuth += dt * 0.06; // idle auto-orbit
    applyCamera();
    runner.rotation.y += dt * 3;

    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);

  return function cleanup() {
    cancelAnimationFrame(raf);
    if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
    container.removeEventListener('pointerdown', onPointerDown);
    container.removeEventListener('pointermove', onPointerMove);
    container.removeEventListener('pointerup', onPointerUp);
    container.removeEventListener('pointercancel', onPointerUp);
    container.removeEventListener('wheel', onWheel);
    scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => m.dispose());
    });
    renderer.dispose();
    if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
  };
}

function Route3DView({ track, profile, rows, totalDist, raceName, gain, loss, onClose }) {
  const mountRef = React.useRef(null);
  const scrubRef = React.useRef(null);
  const distRef = React.useRef(null);
  const stateRef = React.useRef(null);
  const [status, setStatus] = React.useState('loading'); // loading | ready | error
  const [playing, setPlaying] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    let cleanupFn = null;
    ensureThree().then((THREE) => {
      if (cancelled || !mountRef.current) return;
      try {
        cleanupFn = mount3D(THREE, mountRef.current, { track, profile, rows, totalDist }, (frac) => {
          if (scrubRef.current) scrubRef.current.value = String(Math.round(frac * 1000));
          if (distRef.current) distRef.current.textContent = U ? U.fmtDist(frac * totalDist) : (frac * totalDist).toFixed(1);
        }, stateRef);
        if (!cancelled) setStatus('ready'); else if (cleanupFn) cleanupFn();
      } catch (e) {
        try { console.warn('[Route3DView] init failed', e); } catch (e2) {}
        if (!cancelled) setStatus('error');
      }
    }).catch(() => { if (!cancelled) setStatus('error'); });

    return () => { cancelled = true; if (cleanupFn) cleanupFn(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (stateRef.current) stateRef.current.playing = playing;
  }, [playing]);

  const onScrub = (e) => {
    const frac = Number(e.target.value) / 1000;
    if (stateRef.current) stateRef.current.seek(frac);
    if (distRef.current) distRef.current.textContent = U ? U.fmtDist(frac * totalDist) : (frac * totalDist).toFixed(1);
  };

  return ReactDOM.createPortal((
    <div className="rp-cq-scope" style={{
      position: 'fixed', inset: 0, zIndex: 1300, background: '#05070d',
      display: 'flex', flexDirection: 'column', direction: I18N.dir, fontFamily: 'var(--rp-font-ui)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#f2f0e8' }}>{t('view3d.title')}</div>
          <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.5)', marginTop: 2 }}>{raceName}</div>
        </div>
        <button onClick={onClose} aria-label={t('view3d.close')} style={{
          width: 36, height: 36, borderRadius: '50%', border: '1px solid rgba(255,255,255,.18)',
          background: 'rgba(255,255,255,.06)', color: '#f2f0e8', fontSize: 18, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>×</button>
      </div>

      <style>{`
        .rp-view3d-body { flex: 1; display: flex; min-height: 0; }
        .rp-view3d-elev { width: 260px; flex: 0 0 auto; border-inline-start: 1px solid rgba(255,255,255,.08);
          padding: 10px 12px; display: flex; flex-direction: column; }
        @media (max-width: 640px) {
          .rp-view3d-body { flex-direction: column; }
          .rp-view3d-elev { width: 100%; height: 130px; border-inline-start: none;
            border-top: 1px solid rgba(255,255,255,.08); }
        }
      `}</style>
      <div className="rp-view3d-body">
        <div ref={mountRef} style={{ flex: 1, position: 'relative', touchAction: 'none', minWidth: 0 }}>
          {status !== 'ready' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
              justifyContent: 'center', color: 'rgba(255,255,255,.6)', fontSize: 13, textAlign: 'center', padding: 24 }}>
              {status === 'loading' ? t('view3d.loading') : t('view3d.loadError')}
            </div>
          )}
          {status === 'ready' && (
            <div style={{ position: 'absolute', top: 10, insetInlineStart: 12, fontSize: 11,
              color: 'rgba(255,255,255,.45)', pointerEvents: 'none' }}>{t('view3d.dragHint')}</div>
          )}
        </div>
        {status === 'ready' && ElevationChart && (
          <div className="rp-view3d-elev">
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'rgba(255,255,255,.55)', marginBottom: 4 }}>
              {t('chart.elevChartTitle')}
            </div>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center' }}>
              <ElevationChart profile={profile} colors={ELEV_COLORS} height={200} gain={gain} loss={loss} />
            </div>
          </div>
        )}
      </div>

      {status === 'ready' && (
        <div style={{ padding: '10px 16px 16px', borderTop: '1px solid rgba(255,255,255,.08)',
          display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => setPlaying((v) => !v)} aria-label={playing ? t('view3d.pause') : t('view3d.play')}
            style={{ width: 40, height: 40, borderRadius: '50%', border: 'none', background: 'var(--rp-gold)',
              color: '#161200', fontSize: 15, cursor: 'pointer', flex: '0 0 auto',
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {playing ? '⏸' : '▶'}
          </button>
          <input ref={scrubRef} type="range" min={0} max={1000} defaultValue={0} onChange={onScrub}
            style={{ flex: 1, accentColor: '#C9A24B' }} />
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.7)', minWidth: 46, textAlign: 'end' }}>
            <span ref={distRef}>0</span>
          </div>
        </div>
      )}
    </div>
  ), document.body);
}

window.Route3DView = Route3DView;
