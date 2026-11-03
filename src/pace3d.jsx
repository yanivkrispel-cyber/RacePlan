// pace3d.jsx — the pace profile in 3D for the lime skin: "a ribbon of light and a curtain" (Kris, 3.11.2026, option B of
// https://claude.ai/artifact/GmHP11mhXbg4X4BZ5R6P92). The stepped pace line is a tube of light with a curtain of light
// down to the floor (faster = higher), the elevation a grey ribbon and curtain behind it, the segment boundaries glass
// panes with a lime handle. After the athletes app's trends3d stage (read only): small tilt from above, slight side
// angle, a sideways drag turns the scene and it springs back, HTML labels that follow points, nothing drawn while idle.
//
//   window.PaceChart3D — same props as PaceChart. Draws PaceChart until three.js is ready, and stays on it when
//                        WebGL is missing. Dragging a handle moves a boundary exactly like the 2D chart
//                        (window.adjustSegmentBoundary, snapping to the course's peaks and valleys).

const P3_I18N = window.I18N;
const p3t = (k, p) => (P3_I18N && P3_I18N.t ? P3_I18N.t(k, p) : k);
const P3U = window.UNITS;
const p3pace = (s) => (P3U ? P3U.fmtPace(s) : window.formatPace(s));
const p3dist = (d) => (P3U ? P3U.dispDistNum(d) : window.formatKm(d));

const P3W = 8;            // scene width for the whole course
const P3BG = 0x050605;
const P3LIME = 0xDDFF4A;
const SNAP_SCENE = 0.012; // snap to a peak/valley within this share of the course

if (window.RP_LIME && !document.getElementById('rp-pace3d-styles')) {
  const s = document.createElement('style');
  s.id = 'rp-pace3d-styles';
  s.textContent = `
  .rp-p3{position:relative;width:100%;border-radius:14px;overflow:hidden;background:#050605;touch-action:pan-y;
    cursor:grab;user-select:none;-webkit-user-select:none}
  .rp-p3:active{cursor:grabbing}
  .rp-p3 canvas{display:block;width:100%;height:100%}
  .rp-p3-tags{position:absolute;inset:0;pointer-events:none}
  .rp-p3-tg{position:absolute;transform:translate(-50%,-100%);white-space:nowrap;font-family:var(--rp-font-mono);font-weight:700;
    font-size:11px;color:#eaff9a;text-shadow:0 0 8px rgba(5,6,5,.95),0 0 2px rgba(5,6,5,.95);font-variant-numeric:tabular-nums;
    unicode-bidi:isolate;direction:ltr}
  .rp-p3-tg.sel{color:#DDFF4A;font-size:12.5px}
  .rp-p3-tg.ax{transform:translate(-50%,0);color:var(--rp-text-dim);font-weight:500;font-size:10px}
  .rp-p3-tg.avg{font-family:var(--rp-font-ui);direction:inherit;color:var(--rp-text);font-weight:500;font-size:10.5px;
    background:rgba(5,6,5,.72);border:1px solid var(--rp-line);border-radius:6px;padding:1px 6px;transform:translate(-100%,-50%)}
  .rp-p3-read{position:absolute;top:8px;inset-inline-start:10px;font-size:11.5px;color:var(--rp-text);background:rgba(5,6,5,.82);
    border:1px solid var(--rp-gold-line);border-radius:8px;padding:3px 9px;pointer-events:none;display:flex;flex-direction:column;
    gap:1px;font-variant-numeric:tabular-nums}
  .rp-p3-read b{font-family:var(--rp-font-mono);color:var(--rp-gold)}
  .rp-p3-read span{color:var(--rp-text-dim);font-size:10.5px}
  `;
  document.head.appendChild(s);
}

function p3HasWebGL() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl') || c.getContext('experimental-webgl')); }
  catch (e) { return false; }
}

