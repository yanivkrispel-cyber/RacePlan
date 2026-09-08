// planner-b.jsx — standalone "ליל" planner (version B), full-viewport &
// responsive, with GPX course import. No canvas, no separate mobile frame.
const { useRacePlan, formatPace, formatClock, parseClock, formatKm, PaceChart,
        LogoSlot, ZoneLegend, SegmentsTable, PRESETS, generatePlan,
        parseGpx, ElevationChart, RouteMap, round2, clearSavedPlan,
        AthleteDB, AthletePanel, MyPlansDB, MyPlansPanel, RouteLibrary, RaceAdminPanel,
        PrintableSummary, ActionSheet, RP_EXPORT, ValueEditor,
        computeSegmentElevations, buildPlanSegments } = window;
const I18N = window.I18N;
const t = (I18N && I18N.t) || ((k) => k);
const U = window.UNITS;
const presetName = window.presetName || ((p) => String(p.km));

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
  const keys = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
  return t('weather.dir.' + keys[Math.round(deg / 45) % 8]);
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
        <span style={{ fontSize: 18 }}>🌍</span> {t('weather.loading')}
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
          <div style={{ fontSize: 11, color: 'var(--rp-text-dim)', marginTop: 3 }}>{t('weather.feelsLike', { temp: weather.feelsLike })}</div>
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
            {U ? Math.round(U.dispSpeed(weather.windSpeed)) : weather.windSpeed} <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--rp-text-dim)' }}>{U ? U.speedUnit() : t('units.kmh')}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--rp-text-dim)', marginTop: 3 }}>{t('weather.wind', { dir: _windDirLabel(weather.windDir) })}</div>
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
          <div style={{ fontSize: 11, color: 'var(--rp-text-dim)', marginTop: 3 }}>{t('weather.rainChance')}</div>
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
          {course.name || t('gpxBanner.importedRoute')} <span style={{ fontWeight: 500, color: 'var(--rp-gold)' }}>{t('gpxBanner.fromGpx')}</span>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--rp-text-dim)', marginTop: 2 }}>
          {U ? U.fmtDist(course.dist) : formatKm(course.dist)} · {t('gpxBanner.gain')} {U ? U.fmtElev(course.gain) : course.gain} · {t('gpxBanner.loss')} {U ? U.fmtElev(course.loss) : course.loss}
          {course.source ? ` · ${window.RP_ROUTES ? window.RP_ROUTES.sourceLabel(course.source) : course.source}` : ''}
        </div>
      </div>
      {onSaveToLibrary && (
        <button className="rp-btn" onClick={onSaveToLibrary} style={{ flex: '0 0 auto', padding: '7px 12px', fontSize: 13 }}>
          {ownerMode ? t('gpxBanner.saveToLibrary') : t('gpxBanner.proposeToLibrary')}
        </button>
      )}
      <button className="rp-btn" onClick={onClear} style={{ flex: '0 0 auto', padding: '7px 12px', fontSize: 13 }}>{t('gpxBanner.removeRoute')}</button>
    </div>
  );
}

// Toast — navy surface, cream text, bottom-center, per DESIGN_TOKENS §States.
// Portaled to <body> so it pins to the viewport, not the CSS-container root.
function CopyToast({ show, text }) {
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
      {text || t('planner.linkCopied')}
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
    <button type="button" aria-label={ariaLabel || (delta < 0 ? t('common.decrease') : t('common.add'))}
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
        <ClockGroup value={h} digits={1} max={11} onChange={onH} label={t('clock.hours')} digitH={digitH} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, alignItems: 'center',
          justifyContent: 'center', height: digitH, marginTop: 27 }}>
          <ClockDot /><ClockDot />
        </div>
        <ClockGroup value={m} digits={2} max={59} onChange={onM} label={t('clock.minutes')} digitH={digitH} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, alignItems: 'center',
          justifyContent: 'center', height: digitH, marginTop: 27 }}>
          <ClockDot /><ClockDot />
        </div>
        <ClockGroup value={s} digits={2} max={59} onChange={onS} label={t('clock.seconds')} digitH={digitH} />
      </div>
      {subtitle && (
        <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--rp-text-dim)',
          marginTop: 7, letterSpacing: '.03em', overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap' }}>{subtitle}</div>
      )}
    </div>
  );
}

// Read-only seven-segment display of a total time (H:MM·SS), for the race
// card hero. Same housing/glow as RaceClock, no ▲▼ steppers.
function ClockDisplay({ totalSec, digitH = 38, onClick, caption }) {
  const t = Math.max(0, Math.round(totalSec || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const seg = (v, k) => <SevenSeg key={k} value={v} h={digitH} />;
  const well = (
    <div style={{ background: '#04050a', borderRadius: 12, padding: '9px 10px 7px',
      display: 'flex', direction: 'ltr', alignItems: 'center', justifyContent: 'center', gap: 4,
      boxShadow: 'inset 0 0 22px rgba(0,0,0,.75)' }}>
      {String(h).split('').map((c, i) => seg(+c, 'h' + i))}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '0 3px' }}>
        <ClockDot /><ClockDot />
      </div>
      {seg(Math.floor(m / 10), 'm0')}{seg(m % 10, 'm1')}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '0 3px' }}>
        <ClockDot /><ClockDot />
      </div>
      {seg(Math.floor(s / 10), 's0')}{seg(s % 10, 's1')}
    </div>
  );
  const root = {
    '--rc-on': '#F5C24A', '--rc-off': 'rgba(245,194,74,.11)', '--rc-glow': 'rgba(245,194,74,.7)',
    background: '#12141d', border: '1px solid var(--rp-line)', borderRadius: 16,
    padding: '10px 12px 9px', boxShadow: 'inset 0 2px 12px rgba(0,0,0,.45)',
    width: '100%', display: 'block', fontFamily: 'inherit',
  };
  const body = (
    <>
      {well}
      {caption && (
        <div style={{ textAlign: 'center', fontSize: 9.5, fontWeight: 700, letterSpacing: '.14em',
          color: 'var(--rp-text-dim)', textTransform: 'uppercase', marginTop: 8 }}>{caption}</div>
      )}
    </>
  );
  return onClick
    ? <button type="button" onClick={onClick} style={{ ...root, cursor: 'pointer' }}>{body}</button>
    : <div style={root}>{body}</div>;
}

