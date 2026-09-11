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

// A procedural canvas texture: dark asphalt with the "blue line" world
// marathons paint down the tangent (shortest-route) line, for that unmistakable
// broadcast-course look. Tiled along the road's length via UVs baked directly
// into the strip geometry below. The speckle grain is drawn seamlessly (any
// dot near the left/right edge is mirrored across the opposite edge) so the
// repeat never shows a visible tiling seam — only the endlessly-repeating
// grain, never a hard line.
function makeRoadTexture(THREE) {
  const w = 512, h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3c3f45';
  ctx.fillRect(0, 0, w, h);

  const speck = (x, y, r, alpha, dark) => {
    ctx.fillStyle = `rgba(${dark ? '0,0,0' : '255,255,255'},${alpha.toFixed(2)})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  };
  for (let i = 0; i < 3200; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    const r = 0.5 + Math.random() * 1.2;
    const alpha = Math.random() * 0.11;
    const dark = Math.random() < 0.55;
    speck(x, y, r, alpha, dark);
    if (x < r * 2.5) speck(x + w, y, r, alpha, dark);
    if (x > w - r * 2.5) speck(x - w, y, r, alpha, dark);
  }

  const lineH = h * 0.15;
  ctx.fillStyle = '#1E6FEB';
  ctx.fillRect(0, h / 2 - lineH / 2, w, lineH);
  ctx.fillStyle = 'rgba(255,255,255,.22)';
  ctx.fillRect(0, h / 2 - lineH / 2, w, lineH * 0.26);

  // subtle white shoulder lines near each edge, like real road markings
  ctx.fillStyle = 'rgba(255,255,255,.42)';
  ctx.fillRect(0, h * 0.1, w, h * 0.016);
  ctx.fillRect(0, h * 0.884, w, h * 0.016);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

function _fmtClock(totalSec) {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

// The stable (side, up) frame at fraction u along the smooth curve — world-up
// × tangent, sampled directly off the curve (not off the coarser polyline of
// resampled points) so gates and split signs sit flush with the same silky
// surface the road itself is now built from.
function frameAtU(THREE, curve, u) {
  const eps = 0.0025;
  const u0 = Math.max(0, u - eps), u1 = Math.min(1, u + eps);
  const p0 = curve.getPointAt(u0), p1 = curve.getPointAt(u1);
  const up = new THREE.Vector3(0, 1, 0);
  const tangent = new THREE.Vector3().subVectors(p1, p0);
  if (tangent.lengthSq() < 1e-10) tangent.set(1, 0, 0); else tangent.normalize();
  const side = new THREE.Vector3().crossVectors(up, tangent);
  if (side.lengthSq() < 1e-10) side.set(1, 0, 0); else side.normalize();
  const localUp = new THREE.Vector3().crossVectors(tangent, side).normalize();
  return { tangent, side, up: localUp, point: curve.getPointAt(u) };
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
  tex.anisotropy = 8;
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

function buildGate(THREE, curve, u, roadWidth, roadThickness, label, checkered, postColor) {
  const { tangent, side, up, point: base } = frameAtU(THREE, curve, u);
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
  tex.anisotropy = 8;
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

function buildSplitSign(THREE, curve, u, roadWidth, roadThickness, distText, timeText) {
  const { side, up, point: base } = frameAtU(THREE, curve, u);
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

// A dusk-toned sky dome — a huge inward-facing hemisphere with a
// vertex-colored gradient (dark zenith fading to a horizon tone) — instead of
// a flat void behind the scene. Kept out of the fog calculation (it sits at
// an "infinite" distance where the fog formula would otherwise just paint it
// a flat fog color, erasing the gradient) so foreground objects still fade
// naturally while the sky itself stays a real backdrop that turns with the
// camera as you orbit. Per-vertex height weights are precomputed once so
// `setColors` — called every frame to drive the day/weather atmosphere — is
// just a cheap lerp per vertex, no trig/pow recomputation.
function makeSkyDome(THREE, radius) {
  const geo = new THREE.SphereGeometry(radius, 64, 40, 0, Math.PI * 2, 0, Math.PI / 2 + 0.2);
  const posAttr = geo.attributes.position;
  const weights = new Float32Array(posAttr.count);
  for (let i = 0; i < posAttr.count; i++) {
    const yNorm = Math.max(0, Math.min(1, posAttr.getY(i) / radius));
    weights[i] = Math.pow(yNorm, 1.6);
  }
  const colorAttr = new THREE.BufferAttribute(new Float32Array(posAttr.count * 3), 3);
  geo.setAttribute('color', colorAttr);
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  const mix = new THREE.Color();
  function setColors(topColor, horizonColor) {
    const arr = colorAttr.array;
    for (let i = 0; i < weights.length; i++) {
      mix.copy(horizonColor).lerp(topColor, weights[i]);
      arr[i * 3] = mix.r; arr[i * 3 + 1] = mix.g; arr[i * 3 + 2] = mix.b;
    }
    colorAttr.needsUpdate = true;
  }
  return { mesh, setColors };
}

// Day/night colour keyframes (hour-of-day -> palette). Interpolated linearly
// between the two bracketing keyframes so the scene's light can move
// smoothly through the actual clock time the plan covers — from the race's
// real start time to its real (estimated) finish time — rather than being a
// generic, meaningless sunrise-to-sunset sweep.
const DAY_KEYFRAMES = [
  { h: 0, top: 0x03040a, horizon: 0x0a0a18, sun: 0x1a2035, sunI: 0.15, hemiSky: 0x1b2440, hemiGround: 0x0c0a10, hemiI: 0.35 },
  { h: 5.5, top: 0x0b1330, horizon: 0x5a3a52, sun: 0xff9d6c, sunI: 0.55, hemiSky: 0x445088, hemiGround: 0x2c1f1a, hemiI: 0.55 },
  { h: 7, top: 0x1c355e, horizon: 0xffb37a, sun: 0xffdaa8, sunI: 0.95, hemiSky: 0x6d84b8, hemiGround: 0x33291d, hemiI: 0.75 },
  { h: 12, top: 0x2f6fb8, horizon: 0xbcd6ee, sun: 0xffffff, sunI: 1.15, hemiSky: 0x8fa8d8, hemiGround: 0x362b20, hemiI: 0.9 },
  { h: 17, top: 0x2a5490, horizon: 0xffc98a, sun: 0xffdca0, sunI: 0.95, hemiSky: 0x7690c0, hemiGround: 0x362a1e, hemiI: 0.85 },
  { h: 19, top: 0x14203f, horizon: 0xd8683f, sun: 0xff7a4c, sunI: 0.6, hemiSky: 0x445088, hemiGround: 0x2c1f1a, hemiI: 0.6 },
  { h: 21, top: 0x080b1c, horizon: 0x2c2040, sun: 0x3a2a44, sunI: 0.2, hemiSky: 0x232c50, hemiGround: 0x140f14, hemiI: 0.4 },
  { h: 24, top: 0x03040a, horizon: 0x0a0a18, sun: 0x1a2035, sunI: 0.15, hemiSky: 0x1b2440, hemiGround: 0x0c0a10, hemiI: 0.35 },
];
function daylightAt(hour) {
  const h = ((hour % 24) + 24) % 24;
  let a = DAY_KEYFRAMES[0], b = DAY_KEYFRAMES[1];
  for (let i = 0; i < DAY_KEYFRAMES.length - 1; i++) {
    if (h >= DAY_KEYFRAMES[i].h && h <= DAY_KEYFRAMES[i + 1].h) { a = DAY_KEYFRAMES[i]; b = DAY_KEYFRAMES[i + 1]; break; }
  }
  const f = b.h > a.h ? (h - a.h) / (b.h - a.h) : 0;
  return { f, a, b };
}

// Real forecast weather (already fetched for the heat-adjusted-pace card)
// reused here to set the 3D scene's mood — this is the actual weather the
// plan expects on race day, not a decorative preset.
function weatherKindFromCode(code) {
  if (code == null) return 'clear';
  if (code === 0) return 'clear';
  if (code === 1 || code === 2 || code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  return 'rain'; // drizzle/rain/showers/snow/thunderstorm all read as "wet weather" visually
}
const WEATHER_FILTERS = {
  clear: { tint: 0x000000, tintAmount: 0, sunMult: 1, hemiMult: 1, fogMult: 1, wet: 0, rain: false },
  cloudy: { tint: 0x6b6f7a, tintAmount: 0.35, sunMult: 0.55, hemiMult: 1.1, fogMult: 1.4, wet: 0.12, rain: false },
  fog: { tint: 0x9aa3ad, tintAmount: 0.68, sunMult: 0.35, hemiMult: 1.15, fogMult: 6, wet: 0.08, rain: false },
  rain: { tint: 0x2a2e38, tintAmount: 0.5, sunMult: 0.4, hemiMult: 1.05, fogMult: 2.6, wet: 0.55, rain: true },
};

// A simple falling-rain particle volume, centered on the scene, active only
// when the real forecast calls for wet weather.
function buildRain(THREE, count, areaSize, height) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * areaSize;
    positions[i * 3 + 1] = Math.random() * height;
    positions[i * 3 + 2] = (Math.random() - 0.5) * areaSize;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0xbcd6ff, size: 0.55, transparent: true, opacity: 0.5, depthWrite: false });
  return { points: new THREE.Points(geo, mat), positions, count, height };
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
  const { track, profile, rows, totalDist, weather, raceTime } = data;
  if (!track || track.length < 2) throw new Error('route3d: no track');

  // ── Playback timing, computed early so the atmosphere pass below can map
  // animation progress to real clock time (race start hour -> estimated
  // finish hour). ──
  const checkpoints = [{ cumTime: 0, cumDist: 0 }].concat((rows || []).map((r) => ({ cumTime: r.cumTime, cumDist: r.cumDist })));
  const totalTime = checkpoints[checkpoints.length - 1].cumTime || 1;
  const speedMult = totalTime / TARGET_ANIM_SEC;
  const [startH, startM] = (raceTime || '07:00').split(':').map(Number);
  const startHour = (isFinite(startH) ? startH : 7) + (isFinite(startM) ? startM : 0) / 60;
  const finishHour = startHour + totalTime / 3600;
  const weatherKind = weatherKindFromCode(weather && weather.code);
  const weatherFilter = WEATHER_FILTERS[weatherKind] || WEATHER_FILTERS.clear;

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

  // The visible road is built from a DENSE resampling of this smooth curve —
  // not the coarser polyline of `points` — so it reads as one continuous
  // ribbon with no faceting at the original GPX vertices, and stays exactly
  // flush with the runner (which also travels via curve.getPointAt).
  const ROAD_STEPS = Math.max(300, Math.min(900, Math.round(totalKm * 60)));
  const roadPoints = [];
  for (let i = 0; i <= ROAD_STEPS; i++) roadPoints.push(curve.getPointAt(i / ROAD_STEPS));

  // ── Scene ──
  const BASE_FOG_DENSITY = 0.0022;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070d);
  scene.fog = new THREE.FogExp2(0x2e2438, BASE_FOG_DENSITY);
  const sky = makeSkyDome(THREE, 3000);
  scene.add(sky.mesh);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
  container.appendChild(renderer.domElement);

  const hemi = new THREE.HemisphereLight(0x565f92, 0x241c17, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe3b0, 1.0);
  sun.position.set(80, 65, -35);
  scene.add(sun);

  // A dark, subtly glossy floor (replaces a purely technical grid) plus a
  // faint grid overlay for scale reference, plus a soft, low-opacity mirrored
  // copy of the road's own surface beneath it — a cheap but effective hint of
  // reflection (a true planar-mirror render pass isn't worth the extra
  // complexity/cost here) that reads as "premium wet-look pavement" rather
  // than a CAD viewport.
  const FLOOR_Y = -0.42;
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x0a0c14, roughness: 0.22, metalness: 0.35 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(TARGET_SIZE * 9, TARGET_SIZE * 9), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  scene.add(floor);

  const grid = new THREE.GridHelper(TARGET_SIZE * 2.2, 22, 0x2a3346, 0x1a2030);
  grid.position.y = FLOOR_Y + 0.01;
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  scene.add(grid);

  // ── The road surface: a flat, paved ribbon with the "blue line" real
  // marathons paint down the tangent line for the broadcast cameras ──
  const roadWidth = Math.max(1.4, TARGET_SIZE * 0.024);
  const roadThickness = roadWidth * 0.22;
  const tubeRadius = roadWidth * 0.32; // scale reference for markers/shadow below
  const roadWorldLength = totalKm * 1000 * scale;
  const repeatX = Math.max(4, Math.round(roadWorldLength / 6));
  const roadTexture = makeRoadTexture(THREE);
  const { topGeo, leftWallGeo, rightWallGeo } = buildRoadStrips(THREE, roadPoints, roadWidth, roadThickness, repeatX);

  // Wet-weather forecasts make the pavement itself read as rain-slicked —
  // lower roughness / a touch of metalness reads as a sheen under the sun.
  const wet = weatherFilter.wet;
  scene.add(new THREE.Mesh(topGeo, new THREE.MeshStandardMaterial({
    map: roadTexture, roughness: 0.92 - wet * 0.55, metalness: 0.02 + wet * 0.35, side: THREE.DoubleSide,
  })));
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x1b1e26, roughness: 0.95 });
  scene.add(new THREE.Mesh(leftWallGeo, wallMat));
  scene.add(new THREE.Mesh(rightWallGeo, wallMat));

  // A soft, low-opacity mirrored copy of the road surface beneath the floor
  // plane — reflecting a mesh about a horizontal plane y=FLOOR_Y is just
  // `position.y = 2*FLOOR_Y, scale.y = -1` (see mount3D comment above).
  const reflMesh = new THREE.Mesh(topGeo.clone(), new THREE.MeshBasicMaterial({
    map: roadTexture, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide,
  }));
  reflMesh.position.y = FLOOR_Y * 2;
  reflMesh.scale.y = -1;
  scene.add(reflMesh);

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
  const groundCurve = new THREE.CatmullRomCurve3(roadPoints.map((p) => new THREE.Vector3(p.x, -0.35, p.z)));
  const groundGeo = new THREE.TubeGeometry(groundCurve, ROAD_STEPS, tubeRadius * 1.6, 6, false);
  scene.add(new THREE.Mesh(groundGeo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.26 })));

  const dropMat = new THREE.LineBasicMaterial({ color: 0x3a4258, transparent: true, opacity: 0.5 });
  const DROP_COUNT = 14;
  for (let i = 1; i < DROP_COUNT; i++) {
    const idx = Math.round((i / DROP_COUNT) * (roadPoints.length - 1));
    const top = roadPoints[idx];
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

  scene.add(buildGate(THREE, curve, 0, roadWidth, roadThickness, t('view3d.startGate'), false, 0x8091BE));
  scene.add(buildGate(THREE, curve, 1, roadWidth, roadThickness, t('view3d.finishGate'), true, 0xC15A2E));

  // ── Split signs — one per interior plan-segment boundary, showing the
  // checkpoint's cumulative distance and cumulative planned time, like a
  // real course's pacing/km-marker signage ──
  (rows || []).slice(0, -1).forEach((r) => {
    const u = Math.max(0, Math.min(1, r.cumDist / (totalDist || 1)));
    const distText = U ? U.fmtDist(r.cumDist) : `${r.cumDist.toFixed(1)} km`;
    scene.add(buildSplitSign(THREE, curve, u, roadWidth, roadThickness, distText, _fmtClock(r.cumTime)));
  });

  // ── The runner ──
  const runner = new THREE.Mesh(
    new THREE.SphereGeometry(tubeRadius * 2.2, 20, 20),
    new THREE.MeshStandardMaterial({ color: 0xF5C24A, emissive: 0x6b4a10, emissiveIntensity: 1.1 }),
  );
  runner.add(new THREE.PointLight(0xF5C24A, 1.1, TARGET_SIZE * 0.4));
  scene.add(runner);

  // ── Rain, only when the real forecast for race day calls for it ──
  const rain = weatherFilter.rain ? buildRain(THREE, 700, TARGET_SIZE * 2.6, TARGET_SIZE * 0.55) : null;
  if (rain) scene.add(rain.points);

  // ── Atmosphere: blends the day-cycle keyframes (mapped from the plan's
  // real start time through its real estimated finish time) with the real
  // forecast's weather filter, and pushes the result into the sky dome, sun,
  // hemisphere light and fog every frame — driven by the same progress
  // fraction that moves the runner, so scrubbing previews the sky too.
  const _tmp = new THREE.Color();
  const _cTop = new THREE.Color(), _cHorizon = new THREE.Color(), _cSun = new THREE.Color();
  const _cHemiSky = new THREE.Color(), _cHemiGround = new THREE.Color();
  function lerpInto(target2, hexA, hexB, f) { target2.setHex(hexA); _tmp.setHex(hexB); return target2.lerp(_tmp, f); }
  function applyAtmosphere(frac) {
    const hour = startHour + Math.max(0, Math.min(1, frac)) * (finishHour - startHour);
    const { f, a, b } = daylightAt(hour);
    lerpInto(_cTop, a.top, b.top, f);
    lerpInto(_cHorizon, a.horizon, b.horizon, f);
    lerpInto(_cSun, a.sun, b.sun, f);
    lerpInto(_cHemiSky, a.hemiSky, b.hemiSky, f);
    lerpInto(_cHemiGround, a.hemiGround, b.hemiGround, f);
    const sunI = a.sunI + (b.sunI - a.sunI) * f;
    const hemiI = a.hemiI + (b.hemiI - a.hemiI) * f;

    _tmp.setHex(weatherFilter.tint);
    _cTop.lerp(_tmp, weatherFilter.tintAmount);
    _cHorizon.lerp(_tmp, weatherFilter.tintAmount);

    sky.setColors(_cTop, _cHorizon);
    sun.color.copy(_cSun);
    sun.intensity = sunI * weatherFilter.sunMult;
    hemi.color.copy(_cHemiSky);
    hemi.groundColor.copy(_cHemiGround);
    hemi.intensity = hemiI * weatherFilter.hemiMult;
    scene.fog.color.copy(_cHorizon);
    scene.fog.density = BASE_FOG_DENSITY * weatherFilter.fogMult;
  }

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
    applyAtmosphere(frac);
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

    if (rain) {
      for (let i = 0; i < rain.count; i++) {
        rain.positions[i * 3 + 1] -= dt * 45;
        if (rain.positions[i * 3 + 1] < FLOOR_Y) rain.positions[i * 3 + 1] = rain.height;
      }
      rain.points.geometry.attributes.position.needsUpdate = true;
    }

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

function Route3DView({ track, profile, rows, totalDist, raceName, gain, loss, weather, raceTime, onClose }) {
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
        cleanupFn = mount3D(THREE, mountRef.current, { track, profile, rows, totalDist, weather, raceTime }, (frac) => {
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
