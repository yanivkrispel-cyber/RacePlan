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
const useEscape = window.useEscape || (() => {});
const U = window.UNITS;
const ElevationChart = window.ElevationChart;
const ClockDisplay = window.ClockDisplay;
// Local dark-chrome palette for the side elevation chart — kept local
// (no cross-module dependency, see map.jsx for the same habit) rather than
// pulling in planner-b.jsx's themeB.
const LIME3 = !!window.RP_LIME; // lime skin: the course line, curtain, runner and signs turn lime
const ELEV_COLORS = { line: LIME3 ? '#DDFF4A' : '#F5C24A', grid: 'rgba(255,255,255,.1)', textDim: 'rgba(255,255,255,.5)' };

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
const WIND_VIS_THRESHOLD_KMH = 18; // Beaufort ~4 "moderate breeze" — where a runner actually starts to feel it

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
  ctx.fillStyle = LIME3 ? '#22261c' : '#3c3f45';
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
  ctx.fillStyle = LIME3 ? '#DDFF4A' : '#1E6FEB';
  ctx.fillRect(0, h / 2 - lineH / 2, w, lineH);
  ctx.fillStyle = 'rgba(255,255,255,.22)';
  ctx.fillRect(0, h / 2 - lineH / 2, w, lineH * 0.26);

  // subtle white shoulder lines near each edge, like real road markings
  ctx.fillStyle = LIME3 ? 'rgba(221,255,74,.7)' : 'rgba(255,255,255,.42)';
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
// `subLabel` (the race name, on the finish arch) renders as a second, smaller
// line under the main label, shrunk to fit the banner width if needed.
function makeBannerTexture(THREE, label, checkered, subLabel) {
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
    ctx.fillRect(0, subLabel ? h * 0.16 : h * 0.3, w, subLabel ? h * 0.74 : h * 0.4);
  } else {
    ctx.fillStyle = LIME3 ? '#DDFF4A' : '#1E6FEB';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.fillRect(0, 0, w, h * 0.5);
  }
  ctx.fillStyle = LIME3 && !checkered ? '#050605' : '#ffffff';
  ctx.textAlign = 'center';
  if (subLabel) {
    ctx.textBaseline = 'alphabetic';
    ctx.font = '800 60px Heebo, system-ui, sans-serif';
    ctx.fillText(label, w / 2, h * 0.58);
    let subSize = 30;
    ctx.font = `600 ${subSize}px Heebo, system-ui, sans-serif`;
    while (subSize > 14 && ctx.measureText(subLabel).width > w * 0.88) {
      subSize -= 2;
      ctx.font = `600 ${subSize}px Heebo, system-ui, sans-serif`;
    }
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.fillText(subLabel, w / 2, h * 0.85);
  } else {
    ctx.textBaseline = 'middle';
    ctx.font = '700 74px Heebo, system-ui, sans-serif';
    ctx.fillText(label, w / 2, h / 2 + 4);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

function buildGate(THREE, curve, u, roadWidth, roadThickness, label, checkered, postColor, subLabel) {
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
    new THREE.MeshStandardMaterial({ map: makeBannerTexture(THREE, label, checkered, subLabel), side: THREE.DoubleSide, roughness: 0.85 }),
  );
  // Negating both `side` and `tangent` (keeping `up`) is a 180° turn around
  // the vertical axis: the banner's correctly-oriented (non-mirrored) face
  // ends up pointing toward -tangent — i.e. toward the runner approaching
  // from behind — instead of away from them, without flipping the text
  // upside down. A single-axis flip would look "fixed" but is actually a
  // mirror reflection, not a rotation, and warps the plane's geometry.
  banner.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side.clone().negate(), up, tangent.clone().negate()));
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
  ctx.fillStyle = LIME3 ? '#050605' : '#f7f4ea';
  ctx.fillRect(0, 0, w, h);
  ctx.lineWidth = 10;
  ctx.strokeStyle = LIME3 ? '#DDFF4A' : '#12315c';
  ctx.strokeRect(5, 5, w - 10, h - 10);
  ctx.fillStyle = LIME3 ? '#DDFF4A' : '#12315c';
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

// `sideSign` -1 moves the sign to the runner's right — used where the road
// has split into two lanes, so the sign doesn't stand in the opposite lane.
function buildSplitSign(THREE, curve, u, roadWidth, roadThickness, distText, timeText, sideSign = 1) {
  const { side, up, point: base } = frameAtU(THREE, curve, u);
  const postHeight = roadWidth * 2.1;

  const group = new THREE.Group();
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(roadWidth * 0.035, roadWidth * 0.035, postHeight, 8),
    new THREE.MeshStandardMaterial({ color: 0x2a2e38, roughness: 0.7 }),
  );
  const sideOffset = sideSign * (roadWidth / 2 + roadWidth * 0.28);
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

// Wind streaks — thin, glowing streamlines that flow in the real forecast
// wind's true compass direction (converted into this scene's local x/z axes)
// and speed, built only when the forecast clears WIND_VIS_THRESHOLD_KMH so a
// calm-weather race never pays for this. One static LineSegments buffer (a
// head+tail vertex pair per streak, wrapped along the wind axis exactly like
// buildRain wraps along y) — a whole gusty field is a single draw call, safe
// on mobile GPUs. Additive blending + a bright-head/dark-tail vertex-color
// gradient reads as a comet-trail without needing per-vertex alpha, which
// LineBasicMaterial's vertex colors don't support.
function buildWind(THREE, count, boxSize, baseY, boxHeight, dirVec) {
  const up = new THREE.Vector3(0, 1, 0);
  const axisU = dirVec.clone().normalize(); // the direction the air is moving
  const axisV = new THREE.Vector3().crossVectors(up, axisU).normalize(); // lateral spread axis
  const u = new Float32Array(count), v = new Float32Array(count), y = new Float32Array(count), len = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    u[i] = (Math.random() - 0.5) * boxSize;
    v[i] = (Math.random() - 0.5) * boxSize;
    y[i] = baseY + Math.random() * boxHeight;
    len[i] = 1.4 + Math.random() * 2.6;
  }
  const positions = new Float32Array(count * 6);
  const colors = new Float32Array(count * 6);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const lines = new THREE.LineSegments(geo, mat);
  const headC = new THREE.Color(0xbfe3ff), tailC = new THREE.Color(0x0e1826);
  function update(dt, speed, intensity) {
    const halfLen = boxSize / 2;
    for (let i = 0; i < count; i++) {
      u[i] += speed * dt;
      if (u[i] > halfLen) u[i] -= boxSize; // recycle streaks that drift past the far edge of the field
      const hx = axisU.x * u[i] + axisV.x * v[i], hz = axisU.z * u[i] + axisV.z * v[i];
      const tu = u[i] - len[i];
      const tx = axisU.x * tu + axisV.x * v[i], tz = axisU.z * tu + axisV.z * v[i];
      const idx = i * 6;
      positions[idx] = hx; positions[idx + 1] = y[i]; positions[idx + 2] = hz;
      positions[idx + 3] = tx; positions[idx + 4] = y[i]; positions[idx + 5] = tz;
      colors[idx] = headC.r * intensity; colors[idx + 1] = headC.g * intensity; colors[idx + 2] = headC.b * intensity;
      colors[idx + 3] = tailC.r * intensity; colors[idx + 4] = tailC.g * intensity; colors[idx + 5] = tailC.b * intensity;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }
  return { lines, update };
}

// A celebratory confetti burst, fired from the finish gate the moment the
// runner crosses it. All particles share one static Points buffer (park
// spent ones far below the floor rather than resizing arrays) — `burst(origin)`
// respawns the whole batch there with outward+upward velocities, `update(dt)`
// integrates gravity and reports whether any particle is still live.
function buildConfetti(THREE, count, spread, floorY) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const life = new Float32Array(count); // seconds remaining; <=0 = parked/inactive
  const PALETTE = LIME3 ? [0xDDFF4A, 0xF4F6EE, 0xFF5A36, 0xffffff] : [0xF5C24A, 0x1E6FEB, 0xC15A2E, 0xffffff];
  for (let i = 0; i < count; i++) positions[i * 3 + 1] = floorY - 999;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: spread * 0.14, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  const _c = new THREE.Color();
  function burst(origin) {
    for (let i = 0; i < count; i++) {
      positions[i * 3] = origin.x + (Math.random() - 0.5) * spread;
      positions[i * 3 + 1] = origin.y + Math.random() * spread * 0.5;
      positions[i * 3 + 2] = origin.z + (Math.random() - 0.5) * spread;
      const ang = Math.random() * Math.PI * 2, spd = (0.5 + Math.random() * 1.3) * spread;
      velocities[i * 3] = Math.cos(ang) * spd;
      velocities[i * 3 + 1] = (1.8 + Math.random() * 1.8) * spread;
      velocities[i * 3 + 2] = Math.sin(ang) * spd;
      life[i] = 1.5 + Math.random() * 0.9;
      _c.setHex(PALETTE[(Math.random() * PALETTE.length) | 0]);
      colors[i * 3] = _c.r; colors[i * 3 + 1] = _c.g; colors[i * 3 + 2] = _c.b;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }
  function update(dt) {
    let any = false;
    for (let i = 0; i < count; i++) {
      if (life[i] <= 0) continue;
      any = true;
      life[i] -= dt;
      velocities[i * 3 + 1] -= spread * 3.5 * dt; // gravity
      positions[i * 3] += velocities[i * 3] * dt;
      positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
      positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
      if (life[i] <= 0 || positions[i * 3 + 1] < floorY) { life[i] = 0; positions[i * 3 + 1] = floorY - 999; }
    }
    if (any) geo.attributes.position.needsUpdate = true;
    return any;
  }
  return { points, burst, update };
}

// Build a flat road ribbon following `points`, using a stable custom frame
// (world-up × tangent) rather than the curve's own Frenet frames — Frenet
// frames can twist/roll unpredictably along the long near-flat stretches a
// running route mostly consists of (invisible on a round tube, glaringly
// wrong on a flat slab). Returns the top driving surface (textured) plus two
// side walls so the road reads as a solid strip from any camera angle.
// `width` is one number, or one per point (narrower where the road splits
// into two lanes, see layoutPasses).
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
    const p = points[i], w = Array.isArray(width) ? width[i] : width;
    topL.push(p.clone().addScaledVector(side, w / 2).addScaledVector(localUp, thickness / 2));
    topR.push(p.clone().addScaledVector(side, -w / 2).addScaledVector(localUp, thickness / 2));
    botL.push(p.clone().addScaledVector(side, w / 2).addScaledVector(localUp, -thickness / 2));
    botR.push(p.clone().addScaledVector(side, -w / 2).addScaledVector(localUp, -thickness / 2));
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

