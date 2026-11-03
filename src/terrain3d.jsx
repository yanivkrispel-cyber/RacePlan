// terrain3d.jsx — real ground under the 3D route (lime skin, Kris 4.11.2026: "option D with B's clock; the climbs
// must really look like climbs and the descents like descents"). Mock-ups: https://claude.ai/artifact/T3QtTcvMuTEPQi7Q5UmFJF
//
//   window.TERRAIN3D.loadTerrain(track, { timeoutMs }) -> Promise<terrain | null>
//       The course's surroundings as a height grid plus a map texture, in the same local metric frame as
//       route3d.jsx buildSamples (x east, z south, meters, origin at track[0]).
//       Heights: AWS Terrain Tiles (Terrarium PNG, "Mapzen / AWS Terrain Tiles"), CORS-open.
//       Map: Esri World Dark Gray Base, the same basemap as the 2D map (src/map.jsx), shaded with the
//       terrain's own hill shading so the relief reads even where the map is flat grey.
//       null when the heights can't be had (offline, blocked, too slow): the 3D view then keeps its floor.
//   window.TERRAIN3D.sampler(terrain) -> (x, z) => elevation in meters (bilinear)
//   window.TERRAIN3D.findClimbs(profile, opts) -> [{ kind:'climb'|'descent', d0, d1, gain, len, grade }]
//
// Pure helpers (tile maths, findClimbs) are exported too, for test/terrain3d.test.mjs.