/** The scene, built once per mount; `update(model)` redraws it. Everything three.js lives here. */
function createPaceStage(THREE, el, tagsEl, handlers) {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const r = new THREE.WebGLRenderer({ antialias: true });
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  r.setClearColor(P3BG, 1);
  el.prepend(r.domElement);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
  const root = new THREE.Group(); scene.add(root);
  const target = V(0, 1.3, 0);
  const O = { halfW: P3W / 2 + 0.35, pad: 0.4, pitch: 0.2, yaw: -0.18 };
  let w = 0, h = 0, yaw = 0, mode = null, x0 = 0, hot = performance.now(), visible = true, fitted = false, dead = false;
  let model = null, handles = [], tags = [];
  const textures = [];

  const additive = (o) => Object.assign({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }, o);
  const geo = (pos, col, idx) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    if (idx) g.setIndex(idx);
    return g;
  };
  // one soft round sprite texture, shared by every handle glow
  const glowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.25, 'rgba(255,255,255,.5)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c); textures.push(t); return t;
  })();

  function curtain(pts, z, rgb, k, perVertex) { // light from the line down to the floor
    const p = [], c = [], idx = [];
    pts.forEach((q, i) => {
      const kk = perVertex ? perVertex[i] : k;
      p.push(q[0], q[1], z, q[0], 0, z);
      c.push(rgb[0] * kk, rgb[1] * kk, rgb[2] * kk, 0, 0, 0);
      if (i < pts.length - 1) { const o = i * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
    });
    root.add(new THREE.Mesh(geo(p, c, idx), new THREE.MeshBasicMaterial(additive({ vertexColors: true, side: THREE.DoubleSide }))));
  }
  function tag(html, pos, cls) {
    const s = document.createElement('div');
    s.className = 'rp-p3-tg ' + (cls || '');
    s.innerHTML = html;
    tagsEl.appendChild(s);
    tags.push({ s, pos: pos.clone() });
  }
  function clear() {
    root.traverse((m) => {
      if (m.geometry) m.geometry.dispose();
      const ms = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
      ms.forEach((x) => x.dispose());
    });
    while (root.children.length) root.remove(root.children[0]);
    tags.splice(0).forEach((t) => t.s.remove());
    handles = [];
  }

  function build() {
    clear();
    if (!model) return;
    const { rows, avgPace, total, elev, extrema, sel, drag } = model;
    const X = (d) => -P3W / 2 + (d / total) * P3W;
    const paces = rows.map((q) => q.paceSec);
    let lo = Math.min(...paces, avgPace), hi = Math.max(...paces, avgPace);
    const span = Math.max(hi - lo, 12); lo = (lo + hi) / 2 - span * 0.65; hi = (lo + span * 1.3);
    const YP = (p) => 0.35 + ((hi - p) / (hi - lo)) * 2.6; // faster = higher

    // elevation: grey ribbon and its curtain, behind the pace
    if (elev && elev.length > 1) {
      const eles = elev.map((q) => q.ele);
      let eLo = Math.min(...eles), eHi = Math.max(...eles);
      if (eHi - eLo < 60) { const m = (eHi + eLo) / 2; eLo = m - 30; eHi = m + 30; }
      const YA = (e) => 0.05 + ((e - eLo) / (eHi - eLo)) * 1.1;
      const pts = elev.map((q) => [X(q.d), YA(q.ele)]);
      const curve = new THREE.CatmullRomCurve3(pts.map((q) => V(q[0], q[1], -0.9)));
      root.add(new THREE.Mesh(new THREE.TubeGeometry(curve, Math.min(400, pts.length * 2), 0.012, 5, false),
        new THREE.MeshBasicMaterial({ color: 0xa9b09f, transparent: true, opacity: 0.85 })));
      curtain(pts, -0.9, [0.56, 0.59, 0.53], 0.22);
      if (drag && extrema) {
        extrema.forEach((ex) => {
          const sp = new THREE.Sprite(new THREE.SpriteMaterial(additive({ map: glowTex, color: ex.kind === 'peak' ? 0xff7a8f : 0x7fb4ff })));
          sp.scale.set(0.22, 0.22, 1); sp.position.set(X(ex.d), YA(ex.ele), -0.9); sp.userData.noFit = true; root.add(sp);
        });
      }
    }

    // the pace: a tube of light, a halo, and a curtain down to the floor (the open segment brighter)
    const path = new THREE.CurvePath(), pts = [], bright = [];
    let prev = 0;
    rows.forEach((q, k) => {
      const y = YP(q.paceSec), a = V(X(prev), y, 0), b = V(X(q.cumDist), y, 0);
      if (k) { const lp = pts[pts.length - 1]; path.add(new THREE.LineCurve3(V(lp[0], lp[1], 0), a)); }
      path.add(new THREE.LineCurve3(a, b));
      pts.push([a.x, y], [b.x, y]);
      const on = sel === k;
      bright.push(on ? 0.62 : 0.3, on ? 0.62 : 0.3);
      const wide = (q.cumDist - prev) / total > (rows.length > 12 ? 0.09 : 0.045);
      if (wide || on) tag(p3pace(q.paceSec), V((a.x + b.x) / 2, y + 0.1, 0), on ? 'sel' : '');
      prev = q.cumDist;
    });
    const segsN = Math.min(1600, rows.length * 120);
    root.add(new THREE.Mesh(new THREE.TubeGeometry(path, segsN, 0.022, 6, false), new THREE.MeshBasicMaterial({ color: 0xeaff9a })));
    root.add(new THREE.Mesh(new THREE.TubeGeometry(path, segsN, 0.07, 8, false), new THREE.MeshBasicMaterial(additive({ color: P3LIME, opacity: 0.3 }))));
    curtain(pts, -0.01, [0.867, 1, 0.29], 0.3, bright);

    // the average, dashed
    const ya = YP(avgPace);
    const al = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(-P3W / 2, ya, 0.03), V(P3W / 2, ya, 0.03)]),
      new THREE.LineDashedMaterial({ color: 0xF4F6EE, dashSize: 0.12, gapSize: 0.09, transparent: true, opacity: 0.6 }));
    al.computeLineDistances(); root.add(al);
    tag(p3t('chart3d.avg', { pace: '<bdi>' + p3pace(avgPace) + '</bdi>' }), V(P3W / 2 + 0.05, ya, 0.03), 'avg');

    // boundaries: glass panes, each with a handle (only when the plan can be reshaped here)
    const top = YP(lo + (hi - lo) * 0.08) + 0.3;
    if (model.canDrag) {
      rows.slice(0, -1).forEach((q, k) => {
        const on = drag && drag.k === k, xx = X(q.cumDist), pg = new THREE.PlaneGeometry(0.62, top);
        const pane = new THREE.Mesh(pg, new THREE.MeshBasicMaterial(additive({ color: P3LIME, opacity: on ? 0.12 : 0.045, side: THREE.DoubleSide })));
        pane.rotation.y = Math.PI / 2; pane.position.set(xx, top / 2, 0); pane.userData.noFit = true; root.add(pane);
        const e = new THREE.LineSegments(new THREE.EdgesGeometry(pg), new THREE.LineBasicMaterial({ color: P3LIME, transparent: true, opacity: on ? 0.7 : 0.22 }));
        e.rotation.copy(pane.rotation); e.position.copy(pane.position); e.userData.noFit = true; root.add(e);
        const hm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.44, 0.1), new THREE.MeshBasicMaterial({ color: on ? 0xf6ffd0 : P3LIME }));
        hm.position.set(xx, top * 0.5, 0); root.add(hm);
        const gs = new THREE.Sprite(new THREE.SpriteMaterial(additive({ map: glowTex, color: P3LIME })));
        gs.scale.set(on ? 0.9 : 0.55, on ? 0.9 : 0.55, 1); gs.position.copy(hm.position); gs.userData.noFit = true; root.add(gs);
        handles.push(V(xx, top * 0.5, 0));
      });
    }

    // km along the floor, and the floor grid
    const step = total <= 6 ? 1 : total <= 16 ? 2 : total <= 25 ? 5 : 10;
    for (let d = 0; d <= total + 1e-6; d += step) tag(String(p3dist(d)), V(X(d), 0, 0.55), 'ax');
    const grid = new THREE.GridHelper(P3W + 1.2, 20, 0x2a3420, 0x161b11);
    grid.scale.z = 2.6 / (P3W + 1.2); grid.position.y = 0.002; grid.userData.noFit = true; root.add(grid);
    model.X = X;
    hot = performance.now();
  }

  function size() {
    w = el.clientWidth; h = el.clientHeight;
    if (!w || !h) return;
    r.setSize(w, h, false); cam.aspect = w / h; cam.clearViewOffset(); fitted = false; hot = performance.now();
  }
  const box = new THREE.Box3(), cn = new THREE.Vector3();
  function fitV() { // centre what's drawn vertically in the frame
    box.makeEmpty();
    root.children.forEach((c) => { if (!c.userData.noFit) box.expandByObject(c); });
    if (box.isEmpty()) return;
    let lo = 1e9, hi = -1e9;
    for (let i = 0; i < 8; i++) {
      cn.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(cam);
      const y = ((1 - cn.y) / 2) * h; lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
    cam.setViewOffset(w, h, 0, (lo + hi) / 2 - h / 2 + 6, w, h);
    fitted = true;
  }
  function place() {
    const hf = 2 * Math.atan(Math.tan((cam.fov * Math.PI) / 360) * cam.aspect);
    const R = O.halfW / Math.tan(hf / 2) + O.pad, a = O.yaw + yaw, p = O.pitch;
    cam.position.set(target.x + Math.sin(a) * Math.cos(p) * R, target.y + Math.sin(p) * R, target.z + Math.cos(a) * Math.cos(p) * R);
    cam.lookAt(target);
  }
  const v = new THREE.Vector3();
  function frame(now) {
    if (dead) return;
    requestAnimationFrame(frame);
    if (!visible || !w) return;
    if (mode === null && Math.abs(yaw) < 0.002 && now - hot > 900 && fitted) return; // idle: draw nothing
    if (mode === null) yaw *= 0.9; else if (mode !== 'turn') yaw *= 0.8;
    if (!fitted) { yaw = 0; place(); cam.clearViewOffset(); cam.updateMatrixWorld(); fitV(); }
    place(); r.render(scene, cam);
    tags.forEach((t) => {
      const b = t.s.getBoundingClientRect(); v.copy(t.pos).project(cam);
      const ax = t.s.classList.contains('ax'), avg = t.s.classList.contains('avg');
      const hw = avg ? 4 : b.width / 2 + 4;
      const x = avg ? Math.min(w - 6, (v.x + 1) / 2 * w) : Math.max(hw, Math.min(w - hw, ((v.x + 1) / 2) * w));
      let y = ((1 - v.y) / 2) * h;
      y = Math.max(ax ? 4 : b.height + 4, Math.min(h - (ax ? b.height + 4 : 4), y));
      t.s.style.left = x + 'px'; t.s.style.top = y + 'px';
    });
  }

  // pointer: a handle drags its boundary, anything else turns the scene a little
  const rc = new THREE.Raycaster(), hit = new THREE.Vector3(), plane = new THREE.Plane(V(0, 0, 1), 0);
  const local = (e) => { const b = el.getBoundingClientRect(); return { px: e.clientX - b.left, py: e.clientY - b.top, b }; };
  function onDown(e) {
    hot = performance.now(); x0 = e.clientX; mode = 'turn';
    const q = local(e);
    let best = -1, bd = 1e9;
    handles.forEach((hp, k) => {
      v.copy(hp).project(cam);
      const dx = Math.abs(((v.x + 1) / 2) * w - q.px), dy = Math.abs(((1 - v.y) / 2) * h - q.py);
      if (dx < 22 && dy < h * 0.42 && dx < bd) { bd = dx; best = k; }
    });
    if (best >= 0) { mode = best; handlers.start(best); try { el.setPointerCapture(e.pointerId); } catch (err) {} }
  }
  function onMove(e) {
    if (mode === null) return;
    hot = performance.now();
    if (mode === 'turn') { yaw = Math.max(-0.7, Math.min(0.7, yaw + (e.clientX - x0) * 0.006)); x0 = e.clientX; return; }
    if (e.cancelable) e.preventDefault();
    const q = local(e);
    rc.setFromCamera(new THREE.Vector2((q.px / q.b.width) * 2 - 1, -(q.py / q.b.height) * 2 + 1), cam);
    if (!rc.ray.intersectPlane(plane, hit) || !model) return;
    let d = ((hit.x + P3W / 2) / P3W) * model.total;
    let snapped = false;
    if (model.extrema) {
      let bd = SNAP_SCENE * model.total;
      model.extrema.forEach((ex) => { const dd = Math.abs(ex.d - d); if (dd < bd) { bd = dd; d = ex.d; snapped = ex.kind; } });
    }
    handlers.move(mode, d, snapped);
  }
  function onUp() { if (mode !== null && mode !== 'turn') handlers.end(); mode = null; hot = performance.now(); }
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove, { passive: false });
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  const ro = new ResizeObserver(size); ro.observe(el);
  const io = new IntersectionObserver((en) => { visible = en[0].isIntersecting; hot = performance.now(); }, { rootMargin: '80px' });
  io.observe(el);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { hot = performance.now(); });
  size(); requestAnimationFrame(frame);
  // where the handles sit on screen (the screenshot test drags one)
  el._p3Handles = () => handles.map((hp) => { v.copy(hp).project(cam); return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h]; });

  return {
    update(m) { model = m; build(); fitted = fitted && !m.refit; },
    dispose() {
      dead = true; clear(); ro.disconnect(); io.disconnect();
      el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp);
      textures.forEach((t) => t.dispose()); r.dispose(); r.domElement.remove();
    },
  };
}