// Proportionally rescale every segment's pace so Σ(pace·dist) hits goalSec —
// keeps the relative strategy shape and any manual per-segment edits.
function scalePlanToGoal(segments, goalSec) {
  const cur = (segments || []).reduce((a, s) => a + s.distance * s.paceSec, 0);
  if (!(cur > 0) || !(goalSec > 0)) return segments;
  const f = goalSec / cur;
  return segments.map((s) => ({
    ...s, paceSec: Math.max(120, Math.min(900, Math.round(s.paceSec * f))),
  }));
}

// Tapping the race-card hero opens this: dial a goal time, apply = rescale.
function GoalSheet({ currentSec, dist, onClose, onApply }) {
  const d0 = Math.max(0, Math.round(currentSec || 0));
  const [gh, setGh] = React.useState(Math.min(11, Math.floor(d0 / 3600)));
  const [gm, setGm] = React.useState(Math.floor((d0 % 3600) / 60));
  const [gs, setGs] = React.useState(d0 % 60);
  const goalSec = gh * 3600 + gm * 60 + gs;
  const ok = goalSec >= 600 && goalSec <= 12 * 3600;
  return ReactDOM.createPortal((
    <div className="rp-cq-scope" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(9,11,22,.80)',
        backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 18, direction: I18N.dir, fontFamily: 'var(--rp-font-ui)', color: 'var(--rp-text)' }}>
      <div style={{ background: 'var(--rp-surface)', border: '1px solid var(--rp-line)',
        borderRadius: 'var(--rp-r-14)', width: '100%', maxWidth: 400,
        boxShadow: 'var(--rp-shadow-modal)', padding: 18 }}>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>{t('setup.goalTime')}</div>
        <RaceClock h={gh} m={gm} s={gs} onH={setGh} onM={setGm} onS={setGs}
          subtitle={t('planner.goalScaleAll')} />
        <div style={{ fontSize: 12, marginTop: 8, textAlign: 'center', fontWeight: 700,
          color: ok ? 'var(--rp-text)' : 'var(--rp-danger, #d9736a)' }}>
          {ok ? `${formatClock(goalSec)} · ${U ? U.fmtPace(goalSec / (dist || 1)) + ' ' + U.paceUnit() : formatPace(goalSec / (dist || 1))}` : t('planner.goalTooShort')}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="rp-btn rp-btn-primary" disabled={!ok} style={{ flex: 1, justifyContent: 'center' }}
            onClick={() => onApply(goalSec)}>{t('planner.updatePaces')}</button>
          <button className="rp-btn" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  ), document.body);
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
    ['negative', 'strategy.negative', 'strategy.negativeSub'],
    ['even', 'strategy.even', 'strategy.evenSub'],
    ['positive', 'strategy.positive', 'strategy.positiveSub'],
    ['staged', 'strategy.staged', 'strategy.stagedSub'],
  ];

  return ReactDOM.createPortal((
    <div className="rp-cq-scope" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(9,11,22,.78)',
        backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 18, direction: I18N.dir, fontFamily: 'var(--rp-font-ui)', color: 'var(--rp-text)' }}>
      <div style={{ background: 'var(--rp-surface)', border: '1px solid var(--rp-line)',
        borderRadius: 'var(--rp-r-14)', width: '100%', maxWidth: 440, maxHeight: '90vh',
        overflowY: 'auto', boxShadow: 'var(--rp-shadow-modal)', padding: '18px 18px 16px' }}>

        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>{t('setup.fromRouteTitle')}</div>
        <div style={{ fontSize: 12, color: 'var(--rp-text-dim)', marginBottom: 14 }}>
          {(course.name || t('routes.route'))} · {U ? U.fmtDist(course.dist) : formatKm(course.dist)} · {t('planner.blocks5k')}
        </div>

        <RaceClock
          h={gh} m={gm} s={gs} onH={setGh} onM={setGm} onS={setGs}
          subtitle={t('setup.goalSubtitle', { name: course.name || t('routes.route') })} />
        <div style={{ fontSize: 12, marginTop: 8, textAlign: 'center',
          color: goalOk ? 'var(--rp-text)' : 'var(--rp-danger, #d9736a)', fontWeight: 700 }}>
          {goalOk
            ? `${formatClock(goalSec)}  ·  ${U ? U.fmtPace(goalSec / course.dist) + ' ' + U.paceUnit() : formatPace(goalSec / course.dist)}`
            : t('setup.goalShort')}
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--rp-text-dim)', margin: '14px 0 6px' }}>{t('setup.strategy')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {STRATS.map(([v, label, sub]) => (
            <button key={v} onClick={() => setStrategy(v)} style={{
              textAlign: 'start', padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
              fontFamily: 'inherit',
              background: strategy === v ? 'var(--rp-gold-wash)' : 'var(--rp-surface-2)',
              border: `1px solid ${strategy === v ? 'var(--rp-gold-line)' : 'var(--rp-line)'}`,
              color: strategy === v ? 'var(--rp-gold)' : 'var(--rp-text)' }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{t(label)}</div>
              <div style={{ fontSize: 10.5, color: 'var(--rp-text-dim)', marginTop: 1 }}>{t(sub)}</div>
            </button>
          ))}
        </div>

        {strategy !== 'even' && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700,
              color: 'var(--rp-text-dim)' }}>
              <span>{t('setup.splitStrength')}</span><span style={{ color: 'var(--rp-gold)' }}>{splitPct}%</span>
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
          {t('setup.gradeAdjust')}
          {!hasProfile && <span style={{ fontSize: 11, color: 'var(--rp-text-dim)' }}>· {t('setup.noElevationFile')}</span>}
        </label>

        {preview.length > 0 && (
          <div style={{ marginTop: 14, padding: '9px 11px', borderRadius: 8,
            background: 'var(--rp-surface-2)', border: '1px solid var(--rp-line)',
            fontSize: 12, color: 'var(--rp-text-dim)' }}>
            {t('setup.previewLine', { count: preview.length, fast: (U ? U.fmtPace(fastest) : formatPace(fastest)), slow: (U ? U.fmtPace(slowest) : formatPace(slowest)), per: (U ? U.paceUnit() : t('units.perKm')), total: formatClock(goalSec) })}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="rp-btn rp-btn-primary" disabled={!goalOk}
            onClick={() => onBuild(opts)} style={{ flex: 1, justifyContent: 'center' }}>
            {t('setup.build')}
          </button>
          <button className="rp-btn" onClick={onCancel} style={{ flex: '0 0 auto' }}>{t('setup.skip')}</button>
        </div>
      </div>
    </div>
  ), document.body);
}

