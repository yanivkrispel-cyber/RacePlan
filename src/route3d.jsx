// route3d.jsx — an immersive 3D flyover of the route: the GPX track drawn as
// an elevation-exaggerated road (so real climbs/descents are actually
// visible as relief, not just implied by color), paved like real pavement
// with the "blue line" elite marathons paint down the tangent for the TV
// broadcast (Boston, NYC, Berlin, ...), with a runner marker that flies
// along it at the plan's real relative pace — faster on downhill/fast
// segments, slower on climbs — compressed into a short, watchable loop.
// Drag to orbit, wheel/pinch to zoom, or scrub.
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

// A small procedural canvas texture: dark asphalt with the "blue line" world
// marathons paint down the tangent (shortest-route) line, for that unmistakable
// broadcast-course look. Tiled along the road's length via UVs baked directly
// into the strip geometry below (so the line itself always reads as one
// continuous stripe — only the asphalt speckle repeats).
function makeRoadTexture(THREE) {
  const w = 128, h = 64;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3c3f45';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${(Math.random() * 0.12).toFixed(2)})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1.4, 1.4);
  }
  const lineH = h * 0.16;
  ctx.fillStyle = '#1E6FEB';
  ctx.fillRect(0, h / 2 - lineH / 2, w, lineH);
  ctx.fillStyle = 'rgba(255,255,255,.2)';
  ctx.fillRect(0, h / 2 - lineH / 2, w, lineH * 0.28);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  return tex;
}

function _fmtClock(totalSec) {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

// The stable (side, up) frame at sample index i — world-up × tangent, same
// construction buildRoadStrips uses below, reused here to plant gates and
// split signs flush with the road's own orientation at that point.
function frameAt(THREE, points, i) {
  const n = points.length;
  const up = new THREE.Vector3(0, 1, 0);
  const prev = points[Math.max(0, i - 1)], next = points[Math.min(n - 1, i + 1)];
  const tangent = new THREE.Vector3().subVectors(next, prev);
  if (tangent.lengthSq() < 1e-8) tangent.set(1, 0, 0); else tangent.normalize();
  const side = new THREE.Vector3().crossVectors(up, tangent);
  if (side.lengthSq() < 1e-8) side.set(1, 0, 0); else side.normalize();
  const localUp = new THREE.Vector3().crossVectors(tangent, side).normalize();
  return { tangent, side, up: localUp };
}

// A start/finish arch: two posts planted either side of the road plus a
// banner spanning between them near the top, textured with the given label.
// `checkered` swaps the banner background for a finish-flag check pattern.
function makeBannerTexture(THREE, label, checkered) {
  const w = 512, h = 160;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (checkered) {
    const cell = 20;
    for (let y = 0; y < h; y += cell) {
      for (let x = 0; x < w; x += cell) {
        ctx.fillStyle = ((x / cell + y / cell) % 2 === 0) ? '#12141a' : '#f4f2ea';
        ctx.fillRect(x, y, cell, cell);
      }
    }
    ctx.fillStyle = 'rgba(10,12,18,.74)';
    ctx.fillRect(0, h * 0.3, w, h * 0.4);
  } else {
    ctx.fillStyle = '#1E6FEB';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.fillRect(0, 0, w, h * 0.5);
  }
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 74px Heebo, system-ui, sans-serif';
  ctx.fillText(label, w / 2, h / 2 + 4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

function buildGate(THREE, points, index, roadWidth, roadThickness, label, checkered, postColor) {
  const { tangent, side, up } = frameAt(THREE, points, index);
  const base = points[index];
  const postHeight = roadWidth * 3.2;
  const postRadius = roadWidth * 0.05;
  const halfSpan = roadWidth / 2 + roadWidth * 0.18;

  const group = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({ color: postColor, roughness: 0.55, metalness: 0.25 });
  const postGeo = new THREE.CylinderGeometry(postRadius, postRadius, postHeight, 10);
  [1, -1].forEach((sgn) => {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.copy(base).addScaledVector(side, sgn * halfSpan).addScaledVector(up, postHeight / 2 + roadThickness / 2);
    post.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    group.add(post);
  });

  const bannerWidth = halfSpan * 2;
  const bannerHeight = postHeight * 0.3;
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(bannerWidth, bannerHeight),
    new THREE.MeshStandardMaterial({ map: makeBannerTexture(THREE, label, checkered), side: THREE.DoubleSide, roughness: 0.85 }),
  );
  banner.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, tangent));
  banner.position.copy(base).addScaledVector(up, postHeight * 0.88 + roadThickness / 2);
  group.add(banner);
  return group;
}