// The "height curtain": a translucent gold wall hanging from the road's
// underside down to the floor, opaque at the road and fading out toward the
// ground, so how high every part of the course sits reads at a glance from
// any camera angle. A bright rim runs along its top edge, and the stretch the
// runner has already covered (uProgress) glows brighter, like the road's own
// reveal overlay. Plus a soft gold footprint on the floor where it lands.
// Shaders write display-space colors directly (no tone mapping), so the gold
// reads the same under every time-of-day/weather lighting.
function buildHeightCurtain(THREE, points, width, thickness, floorY) {
  const n = points.length;
  const gold = LIME3 ? new THREE.Color(0.867, 1.0, 0.29) : new THREE.Color(0.96, 0.76, 0.29);
  const group = new THREE.Group();

  const wallMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    uniforms: { uColor: { value: gold }, uProgress: { value: 0 }, uFloor: { value: floorY } },
    vertexShader: `
      attribute float aU; attribute float aTop;
      varying float vU; varying float vY; varying float vTop;
      void main() {
        vU = aU; vTop = aTop; vY = position.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uProgress, uFloor;
      varying float vU; varying float vY; varying float vTop;
      void main() {
        float h = clamp((vY - uFloor) / max(vTop - uFloor, 1e-3), 0.0, 1.0);
        float a = 0.06 + 0.58 * pow(h, 1.5);
        float rim = 1.0 - smoothstep(0.0, 0.3, vTop - vY);
        a += rim * 0.55;
        vec3 col = mix(uColor, vec3(1.0), rim * 0.3);
        float done = step(vU, uProgress);
        a *= mix(0.6, 1.0, done);
        col *= mix(0.82, 1.12, done);
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
      }`,
  });
  {
    const pos = [], uu = [], top = [], idx = [];
    for (let i = 0; i < n; i++) {
      const p = points[i], ty = p.y - thickness / 2, u = i / (n - 1);
      pos.push(p.x, ty, p.z, p.x, floorY, p.z);
      uu.push(u, u); top.push(ty, ty);
    }
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aU', new THREE.Float32BufferAttribute(uu, 1));
    geo.setAttribute('aTop', new THREE.Float32BufferAttribute(top, 1));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, wallMat);
    mesh.renderOrder = 5;
    group.add(mesh);
  }

  const traceMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false,
    uniforms: { uColor: { value: gold }, uProgress: { value: 0 } },
    vertexShader: `
      attribute float aU; attribute float aS;
      varying float vU; varying float vS;
      void main() { vU = aU; vS = aS; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uProgress;
      varying float vU; varying float vS;
      void main() {
        float core = pow(1.0 - abs(vS), 2.0);
        gl_FragColor = vec4(uColor, core * mix(0.35, 0.75, step(vU, uProgress)));
      }`,
  });
  {
    const up = new THREE.Vector3(0, 1, 0);
    const w = width * 0.9, y = floorY + 0.02;
    const pos = [], uu = [], ss = [], idx = [];
    for (let i = 0; i < n; i++) {
      const prev = points[Math.max(0, i - 1)], next = points[Math.min(n - 1, i + 1)];
      const tg = new THREE.Vector3(next.x - prev.x, 0, next.z - prev.z);
      if (tg.lengthSq() < 1e-10) tg.set(1, 0, 0); else tg.normalize();
      const side = new THREE.Vector3().crossVectors(up, tg).normalize();
      const p = points[i], u = i / (n - 1);
      pos.push(p.x + side.x * w, y, p.z + side.z * w, p.x - side.x * w, y, p.z - side.z * w);
      uu.push(u, u); ss.push(-1, 1);
    }
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aU', new THREE.Float32BufferAttribute(uu, 1));
    geo.setAttribute('aS', new THREE.Float32BufferAttribute(ss, 1));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, traceMat);
    mesh.renderOrder = 4;
    group.add(mesh);
  }

  return {
    group,
    setProgress(frac) { wallMat.uniforms.uProgress.value = frac; traceMat.uniforms.uProgress.value = frac; },
  };
}

// Resample the track to even distance steps (smooths out however the raw GPX
// points happened to be spaced) and attach interpolated elevation + a local
// planar (x, z) position in meters, anchored at the route's start point.
//
// The profile's distances come from the full-resolution GPX, but `track` is a
// separately thinned copy whose own length comes out shorter (thinning cuts
// corners and drops GPS jitter: ~1–2% on a watch recording, ~200 m over
// 15 km). Reading the profile at the thinned track's distance made every
// height drift further back along the route, so the two legs of an
// out-and-back stopped matching. Each sample is read at the same FRACTION of
// the profile's own length instead, from the same smoothed profile the
// elevation chart draws.
function buildSamples(track, profile, steps) {
  const cum = [0];
  for (let i = 1; i < track.length; i++) cum.push(cum[i - 1] + _haversineKm(track[i - 1], track[i]));
  const totalKm = cum[cum.length - 1] || 0.001;
  const lat0 = track[0][0], lon0 = track[0][1];
  const R = 6371000, rad = Math.PI / 180;
  const rawProfile = Array.isArray(profile) ? profile.filter((p) => isFinite(p.ele) && isFinite(p.d)) : [];
  const hasEle = rawProfile.length >= 2;
  const smooth = window.smoothElevProfile || ((d) => d);
  const prof = hasEle ? smooth(rawProfile) : null;
  const profKm = hasEle ? prof[prof.length - 1].d : 0;
  const toProfKm = profKm > 0 ? profKm / totalKm : 1;

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
    const ele = hasEle ? _interpEle(prof, dKm * toProfKm) : 0;
    const x = (lon - lon0) * rad * R * Math.cos(lat0 * rad);
    const z = -(lat - lat0) * rad * R;
    out.push({ dKm, x, z, ele });
  }
  return { samples: out, totalKm };
}

// Courses that run the same road more than once — out-and-backs, laps, a
// lollipop's stem — draw that road once per pass, and in 3D the passes land
// on top of each other: the road is drawn far wider than the few meters that
// separate the passes in reality. Any difference in their heights (a watch's
// barometer drifts a few meters over a race) then reads as two roads stacked
// one above the other. This lays the passes out so they read as one road:
//  - passes closer than SAME_ROAD_M are the same road and share one height
//    (the average of what each pass recorded there);
//  - passes in OPPOSITE directions that the drawn road would overlap become
//    two lanes, each moved to its own side — normally the runner's right,
//    or the side it already sits on when the two are on separate carriageways;
//  - passes in the SAME direction (laps) stay on one lane; each later lap
//    sits a hair higher so the coincident surfaces don't flicker.
// Everything tapers in and out over a few samples wherever the passes part
// ways; at a turnaround the two lanes meet in a rounded U-turn. Crossings
// (passes meeting at an angle) are left alone. Pure, on planar meters, so it
// can be tested without three.js.
const SAME_ROAD_M = 25;
const LANE_SHIFT = 0.33; // of the road width, each opposite lane's move to its side
const LANE_NARROW = 0.45; // a lane is drawn this fraction of the full road width
function layoutPasses(samples, roadWidthM) {
  const n = samples.length;
  const out = samples.map((s) => ({ x: s.x, z: s.z, ele: s.ele, lane: 0, lift: 0 }));
  if (n < 4 || !(roadWidthM > 0)) return out;

  const tx = new Array(n), tz = new Array(n), arc = [0];
  for (let i = 0; i < n; i++) {
    // over ±2 samples: a recorded track zig-zags at the sample scale
    const a = samples[Math.max(0, i - 2)], b = samples[Math.min(n - 1, i + 2)];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    tx[i] = dx / l; tz[i] = dz / l;
    if (i) arc.push(arc[i - 1] + Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z));
  }
  const reach = Math.max(SAME_ROAD_M, roadWidthM);
  // The route's own stretch around a sample is never "another pass".
  const skip = Math.max(150, 3 * reach);

  // One closest point per other pass within `reach`.
  const passes = [];
  for (let i = 0; i < n; i++) {
    const found = [];
    let run = null;
    for (let j = 0; j < n - 1; j++) {
      const a = samples[j], b = samples[j + 1];
      if (Math.abs((arc[j] + arc[j + 1]) / 2 - arc[i]) < skip) { if (run) { found.push(run); run = null; } continue; }
      const vx = b.x - a.x, vz = b.z - a.z, L2 = vx * vx + vz * vz;
      let f = L2 > 0 ? ((samples[i].x - a.x) * vx + (samples[i].z - a.z) * vz) / L2 : 0;
      f = Math.max(0, Math.min(1, f));
      const px = a.x + vx * f, pz = a.z + vz * f;
      const d = Math.hypot(samples[i].x - px, samples[i].z - pz);
      if (d < reach) {
        if (!run || d < run.d) {
          const L = Math.sqrt(L2) || 1;
          run = { d, px, pz, ele: a.ele + (b.ele - a.ele) * f, arc: arc[j] + (arc[j + 1] - arc[j]) * f,
            dot: tx[i] * (vx / L) + tz[i] * (vz / L) };
        }
      } else if (run) { found.push(run); run = null; }
    }
    if (run) found.push(run);
    passes.push(found);
  }

  // Raw per-sample targets, before tapering.
  const ramp = (d, full, none) => Math.max(0, Math.min(1, (none - d) / (none - full)));
  const wH = new Array(n).fill(0), eleT = samples.map((s) => s.ele);
  // lanes: a sideways target along each sample's own right-hand direction
  // (a scalar, so tapering it doesn't shrink it on a winding road)
  const wL = new Array(n).fill(0), lat = new Array(n).fill(0);
  const lift = new Array(n).fill(0), side = new Array(n).fill(0), oppSigned = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const same = passes[i].filter((p) => p.d < SAME_ROAD_M && Math.abs(p.dot) > 0.5);
    if (same.length) {
      eleT[i] = (samples[i].ele + same.reduce((acc, p) => acc + p.ele, 0)) / (same.length + 1);
      wH[i] = Math.max(...same.map((p) => ramp(p.d, SAME_ROAD_M * 0.6, SAME_ROAD_M)));
    }
    let opp = null;
    passes[i].forEach((p) => { if (p.dot < -0.5 && (!opp || p.d < opp.d)) opp = p; });
    if (opp) {
      wL[i] = ramp(opp.d, reach * 0.7, reach);
      // signed lateral position of the other pass: > 0 = on this pass's right
      oppSigned[i] = (opp.px - samples[i].x) * -tz[i] + (opp.pz - samples[i].z) * tx[i];
      side[i] = 1;
      lat[i] = oppSigned[i] / 2; // to the midline between the two passes
    }
    lift[i] = passes[i].filter((p) => p.dot > 0.5 && p.arc < arc[i]).length;
  }

  // Per stretch of lanes, pick the side: the runner's right, unless the other
  // pass already sits clearly to the right (separate carriageways laid out
  // the other way round) — then the left, so the two never cross over.
  for (let i = 0; i < n;) {
    if (!side[i]) { i++; continue; }
    let j = i, sum = 0;
    while (j < n && side[j]) { sum += oppSigned[j]; j++; }
    const dir = sum / (j - i) > roadWidthM * 0.25 ? -1 : 1;
    for (let k = i; k < j; k++) {
      // from the midline out to its side — never closer than the passes
      // already are (separate carriageways only ever move apart)
      lat[k] += dir * Math.max(LANE_SHIFT * roadWidthM, Math.abs(oppSigned[k]) / 2);
    }
    i = j;
  }

  // `alongOnly`: average only over neighbours heading the same way — the
  // sideways shift is measured in each sample's own frame, so it mustn't
  // leak around a U-turn into a sample facing the other way.
  const taper = (arr, alongOnly) => {
    let a = arr;
    for (let pass = 0; pass < 2; pass++) {
      a = a.map((_, i) => {
        let sum = 0, cnt = 0;
        for (let k = -3; k <= 3; k++) {
          const j = i + k;
          if (j < 0 || j >= n || (alongOnly && tx[i] * tx[j] + tz[i] * tz[j] < 0.3)) continue;
          sum += a[j]; cnt++;
        }
        return cnt ? sum / cnt : 0;
      });
    }
    return a;
  };
  const hW = taper(wH);
  const dEle = taper(eleT.map((e, i) => (e - samples[i].ele) * wH[i]));
  const lW = taper(wL);
  const side2 = taper(lat.map((v, i) => v * wL[i]), true);
  const up = taper(lift);
  for (let i = 0; i < n; i++) {
    out[i].ele = samples[i].ele + (hW[i] > 0 ? dEle[i] : 0);
    out[i].x = samples[i].x - tz[i] * side2[i]; // (-tz, tx) is the runner's right
    out[i].z = samples[i].z + tx[i] * side2[i];
    out[i].lane = lW[i];
    out[i].lift = up[i];
  }
  return out;
}