// ── RaceSetupSheet ───────────────────────────────────────────────────────
// One scrollable sheet: pick a distance (or a route / GPX), dial a goal time
// on the RaceClock, choose a strategy — then build the matching plan. This is
// GpxPlanDialog's controls with a distance/route picker in front, reachable
// straight from the Hub (no GPX import required first).
function RaceSetupSheet({ onClose, onBuild, defaultName }) {
  const [course, setCourse] = React.useState(null); // {name,dist,profile?,track?,...}
  const [customKm, setCustomKm] = React.useState('');
  const [routeOpen, setRouteOpen] = React.useState(false);
  const fileRef = React.useRef(null);

  const [gh, setGh] = React.useState(0);
  const [gm, setGm] = React.useState(0);
  const [gs, setGs] = React.useState(0);
  const [strategy, setStrategy] = React.useState('negative');
  const [splitPct, setSplitPct] = React.useState(3);
  const [gradeAdjust, setGradeAdjust] = React.useState(false);
  const [err, setErr] = React.useState('');

  const hasProfile = !!(course && course.profile && course.profile.length > 1);

  // when a course is chosen, seed a sensible goal (~5:30/km) unless already set
  const applyCourse = (c) => {
    setCourse(c);
    setErr('');
    const g = Math.round((c.dist || 10) * 330);
    setGh(Math.min(11, Math.floor(g / 3600)));
    setGm(Math.floor((g % 3600) / 60));
    setGs(g % 60);
    setGradeAdjust(!!(c.profile && c.profile.length > 1));
  };

  const pickPreset = (km, name) => applyCourse({ name, dist: km, profile: null });
  const pickCustom = () => {
    const raw = parseFloat(customKm);
    const km = U ? Math.round(U.parseDist(raw) * 100) / 100 : Math.round(raw * 100) / 100;
    if (!(km > 0) || km > 300) { setErr(t('setup.badDistance')); return; }
    applyCourse({ name: (U ? U.fmtDist(km) : km + ' km'), dist: km, profile: null });
  };

  const onGpxFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseGpx(text);
      const RR = typeof window !== 'undefined' && window.RP_ROUTES;
      const built = RR && RR.buildFromGpx(parsed, text, parsed.name || defaultName, file.name);
      applyCourse(built ? built.course : {
        name: parsed.name || file.name, dist: parsed.totalDist,
        gain: parsed.elevGain, loss: parsed.elevLoss, profile: null,
      });
    } catch (er) {
      setErr(t('setup.cannotReadGpx'));
    }
  };

  const goalSec = gh * 3600 + gm * 60 + gs;
  const goalOk = goalSec >= 600 && goalSec <= 12 * 3600;
  const opts = { goalSec, strategy, splitPct: strategy === 'even' ? 0 : splitPct, gradeAdjust };

  const preview = React.useMemo(
    () => (course && goalOk ? buildPlanSegments(course.profile || null, course.dist, opts) : []),
    [course, goalOk, goalSec, strategy, splitPct, gradeAdjust],
  );
  const paces = preview.map((s) => s.paceSec);
  const fastest = paces.length ? Math.min(...paces) : 0;
  const slowest = paces.length ? Math.max(...paces) : 0;

  const STRATS = [
    ['negative', 'strategy.negative', 'strategy.negativeSub'],
    ['even', 'strategy.even', 'strategy.evenSub'],
    ['positive', 'strategy.positive', 'strategy.positiveSub'],
    ['staged', 'strategy.staged', 'strategy.stagedSub'],
  ];

  // Only a real route (with a profile or track) becomes the planner's "course";
  // a plain distance pick is just a number.
  const realCourse = (c) => (c && (c.profile || c.track) ? c : null);

  const build = () => {
    if (!course || !goalOk) return;
    const segs = buildPlanSegments(course.profile || null, course.dist, opts);
    if (!segs.length) { setErr(t('setup.cannotBuild')); return; }
    onBuild({ segments: segs, course: realCourse(course), raceName: course.name || defaultName, goalSec });
  };
  const startEmpty = () => {
    const km = course ? course.dist : 10;
    onBuild({
      segments: generatePlan(km), course: realCourse(course),
      raceName: course ? course.name : null,
    });
  };

  const chip = (active, label, onClick, key) => (
    <button key={key} onClick={onClick} style={{
      padding: '8px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer',
      fontFamily: 'inherit',
      background: active ? 'var(--rp-gold-wash)' : 'var(--rp-surface-2)',
      color: active ? 'var(--rp-gold)' : 'var(--rp-text)',
      border: `1px solid ${active ? 'var(--rp-gold-line)' : 'var(--rp-line)'}`,
    }}>{label}</button>
  );

  return ReactDOM.createPortal((
    <div className="rp-cq-scope" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(9,11,22,.80)',
        backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, direction: I18N.dir, fontFamily: 'var(--rp-font-ui)', color: 'var(--rp-text)' }}>
      <div style={{ background: 'var(--rp-surface)', border: '1px solid var(--rp-line)',
        borderRadius: 'var(--rp-r-14)', width: '100%', maxWidth: 440, maxHeight: '92vh',
        overflowY: 'auto', boxShadow: 'var(--rp-shadow-modal)', padding: '18px 18px 16px' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{t('setup.title')}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--rp-text-dim)', fontSize: 20, lineHeight: 1, padding: '2px 6px' }}>✕</button>
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--rp-text-dim)', marginBottom: 7 }}>{t('setup.distance')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(PRESETS || []).map((pr) => chip(
            !!course && Math.abs((course.dist || 0) - pr.km) < 0.05 && !course.profile,
            (window.presetLabel ? window.presetLabel(pr) : pr.km), () => pickPreset(pr.km, presetName(pr)), pr.km))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
          <input value={customKm} onChange={(e) => setCustomKm(e.target.value)}
            inputMode="decimal" placeholder={U && U.imperial ? t('setup.customMi') : t('setup.customKm')}
            style={{ flex: 1, background: 'var(--rp-surface-2)', border: '1px solid var(--rp-line-input)',
              borderRadius: 8, padding: '8px 10px', fontSize: 13, color: 'var(--rp-text)',
              fontFamily: 'inherit', outline: 'none' }} />
          <button onClick={pickCustom} className="rp-btn" style={{ flex: '0 0 auto' }}>{t('common.add')}</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '12px 0 4px' }}>
          <div style={{ flex: 1, height: 1, background: 'var(--rp-line)' }} />
          <span style={{ fontSize: 11, color: 'var(--rp-text-dim)' }}>{t('setup.fromRoute')}</span>
          <div style={{ flex: 1, height: 1, background: 'var(--rp-line)' }} />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {RouteLibrary && (
            <button className="rp-btn" style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => setRouteOpen(true)}>{t('setup.routeLibrary')}</button>
          )}
          <button className="rp-btn" style={{ flex: 1, justifyContent: 'center' }}
            onClick={() => fileRef.current && fileRef.current.click()}>{t('setup.importGpx')}</button>
          <input ref={fileRef} type="file" accept=".gpx,application/gpx+xml,text/xml"
            onChange={onGpxFile} style={{ display: 'none' }} />
        </div>

        {course && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--rp-gold)',
            background: 'var(--rp-gold-wash)', border: '1px solid var(--rp-gold-line)',
            borderRadius: 8, padding: '8px 10px' }}>
            {course.name} · {U ? U.fmtDist(course.dist) : formatKm(course.dist)}{course.profile ? ' · ' + t('setup.hasProfile') : ''}
          </div>
        )}

        {course && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--rp-text-dim)', margin: '14px 0 6px' }}>{t('setup.goalTime')}</div>
            <RaceClock h={gh} m={gm} s={gs} onH={setGh} onM={setGm} onS={setGs}
              subtitle={t('setup.goalSubtitle', { name: course.name })} />
            <div style={{ fontSize: 12, marginTop: 8, textAlign: 'center', fontWeight: 700,
              color: goalOk ? 'var(--rp-text)' : 'var(--rp-danger, #d9736a)' }}>
              {goalOk ? `${formatClock(goalSec)}  ·  ${U ? U.fmtPace(goalSec / course.dist) + ' ' + U.paceUnit() : formatPace(goalSec / course.dist)}`
                : t('setup.goalShort')}
            </div>

            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--rp-text-dim)', margin: '14px 0 6px' }}>{t('setup.strategy')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {STRATS.map(([v, label, sub]) => (
                <button key={v} onClick={() => setStrategy(v)} style={{
                  textAlign: 'start', padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                  fontFamily: 'inherit',
                  background: strategy === v ? 'var(--rp-gold-wash)' : 'var(--rp-surface-2)',
                  border: `1px solid ${strategy === v ? 'var(--rp-gold-line)' : 'var(--rp-line)'}`,
                  color: strategy === v ? 'var(--rp-gold)' : 'var(--rp-text)' }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{t(label)}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--rp-text-dim)', marginTop: 1 }}>{t(sub)}</div>
                </button>
              ))}
            </div>

            {strategy !== 'even' && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700,
                  color: 'var(--rp-text-dim)' }}>
                  <span>{t('setup.splitStrength')}</span><span style={{ color: 'var(--rp-gold)' }}>{splitPct}%</span>
                </div>
                <input type="range" min="0" max="8" step="0.5" value={splitPct}
                  onChange={(e) => setSplitPct(+e.target.value)}
                  style={{ width: '100%', marginTop: 6, accentColor: 'var(--rp-gold)' }} />
              </div>
            )}

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 13,
              cursor: hasProfile ? 'pointer' : 'not-allowed', opacity: hasProfile ? 1 : 0.5 }}>
              <input type="checkbox" checked={gradeAdjust && hasProfile} disabled={!hasProfile}
                onChange={(e) => setGradeAdjust(e.target.checked)} style={{ accentColor: 'var(--rp-gold)' }} />
              {t('setup.gradeAdjust')}
              {!hasProfile && <span style={{ fontSize: 11, color: 'var(--rp-text-dim)' }}>· {t('setup.noElevation')}</span>}
            </label>

            {preview.length > 0 && (
              <div style={{ marginTop: 14, padding: '9px 11px', borderRadius: 8,
                background: 'var(--rp-surface-2)', border: '1px solid var(--rp-line)',
                fontSize: 12, color: 'var(--rp-text-dim)' }}>
                {t('setup.previewLine', { count: preview.length, fast: (U ? U.fmtPace(fastest) : formatPace(fastest)), slow: (U ? U.fmtPace(slowest) : formatPace(slowest)), per: (U ? U.paceUnit() : t('units.perKm')), total: formatClock(goalSec) })}
              </div>
            )}
          </>
        )}

        {err && (
          <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--rp-danger, #d9736a)',
            border: '1px solid var(--rp-danger, #d9736a)', borderRadius: 8, padding: '8px 10px' }}>{err}</div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="rp-btn rp-btn-primary" disabled={!course || !goalOk}
            onClick={build} style={{ flex: 1, justifyContent: 'center' }}>{t('setup.build')}</button>
          <button className="rp-btn" onClick={startEmpty} style={{ flex: '0 0 auto' }}>
            {course ? t('setup.startEmpty') : t('setup.skip')}
          </button>
        </div>
      </div>

      {RouteLibrary && routeOpen && (
        <RouteLibrary
          zIndex={1200}
          onClose={() => setRouteOpen(false)}
          onLoadCourse={(c) => { applyCourse(c); setRouteOpen(false); }}
          raceName={defaultName}
          isOwner={false}
        />
      )}
    </div>
  ), document.body);
}

