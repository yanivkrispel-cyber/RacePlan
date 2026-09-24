// gpx.jsx — parse a GPX file and derive a grade-aware pacing plan.
// Reads trackpoints, computes cumulative distance (haversine) + elevation,
// then splits the course into ~1 km blocks whose target pace is adjusted by
// each block's gradient (uphill slower, downhill a little faster).
const { round2, clamp, roundPacesToGoal } = window;
const t = (window.I18N && window.I18N.t) || ((k) => k);

function _haversine(a, b) {
  const R = 6371000, toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const la1 = a.lat * toRad, la2 = b.lat * toRad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x))); // meters
}

// Gentle moving-average over raw elevation samples before summing gain/loss —
// GPS/barometer jitter otherwise counts as up-and-down on every little wobble,
// wildly inflating the total ascent/descent of an essentially flat course.
function _smoothEle(pts) {
  const n = pts.length;
  const r = Math.min(4, Math.max(1, Math.round(n / 100)));
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0, cnt = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) {
      if (isFinite(pts[j].ele)) { sum += pts[j].ele; cnt++; }
    }
    out[i] = cnt ? sum / cnt : NaN;
  }
  return out;
}

function parseGpx(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error(t('gpx.badXml'));
  let nodes = [...doc.getElementsByTagName('trkpt')];
  if (nodes.length < 2) nodes = [...doc.getElementsByTagName('rtept')];
  if (nodes.length < 2) nodes = [...doc.getElementsByTagName('wpt')];
  const pts = nodes.map((p) => {
    const eleEl = p.getElementsByTagName('ele')[0];
    return {
      lat: parseFloat(p.getAttribute('lat')),
      lon: parseFloat(p.getAttribute('lon')),
      ele: eleEl ? parseFloat(eleEl.textContent) : NaN,
    };
  }).filter((p) => isFinite(p.lat) && isFinite(p.lon));
  if (pts.length < 2) throw new Error(t('gpx.noPoints'));

  let cum = 0, gain = 0, loss = 0;
  pts[0].cum = 0;
  for (let i = 1; i < pts.length; i++) {
    cum += _haversine(pts[i - 1], pts[i]);
    pts[i].cum = cum;
  }
  const smoothed = _smoothEle(pts);
  for (let i = 1; i < pts.length; i++) {
    if (isFinite(smoothed[i]) && isFinite(smoothed[i - 1])) {
      const d = smoothed[i] - smoothed[i - 1];
      if (d > 0) gain += d; else loss -= d;
    }
  }
  const nameEl = doc.getElementsByTagName('name')[0];
  return {
    points: pts,
    totalDist: round2(cum / 1000),
    elevGain: Math.round(gain),
    elevLoss: Math.round(loss),
    name: nameEl ? nameEl.textContent.trim() : '',
    startLat: pts[0].lat,
    startLon: pts[0].lon,
  };
}

// Split into blockKm segments; pace = base + grade adjustment.
function buildSegmentsFromGpx(parsed, basePaceSec = 300, blockKm = 1) {
  const pts = parsed.points;
  const blockM = blockKm * 1000;
  const segs = [];
  let segStartCum = 0;
  let segStartEle = pts[0].ele;
  let lastEle = pts[0].ele;

  const close = (endCum, endEle) => {
    const distM = endCum - segStartCum;
    if (distM < 30) return; // ignore slivers
    const distKm = distM / 1000;
    let paceAdj = 0;
    if (isFinite(endEle) && isFinite(segStartEle)) {
      const grade = ((endEle - segStartEle) / distM) * 100; // %
      paceAdj = clamp(grade * 14, -22, 48); // sec/km
    }
    segs.push({ distance: round2(distKm), paceSec: clamp(Math.round(basePaceSec + paceAdj), 150, 720) });
    segStartCum = endCum;
    segStartEle = endEle;
  };

  for (let i = 1; i < pts.length; i++) {
    if (isFinite(pts[i].ele)) lastEle = pts[i].ele;
    while (pts[i].cum - segStartCum >= blockM) {
      // interpolate elevation at the block boundary
      const boundary = segStartCum + blockM;
      const t = (boundary - pts[i - 1].cum) / (pts[i].cum - pts[i - 1].cum || 1);
      const ele = isFinite(pts[i].ele) && isFinite(pts[i - 1].ele)
        ? pts[i - 1].ele + t * (pts[i].ele - pts[i - 1].ele) : lastEle;
      close(boundary, ele);
    }
  }
  close(pts[pts.length - 1].cum, lastEle); // final partial block
  return segs.length ? segs : [{ distance: parsed.totalDist, paceSec: basePaceSec }];
}

