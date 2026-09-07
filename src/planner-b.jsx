// planner-b.jsx — standalone "ליל" planner (version B), full-viewport &
// responsive, with GPX course import. No canvas, no separate mobile frame.
const { useRacePlan, formatPace, formatClock, parseClock, formatKm, PaceChart,
        LogoSlot, ZoneLegend, PresetSelector, SegmentsTable,
        parseGpx, ElevationChart, RouteMap, round2, clearSavedPlan,
        AthleteDB, AthletePanel, MyPlansDB, MyPlansPanel, RouteLibrary,
        computeSegmentElevations, buildPlanSegments } = window;

// ── role ──────────────────────────────────────────────────────────────
// Firebase (window.RP_FIREBASE) is the source of truth for who's signed in and
// their tier ('owner' = the coach, gets the athlete bank; 'free' = personal
// planning only). window.__RACEPLAN_USER__ is the snapshot the bootstrap sets
// after auth resolves. Plain static hosting (RacePlan.html) has neither → full
// access for local/dev.
const RP_FB = (typeof window !== 'undefined' && window.RP_FIREBASE) || null;
const RP_USER = (typeof window !== 'undefined' && window.__RACEPLAN_USER__) || null;
const RP_IS_OWNER = RP_FB ? (!!RP_USER && RP_USER.tier === 'owner') : (!RP_USER || RP_USER.tier === 'owner');

// Record this visit in the owner's customer list (users/{uid}). Firebase-only.
function logUsage() {
  try { if (RP_FB && RP_FB.logVisit) RP_FB.logVisit(); } catch (e) {}
}

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