// All the Three.js scene setup, the animation loop and the pointer/wheel
// orbit-camera controls. Returns a cleanup function that tears everything
// down; mutates `stateRef.current` with a `playing` flag and a `seek(frac)`
// function the React shell can drive from its own controls.
// ── Real ground (lime, src/terrain3d.jsx): the terrain as a shaded map, the route as a ribbon of light on it with a
// light curtain down to the ground, start and finish as glows. Same frame and the same vertical scale as the route,
// so the road climbs the hill it really climbs. `groundW(x, z)` is the ground height at a world point.
const TER_TUBE_V = `attribute float aU; varying float vU; void main(){ vU = aU; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const TER_TUBE_F = `uniform float uProg, uDim, uA, uHead, uFeatOn; uniform vec2 uFeat; uniform vec3 uColor, uFeatColor; varying float vU;
  void main(){ float d = step(vU, uProg);
    float inF = uFeatOn * smoothstep(uFeat.x - 0.002, uFeat.x + 0.002, vU) * (1.0 - smoothstep(uFeat.y - 0.002, uFeat.y + 0.002, vU));
    vec3 base = mix(uColor, uFeatColor, inF);
    vec3 c = mix(base * mix(uDim, 1.0, inF * 0.7), base, d);
    float h = exp(-pow((vU - uProg) * uHead, 2.0)); c += vec3(0.9, 1.0, 0.75) * h * 0.8; gl_FragColor = vec4(c * uA, 1.0); }`;
const TER_CUR_V = `attribute float aU; attribute float aT; varying float vU; varying float vT;
  void main(){ vU = aU; vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const TER_CUR_F = `uniform float uProg, uBase, uLit; uniform vec3 uColor; varying float vU; varying float vT;
  void main(){ float d = step(vU, uProg); float a = pow(vT, 1.6) * (uBase + d * uLit); gl_FragColor = vec4(uColor * a, 1.0); }`;

function terGlowTexture(THREE) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.22, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function buildTerrainWorld(THREE, scene, o) {
  const { TER, scale, cx, cz, ex, roadPoints, roadWidth } = o;
  const additive = (x) => Object.assign({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }, x);
  const yOf = (e) => (e - TER.eMin) * scale * ex;
  const wx0 = (TER.minX - cx) * scale, wz0 = (TER.minZ - cz) * scale, ww = TER.W * scale, wh = TER.H * scale;
  const groundW = (x, z) => {
    const fx = ((x - wx0) / ww) * (TER.gx - 1), fy = ((z - wz0) / wh) * (TER.gy - 1);
    const x0 = Math.max(0, Math.min(TER.gx - 2, Math.floor(fx))), y0 = Math.max(0, Math.min(TER.gy - 2, Math.floor(fy)));
    const tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0)), G = TER.grid, w = TER.gx;
    return yOf(G[y0 * w + x0] * (1 - tx) * (1 - ty) + G[y0 * w + x0 + 1] * tx * (1 - ty) + G[(y0 + 1) * w + x0] * (1 - tx) * ty + G[(y0 + 1) * w + x0 + 1] * tx * ty);
  };

  // the ground: one mesh per height-grid point, the baked map on it
  const geo = new THREE.PlaneGeometry(ww, wh, TER.gx - 1, TER.gy - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let k = 0; k < TER.gx * TER.gy; k++) pos.setY(k, yOf(TER.grid[k]));
  pos.needsUpdate = true;
  geo.computeBoundingSphere();
  const tex = new THREE.CanvasTexture(TER.texture);
  tex.encoding = THREE.sRGBEncoding;
  tex.anisotropy = 8;
  const ground = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  ground.position.set(wx0 + ww / 2, 0, wz0 + wh / 2);
  scene.add(ground);

  // the plate's cut sides, so the ground reads as a block of land and not a floating sheet
  const base = -Math.max(1.2, (TER.eMax - TER.eMin) * scale * ex * 0.18);
  const wallPos = [], wallCol = [], wallIdx = [];
  const edge = (list) => {
    const start = wallPos.length / 3;
    list.forEach(([i, j], n) => {
      const x = wx0 + (i / (TER.gx - 1)) * ww, z = wz0 + (j / (TER.gy - 1)) * wh, y = yOf(TER.grid[j * TER.gx + i]);
      wallPos.push(x, y, z, x, base, z); wallCol.push(0.09, 0.11, 0.06, 0.02, 0.024, 0.02);
      if (n) { const b = start + (n - 1) * 2; wallIdx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    });
  };
  const top = [], bot = [], lef = [], rig = [];
  for (let i = 0; i < TER.gx; i++) { top.push([i, 0]); bot.push([i, TER.gy - 1]); }
  for (let j = 0; j < TER.gy; j++) { lef.push([0, j]); rig.push([TER.gx - 1, j]); }
  [top, bot, lef, rig].forEach(edge);
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3));
  wg.setAttribute('color', new THREE.Float32BufferAttribute(wallCol, 3));
  wg.setIndex(wallIdx);
  scene.add(new THREE.Mesh(wg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false })));
  const under = new THREE.Mesh(new THREE.PlaneGeometry(ww * 14, wh * 14), new THREE.MeshBasicMaterial({ color: 0x040504, toneMapped: false }));
  under.rotation.x = -Math.PI / 2; under.position.set(wx0 + ww / 2, base - 0.05, wz0 + wh / 2);
  scene.add(under);

  // the route: a core of light, a halo, and a curtain down to the ground; run part bright, the rest dimmed
  const lime = new THREE.Color(0xDDFF4A);
  const curve = new THREE.CatmullRomCurve3(roadPoints, false, 'centripetal');
  const TS = Math.min(3000, roadPoints.length * 3), RS = 6;
  const progU = [];
  const featColor = new THREE.Color(0xFFB547), feat = new THREE.Vector2(0, 0);
  [[roadWidth * 0.3, 1, 140, 0.5, false], [roadWidth * 0.7, 0.22, 60, 0.55, true]].forEach(([r, a, head, dim, glow]) => {
    const g = new THREE.TubeGeometry(curve, TS, r, RS, false);
    const n = g.attributes.position.count, au = new Float32Array(n);
    for (let v = 0; v < n; v++) au[v] = Math.floor(v / (RS + 1)) / TS;
    g.setAttribute('aU', new THREE.BufferAttribute(au, 1));
    const un = { uProg: { value: 0 }, uDim: { value: dim }, uA: { value: a }, uHead: { value: head }, uColor: { value: lime },
      uFeat: { value: feat }, uFeatOn: { value: 0 }, uFeatColor: { value: featColor } };
    const m = glow ? additive({ uniforms: un, vertexShader: TER_TUBE_V, fragmentShader: TER_TUBE_F })
      : { uniforms: un, vertexShader: TER_TUBE_V, fragmentShader: TER_TUBE_F, toneMapped: false };
    scene.add(new THREE.Mesh(g, new THREE.ShaderMaterial(m)));
    progU.push(un);
  });
  {
    const cp = [], au = [], at = [], idx = [];
    roadPoints.forEach((p, i) => {
      const u = i / (roadPoints.length - 1);
      cp.push(p.x, p.y, p.z, p.x, groundW(p.x, p.z) - 0.02, p.z); au.push(u, u); at.push(1, 0);
      if (i) { const b = (i - 1) * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
    g.setAttribute('aU', new THREE.Float32BufferAttribute(au, 1));
    g.setAttribute('aT', new THREE.Float32BufferAttribute(at, 1));
    g.setIndex(idx);
    const un = { uProg: { value: 0 }, uBase: { value: 0.2 }, uLit: { value: 0.36 }, uColor: { value: lime } };
    scene.add(new THREE.Mesh(g, new THREE.ShaderMaterial(additive({ uniforms: un, vertexShader: TER_CUR_V, fragmentShader: TER_CUR_F, side: THREE.DoubleSide }))));
    progU.push(un);
  }
  const glowTex = terGlowTexture(THREE);
  const glowAt = (p, color, size) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial(additive({ map: glowTex, color })));
    sp.scale.set(size, size, 1); sp.position.copy(p); scene.add(sp); return sp;
  };
  glowAt(roadPoints[0], 0xDDFF4A, roadWidth * 7);
  glowAt(roadPoints[roadPoints.length - 1], 0xF4F6EE, roadWidth * 7);
  return {
    groundW, glowAt, glowTex,
    setProgress(u) { progU.forEach((un) => { un.uProg.value = u; }); },
    // light one stretch of the route (a climb amber, a descent ice), `on` 0..1 fades it
    setFeature(f, on) {
      if (f) { feat.set(f.u0, f.u1); featColor.setHex(f.kind === 'climb' ? 0xFFB547 : 0x8FD0FF); }
      progU.forEach((un) => { if (un.uFeatOn) un.uFeatOn.value = on; });
    },
  };
}

// ── Cinema (lime + terrain): the cards over the scene, and the HTML tags that follow points in it ──
if (LIME3 && typeof document !== 'undefined' && !document.getElementById('rp-cine-styles')) {
  const st = document.createElement('style');
  st.id = 'rp-cine-styles';
  st.textContent = `
  .rp-cine-tags{position:absolute;inset:0;pointer-events:none;overflow:hidden}
  .rp-cine-tag{position:absolute;transform:translate(-50%,-100%);white-space:nowrap;font:700 10.5px/1.2 var(--rp-font-ui);
    color:#eef6d8;background:rgba(5,6,5,.62);border:1px solid rgba(221,255,74,.22);border-radius:6px;padding:2px 6px;
    text-shadow:0 0 6px rgba(5,6,5,.9);transition:opacity .2s}
  .rp-cine-tag.km{font-family:var(--rp-font-mono);font-size:9.5px;color:#cfd6c0;background:rgba(5,6,5,.5);border-color:rgba(255,255,255,.12);direction:ltr}
  .rp-cine-tag.climb{color:#FFB547;border-color:rgba(255,181,71,.45)}
  .rp-cine-tag.descent{color:#8fd0ff;border-color:rgba(143,208,255,.4)}
  .rp-cine-card{position:absolute;inset-inline:12px;bottom:12px;pointer-events:none;background:rgba(5,6,5,.8);
    border:1px solid rgba(221,255,74,.28);border-radius:16px;padding:10px 13px;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
    opacity:0;transform:translateY(8px);transition:opacity .35s ease,transform .35s ease;max-width:440px;margin-inline:auto}
  .rp-cine-card.on{opacity:1;transform:none}
  .rp-cine-card.compact{inset-inline-start:auto;inset-inline-end:8px;bottom:16px;max-width:min(64%,360px);padding:7px 10px;border-radius:12px}
  .rp-cine-card.compact .s{display:none}
  .rp-cine-card.compact .t{font-size:13px}
  .rp-cine-card.compact .k{font-size:9px;margin-bottom:3px}
  .rp-cine-card .k{font:700 10px/1 var(--rp-font-mono);letter-spacing:.16em;color:#DDFF4A;direction:ltr;text-align:start;display:block;margin-bottom:5px}
  .rp-cine-card.climb .k{color:#FFB547}.rp-cine-card.descent .k{color:#8fd0ff}
  .rp-cine-card .t{font:800 15px/1.3 var(--rp-font-display);color:#F4F6EE}
  .rp-cine-card .s{font:500 12.5px/1.45 var(--rp-font-ui);color:#b9c0ae;margin-top:3px}
  .rp-cine-card bdi{font-variant-numeric:tabular-nums}
  .rp-cine-attr{position:absolute;inset-inline-end:8px;bottom:3px;font:500 8.5px/1 var(--rp-font-ui);color:rgba(255,255,255,.34);
    pointer-events:none;direction:ltr}
  @media (prefers-reduced-motion:reduce){.rp-cine-card{transition:none}}
  `;
  document.head.appendChild(st);
}
const cineEsc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// a translation with its values isolated: numbers glued to Hebrew text keep their place ("ב-1.2 ק"מ")
const cineT = (key, p) => {
  const q = {};
  Object.keys(p || {}).forEach((k) => { q[k] = '\u0001' + k + '\u0002'; });
  return cineEsc(t(key, q)).replace(/\u0001(\w+)\u0002/g, (_, k) => '<bdi>' + cineEsc(p[k]) + '</bdi>');
};

