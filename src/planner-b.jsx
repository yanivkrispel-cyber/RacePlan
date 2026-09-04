// planner-b.jsx — standalone "ליל" planner (version B), full-viewport &
// responsive, with GPX course import. No canvas, no separate mobile frame.
const { useRacePlan, formatPace, formatClock, formatKm, PaceChart,
        LogoSlot, ZoneLegend, PresetSelector, SegmentsTable,
        parseGpx, ElevationChart, RouteMap, round2, clearSavedPlan,
        AthleteDB, AthletePanel, computeSegmentElevations } = window;

// keep ~N evenly-spaced samples (always including the last) for chart/map
function downsample(arr, max) {
  if (arr.length <= max) return arr;
  const step = Math.ceil(arr.length / max);
  const out = [];
  for (let i = 0; i < arr.length; i += step) out.push(arr[i]);
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
  return out;
}

// ── share URL helpers ──────────────────────────────────────────────────
function encodePlan(raceName, trainer, preset, segments) {
  const payload = {
    v: 1,
    r: raceName,
    t: trainer,
    p: preset,
    s: segments.map(s => [round2(s.distance), s.paceSec]),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  bytes.forEach(b => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function decodePlan(str) {
  try {
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (data.v !== 1 || !Array.isArray(data.s) || !data.s.length) return null;
    return data;
  } catch { return null; }
}

// contentEditable text that commits on blur/Enter
function EditableText({ value, onChange, placeholder, style }) {
  return (
    <span
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onBlur={(e) => onChange((e.currentTarget.textContent || '').trim() || placeholder)}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
      onFocus={(e) => { e.currentTarget.style.background = 'rgba(124,140,255,.14)'; }}
      onMouseLeave={(e) => { if (document.activeElement !== e.currentTarget) e.currentTarget.style.background = 'transparent'; }}
      style={{ outline: 'none', cursor: 'text', borderRadius: 6, padding: '0 4px', margin: '0 -4px',
        transition: 'background .12s', ...style }}
    >{value}</span>
  );
}

// Chart palette — pulled from the design tokens. SVG can't read CSS vars for
// every attribute reliably across the chart code, so the resolved hexes live
// here and mirror :root in shared.jsx.
const themeB = {
  line: '#C9A24B', avg: 'rgba(246,239,227,.38)', grid: 'rgba(246,239,227,.07)',
  textDim: '#9BA0B7', dotFill: '#1a2140',
  zones: { fast: '#C15A2E', target: '#C9A24B', easy: '#8091BE' },
};

const LS_RACE_DATE = 'rp-race-date';
const LS_RACE_TIME = 'rp-race-time';

function _windDirLabel(deg) {
  const dirs = ['צפוני', 'צפון-מזרחי', 'מזרחי', 'דרום-מזרחי', 'דרומי', 'דרום-מערבי', 'מערבי', 'צפון-מערבי'];
  return dirs[Math.round(deg / 45) % 8];
}

function _weatherIcon(code) {
  if (code === 0) return '☀️';
  if (code <= 3) return '⛅';
  if (code <= 48) return '🌫';
  if (code <= 67) return '🌦';
  if (code <= 77) return '❄️';
  if (code <= 82) return '🌧';
  return '⛈';
}

function WeatherCard({ weather, status }) {
  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10,
        background: 'var(--rp-surface)', border: '1px solid var(--rp-line)',
        borderRadius: 'var(--rp-r-12)', padding: '11px 16px', marginBottom: 10,
        fontSize: 13, color: 'var(--rp-text-dim)' }}>
        <span style={{ fontSize: 18 }}>🌍</span> טוען תחזית מזג אוויר...
      </div>
    );
  }
  if (!weather) return null;
  const wet = weather.precipProb > 50;
  return (
    <div style={{ display: 'flex', gap: 0, flexWrap: 'wrap', alignItems: 'stretch',
      background: 'var(--rp-surface)', border: '1px solid var(--rp-line)',
      borderRadius: 'var(--rp-r-12)', overflow: 'hidden', marginBottom: 10 }}>

      {/* temperature */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 18px', flex: '1 1 auto' }}>
        <span style={{ fontSize: 26, lineHeight: 1 }}>{_weatherIcon(weather.code)}</span>
        <div>
          <div style={{ fontFamily: 'var(--rp-font-display)', fontSize: 21, fontWeight: 800,
            color: 'var(--rp-text)', lineHeight: 1 }}>{weather.temp}°C</div>
          <div style={{ fontSize: 11, color: 'var(--rp-text-dim)', marginTop: 3 }}>מרגיש {weather.feelsLike}°C</div>
        </div>
      </div>

      <div style={{ width: 1, background: 'var(--rp-line)', alignSelf: 'stretch', margin: '8px 0' }} />

      {/* wind */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 18px', flex: '1 1 auto' }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--rp-gold)" strokeWidth="2.2"
          strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0,
            transform: `rotate(${weather.windDir}deg)`, transition: 'transform var(--rp-t-phase)' }}>
          <line x1="12" y1="20" x2="12" y2="4" />
          <polyline points="5 11 12 4 19 11" />
        </svg>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--rp-text)', lineHeight: 1 }}>
            {weather.windSpeed} <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--rp-text-dim)' }}>קמ"ש</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--rp-text-dim)', marginTop: 3 }}>רוח {_windDirLabel(weather.windDir)}</div>
        </div>
      </div>

      <div style={{ width: 1, background: 'var(--rp-line)', alignSelf: 'stretch', margin: '8px 0' }} />

      {/* precipitation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 18px', flex: '1 1 auto' }}>
        <svg width="18" height="18" viewBox="0 0 24 24"
          fill={wet ? 'var(--rp-gold)' : 'var(--rp-text-dim)'}
          stroke={wet ? 'var(--rp-gold)' : 'var(--rp-text-dim)'} strokeWidth="1" style={{ flexShrink: 0 }}>
          <path d="M12 2C6 10 4 14 4 16a8 8 0 0 0 16 0c0-2-2-6-8-14z" />
        </svg>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1,
            color: wet ? 'var(--rp-gold)' : 'var(--rp-text)' }}>
            {weather.precipProb}%
          </div>
          <div style={{ fontSize: 11, color: 'var(--rp-text-dim)', marginTop: 3 }}>סיכוי לגשם</div>
        </div>
      </div>
    </div>
  );
}

function StatCardB({ label, value, sub, accent }) {
  return (
    <div className="rp-stat" style={{ flex: '1 1 130px', background: 'var(--rp-surface)', border: '1px solid var(--rp-line)',
      borderRadius: 'var(--rp-r-12)', padding: '12px 14px' }}>
      <div className="rp-stat-label" style={{ fontSize: 10, fontWeight: 700, color: 'var(--rp-text-dim)',
        letterSpacing: '.1em', marginBottom: 6 }}>{label}</div>
      <div className="rp-stat-value" style={{ fontFamily: 'var(--rp-font-display)', fontSize: 24, fontWeight: 800,
        lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: accent || 'var(--rp-text)' }}>{value}</div>
      {sub && <div className="rp-stat-sub" style={{ fontSize: 11.5, color: 'var(--rp-text-dim)', marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

function GpxBanner({ course, onClear }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      background: 'var(--rp-gold-wash)', border: '1px solid var(--rp-gold-line)',
      borderRadius: 'var(--rp-r-12)', padding: '10px 14px', marginBottom: 10 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 28, height: 28, borderRadius: 'var(--rp-r-8)', background: 'var(--rp-gold-line)', flex: '0 0 auto' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--rp-gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3Z" /><path d="M9 3v15M15 6v15" />
        </svg>
      </span>
      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--rp-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {course.name || 'מסלול מיובא'} <span style={{ fontWeight: 500, color: 'var(--rp-gold)' }}>· מתוך GPX</span>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--rp-text-dim)', marginTop: 2 }}>
          {formatKm(course.dist)} ק"מ · עלייה {course.gain} מ׳ · ירידה {course.loss} מ׳
          {course.source ? ` · ${course.source}` : ''}
        </div>
      </div>
      <button className="rp-btn" onClick={onClear} style={{ flex: '0 0 auto', padding: '7px 12px', fontSize: 13 }}>הסר מסלול</button>
    </div>
  );
}

// Toast — navy surface, cream text, bottom-center, per DESIGN_TOKENS §States.
// Portaled to <body> so it pins to the viewport, not the CSS-container root.
function CopyToast({ show }) {
  return ReactDOM.createPortal((
    <div role="status" aria-live="polite" style={{
      position: 'fixed', bottom: 'calc(24px + env(safe-area-inset-bottom))',
      insetInline: 0, marginInline: 'auto', width: 'max-content', maxWidth: '90vw', zIndex: 9999,
      background: 'var(--rp-surface)', border: '1px solid var(--rp-line)', borderRadius: 'var(--rp-r-12)',
      padding: '12px 20px', fontSize: 14, fontWeight: 600, color: 'var(--rp-text)',
      display: 'flex', alignItems: 'center', gap: 8,
      boxShadow: 'var(--rp-shadow-modal)',
      transition: 'opacity var(--rp-t-panel), transform var(--rp-t-panel)',
      opacity: show ? 1 : 0,
      transform: show ? 'translateY(0)' : 'translateY(12px)',
      pointerEvents: 'none',
    }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--rp-gold)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
      הקישור הועתק ללוח
    </div>
  ), document.body);
}

function PlannerB() {
  // Decode the shared plan synchronously (runs before first render, no flash).
  // Apps Script serves the payload as window.__RACEPLAN_SHARE__ (from ?s=), since
  // the page runs in a sandboxed iframe where location.hash isn't the real URL.
  // Plain static hosting still uses the #s= hash.
  const [shareData] = React.useState(() => {
    const injected = typeof window !== 'undefined' && window.__RACEPLAN_SHARE__;
    if (injected) return decodePlan(injected);
    const hash = location.hash;
    if (!hash.startsWith('#s=')) return null;
    return decodePlan(hash.slice(3));
  });

  // Clean the hash from the URL after mount (cosmetic; replaceState can throw in
  // a sandboxed iframe, so guard it).
  React.useEffect(() => {
    try {
      if (shareData && location.hash.startsWith('#s=')) {
        history.replaceState(null, '', location.pathname + location.search);
      }
    } catch (e) { /* sandboxed iframe — ignore */ }
  }, []);

  // If a share URL was decoded, build initial segments for the hook
  const sharedSegs = React.useMemo(() =>
    shareData?.s?.map(([d, pace], i) => ({ id: 'sh' + i, distance: d, paceSec: pace })) ?? null,
  []);

  const p = useRacePlan(sharedSegs, shareData?.p);
  const { plan } = p;

  const segElevs = React.useMemo(
    () => computeSegmentElevations(p.course?.profile ?? null, plan.rows),
    [p.course, plan.rows],
  );
  const fileRef = React.useRef(null);
  const [raceName, setRaceName] = React.useState(
    () => shareData?.r || localStorage.getItem('rp-race') || 'מרוץ העיר'
  );
  const [trainer, setTrainer] = React.useState(
    () => shareData?.t || localStorage.getItem('rp-trainer') || 'שם המתאמן'
  );
  const [copied, setCopied] = React.useState(false);
  const [showElevation, setShowElevation] = React.useState(true);
  const [showAthletePanel, setShowAthletePanel] = React.useState(false);
  const [raceDate, setRaceDate] = React.useState(() => localStorage.getItem(LS_RACE_DATE) || '');
  const [raceTime, setRaceTime] = React.useState(() => localStorage.getItem(LS_RACE_TIME) || '07:00');
  const [weather, setWeather] = React.useState(null);
  const [weatherStatus, setWeatherStatus] = React.useState('idle');

  React.useEffect(() => { localStorage.setItem('rp-race', raceName); }, [raceName]);
  React.useEffect(() => { localStorage.setItem('rp-trainer', trainer); }, [trainer]);
  React.useEffect(() => { localStorage.setItem(LS_RACE_DATE, raceDate); }, [raceDate]);
  React.useEffect(() => { localStorage.setItem(LS_RACE_TIME, raceTime); }, [raceTime]);

  React.useEffect(() => {
    const lat = p.course?.lat;
    const lon = p.course?.lon;
    if (!lat || !lon || !raceDate) {
      setWeather(null);
      setWeatherStatus('idle');
      return;
    }
    setWeatherStatus('loading');
    setWeather(null);
    const hour = raceTime
      ? Math.min(23, Math.round(parseInt(raceTime.split(':')[0], 10) + parseInt(raceTime.split(':')[1] || '0', 10) / 60))
      : 7;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=temperature_2m,apparent_temperature,windspeed_10m,winddirection_10m,precipitation_probability,weathercode` +
      `&timezone=auto&start_date=${raceDate}&end_date=${raceDate}`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        const h = data.hourly;
        if (!h || !h.temperature_2m) { setWeatherStatus('idle'); return; }
        setWeather({
          temp: Math.round(h.temperature_2m[hour]),
          feelsLike: Math.round(h.apparent_temperature[hour]),
          windSpeed: Math.round(h.windspeed_10m[hour]),
          windDir: Math.round(h.winddirection_10m[hour]),
          precipProb: h.precipitation_probability?.[hour] ?? 0,
          code: h.weathercode[hour],
        });
        setWeatherStatus('ok');
      })
      .catch(() => setWeatherStatus('idle'));
  }, [p.course?.lat, p.course?.lon, raceDate, raceTime]);

  const onGpx = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseGpx(text);
      const hasEle = parsed.points.some((pt) => isFinite(pt.ele));
      p.loadCourse({
        name: parsed.name, dist: parsed.totalDist, gain: parsed.elevGain, loss: parsed.elevLoss, source: file.name,
        profile: hasEle ? downsample(parsed.points.map((pt) => ({ d: pt.cum / 1000, ele: pt.ele })), 320) : null,
        track: downsample(parsed.points.map((pt) => [pt.lat, pt.lon]), 500),
        lat: parsed.startLat,
        lon: parsed.startLon,
      });
    } catch (err) {
      alert('לא ניתן לקרוא את קובץ ה-GPX:\n' + (err && err.message ? err.message : err));
    }
    e.target.value = '';
  };

  const onShare = () => {
    const encoded = encodePlan(raceName, trainer, p.activePreset, p.segments);
    const base = (typeof window !== 'undefined' && window.__RACEPLAN_EXEC_URL__) || '';
    const url = base
      ? base + (base.indexOf('?') === -1 ? '?' : '&') + 's=' + encoded
      : location.href.split('#')[0] + '#s=' + encoded;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url)
        .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); })
        .catch(() => prompt('קישור לשיתוף:', url));
    } else {
      prompt('קישור לשיתוף:', url);
    }
  };

  const onReset = () => {
    p.reset();
    try {
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    } catch (e) { /* sandboxed iframe — ignore */ }
  };

  // Load a saved plan from the athlete bank into the planner
  const handleLoadFromBank = (plan, athleteName) => {
    setRaceName(plan.raceName || '');
    if (athleteName) setTrainer(athleteName);
    p.restorePlan({ s: plan.segments, p: plan.preset });
    if (plan.course) {
      p.loadCourse(plan.course);
    } else {
      p.clearCourse();
    }
  };

  // When trainer name changes, it will auto-match in AthletePanel on next open
  const handleTrainerChange = (name) => {
    setTrainer(name);
  };

  // The legacy --rp-* contract is remapped to the design tokens in shared.jsx
  // (.rp-cq block); here we only set the page frame.
  const varsB = {
    fontFamily: 'var(--rp-font-ui)',
    background: 'var(--rp-bg)', color: 'var(--rp-text)', direction: 'rtl',
    minHeight: '100vh', boxSizing: 'border-box',
  };

  return (
    <div className="rp-cq" style={varsB}>
      {/* Desktop density; narrow widths get comfortable sizing + a reachable
          bottom action bar. Container-queries so it also adapts inside a
          narrow embed (Apps Script iframe), not only a small viewport. */}
      <style>{`
        .rpt-seg { padding: 6px 12px; }
        .rpt-head { padding: 0 12px 8px; }
        .rpt-total { padding: 11px 12px; margin-top: var(--rp-s-8); }
        .rp-toolbar { flex-wrap: wrap; }
        @container (max-width: 640px) {
          .rp-planner-wrap { padding: 12px 12px 20px !important; }
          .rpt-seg { padding: 14px !important; }
          .rpt-total { padding: 14px !important; }
          /* sticky (not fixed): container-type on .rp-cq would re-anchor a
             fixed child to the container, defeating the pin */
          .rp-toolbar { position: sticky; bottom: 8px; z-index: 40;
            background: var(--rp-surface);
            background: color-mix(in srgb, var(--rp-surface) 92%, transparent);
            backdrop-filter: blur(8px);
            border: 1px solid var(--rp-line); border-radius: var(--rp-r-12);
            padding: 9px !important; margin: 4px 0 12px !important; gap: 8px !important;
            box-shadow: 0 8px 24px rgba(0,0,0,.45);
            flex-wrap: nowrap; overflow-x: auto; -webkit-overflow-scrolling: touch;
            scrollbar-width: none; }
          .rp-toolbar::-webkit-scrollbar { display: none; }
          .rp-toolbar .rp-btn { flex: 0 0 auto; }
          .rp-preset-row { overflow-x: auto; -webkit-overflow-scrolling: touch;
            scrollbar-width: none; }
          .rp-preset-row::-webkit-scrollbar { display: none; }
          .rp-preset-row .rpt-presets { flex-wrap: nowrap; }
          .rp-header { flex-wrap: wrap; gap: 8px 12px !important; }
          .rp-brand { display: none !important; }
          .rp-stats { display: grid !important; grid-template-columns: 1fr 1fr; }
          .rp-stat { flex: none !important; display: flex; align-items: baseline;
            flex-wrap: wrap; gap: 2px 8px; padding: 11px 12px !important; }
          .rp-stat-label { width: 100%; margin-bottom: 2px !important; }
          .rp-stat-value { font-size: 21px !important; }
          .rp-stat-sub { margin-top: 0 !important; font-size: 11px !important; }
          .rp-stats .rp-stat:first-child { grid-column: 1 / -1; }
        }
      `}</style>

      <div className="rp-planner-wrap" style={{ maxWidth: 1180, margin: '0 auto', padding: '16px var(--rp-pad) 24px' }}>

        {/* ── header: logo (right) | race + trainer (center) | Coach Krispel (left) ── */}
        <div className="rp-header" style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 }}>

          {/* RIGHT: logo (in RTL first flex child = right side) */}
          <div style={{ position: 'relative', width: 68, height: 68, borderRadius: '50%',
            overflow: 'hidden', flex: '0 0 auto', background: 'var(--rp-surface)',
            boxShadow: '0 0 0 2px var(--rp-gold-line), var(--rp-shadow)' }}>
            <img
              src={(typeof window !== 'undefined' && window.__RACEPLAN_LOGO__) || 'logo.png'}
              alt="Coach Krispel"
              style={{ position: 'absolute', top: '50%', left: '50%',
                transform: 'translate(-50%, -50%) scale(1.14)',
                width: '100%', height: '100%', objectFit: 'cover' }}
            />
            {/* radial vignette hides any pale background at the coin edges */}
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%',
              background: 'radial-gradient(circle, transparent 60%, var(--rp-bg) 100%)',
              pointerEvents: 'none' }} />
          </div>

          {/* CENTER: race name + trainer name + date/time */}
          <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--rp-font-display)', fontSize: 'clamp(20px, 5vw, 27px)',
              fontWeight: 800, lineHeight: 1.15, textWrap: 'balance', color: 'var(--rp-text)' }}>
              <EditableText value={raceName} onChange={setRaceName} placeholder="שם המרוץ" />
            </div>
            <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--rp-text-soft)', marginTop: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <EditableText value={trainer} onChange={handleTrainerChange} placeholder="שם המתאמן"
                style={{ color: 'var(--rp-text-soft)' }} />
              <button
                onClick={() => setShowAthletePanel(true)}
                title="מאגר מתאמנים"
                aria-label="מאגר מתאמנים"
                style={{
                  background: 'var(--rp-gold-wash)', border: '1px solid var(--rp-gold-line)',
                  borderRadius: 'var(--rp-r-8)', padding: 8, cursor: 'pointer',
                  color: 'var(--rp-gold)', lineHeight: 1, display: 'inline-flex', alignItems: 'center',
                  transition: 'background var(--rp-t-fast)', flex: '0 0 auto',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--rp-gold-line)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'var(--rp-gold-wash)'; }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
              </button>
            </div>
            {/* race date + time */}
            <div style={{ marginTop: 7, display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 8, fontSize: 13, color: 'var(--rp-text-dim)' }}>
              <span aria-hidden="true">📅</span>
              <input type="date" value={raceDate} onChange={(e) => setRaceDate(e.target.value)}
                aria-label="תאריך המרוץ"
                style={{ background: 'transparent', border: '1px solid var(--rp-line)', borderRadius: 'var(--rp-r-8)',
                  padding: '6px 8px', outline: 'none', cursor: 'pointer', minHeight: 36,
                  color: raceDate ? 'var(--rp-text-soft)' : 'var(--rp-placeholder)', fontSize: 13,
                  fontFamily: 'inherit', fontWeight: 500, colorScheme: 'dark' }} />
              <span aria-hidden="true">⏰</span>
              <input type="time" value={raceTime} onChange={(e) => setRaceTime(e.target.value)}
                aria-label="שעת הזינוק"
                style={{ background: 'transparent', border: '1px solid var(--rp-line)', borderRadius: 'var(--rp-r-8)',
                  padding: '6px 8px', outline: 'none', cursor: 'pointer', minHeight: 36,
                  color: raceTime ? 'var(--rp-text-soft)' : 'var(--rp-placeholder)', fontSize: 13,
                  fontFamily: 'inherit', fontWeight: 500, colorScheme: 'dark' }} />
            </div>
          </div>

          {/* LEFT: Coach Krispel wordmark (RTL last flex child = left side) */}
          <div className="rp-brand" style={{ textAlign: 'center', direction: 'ltr', flex: '0 0 auto' }}>
            <div style={{ fontFamily: 'var(--rp-font-accent)', fontStyle: 'italic', fontSize: 26,
              fontWeight: 600, color: 'var(--rp-gold)', opacity: .82, lineHeight: 1.1,
              letterSpacing: '.005em' }}>
              Coach Krispel
            </div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--rp-text-dim)', letterSpacing: '.14em',
              textTransform: 'uppercase', marginTop: 3 }}>
              Running Coach
            </div>
          </div>
        </div>

        {p.course && <GpxBanner course={p.course} onClear={p.clearCourse} />}

        <WeatherCard weather={weather} status={weatherStatus} />

        {/* stat cards */}
        <div className="rp-stats" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <StatCardB label="זמן כולל מחושב" value={formatClock(plan.totalTime)}
            sub={`קצב ממוצע ${formatPace(plan.avgPace)} / ק"מ`} accent="var(--rp-gold)" />
          <StatCardB label={'סה"כ מרחק'} value={formatKm(plan.totalDist)} sub="קילומטרים" />
          <StatCardB label="קצב ממוצע" value={formatPace(plan.avgPace)} sub={'דקות / ק"מ'} />
        </div>

        {/* preset + actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
          flexWrap: 'wrap', marginBottom: 12 }}>
          <div className="rp-preset-row" style={{ maxWidth: '100%' }}>
            <PresetSelector active={p.activePreset} onPick={p.applyPreset} />
          </div>
          <div className="rp-toolbar" style={{ display: 'flex', gap: 6 }}>
            <input ref={fileRef} type="file" accept=".gpx,application/gpx+xml,text/xml" onChange={onGpx} style={{ display: 'none' }} />
            <button className="rp-btn rp-btn-primary" onClick={p.addSegment}>+ קטע חדש</button>
            <button className="rp-btn" onClick={() => fileRef.current && fileRef.current.click()}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></svg>
              ייבוא GPX
            </button>
            <button className="rp-btn" onClick={onShare}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
              שיתוף
            </button>
            <button className="rp-btn" onClick={() => window.print()}>הדפסה</button>
            <button className="rp-btn" onClick={onReset}>איפוס</button>
          </div>
        </div>

        <SegmentsTable plan={plan} colors={themeB} stepperKind="pill"
          paceStep={1} distStep={0.01}
          onStepDist={p.stepDistance} onSetDist={p.setSegmentDistance}
          onStepPace={p.stepPace} onSetPace={p.setSegmentPace} onRemove={p.removeSegment}
          elevations={segElevs} />

        {/* pace chart */}
        <div style={{ marginTop: 12, background: 'var(--rp-surface)', border: '1px solid var(--rp-line)',
          borderRadius: 'var(--rp-r-14)', padding: '12px 14px 4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--rp-text-soft)' }}>
              פרופיל קצב — לפי מרחק מצטבר
            </div>
            {p.course?.profile && (
              <button
                onClick={() => setShowElevation((v) => !v)}
                aria-pressed={showElevation}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  background: showElevation ? 'var(--rp-gold-wash)' : 'transparent',
                  border: `1px solid ${showElevation ? 'var(--rp-gold-line)' : 'var(--rp-line)'}`,
                  borderRadius: 'var(--rp-r-8)', padding: '5px 10px', cursor: 'pointer',
                  fontSize: 11.5, fontWeight: 600, minHeight: 32,
                  color: showElevation ? 'var(--rp-gold)' : 'var(--rp-text-dim)',
                  transition: 'all var(--rp-t-fast)',
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
                פרופיל גובה
              </button>
            )}
          </div>
          <PaceChart rows={plan.rows} avgPace={plan.avgPace} totalDist={plan.totalDist}
            variant="area" colors={themeB} height={185}
            elevationProfile={p.course?.profile ?? null}
            showElevation={showElevation} />
        </div>

        {/* Map — full width */}
        {p.course?.track && (
          <div style={{ marginTop: 12, background: 'var(--rp-surface)', border: '1px solid var(--rp-line)',
            borderRadius: 'var(--rp-r-14)', padding: '12px 14px 14px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--rp-text-soft)', marginBottom: 8 }}>מפת המסלול</div>
            <RouteMap track={p.course.track} height={210} />
          </div>
        )}

        {/* Elevation chart — hidden (elevation shown in pace chart overlay) */}
        {false && p.course?.profile && (
          <div style={{ marginTop: 16, background: '#161b22', border: '1px solid #232a34',
            borderRadius: 16, padding: '16px 16px 6px' }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: '#aab2c0', marginBottom: 4 }}>
              פרופיל גובה — מתוך המסלול
            </div>
            <ElevationChart profile={p.course.profile} colors={themeB} height={300}
              gain={p.course.gain} loss={p.course.loss} />
          </div>
        )}

      </div>

      {showAthletePanel && (
        <AthletePanel
          onClose={() => setShowAthletePanel(false)}
          currentTrainer={trainer}
          currentRaceName={raceName}
          currentSegments={p.segments}
          currentPreset={p.activePreset}
          currentCourse={p.course}
          onLoadPlan={handleLoadFromBank}
        />
      )}

      <CopyToast show={copied} />
    </div>
  );
}

window.PlannerB = PlannerB;