function GpxBanner({ course, onClear, onSaveToLibrary, ownerMode }) {
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
      {onSaveToLibrary && (
        <button className="rp-btn" onClick={onSaveToLibrary} style={{ flex: '0 0 auto', padding: '7px 12px', fontSize: 13 }}>
          {ownerMode ? 'שמור בספרייה' : 'הצע מסלול לספרייה'}
        </button>
      )}
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

// A button that fires once on tap and auto-repeats (accelerating) while held —
// so h/m/s can be set entirely by tapping, no keyboard.
function HoldButton({ delta, onStep, children, style, ariaLabel }) {
  const t = React.useRef(null);
  const stop = () => { if (t.current) { clearTimeout(t.current); t.current = null; } };
  React.useEffect(() => stop, []);
  const start = (e) => {
    e.preventDefault();
    onStep(delta);
    let gap = 300;
    const tick = () => { onStep(delta); gap = Math.max(45, gap * 0.82); t.current = setTimeout(tick, gap); };
    t.current = setTimeout(tick, 380);
  };
  return (
    <button type="button" aria-label={ariaLabel || (delta < 0 ? 'הפחת' : 'הוסף')}
      onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      style={{
        cursor: 'pointer', touchAction: 'manipulation', lineHeight: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto',
        ...style,
      }}>{children}</button>
  );
}

// ── race finish-line clock (CSS seven-segment) ─────────────────────────
const SEG_ON = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg',
  5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
const SEG_PTS = {
  a: '3,4 5,2 19,2 21,4 19,6 5,6',
  g: '3,22 5,20 19,20 21,22 19,24 5,24',
  d: '3,40 5,38 19,38 21,40 19,42 5,42',
  f: '3,5 5,7 5,19 3,21 1,19 1,7',
  b: '21,5 23,7 23,19 21,21 19,19 19,7',
  e: '3,23 5,25 5,37 3,39 1,37 1,25',
  c: '21,23 23,25 23,37 21,39 19,37 19,25',
};
function SevenSeg({ value, h = 44 }) {
  const on = SEG_ON[value] || '';
  return (
    <svg viewBox="0 0 24 44" height={h} width={h * (24 / 44)} style={{ display: 'block' }}>
      {Object.keys(SEG_PTS).map((k) => {
        const lit = on.indexOf(k) !== -1;
        return (
          <polygon key={k} points={SEG_PTS[k]}
            fill={lit ? 'var(--rc-on)' : 'var(--rc-off)'}
            style={lit ? { filter: 'drop-shadow(0 0 2.5px var(--rc-glow))' } : undefined} />
        );
      })}
    </svg>
  );
}
function ClockDot() {
  return <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--rc-on)',
    filter: 'drop-shadow(0 0 3px var(--rc-glow))', display: 'block' }} />;
}
function ClockGroup({ value, digits, max, onChange, label, digitH }) {
  // wrap-around spinner (no carry between units)
  const bump = (d) => onChange((v) => ((v + d) % (max + 1) + (max + 1)) % (max + 1));
  const chevStyle = {
    width: '100%', height: 22, borderRadius: 6, fontSize: 12,
    border: '1px solid rgba(245,194,74,.16)', background: 'rgba(245,194,74,.06)',
    color: 'rgba(245,194,74,.8)',
  };
  const str = String(value).padStart(digits, '0');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
      minWidth: 46 }}>
      <HoldButton delta={1} onStep={bump} style={chevStyle} ariaLabel={`${label} +`}>▲</HoldButton>
      <div style={{ display: 'flex', gap: 3 }}>
        {str.split('').map((ch, i) => <SevenSeg key={i} value={+ch} h={digitH} />)}
      </div>
      <HoldButton delta={-1} onStep={bump} style={chevStyle} ariaLabel={`${label} −`}>▼</HoldButton>
      <span style={{ fontSize: 8.5, letterSpacing: '.12em', color: 'rgba(245,194,74,.45)',
        textTransform: 'uppercase' }}>{label}</span>
    </div>
  );
}
function RaceClock({ h, m, s, onH, onM, onS, subtitle, digitH = 50 }) {
  return (
    <div style={{
      '--rc-on': '#F5C24A', '--rc-off': 'rgba(245,194,74,.11)', '--rc-glow': 'rgba(245,194,74,.7)',
      background: '#12141d', border: '1px solid var(--rp-line)', borderRadius: 16,
      padding: '9px 10px 7px', boxShadow: 'inset 0 2px 12px rgba(0,0,0,.45)',
    }}>
      <div style={{ background: '#04050a', borderRadius: 12, padding: '10px 8px 7px',
        display: 'flex', direction: 'ltr', alignItems: 'flex-start', justifyContent: 'center', gap: 4,
        boxShadow: 'inset 0 0 22px rgba(0,0,0,.75)' }}>
        <ClockGroup value={h} digits={1} max={11} onChange={onH} label="שעות" digitH={digitH} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, alignItems: 'center',
          justifyContent: 'center', height: digitH, marginTop: 27 }}>
          <ClockDot /><ClockDot />
        </div>
        <ClockGroup value={m} digits={2} max={59} onChange={onM} label="דקות" digitH={digitH} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: digitH, marginTop: 27 }}>
          <ClockDot />
        </div>
        <ClockGroup value={s} digits={2} max={59} onChange={onS} label="שניות" digitH={digitH} />
      </div>
      {subtitle && (
        <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--rp-text-dim)',
          marginTop: 7, letterSpacing: '.03em', overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap' }}>{subtitle}</div>
      )}
    </div>
  );
}