function mount3D(THREE, container, data, onProgress, stateRef, onFinish) {
  const { track, profile, rows, totalDist, weather, raceTime, raceName } = data;
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

  const hasTer = LIME3 && !!data.terrain;
  // on the ground the route needs more points: the hills between two samples must not swallow it
  const STEPS = hasTer ? Math.max(120, Math.min(560, Math.round((totalDist || 5) * 14)))
    : Math.max(60, Math.min(240, Math.round((totalDist || 5) * 24)));
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
  // ── Real ground (lime): one vertical scale for the ground and the route, so a climb on the road is the hill it
  // climbs. Picked from the relief around the course: enough that a flat city course still shows its bridges,
  // never the spiky 9x of the floating road (rejected 5.10.2026), at least 1.6x so a mountain course reads as one.
  const TER = hasTer ? data.terrain : null;
  const terrainAt = TER && window.TERRAIN3D ? window.TERRAIN3D.sampler(TER) : null;
  // the course's own relief on the ground (not the whole map box, whose valleys would flatten a city course's hills)
  let courseRelief = 0;
  if (TER) {
    let lo = Infinity, hi = -Infinity;
    samples.forEach((sm) => { const e = terrainAt(sm.x, sm.z); lo = Math.min(lo, e); hi = Math.max(hi, e); });
    courseRelief = Math.max(15, hi - lo);
  }
  // the course's climbing as about a tenth of the scene's width: a 2 % road reads as a climb, between 2x and 5x
  const TER_EX = TER ? Math.max(2, Math.min(5, (TARGET_SIZE * 0.1) / (courseRelief * scale))) : 0;
  const yGround = (x, z) => (terrainAt(x, z) - TER.eMin) * scale * TER_EX; // x, z in source meters

  // on the ground the route is a ribbon of light, a few tens of meters wide, not the floating road's broad slab
  const roadWidth = TER ? Math.max(0.32, TARGET_SIZE * 0.0055) : Math.max(1.4, TARGET_SIZE * 0.024);
  const roadThickness = roadWidth * 0.22;
  const laid = layoutPasses(samples, roadWidth / scale);
  minEle = Math.min(...laid.map((s) => s.ele));
  const points = laid.map((s) => new THREE.Vector3(
    (s.x - cx) * scale,
    TER ? yGround(s.x, s.z) + roadWidth * (0.9 + s.lift * 0.4)
      : (s.ele - minEle) * scale * EXAGGERATION + s.lift * roadThickness * 0.5,
    (s.z - cz) * scale,
  ));
  const curve = new THREE.CatmullRomCurve3(points);

  // The visible road is built from a DENSE resampling of this smooth curve —
  // not the coarser polyline of `points` — so it reads as one continuous
  // ribbon with no faceting at the original GPX vertices, and stays exactly
  // flush with the runner (which also travels via curve.getPointAt).
  const ROAD_STEPS = Math.max(300, Math.min(900, Math.round(totalKm * 60)));
  // How far the road has split into lanes (0..1) at arc-length fraction u —
  // the curve's own parameter t is uniform per sample, so map u -> t first.
  const laneAtU = (u) => {
    const k = curve.getUtoTmapping(u) * (laid.length - 1);
    const k0 = Math.max(0, Math.min(laid.length - 2, Math.floor(k)));
    return laid[k0].lane + (laid[k0 + 1].lane - laid[k0].lane) * (k - k0);
  };
  const roadPoints = [], roadWidths = [];
  for (let i = 0; i <= ROAD_STEPS; i++) {
    const u = i / ROAD_STEPS;
    roadPoints.push(curve.getPointAt(u));
    roadWidths.push(roadWidth * (1 - (1 - LANE_NARROW) * laneAtU(u)));
  }
  // between two samples the smooth curve can cut into a crest: keep every drawn point above the ground
  const groundAtW = TER ? (x, z) => yGround(x / scale + cx, z / scale + cz) : null;
  if (TER) roadPoints.forEach((p) => { const g = groundAtW(p.x, p.z) + roadWidth * 0.55; if (p.y < g) p.y = g; });

  // ── Scene ──
  const BASE_FOG_DENSITY = 0.0022;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070d);
  scene.fog = new THREE.FogExp2(0x2e2438, BASE_FOG_DENSITY);
  const sky = makeSkyDome(THREE, 3000);
  scene.add(sky.mesh);
  // lime on the ground: no daylight dome; the route is the light (the day / weather still tints the fog's density)
  if (hasTer) { sky.mesh.visible = false; scene.background.setHex(0x050605); }

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
  const addLegacy = (obj) => { if (!TER) scene.add(obj); return obj; };
  // Roughness/metalness tuned to avoid a blown-out sun-glint hotspot now that
  // the default chase-cam view sits low and close to the floor — a grazing
  // view angle onto a near-mirror surface (the old wide overview angle's
  // values) turns a directional light's specular lobe into a huge white
  // blob. Still glossy enough to read as wet pavement from any angle.
  const floorMat = new THREE.MeshStandardMaterial({ color: LIME3 ? 0x080907 : 0x0a0c14, roughness: 0.5, metalness: 0.15 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(TARGET_SIZE * 9, TARGET_SIZE * 9), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  addLegacy(floor);

  const grid = new THREE.GridHelper(TARGET_SIZE * 2.2, 22, LIME3 ? 0x2a3318 : 0x2a3346, LIME3 ? 0x161a10 : 0x1a2030);
  grid.position.y = FLOOR_Y + 0.01;
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  addLegacy(grid);

  // ── The road surface: a flat, paved ribbon with the "blue line" real
  // marathons paint down the tangent line for the broadcast cameras ──
  const tubeRadius = roadWidth * 0.32; // scale reference for markers/shadow below
  const roadWorldLength = totalKm * 1000 * scale;
  const repeatX = Math.max(4, Math.round(roadWorldLength / 6));
  const roadTexture = makeRoadTexture(THREE);
  const { topGeo, leftWallGeo, rightWallGeo } = buildRoadStrips(THREE, roadPoints, roadWidths, roadThickness, repeatX);

  // Wet-weather forecasts make the pavement itself read as rain-slicked —
  // lower roughness / a touch of metalness reads as a sheen under the sun.
  const wet = weatherFilter.wet;
  addLegacy(new THREE.Mesh(topGeo, new THREE.MeshStandardMaterial({
    map: roadTexture, roughness: 0.92 - wet * 0.55, metalness: 0.02 + wet * 0.35, side: THREE.DoubleSide,
  })));
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x1b1e26, roughness: 0.95 });
  addLegacy(new THREE.Mesh(leftWallGeo, wallMat));
  addLegacy(new THREE.Mesh(rightWallGeo, wallMat));

  // A soft, low-opacity mirrored copy of the road surface beneath the floor
  // plane — reflecting a mesh about a horizontal plane y=FLOOR_Y is just
  // `position.y = 2*FLOOR_Y, scale.y = -1` (see mount3D comment above).
  const reflMesh = new THREE.Mesh(topGeo.clone(), new THREE.MeshBasicMaterial({
    map: roadTexture, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide,
  }));
  reflMesh.position.y = FLOOR_Y * 2;
  reflMesh.scale.y = -1;
  addLegacy(reflMesh);

  // "Already run" reveal — a brighter overlay whose draw range grows with
  // progress, so the travelled portion visibly lights up while playing.
  const revealGeo = topGeo.clone();
  revealGeo.setDrawRange(0, 0);
  const revealMesh = new THREE.Mesh(revealGeo, new THREE.MeshStandardMaterial({
    map: roadTexture, emissive: LIME3 ? 0x1a200a : 0x2a2010, emissiveIntensity: 0.55, roughness: 0.7, side: THREE.DoubleSide,
  }));
  addLegacy(revealMesh);
  const revealIndexCount = revealGeo.index.count;
  const SURFACE_Y = roadThickness / 2 + 0.05; // lift markers/runner onto the road surface, not its centerline

  // ── Ground "shadow" ribbon + the height curtain, for depth cues ──
  const groundCurve = new THREE.CatmullRomCurve3(roadPoints.map((p) => new THREE.Vector3(p.x, -0.35, p.z)));
  const groundGeo = new THREE.TubeGeometry(groundCurve, ROAD_STEPS, tubeRadius * 1.6, 6, false);
  addLegacy(new THREE.Mesh(groundGeo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.26 })));

  const heightCurtain = buildHeightCurtain(THREE, roadPoints, roadWidth, roadThickness, FLOOR_Y);
  addLegacy(heightCurtain.group);

  // ── Start / finish markers + gates ──
  const markerGeo = new THREE.SphereGeometry(tubeRadius * 1.8, 16, 16);
  const startMesh = new THREE.Mesh(markerGeo, new THREE.MeshStandardMaterial({ color: LIME3 ? 0xDDFF4A : 0x8091BE, emissive: LIME3 ? 0x2a3305 : 0x1a1f33 }));
  startMesh.position.copy(points[0]); startMesh.position.y += SURFACE_Y;
  addLegacy(startMesh);
  const finishMesh = new THREE.Mesh(markerGeo, new THREE.MeshStandardMaterial({ color: LIME3 ? 0xF4F6EE : 0xC15A2E, emissive: LIME3 ? 0x222222 : 0x2a0f05 }));
  finishMesh.position.copy(points[points.length - 1]); finishMesh.position.y += SURFACE_Y;
  addLegacy(finishMesh);

  addLegacy(buildGate(THREE, curve, 0, roadWidth, roadThickness, t('view3d.startGate'), false, LIME3 ? 0xDDFF4A : 0x8091BE));
  addLegacy(buildGate(THREE, curve, 1, roadWidth, roadThickness, t('view3d.finishGate'), true, LIME3 ? 0xF4F6EE : 0xC15A2E, raceName || ''));

  // ── Split signs — one per interior plan-segment boundary, showing the
  // checkpoint's cumulative distance and cumulative planned time, like a
  // real course's pacing/km-marker signage ──
  (rows || []).slice(0, -1).forEach((r) => {
    const u = Math.max(0, Math.min(1, r.cumDist / (totalDist || 1)));
    const distText = U ? U.fmtDist(r.cumDist) : `${r.cumDist.toFixed(1)} km`;
    addLegacy(buildSplitSign(THREE, curve, u, roadWidth, roadThickness, distText, _fmtClock(r.cumTime), laneAtU(u) > 0.2 ? -1 : 1));
  });

  const terWorld = TER ? buildTerrainWorld(THREE, scene, { TER, scale, cx, cz, ex: TER_EX, roadPoints, roadWidth }) : null;

  // ── The runner ──
  const runner = new THREE.Mesh(
    new THREE.SphereGeometry(tubeRadius * 2.2, 20, 20),
    new THREE.MeshStandardMaterial({ color: LIME3 ? 0xDDFF4A : 0xF5C24A, emissive: LIME3 ? 0x4a5a10 : 0x6b4a10, emissiveIntensity: 1.1 }),
  );
  runner.add(new THREE.PointLight(LIME3 ? 0xDDFF4A : 0xF5C24A, 1.1, TARGET_SIZE * 0.4));
  scene.add(runner);
  if (terWorld) { // a glow and a thin beam of light, so the runner is found from far above
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: terWorld.glowTex, color: 0xDDFF4A, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    glow.scale.set(roadWidth * 8, roadWidth * 8, 1); runner.add(glow);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(roadWidth * 0.08, roadWidth * 0.08, roadWidth * 22, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xDDFF4A, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    beam.position.y = roadWidth * 11; runner.add(beam);
  }

  // ── Rain, only when the real forecast for race day calls for it ──
  const rain = weatherFilter.rain ? buildRain(THREE, 700, TARGET_SIZE * 2.6, TARGET_SIZE * 0.55) : null;
  if (rain) scene.add(rain.points);

  // ── Finish-line confetti — bursts once per lap of the animation, the
  // moment the runner crosses the finish (see the loop-wrap check in tick). ──
  const confetti = buildConfetti(THREE, 220, TER ? roadWidth * 9 : roadWidth * 3.2,
    TER ? groundAtW(points[points.length - 1].x, points[points.length - 1].z) : FLOOR_Y);
  scene.add(confetti.points);
  const finishPoint = points[points.length - 1].clone();
  finishPoint.y += SURFACE_Y;

  // ── Wind streaks — only for genuinely windy forecasts. `windDirVec` is the
  // world-space direction the air is actually moving (the forecast's
  // `windDir` is a meteorological "from" bearing, so it's rotated 180°
  // first), reused below both to drive the streak field and to work out
  // whether the runner is currently facing into it. ──
  const windSpeedKmh = (weather && isFinite(weather.windSpeed)) ? weather.windSpeed : 0;
  const windActive = windSpeedKmh >= WIND_VIS_THRESHOLD_KMH;
  let windDirVec = null, windVisualSpeed = 0, windIntensity = 0, windRelKind = null, wind = null;
  if (windActive) {
    const fromRad = ((weather.windDir || 0) * Math.PI) / 180;
    const toRad = fromRad + Math.PI;
    windDirVec = new THREE.Vector3(Math.sin(toRad), 0, -Math.cos(toRad));
    const norm = Math.max(0, Math.min(1, (windSpeedKmh - WIND_VIS_THRESHOLD_KMH) / 40));
    windIntensity = 0.45 + norm * 0.55;
    windVisualSpeed = 22 + norm * 48;
    wind = buildWind(THREE, Math.round(80 + norm * 100), TARGET_SIZE * 2.4, FLOOR_Y + 1.5, TARGET_SIZE * 0.22, windDirVec);
    scene.add(wind.lines);
  }

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
    if (TER) scene.fog.color.setHex(0x050605); // lime on the ground: black, so the far hills fade into the page
    scene.fog.density = BASE_FOG_DENSITY * weatherFilter.fogMult;
  }

  // ── Camera: four switchable modes. 'free' and 'chase' share the same
  // hand-rolled orbit rig (pointer-drag to orbit, wheel/pinch to zoom) and
  // only differ in their default framing + idle behavior; 'pov' and
  // 'broadcast' are rigidly attached to the runner's current point/tangent
  // instead, like a real broadcast doesn't hand the viewer a camera crane. ──
  const CAMERA_DEFAULTS = {
    free: { radius: TARGET_SIZE * 1.15, polar: Math.PI * 0.32 },
    chase: { radius: TARGET_SIZE * 0.42, polar: Math.PI * 0.24 },
  };
  let cameraMode = 'free';
  let radius = CAMERA_DEFAULTS.free.radius;
  let azimuth = Math.PI * 0.22;
  let polar = CAMERA_DEFAULTS.free.polar;
  let povYaw = 0; // POV look-around offset, drag-controlled, decays back to 0 when idle
  let curFrac = 0; // kept in sync by updateRunner, read by the pov/broadcast rigs
  const target = new THREE.Vector3(0, TARGET_SIZE * 0.06, 0);
  let lastInteraction = 0;

  // Shortest signed angular distance from `a` to `b`, so the chase camera
  // always sweeps the short way round the runner's turn instead of
  // occasionally spinning the long way through a ±π wraparound.
  function shortestAngleDelta(a, b) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  // Ground floor for the camera itself: never let orbiting bring the eye
  // below world y=0 — the route's own lowest point (everything is built on
  // (ele - minEle), so the course's deepest point already sits at y=0) —
  // recomputed every call since target/radius both drift (camera-follow,
  // zoom). GROUND_MARGIN keeps the camera a hair above the ground plane
  // rather than exactly grazing it.
  const GROUND_MARGIN = 0.6;
  const _up = new THREE.Vector3(0, 1, 0);
  // the eye stays above the ground (the floor was y=0; real ground is higher in places)
  function groundClamp(p) {
    if (!TER) return;
    const g = groundAtW(p.x, p.z) + roadWidth * 3;
    if (p.y < g) p.y = g;
  }
  function applyCameraOrbit() {
    const maxPolar = Math.acos(Math.max(-1, Math.min(1, (GROUND_MARGIN - target.y) / radius)));
    polar = Math.max(0.12, Math.min(maxPolar, polar));
    camera.position.set(
      target.x + radius * Math.sin(polar) * Math.sin(azimuth),
      target.y + radius * Math.cos(polar),
      target.z + radius * Math.sin(polar) * Math.cos(azimuth),
    );
    groundClamp(camera.position);
    camera.lookAt(target);
  }
  // Runner's-eye view: parked at head height on the runner's own point,
  // looking down the road along the current tangent (plus a drag-controlled
  // yaw offset so the runner can "look around" mid-stride).
  function applyCameraPov() {
    const point = curve.getPointAt(curFrac);
    const tangent = curve.getTangentAt(curFrac).normalize();
    const eyePos = point.clone().addScaledVector(_up, SURFACE_Y + roadWidth * 1.6);
    camera.position.copy(eyePos);
    groundClamp(camera.position);
    const yawed = tangent.applyAxisAngle(_up, povYaw);
    camera.lookAt(eyePos.clone().addScaledVector(yawed, TARGET_SIZE * 0.15));
  }
  // Trackside broadcast camera: low, off to one side of the road, panning
  // alongside the runner like a real race's motorcycle/TV camera rather than
  // riding behind — emphasizes elevation change as the terrain "passes" by.
  function applyCameraBroadcast() {
    const point = curve.getPointAt(curFrac);
    const tangent = curve.getTangentAt(curFrac).normalize();
    const side = new THREE.Vector3().crossVectors(_up, tangent).normalize();
    camera.position.copy(point).addScaledVector(side, roadWidth * (TER ? 26 : 9)).addScaledVector(_up, SURFACE_Y + roadWidth * (TER ? 9 : 2.2));
    groundClamp(camera.position);
    camera.lookAt(point.clone().addScaledVector(_up, SURFACE_Y + roadWidth * 1.2));
  }
  // ── Cinema (option D): an opening orbit, the run with the camera tucked behind, slowing and swinging to the
  // side at every real climb and descent with a card of what the plan says there, a closing orbit at the finish.
  const kmU = 1000 * scale; // world units per km
  const profEnd = Array.isArray(profile) && profile.length > 1 && isFinite(profile[profile.length - 1].d)
    ? profile[profile.length - 1].d : (totalDist || 1);
  const timeAtDist = (d) => {
    if (d <= 0) return 0;
    const last = checkpoints[checkpoints.length - 1];
    if (d >= last.cumDist) return last.cumTime;
    let lo = 0, hi = checkpoints.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (checkpoints[m].cumDist <= d) lo = m; else hi = m; }
    const a = checkpoints[lo], b = checkpoints[hi];
    return a.cumTime + (b.cumDist > a.cumDist ? (d - a.cumDist) / (b.cumDist - a.cumDist) : 0) * (b.cumTime - a.cumTime);
  };
  const features = TER && window.TERRAIN3D ? window.TERRAIN3D.findClimbs(profile).map((c) => {
    const u0 = Math.max(0, c.d0 / profEnd), u1 = Math.min(1, c.d1 / profEnd);
    const pd0 = u0 * totalDist, pd1 = u1 * totalDist;
    return { ...c, u0, u1, pace: (timeAtDist(pd1) - timeAtDist(pd0)) / Math.max(0.01, pd1 - pd0) };
  }) : [];
  {
    const keep = (kind, n) => features.filter((f) => f.kind === kind).sort((a, b) => b.gain - a.gain).slice(0, n);
    const kept = keep('climb', 4).concat(keep('descent', 2)).sort((a, b) => a.u0 - b.u0);
    features.length = 0; kept.forEach((f) => features.push(f));
  }
  const climbsOnly = features.filter((f) => f.kind === 'climb');
  const avgPace = totalTime / Math.max(0.01, totalDist || 1);
  const totalGain = Math.round(data.gain || 0);
  const fmtP = (sec) => (U ? U.fmtPace(sec) + ' ' + U.paceUnit() : _fmtClock(sec));
  const fmtD = (km) => (U ? U.fmtDist(km) : km.toFixed(1) + ' km');
  const fmtE = (m) => (U ? U.fmtElev(m) : Math.round(m) + ' m');
  const unitUp = U && U.system === 'imperial' ? 'MI' : 'KM';
  const dispD1 = (km) => (U ? U.dispDistNum(km) : km.toFixed(1));
  const CINE_RUN_SEC = 26;        // the run itself at 1x, before the slow-downs on the hills
  const cine = { phase: 'intro', pt: 0, yaw: 0, card: '', hd: new THREE.Vector3(0, 0, -1), feat: null, featOn: 0 };
  const wantPos = new THREE.Vector3(), wantLook = new THREE.Vector3(), camLook = new THREE.Vector3();
  let courseCenter = new THREE.Vector3(), courseR = TARGET_SIZE * 0.5;
  {
    const bb = new THREE.Box3(); roadPoints.forEach((p) => bb.expandByPoint(p));
    bb.getCenter(courseCenter); const sz = new THREE.Vector3(); bb.getSize(sz); courseR = Math.max(sz.x, sz.z) * 0.5;
  }
  // the overlays: tags that follow points, the card, the map credit
  let tagLayer = null, cardEl = null;
  const tags = [];
  if (TER) {
    tagLayer = document.createElement('div'); tagLayer.className = 'rp-cine-tags'; container.appendChild(tagLayer);
    cardEl = document.createElement('div'); cardEl.className = 'rp-cine-card'; container.appendChild(cardEl);
    const attr = document.createElement('div'); attr.className = 'rp-cine-attr'; attr.textContent = TER.attribution; container.appendChild(attr);
    const tag = (html, p, cls, lift = 1) => {
      const el = document.createElement('div'); el.className = 'rp-cine-tag ' + (cls || ''); el.innerHTML = html; tagLayer.appendChild(el);
      tags.push({ el, p: p.clone().add(new THREE.Vector3(0, roadWidth * 3 * lift, 0)), cls });
    };
    tag(cineEsc(t('view3d.startGate')), roadPoints[0], '', 1.4);
    tag(cineEsc(t('view3d.finishGate')), roadPoints[roadPoints.length - 1], '', 1.4);
    const stepKm = U && U.system === 'imperial' ? 1.609344 * 5 : 5;
    for (let k = stepKm; k < (totalDist || 0) - stepKm * 0.4; k += stepKm) {
      tag(cineEsc(dispD1(k)) + ' ' + unitUp, curve.getPointAt(Math.min(1, k / totalDist)), 'km', 0.6);
    }
    let nc = 0, nd = 0;
    features.forEach((f) => {
      const n = f.kind === 'climb' ? ++nc : ++nd;
      tag(cineEsc(t(f.kind === 'climb' ? 'view3d.cine.tagClimb' : 'view3d.cine.tagDescent', { n })),
        curve.getPointAt(f.kind === 'climb' ? f.u1 : f.u0), f.kind, 1.2);
      f.n = n;
    });
  }
  const _pv = new THREE.Vector3();
  function placeTags() {
    if (!tagLayer) return;
    const w = container.clientWidth, h = container.clientHeight;
    tags.forEach((tg) => {
      _pv.copy(tg.p).project(camera);
      const far = camera.position.distanceTo(tg.p) > TARGET_SIZE * (tg.cls === 'km' ? 0.75 : 1.6);
      if (_pv.z > 1 || _pv.x < -1.1 || _pv.x > 1.1 || _pv.y < -1.1 || _pv.y > 1.1 || far) { tg.el.style.opacity = '0'; return; }
      tg.el.style.opacity = '1';
      tg.el.style.left = ((_pv.x + 1) / 2 * w).toFixed(1) + 'px';
      tg.el.style.top = ((1 - _pv.y) / 2 * h).toFixed(1) + 'px';
    });
  }
  function showCard(key, cls, k, title, sub) {
    if (!cardEl || key === cine.card) return;
    cine.card = key;
    if (!key) { cardEl.classList.remove('on'); return; }
    cardEl.className = 'rp-cine-card on ' + (cls || '') + (container.clientHeight < 360 ? ' compact' : '');
    cardEl.innerHTML = '<span class="k">' + cineEsc(k) + '</span><div class="t">' + title + '</div>' + (sub ? '<div class="s">' + sub + '</div>' : '');
  }
  function cineIntro() {
    const nC = climbsOnly.length;
    const sub = nC === 0 ? cineT('view3d.cine.introFlat', { gain: fmtE(totalGain) })
      : cineT(nC === 1 ? 'view3d.cine.introSub.one' : 'view3d.cine.introSub.other', { gain: fmtE(totalGain), n: nC });
    showCard('intro', '', 'START · ' + dispD1(totalDist || 0) + ' ' + unitUp, cineT('view3d.cine.intro', { name: raceName || t('view3d.title'), time: _fmtClock(totalTime) }), sub);
  }
  function cineOrbit(dt, a0, rate, k) {
    const a = a0 + cine.pt * rate + cine.yaw, R = courseR * k;
    wantPos.set(courseCenter.x + Math.sin(a) * R, courseCenter.y + R * 0.72, courseCenter.z + Math.cos(a) * R);
    wantLook.copy(courseCenter);
  }
  // one step of the film; returns the distance fraction the runner is at
  function cineStep(dt, rate) {
    cine.pt += dt;
    if (cine.phase === 'intro') {
      cineOrbit(dt, -0.55, 0.1, 1.55); cineIntro(); updateRunner(0);
      if (terWorld) terWorld.setFeature(null, 0);
      if (cine.pt > 4.6) { cine.phase = 'run'; cine.pt = 0; elapsed = 0; }
      return 0;
    }
    if (cine.phase === 'outro') {
      cineOrbit(dt, 0.6, 0.07, 1.35);
      if (cine.pt <= dt + 1e-6) updateRunner(1);
      if (terWorld) terWorld.setFeature(null, 0);
      showCard('outro', '', 'FINISH · ' + _fmtClock(totalTime), cineT('view3d.cine.finish', { time: _fmtClock(totalTime) }),
        cineT('view3d.cine.finishSub', { avg: fmtP(avgPace) }));
      if (cine.pt > 5.2) return -1; // done
      return 1;
    }
    let frac = distFractionAtTime(elapsed);
    const lead = 0.25 / Math.max(1, totalDist), tail = 0.08 / Math.max(1, totalDist);
    const f = features.find((x) => frac >= x.u0 - lead && frac <= x.u1 + tail);
    if (f) cine.feat = f;
    cine.featOn += ((f ? 1 : 0) - cine.featOn) * Math.min(1, dt * 3 || (f ? 1 : 0));
    if (terWorld) terWorld.setFeature(cine.feat, cine.featOn);
    const slow = f ? (f.kind === 'climb' ? 0.36 : 0.5) : 1;
    elapsed += dt * (totalTime / CINE_RUN_SEC) * rate * slow;
    if (elapsed >= totalTime) { elapsed = totalTime; cine.phase = 'outro'; cine.pt = 0; confetti.burst(finishPoint); }
    frac = distFractionAtTime(elapsed);
    updateRunner(frac);
    const p = runner.position;
    const tg = curve.getTangentAt(Math.min(0.999, frac)); tg.y = 0;
    if (tg.lengthSq() > 1e-8) cine.hd.lerp(tg.normalize(), 1 - Math.exp(-dt * 1.6)).normalize();
    if (f) {
      const A = curve.getPointAt(f.u0), B = curve.getPointAt(f.u1), M = A.clone().add(B).multiplyScalar(0.5);
      const dir = B.clone().sub(A); dir.y = 0; if (dir.lengthSq() < 1e-8) dir.copy(cine.hd); dir.normalize();
      // from the side, low, so the slope stands against the horizon; once per stretch, the side with nothing in
      // the way (a hill between the camera and the road would hide the very climb it is there to show)
      const dist = Math.max(kmU * 0.8, A.distanceTo(B) * 0.82);
      const baseUp = dist * 0.07 + Math.abs(B.y - A.y) * 0.35 + roadWidth * 5;
      if (!f.cam) {
        let best = null;
        [1, -1].forEach((sg) => {
          const sd = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(sg);
          const c = M.clone().addScaledVector(sd, dist).addScaledVector(_up, baseUp);
          let block = 0;
          [A, M, B].forEach((T) => {
            for (let k = 1; k < 14; k++) {
              const q = c.clone().lerp(T, k / 14);
              block = Math.max(block, groundAtW(q.x, q.z) + roadWidth * 2 - q.y);
            }
          });
          if (!best || block < best.block) best = { sg, block };
        });
        f.cam = { sg: best.sg, lift: Math.max(0, best.block) * 1.15 };
      }
      const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(f.cam.sg).applyAxisAngle(_up, cine.yaw);
      wantPos.copy(M).addScaledVector(side, dist).addScaledVector(_up, baseUp + f.cam.lift);
      wantLook.copy(M).lerp(p, 0.35);
      const climb = f.kind === 'climb';
      showCard('f' + f.d0, f.kind, (climb ? 'CLIMB ' : 'DESCENT ') + f.n + ' · ' + dispD1(f.u0 * totalDist) + ' ' + unitUp,
        cineT(climb ? 'view3d.cine.climb' : 'view3d.cine.descent', { n: f.n, gain: fmtE(f.gain), len: fmtD(f.len) }),
        cineT(climb ? 'view3d.cine.climbSub' : 'view3d.cine.descentSub', { grade: f.grade.toFixed(1) + '%', pace: fmtP(f.pace), avg: fmtP(avgPace) }));
    } else {
      const off = cine.hd.clone().multiplyScalar(-kmU * 0.95).applyAxisAngle(_up, cine.yaw + 0.5);
      wantPos.copy(p).add(off).addScaledVector(_up, kmU * 0.5 + roadWidth * 4);
      wantLook.copy(p).addScaledVector(cine.hd, kmU * 0.3);
      const next = climbsOnly.find((x) => x.u0 > frac);
      const rs = rows || [];
      const seg = rs.find((r) => r.cumDist >= frac * totalDist - 1e-6) || rs[rs.length - 1];
      const segPace = seg ? fmtP(seg.paceSec) : '';
      if (next) {
        const away = Math.max(0, (next.u0 - frac) * totalDist);
        showCard('n' + next.n + ':' + Math.round(away * 2), '', 'NEXT CLIMB · ' + dispD1(away) + ' ' + unitUp,
          cineT('view3d.cine.next', { n: next.n, dist: fmtD(away) }), cineT('view3d.cine.nextSub', { pace: segPace }));
      } else if (climbsOnly.length) {
        showCard('last', '', 'TO THE FINISH', cineT('view3d.cine.last', {}), cineT('view3d.cine.lastSub', { pace: segPace }));
      } else {
        showCard('flat:' + Math.round(frac * 10), '', 'PACE · ' + dispD1(frac * totalDist) + ' ' + unitUp,
          cineT('view3d.cine.flat', {}), cineT('view3d.cine.nextSub', { pace: segPace }));
      }
    }
    return frac;
  }
  function cineCamera(dt) {
    const k = 1 - Math.exp(-dt * (cine.phase === 'run' ? 1.5 : 1.1));
    camera.position.lerp(wantPos, k);
    camLook.lerp(wantLook, k);
    groundClamp(camera.position);
    camera.lookAt(camLook);
  }
  function applyCamera() {
    if (cameraMode === 'cinema') { cineCamera(0); return; }
    if (cameraMode === 'pov') applyCameraPov();
    else if (cameraMode === 'broadcast') applyCameraBroadcast();
    else applyCameraOrbit();
  }
  // Switches the active camera rig. 'chase' snaps its azimuth in behind
  // wherever the runner is currently facing so the cut never opens on the
  // wrong side of the road.
  function switchCameraMode(mode) {
    if (!CAMERA_DEFAULTS[mode] && mode !== 'pov' && mode !== 'broadcast' && !(mode === 'cinema' && TER)) return;
    const was = cameraMode;
    cameraMode = mode;
    if (cardEl && mode !== 'cinema') showCard('', '');
    if (mode === 'cinema' && was !== 'cinema') {
      // start the film from the top, from where the camera is now
      cine.phase = 'intro'; cine.pt = 0; cine.yaw = 0; finished = false; elapsed = 0;
      camLook.copy(courseCenter); cineOrbit(0, -0.55, 0.1, 1.55);
      if (was === 'free' && camera.position.lengthSq() > 0) { /* glide from the overview */ } else camera.position.copy(wantPos);
      return;
    }
    if (mode === 'chase') {
      const tangent = curve.getTangentAt(curFrac);
      azimuth = Math.atan2(-tangent.x, -tangent.z);
    }
    if (CAMERA_DEFAULTS[mode]) { radius = CAMERA_DEFAULTS[mode].radius; polar = CAMERA_DEFAULTS[mode].polar; }
    applyCamera();
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
    const orbitMode = cameraMode === 'free' || cameraMode === 'chase';
    if (pointers.size === 2 && pinchStartDist) {
      if (orbitMode) {
        const pts = [...pointers.values()];
        const dist = Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
        radius = Math.max(TARGET_SIZE * 0.35, Math.min(TARGET_SIZE * 3.5, pinchStartRadius * (pinchStartDist / dist)));
        applyCamera();
      }
      return;
    }
    if (dragLast && pointers.size === 1) {
      const dx = e.clientX - dragLast.x, dy = e.clientY - dragLast.y;
      dragLast = { x: e.clientX, y: e.clientY };
      if (cameraMode === 'cinema') {
        cine.yaw = Math.max(-1.2, Math.min(1.2, cine.yaw - dx * 0.006));
      } else if (orbitMode) {
        azimuth -= dx * 0.006;
        polar -= dy * 0.006;
        applyCamera();
      } else if (cameraMode === 'pov') {
        povYaw -= dx * 0.006;
        applyCamera();
      }
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
    if (cameraMode === 'free' || cameraMode === 'chase') {
      radius = Math.max(TARGET_SIZE * 0.35, Math.min(TARGET_SIZE * 3.5, radius * (1 + e.deltaY * 0.0012)));
      applyCamera();
    }
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
    curFrac = Math.max(0, Math.min(1, frac));
    const pos = curve.getPointAt(curFrac);
    runner.position.set(pos.x, pos.y + SURFACE_Y, pos.z);
    revealGeo.setDrawRange(0, Math.round(revealIndexCount * frac));
    heightCurtain.setProgress(curFrac);
    if (terWorld) terWorld.setProgress(curFrac);
    applyAtmosphere(frac);
    // Headwind/tailwind/crosswind relative to wherever the route is actually
    // heading right here — not a single course-wide verdict, since a looping
    // route can face the wind from every angle over its length.
    if (windDirVec) {
      const dot = curve.getTangentAt(curFrac).normalize().dot(windDirVec);
      windRelKind = dot > 0.3 ? 'tail' : dot < -0.3 ? 'head' : 'cross';
    }
    if (onProgress) onProgress(frac, windRelKind);
  }

  // `finished` holds the animation at the finish line (elapsed pinned at
  // totalTime) once a lap completes, instead of looping straight back to the
  // start — so there's actually a moment to see the confetti before anything
  // else happens. Playback only resets to the start once the user explicitly
  // presses play again (see the `finished` check at the top of the playing
  // block below); scrubbing away from the finish also clears it via seek().
  let finished = false;

  stateRef.current = {
    playing: true,
    // Set while the view is mounted but off-screen (the planner keeps the 3D
    // alive between tab switches so the camera and scrub position survive).
    // The tick loop keeps spinning but skips all scene work, so a hidden 3D
    // costs nothing instead of rendering every frame into a hidden canvas.
    suspended: false,
    rate: 1, // playback-speed multiplier, driven by the speed selector
    seek(frac) {
      finished = false; elapsed = timeAtDist(frac * (totalDist || 0)); updateRunner(frac);
      if (cameraMode === 'cinema') { cine.phase = 'run'; cine.pt = 0; cineStep(0, 0); } else applyCamera();
    },
    setCameraMode: switchCameraMode,
    // Forces an immediate synchronous paint, bypassing the internal rAF-driven
    // tick() loop below — used by scripted/offscreen capture (videoshare.jsx)
    // so a frame is guaranteed on-canvas right after seek(), regardless of
    // whether requestAnimationFrame is currently being throttled.
    renderNow() { renderer.render(scene, camera); },
    // tests: jump the film to a point (phase 'intro' | 'run' | 'outro', frac along the course) and settle the camera there
    cineAt(phase, frac) {
      if (cameraMode !== 'cinema') return false;
      cine.phase = phase; cine.pt = phase === 'run' ? 0 : 1;
      if (phase === 'run') { elapsed = timeAtDist(frac * (totalDist || 0)); cineStep(0, 0); } else { cineStep(0, 0); if (phase === 'outro') updateRunner(1); }
      cine.featOn = cine.feat && phase === 'run' && features.some((x) => frac >= x.u0 && frac <= x.u1) ? 1 : 0;
      if (terWorld) terWorld.setFeature(cine.feat, cine.featOn);
      for (let i = 0; i < 400; i++) cineCamera(0.05);
      placeTags(); renderer.render(scene, camera);
      return true;
    },
    features: () => features.map((f) => ({ kind: f.kind, u0: f.u0, u1: f.u1, gain: Math.round(f.gain), len: +f.len.toFixed(2) })),
    ex: TER_EX,
  };
  updateRunner(0);

  let raf = null;
  let lastT = performance.now();
  function tick(now) {
    if (stateRef.current.suspended) {
      lastT = now; // don't bank the hidden time into the next visible frame
      raf = requestAnimationFrame(tick);
      return;
    }
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    if (cameraMode === 'cinema') {
      if (stateRef.current.playing) {
        if (finished) { elapsed = 0; finished = false; cine.phase = 'intro'; cine.pt = 0; }
        const fr = cineStep(dt, (stateRef.current.rate || 1) * 2);
        if (fr < 0) { finished = true; stateRef.current.playing = false; cine.phase = 'outro'; if (onFinish) onFinish(); }
      }
      if (now - lastInteraction > 1400 && pointers.size === 0) cine.yaw *= Math.max(0, 1 - dt * 0.9);
      cineCamera(dt);
    } else if (stateRef.current.playing) {
      if (finished) { elapsed = 0; finished = false; }
      elapsed += dt * speedMult * (stateRef.current.rate || 1);
      if (elapsed >= totalTime) {
        elapsed = totalTime;
        finished = true;
        stateRef.current.playing = false;
        confetti.burst(finishPoint);
        if (onFinish) onFinish();
      }
      const frac = distFractionAtTime(elapsed);
      updateRunner(frac);
      if (cameraMode === 'free' || cameraMode === 'chase') {
        target.lerp(curve.getPointAt(frac), 0.04); // gentle camera follow
      }
      // Chase-cam heading: swing the idle camera in behind wherever the
      // runner is now facing, so it reads as tucked-in-behind on curves
      // instead of orbiting a fixed world angle. Only while the user isn't
      // actively dragging, and eased in gently after they let go so a
      // manual look-around doesn't snap back instantly.
      if (cameraMode === 'chase' && now - lastInteraction > 900 && pointers.size === 0) {
        const tangent = curve.getTangentAt(frac);
        const desiredAzimuth = Math.atan2(-tangent.x, -tangent.z);
        azimuth += shortestAngleDelta(azimuth, desiredAzimuth) * Math.min(1, dt * 2.2);
      }
    }
    if (cameraMode === 'free' && now - lastInteraction > 2600 && pointers.size === 0) {
      azimuth += dt * 0.06; // idle auto-orbit, same gentle drift as the original static overview
    }
    if (cameraMode === 'pov' && now - lastInteraction > 600 && pointers.size === 0) {
      povYaw *= Math.max(0, 1 - dt * 2.5); // ease the look-around back to dead-ahead
    }
    if (cameraMode !== 'cinema') applyCamera();
    placeTags();
    runner.rotation.y += dt * 3;

    if (rain) {
      for (let i = 0; i < rain.count; i++) {
        rain.positions[i * 3 + 1] -= dt * 45;
        if (rain.positions[i * 3 + 1] < FLOOR_Y) rain.positions[i * 3 + 1] = rain.height;
      }
      rain.points.geometry.attributes.position.needsUpdate = true;
    }
    confetti.update(dt);
    if (wind) wind.update(dt, windVisualSpeed, windIntensity);

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
    container.querySelectorAll('.rp-cine-tags, .rp-cine-card, .rp-cine-attr').forEach((el) => el.remove());
  };
}