// A roadside km-marker sign: a thin post with a camera-facing sprite on top
// (Sprite billboards automatically in Three.js, so the text always reads
// correctly regardless of orbit angle) showing the checkpoint's cumulative
// distance and cumulative planned time — the same pair of numbers a real
// pacing/split sign on a race course would carry.
function makeSignTexture(THREE, line1, line2) {
  const w = 300, h = 190;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f7f4ea';
  ctx.fillRect(0, 0, w, h);
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#12315c';
  ctx.strokeRect(5, 5, w - 10, h - 10);
  ctx.fillStyle = '#12315c';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 46px Heebo, system-ui, sans-serif';
  ctx.fillText(line1, w / 2, h * 0.4);
  ctx.font = '600 34px Heebo, system-ui, sans-serif';
  ctx.fillText(line2, w / 2, h * 0.74);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

function buildSplitSign(THREE, points, index, roadWidth, roadThickness, distText, timeText) {
  const { side, up } = frameAt(THREE, points, index);
  const base = points[index];
  const postHeight = roadWidth * 2.1;

  const group = new THREE.Group();
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(roadWidth * 0.035, roadWidth * 0.035, postHeight, 8),
    new THREE.MeshStandardMaterial({ color: 0x2a2e38, roughness: 0.7 }),
  );
  const sideOffset = roadWidth / 2 + roadWidth * 0.28;
  const basePos = base.clone().addScaledVector(side, sideOffset);
  post.position.copy(basePos).addScaledVector(up, postHeight / 2 + roadThickness / 2);
  post.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
  group.add(post);

  const signW = roadWidth * 1.5, signH = signW * (190 / 300);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeSignTexture(THREE, distText, timeText) }));
  sprite.scale.set(signW, signH, 1);
  sprite.position.copy(basePos).addScaledVector(up, postHeight + roadThickness / 2 + signH * 0.45);
  group.add(sprite);
  return group;
}

