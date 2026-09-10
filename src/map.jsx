// map.jsx — interactive route map from GPX track using Leaflet + CARTO dark
// tiles (to match the dark UI). The polyline always renders even if tiles
// are slow/unavailable, so the route shape is never lost.
//
// Two optional visual layers on top of the plain route line:
//  - grade-colored track: when an elevation `profile` is supplied, the line
//    is drawn as many short segments colored by local grade (descent -> flat
//    -> climb), so the hills are visible on the map itself, not just on the
//    separate pace chart.
//  - split markers: when `splits` (cumulative-km + pace/zone per segment
//    boundary) is supplied, a small dot is placed at each interior segment
//    boundary, colored to match the pace-chart's zone colors, with a tap/
//    hover popup showing the split distance and target pace.
const t = (window.I18N && window.I18N.t) || ((k) => k);
const U = window.UNITS;

// Same three zone colors as themeB.zones in planner-b.jsx (kept local so this
// file has no cross-module dependency — see valueeditor.jsx for the same
// convention).
const ZONE_COLOR = { fast: '#C15A2E', target: '#C9A24B', easy: '#8091BE' };

function _haversineKm(a, b) {
  const R = 6371, toRad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toRad, dLon = (b[1] - a[1]) * toRad;
  const la1 = a[0] * toRad, la2 = b[0] * toRad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

// Cumulative distance (km) at each track point, same length as track.
function _trackCumKm(track) {
  const cum = [0];
  for (let i = 1; i < track.length; i++) cum.push(cum[i - 1] + _haversineKm(track[i - 1], track[i]));
  return cum;
}

// Interpolated [lat, lon] at a given cumulative distance along the track.
function _latLngAtKm(track, cum, dKm) {
  const total = cum[cum.length - 1];
  const d = Math.max(0, Math.min(total, dKm));
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid; else hi = mid;
  }
  const d0 = cum[lo], d1 = cum[hi];
  const f = d1 > d0 ? (d - d0) / (d1 - d0) : 0;
  const a = track[lo], b = track[hi];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

// Grade % (clamped to ±12) -> a color on a descent(blue) -> flat(gray) ->
// climb(wine) scale. Same hues as --rp-elev-down / --rp-elev-up.
function _gradeColor(gradePct) {
  const DESC = [124, 155, 214];   // #7C9BD6
  const NEUTRAL = [155, 160, 183]; // #9BA0B7
  const CLIMB = [195, 96, 121];   // #C36079
  const g = Math.max(-12, Math.min(12, gradePct));
  const [c0, c1, f] = g <= 0 ? [DESC, NEUTRAL, (g + 12) / 12] : [NEUTRAL, CLIMB, g / 12];
  const mix = (i) => Math.round(c0[i] + (c1[i] - c0[i]) * f);
  return `rgb(${mix(0)},${mix(1)},${mix(2)})`;
}

function RouteMap({ track, profile, splits, height = 340 }) {
  const ref = React.useRef(null);
  const mapRef = React.useRef(null);

  React.useEffect(() => {
    const L = window.L;
    if (!L || !ref.current || !track || track.length < 2) return;
    // Passing center/zoom here makes Leaflet call setView() synchronously in
    // the constructor, so the map is already "loaded" before any layer is
    // added below. Without this, every .addTo(map) call before the first
    // fitBounds() just queues a pending 'load' listener, and they all get
    // flushed in one synchronous cascade the moment fitBounds() finally runs
    // — if any single layer throws during that cascade, the rest silently
    // never attach (Leaflet's event dispatch has no per-listener try/catch).
    // Giving the map a view up front means each layer attaches immediately
    // and independently instead.
    const map = L.map(ref.current, {
      zoomControl: true, attributionControl: true, scrollWheelZoom: false,
      center: track[0], zoom: 13,
    });
    mapRef.current = map;
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19, subdomains: 'abcd',
      attribution: '© OpenStreetMap · © CARTO',
    }).addTo(map);

    // Adding many small path layers (the grade-colored segments) synchronously
    // in the same tick the container div was inserted can hit Leaflet
    // internals before the browser has given that div a real layout size.
    // Deferring past that tick — after invalidateSize() — avoids that race. A
    // short timeout (rather than requestAnimationFrame, which never fires in
    // a backgrounded/inactive tab) keeps this reliable either way.
    let cancelled = false;
    const raf = setTimeout(() => {
      if (cancelled) return;
      map.invalidateSize();

      const dot = (latlng, fill, radius) => L.circleMarker(latlng, {
        radius: radius || 6, color: '#111528', weight: 2, fillColor: fill, fillOpacity: 1,
      }).addTo(map);

      // The grade-colored track and split markers are a decorative
      // enhancement layered on top of Leaflet's own layer/bounds bookkeeping
      // — wrapped so a quirk there (e.g. a degenerate zero-length segment)
      // can never take down the whole planner. On any failure we fall back
      // to the plain single-color line, which must always render.
      let bounds = null;
      try {
        const hasProfile = Array.isArray(profile) && profile.length > 1
          && profile.some((p) => isFinite(p.ele));
        if (hasProfile) {
          const cum = _trackCumKm(track);
          const group = L.layerGroup().addTo(map);
          for (let i = 0; i < profile.length - 1; i++) {
            const a = profile[i], b = profile[i + 1];
            const distKm = b.d - a.d;
            if (!(distKm > 0) || !isFinite(a.ele) || !isFinite(b.ele)) continue;
            const gradePct = ((b.ele - a.ele) / (distKm * 1000)) * 100;
            const p0 = _latLngAtKm(track, cum, a.d);
            const p1 = _latLngAtKm(track, cum, b.d);
            if (!isFinite(p0[0]) || !isFinite(p0[1]) || !isFinite(p1[0]) || !isFinite(p1[1])) continue;
            if (p0[0] === p1[0] && p0[1] === p1[1]) continue; // zero-length segment
            L.polyline([p0, p1], { color: _gradeColor(gradePct), weight: 5, opacity: 0.95, lineJoin: 'round' }).addTo(group);
          }
          bounds = L.latLngBounds(track);
        }
        if (Array.isArray(splits) && splits.length) {
          const cum = _trackCumKm(track);
          splits.forEach((s) => {
            const latlng = _latLngAtKm(track, cum, s.cumDist);
            if (!isFinite(latlng[0]) || !isFinite(latlng[1])) return;
            const label = `${U ? U.fmtDist(s.cumDist) : s.cumDist + ' km'} · ${U ? U.fmtPace(s.paceSec) + ' ' + U.paceUnit() : s.paceSec}`;
            dot(latlng, ZONE_COLOR[s.zone] || ZONE_COLOR.target, 5).bindPopup(label);
          });
        }
      } catch (e) {
        try { console.warn('[RouteMap] grade/split layer failed, falling back to plain line', e); } catch (e2) {}
      }

      if (!bounds) {
        const poly = L.polyline(track, { color: '#C9A24B', weight: 4, opacity: 0.95, lineJoin: 'round' }).addTo(map);
        bounds = poly.getBounds();
      }

      dot(track[0], '#8091BE');                 // start  (navy-muted)
      dot(track[track.length - 1], '#C15A2E');  // finish (danger)
      try { map.fitBounds(bounds, { padding: [26, 26] }); } catch (e) {}
    }, 0);

    return () => {
      cancelled = true; clearTimeout(raf); map.remove(); mapRef.current = null;
    };
  }, [track, profile, splits]);

  return (
    <div ref={ref} style={{
      height, width: '100%', borderRadius: 'var(--rp-r-12)', overflow: 'hidden',
      background: 'var(--rp-bg)', border: '1px solid var(--rp-line)',
    }} />
  );
}

window.RouteMap = RouteMap;