// Interpolate elevation from a profile array [{d (km), ele}] at a given km distance.
function _interpolateEle(profile, dKm) {
  if (!profile || profile.length === 0) return NaN;
  if (dKm <= profile[0].d) return profile[0].ele;
  if (dKm >= profile[profile.length - 1].d) return profile[profile.length - 1].ele;
  let lo = 0, hi = profile.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (profile[mid].d <= dKm) lo = mid; else hi = mid;
  }
  const a = profile[lo], b = profile[hi];
  const t = (b.d - a.d) > 0 ? (dKm - a.d) / (b.d - a.d) : 0;
  return a.ele + t * (b.ele - a.ele);
}

// Returns an array of net elevation (meters, integer) per segment row, or null if no elevation data.
function computeSegmentElevations(profile, rows) {
  if (!profile || !profile.some((p) => isFinite(p.ele))) return null;
  let segStart = 0;
  return rows.map((r) => {
    const eleStart = _interpolateEle(profile, segStart);
    const eleEnd = _interpolateEle(profile, r.cumDist);
    segStart = r.cumDist;
    if (!isFinite(eleStart) || !isFinite(eleEnd)) return null;
    return Math.round(eleEnd - eleStart);
  });
}

// Initial great-circle bearing from point a=[lat,lon] to point b=[lat,lon], degrees 0-360.
function _bearing(a, b) {
  const toRad = Math.PI / 180;
  const phi1 = a[0] * toRad, phi2 = b[0] * toRad;
  const dLambda = (b[1] - a[1]) * toRad;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// Interpolate a [lat, lon] point at a given cumulative-km distance along `track`,
// given `dist`, the parallel array of each track point's cumulative km.
function _interpolateLatLon(track, dist, cumKm) {
  const n = track.length;
  if (cumKm <= dist[0]) return track[0];
  if (cumKm >= dist[n - 1]) return track[n - 1];
  let lo = 0, hi = n - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (dist[mid] <= cumKm) lo = mid; else hi = mid;
  }
  const a = track[lo], b = track[hi];
  const f = (dist[hi] - dist[lo]) > 0 ? (cumKm - dist[lo]) / (dist[hi] - dist[lo]) : 0;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

// Mirrors route3d.jsx's WIND_VIS_THRESHOLD_KMH — Beaufort ~4, where a runner
// actually starts to feel it. Below this the forecast's wind is noise.
const WIND_TABLE_THRESHOLD_KMH = 18;

// Returns an array of { kind: 'head'|'tail'|'cross' } per segment row — the wind
// classified against the net direction the *route* moves over that segment
// (not its every wiggle) — or null when there's no track to bear against or
// the forecast wind is too light to matter.
function computeSegmentWind(track, rows, windDir, windSpeed) {
  if (!Array.isArray(track) || track.length < 2) return null;
  if (!isFinite(windSpeed) || windSpeed < WIND_TABLE_THRESHOLD_KMH) return null;
  const dist = [0];
  for (let i = 1; i < track.length; i++) {
    dist.push(dist[i - 1] + _haversine(
      { lat: track[i - 1][0], lon: track[i - 1][1] }, { lat: track[i][0], lon: track[i][1] },
    ) / 1000);
  }
  // The forecast's `windDir` is the meteorological "from" bearing — rotate
  // 180° to get the direction the air is actually moving toward.
  const windToRad = (((windDir || 0) + 180) % 360) * Math.PI / 180;
  let segStart = 0;
  return rows.map((r) => {
    const a = _interpolateLatLon(track, dist, segStart);
    const b = _interpolateLatLon(track, dist, r.cumDist);
    segStart = r.cumDist;
    if (a[0] === b[0] && a[1] === b[1]) return null;
    const bearingRad = _bearing(a, b) * Math.PI / 180;
    const dot = Math.cos(bearingRad - windToRad);
    return { kind: dot > 0.3 ? 'tail' : dot < -0.3 ? 'head' : 'cross' };
  });
}

// Build race-plan segments from a loaded course so the plan matches the route.
// Splits into `blockKm` blocks (+ a remainder; a tail under 1 km folds into the
// last block), then sets each block's pace from a goal time, a pacing strategy,
// and — when a profile is present — that block's net gradient. Finally the whole
// set is scaled so Σ(pace·distance) === goalSec exactly.
//
//   opts = { goalSec, blockKm = 5,
//            strategy: 'even' | 'negative' | 'positive' | 'staged',
//            splitPct = 0,          // 0-8, ignored for 'even'
//            gradeAdjust = true }
function buildPlanSegments(profile, totalDist, opts) {
  const o = opts || {};
  const total = +totalDist;
  const goalSec = +o.goalSec;
  if (!(total > 0) || !(goalSec > 0)) return [];

  const blockKm = o.blockKm > 0 ? o.blockKm : 5;
  const strategy = o.strategy || 'even';
  const s = clamp((+o.splitPct || 0) / 100, 0, 0.08);
  const gradeAdjust = o.gradeAdjust !== false;
  const hasProfile = Array.isArray(profile) && profile.length > 1
    && profile.some((p) => isFinite(p.ele));

  // block boundaries
  const bounds = [0];
  for (let d = blockKm; d < total - 1e-6; d += blockKm) bounds.push(round2(d));
  bounds.push(round2(total));
  if (bounds.length >= 3 && bounds[bounds.length - 1] - bounds[bounds.length - 2] < 1) {
    bounds.splice(bounds.length - 2, 1); // fold a sub-1 km tail into the last block
  }

  const base = goalSec / total; // flat sec/km

  const raw = [];
  for (let i = 1; i < bounds.length; i++) {
    const a = bounds[i - 1];
    const b = bounds[i];
    const distKm = round2(b - a);
    const f = total > blockKm ? ((a + b) / 2) / total : 0.5; // position in the race, 0..1

    let mult = 1;
    if (strategy === 'negative') mult = 1 + s - 2 * s * f;      // slow → fast
    else if (strategy === 'positive') mult = 1 - s + 2 * s * f; // fast → slow
    else if (strategy === 'staged') mult = f < 1 / 3 ? 1 + s : f > 2 / 3 ? 1 - s : 1;

    let pace = base * mult;
    if (gradeAdjust && hasProfile) {
      const eA = _interpolateEle(profile, a);
      const eB = _interpolateEle(profile, b);
      if (isFinite(eA) && isFinite(eB)) {
        const gradePct = ((eB - eA) / (distKm * 1000)) * 100;
        pace += clamp(gradePct * 14, -22, 48); // sec/km, same model as buildSegmentsFromGpx
      }
    }
    raw.push({ distance: distKm, paceSec: pace });
  }

  // scale so the total time lands exactly on the goal
  const sum = raw.reduce((t, r) => t + r.paceSec * r.distance, 0);
  const scale = sum > 0 ? goalSec / sum : 1;
  return roundPacesToGoal(
    raw.map((r) => ({ distance: r.distance, paceSec: r.paceSec * scale })), goalSec, 150, 720);
}

// Net grade adjustment (sec/km) for a span [aKm, bKm] of the elevation profile —
// same model as buildSegmentsFromGpx. 0 when there's no usable profile.
function _gradeAdj(profile, aKm, bKm) {
  if (!Array.isArray(profile) || profile.length < 2) return 0;
  const eA = _interpolateEle(profile, aKm);
  const eB = _interpolateEle(profile, bKm);
  const distM = (bKm - aKm) * 1000;
  if (!isFinite(eA) || !isFinite(eB) || distM <= 0) return 0;
  return clamp(((eB - eA) / distM) * 100 * 14, -22, 48);
}

// Prominent peaks / valleys in the elevation profile, for "snap to the top of the
// climb" while dragging a segment boundary. minProm = metres of swing to keep one.
function findExtrema(profile, minProm) {
  if (!Array.isArray(profile) || profile.length < 3) return [];
  const prom = minProm > 0 ? minProm : 8;
  const raw = [];
  for (let i = 1; i < profile.length - 1; i++) {
    const a = profile[i - 1].ele, b = profile[i].ele, c = profile[i + 1].ele;
    if (!isFinite(a) || !isFinite(b) || !isFinite(c)) continue;
    if (b >= a && b > c) raw.push({ d: profile[i].d, ele: b, kind: 'peak' });
    else if (b <= a && b < c) raw.push({ d: profile[i].d, ele: b, kind: 'valley' });
  }
  const kept = [];
  for (const e of raw) {
    const last = kept[kept.length - 1];
    if (!last) { kept.push(e); continue; }
    if (Math.abs(e.ele - last.ele) >= prom) kept.push(e);
    else if ((e.kind === 'peak' && e.ele > last.ele) || (e.kind === 'valley' && e.ele < last.ele)) {
      kept[kept.length - 1] = e; // keep the more extreme of a noisy pair
    }
  }
  return kept;
}

// Move the boundary between segment i and i+1 to newCumKm. Only those two
// segments change distance; their pace is re-derived (flat component kept, grade
// term recomputed for the new span); then all paces are scaled so the total time
// is unchanged. Returns a fresh segments array.
function adjustSegmentBoundary(segments, profile, i, newCumKm) {
  const segs = segments.map((s) => ({ distance: s.distance, paceSec: s.paceSec }));
  if (i < 0 || i >= segs.length - 1) return segs;

  const cum = [];
  let acc = 0;
  for (const s of segs) { acc += s.distance; cum.push(acc); }
  const total = acc;
  const MIN = 0.2;
  const startI = i === 0 ? 0 : cum[i - 1];
  const endI1 = cum[i + 1];
  const b = clamp(newCumKm, startI + MIN, Math.min(endI1 - MIN, total - MIN));
  if (!(b > startI) || !(b < endI1)) return segs;

  const T = segs.reduce((t, s) => t + s.paceSec * s.distance, 0);

  const redo = (idx, aKm, bKm) => {
    const oldA = idx === 0 ? 0 : cum[idx - 1];
    const flat = segs[idx].paceSec - _gradeAdj(profile, oldA, cum[idx]);
    segs[idx].distance = round2(bKm - aKm);
    segs[idx].paceSec = flat + _gradeAdj(profile, aKm, bKm);
  };
  redo(i, startI, b);
  redo(i + 1, b, endI1);

  const T2 = segs.reduce((t, s) => t + s.paceSec * s.distance, 0);
  const scale = T2 > 0 ? T / T2 : 1;
  return segs.map((s) => ({
    distance: round2(s.distance),
    paceSec: clamp(Math.round(s.paceSec * scale), 150, 720),
  }));
}

Object.assign(window, {
  parseGpx, buildSegmentsFromGpx, computeSegmentElevations, computeSegmentWind, buildPlanSegments,
  findExtrema, adjustSegmentBoundary,
});