// Shown after a GPX loads: turn the route into a matching pace plan (5 km blocks
// + remainder) from a goal time, a strategy and the route's gradient.
function GpxPlanDialog({ course, defaultGoalSec, onCancel, onBuild }) {
  const hasProfile = !!(course && course.profile && course.profile.length > 1);
  // h / m / s tap-steppers — no keyboard at all (a mobile numeric keypad has no
  // colon key, and typing seconds into a masked field is fiddly).
  const d0 = Math.max(0, Math.round(defaultGoalSec || 0));
  const [gh, setGh] = React.useState(() => Math.min(11, Math.floor(d0 / 3600)));
  const [gm, setGm] = React.useState(() => Math.floor((d0 % 3600) / 60));
  const [gs, setGs] = React.useState(() => d0 % 60);
  const [strategy, setStrategy] = React.useState('negative');
  const [splitPct, setSplitPct] = React.useState(3);
  const [gradeAdjust, setGradeAdjust] = React.useState(hasProfile);

  const goalSec = gh * 3600 + gm * 60 + gs;
  const goalOk = goalSec >= 600 && goalSec <= 12 * 3600;
  const opts = { goalSec, strategy, splitPct: strategy === 'even' ? 0 : splitPct, gradeAdjust };

  const preview = React.useMemo(
    () => (goalOk ? buildPlanSegments(course.profile || null, course.dist, opts) : []),
    [goalOk, goalSec, strategy, splitPct, gradeAdjust, course],
  );
  const paces = preview.map((s) => s.paceSec);
  const fastest = paces.length ? Math.min(...paces) : 0;
  const slowest = paces.length ? Math.max(...paces) : 0;

  const STRATS = [
    ['negative', 'פתיחה סולידית', 'איטי → מהיר'],
    ['even', 'יציב', 'קצב אחיד'],
    ['positive', 'פתיחה מהירה', 'מהיר → איטי'],
    ['staged', 'מדורג', 'שליש-שליש-שליש'],
  ];

  return ReactDOM.createPortal((
    <div className="rp-cq-scope" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(9,11,22,.78)',
        backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 18, direction: 'rtl', fontFamily: 'var(--rp-font-ui)', color: 'var(--rp-text)' }}>
      <div style={{ background: 'var(--rp-surface)', border: '1px solid var(--rp-line)',
        borderRadius: 'var(--rp-r-14)', width: '100%', maxWidth: 440, maxHeight: '90vh',
        overflowY: 'auto', boxShadow: 'var(--rp-shadow-modal)', padding: '18px 18px 16px' }}>

        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>בניית תוכנית מהמסלול</div>
        <div style={{ fontSize: 12, color: 'var(--rp-text-dim)', marginBottom: 14 }}>
          {(course.name || 'מסלול')} · {formatKm(course.dist)} ק"מ · קטעים של 5 ק"מ
        </div>

        <RaceClock
          h={gh} m={gm} s={gs} onH={setGh} onM={setGm} onS={setGs}
          subtitle={`${course.name || 'מסלול'} · זמן מטרה`} />
        <div style={{ fontSize: 12, marginTop: 8, textAlign: 'center',
          color: goalOk ? 'var(--rp-text)' : 'var(--rp-danger, #d9736a)', fontWeight: 700 }}>
          {goalOk
            ? `${formatClock(goalSec)}  ·  ${formatPace(goalSec / course.dist)} / ק"מ`
            : 'זמן מטרה קצר מדי'}
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--rp-text-dim)', margin: '14px 0 6px' }}>אסטרטגיה</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {STRATS.map(([v, label, sub]) => (
            <button key={v} onClick={() => setStrategy(v)} style={{
              textAlign: 'right', padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
              fontFamily: 'inherit',
              background: strategy === v ? 'var(--rp-gold-wash)' : 'var(--rp-surface-2)',
              border: `1px solid ${strategy === v ? 'var(--rp-gold-line)' : 'var(--rp-line)'}`,
              color: strategy === v ? 'var(--rp-gold)' : 'var(--rp-text)' }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{label}</div>
              <div style={{ fontSize: 10.5, color: 'var(--rp-text-dim)', marginTop: 1 }}>{sub}</div>
            </button>
          ))}
        </div>

        {strategy !== 'even' && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700,
              color: 'var(--rp-text-dim)' }}>
              <span>עוצמת הספליט</span><span style={{ color: 'var(--rp-gold)' }}>{splitPct}%</span>
            </div>
            <input type="range" min="0" max="8" step="0.5" value={splitPct}
              onChange={(e) => setSplitPct(+e.target.value)}
              style={{ width: '100%', marginTop: 6, accentColor: 'var(--rp-gold)' }} />
          </div>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14,
          fontSize: 13, cursor: hasProfile ? 'pointer' : 'not-allowed', opacity: hasProfile ? 1 : 0.5 }}>
          <input type="checkbox" checked={gradeAdjust && hasProfile} disabled={!hasProfile}
            onChange={(e) => setGradeAdjust(e.target.checked)} style={{ accentColor: 'var(--rp-gold)' }} />
          התאמה לשיפוע המסלול
          {!hasProfile && <span style={{ fontSize: 11, color: 'var(--rp-text-dim)' }}>· אין נתוני גובה בקובץ</span>}
        </label>

        {preview.length > 0 && (
          <div style={{ marginTop: 14, padding: '9px 11px', borderRadius: 8,
            background: 'var(--rp-surface-2)', border: '1px solid var(--rp-line)',
            fontSize: 12, color: 'var(--rp-text-dim)' }}>
            {preview.length} קטעים · קצב {formatPace(fastest)}–{formatPace(slowest)} / ק"מ · סה"כ {formatClock(goalSec)}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="rp-btn rp-btn-primary" disabled={!goalOk}
            onClick={() => onBuild(opts)} style={{ flex: 1, justifyContent: 'center' }}>
            בנה תוכנית
          </button>
          <button className="rp-btn" onClick={onCancel} style={{ flex: '0 0 auto' }}>דלג</button>
        </div>
      </div>
    </div>
  ), document.body);
}

