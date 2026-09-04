// gpx.jsx — parse a GPX file and derive a grade-aware pacing plan.
// Reads trackpoints, computes cumulative distance (haversine) + elevation,
// then splits the course into ~1 km blocks whose target pace is adjusted by
// each block's gradient (uphill slower, downhill a little faster).
const { round2, clamp } = window;

function _haversine(a, b) {
  const R = 6371000, toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const la1 = a.lat * toRad, la2 = b.lat * toRad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x))); // meters
}

function parseGpx(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML לא תקין');
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
  if (pts.length < 2) throw new Error('לא נמצאו נקודות מסלול');

  let cum = 0, gain = 0, loss = 0;
  pts[0].cum = 0;
  for (let i = 1; i < pts.length; i++) {
    cum += _haversine(pts[i - 1], pts[i]);
    pts[i].cum = cum;
    if (isFinite(pts[i].ele) && isFinite(pts[i - 1].ele)) {
      const d = pts[i].ele - pts[i - 1].ele;
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

Object.assign(window, { parseGpx, buildSegmentsFromGpx, computeSegmentElevations });