// Build a flat road ribbon following `points`, using a stable custom frame
// (world-up × tangent) rather than the curve's own Frenet frames — Frenet
// frames can twist/roll unpredictably along the long near-flat stretches a
// running route mostly consists of (invisible on a round tube, glaringly
// wrong on a flat slab). Returns the top driving surface (textured) plus two
// side walls so the road reads as a solid strip from any camera angle.
function buildRoadStrips(THREE, points, width, thickness, uMax) {
  const n = points.length;
  const up = new THREE.Vector3(0, 1, 0);
  const topL = [], topR = [], botL = [], botR = [];
  for (let i = 0; i < n; i++) {
    const prev = points[Math.max(0, i - 1)], next = points[Math.min(n - 1, i + 1)];
    const tangent = new THREE.Vector3().subVectors(next, prev);
    if (tangent.lengthSq() < 1e-8) tangent.set(1, 0, 0); else tangent.normalize();
    const side = new THREE.Vector3().crossVectors(up, tangent);
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0); else side.normalize();
    const localUp = new THREE.Vector3().crossVectors(tangent, side).normalize();
    const p = points[i];
    topL.push(p.clone().addScaledVector(side, width / 2).addScaledVector(localUp, thickness / 2));
    topR.push(p.clone().addScaledVector(side, -width / 2).addScaledVector(localUp, thickness / 2));
    botL.push(p.clone().addScaledVector(side, width / 2).addScaledVector(localUp, -thickness / 2));
    botR.push(p.clone().addScaledVector(side, -width / 2).addScaledVector(localUp, -thickness / 2));
  }

  function strip(a, b, vA, vB, textured) {
    const positions = [], uvs = [], indices = [];
    for (let i = 0; i < n; i++) {
      positions.push(a[i].x, a[i].y, a[i].z, b[i].x, b[i].y, b[i].z);
      const u = (i / (n - 1)) * (textured ? uMax : 1);
      uvs.push(u, vA, u, vB);
    }
    for (let i = 0; i < n - 1; i++) {
      const a0 = i * 2, b0 = i * 2 + 1, a1 = (i + 1) * 2, b1 = (i + 1) * 2 + 1;
      indices.push(a0, a1, b0, b0, a1, b1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  return {
    topGeo: strip(topL, topR, 0, 1, true),
    leftWallGeo: strip(topL, botL, 0, 1, false),
    rightWallGeo: strip(topR, botR, 0, 1, false),
  };
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

  // ── The road surface: a flat, paved ribbon with the "blue line" real
  // marathons paint down the tangent line for the broadcast cameras ──
  const roadWidth = Math.max(1.4, TARGET_SIZE * 0.024);
  const roadThickness = roadWidth * 0.22;
  const tubeRadius = roadWidth * 0.32; // scale reference for markers/shadow below
  const tubularSegments = Math.max(150, STEPS * 2);
  const roadWorldLength = totalKm * 1000 * scale;
  const repeatX = Math.max(4, Math.round(roadWorldLength / 6));
  const roadTexture = makeRoadTexture(THREE);
  const { topGeo, leftWallGeo, rightWallGeo } = buildRoadStrips(THREE, points, roadWidth, roadThickness, repeatX);

  scene.add(new THREE.Mesh(topGeo, new THREE.MeshStandardMaterial({
    map: roadTexture, roughness: 0.92, metalness: 0.02, side: THREE.DoubleSide,
  })));
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x1b1e26, roughness: 0.95 });
  scene.add(new THREE.Mesh(leftWallGeo, wallMat));
  scene.add(new THREE.Mesh(rightWallGeo, wallMat));

  // "Already run" reveal — a brighter overlay whose draw range grows with
  // progress, so the travelled portion visibly lights up while playing.
  const revealGeo = topGeo.clone();
  revealGeo.setDrawRange(0, 0);
  const revealMesh = new THREE.Mesh(revealGeo, new THREE.MeshStandardMaterial({
    map: roadTexture, emissive: 0x2a2010, emissiveIntensity: 0.55, roughness: 0.7, side: THREE.DoubleSide,
  }));
  scene.add(revealMesh);
  const revealIndexCount = revealGeo.index.count;
  const SURFACE_Y = roadThickness / 2 + 0.05; // lift markers/runner onto the road surface, not its centerline

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

  // ── Start / finish markers + gates ──
  const markerGeo = new THREE.SphereGeometry(tubeRadius * 1.8, 16, 16);
  const startMesh = new THREE.Mesh(markerGeo, new THREE.MeshStandardMaterial({ color: 0x8091BE, emissive: 0x1a1f33 }));
  startMesh.position.copy(points[0]); startMesh.position.y += SURFACE_Y;
  scene.add(startMesh);
  const finishMesh = new THREE.Mesh(markerGeo, new THREE.MeshStandardMaterial({ color: 0xC15A2E, emissive: 0x2a0f05 }));
  finishMesh.position.copy(points[points.length - 1]); finishMesh.position.y += SURFACE_Y;
  scene.add(finishMesh);

  scene.add(buildGate(THREE, points, 0, roadWidth, roadThickness, t('view3d.startGate'), false, 0x8091BE));
  scene.add(buildGate(THREE, points, points.length - 1, roadWidth, roadThickness, t('view3d.finishGate'), true, 0xC15A2E));

  // ── Split signs — one per interior plan-segment boundary, showing the
  // checkpoint's cumulative distance and cumulative planned time, like a
  // real course's pacing/km-marker signage ──
  (rows || []).slice(0, -1).forEach((r) => {
    const idx = Math.max(0, Math.min(points.length - 1, Math.round((r.cumDist / (totalDist || 1)) * (points.length - 1))));
    const distText = U ? U.fmtDist(r.cumDist) : `${r.cumDist.toFixed(1)} km`;
    scene.add(buildSplitSign(THREE, points, idx, roadWidth, roadThickness, distText, _fmtClock(r.cumTime)));
  });

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
    const pos = curve.getPointAt(Math.max(0, Math.min(1, frac)));
    runner.position.set(pos.x, pos.y + SURFACE_Y, pos.z);
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
  const elevChartRef = React.useRef(null);
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
          if (elevChartRef.current) elevChartRef.current.setProgress(frac * totalDist);
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
    if (elevChartRef.current) elevChartRef.current.setProgress(frac * totalDist);
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
              <ElevationChart ref={elevChartRef} profile={profile} colors={ELEV_COLORS} height={200} gain={gain} loss={loss} />
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