// Branded sign-in screen (Firebase targets, when nobody is signed in).
function SignInScreen() {
  return (
    <div className="rp-cq" style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 22, padding: 28, textAlign: 'center',
      background: 'var(--rp-bg)', color: 'var(--rp-text)', fontFamily: 'var(--rp-font-ui)', direction: 'rtl',
    }}>
      <img src={(typeof window !== 'undefined' && window.__RACEPLAN_LOGO__) || 'LogoV2.png'}
        alt="RACE PLAN" style={{ width: 128, height: 128, borderRadius: 24 }} />
      <div style={{ fontFamily: 'var(--rp-font-display)', fontSize: 24, fontWeight: 800 }}>
        RacePlan — מתכנן קצב לריצה
      </div>
      <div style={{ color: 'var(--rp-text-dim)', fontSize: 14, maxWidth: 300 }}>
        התחברו כדי לתכנן את המרוץ שלכם. הנתונים נשמרים בחשבון שלכם.
      </div>
      <button className="rp-btn rp-btn-primary" style={{ minHeight: 48, fontSize: 16, padding: '12px 26px' }}
        onClick={() => RP_FB && RP_FB.signIn()}>
        התחברות עם Google
      </button>
    </div>
  );
}

// Auth gate wrapper — hooks here stay stable; PlannerBApp mounts only once a
// user exists (or there's no Firebase at all).
function PlannerB() {
  const [fbUser, setFbUser] = React.useState(() => (RP_FB ? RP_FB.user : undefined));
  React.useEffect(() => (RP_FB ? RP_FB.onAuth((u) => setFbUser(u)) : undefined), []);
  if (RP_FB && !fbUser) return <SignInScreen />;
  return <PlannerBApp isOwner={RP_FB ? (!!fbUser && fbUser.tier === 'owner') : RP_IS_OWNER} />;
}

