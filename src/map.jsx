// map.jsx — interactive route map from GPX track using Leaflet + CARTO dark
// tiles (to match the dark UI). The polyline always renders even if tiles
// are slow/unavailable, so the route shape is never lost.
function RouteMap({ track, height = 340 }) {
  const ref = React.useRef(null);
  const mapRef = React.useRef(null);

  React.useEffect(() => {
    const L = window.L;
    if (!L || !ref.current || !track || track.length < 2) return;
    const map = L.map(ref.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
    mapRef.current = map;
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19, subdomains: 'abcd',
      attribution: '© OpenStreetMap · © CARTO',
    }).addTo(map);
    const poly = L.polyline(track, { color: '#C9A24B', weight: 4, opacity: 0.95, lineJoin: 'round' }).addTo(map);
    const dot = (latlng, fill) => L.circleMarker(latlng, {
      radius: 6, color: '#111528', weight: 2, fillColor: fill, fillOpacity: 1,
    }).addTo(map);
    dot(track[0], '#8091BE');                 // start  (navy-muted)
    dot(track[track.length - 1], '#C15A2E');  // finish (danger)
    map.fitBounds(poly.getBounds(), { padding: [26, 26] });
    const t = setTimeout(() => map.invalidateSize(), 80);
    return () => { clearTimeout(t); map.remove(); mapRef.current = null; };
  }, [track]);

  return (
    <div ref={ref} style={{
      height, width: '100%', borderRadius: 'var(--rp-r-12)', overflow: 'hidden',
      background: 'var(--rp-bg)', border: '1px solid var(--rp-line)',
    }} />
  );
}

window.RouteMap = RouteMap;