const CAMERA_MODE_OPTIONS = ['free', 'chase', 'pov', 'broadcast'];
const CAMERA_MODE_LABEL_KEY = { cinema: 'view3d.camCinema', free: 'view3d.camFree', chase: 'view3d.camChase', pov: 'view3d.camPov', broadcast: 'view3d.camBroadcast' };
const SPEED_OPTIONS = [0.5, 1, 2, 4];
const WIND_REL_LABEL_KEY = { head: 'view3d.windHead', tail: 'view3d.windTail', cross: 'view3d.windCross' };

// The same premium seven-segment board as the planner's goal-time hero
// (ClockDisplay), holding its own state behind a `setSeconds` ref so the
// 60×/sec progress updates only re-render this small board — not the whole
// modal — matching ElevationChart's setProgress imperative-ref pattern above.
const RunClock = React.forwardRef(function RunClock({ digitH }, outerRef) {
  const [sec, setSec] = React.useState(0);
  React.useImperativeHandle(outerRef, () => ({ setSeconds: setSec }), []);
  return ClockDisplay ? <ClockDisplay totalSec={sec} digitH={digitH} live /> : null;
});

// `embedded`: render inline inside a host panel (the planner's visual column /
// mobile tab) rather than as a full-screen portal over the page. The host owns
// the title and the switch back, so the header bar is dropped and the surface
// fills its parent instead of the viewport.
function Route3DView({ track, profile, rows, totalDist, raceName, gain, loss, weather, raceTime, onClose, embedded = false, paused = false }) {
  useEscape(onClose, !embedded && !!onClose);
  const mountRef = React.useRef(null);
  const scrubRef = React.useRef(null);
  const distRef = React.useRef(null);
  const clockRef = React.useRef(null);
  const elevChartRef = React.useRef(null);
  // The side chart's x axis is the profile's own distance, which needn't
  // equal the plan's totalDist — move its marker by fraction of that axis.
  const profKm = Array.isArray(profile) && profile.length > 1 && isFinite(profile[profile.length - 1].d)
    ? profile[profile.length - 1].d : totalDist;
  const windRelRef = React.useRef(null);
  const stateRef = React.useRef(null);
  const [status, setStatus] = React.useState('loading'); // loading | ready | error
  const [playing, setPlaying] = React.useState(true);
  const [cameraMode, setCameraMode] = React.useState('free');
  const [hasTer, setHasTer] = React.useState(false); // lime: real ground loaded, the film is on
  const hudKmRef = React.useRef(null), hudPaceRef = React.useRef(null), hudGradeRef = React.useRef(null);
  // the plan's pace and the road's grade where the runner is, for the clock's line under it
  const profPts = React.useMemo(() => (Array.isArray(profile) ? profile.filter((p) => isFinite(p.ele) && isFinite(p.d)) : []), [profile]);
  const hudAt = (frac) => {
    const d = frac * (totalDist || 0);
    const r = (rows || []).find((x) => x.cumDist >= d - 1e-6) || (rows || [])[(rows || []).length - 1];
    let grade = null;
    if (profPts.length > 1) {
      const pd = frac * profKm, h = Math.min(0.15, profKm / 40);
      const e1 = _interpEle(profPts, Math.min(profKm, pd + h)), e0 = _interpEle(profPts, Math.max(0, pd - h));
      grade = ((e1 - e0) / (Math.max(0.01, Math.min(profKm, pd + h) - Math.max(0, pd - h)) * 1000)) * 100;
    }
    if (hudKmRef.current) hudKmRef.current.textContent = U ? U.dispDistNum(d) : d.toFixed(1);
    if (hudPaceRef.current) hudPaceRef.current.textContent = r ? (U ? U.fmtPace(r.paceSec) : _fmtClock(r.paceSec)) : '';
    if (hudGradeRef.current && grade != null) {
      hudGradeRef.current.textContent = (grade >= 0 ? '+' : '') + grade.toFixed(1) + '%';
      hudGradeRef.current.style.color = grade > 1.5 ? '#FFB547' : grade < -1.5 ? '#8fd0ff' : '';
    }
  };
  const [speed, setSpeed] = React.useState(0.5);

  // Cumulative plan time (seconds) at a given fraction of the total distance
  // — the inverse of mount3D's own distFractionAtTime — so the on-screen
  // clock reads the plan's real pacing, not the animation's own wall-clock.
  const checkpoints = React.useMemo(() => [{ cumTime: 0, cumDist: 0 }]
    .concat((rows || []).map((r) => ({ cumTime: r.cumTime, cumDist: r.cumDist }))), [rows]);
  const timeAtFrac = (frac) => {
    const dist = frac * (totalDist || 0);
    const last = checkpoints[checkpoints.length - 1];
    if (dist <= 0) return 0;
    if (dist >= last.cumDist) return last.cumTime;
    let lo = 0, hi = checkpoints.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (checkpoints[mid].cumDist <= dist) lo = mid; else hi = mid;
    }
    const a = checkpoints[lo], b = checkpoints[hi];
    const f = b.cumDist > a.cumDist ? (dist - a.cumDist) / (b.cumDist - a.cumDist) : 0;
    return a.cumTime + f * (b.cumTime - a.cumTime);
  };

  React.useEffect(() => {
    let cancelled = false;
    let cleanupFn = null;
    // lime: the real ground under the course (src/terrain3d.jsx); without it within a few seconds, the floor as before
    const terP = LIME3 && window.TERRAIN3D && Array.isArray(track) && track.length > 1
      ? Promise.race([window.TERRAIN3D.loadTerrain(track), new Promise((r) => setTimeout(() => r(null), 9000))]).catch(() => null)
      : Promise.resolve(null);
    Promise.all([ensureThree(), terP]).then(([THREE, terrain]) => {
      if (cancelled || !mountRef.current) return;
      try {
        cleanupFn = mount3D(THREE, mountRef.current, { track, profile, rows, totalDist, weather, raceTime, raceName, gain, terrain }, (frac, windRel) => {
          hudAt(frac);
          if (scrubRef.current) scrubRef.current.value = String(Math.round(frac * 1000));
          if (distRef.current) distRef.current.textContent = U ? U.fmtDist(frac * totalDist) : (frac * totalDist).toFixed(1);
          if (clockRef.current) clockRef.current.setSeconds(timeAtFrac(frac));
          if (elevChartRef.current) elevChartRef.current.setProgress(frac * profKm);
          if (windRelRef.current) windRelRef.current.textContent = windRel ? t(WIND_REL_LABEL_KEY[windRel]) : '';
        }, stateRef, () => { if (!cancelled) setPlaying(false); });
        if (!cancelled) {
          if (mountRef.current) mountRef.current._rp3d = stateRef; // tests reach the scene through the element
          if (terrain) { setHasTer(true); setCameraMode('cinema'); }
          setStatus('ready');
        } else if (cleanupFn) cleanupFn();
      } catch (e) {
        try { console.warn('[Route3DView] init failed', e); } catch (e2) {}
        if (!cancelled) setStatus('error');
      }
    }).catch(() => { if (!cancelled) setStatus('error'); });

    return () => { cancelled = true; if (cleanupFn) cleanupFn(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // These three also re-run once `status` flips to 'ready' — mount3D builds
  // stateRef.current asynchronously, so the very first pass (while still
  // 'loading') finds it null and has to be replayed once it actually exists,
  // otherwise the UI's own initial selections (0.5× speed, 'free' camera)
  // would silently lose to mount3D's internal hardcoded defaults.
  React.useEffect(() => {
    if (stateRef.current) stateRef.current.playing = playing;
  }, [playing, status]);

  React.useEffect(() => {
    if (stateRef.current) stateRef.current.rate = speed;
  }, [speed, status]);

  React.useEffect(() => {
    if (stateRef.current) stateRef.current.setCameraMode(cameraMode);
  }, [cameraMode, status]);

  React.useEffect(() => {
    if (stateRef.current) stateRef.current.suspended = paused;
  }, [paused, status]);

  const onScrub = (e) => {
    const frac = Number(e.target.value) / 1000;
    if (stateRef.current) stateRef.current.seek(frac);
    if (distRef.current) distRef.current.textContent = U ? U.fmtDist(frac * totalDist) : (frac * totalDist).toFixed(1);
    if (clockRef.current) clockRef.current.setSeconds(timeAtFrac(frac));
    if (elevChartRef.current) elevChartRef.current.setProgress(frac * profKm);
  };

  const body = (
    <div className={'rp-cq-scope' + (embedded ? ' rp-view3d--embed' : '')} style={{
      background: '#05070d',
      display: 'flex', flexDirection: 'column', direction: I18N.dir, fontFamily: 'var(--rp-font-ui)',
      ...(embedded
        ? { position: 'relative', height: '100%', minHeight: 0, borderRadius: 'var(--rp-r-12)', overflow: 'hidden' }
        : { position: 'fixed', inset: 0, zIndex: 1300 }),
    }}>
      {!embedded && (
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
      )}

      <style>{`
        .rp-view3d-body { flex: 1; display: flex; min-height: 0; }
        .rp-hud3d { position: absolute; top: 10px; inset-inline-start: 10px; pointer-events: none; z-index: 2;
          background: rgba(5,6,5,.72); border: 1px solid rgba(221,255,74,.24); border-radius: 12px; padding: 7px 10px 6px;
          backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); display: flex; flex-direction: column; gap: 4px; }
        .rp-hud3d-row { display: flex; gap: 10px; direction: ltr; justify-content: flex-start;
          font: 600 10px/1 var(--rp-font-mono, ui-monospace, monospace); letter-spacing: .08em; color: rgba(244,246,238,.55); }
        .rp-hud3d-row b { color: #F4F6EE; font-weight: 700; font-variant-numeric: tabular-nums; }
        .rp-view3d-elev { width: 260px; flex: 0 0 auto; border-inline-start: 1px solid rgba(255,255,255,.08);
          padding: 10px 12px; display: flex; flex-direction: column; }
        .rp-view3d-camrow { display: flex; align-items: center; gap: 14px; padding: 8px 16px;
          border-top: 1px solid rgba(255,255,255,.08); overflow-x: auto; }
        .rp-view3d-camgroup { display: flex; gap: 4px; flex: 0 0 auto; }
        .rp-view3d-sep { width: 1px; align-self: stretch; background: rgba(255,255,255,.12); flex: 0 0 auto; }
        @media (max-width: 640px) {
          .rp-view3d-body { flex-direction: column; }
          .rp-view3d-elev { width: 100%; height: 190px; border-inline-start: none;
            border-top: 1px solid rgba(255,255,255,.08); }
        }
        /* Embedded in the planner's visual column: the column is narrower than
           a desktop viewport, so the 260px side panel would leave the canvas
           barely wider than itself. Stack it under the canvas like the phone
           layout does, and a little shorter — the viewport media query above
           can't see the column's width. */
        .rp-view3d--embed .rp-view3d-body { flex-direction: column; }
        .rp-view3d--embed .rp-view3d-elev { width: 100%; height: 170px; flex: 0 0 auto;
          border-inline-start: none; border-top: 1px solid rgba(255,255,255,.08); }
        .rp-view3d--embed .rp-view3d-camrow { flex-wrap: wrap; overflow-x: visible;
          row-gap: 6px; justify-content: center; }
        .rp-view3d--embed .rp-view3d-sep { display: none; }
        @media (max-width: 480px) {
          /* Each pill group fits its own line on a phone width — wrap onto two
             rows instead of forcing horizontal scroll to reach the speed pills. */
          .rp-view3d-camrow { flex-wrap: wrap; overflow-x: visible; row-gap: 6px; justify-content: center; }
          .rp-view3d-sep { display: none; }
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
          {status === 'ready' && !LIME3 && (
            <div style={{ position: 'absolute', top: 10, insetInlineStart: 12, fontSize: 11,
              color: 'rgba(255,255,255,.45)', pointerEvents: 'none' }}>{t('view3d.dragHint')}</div>
          )}
          {status === 'ready' && LIME3 && (
            <div className="rp-hud3d" aria-hidden="true">
              <RunClock ref={clockRef} digitH={17} />
              <div className="rp-hud3d-row">
                <span><b ref={hudKmRef}>0</b> {U && U.system === 'imperial' ? 'MI' : 'KM'}</span>
                <span><b ref={hudPaceRef} /></span>
                <span><b ref={hudGradeRef} /></span>
              </div>
            </div>
          )}
          {status === 'ready' && weather && weather.windSpeed >= WIND_VIS_THRESHOLD_KMH && (
            <div style={{ position: 'absolute', top: 10, insetInlineEnd: 12, display: 'flex', alignItems: 'center',
              gap: 6, fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.85)', background: 'rgba(5,7,13,.55)',
              padding: '5px 10px', borderRadius: 999, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#bfe3ff" strokeWidth="2.4"
                strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0,
                  transform: `rotate(${weather.windDir}deg)` }}>
                <line x1="12" y1="20" x2="12" y2="4" /><polyline points="5 11 12 4 19 11" />
              </svg>
              <span>{U ? Math.round(U.dispSpeed(weather.windSpeed)) : weather.windSpeed} {U ? U.speedUnit() : 'km/h'}</span>
              <span ref={windRelRef} style={{ color: 'var(--rp-gold)', fontWeight: 700 }} />
            </div>
          )}
        </div>
        {status === 'ready' && ElevationChart && (
          <div className="rp-view3d-elev">
            {!LIME3 && <RunClock ref={clockRef} digitH={22} />}
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'rgba(255,255,255,.55)', margin: '10px 0 4px' }}>
              {t('chart.elevChartTitle')}
            </div>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center' }}>
              <ElevationChart ref={elevChartRef} profile={profile} colors={ELEV_COLORS}
                height={embedded ? 100 : 200} gain={gain} loss={loss} />
            </div>
          </div>
        )}
      </div>

      {status === 'ready' && (
        <div className="rp-view3d-camrow">
          <div className="rp-view3d-camgroup">
            {(hasTer ? ['cinema'].concat(CAMERA_MODE_OPTIONS) : CAMERA_MODE_OPTIONS).map((mode) => (
              <button key={mode} onClick={() => setCameraMode(mode)} style={{
                padding: '5px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap',
                border: '1px solid ' + (cameraMode === mode ? 'var(--rp-gold)' : 'rgba(255,255,255,.18)'),
                background: cameraMode === mode ? 'var(--rp-gold)' : 'rgba(255,255,255,.06)',
                color: cameraMode === mode ? '#161200' : 'rgba(255,255,255,.75)', cursor: 'pointer',
              }}>{t(CAMERA_MODE_LABEL_KEY[mode])}</button>
            ))}
          </div>
          <div className="rp-view3d-sep" />
          <div className="rp-view3d-camgroup">
            {SPEED_OPTIONS.map((s) => (
              <button key={s} onClick={() => setSpeed(s)} style={{
                padding: '5px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap',
                border: '1px solid ' + (speed === s ? 'var(--rp-gold)' : 'rgba(255,255,255,.18)'),
                background: speed === s ? 'var(--rp-gold)' : 'rgba(255,255,255,.06)',
                color: speed === s ? '#161200' : 'rgba(255,255,255,.75)', cursor: 'pointer',
              }}>{s}×</button>
            ))}
          </div>
        </div>
      )}

      {status === 'ready' && (
        <div style={{ padding: '10px 16px 16px', borderTop: '1px solid rgba(255,255,255,.08)',
          display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => setPlaying((v) => !v)} aria-label={playing ? t('view3d.pause') : t('view3d.play')}
            style={{ width: 40, height: 40, borderRadius: '50%', border: 'none', background: 'var(--rp-gold)',
              color: '#161200', fontSize: 15, cursor: 'pointer', flex: '0 0 auto',
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {window.RPGlyph ? (playing ? <window.RPGlyph.pause size={16} /> : <window.RPGlyph.play size={16} style={{ marginInlineStart: 2 }} />) : (playing ? 'II' : '>')}
          </button>
          <input ref={scrubRef} type="range" min={0} max={1000} defaultValue={0} onChange={onScrub}
            style={{ flex: 1, accentColor: LIME3 ? '#DDFF4A' : '#C9A24B' }} />
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.7)', minWidth: 46, textAlign: 'end' }}>
            <span ref={distRef}>0</span>
          </div>
        </div>
      )}
    </div>
  );

  return embedded ? body : ReactDOM.createPortal(body, document.body);
}

window.ensureThree = ensureThree;
window.mount3D = mount3D;
window.ROUTE3D_LAYOUT = { buildSamples, layoutPasses };
window.Route3DView = Route3DView;