function PlannerBApp({ isOwner }) {
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
  // a sandboxed iframe, so guard it). Also log this visit once.
  React.useEffect(() => {
    try {
      if (shareData && location.hash.startsWith('#s=')) {
        history.replaceState(null, '', location.pathname + location.search);
      }
    } catch (e) { /* sandboxed iframe — ignore */ }
    logUsage();
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
  // Peaks/valleys of the loaded route — snap targets for dragging boundaries.
  const courseExtrema = React.useMemo(
    () => (p.course?.profile ? window.findExtrema(p.course.profile) : null),
    [p.course],
  );
  // Only let boundaries be dragged when the plan actually spans the route.
  const canEditBoundaries = !!p.course?.profile && p.segments.length > 1
    && Math.abs(plan.totalDist - (p.course.dist || 0)) < Math.max(0.5, plan.totalDist * 0.05);
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
  const [showMyPlans, setShowMyPlans] = React.useState(false);
  const [showNewPlanConfirm, setShowNewPlanConfirm] = React.useState(false);
  const [showRouteLib, setShowRouteLib] = React.useState(false);
  const [routeLibInit, setRouteLibInit] = React.useState(null);
  const [lastRoute, setLastRoute] = React.useState(null);
  const [pendingSubs, setPendingSubs] = React.useState(0); // owner: community routes awaiting review

  const refreshPendingSubs = React.useCallback(() => {
    if (!isOwner || !RP_FB || !RP_FB.submissionsList) return;
    RP_FB.submissionsList('pending')
      .then((l) => setPendingSubs((l || []).length))
      .catch(() => {});
  }, [isOwner]);
  React.useEffect(() => { refreshPendingSubs(); }, [refreshPendingSubs]);
  const [gpxDialog, setGpxDialog] = React.useState(null);
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
      const RR = typeof window !== 'undefined' && window.RP_ROUTES;
      const built = RR && RR.buildFromGpx(parsed, text, parsed.name || raceName, file.name);
      let course;
      if (built) {
        // keep the raw GPX + flat payload around so an owner can push it to the
        // shared library via GpxBanner's "שמור בספרייה".
        setLastRoute({ ...built, sourceUrl: null });
        course = built.course;
      } else {
        const hasEle = parsed.points.some((pt) => isFinite(pt.ele));
        setLastRoute(null);
        course = {
          name: parsed.name, dist: parsed.totalDist, gain: parsed.elevGain, loss: parsed.elevLoss, source: file.name,
          profile: hasEle ? downsample(parsed.points.map((pt) => ({ d: pt.cum / 1000, ele: pt.ele })), 320) : null,
          track: downsample(parsed.points.map((pt) => [pt.lat, pt.lon]), 500),
          lat: parsed.startLat,
          lon: parsed.startLon,
        };
      }
      p.loadCourse(course);
      // Offer to rebuild the segments so the plan matches the route.
      setGpxDialog({
        course,
        goalSec: Math.round((plan.avgPace || 300) * (course.dist || 1)),
      });
    } catch (err) {
      alert('לא ניתן לקרוא את קובץ ה-GPX:\n' + (err && err.message ? err.message : err));
    }
    e.target.value = '';
  };

  // Load a route (from the library / a pasted link) and offer the same
  // "build a matching plan" dialog the GPX-file import shows.
  const loadCourseWithPlan = (course) => {
    p.loadCourse(course);
    setGpxDialog({
      course,
      goalSec: Math.round((plan.avgPace || 300) * (course.dist || 1)),
    });
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

  // "New plan": optionally snapshot the current one into "my plans" first,
  // then clear back to defaults.
  const startNewPlan = (saveFirst) => {
    if (saveFirst && MyPlansDB) {
      MyPlansDB.save({
        raceName, raceDate, raceTime, trainer,
        segments: p.segments, preset: p.activePreset, course: p.course,
      });
    }
    setShowNewPlanConfirm(false);
    p.reset();
    setRaceName('מרוץ העיר');
    setRaceDate('');
    setRaceTime('07:00');
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

  // Load one of the user's own saved plans ("my plans")
  const handleLoadMyPlan = (plan) => {
    setRaceName(plan.raceName || '');
    if (plan.trainer) setTrainer(plan.trainer);
    if (plan.raceDate != null) setRaceDate(plan.raceDate);
    if (plan.raceTime != null) setRaceTime(plan.raceTime);
    p.restorePlan({ s: plan.segments, p: plan.preset });
    if (plan.course) { p.loadCourse(plan.course); } else { p.clearCourse(); }
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
          .rp-planner-wrap { padding: 12px 10px 20px !important; }
          /* segment/total padding for phones is set in core.jsx (compact row) */
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

          {/* RIGHT: logo (in RTL first flex child = right side). The RACE PLAN
              badge is a full square mark with its own dark ground, so show it
              whole (contain) in a rounded square — no circular crop. */}
          <div style={{ width: 66, height: 66, flex: '0 0 auto', borderRadius: 'var(--rp-r-12)',
            overflow: 'hidden' }}>
            <img
              src={(typeof window !== 'undefined' && window.__RACEPLAN_LOGO__) || 'LogoV2.png'}
              alt="RACE PLAN"
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            />
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
              {isOwner && (
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
              )}
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

        {p.course && (
          <GpxBanner
            course={p.course}
            ownerMode={isOwner}
            onClear={() => { p.clearCourse(); setLastRoute(null); }}
            onSaveToLibrary={RP_FB && lastRoute
              ? () => { setRouteLibInit(lastRoute); setShowRouteLib(true); }
              : null}
          />
        )}

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
            {RouteLibrary && RP_FB && (
              <button className="rp-btn" style={{ position: 'relative' }}
                onClick={() => { setRouteLibInit(null); setShowRouteLib(true); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3Z" /><path d="M9 3v15M15 6v15" /></svg>
                ספריית מסלולים
                {isOwner && pendingSubs > 0 && (
                  <span aria-label={`${pendingSubs} הצעות ממתינות`} style={{
                    position: 'absolute', top: -6, insetInlineStart: -6,
                    minWidth: 16, height: 16, padding: '0 4px', borderRadius: 999,
                    background: 'var(--rp-gold)', color: '#12172b', fontSize: 10, fontWeight: 800,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                  }}>{pendingSubs}</span>
                )}
              </button>
            )}
            {MyPlansPanel && RP_FB && !isOwner && (
              <button className="rp-btn" onClick={() => setShowMyPlans(true)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
                התכנונים שלי
              </button>
            )}
            <button className="rp-btn" onClick={onShare}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
              שיתוף
            </button>
            <button className="rp-btn" onClick={() => window.print()}>הדפסה</button>
            {MyPlansDB && RP_FB && !isOwner && (
              <button className="rp-btn" onClick={() => setShowNewPlanConfirm(true)}>תכנון חדש</button>
            )}
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
              {canEditBoundaries && showElevation && (
                <span style={{ fontWeight: 500, color: 'var(--rp-text-dim)', fontSize: 11.5 }}>
                  {'  ·  גררו את הקווים להתאמת מקטע לעלייה/ירידה'}
                </span>
              )}
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
            variant="area" colors={themeB} height={canEditBoundaries ? 210 : 185}
            elevationProfile={p.course?.profile ?? null}
            showElevation={showElevation}
            interactive={canEditBoundaries}
            segments={p.segments}
            extrema={courseExtrema}
            onSegmentsChange={p.replaceSegments} />
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

      {isOwner && showAthletePanel && (
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

      {MyPlansPanel && RP_FB && showMyPlans && (
        <MyPlansPanel
          onClose={() => setShowMyPlans(false)}
          currentRaceName={raceName}
          currentRaceDate={raceDate}
          currentRaceTime={raceTime}
          currentTrainer={trainer}
          currentSegments={p.segments}
          currentPreset={p.activePreset}
          currentCourse={p.course}
          onLoadPlan={handleLoadMyPlan}
        />
      )}

      {showNewPlanConfirm && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1001, background: 'rgba(0,0,0,.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', direction: 'rtl',
        }} onClick={(e) => { if (e.target === e.currentTarget) setShowNewPlanConfirm(false); }}>
          <div style={{
            background: 'var(--rp-surface)', border: '1px solid var(--rp-line-input)',
            borderRadius: 16, padding: '26px 30px', maxWidth: 360, textAlign: 'center',
            boxShadow: '0 16px 48px rgba(0,0,0,.7)', fontFamily: 'var(--rp-font-ui)',
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--rp-text)', marginBottom: 10 }}>
              להתחיל תכנון חדש?
            </div>
            <div style={{ fontSize: 13, color: 'var(--rp-text-dim)', marginBottom: 22 }}>
              אפשר לשמור את התכנון הנוכחי ל"התכנונים שלי" לפני שמתחילים.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="rp-btn rp-btn-primary" onClick={() => startNewPlan(true)}>
                שמור והתחל
              </button>
              <button className="rp-btn" onClick={() => startNewPlan(false)}>
                התחל בלי לשמור
              </button>
              <button className="rp-btn" onClick={() => setShowNewPlanConfirm(false)}>
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}

      {RouteLibrary && RP_FB && showRouteLib && (
        <RouteLibrary
          onClose={() => { setShowRouteLib(false); setRouteLibInit(null); refreshPendingSubs(); }}
          onLoadCourse={loadCourseWithPlan}
          raceName={raceName}
          onRaceName={setRaceName}
          isOwner={isOwner}
          initialPending={routeLibInit}
        />
      )}

      {gpxDialog && (
        <GpxPlanDialog
          course={gpxDialog.course}
          defaultGoalSec={gpxDialog.goalSec}
          onCancel={() => setGpxDialog(null)}
          onBuild={(opts) => {
            const segs = buildPlanSegments(gpxDialog.course.profile || null, gpxDialog.course.dist, opts);
            if (segs.length) p.loadGpx(segs, gpxDialog.course);
            setGpxDialog(null);
          }}
        />
      )}

      <CopyToast show={copied} />
    </div>
  );
}

window.PlannerB = PlannerB;