const T3_DEM_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const T3_MAP_URL = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${z}/${y}/${x}`;
const T3_R = 6371000, T3_RAD = Math.PI / 180;
const T3_GRID = 170;            // height grid cells along the longer side
const T3_TEX = 1600;            // map texture pixels along the longer side
const T3_MAX_DEM_TILES = 16;
const T3_MAX_MAP_TILES = 42;

// ── Web Mercator tile maths (world pixels at zoom z, 256 px tiles) ──
const t3wx = (lon, z) => ((lon + 180) / 360) * 256 * 2 ** z;
const t3wy = (lat, z) => {
  const la = lat * T3_RAD;
  return ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * 256 * 2 ** z;
};
/** The deepest zoom whose tiles over the box number at most `max`. */
function t3zoomFor(box, max, zMax) {
  for (let z = zMax; z >= 4; z--) {
    const nx = Math.floor(t3wx(box.lon1, z) / 256) - Math.floor(t3wx(box.lon0, z) / 256) + 1;
    const ny = Math.floor(t3wy(box.lat0, z) / 256) - Math.floor(t3wy(box.lat1, z) / 256) + 1;
    if (nx * ny <= max) return z;
  }
  return 4;
}

/** The course's box in degrees, with a margin all round (a share of its size, at least ~600 m). */
function t3box(track, marginFrac = 0.16) {
  let lat0 = Infinity, lat1 = -Infinity, lon0 = Infinity, lon1 = -Infinity;
  track.forEach(([la, lo]) => { lat0 = Math.min(lat0, la); lat1 = Math.max(lat1, la); lon0 = Math.min(lon0, lo); lon1 = Math.max(lon1, lo); });
  const k = Math.cos(((lat0 + lat1) / 2) * T3_RAD);
  const mLat = Math.max((lat1 - lat0) * marginFrac, 600 / 111320);
  const mLon = Math.max((lon1 - lon0) * marginFrac, 600 / (111320 * k));
  // square it up a little so a long thin course still gets ground on its sides
  const spanLat = lat1 - lat0 + 2 * mLat, spanLon = (lon1 - lon0 + 2 * mLon) * k;
  const s = Math.max(spanLat, spanLon) * 0.62;
  const addLat = Math.max(0, (s - spanLat) / 2), addLon = Math.max(0, (s - spanLon) / 2) / k;
  return { lat0: lat0 - mLat - addLat, lat1: lat1 + mLat + addLat, lon0: lon0 - mLon - addLon, lon1: lon1 + mLon + addLon };
}

function t3img(url, ms) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    const timer = setTimeout(() => { im.src = ''; reject(new Error('timeout')); }, ms);
    im.onload = () => { clearTimeout(timer); resolve(im); };
    im.onerror = () => { clearTimeout(timer); reject(new Error('tile')); };
    im.src = url;
  });
}

/** The tiles covering `box` at zoom z, drawn into one canvas; returns it with the world-pixel origin. */
async function t3mosaic(box, z, urlOf, ms) {
  const x0 = Math.floor(t3wx(box.lon0, z) / 256), x1 = Math.floor(t3wx(box.lon1, z) / 256);
  const y0 = Math.floor(t3wy(box.lat1, z) / 256), y1 = Math.floor(t3wy(box.lat0, z) / 256);
  const c = document.createElement('canvas');
  c.width = (x1 - x0 + 1) * 256; c.height = (y1 - y0 + 1) * 256;
  const g = c.getContext('2d', { willReadFrequently: true });
  const jobs = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    jobs.push(t3img(urlOf(z, x, y), ms).then((im) => { g.drawImage(im, (x - x0) * 256, (y - y0) * 256); return true; }));
  }
  const res = await Promise.allSettled(jobs);
  const ok = res.filter((r) => r.status === 'fulfilled').length;
  return { canvas: c, g, ox: x0 * 256, oy: y0 * 256, z, ok, all: jobs.length };
}

// Local metric frame of route3d.jsx buildSamples: x = east, z = south, from track[0].
function t3frame(track) {
  const lat0 = track[0][0], lon0 = track[0][1];
  const kx = T3_RAD * T3_R * Math.cos(lat0 * T3_RAD), kz = T3_RAD * T3_R;
  return {
    toXZ: (lat, lon) => [(lon - lon0) * kx, -(lat - lat0) * kz],
    toLL: (x, z) => [lat0 - z / kz, lon0 + x / kx],
  };
}

const _t3cache = new Map();

async function loadTerrain(track, opts = {}) {
  if (!Array.isArray(track) || track.length < 2 || typeof document === 'undefined') return null;
  const ms = opts.timeoutMs || 7000;
  const box = t3box(track);
  const key = [box.lat0, box.lat1, box.lon0, box.lon1].map((v) => v.toFixed(4)).join(',');
  if (_t3cache.has(key)) return _t3cache.get(key);

  const job = (async () => {
    const fr = t3frame(track);
    const [xa, za] = fr.toXZ(box.lat1, box.lon0), [xb, zb] = fr.toXZ(box.lat0, box.lon1);
    const minX = Math.min(xa, xb), maxX = Math.max(xa, xb), minZ = Math.min(za, zb), maxZ = Math.max(za, zb);
    const W = maxX - minX, H = maxZ - minZ;

    // heights
    const zd = t3zoomFor(box, T3_MAX_DEM_TILES, 14);
    const dem = await t3mosaic(box, zd, T3_DEM_URL, ms);
    if (dem.ok < dem.all) return null; // a hole in the ground is worse than the floor
    const dpx = dem.g.getImageData(0, 0, dem.canvas.width, dem.canvas.height).data;
    const DW = dem.canvas.width, DH = dem.canvas.height;
    const eleAtPx = (px, py) => {
      px = Math.max(0, Math.min(DW - 1.001, px)); py = Math.max(0, Math.min(DH - 1.001, py));
      const x0 = Math.floor(px), y0 = Math.floor(py), tx = px - x0, ty = py - y0;
      const e = (x, y) => { const i = (y * DW + x) * 4; return dpx[i] * 256 + dpx[i + 1] + dpx[i + 2] / 256 - 32768; };
      return e(x0, y0) * (1 - tx) * (1 - ty) + e(x0 + 1, y0) * tx * (1 - ty) + e(x0, y0 + 1) * (1 - tx) * ty + e(x0 + 1, y0 + 1) * tx * ty;
    };
    const gx = W >= H ? T3_GRID : Math.max(24, Math.round(T3_GRID * W / H));
    const gy = H >= W ? T3_GRID : Math.max(24, Math.round(T3_GRID * H / W));
    const grid = new Float32Array(gx * gy);
    let eMin = Infinity, eMax = -Infinity;
    for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
      const x = minX + (i / (gx - 1)) * W, z = minZ + (j / (gy - 1)) * H;
      const [la, lo] = fr.toLL(x, z);
      const e = eleAtPx(t3wx(lo, zd) - dem.ox, t3wy(la, zd) - dem.oy);
      grid[j * gx + i] = e; eMin = Math.min(eMin, e); eMax = Math.max(eMax, e);
    }
    // a light blur: Terrarium has 1 m steps and the odd spike, which an exaggerated surface shows as noise
    const sm = new Float32Array(grid.length);
    for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
      let s = 0, n = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii >= 0 && jj >= 0 && ii < gx && jj < gy) { const w = di || dj ? 1 : 2; s += grid[jj * gx + ii] * w; n += w; }
      }
      sm[j * gx + i] = s / n;
    }

    // the map texture, in the same frame, with hill shading baked in
    const tw = W >= H ? T3_TEX : Math.round(T3_TEX * W / H), th = H >= W ? T3_TEX : Math.round(T3_TEX * H / W);
    const tex = document.createElement('canvas'); tex.width = tw; tex.height = th;
    const tg = tex.getContext('2d');
    const out = tg.createImageData(tw, th), op = out.data;
    let mapOk = false, mpx = null, MW = 0, MH = 0, mz = 0, mo = null;
    try {
      // as sharp as the tile budget allows: roughly a texture pixel per map pixel
      mz = Math.min(17, t3zoomFor(box, T3_MAX_MAP_TILES, 17));
      mo = await t3mosaic(box, mz, T3_MAP_URL, ms);
      if (mo.ok >= mo.all * 0.8) {
        mpx = mo.g.getImageData(0, 0, mo.canvas.width, mo.canvas.height).data; MW = mo.canvas.width; MH = mo.canvas.height; mapOk = true;
      }
    } catch (e) { mapOk = false; }
    // hill shading per grid cell (sun from the north-west, normals scaled 3x so 3 % city grades still shade)
    const cellX = W / (gx - 1), cellZ = H / (gy - 1);
    const shadeG = new Float32Array(gx * gy);
    const Lx = -0.55, Ly = 0.62, Lz = -0.55;
    for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
      const e = (ii, jj) => sm[Math.max(0, Math.min(gy - 1, jj)) * gx + Math.max(0, Math.min(gx - 1, ii))];
      const ex = (e(i + 1, j) - e(i - 1, j)) / (2 * cellX), ez = (e(i, j + 1) - e(i, j - 1)) / (2 * cellZ);
      const nx = -ex * 3, nz = -ez * 3, ny = 1, nl = Math.hypot(nx, ny, nz);
      shadeG[j * gx + i] = Math.max(0, (nx * Lx + ny * Ly + nz * Lz) / nl);
    }
    const shadeAt = (u, v) => {
      const fx = u * (gx - 1), fy = v * (gy - 1);
      const x0 = Math.min(gx - 2, Math.floor(fx)), y0 = Math.min(gy - 2, Math.floor(fy)), tx = fx - x0, ty = fy - y0;
      return shadeG[y0 * gx + x0] * (1 - tx) * (1 - ty) + shadeG[y0 * gx + x0 + 1] * tx * (1 - ty)
        + shadeG[(y0 + 1) * gx + x0] * (1 - tx) * ty + shadeG[(y0 + 1) * gx + x0 + 1] * tx * ty;
    };
    // map pixel of each texture column / row: east depends on the column only, north on the row only
    const colMx = new Int32Array(tw), rowMy = new Int32Array(th);
    if (mapOk) {
      for (let px = 0; px < tw; px++) { const lo = fr.toLL(minX + (px / (tw - 1)) * W, 0)[1]; colMx[px] = Math.max(0, Math.min(MW - 1, Math.round(t3wx(lo, mz) - mo.ox))); }
      for (let py = 0; py < th; py++) { const la = fr.toLL(0, minZ + (py / (th - 1)) * H)[0]; rowMy[py] = Math.max(0, Math.min(MH - 1, Math.round(t3wy(la, mz) - mo.oy))); }
    }
    for (let py = 0; py < th; py++) {
      const v = py / (th - 1), row = rowMy[py] * MW;
      for (let px = 0; px < tw; px++) {
        const lit = 0.55 + shadeAt(px / (tw - 1), v) * 0.85;
        let r = 14, g = 17, b = 12;
        if (mapOk) {
          const k = (row + colMx[px]) * 4;
          // the dark grey map, pushed darker and a touch green, so the lime route is the brightest thing
          r = mpx[k] * 0.42; g = mpx[k + 1] * 0.46; b = mpx[k + 2] * 0.38;
        }
        const o = (py * tw + px) * 4;
        op[o] = Math.min(255, r * lit + 3); op[o + 1] = Math.min(255, g * lit + 4); op[o + 2] = Math.min(255, b * lit + 2); op[o + 3] = 255;
      }
    }
    tg.putImageData(out, 0, 0);
    return { grid: sm, gx, gy, minX, minZ, W, H, eMin, eMax, texture: tex, hasMap: mapOk,
      attribution: mapOk ? 'Esri · © OpenStreetMap contributors · Mapzen / AWS Terrain Tiles' : 'Mapzen / AWS Terrain Tiles' };
  })().catch(() => null);
  _t3cache.set(key, job);
  const r = await job;
  if (!r) _t3cache.delete(key); // try again next time
  return r;
}

function sampler(T) {
  return (x, z) => {
    const fx = ((x - T.minX) / T.W) * (T.gx - 1), fy = ((z - T.minZ) / T.H) * (T.gy - 1);
    const x0 = Math.max(0, Math.min(T.gx - 2, Math.floor(fx))), y0 = Math.max(0, Math.min(T.gy - 2, Math.floor(fy)));
    const tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0));
    const G = T.grid, w = T.gx;
    return G[y0 * w + x0] * (1 - tx) * (1 - ty) + G[y0 * w + x0 + 1] * tx * (1 - ty) + G[(y0 + 1) * w + x0] * (1 - tx) * ty + G[(y0 + 1) * w + x0 + 1] * tx * ty;
  };
}

/**
 * The real climbs and descents of a course from its elevation profile [{d km, ele m}].
 * A climb runs from a low point to the high point before the road drops back by `drop` meters; it counts when it
 * gains at least `minGain` (by default a quarter of the course's range, between 12 and 30 m, so a hilly course
 * names its big hills and a flat one still names the bridge). Descents the same way down. At most `max` of each,
 * the biggest, back in course order.
 */
function findClimbs(profile, opts = {}) {
  const P = (profile || []).filter((p) => isFinite(p.d) && isFinite(p.ele));
  if (P.length < 8) return [];
  // even 50 m steps, smoothed over ~300 m (GPS / barometer noise is not a hill)
  const total = P[P.length - 1].d, step = 0.05, n = Math.max(8, Math.round(total / step) + 1);
  const at = (d) => {
    let lo = 0, hi = P.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].d <= d) lo = m; else hi = m; }
    const a = P[lo], b = P[hi], f = b.d > a.d ? (d - a.d) / (b.d - a.d) : 0;
    return a.ele + (b.ele - a.ele) * Math.max(0, Math.min(1, f));
  };
  const raw = Array.from({ length: n }, (_, i) => at((i / (n - 1)) * total));
  const W = 3, E = raw.map((_, i) => { let s = 0, c = 0; for (let j = Math.max(0, i - W); j <= Math.min(n - 1, i + W); j++) { s += raw[j]; c++; } return s / c; });
  const range = Math.max(...E) - Math.min(...E);
  const minGain = opts.minGain != null ? opts.minGain : Math.max(12, Math.min(30, range * 0.25));
  const drop = opts.drop != null ? opts.drop : Math.max(6, minGain * 0.35);
  const max = opts.max || 5;
  const dAt = (i) => (i / (n - 1)) * total;
  function scan(sign) {
    const out = [];
    let lo = 0, hi = 0; // for descents the same walk on the negated profile
    const v = (i) => sign * E[i];
    for (let i = 1; i < n; i++) {
      if (v(hi) - v(lo) >= minGain && v(hi) - v(i) >= drop) { out.push([lo, hi]); lo = i; hi = i; continue; }
      // the climb starts at the LAST low point: a flat stretch before a hill is not part of it
      if (v(i) <= v(lo) + 0.4 && v(hi) - v(lo) < minGain) { lo = i; hi = i; }
      if (v(i) > v(hi)) hi = i;
    }
    if (v(hi) - v(lo) >= minGain) out.push([lo, hi]);
    return out.map(([a, b]) => {
      const d0 = dAt(a), d1 = dAt(b), gain = Math.abs(E[b] - E[a]), len = Math.max(0.05, d1 - d0);
      return { kind: sign > 0 ? 'climb' : 'descent', d0, d1, gain, len, grade: (gain / (len * 1000)) * 100 };
    });
  }
  const pick = (list) => list.sort((a, b) => b.gain - a.gain).slice(0, max).sort((a, b) => a.d0 - b.d0);
  return pick(scan(1)).concat(pick(scan(-1))).sort((a, b) => a.d0 - b.d0);
}

window.TERRAIN3D = { loadTerrain, sampler, findClimbs, t3box, t3zoomFor, t3wx, t3wy };