// ── HubScreen ────────────────────────────────────────────────────────────
// Post-sign-in home: plan a new race, resume the current one, or open a saved
// plan. onEnter(handoff) drops the user into the planner.
function HubScreen({ isOwner, userName, onEnter }) {
  const [setupOpen, setSetupOpen] = React.useState(false);
  const [savedOpen, setSavedOpen] = React.useState(false);
  const [raceAdminOpen, setRaceAdminOpen] = React.useState(false);
  const [athleteName, setAthleteName] = React.useState(null); // planning for a specific athlete

  const resume = React.useMemo(() => {
    try {
      const raw = localStorage.getItem('rp-plan-v1');
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (!Array.isArray(d.s) || !d.s.length) return null;
      let dist = 0; let sec = 0;
      for (const [km, pace] of d.s) { dist += +km || 0; sec += (+km || 0) * (+pace || 0); }
      return { raceName: localStorage.getItem('rp-race') || t('hub.resumeDefault'), dist, sec };
    } catch (e) { return null; }
  }, []);

  const loadSaved = (plan, aName) => {
    setSavedOpen(false);
    onEnter({
      segments: (plan.segments || []).map(([d, p], i) => ({ id: 'ld' + i, distance: d, paceSec: p })),
      preset: plan.preset ?? null,
      course: plan.course || null,
      raceName: plan.raceName || null,
      trainer: aName || null,
    });
  };

  const Card = ({ onClick, primary, icon, title, sub }) => (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'start',
      padding: '16px 18px', borderRadius: 16, cursor: 'pointer', fontFamily: 'inherit',
      background: primary
        ? 'linear-gradient(180deg,var(--rp-surface-2),var(--rp-surface))' : 'var(--rp-surface)',
      border: `1px solid ${primary ? 'var(--rp-gold-line)' : 'var(--rp-line)'}`,
      boxShadow: primary ? 'var(--rp-shadow)' : 'none',
    }}>
      <span style={{ flex: '0 0 auto', width: 40, height: 40, borderRadius: 12,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: primary ? 'var(--rp-gold)' : 'var(--rp-gold-wash)',
        color: primary ? 'var(--rp-on-gold)' : 'var(--rp-gold)',
        border: primary ? 'none' : '1px solid var(--rp-gold-line)' }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 15, fontWeight: 800, color: 'var(--rp-text)' }}>{title}</span>
        {sub && <span style={{ display: 'block', fontSize: 12, color: 'var(--rp-text-dim)', marginTop: 2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</span>}
      </span>
      <span style={{ flex: '0 0 auto', color: 'var(--rp-text-dim)' }}>‹</span>
    </button>
  );

  return (
    <div className="rp-cq" style={{
      minHeight: '100vh', background: 'var(--rp-bg)', color: 'var(--rp-text)',
      fontFamily: 'var(--rp-font-ui)', direction: I18N.dir,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 'max(28px, env(safe-area-inset-top)) 22px 40px', gap: 26,
    }}>
      <div style={{ textAlign: 'center' }}>
        <img src={(typeof window !== 'undefined' && window.__RACEPLAN_LOGO__) || 'LogoV2.png'}
          alt="RACE PLAN" style={{ width: 96, height: 96, borderRadius: 22 }} />
        <div style={{ fontFamily: 'var(--rp-font-display)', fontSize: 26, fontWeight: 800,
          letterSpacing: '.14em', direction: 'ltr', marginTop: 14 }}>RACE PLAN</div>
        <div style={{ color: 'var(--rp-text-dim)', fontSize: 14, marginTop: 4 }}>
          {userName ? t('hub.hello', { name: userName }) : t('hub.tagline')}
        </div>
      </div>

      <div style={{ width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Card primary onClick={() => setSetupOpen(true)} title={t('hub.newPlan')}
          sub={t('hub.newPlanSub')}
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>} />

        {resume && (
          <Card onClick={() => onEnter(null)} title={t('hub.resume')}
            sub={`${resume.raceName} · ${U ? U.fmtDist(resume.dist) : formatKm(resume.dist)} · ${formatClock(resume.sec)}`}
            icon={<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.7 9.7 0 0 0-6.7 2.7L3 8" /><path d="M3 3v5h5" /></svg>} />
        )}

        <Card onClick={() => setSavedOpen(true)} title={t('hub.myPlans')}
          sub={isOwner ? t('hub.myPlansOwnerSub') : t('hub.myPlansSub')}
          icon={<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>} />

        {isOwner && RaceAdminPanel && RP_FB && (
          <Card onClick={() => setRaceAdminOpen(true)} title={t('hub.raceAdmin')}
            sub={t('hub.raceAdminSub')}
            icon={<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3Z" /><path d="M9 3v15M15 6v15" /></svg>} />
        )}
      </div>

      {setupOpen && (
        <RaceSetupSheet
          onClose={() => { setSetupOpen(false); setAthleteName(null); }}
          defaultName={athleteName ? t('hub.athleteRaceName', { name: athleteName }) : (resume ? resume.raceName : t('hub.defaultRaceName'))}
          onBuild={(handoff) => {
            setSetupOpen(false);
            onEnter(athleteName ? { ...handoff, trainer: athleteName } : handoff);
            setAthleteName(null);
          }}
        />
      )}

      {savedOpen && !isOwner && MyPlansPanel && (
        <MyPlansPanel
          onClose={() => setSavedOpen(false)}
          currentRaceName="" currentRaceDate="" currentRaceTime="" currentTrainer={userName}
          currentSegments={[]} currentPreset={null} currentCourse={null}
          onLoadPlan={loadSaved}
        />
      )}
      {savedOpen && isOwner && AthletePanel && (
        <AthletePanel
          onClose={() => setSavedOpen(false)}
          currentTrainer={userName}
          onLoadPlan={loadSaved}
          onPlanForAthlete={(name) => { setSavedOpen(false); setAthleteName(name); setSetupOpen(true); }}
        />
      )}
      {raceAdminOpen && isOwner && RaceAdminPanel && (
        <RaceAdminPanel onClose={() => setRaceAdminOpen(false)} />
      )}
    </div>
  );
}

// Branded sign-in screen (Firebase targets, when nobody is signed in).
function SignInScreen() {
  return (
    <div className="rp-cq" style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 22, padding: 28, textAlign: 'center',
      background: 'var(--rp-bg)', color: 'var(--rp-text)', fontFamily: 'var(--rp-font-ui)', direction: I18N.dir,
    }}>
      <img src={(typeof window !== 'undefined' && window.__RACEPLAN_LOGO__) || 'LogoV2.png'}
        alt="RACE PLAN" style={{ width: 128, height: 128, borderRadius: 24 }} />
      <div style={{ fontFamily: 'var(--rp-font-display)', fontSize: 30, fontWeight: 800,
        letterSpacing: '.14em', direction: 'ltr' }}>
        RACE PLAN
      </div>
      <div style={{ color: 'var(--rp-text-dim)', fontSize: 15, maxWidth: 300 }}>
        {t('signin.tagline')}
      </div>
      <button className="rp-btn rp-btn-primary" style={{ minHeight: 48, fontSize: 16, padding: '12px 26px' }}
        onClick={() => RP_FB && RP_FB.signIn()}>
        {t('signin.google')}
      </button>
    </div>
  );
}

// Auth gate + entry router. After sign-in the app ALWAYS opens on the Hub
// screen — the only exception is a shared-plan link (#s=…), which goes straight
// into the planner with that plan. A plan in progress is offered on the Hub as
// "המשך תכנון נוכחי".
function openStraightToPlanner() {
  try {
    if (typeof window !== 'undefined' && window.__RACEPLAN_SHARE__) return true;
    return location.hash.startsWith('#s=');
  } catch (e) { return false; }
}

function PlannerB() {
  const [fbUser, setFbUser] = React.useState(() => (RP_FB ? RP_FB.user : undefined));
  React.useEffect(() => (RP_FB ? RP_FB.onAuth((u) => setFbUser(u)) : undefined), []);

  const [view, setView] = React.useState(() => (openStraightToPlanner() ? 'planner' : 'hub'));
  const [seed, setSeed] = React.useState(null);   // plan handoff from the Hub
  const [runKey, setRunKey] = React.useState(0);  // remounts PlannerBApp on a fresh entry

  if (RP_FB && !fbUser) return <SignInScreen />;
  const isOwner = RP_FB ? (!!fbUser && fbUser.tier === 'owner') : RP_IS_OWNER;
  const userName = (fbUser && fbUser.name) || '';

  if (view === 'hub') {
    return (
      <HubScreen
        isOwner={isOwner}
        userName={userName}
        onEnter={(handoff) => { setSeed(handoff || null); setRunKey((k) => k + 1); setView('planner'); }}
      />
    );
  }
  return (
    <PlannerBApp
      key={runKey}
      isOwner={isOwner}
      userName={userName}
      seed={seed}
      onGoHome={() => setView('hub')}
    />
  );
}

function PlannerBApp({ isOwner, userName, seed, onGoHome }) {
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

  // Initial segments for the hook: a plan handed over from the Hub wins, then a
  // decoded share URL, else the hook falls back to localStorage.
  const initialSegs = React.useMemo(() => {
    if (seed && Array.isArray(seed.segments) && seed.segments.length) {
      return seed.segments.map((s, i) => ({
        id: s.id || 'sd' + i, distance: s.distance, paceSec: s.paceSec,
      }));
    }
    return shareData?.s?.map(([d, pace], i) => ({ id: 'sh' + i, distance: d, paceSec: pace })) ?? null;
  }, []);

  const p = useRacePlan(initialSegs, seed?.preset ?? shareData?.p);
  const { plan } = p;

  // A Hub handoff may also carry a course (route / GPX) and a race name.
  React.useEffect(() => {
    if (seed && seed.course) p.loadCourse(seed.course);
  }, []);

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
    () => (seed && seed.raceName) || shareData?.r || localStorage.getItem('rp-race') || t('planner.defaultRaceName')
  );
  const [trainer, setTrainer] = React.useState(
    () => (seed && seed.trainer) || shareData?.t || localStorage.getItem('rp-trainer')
      || (!isOwner && userName) || t('planner.athleteNamePlaceholder')
  );
  const [toastMsg, setToastMsg] = React.useState('');
  const toastTimer = React.useRef(null);
  const showToast = React.useCallback((msg) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 2600);
  }, []);
  React.useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  const [shareOpen, setShareOpen] = React.useState(false);
  const [pdfBusy, setPdfBusy] = React.useState(false);
  const printRef = React.useRef(null);
  const [showElevation, setShowElevation] = React.useState(true);
  const [showMyPlans, setShowMyPlans] = React.useState(false);
  const [goalOpen, setGoalOpen] = React.useState(false);
  const [valueEditor, setValueEditor] = React.useState(null); // { id, type, value }
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
      alert(t('setup.cannotReadGpx') + ':\n' + (err && err.message ? err.message : err));
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

  const buildShareUrl = () => {
    const encoded = encodePlan(raceName, trainer, p.activePreset, p.segments);
    const base = (typeof window !== 'undefined' && window.__RACEPLAN_EXEC_URL__) || '';
    return base
      ? base + (base.indexOf('?') === -1 ? '?' : '&') + 's=' + encoded
      : location.href.split('#')[0] + '#s=' + encoded;
  };

  const pdfFilename = () =>
    (raceName || 'race-plan').replace(/[\/\\:*?"<>|]+/g, '').trim().slice(0, 60) + '.pdf';

  const doShareLink = async () => {
    setShareOpen(false);
    const url = buildShareUrl();
    if (RP_EXPORT) {
      const r = await RP_EXPORT.shareLink(url, raceName || t('pdf.defaultTitle'));
      if (r === 'copied') showToast(t('planner.linkCopied'));
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => showToast(t('planner.linkCopied'))).catch(() => {});
    }
  };

  const doSharePdf = async () => {
    if (!RP_EXPORT || !printRef.current) { setShareOpen(false); window.print(); return; }
    setPdfBusy(true);
    try {
      const r = await RP_EXPORT.sharePdf(printRef.current, pdfFilename(), raceName || t('pdf.defaultTitle'));
      if (r === 'downloaded') showToast(t('planner.pdfDownloaded'));
    } catch (e) {
      showToast(t('planner.pdfFailed'));
      window.print();
    } finally {
      setPdfBusy(false);
      setShareOpen(false);
    }
  };

  const doPrint = () => { setShareOpen(false); setTimeout(() => window.print(), 60); };

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
    setRaceName(t('planner.defaultRaceName'));
    setRaceDate('');
    setRaceTime('07:00');
    try {
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    } catch (e) { /* sandboxed iframe — ignore */ }
    // p.reset() cleared the saved plan → the Hub's setup flow is the natural next step
    if (onGoHome) onGoHome();
  };

  // Owner: snapshot the current plan into an athlete's bank (matched by the
  // trainer/athlete name in the header; created if new).
  const saveToAthlete = () => {
    if (!AthleteDB) return;
    const name = (trainer || '').trim();
    if (!name || name === t('planner.athleteNamePlaceholder')) { showToast(t('planner.setAthleteName')); return; }
    let a = AthleteDB.findByName(name);
    if (!a) a = AthleteDB.addAthlete(name);
    AthleteDB.savePlan(a.id, {
      raceName, segments: p.segments, preset: p.activePreset, course: p.course,
    });
    showToast(t('planner.savedToAthlete', { name }));
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
    background: 'var(--rp-bg)', color: 'var(--rp-text)', direction: I18N.dir,
    minHeight: '100vh', boxSizing: 'border-box',
  };

  // race-card meta chips (date / time / trainer)
  const chipS = {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    background: 'var(--rp-surface)', border: '1px solid var(--rp-line)',
    borderRadius: 999, padding: '4px 9px', fontSize: 12, color: 'var(--rp-text-dim)',
  };
  const chipInputS = (val) => ({
    background: 'transparent', border: 'none', outline: 'none', cursor: 'pointer',
    color: val ? 'var(--rp-text-soft)' : 'var(--rp-placeholder)',
    fontSize: 12, fontFamily: 'inherit', fontWeight: 500, colorScheme: 'dark', padding: 0,
  });

  return (
    <div className="rp-cq" style={varsB}>
      {/* Desktop density; narrow widths get comfortable sizing + a reachable
          bottom action bar. Container-queries so it also adapts inside a
          narrow embed (Apps Script iframe), not only a small viewport. */}
      <style>{`
        .rpt-seg { padding: 6px 12px; }
        .rpt-head { padding: 0 12px 8px; }
        .rpt-total { padding: 11px 12px; margin-top: var(--rp-s-8); }
        .rp-toolbar { flex-wrap: wrap; justify-content: center; }
        /* Off-screen printable summary — the html2canvas target for PDF. */
        .rp-print-wrap { position: fixed; left: -10000px; top: 0; width: 720px;
          pointer-events: none; }
        @media print {
          body { background: #fff !important; }
          .rp-cq > .rp-planner-wrap { display: none !important; }
          .rp-print-wrap { position: static !important; left: auto !important; width: auto !important; }
        }
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
            padding: 8px !important; margin: 4px 0 12px !important; gap: 6px !important;
            box-shadow: 0 8px 24px rgba(0,0,0,.45);
            flex-wrap: wrap; justify-content: center; }
          .rp-toolbar .rp-btn { flex: 0 0 auto; padding: 10px 12px !important; font-size: 13px !important; }
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

        {/* ── race card: identity · goal clock · totals · segments ── */}
        <div className="rp-racecard" style={{
          background: 'linear-gradient(180deg, var(--rp-surface-2), var(--rp-surface))',
          border: '1px solid var(--rp-gold-line)', borderRadius: 18,
          padding: '16px 15px 14px', marginBottom: 12, boxShadow: 'var(--rp-shadow)',
        }}>
          {/* identity */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--rp-font-ui)', fontSize: 'clamp(19px, 4.6vw, 25px)',
                fontWeight: 800, lineHeight: 1.15, color: 'var(--rp-text)' }}>
                <EditableText value={raceName} onChange={setRaceName} placeholder={t('planner.raceNamePlaceholder')} />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 9, alignItems: 'center' }}>
                <span style={chipS}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 10h18M8 2v4M16 2v4" /></svg>
                  <input type="date" value={raceDate} onChange={(e) => setRaceDate(e.target.value)}
                    aria-label={t('planner.raceDate')} style={chipInputS(raceDate)} />
                </span>
                <span style={chipS}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                  <input type="time" value={raceTime} onChange={(e) => setRaceTime(e.target.value)}
                    aria-label={t('planner.startTime')} style={chipInputS(raceTime)} />
                </span>
                <span style={{ ...chipS, color: 'var(--rp-text-soft)' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                  <EditableText value={trainer} onChange={handleTrainerChange} placeholder={t('planner.athleteNamePlaceholder')}
                    style={{ color: 'var(--rp-text-soft)', fontSize: 12 }} />
                </span>
              </div>
            </div>
            <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 46, height: 46, borderRadius: 12, overflow: 'hidden' }}>
                <img src={(typeof window !== 'undefined' && window.__RACEPLAN_LOGO__) || 'LogoV2.png'}
                  alt="RACE PLAN" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
              </div>
              <div style={{ fontFamily: 'var(--rp-font-accent)', fontStyle: 'italic', fontSize: 11.5,
                color: 'var(--rp-gold)', opacity: .78, whiteSpace: 'nowrap' }}>Coach Krispel</div>
            </div>
          </div>

          {/* hero: live calculated total — tap to set a goal (rescales) */}
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
            <div style={{ width: '100%', maxWidth: 292 }}>
              <ClockDisplay totalSec={plan.totalTime} onClick={() => setGoalOpen(true)}
                caption={t('planner.computedTapForGoal')} />
            </div>
          </div>

          {/* strip */}
          <div style={{ display: 'flex', borderTop: '1px solid var(--rp-line)', marginTop: 14 }}>
            {[
              [U ? U.dispDistNum(plan.totalDist) : formatKm(plan.totalDist), U ? U.distUnit() : t('units.km')],
              [U ? U.fmtPace(plan.avgPace) : formatPace(plan.avgPace), t('planner.pacePerUnit', { unit: U ? U.distUnit() : t('units.km') })],
              ...(p.course && p.course.gain != null ? [['+' + (U ? U.elevInt(p.course.gain) : p.course.gain), U && U.imperial ? t('units.climbFt') : t('units.climb')]] : []),
            ].map(([v, k], i) => (
              <div key={i} style={{ flex: 1, textAlign: 'center', padding: '11px 4px 4px',
                borderInlineStart: i ? '1px solid var(--rp-line)' : 'none' }}>
                <div style={{ fontFamily: 'var(--rp-font-display)', fontWeight: 800, fontSize: 18,
                  fontVariantNumeric: 'tabular-nums' }}>{v}</div>
                <div style={{ fontSize: 10.5, color: 'var(--rp-text-dim)', marginTop: 3 }}>{k}</div>
              </div>
            ))}
          </div>

          <div style={{ borderTop: '1px solid var(--rp-line)', margin: '10px -15px 12px' }} />

          <SegmentsTable plan={plan} colors={themeB} stepperKind="pill"
            paceStep={1} distStep={0.01}
            onStepDist={p.stepDistance} onSetDist={p.setSegmentDistance}
            onStepPace={p.stepPace} onSetPace={p.setSegmentPace} onRemove={p.removeSegment}
            onEditValue={ValueEditor ? (id, ty, v) => setValueEditor({
              id, type: ty,
              value: U ? (ty === 'pace' ? U.dispPaceSec(v) : U.dispDist(v)) : v,
            }) : null}
            elevations={segElevs} />

          <button className="rp-btn" onClick={p.addSegment}
            style={{ marginTop: 10, width: '100%', justifyContent: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            {t('planner.addSegment')}
          </button>
        </div>

        <WeatherCard weather={weather} status={weatherStatus} />

        {/* actions — all visible, centred, wrapping (sticky bottom bar on phones) */}
        <div className="rp-toolbar" style={{ display: 'flex', gap: 8, flexWrap: 'wrap',
          justifyContent: 'center', marginBottom: 12 }}>
          <input ref={fileRef} type="file" accept=".gpx,application/gpx+xml,text/xml" onChange={onGpx} style={{ display: 'none' }} />

          <button className="rp-btn" onClick={() => fileRef.current && fileRef.current.click()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></svg>
            {t('setup.importGpx')}
          </button>

          {isOwner && RouteLibrary && RP_FB && (
            <button className="rp-btn" style={{ position: 'relative' }}
              onClick={() => { setRouteLibInit(null); setShowRouteLib(true); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3Z" /><path d="M9 3v15M15 6v15" /></svg>
              {t('setup.routeLibrary')}
              {pendingSubs > 0 && (
                <span aria-label={t('planner.pendingSubs', { n: pendingSubs })} style={{
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
              {t('hub.myPlans')}
            </button>
          )}

          <button className="rp-btn" disabled={pdfBusy} onClick={() => setShareOpen(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
            {t('planner.share')}
          </button>

          {MyPlansDB && RP_FB && !isOwner && (
            <button className="rp-btn" onClick={() => setShowNewPlanConfirm(true)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              {t('planner.newPlan')}
            </button>
          )}

          {isOwner && AthleteDB && (
            <button className="rp-btn" onClick={saveToAthlete}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
              {t('planner.saveToAthlete')}
            </button>
          )}

          {onGoHome && (
            <button className="rp-btn" onClick={onGoHome}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></svg>
              {t('planner.home')}
            </button>
          )}

          <button className="rp-btn" onClick={onReset}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
            {t('planner.reset')}
          </button>
        </div>

        {/* pace chart */}
        <div style={{ marginTop: 12, background: 'var(--rp-surface)', border: '1px solid var(--rp-line)',
          borderRadius: 'var(--rp-r-14)', padding: '12px 14px 4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--rp-text-soft)' }}>
              {t('chart.title')}
              {canEditBoundaries && showElevation && (
                <span style={{ fontWeight: 500, color: 'var(--rp-text-dim)', fontSize: 11.5 }}>
                  {t('chart.dragHint')}
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
                {t('chart.elevToggle')}
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
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--rp-text-soft)', marginBottom: 8 }}>{t('chart.mapTitle')}</div>
            <RouteMap track={p.course.track} height={210} />
          </div>
        )}

        {/* Elevation chart — hidden (elevation shown in pace chart overlay) */}
        {false && p.course?.profile && (
          <div style={{ marginTop: 16, background: '#161b22', border: '1px solid #232a34',
            borderRadius: 16, padding: '16px 16px 6px' }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: '#aab2c0', marginBottom: 4 }}>
              {t('chart.elevChartTitle')}
            </div>
            <ElevationChart profile={p.course.profile} colors={themeB} height={300}
              gain={p.course.gain} loss={p.course.loss} />
          </div>
        )}

      </div>

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
          display: 'flex', alignItems: 'center', justifyContent: 'center', direction: I18N.dir,
        }} onClick={(e) => { if (e.target === e.currentTarget) setShowNewPlanConfirm(false); }}>
          <div style={{
            background: 'var(--rp-surface)', border: '1px solid var(--rp-line-input)',
            borderRadius: 16, padding: '26px 30px', maxWidth: 360, textAlign: 'center',
            boxShadow: '0 16px 48px rgba(0,0,0,.7)', fontFamily: 'var(--rp-font-ui)',
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--rp-text)', marginBottom: 10 }}>
              {t('planner.newPlanConfirmTitle')}
            </div>
            <div style={{ fontSize: 13, color: 'var(--rp-text-dim)', marginBottom: 22 }}>
              {t('planner.newPlanConfirmBody')}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="rp-btn rp-btn-primary" onClick={() => startNewPlan(true)}>
                {t('planner.saveAndStart')}
              </button>
              <button className="rp-btn" onClick={() => startNewPlan(false)}>
                {t('planner.startWithoutSaving')}
              </button>
              <button className="rp-btn" onClick={() => setShowNewPlanConfirm(false)}>
                {t('common.cancel')}
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

      {ActionSheet && shareOpen && (
        <ActionSheet
          title={t('planner.share')}
          onClose={() => setShareOpen(false)}
          items={[
            {
              label: t('planner.sendLink'), onClick: doShareLink,
              icon: (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
              ),
            },
            {
              label: pdfBusy ? t('planner.preparingPdf') : t('planner.sendPdf'), disabled: pdfBusy, onClick: doSharePdf,
              icon: (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" />
                  <path d="M9 15h6M9 18h4" />
                </svg>
              ),
            },
            {
              label: t('planner.print'), onClick: doPrint,
              icon: (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                  <path d="M6 14h12v8H6Z" />
                </svg>
              ),
            },
          ]}
        />
      )}

      {goalOpen && (
        <GoalSheet
          currentSec={plan.totalTime}
          dist={plan.totalDist}
          onClose={() => setGoalOpen(false)}
          onApply={(goalSec) => {
            p.replaceSegments(scalePlanToGoal(p.segments, goalSec));
            setGoalOpen(false);
            showToast(t('planner.pacesUpdated', { goal: formatClock(goalSec) }));
          }}
        />
      )}

      {ValueEditor && valueEditor && (
        <ValueEditor
          type={valueEditor.type}
          value={valueEditor.value}
          unitMajor={U ? U.distUnit() : undefined}
          unitPace={U ? U.paceUnit() : undefined}
          title={(valueEditor.type === 'pace' ? t('ve.pace') : t('ve.distance')) + ' · '
            + t('planner.segmentN', { n: p.segments.findIndex((s) => s.id === valueEditor.id) + 1 })}
          onClose={() => setValueEditor(null)}
          onApply={(v) => {
            const si = U ? (valueEditor.type === 'pace' ? U.paceFromDisplaySec(v) : U.parseDist(v)) : v;
            if (valueEditor.type === 'pace') p.setSegmentPace(valueEditor.id, si);
            else p.setSegmentDistance(valueEditor.id, si);
            setValueEditor(null);
          }}
        />
      )}

      {PrintableSummary && (
        <div className="rp-print-wrap" aria-hidden="true">
          <PrintableSummary
            ref={printRef}
            raceName={raceName}
            trainer={trainer}
            raceDate={raceDate}
            raceTime={raceTime}
            plan={plan}
          />
        </div>
      )}

      <CopyToast show={!!toastMsg} text={toastMsg} />
    </div>
  );
}

window.PlannerB = PlannerB;