function PaceChart3D(props) {
  const { rows, avgPace, totalDist, height = 230, elevationProfile, showElevation, interactive, segments,
    extrema, onSegmentsChange, highlight } = props;
  const Flat = window.PaceChart;
  const [ready, setReady] = React.useState(false);
  const [failed, setFailed] = React.useState(() => !p3HasWebGL());
  const [drag, setDrag] = React.useState(null); // {k, d, snapped}
  const hostRef = React.useRef(null), tagsRef = React.useRef(null), stageRef = React.useRef(null);
  const dragRef = React.useRef(null);
  const live = React.useRef(props); live.current = props;

  const canDrag = !!(interactive && segments && segments.length > 1 && typeof onSegmentsChange === 'function'
    && Array.isArray(elevationProfile));

  React.useEffect(() => {
    if (failed || !window.ensureThree) { if (!window.ensureThree) setFailed(true); return undefined; }
    let gone = false;
    window.ensureThree().then((THREE) => {
      if (gone || !hostRef.current) return;
      try {
        stageRef.current = createPaceStage(THREE, hostRef.current, tagsRef.current, {
          start(k) {
            const P = live.current;
            dragRef.current = { k, segs: P.segments.map((s) => ({ ...s })), raf: 0, pending: null };
            setDrag({ k, d: P.rows[k].cumDist, snapped: false });
            try { if (navigator.vibrate) navigator.vibrate(6); } catch (e) {}
          },
          move(k, d, snapped) {
            const st = dragRef.current; if (!st) return;
            st.pending = d;
            setDrag({ k, d, snapped });
            if (!st.raf) st.raf = requestAnimationFrame(() => {
              st.raf = 0;
              const P = live.current;
              P.onSegmentsChange(window.adjustSegmentBoundary(st.segs, P.elevationProfile, st.k, st.pending));
            });
          },
          end() {
            const st = dragRef.current; if (!st) return;
            if (st.raf) cancelAnimationFrame(st.raf);
            const P = live.current;
            if (st.pending != null) P.onSegmentsChange(window.adjustSegmentBoundary(st.segs, P.elevationProfile, st.k, st.pending));
            dragRef.current = null; setDrag(null);
          },
        });
        setReady(true);
      } catch (e) { setFailed(true); }
    }).catch(() => { if (!gone) setFailed(true); });
    return () => { gone = true; if (stageRef.current) { stageRef.current.dispose(); stageRef.current = null; } };
  }, [failed]);

  // the elevation the 2D chart would draw (smoothed, thinned to what a curtain needs)
  const elev = React.useMemo(() => {
    if (!showElevation || !Array.isArray(elevationProfile)) return null;
    const raw = elevationProfile.filter((p) => isFinite(p.ele) && isFinite(p.d));
    if (raw.length < 2) return null;
    const sm = window.smoothElevProfile ? window.smoothElevProfile(raw) : raw;
    const k = Math.max(1, Math.ceil(sm.length / 260));
    const out = sm.filter((_, i) => i % k === 0);
    if (out[out.length - 1] !== sm[sm.length - 1]) out.push(sm[sm.length - 1]);
    const last = out[out.length - 1].d || totalDist;
    return out.map((p) => ({ d: (p.d / last) * totalDist, ele: p.ele }));
  }, [elevationProfile, showElevation, totalDist]);

  const elevKey = elev ? elev.length : 0;
  const prevShape = React.useRef('');
  React.useEffect(() => {
    if (!ready || !stageRef.current || !rows.length) return;
    const shape = rows.length + '|' + elevKey + '|' + canDrag;
    const refit = shape !== prevShape.current; prevShape.current = shape;
    stageRef.current.update({ rows, avgPace, total: totalDist || 1, elev, extrema: canDrag ? extrema : null,
      sel: highlight, drag, canDrag, refit });
  }, [ready, rows, avgPace, totalDist, elev, extrema, highlight, drag, canDrag]);

  if (failed && Flat) return <Flat {...props} />;

  let read = null;
  if (drag && dragRef.current) {
    const nx = window.adjustSegmentBoundary(dragRef.current.segs, elevationProfile, drag.k, drag.d);
    const a = nx[drag.k], b = nx[drag.k + 1];
    if (a && b) {
      read = (
        <div className="rp-p3-read">
          <span>{drag.snapped === 'peak' ? p3t('chart.snapPeak') : drag.snapped === 'valley' ? p3t('chart.snapValley')
            : (P3U ? P3U.fmtDist(drag.d) : window.formatKm(drag.d))}</span>
          <b dir="ltr">{p3dist(a.distance)} · {p3pace(a.paceSec)}  |  {p3dist(b.distance)} · {p3pace(b.paceSec)}</b>
        </div>
      );
    }
  }

  const H = Math.max(height + 6, 205);
  return (
    <div style={{ position: 'relative', width: '100%', height: H }}>
      {!ready && Flat && <div style={{ position: 'absolute', inset: 0 }}><Flat {...props} height={H} /></div>}
      <div ref={hostRef} className="rp-p3" role="img" aria-label={p3t('chart.title')}
        style={{ position: 'absolute', inset: 0, visibility: ready ? 'visible' : 'hidden' }}>
        <div ref={tagsRef} className="rp-p3-tags" />
        {read}
      </div>
    </div>
  );
}

window.PaceChart3D = PaceChart3D;
