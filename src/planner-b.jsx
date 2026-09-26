// planner-b.jsx — standalone "ליל" planner (version B), full-viewport &
// responsive, with GPX course import. No canvas, no separate mobile frame.
const { useRacePlan, formatPace, formatClock, parseClock, formatKm, PaceChart,
        LogoSlot, ZoneLegend, SegmentsTable, PRESETS, generatePlan,
        parseGpx, RouteMap, Route3DView, round2, clearSavedPlan,
        AthleteDB, AthletePanel, MyPlansDB, MyPlansPanel, RouteLibrary, RaceAdminPanel,
        PrintableSummary, ActionSheet, RP_EXPORT, ValueEditor, RP_HEAT,
        computeSegmentElevations, buildPlanSegments, SevenSeg, ClockDot, ClockDisplay } = window;
const I18N = window.I18N;
const useEscape = window.useEscape || (() => {});
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
// The route rides along in the link (optional `c`) so the athlete who opens it
// sees the map and elevation profile, not just the pace table. It is thinned
// and quantised to keep the URL a few KB: profile as delta-coded [10 m, 1 m]
// integers, track as delta-coded 1e-4° (~11 m) lat/lon integers.
const SHARE_PROFILE_PTS = 200;
const SHARE_TRACK_PTS = 300;

function deltaCode(values) {
  let prev = 0;
  return values.map((v) => { const d = v - prev; prev = v; return d; });
}
function deltaDecode(deltas) {
  let acc = 0;
  return deltas.map((d) => (acc += d));
}

function encodeCourse(course) {
  if (!course) return null;
  const c = {
    n: course.name || '',
    d: Math.round((course.dist || 0) * 1000) / 1000,
    g: Math.round(course.gain || 0),
    l: Math.round(course.loss || 0),
    o: course.source || '',
  };
  if (Array.isArray(course.profile) && course.profile.length > 1) {
    const prof = downsample(course.profile, SHARE_PROFILE_PTS);
    c.pd = deltaCode(prof.map((pt) => Math.round(pt.d * 100)));
    c.pe = deltaCode(prof.map((pt) => Math.round(pt.ele)));
  }
  if (Array.isArray(course.track) && course.track.length > 1) {
    const trk = downsample(course.track, SHARE_TRACK_PTS);
    c.ta = deltaCode(trk.map((pt) => Math.round(pt[0] * 1e4)));
    c.to = deltaCode(trk.map((pt) => Math.round(pt[1] * 1e4)));
  }
  if (course.lat != null && course.lon != null) {
    c.la = Math.round(course.lat * 1e5) / 1e5;
    c.lo = Math.round(course.lon * 1e5) / 1e5;
  }
  return c;
}

function decodeCourse(c) {
  if (!c || typeof c !== 'object') return null;
  let profile = null;
  if (Array.isArray(c.pd) && Array.isArray(c.pe) && c.pd.length === c.pe.length && c.pd.length > 1) {
    const ds = deltaDecode(c.pd);
    const es = deltaDecode(c.pe);
    profile = ds.map((d, i) => ({ d: d / 100, ele: es[i] }));
  }
  let track = null;
  if (Array.isArray(c.ta) && Array.isArray(c.to) && c.ta.length === c.to.length && c.ta.length > 1) {
    const las = deltaDecode(c.ta);
    const los = deltaDecode(c.to);
    track = las.map((la, i) => [la / 1e4, los[i] / 1e4]);
  }
  if (!profile && !track) return null;
  return {
    name: c.n || '',
    dist: +c.d || (profile ? profile[profile.length - 1].d : 0),
    gain: +c.g || 0,
    loss: +c.l || 0,
    source: c.o || '',
    profile,
    track,
    lat: c.la != null ? c.la : (track ? track[0][0] : null),
    lon: c.lo != null ? c.lo : (track ? track[0][1] : null),
  };
}

function sharePayload(raceName, trainer, preset, segments, course) {
  const payload = {
    v: 1,
    r: raceName,
    t: trainer,
    p: preset,
    s: segments.map(s => [round2(s.distance), s.paceSec]),
  };
  const c = encodeCourse(course);
  if (c) payload.c = c;
  return payload;
}

// A stored share (shares/{id}) holds the payload as plain JSON.
function parseSharePayload(json) {
  try {
    const data = JSON.parse(json);
    if (!data || data.v !== 1 || !Array.isArray(data.s) || !data.s.length) return null;
    return data;
  } catch { return null; }
}

// /p/{id} → id (the short share link), else null.
function sharePathId(pathname) {
  const m = /^\/p\/([A-Za-z0-9]{6,24})\/?$/.exec(pathname || '');
  return m ? m[1] : null;
}

function encodePlan(raceName, trainer, preset, segments, course) {
  const payload = sharePayload(raceName, trainer, preset, segments, course);
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  bytes.forEach(b => (binary += String.fromCharCode(b)));
  // base64url: '+' and '/' get mangled by some chat apps' link detection.
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodePlan(str) {
  try {
    let b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (data.v !== 1 || !Array.isArray(data.s) || !data.s.length) return null;
    return data;
  } catch { return null; }
}

// contentEditable text that commits on blur/Enter
function EditableText({ value, onChange, placeholder, style, editRef }) {
  return (
    <span
      ref={editRef}
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
// Paused: the generated clip's quality isn't good enough yet — flip back on
// once the 3D-flyover video capture is revisited. The rest of the feature
// (src/videoshare.jsx, route3d.jsx's renderNow/mount3D exports) stays intact.
const SHARE_VIDEO_ENABLED = false;

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

// Race-day conditions in one line: the forecast and the heat model's take on
// it (see docs/HEAT.md) used to be two stacked cards costing ~190px of the
// plan column, most of it read once and then ignored. The numbers that change
// a decision — temperature, humidity, how much the heat is worth in pace, and
// the button that applies it — stay on the row; wind, rain and the model's
// caveats are one tap away.
function ConditionsBar({ weather, status, advisory, onApply }) {
  const [open, setOpen] = React.useState(false);

  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10,
        background: 'var(--rp-surface)', border: '1px solid var(--rp-line)',
        borderRadius: 'var(--rp-r-12)', padding: '10px 14px', marginBottom: 10,
        fontSize: 13, color: 'var(--rp-text-dim)' }}>
        <span style={{ fontSize: 16 }}>🌍</span> {t('weather.loading')}
      </div>
    );
  }
  if (!weather) return null;

  const isHistorical = weather.source === 'historical-avg';
  const wet = weather.precipProb > 50;
  const per = U ? U.paceUnit() : t('units.perKm');
  const deltaDisp = advisory
    ? Math.round(U ? U.dispPaceSec(advisory.deltaSecPerKm) : advisory.deltaSecPerKm) : 0;
  const warnKey = advisory && advisory.warnings[0]; // one is plenty; they rarely combine usefully

  const sep = <span style={{ color: 'var(--rp-line-input)' }}>·</span>;

  return (
    <div style={{
      // An actionable advisory keeps the heat card's gold treatment — it is a
      // suggestion waiting on an answer, not just a readout.
      background: advisory ? 'var(--rp-gold-wash)' : 'var(--rp-surface)',
      border: `1px solid ${advisory ? 'var(--rp-gold-line)' : 'var(--rp-line)'}`,
      borderRadius: 'var(--rp-r-12)', overflow: 'hidden', marginBottom: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '7px 12px' }}>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={t('weather.detailsToggle')}
          style={{
            appearance: 'none', background: 'transparent', border: 'none', padding: '3px 0',
            font: 'inherit', cursor: 'pointer', color: 'var(--rp-text)', minWidth: 0,
            display: 'flex', alignItems: 'center', gap: 7, flex: '1 1 auto', textAlign: 'start',
          }}>
          <span style={{ fontSize: 18, lineHeight: 1, flex: '0 0 auto' }}>
            {isHistorical ? '📊' : _weatherIcon(weather.code)}
          </span>
          <span style={{ fontFamily: 'var(--rp-font-display)', fontSize: 16, fontWeight: 800,
            fontVariantNumeric: 'tabular-nums' }}>{weather.temp}°C</span>
          {sep}
          <span style={{ fontSize: 12, color: 'var(--rp-text-dim)' }}>
            {t('weather.humidityOnly', { pct: weather.humidityPct })}
          </span>
          {advisory && (
            <>
              {sep}
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--rp-gold)', whiteSpace: 'nowrap' }}>
                🌡️ {t('heat.chipDelta', { sec: deltaDisp, unit: per })}
              </span>
            </>
          )}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
            style={{ flex: '0 0 auto', marginInlineStart: 'auto', color: 'var(--rp-text-dim)',
              transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--rp-t-fast)' }}>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {advisory && (
          <button className="rp-btn" style={{ flex: '0 0 auto', padding: '7px 12px', fontSize: 12.5 }}
            onClick={onApply}>{t('heat.applyButton')}</button>
        )}
      </div>

      {open && (
        <div style={{ borderTop: '1px solid var(--rp-line)', padding: '10px 14px 12px',
          display: 'flex', flexDirection: 'column', gap: 9 }}>
          {!isHistorical && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '9px 22px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--rp-gold)" strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0,
                    transform: `rotate(${weather.windDir}deg)`, transition: 'transform var(--rp-t-phase)' }}>
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <polyline points="5 11 12 4 19 11" />
                </svg>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1 }}>
                    {U ? Math.round(U.dispSpeed(weather.windSpeed)) : weather.windSpeed}{' '}
                    <span style={{ fontSize: 10.5, fontWeight: 500, color: 'var(--rp-text-dim)' }}>
                      {U ? U.speedUnit() : t('units.kmh')}
                    </span>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--rp-text-dim)', marginTop: 2 }}>
                    {t('weather.wind', { dir: _windDirLabel(weather.windDir) })}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="16" height="16" viewBox="0 0 24 24"
                  fill={wet ? 'var(--rp-gold)' : 'var(--rp-text-dim)'}
                  stroke={wet ? 'var(--rp-gold)' : 'var(--rp-text-dim)'} strokeWidth="1" style={{ flexShrink: 0 }}>
                  <path d="M12 2C6 10 4 14 4 16a8 8 0 0 0 16 0c0-2-2-6-8-14z" />
                </svg>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1,
                    color: wet ? 'var(--rp-gold)' : 'var(--rp-text)' }}>{weather.precipProb}%</div>
                  <div style={{ fontSize: 10.5, color: 'var(--rp-text-dim)', marginTop: 2 }}>
                    {t('weather.rainChance')}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', fontSize: 12, color: 'var(--rp-text-dim)' }}>
                {t('weather.feelsLike', { temp: weather.feelsLike })}
              </div>
            </div>
          )}

          {isHistorical && (
            <div style={{ fontSize: 10.5, color: 'var(--rp-text-dim)' }}>{t('weather.historicalNote')}</div>
          )}

          {advisory && (
            <div style={{ fontSize: 11, color: 'var(--rp-text-dim)' }}>
              {t('heat.summary', { sec: deltaDisp, unit: per })}
              {' — '}
              {warnKey ? t('heat.warn.' + warnKey) : t('heat.disclaimer')}
            </div>
          )}
        </div>
      )}
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

// Route identity — course name + where it came from, one slim line. Distance
// and elevation gain used to repeat here (this component was called
// GpxBanner) even though they're always shown again, a few pixels below, on
// the race card's own stats — this only ever states what's unique: which
// route is loaded and its provenance. The save/remove actions it used to
// spend two full buttons on move into a small contextual "⋯" instead.
function RouteChip({ course, onClear, onSaveToLibrary, ownerMode }) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const sourceText = course.source
    ? (window.RP_ROUTES ? window.RP_ROUTES.sourceLabel(course.source) : course.source)
    : t('gpxBanner.fromGpx').replace(/^·\s*/, '');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8,
      background: 'var(--rp-surface)', border: '1px solid var(--rp-line)',
      borderRadius: 'var(--rp-r-8)', padding: '6px 8px 6px 6px', marginBottom: 8 }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--rp-gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: '0 0 auto' }}>
        <path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3Z" /><path d="M9 3v15M15 6v15" />
      </svg>
      <div style={{ flex: '1 1 auto', minWidth: 0, fontSize: 11.5, color: 'var(--rp-text-dim)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        <span style={{ color: 'var(--rp-text-soft)', fontWeight: 600 }}>{course.name || t('gpxBanner.importedRoute')}</span>
        {' · '}{sourceText}
      </div>
      {/* 36×36 target; the negative margin keeps the chip itself slim */}
      <button onClick={() => setMenuOpen(true)}
        aria-label={`${t('planner.more')} · ${course.name || t('gpxBanner.importedRoute')}`}
        style={{ flex: '0 0 auto', width: 36, height: 36, margin: '-6px -4px', display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: 'transparent', border: 'none', borderRadius: 'var(--rp-r-8)',
          color: 'var(--rp-text-dim)', cursor: 'pointer', fontSize: 15 }}>⋯</button>
      {ActionSheet && menuOpen && (
        <ActionSheet
          title={course.name || t('gpxBanner.importedRoute')}
          onClose={() => setMenuOpen(false)}
          items={[
            onSaveToLibrary && {
              label: ownerMode ? t('gpxBanner.saveToLibrary') : t('gpxBanner.proposeToLibrary'),
              onClick: () => { setMenuOpen(false); onSaveToLibrary(); },
              icon: (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3Z" /><path d="M9 3v15M15 6v15" /></svg>
              ),
            },
            {
              label: t('gpxBanner.removeRoute'), danger: true,
              onClick: () => { setMenuOpen(false); onClear(); },
              icon: (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" /></svg>
              ),
            },
          ].filter(Boolean)}
        />
      )}
    </div>
  );
}

// Toast — navy surface, cream text, bottom-center, per DESIGN_TOKENS §States.
// Portaled to <body> so it pins to the viewport, not the CSS-container root.
// `action` ({ label, onClick }) adds an inline button — used for "undo".
function CopyToast({ show, text, action }) {
  // Hold the last message/action through the fade-out — the caller clears
  // them the moment it hides, which used to flash the default text instead.
  const last = React.useRef({ text: '', action: null });
  if (show) last.current = { text, action };
  else { text = last.current.text; action = last.current.action; }
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
      pointerEvents: show && action ? 'auto' : 'none',
    }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--rp-gold)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
      {text || t('planner.linkCopied')}
      {action && (
        <button onClick={action.onClick} tabIndex={show ? 0 : -1} style={{
          marginInlineStart: 8, background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--rp-gold)', fontFamily: 'inherit', fontSize: 14, fontWeight: 800,
          padding: '6px 4px', minHeight: 32,
        }}>{action.label}</button>
      )}
    </div>
  ), document.body);
}

// Date/time field for the race card's meta line. The native inputs render in
// the *browser's* locale (an English Chrome shows "mm/dd/yyyy" in the Hebrew
// UI) and are ~20px tall, so the visible part is a plain button with the value
// formatted in the app's locale; the real input stays underneath only to
// supply the native picker.
function MetaPicker({ type, value, onChange, label }) {
  const ref = React.useRef(null);
  const open = () => {
    const el = ref.current;
    if (!el) return;
    try { el.showPicker(); } catch (e) { el.focus(); }
  };
  let text = label;
  if (value && type === 'date') {
    const [y, m, d] = value.split('-').map(Number);
    text = I18N && I18N.fmtDate
      ? I18N.fmtDate(new Date(y, m - 1, d), { day: '2-digit', month: '2-digit', year: 'numeric' })
      : `${d}/${m}/${y}`;
  } else if (value) {
    text = value;
  }
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button type="button" onClick={open} aria-label={value ? `${label}: ${text}` : label}
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 12, fontWeight: 500, padding: '6px 2px', minHeight: 32,
          color: value ? 'var(--rp-text-soft)' : 'var(--rp-placeholder)',
          display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {type === 'date' ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
        )}
        <bdi>{text}</bdi>
      </button>
      <input ref={ref} type={type} value={value} onChange={(e) => onChange(e.target.value)}
        tabIndex={-1} aria-hidden="true"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0,
          pointerEvents: 'none', border: 0, padding: 0, colorScheme: 'dark' }} />
    </span>
  );
}

// Confirmation dialog for destructive actions. `actions` is a list of
// { label, onClick, primary?, danger? }; Escape and a backdrop click cancel.
function ConfirmDialog({ title, body, actions, onCancel }) {
  useEscape(onCancel);
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1001, background: 'rgba(0,0,0,.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', direction: I18N.dir,
      padding: 16,
    }} onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="rp-confirm-title" style={{
        background: 'var(--rp-surface)', border: '1px solid var(--rp-line-input)',
        borderRadius: 16, padding: '26px 24px 20px', width: '100%', maxWidth: 360, textAlign: 'center',
        boxShadow: '0 16px 48px rgba(0,0,0,.7)', fontFamily: 'var(--rp-font-ui)',
      }}>
        <div id="rp-confirm-title" style={{ fontSize: 15, fontWeight: 700, color: 'var(--rp-text)', marginBottom: 10 }}>
          {title}
        </div>
        {body && (
          <div style={{ fontSize: 13, color: 'var(--rp-text-dim)', marginBottom: 22 }}>{body}</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {actions.map((a, i) => (
            <button key={i} style={{ justifyContent: 'center', minHeight: 44,
              ...(a.danger ? { color: 'var(--rp-danger-text)', borderColor: 'currentColor' } : null) }}
              className={'rp-btn' + (a.primary ? ' rp-btn-primary' : '')}
              onClick={a.onClick}>{a.label}</button>
          ))}
          {/* focus lands on the safe choice, so a stray Enter never destroys anything */}
          <button className="rp-btn" autoFocus style={{ justifyContent: 'center', minHeight: 44 }}
            onClick={onCancel}>{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  );
}

// A button that fires once on tap and auto-repeats (accelerating) while held —
// so h/m/s can be set entirely by tapping, no keyboard.
function HoldButton({ delta, onStep, children, style, ariaLabel, tabIndex }) {
  const timer = React.useRef(null);
  const stop = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  React.useEffect(() => stop, []);
  const start = (e) => {
    e.preventDefault();
    onStep(delta);
    let gap = 300;
    const tick = () => { onStep(delta); gap = Math.max(45, gap * 0.82); timer.current = setTimeout(tick, gap); };
    timer.current = setTimeout(tick, 380);
  };
  return (
    <button type="button" aria-label={ariaLabel || (delta < 0 ? t('common.decrease') : t('common.add'))}
      tabIndex={tabIndex}
      onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      style={{
        cursor: 'pointer', touchAction: 'manipulation', lineHeight: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto',
        ...style,
      }}>{children}</button>
  );
}

// ── race finish-line clock (CSS seven-segment) ─────────────────────────
// SevenSeg/ClockDot/ClockDisplay live in shared.jsx (window.*) — route3d.jsx
// reuses the same read-only ClockDisplay for its in-run clock.
// One h/m/s field: ▲/▼ steppers plus tap-the-digits to type the number on a
// numeric keypad. The digits stay seven-segment while typing — a transparent
// input sits on top of them, so focus/keyboard behave natively (important on
// iOS, where focus must happen inside the tap gesture).
function ClockGroup({ value, digits, max, onChange, label, digitH, inputRef, onFilled }) {
  // wrap-around spinner (no carry between units)
  const bump = (d) => onChange((v) => ((v + d) % (max + 1) + (max + 1)) % (max + 1));
  const chevStyle = {
    width: '100%', height: 22, borderRadius: 6, fontSize: 12,
    border: '1px solid rgba(245,194,74,.16)', background: 'rgba(245,194,74,.06)',
    color: 'rgba(245,194,74,.8)',
  };

  // Digits typed since the field took focus; null = not editing, '' = focused
  // but nothing typed yet (we then show the current value dimmed). They live in
  // a ref as well as in state because blur — including the one the hop to the
  // next field fires — runs before React re-renders, so commit would otherwise
  // read a stale `draft` and drop the last digit typed.
  const [draft, setDraft] = React.useState(null);
  const draftRef = React.useRef(null);
  const write = (v) => { draftRef.current = v; setDraft(v); };
  const editing = draft != null;
  const maxLen = Math.max(digits, String(max).length);

  const commit = () => {
    const d = draftRef.current;
    if (d) {
      const n = parseInt(d, 10);
      if (isFinite(n)) onChange(Math.max(0, Math.min(max, n)));
    }
    write(null);
  };
  // arrows while typing move the value and keep the shown digits in step
  const nudge = (d) => {
    const base = draftRef.current ? parseInt(draftRef.current, 10) : value;
    const n = ((base + d) % (max + 1) + (max + 1)) % (max + 1);
    onChange(n);
    write(String(n));
  };

  // right-aligned cells; null = an unfilled slot (all segments dark)
  const str = draft || String(value).padStart(digits, '0');
  const width = Math.max(digits, str.length);
  const cells = [];
  for (let i = 0; i < width; i++) {
    const ch = str[i - (width - str.length)];
    cells.push(ch == null ? null : +ch);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
      minWidth: 46 }}>
      {/* chevrons stay out of the tab order so Tab walks h → m → s; the field
          itself answers ArrowUp/ArrowDown, as Stepper does in shared.jsx */}
      <HoldButton delta={1} onStep={bump} style={chevStyle} tabIndex={-1} ariaLabel={`${label} +`}>▲</HoldButton>
      <div style={{ position: 'relative', display: 'flex', gap: 3, cursor: 'text',
        padding: '2px 3px', margin: '-2px -3px', borderRadius: 7,
        background: editing ? 'rgba(245,194,74,.07)' : 'transparent',
        boxShadow: editing ? '0 0 0 1px rgba(245,194,74,.5)' : 'none',
        opacity: draft === '' ? 0.4 : 1 }}>
        {cells.map((v, i) => <SevenSeg key={i} value={v} h={digitH} />)}
        <input
          ref={inputRef} value={draft || ''} inputMode="numeric" aria-label={label}
          onFocus={() => write('')}
          onBlur={commit}
          onChange={(e) => {
            const d = e.target.value.replace(/\D/g, '').slice(-maxLen);
            write(d);
            // hop to the next field only once this one is full — never on a
            // single digit, which would cut a two-digit entry short
            if (onFilled && d.length >= maxLen) onFilled();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            // an empty draft makes the pending commit a no-op, so Escape cancels
            else if (e.key === 'Escape') { write(''); e.currentTarget.blur(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); nudge(1); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(-1); }
          }}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%',
            border: 'none', outline: 'none', background: 'transparent', padding: 0, margin: 0,
            color: 'transparent', caretColor: 'transparent', cursor: 'text',
            fontSize: 16 /* keeps iOS from zooming on focus */ }} />
      </div>
      <HoldButton delta={-1} onStep={bump} style={chevStyle} tabIndex={-1} ariaLabel={`${label} −`}>▼</HoldButton>
      <span style={{ fontSize: 8.5, letterSpacing: '.12em', color: 'rgba(245,194,74,.45)',
        textTransform: 'uppercase' }}>{label}</span>
    </div>
  );
}
function RaceClock({ h, m, s, onH, onM, onS, subtitle, digitH = 50 }) {
  const mRef = React.useRef(null);
  const sRef = React.useRef(null);
  const focus = (ref) => { if (ref.current) ref.current.focus(); };
  return (
    <div style={{
      '--rc-on': '#F5C24A', '--rc-off': 'rgba(245,194,74,.11)', '--rc-glow': 'rgba(245,194,74,.7)',
      background: '#12141d', border: '1px solid var(--rp-line)', borderRadius: 16,
      padding: '9px 10px 7px', boxShadow: 'inset 0 2px 12px rgba(0,0,0,.45)',
    }}>
      <div style={{ background: '#04050a', borderRadius: 12, padding: '10px 8px 7px',
        display: 'flex', direction: 'ltr', alignItems: 'flex-start', justifyContent: 'center', gap: 4,
        boxShadow: 'inset 0 0 22px rgba(0,0,0,.75)' }}>
        <ClockGroup value={h} digits={1} max={11} onChange={onH} label={t('clock.hours')} digitH={digitH}
          onFilled={() => focus(mRef)} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, alignItems: 'center',
          justifyContent: 'center', height: digitH, marginTop: 27 }}>
          <ClockDot /><ClockDot />
        </div>
        <ClockGroup value={m} digits={2} max={59} onChange={onM} label={t('clock.minutes')} digitH={digitH}
          inputRef={mRef} onFilled={() => focus(sRef)} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, alignItems: 'center',
          justifyContent: 'center', height: digitH, marginTop: 27 }}>
          <ClockDot /><ClockDot />
        </div>
        <ClockGroup value={s} digits={2} max={59} onChange={onS} label={t('clock.seconds')} digitH={digitH}
          inputRef={sRef} />
      </div>
      <div style={{ textAlign: 'center', fontSize: 9.5, marginTop: 7, letterSpacing: '.03em',
        color: 'rgba(245,194,74,.45)' }}>{t('clock.tapToType')}</div>
      {subtitle && (
        <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--rp-text-dim)',
          marginTop: 5, letterSpacing: '.03em', overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap' }}>{subtitle}</div>
      )}
    </div>
  );
}

// Proportionally rescale every segment's pace so Σ(pace·dist) hits goalSec —
// keeps the relative strategy shape and any manual per-segment edits.
function scalePlanToGoal(segments, goalSec) {
  const cur = (segments || []).reduce((a, s) => a + s.distance * s.paceSec, 0);
  if (!(cur > 0) || !(goalSec > 0)) return segments;
  const f = goalSec / cur;
  return window.roundPacesToGoal(
    segments.map((s) => ({ ...s, paceSec: s.paceSec * f })), goalSec, 120, 900);
}

// Tapping the race-card hero opens this: dial a goal time, apply = rescale.
function GoalSheet({ currentSec, dist, onClose, onApply }) {
  useEscape(onClose);
  const d0 = Math.max(0, Math.round(currentSec || 0));
  const [gh, setGh] = React.useState(Math.min(11, Math.floor(d0 / 3600)));
  const [gm, setGm] = React.useState(Math.floor((d0 % 3600) / 60));
  const [gs, setGs] = React.useState(d0 % 60);
  const goalSec = gh * 3600 + gm * 60 + gs;
  const ok = goalSec >= 600 && goalSec <= 12 * 3600;
  return ReactDOM.createPortal((
    <div className="rp-cq-scope" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
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
  useEscape(onCancel);
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
    <div className="rp-cq-scope" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
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
  useEscape(onClose);
  const [course, setCourse] = React.useState(null); // {name,dist,profile?,track?,...}
  // raw GPX payload (gpxText/profileFlat/trackFlat) behind the current course,
  // when it came from "my route" — carried through to the planner so its
  // RouteChip can offer "save/propose to library" same as a toolbar import.
  const [routeMeta, setRouteMeta] = React.useState(null);
  const [customKm, setCustomKm] = React.useState('');
  const [routeOpen, setRouteOpen] = React.useState(false);
  const [entryMode, setEntryMode] = React.useState(null); // null | 'route' | 'distance'
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
    setRouteMeta(null); // a fresh pick invalidates any previous GPX payload
    setErr('');
    // whole minutes — a seed of 1:56:03 reads like a computed leftover, not a goal
    const g = Math.round(((c.dist || 10) * 330) / 60) * 60;
    setGh(Math.min(11, Math.floor(g / 3600)));
    setGm(Math.floor((g % 3600) / 60));
    setGs(g % 60);
    setGradeAdjust(!!(c.profile && c.profile.length > 1));
  };

  const pickPreset = (km, name) => applyCourse({ name, dist: km, profile: null });
  const pickCustom = () => {
    const km = U ? Math.round(U.parseDist(customKm) * 100) / 100
      : Math.round(parseFloat(String(customKm).replace(',', '.')) * 100) / 100;
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
      if (built) {
        setRouteMeta({
          gpxText: built.gpxText, profileFlat: built.profileFlat,
          trackFlat: built.trackFlat, sourceUrl: null,
        });
      }
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

  // the raw GPX payload only makes sense alongside the course it came from
  const lastRouteFor = (rc) => (rc && routeMeta ? { ...routeMeta, course: rc } : null);

  const build = () => {
    if (!course || !goalOk) return;
    const segs = buildPlanSegments(course.profile || null, course.dist, opts);
    if (!segs.length) { setErr(t('setup.cannotBuild')); return; }
    const rc = realCourse(course);
    onBuild({ segments: segs, course: rc, raceName: course.name || defaultName, goalSec, lastRoute: lastRouteFor(rc) });
  };
  const startEmpty = () => {
    const km = course ? course.dist : 10;
    const rc = realCourse(course);
    onBuild({
      segments: generatePlan(km), course: rc,
      raceName: course ? course.name : null, lastRoute: lastRouteFor(rc),
    });
  };

  const chip = (active, label, onClick, key, sub) => (
    <button key={key} onClick={onClick} style={{
      padding: sub ? '6px 13px' : '8px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer',
      fontFamily: 'inherit', minHeight: 40, display: 'inline-flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', lineHeight: 1.15,
      background: active ? 'var(--rp-gold-wash)' : 'var(--rp-surface-2)',
      color: active ? 'var(--rp-gold)' : 'var(--rp-text)',
      border: `1px solid ${active ? 'var(--rp-gold-line)' : 'var(--rp-line)'}`,
    }}>{label}{sub && <small style={{ fontSize: 10, fontWeight: 500, opacity: .75 }}>{sub}</small>}</button>
  );

  return ReactDOM.createPortal((
    <div className="rp-cq-scope" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(9,11,22,.80)',
        backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, direction: I18N.dir, fontFamily: 'var(--rp-font-ui)', color: 'var(--rp-text)' }}>
      <div style={{ background: 'var(--rp-surface)', border: '1px solid var(--rp-line)',
        borderRadius: 'var(--rp-r-14)', width: '100%', maxWidth: 440, maxHeight: '92vh',
        overflowY: 'auto', boxShadow: 'var(--rp-shadow-modal)', padding: '18px 18px 16px' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{t('setup.title')}</div>
          <button onClick={onClose} aria-label={t('common.close')} style={{ background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--rp-text-dim)', fontSize: 20, lineHeight: 1, padding: '2px 6px' }}>✕</button>
        </div>

        <input ref={fileRef} type="file" accept=".gpx,application/gpx+xml,text/xml"
          onChange={onGpxFile} style={{ display: 'none' }} />

        {!course && !entryMode && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--rp-text-dim)', marginBottom: 8 }}>
              {t('setup.howToStart')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <HubCard primary onClick={() => setEntryMode('route')}
                title={t('setup.hasRoute')} sub={t('setup.hasRouteSub')}
                icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3Z" /><path d="M9 3v15M15 6v15" /></svg>} />
              <HubCard onClick={() => setEntryMode('distance')}
                title={t('setup.justDistance')} sub={t('setup.justDistanceSub')}
                icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="4" y1="12" x2="20" y2="12" /><circle cx="4" cy="12" r="2.2" fill="currentColor" stroke="none" /><circle cx="20" cy="12" r="2.2" fill="currentColor" stroke="none" /></svg>} />
            </div>
          </>
        )}

        {!course && entryMode === 'route' && (
          <>
            <button onClick={() => setEntryMode(null)} className="rp-btn" style={{ marginBottom: 10, fontSize: 12.5, padding: '6px 10px' }}>
              {I18N.dir === 'rtl' ? '›' : '‹'} {t('common.back')}
            </button>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {RouteLibrary && (
                <HubCard primary onClick={() => setRouteOpen(true)}
                  title={t('setup.routeLibrary')} sub={t('setup.routeLibrarySub')}
                  icon={<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3Z" /><path d="M9 3v15M15 6v15" /></svg>} />
              )}
              <HubCard onClick={() => fileRef.current && fileRef.current.click()}
                title={t('setup.myRoute')} sub={t('setup.importGpxSub')}
                icon={<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></svg>} />
            </div>
          </>
        )}

        {!course && entryMode === 'distance' && (
          <>
            <button onClick={() => setEntryMode(null)} className="rp-btn" style={{ marginBottom: 10, fontSize: 12.5, padding: '6px 10px' }}>
              {I18N.dir === 'rtl' ? '›' : '‹'} {t('common.back')}
            </button>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--rp-text-dim)', marginBottom: 7 }}>{t('setup.distance')}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(PRESETS || []).map((pr) => chip(
                !!course && Math.abs((course.dist || 0) - pr.km) < 0.05 && !course.profile,
                (window.presetLabel ? window.presetLabel(pr) : pr.km), () => pickPreset(pr.km, presetName(pr)), pr.km,
                pr.nameKey ? t(pr.nameKey) : null))}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
              <input value={customKm} onChange={(e) => setCustomKm(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') pickCustom(); }}
                inputMode="decimal" placeholder={U && U.imperial ? t('setup.customMi') : t('setup.customKm')}
                style={{ flex: 1, background: 'var(--rp-surface-2)', border: '1px solid var(--rp-line-input)',
                  borderRadius: 8, padding: '8px 10px', fontSize: 13, color: 'var(--rp-text)',
                  fontFamily: 'inherit', outline: 'none' }} />
              <button onClick={pickCustom} className="rp-btn" style={{ flex: '0 0 auto' }}>{t('common.continue')}</button>
            </div>
          </>
        )}

        {course && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, fontSize: 12.5, color: 'var(--rp-gold)',
            background: 'var(--rp-gold-wash)', border: '1px solid var(--rp-gold-line)',
            borderRadius: 8, padding: '8px 10px' }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              {course.name} · {U ? U.fmtDist(course.dist) : formatKm(course.dist)}{course.profile ? ' · ' + t('setup.hasProfile') : ''}
            </span>
            <button onClick={() => { setCourse(null); setRouteMeta(null); setEntryMode(null); }}
              style={{ flex: '0 0 auto', background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--rp-gold)', fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
                textDecoration: 'underline', padding: 0 }}>{t('setup.change')}</button>
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

            {/* a plain distance has no route to follow, so there's nothing to
                adjust — the option only appears once a route is loaded */}
            {(course.track || course.profile) && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 13,
                cursor: hasProfile ? 'pointer' : 'not-allowed', opacity: hasProfile ? 1 : 0.5 }}>
                <input type="checkbox" checked={gradeAdjust && hasProfile} disabled={!hasProfile}
                  onChange={(e) => setGradeAdjust(e.target.checked)} style={{ accentColor: 'var(--rp-gold)' }} />
                {t('setup.gradeAdjust')}
                {!hasProfile && <span style={{ fontSize: 11, color: 'var(--rp-text-dim)' }}>· {t('setup.noElevation')}</span>}
              </label>
            )}

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

        {course && (
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="rp-btn rp-btn-primary" disabled={!goalOk}
              onClick={build} style={{ flex: 1, justifyContent: 'center' }}>{t('setup.build')}</button>
            <button className="rp-btn" onClick={startEmpty} style={{ flex: '0 0 auto' }}>
              {t('setup.startEmpty')}
            </button>
          </div>
        )}
      </div>

      {RouteLibrary && routeOpen && (
        <RouteLibrary
          zIndex={1200}
          onClose={(afterSubmit) => { setRouteOpen(false); if (afterSubmit) build(); }}
          onLoadCourse={applyCourse}
          raceName={defaultName}
          isOwner={false}
        />
      )}
    </div>
  ), document.body);
}

// ── SettingsSheet ───────────────────────────────────────────────────────
// Language + measurement units. Changes take effect immediately (the root
// subscribes via I18N.useI18n / UNITS.useUnits) and persist to localStorage +
// the signed-in user's profile.
function SettingsSheet({ onClose }) {
  useEscape(onClose);
  const [, force] = React.useState(0);
  const bump = () => force((x) => x + 1);
  const locale = I18N ? I18N.locale : 'he';
  const system = U ? U.system : 'metric';
  const locales = I18N ? I18N.locales : ['he'];
  const names = (I18N && I18N.localeNames) || { he: 'he', en: 'en', fr: 'fr', es: 'es' };

  const row = (active, label, onClick, key) => (
    <button key={key} onClick={onClick} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      width: '100%', padding: '11px 14px', borderRadius: 10, cursor: 'pointer',
      fontFamily: 'inherit', fontSize: 14, fontWeight: 600, marginBottom: 6,
      background: active ? 'var(--rp-gold-wash)' : 'var(--rp-surface-2)',
      border: `1px solid ${active ? 'var(--rp-gold-line)' : 'var(--rp-line)'}`,
      color: active ? 'var(--rp-gold)' : 'var(--rp-text)',
    }}>
      <span>{label}</span>
      {active && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
      )}
    </button>
  );

  return ReactDOM.createPortal((
    <div className="rp-cq-scope" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1300, background: 'rgba(9,11,22,.80)',
        backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 18, direction: I18N.dir, fontFamily: 'var(--rp-font-ui)', color: 'var(--rp-text)' }}>
      <div style={{ background: 'var(--rp-surface)', border: '1px solid var(--rp-line)',
        borderRadius: 'var(--rp-r-14)', width: '100%', maxWidth: 380,
        boxShadow: 'var(--rp-shadow-modal)', padding: '16px 18px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{t('settings.title')}</div>
          <button onClick={onClose} aria-label={t('common.close')} style={{ background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--rp-text-dim)', fontSize: 20, lineHeight: 1, padding: '2px 6px' }}>✕</button>
        </div>

        <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--rp-text-dim)',
          letterSpacing: '.06em', textTransform: 'uppercase', margin: '2px 2px 8px' }}>{t('settings.language')}</div>
        {locales.map((l) => row(locale === l, names[l] || l,
          () => { if (I18N) { I18N.setLocale(l); bump(); } }, l))}

        <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--rp-text-dim)',
          letterSpacing: '.06em', textTransform: 'uppercase', margin: '14px 2px 8px' }}>{t('settings.units')}</div>
        {row(system === 'metric', t('settings.metric'),
          () => { if (U) { U.setSystem('metric'); bump(); } }, 'metric')}
        {row(system === 'imperial', t('settings.imperial'),
          () => { if (U) { U.setSystem('imperial'); bump(); } }, 'imperial')}
      </div>
    </div>
  ), document.body);
}

// ── HubScreen ────────────────────────────────────────────────────────────
// Post-sign-in home: plan a new race, resume the current one, or open a saved
// plan. onEnter(handoff) drops the user into the planner.
function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.31.22.66.22 1v.09c0 .68.38 1.29 1 1.51H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// Shared tappable row: icon box + title + subtitle + chevron. Used for the
// Hub's top-level cards and reused inside RaceSetupSheet's entry fork so the
// "how do I start" choice reads as the same kind of decision as the Hub's.
function HubCard({ onClick, primary, icon, title, sub }) {
  return (
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
      {/* "forward" points toward the reading end: left in Hebrew, right in English */}
      <span aria-hidden="true" style={{ flex: '0 0 auto', color: 'var(--rp-text-dim)', fontSize: 18, lineHeight: 1 }}>
        {I18N.dir === 'rtl' ? '‹' : '›'}</span>
    </button>
  );
}

function HubScreen({ isOwner, userName, onEnter }) {
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [setupOpen, setSetupOpen] = React.useState(false);
  const [savedOpen, setSavedOpen] = React.useState(false);
  const [raceAdminOpen, setRaceAdminOpen] = React.useState(false);
  const [athleteName, setAthleteName] = React.useState(null); // planning for a specific athlete
  const [replaceConfirm, setReplaceConfirm] = React.useState(false);

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

  const Card = HubCard;

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
        {/* a new plan overwrites the one in progress — say so before it happens */}
        <Card primary onClick={() => (resume ? setReplaceConfirm(true) : setSetupOpen(true))} title={t('hub.newPlan')}
          sub={t('hub.newPlanSub')}
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>} />

        {resume && (
          <Card onClick={() => onEnter(null)} title={t('hub.resume')}
            sub={`${resume.raceName} · ${U ? U.fmtDist(resume.dist) : formatKm(resume.dist)} · ${formatClock(resume.sec)}`}
            icon={<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.7 9.7 0 0 0-6.7 2.7L3 8" /><path d="M3 3v5h5" /></svg>} />
        )}

        {/* the owner's card opens the athlete roster, so it's named after it */}
        <Card onClick={() => setSavedOpen(true)} title={isOwner ? t('athletes.title') : t('hub.myPlans')}
          sub={isOwner ? t('hub.myPlansOwnerSub') : t('hub.myPlansSub')}
          icon={isOwner
            ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
            : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>} />

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

      <button onClick={() => setSettingsOpen(true)} aria-label={t('settings.title')}
        style={{ position: 'fixed', top: 'calc(12px + env(safe-area-inset-top))', insetInlineEnd: 14,
          width: 38, height: 38, borderRadius: 999, cursor: 'pointer',
          background: 'var(--rp-surface)', border: '1px solid var(--rp-line)', color: 'var(--rp-text-dim)',
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <GearIcon />
      </button>
      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
      {replaceConfirm && resume && (
        <ConfirmDialog
          title={t('hub.replaceConfirmTitle')}
          body={t('hub.replaceConfirmBody', { name: resume.raceName })}
          onCancel={() => setReplaceConfirm(false)}
          actions={[
            { label: t('hub.replaceConfirm'), primary: true,
              onClick: () => { setReplaceConfirm(false); setSetupOpen(true); } },
            { label: t('hub.resume'), onClick: () => { setReplaceConfirm(false); onEnter(null); } },
          ]}
        />
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
    return location.hash.startsWith('#s=') || !!sharePathId(location.pathname);
  } catch (e) { return false; }
}

// Shown while a /p/{id} share is fetched (or when it can't be found).
function ShareLoadingScreen({ failed, onContinue }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 18, background: 'var(--rp-bg, #111528)', color: 'var(--rp-text, #F6EFE3)' }}>
      <img src={(typeof window !== 'undefined' && window.__RACEPLAN_LOGO__) || 'LogoV2.png'}
        width="96" height="96" alt="RACE PLAN" style={{ borderRadius: 20 }} />
      <div style={{ fontSize: 15, opacity: 0.8 }}>{failed ? t('share.notFound') : t('share.loading')}</div>
      {failed && (
        <button className="rp-btn rp-btn-primary" onClick={onContinue}>{t('common.continue')}</button>
      )}
    </div>
  );
}

function PlannerB() {
  // Subscribe the whole tree to language + units switches (nothing here is
  // React.memo'd, so a root re-render re-runs every t()/UNITS call below).
  if (I18N && I18N.useI18n) I18N.useI18n();
  if (U && U.useUnits) U.useUnits();

  const [fbUser, setFbUser] = React.useState(() => (RP_FB ? RP_FB.user : undefined));
  React.useEffect(() => (RP_FB ? RP_FB.onAuth((u) => setFbUser(u)) : undefined), []);

  const [view, setView] = React.useState(() => (openStraightToPlanner() ? 'planner' : 'hub'));
  const [seed, setSeed] = React.useState(null);   // plan handoff from the Hub
  const [runKey, setRunKey] = React.useState(0);  // remounts PlannerBApp on a fresh entry

  // Short share link (/p/{id}): fetch the stored plan once signed in, then open
  // the planner with it. 'loading' → payload | 'failed'.
  const [shareId] = React.useState(() => { try { return sharePathId(location.pathname); } catch (e) { return null; } });
  const [shortShare, setShortShare] = React.useState(shareId ? 'loading' : null);
  const signedIn = !!fbUser;
  React.useEffect(() => {
    if (!shareId || !signedIn || !RP_FB || !RP_FB.shareLoad) return;
    let alive = true;
    RP_FB.shareLoad(shareId).then((json) => {
      if (!alive) return;
      const data = json ? parseSharePayload(json) : null;
      setShortShare(data || 'failed');
      // Drop /p/{id} from the address bar so a reload doesn't clobber edits.
      if (data) { try { history.replaceState(null, '', '/' + location.search); } catch (e) {} }
    });
    return () => { alive = false; };
  }, [shareId, signedIn]);

  // A new deploy may reload the page silently only where nothing is lost:
  // the sign-in screen or the Hub (see update.jsx).
  const reloadSafe = !signedIn || view === 'hub';
  React.useEffect(() => { if (window.RP_UPDATE) window.RP_UPDATE.setSafe(reloadSafe); }, [reloadSafe]);

  if (RP_FB && !fbUser) return <SignInScreen />;
  const isOwner = RP_FB ? (!!fbUser && fbUser.tier === 'owner') : RP_IS_OWNER;
  const userName = (fbUser && fbUser.name) || '';

  if (view === 'planner' && (shortShare === 'loading' || shortShare === 'failed')) {
    return (
      <ShareLoadingScreen
        failed={shortShare === 'failed'}
        onContinue={() => {
          try { history.replaceState(null, '', '/' + location.search); } catch (e) {}
          setShortShare(null);
          setView('hub');
        }}
      />
    );
  }

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
      sharedPlan={runKey === 0 && shortShare && typeof shortShare === 'object' ? shortShare : null}
      onGoHome={() => setView('hub')}
    />
  );
}

function PlannerBApp({ isOwner, userName, seed, sharedPlan, onGoHome }) {
  // Decode the shared plan synchronously (runs before first render, no flash).
  // A short /p/{id} link arrives already fetched as `sharedPlan`. Apps Script
  // serves the payload as window.__RACEPLAN_SHARE__ (from ?s=), since the page
  // runs in a sandboxed iframe where location.hash isn't the real URL.
  // Plain static hosting still uses the #s= hash.
  const [shareData] = React.useState(() => {
    if (sharedPlan) return sharedPlan;
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

  // A Hub handoff may also carry a course (route / GPX) and a race name; a
  // shared link may carry the route too.
  React.useEffect(() => {
    if (seed && seed.course) { p.loadCourse(seed.course); return; }
    if (!seed && shareData && shareData.c) {
      const c = decodeCourse(shareData.c);
      if (c) p.loadCourse(c);
    }
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

  // Interior segment boundaries, for the split markers on the route map —
  // the start and finish are already marked separately, so skip the last row.
  const mapSplits = React.useMemo(
    () => plan.rows.slice(0, -1).map((r) => ({ cumDist: r.cumDist, paceSec: r.paceSec, zone: r.zone })),
    [plan.rows],
  );
  // ── view layout ──────────────────────────────────────────────────────────
  // Wide: plan on one side, a sticky visual column (map / 3D, with the pace
  // chart pinned under it) on the other. Narrow: the same two columns, shown
  // one at a time behind a segmented control. Both columns stay mounted
  // either way, so switching never rebuilds the map or the 3D scene.
  const [visualTab, setVisualTab] = React.useState('map'); // 'map' | '3d'
  const [pane, setPane] = React.useState('plan');          // narrow only: 'plan' | 'visual'
  // The 3D scene is expensive to build and bakes the plan's pacing in at
  // mount, so it is kept alive between visits (suspended while off-screen)
  // and rebuilt only when what it shows has actually gone stale. Adopting the
  // signature on entry — rather than tracking it live — means editing ten
  // splits from the map costs one rebuild on the way back, not ten in the
  // background, and returning to an unchanged plan costs none at all and
  // keeps the camera where it was left.
  // (the signature it adopts is built further down, once the weather and
  // start-time state it depends on exists)
  const [threeDSig, setThreeDSig] = React.useState(null); // null = never opened

  // Breakpoint off the container's own width, not the viewport's — the app
  // also runs inside a narrow embed, and this has to agree with the
  // @container rules in the stylesheet below.
  const rootRef = React.useRef(null);
  const [isWide, setIsWide] = React.useState(false);
  // Layout effect, not a plain one: the pace chart sits in a different column
  // on each side of the breakpoint, so measuring after paint would show it in
  // the wrong one for a frame.
  React.useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const apply = (w) => setIsWide(w >= 1024);
    apply(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => apply(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fileRef = React.useRef(null);
  const trainerRef = React.useRef(null); // focus target for the meta line's pencil
  const [raceName, setRaceName] = React.useState(
    () => (seed && seed.raceName) || shareData?.r || localStorage.getItem('rp-race') || t('planner.defaultRaceName')
  );
  const [trainer, setTrainer] = React.useState(
    () => (seed && seed.trainer) || shareData?.t || localStorage.getItem('rp-trainer')
      || (!isOwner && userName) || t('planner.athleteNamePlaceholder')
  );
  const [toastMsg, setToastMsg] = React.useState('');
  const [toastAction, setToastAction] = React.useState(null);
  const toastTimer = React.useRef(null);
  const hideToast = React.useCallback(() => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastMsg(''); setToastAction(null);
  }, []);
  // `action` ({ label, onClick }) turns the toast into an undo bar, which
  // stays up longer so there's time to reach it.
  const showToast = React.useCallback((msg, action) => {
    setToastMsg(msg);
    setToastAction(action || null);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(hideToast, action ? 6000 : 2600);
  }, [hideToast]);
  React.useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  const [shareOpen, setShareOpen] = React.useState(false);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [pdfBusy, setPdfBusy] = React.useState(false);
  const [videoBusy, setVideoBusy] = React.useState(false);
  const [videoProgress, setVideoProgress] = React.useState(0);
  const videoCancelRef = React.useRef(false);
  const printRef = React.useRef(null);
  const [showElevation, setShowElevation] = React.useState(true);
  const [showMyPlans, setShowMyPlans] = React.useState(false);
  const [goalOpen, setGoalOpen] = React.useState(false);
  const [valueEditor, setValueEditor] = React.useState(null); // { id, type, value }
  const [showNewPlanConfirm, setShowNewPlanConfirm] = React.useState(false);
  const [showResetConfirm, setShowResetConfirm] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [showRouteLib, setShowRouteLib] = React.useState(false);
  const [routeLibInit, setRouteLibInit] = React.useState(null);
  // A Hub handoff whose course came from setup's "my route" GPX upload
  // carries the same { course, gpxText, profileFlat, trackFlat, sourceUrl }
  // shape as a toolbar GPX import, so RouteChip's save/propose-to-library
  // button appears here too instead of only after a same-session re-import.
  const [lastRoute, setLastRoute] = React.useState(() => (seed && seed.lastRoute) || null);
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
  // Per-segment head/tail/crosswind, relative to the net direction each
  // segment of the route actually moves — table-row companion to the 3D
  // view's live wind badge (route3d.jsx), null below a light-breeze forecast.
  const segWind = React.useMemo(
    () => computeSegmentWind(p.course?.track ?? null, plan.rows, weather?.windDir, weather?.windSpeed),
    [p.course, plan.rows, weather?.windDir, weather?.windSpeed],
  );

  // What the 3D scene bakes in at mount. It is adopted on entry to the 3D tab
  // rather than tracked live, so editing ten splits from the map costs one
  // rebuild on the way back instead of ten in the background, and returning to
  // an unchanged plan costs none and keeps the camera where it was left.
  const planSig = React.useMemo(
    () => [
      plan.rows.map((r) => r.cumDist.toFixed(2) + ':' + r.paceSec).join('|'),
      p.course?.source || p.course?.name || '', raceTime, weather?.temp ?? '',
    ].join('~'),
    [plan.rows, p.course, raceTime, weather],
  );
  React.useEffect(() => {
    if (visualTab === '3d') setThreeDSig(planSig);
    // planSig is read on entry only — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visualTab]);

  React.useEffect(() => { localStorage.setItem('rp-race', raceName); }, [raceName]);
  React.useEffect(() => { localStorage.setItem('rp-trainer', trainer); }, [trainer]);
  React.useEffect(() => { localStorage.setItem(LS_RACE_DATE, raceDate); }, [raceDate]);
  React.useEffect(() => { localStorage.setItem(LS_RACE_TIME, raceTime); }, [raceTime]);

  React.useEffect(() => {
    // Older saved plans can carry a course with a full GPS track (so the map
    // still renders) but no lat/lon fields of their own, from before those
    // were reliably stored — fall back to the track's first point rather
    // than silently showing no weather at all.
    const trackStart = p.course?.track?.[0];
    const lat = p.course?.lat ?? (trackStart ? trackStart[0] : null);
    const lon = p.course?.lon ?? (trackStart ? trackStart[1] : null);
    if (!lat || !lon || !raceDate) {
      setWeather(null);
      setWeatherStatus('idle');
      return;
    }
    let cancelled = false;
    setWeatherStatus('loading');
    setWeather(null);
    const hour = raceTime
      ? Math.min(23, Math.round(parseInt(raceTime.split(':')[0], 10) + parseInt(raceTime.split(':')[1] || '0', 10) / 60))
      : 7;
    const daysOut = Math.round((new Date(raceDate + 'T00:00:00') - new Date(new Date().toDateString())) / 86400000);

    // Within Open-Meteo's live forecast window: real forecast for that hour.
    const loadForecast = () => {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&hourly=temperature_2m,relative_humidity_2m,apparent_temperature,windspeed_10m,winddirection_10m,precipitation_probability,weathercode` +
        `&timezone=auto&start_date=${raceDate}&end_date=${raceDate}`;
      return fetch(url).then((r) => r.json()).then((data) => {
        const h = data.hourly;
        if (!h || !isFinite(h.temperature_2m?.[hour])) return null;
        return {
          source: 'forecast',
          temp: Math.round(h.temperature_2m[hour]),
          humidityPct: Math.round(h.relative_humidity_2m[hour]),
          feelsLike: Math.round(h.apparent_temperature[hour]),
          windSpeed: Math.round(h.windspeed_10m[hour]),
          windDir: Math.round(h.winddirection_10m[hour]),
          precipProb: h.precipitation_probability?.[hour] ?? 0,
          code: h.weathercode[hour],
        };
      });
    };

    // Race is further out than the forecast horizon: average the same
    // calendar date over the last few years as a "typical conditions"
    // estimate (clearly labelled — not a live forecast).
    const loadHistoricalAverage = () => {
      const [, mm, dd] = raceDate.split('-');
      const thisYear = new Date().getFullYear();
      const years = [1, 2, 3].map((n) => thisYear - n);
      return Promise.all(years.map((y) => {
        const d = `${y}-${mm}-${dd}`;
        const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
          `&hourly=temperature_2m,relative_humidity_2m&timezone=auto&start_date=${d}&end_date=${d}`;
        return fetch(url).then((r) => r.json()).then((data) => {
          const h = data.hourly;
          if (!h || !isFinite(h.temperature_2m?.[hour])) return null;
          return { temp: h.temperature_2m[hour], humidityPct: h.relative_humidity_2m[hour] };
        }).catch(() => null);
      })).then((rows) => {
        const ok = rows.filter(Boolean);
        if (!ok.length) return null;
        return {
          source: 'historical-avg',
          temp: Math.round(ok.reduce((a, r) => a + r.temp, 0) / ok.length),
          humidityPct: Math.round(ok.reduce((a, r) => a + r.humidityPct, 0) / ok.length),
        };
      });
    };

    // Open-Meteo's live forecast only covers a window around today (roughly
    // the last ~90 days through the next ~15) — a race date that's already
    // passed (very common when resuming an older plan) falls outside it just
    // like one too far in the future, and the API 400s. Route both cases to
    // the historical-average fallback instead of silently ending up with no
    // weather at all.
    const load = (daysOut >= 0 && daysOut <= 15) ? loadForecast : loadHistoricalAverage;
    load()
      .then((w) => {
        if (cancelled) return;
        if (!w) { setWeatherStatus('idle'); return; }
        setWeather(w);
        setWeatherStatus('ok');
      })
      .catch(() => { if (!cancelled) setWeatherStatus('idle'); });
    return () => { cancelled = true; };
  }, [p.course?.lat, p.course?.lon, p.course?.track, raceDate, raceTime]);

  // The heat model's "effort mode" expects an ideal-conditions pace as input.
  // Freeze that baseline in state the moment a fresh weather reading arrives
  // (not on every render) — otherwise, after the user applies the
  // suggestion, the plan's average pace already includes the heat penalty,
  // and re-running the same transform on it would double-count the
  // slowdown. This must be React state (not a ref): a ref mutation doesn't
  // itself trigger the re-render that lets the memo below pick it up.
  const [heatBaselinePace, setHeatBaselinePace] = React.useState(null);
  const [heatApplied, setHeatApplied] = React.useState(false);
  React.useEffect(() => {
    setHeatBaselinePace(weather ? plan.avgPace : null);
    setHeatApplied(false);
    // plan.avgPace intentionally excluded — this should only re-arm on a new
    // weather reading (new course/date/time), not on every plan edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weather]);

  // Heat/humidity pace impact vs. that frozen baseline (see docs/HEAT.md).
  // null when there's nothing useful to show (no weather yet, already
  // applied for this reading, or conditions are in the "no adjustment" band).
  const heatAdvisory = React.useMemo(() => {
    if (!RP_HEAT || !weather || heatApplied) return null;
    if (!isFinite(weather.temp) || !isFinite(weather.humidityPct)) return null;
    if (!(heatBaselinePace > 0) || !(plan.totalDist > 0)) return null;
    const deltaSec = RP_HEAT.paceDeltaSec(heatBaselinePace, weather.temp, weather.humidityPct);
    if (deltaSec < 1) return null; // negligible — don't bother the user
    const adjustedGoalSec = Math.round((heatBaselinePace + deltaSec) * plan.totalDist);
    return {
      deltaSecPerKm: deltaSec,
      adjustedGoalSec,
      warnings: RP_HEAT.warnings(weather.temp, weather.humidityPct),
    };
  }, [weather, heatApplied, heatBaselinePace, plan.totalDist]);

  const applyHeatAdjustment = () => {
    if (!heatAdvisory) return;
    p.replaceSegments(scalePlanToGoal(p.segments, heatAdvisory.adjustedGoalSec));
    setHeatApplied(true);
    showToast(t('heat.applied'));
  };

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
        // shared library via RouteChip's "שמור בספרייה".
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
    const encoded = encodePlan(raceName, trainer, p.activePreset, p.segments, p.course);
    const base = (typeof window !== 'undefined' && window.__RACEPLAN_EXEC_URL__) || '';
    return base
      ? base + (base.indexOf('?') === -1 ? '?' : '&') + 's=' + encoded
      : location.href.split('#')[0] + '#s=' + encoded;
  };

  // Short link: the payload is stored as shares/{id} and the link is /p/{id}.
  // It's created as soon as the share sheet opens, so by the time "share link"
  // is tapped the URL is usually ready (navigator.share needs the tap's user
  // activation, which a slow await could outlive). One doc per distinct plan.
  const shortLinks = React.useRef(new Map()); // payload JSON → Promise<url | ''>
  const shortShareUrl = () => {
    if (!RP_FB || !RP_FB.shareCreate || window.__RACEPLAN_EXEC_URL__) return Promise.resolve('');
    const json = JSON.stringify(sharePayload(raceName, trainer, p.activePreset, p.segments, p.course));
    let pr = shortLinks.current.get(json);
    if (!pr) {
      pr = RP_FB.shareCreate(json)
        .then((id) => (id ? location.origin + '/p/' + id : ''))
        .catch(() => '');
      pr.then((u) => { if (!u) shortLinks.current.delete(json); });
      shortLinks.current.set(json, pr);
    }
    return pr;
  };
  React.useEffect(() => { if (shareOpen) shortShareUrl(); }, [shareOpen]);

  const pdfFilename = () =>
    (raceName || 'race-plan').replace(/[\/\\:*?"<>|]+/g, '').trim().slice(0, 60) + '.pdf';

  const doShareLink = async () => {
    setShareOpen(false);
    // Wait briefly for the short link; fall back to the self-contained #s= link.
    const short = await Promise.race([
      shortShareUrl(),
      new Promise((res) => setTimeout(() => res(''), 4000)),
    ]);
    const url = short || buildShareUrl();
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

  const doShareVideo = async () => {
    if (!SHARE_VIDEO_ENABLED || !window.RP_VIDEO_SHARE || !p.course?.track || p.course.track.length < 2) { setShareOpen(false); return; }
    setShareOpen(false);
    videoCancelRef.current = false;
    setVideoBusy(true); setVideoProgress(0);
    try {
      const r = await window.RP_VIDEO_SHARE.shareRouteClip(
        { track: p.course.track, profile: p.course.profile, rows: plan.rows, totalDist: plan.totalDist,
          weather, raceTime, raceName },
        pdfFilename().replace(/\.pdf$/, ''),
        raceName || t('pdf.defaultTitle'),
        { onProgress: (f) => setVideoProgress(f), isCancelled: () => videoCancelRef.current },
      );
      if (r === 'downloaded') showToast(t('planner.videoDownloaded'));
    } catch (e) {
      console.error('shareRouteClip failed:', e);
      showToast(t('planner.videoFailed'));
    } finally {
      setVideoBusy(false);
    }
  };

  const doPrint = () => { setShareOpen(false); setTimeout(() => window.print(), 60); };

  // Deleting a segment is one tap, so it's undoable instead of confirmed. With
  // the course distance locked the tail absorbs the deleted kilometres at its
  // own pace, which moves the finish time — the toast says so rather than
  // letting the goal drift silently.
  const removeSegmentWithUndo = (id) => {
    const before = p.segments;
    const idx = before.findIndex((s) => s.id === id);
    if (idx < 0 || before.length < 2) return;
    p.removeSegment(id);
    const after = window.computePlan(
      window.settleRemainder(before.filter((s) => s.id !== id), p.lockTarget));
    showToast(t('planner.segmentDeleted', { n: idx + 1, time: formatClock(after.totalTime) }), {
      label: t('common.undo'),
      onClick: () => { p.restoreSegments(before); hideToast(); },
    });
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

  // Runner: one-click save of the current plan into "my plans" — no naming
  // sheet, mirroring the owner's one-click "Save to athlete" button. Uses
  // MyPlansDB.save's own auto-naming (race name + timestamp) when no name is
  // given; the fuller sheet (rename/manage/reload) stays available separately.
  const saveMyPlan = () => {
    if (!MyPlansDB) return;
    MyPlansDB.save({
      raceName, raceDate, raceTime, trainer,
      segments: p.segments, preset: p.activePreset, course: p.course,
    });
    showToast(t('planner.planSaved'));
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

  // Total-distance lock, shown on the totals strip beside the distance. Locked,
  // reshaping segments moves kilometres around inside the course instead of
  // lengthening or shortening the race.
  const distLock = p.lockable ? (
    <button
      onClick={() => p.setTotalLock(!p.totalLocked)}
      title={p.totalLocked
        ? t('planner.totalLockedHint', { dist: U ? U.fmtDist(p.lockTarget) : formatKm(p.lockTarget) })
        : t('planner.totalUnlockedHint', { dist: U ? U.fmtDist(round2(p.course.dist)) : formatKm(p.course.dist) })}
      aria-pressed={p.totalLocked}
      style={{
        appearance: 'none', background: 'transparent', border: 'none', padding: 2,
        cursor: 'pointer', lineHeight: 1, fontSize: 13,
        opacity: p.totalLocked ? 1 : 0.4, filter: p.totalLocked ? 'none' : 'grayscale(1)',
      }}
    >{p.totalLocked ? '🔒' : '🔓'}</button>
  ) : null;

  const hasRoute = !!(p.course && p.course.track && p.course.track.length > 1);

  // The pace chart is the live feedback for editing splits, so it never sits
  // behind a tab: pinned under the visual column where there's room for two,
  // at the foot of the plan column otherwise.
  const chartCard = (
    <div className="rp-card rp-chart-card">
      <div className="rp-card-head">
        <div className="rp-card-title">
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
              fontSize: 11.5, fontWeight: 600, minHeight: 32, flex: '0 0 auto',
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
        variant="area" colors={themeB}
        height={isWide && hasRoute ? 180 : (canEditBoundaries ? 210 : 185)}
        elevationProfile={p.course?.profile ?? null}
        showElevation={showElevation}
        interactive={canEditBoundaries}
        segments={p.segments}
        extrema={courseExtrema}
        onSegmentsChange={p.replaceSegments} />
    </div>
  );

  const visualTabs = [
    ['map', t('view.map'), (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m9 3-6 3v15l6-3 6 3 6-3V3l-6 3Z" /><path d="M9 3v15M15 6v15" />
      </svg>
    )],
    ...(Route3DView ? [['3d', t('chart.view3d'), (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2l9 4.9v10.2L12 22l-9-4.9V6.9L12 2z" /><path d="M12 22V12M21 6.9L12 12 3 6.9" />
      </svg>
    )]] : []),
  ];

  return (
    <div className="rp-cq" ref={rootRef} style={varsB}>
      {/* Desktop density; narrow widths get comfortable sizing + a reachable
          bottom action bar. Container-queries so it also adapts inside a
          narrow embed (Apps Script iframe), not only a small viewport. */}
      <style>{`
        .rpt-seg { padding: 6px 12px; }
        .rpt-head { padding: 0 12px 8px; }
        .rpt-total { padding: 11px 12px; margin-top: var(--rp-s-8); }
        .rp-toolbar { flex-wrap: wrap; justify-content: center; }

        /* ── plan / visual layout ──
           One column of cards by default. With a route loaded there is a
           second, visual column (map · 3D, pace chart pinned beneath): side by
           side when the container is wide enough for both, otherwise the same
           two columns shown one at a time behind the segmented control. Both
           stay mounted either way — switching must never rebuild the Leaflet
           map or the three.js scene. */
        .rp-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px;
          align-items: start; }
        .rp-plan-col, .rp-visual-col { min-width: 0; }
        .rp-visual-col { display: flex; flex-direction: column; gap: 10px; }
        .rp-visual-body { position: relative; flex: 1; min-height: 240px;
          border-radius: var(--rp-r-12); overflow: hidden; }
        .rp-visual-pane { position: absolute; inset: 0; opacity: 0; visibility: hidden;
          transition: opacity var(--rp-t-panel); }
        .rp-visual-pane[data-active="true"] { opacity: 1; visibility: visible; }
        .rp-card { background: var(--rp-surface); border: 1px solid var(--rp-line);
          border-radius: var(--rp-r-14); padding: 12px 14px 14px; }
        .rp-card-head { display: flex; align-items: center; justify-content: space-between;
          gap: 8px; margin-bottom: 8px; }
        .rp-card-title { font-size: 13px; font-weight: 700; color: var(--rp-text-soft); min-width: 0; }
        .rp-viewswitch { display: none; }
        .rp-tabs { display: flex; gap: 4px; flex: 0 0 auto; }
        .rp-tab { appearance: none; font: inherit; display: inline-flex; align-items: center; gap: 5px;
          padding: 6px 11px; border-radius: 999px; cursor: pointer; white-space: nowrap;
          font-size: 12px; font-weight: 700; min-height: 32px;
          border: 1px solid var(--rp-line); background: var(--rp-surface-2); color: var(--rp-text-dim);
          transition: color var(--rp-t-fast), border-color var(--rp-t-fast), background var(--rp-t-fast); }
        .rp-tab:hover { color: var(--rp-text); border-color: var(--rp-gold-line); }
        .rp-tab[aria-selected="true"] { background: var(--rp-gold); border-color: var(--rp-gold);
          color: var(--rp-on-gold); }

        @container (min-width: 1024px) {
          .rp-has-route .rp-layout { grid-template-columns: minmax(0, 1fr) minmax(0, 1.08fr); }
          /* The visual column rides the page scroll instead of running off the
             bottom of it, so a split edited at the foot of the plan is still
             visible on the map. */
          .rp-has-route .rp-visual-col { position: sticky; top: 12px;
            height: calc(100dvh - 24px); }
        }
        @container (max-width: 1023px) {
          .rp-has-route .rp-viewswitch { display: flex; flex: 0 0 auto; }
          .rp-has-route [data-pane][data-active="false"] { display: none; }
          /* The visual pane should end exactly at the bottom of the screen.
             Rather than subtract a guessed switcher-plus-padding figure from
             100dvh — which is wrong at every width where the wrap's own
             padding differs — make the wrap a full-height column and let the
             layout row take whatever the switcher leaves.
             Scoped to the visual pane on purpose: in the plan view this same
             row holds the segment list and the sticky action bar, and neither
             wants its height decided by anything but its own content. */
          .rp-pane-visual { box-sizing: border-box; min-height: 100dvh;
            display: flex; flex-direction: column; }
          .rp-pane-visual .rp-layout { flex: 1 0 auto;
            align-content: stretch; align-items: stretch; }
          .rp-pane-visual .rp-visual-col { min-height: 0; }
          /* the switcher above already picks map vs 3D — don't say it twice */
          .rp-has-route .rp-visual-col .rp-tabs { display: none; }
          .rp-has-route [data-pane][data-active="true"] { animation: rp-pane-in var(--rp-t-panel); }
        }
        @keyframes rp-pane-in {
          from { opacity: 0; transform: translateY(7px); }
          to { opacity: 1; transform: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .rp-visual-pane { transition: none; }
          .rp-has-route [data-pane][data-active="true"] { animation: none; }
        }
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
          /* Segment row padding for phones: tighter than the desktop rule
             above (padding: 6px 12px) so more splits fit on screen at once —
             this rule must come after that one in the same <style> tag to
             win the cascade on equal specificity. */
          .rpt-seg { padding: 4px 12px; }
          /* sticky (not fixed): container-type on .rp-cq would re-anchor a
             fixed child to the container, defeating the pin */
          .rp-toolbar { position: sticky; bottom: 8px; z-index: 40;
            background: var(--rp-surface);
            background: color-mix(in srgb, var(--rp-surface) 92%, transparent);
            backdrop-filter: blur(8px);
            border: 1px solid var(--rp-line); border-radius: var(--rp-r-12);
            padding: 5px !important; margin: 3px 0 8px !important; gap: 4px !important;
            box-shadow: 0 8px 24px rgba(0,0,0,.45);
            flex-wrap: wrap; justify-content: center; }
          /* Save · share · more is two or three buttons, so the sticky bar is
             one row at any phone width and keeps its labels — the icon-only
             treatment this replaces existed only to squeeze nine of them in. */
          .rp-toolbar .rp-btn { flex: 0 0 auto; padding: 7px 11px !important; font-size: 12px !important; }
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

      <div className={'rp-planner-wrap'
        + (hasRoute ? ' rp-has-route' : '')
        // Only meaningful narrow (the stylesheet scopes it), where it makes
        // the wrap a full-height column so the map/3D pane ends at the
        // bottom edge of the screen instead of at a guessed offset.
        + (hasRoute && pane === 'visual' ? ' rp-pane-visual' : '')}
        style={{ maxWidth: hasRoute ? 1480 : 1180, margin: '0 auto', padding: '16px var(--rp-pad) 24px' }}>

        {/* app bar — the way back to the Hub and to language/units used to be
            buried in the ⋯ menu (Home) or missing from the planner (Settings) */}
        <div className="rp-appbar" style={{ display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
          {onGoHome ? (
            <button className="rp-btn" onClick={onGoHome}
              style={{ padding: '7px 12px', fontSize: 13, minHeight: 36 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></svg>
              {t('planner.home')}
            </button>
          ) : <span />}
          <button onClick={() => setSettingsOpen(true)} aria-label={t('settings.title')}
            style={{ width: 36, height: 36, borderRadius: 999, cursor: 'pointer', flex: '0 0 auto',
              background: 'var(--rp-surface)', border: '1px solid var(--rp-line)', color: 'var(--rp-text-dim)',
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <GearIcon />
          </button>
        </div>
        {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}

        {/* Narrow widths: one control for the whole app — which of the two
            columns is on screen. Wide widths show both, so it's hidden. */}
        {hasRoute && (
          <div className="rp-viewswitch" role="tablist"
            style={{
              position: 'sticky', top: 0, zIndex: 45, gap: 4, marginBottom: 10,
              padding: 4, borderRadius: 999, justifyContent: 'center',
              background: 'color-mix(in srgb, var(--rp-surface) 92%, transparent)',
              backdropFilter: 'blur(8px)', border: '1px solid var(--rp-line)',
            }}>
            <button className="rp-tab" role="tab" aria-selected={pane === 'plan'}
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => setPane('plan')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 5h16M4 12h16M4 19h10" />
              </svg>
              {t('view.plan')}
            </button>
            {visualTabs.map(([id, label, icon]) => (
              <button key={id} className="rp-tab" role="tab"
                aria-selected={pane === 'visual' && visualTab === id}
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => { setPane('visual'); setVisualTab(id); }}>
                {icon}{label}
              </button>
            ))}
          </div>
        )}

        <div className="rp-layout">
        <div className="rp-plan-col" data-pane="plan" data-active={pane === 'plan' ? 'true' : 'false'}>

        {p.course && (
          <RouteChip
            course={p.course}
            ownerMode={isOwner}
            onClear={() => {
              const prevCourse = p.course; const prevRoute = lastRoute;
              p.clearCourse(); setLastRoute(null);
              showToast(t('planner.routeRemoved'), {
                label: t('common.undo'),
                onClick: () => { p.loadCourse(prevCourse); setLastRoute(prevRoute); hideToast(); },
              });
            }}
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
          {/* identity — name, then one plain meta line (date · time · trainer)
              instead of three separate pill chips. Each field still opens
              exactly the picker/edit it always did; the trailing pencil is
              purely an edit affordance now that the line has no chip
              borders of its own to signal "tap me". */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--rp-font-ui)', fontSize: 'clamp(19px, 4.6vw, 25px)',
                fontWeight: 800, lineHeight: 1.15, color: 'var(--rp-text)' }}>
                <EditableText value={raceName} onChange={setRaceName} placeholder={t('planner.raceNamePlaceholder')} />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px 5px',
                marginTop: 4, fontSize: 12, color: 'var(--rp-text-dim)' }}>
                <MetaPicker type="date" value={raceDate} onChange={setRaceDate}
                  label={t('planner.raceDate')} />
                <span aria-hidden="true">·</span>
                <MetaPicker type="time" value={raceTime} onChange={setRaceTime}
                  label={t('planner.startTime')} />
                <span aria-hidden="true">·</span>
                <EditableText value={trainer} onChange={handleTrainerChange} placeholder={t('planner.athleteNamePlaceholder')}
                  editRef={trainerRef} style={{ color: 'var(--rp-text-soft)', fontSize: 12 }} />
                {/* the pencil sits after the name, so it edits the name (it used to open the date) */}
                <button type="button" aria-label={t('planner.athleteNamePlaceholder')}
                  onClick={() => {
                    const el = trainerRef.current;
                    if (!el) return;
                    el.focus();
                    const r = document.createRange(); r.selectNodeContents(el);
                    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
                  }}
                  style={{ flex: '0 0 auto', background: 'transparent', border: 'none', padding: '8px 6px',
                    margin: '-8px -4px', color: 'var(--rp-text-dim)', opacity: .55, cursor: 'pointer',
                    display: 'flex', alignItems: 'center' }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                </button>
              </div>
            </div>
            <div style={{ flex: '0 0 auto', width: 36, height: 36, borderRadius: 10, overflow: 'hidden' }}>
              <img src={(typeof window !== 'undefined' && window.__RACEPLAN_LOGO__) || 'LogoV2.png'}
                alt="RACE PLAN" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
            </div>
          </div>

          {/* hero: the goal clock (tap to set a goal — rescales) and the core
              stats now sit side by side instead of stacked as two separate
              full-width blocks — same information, roughly half the height. */}
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 10, marginTop: 12 }}>
            <div style={{ flex: '0 0 42%', minWidth: 0 }}>
              <ClockDisplay totalSec={plan.totalTime} digitH={28} onClick={() => setGoalOpen(true)}
                caption={t('planner.computedTapForGoal')} />
            </div>
            <div style={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {[
                [U ? U.dispDistNum(plan.totalDist) : formatKm(plan.totalDist), U ? U.distUnit() : t('units.km'), distLock, false],
                [U ? U.fmtPace(plan.avgPace) : formatPace(plan.avgPace), t('planner.pacePerUnit', { unit: U ? U.distUnit() : t('units.km') }), null, false],
                ...(p.course && p.course.gain != null
                  ? [['+' + (U ? U.elevInt(p.course.gain) : p.course.gain), U && U.imperial ? t('units.climbFt') : t('units.climb'), null, true]]
                  : []),
              ].map(([v, k, extra, full], i) => (
                <div key={i} style={{ gridColumn: full ? '1 / -1' : undefined,
                  background: 'var(--rp-surface)', border: '1px solid var(--rp-line)', borderRadius: 10,
                  padding: '7px 8px', textAlign: 'center' }}>
                  <div style={{ fontFamily: 'var(--rp-font-display)', fontWeight: 800, fontSize: 15,
                    fontVariantNumeric: 'tabular-nums', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {/* ltr so a leading sign stays in front: "+141", not "141+" */}
                    <span dir="ltr">{v}</span>{extra}
                  </div>
                  <div style={{ fontSize: 9.5, color: 'var(--rp-text-dim)', marginTop: 2 }}>{k}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--rp-line)', margin: '12px -15px 12px' }} />

          <SegmentsTable plan={plan} colors={themeB} stepperKind="pill"
            paceStep={1} distStep={0.01}
            onStepDist={p.stepDistance} onSetDist={p.setSegmentDistance}
            onStepPace={p.stepPace} onSetPace={p.setSegmentPace} onRemove={removeSegmentWithUndo}
            onEditValue={ValueEditor ? (id, ty, v) => setValueEditor({
              id, type: ty,
              value: U ? (ty === 'pace' ? U.dispPaceSec(v) : U.dispDist(v)) : v,
            }) : null}
            elevations={segElevs} windRel={segWind} totalLocked={p.totalLocked} />

          <button className="rp-btn" onClick={p.addSegment}
            style={{ marginTop: 10, width: '100%', justifyContent: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            {t('planner.addSegment')}
          </button>
        </div>

        <ConditionsBar weather={weather} status={weatherStatus}
          advisory={heatAdvisory} onApply={applyHeatAdjustment} />

        {/* Actions. Two that carry the plan forward stay on the bar; the rest
            — import, libraries, navigation, reset — are one tap deeper, so
            this stops being a wall of nine buttons wedged between the splits
            and the chart. */}
        <div className="rp-toolbar" style={{ display: 'flex', gap: 8, flexWrap: 'wrap',
          justifyContent: 'center', marginBottom: 12 }}>
          <input ref={fileRef} type="file" accept=".gpx,application/gpx+xml,text/xml" onChange={onGpx} style={{ display: 'none' }} />

          {MyPlansDB && RP_FB && !isOwner && (
            <button className="rp-btn" onClick={saveMyPlan}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
              {t('planner.savePlan')}
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

          <button className="rp-btn rp-btn-primary" disabled={pdfBusy} onClick={() => setShareOpen(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
            {t('planner.share')}
          </button>

          <button className="rp-btn" aria-label={t('planner.more')} style={{ position: 'relative' }}
            onClick={() => setMoreOpen(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
            </svg>
            {pendingSubs > 0 && (
              <span aria-label={t('planner.pendingSubs', { n: pendingSubs })} style={{
                position: 'absolute', top: -5, insetInlineStart: -5,
                minWidth: 15, height: 15, padding: '0 4px', borderRadius: 999,
                background: 'var(--rp-gold)', color: '#12172b', fontSize: 9.5, fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
              }}>{pendingSubs}</span>
            )}
          </button>
        </div>

        {(!isWide || !hasRoute) && <div style={{ marginTop: 12 }}>{chartCard}</div>}

        </div>{/* ── end plan column ── */}

        {hasRoute && (
          <div className="rp-visual-col" data-pane="visual" data-active={pane === 'visual' ? 'true' : 'false'}>
            <div className="rp-card-head" style={{ marginBottom: 0 }}>
              <div className="rp-tabs" role="tablist" aria-label={t('chart.mapTitle')}>
                {visualTabs.map(([id, label, icon]) => (
                  <button key={id} className="rp-tab" role="tab" aria-selected={visualTab === id}
                    onClick={() => setVisualTab(id)}>{icon}{label}</button>
                ))}
              </div>
              {p.course.profile && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11,
                  color: 'var(--rp-text-dim)', flex: '0 0 auto' }}>
                  <span style={{ width: 24, height: 5, borderRadius: 3,
                    background: 'linear-gradient(90deg,#7C9BD6,#9BA0B7,#C36079)' }} />
                  <span>{t('chart.mapGradeDescent')}</span>
                  <span>·</span>
                  <span>{t('chart.mapGradeClimb')}</span>
                </div>
              )}
            </div>

            {/* Both panes stay mounted; only one is visible. The 3D scene is
                built on first use and then suspended while off-screen, so
                coming back to it keeps the camera and the scrub position. */}
            <div className="rp-visual-body">
              <div className="rp-visual-pane" data-active={visualTab === 'map' ? 'true' : 'false'}>
                <RouteMap track={p.course.track} profile={p.course.profile}
                  splits={mapSplits} height="100%" />
              </div>
              {Route3DView && threeDSig !== null && (
                <div className="rp-visual-pane" data-active={visualTab === '3d' ? 'true' : 'false'}>
                  <Route3DView key={threeDSig} embedded
                    paused={visualTab !== '3d' || (!isWide && pane !== 'visual')}
                    track={p.course.track} profile={p.course.profile} rows={plan.rows}
                    totalDist={plan.totalDist} raceName={raceName}
                    gain={p.course.gain} loss={p.course.loss}
                    weather={weather} raceTime={raceTime}
                    onClose={() => setVisualTab('map')} />
                </div>
              )}
            </div>

            {mapSplits.length > 0 && <ZoneLegend colors={themeB} dim="var(--rp-text-dim)" />}

            {isWide && chartCard}
          </div>
        )}

        </div>{/* ── end layout grid ── */}
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
        <ConfirmDialog
          title={t('planner.newPlanConfirmTitle')}
          body={t('planner.newPlanConfirmBody')}
          onCancel={() => setShowNewPlanConfirm(false)}
          actions={[
            { label: t('planner.saveAndStart'), primary: true, onClick: () => startNewPlan(true) },
            { label: t('planner.startWithoutSaving'), onClick: () => startNewPlan(false) },
          ]}
        />
      )}

      {showResetConfirm && (
        <ConfirmDialog
          title={t('planner.resetConfirmTitle')}
          body={t('planner.resetConfirmBody')}
          onCancel={() => setShowResetConfirm(false)}
          actions={[{ label: t('planner.resetConfirm'), danger: true,
            onClick: () => { setShowResetConfirm(false); onReset(); } }]}
        />
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

      {ActionSheet && moreOpen && (
        <ActionSheet
          title={t('planner.more')}
          onClose={() => setMoreOpen(false)}
          items={[
            {
              label: t('setup.importGpx'),
              onClick: () => { setMoreOpen(false); if (fileRef.current) fileRef.current.click(); },
              icon: (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></svg>
              ),
            },
            isOwner && RouteLibrary && RP_FB && {
              label: t('setup.routeLibrary'),
              hint: pendingSubs > 0 ? String(pendingSubs) : undefined,
              onClick: () => { setMoreOpen(false); setRouteLibInit(null); setShowRouteLib(true); },
              icon: (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3Z" /><path d="M9 3v15M15 6v15" /></svg>
              ),
            },
            !isOwner && MyPlansPanel && RP_FB && {
              label: t('hub.myPlans'),
              onClick: () => { setMoreOpen(false); setShowMyPlans(true); },
              icon: (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
              ),
            },
            !isOwner && MyPlansDB && RP_FB && {
              label: t('planner.newPlan'),
              onClick: () => { setMoreOpen(false); setShowNewPlanConfirm(true); },
              icon: (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              ),
            },
            {
              label: t('planner.reset'), danger: true,
              onClick: () => { setMoreOpen(false); setShowResetConfirm(true); },
              icon: (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
              ),
            },
          ].filter(Boolean)}
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
            SHARE_VIDEO_ENABLED && {
              label: videoBusy ? t('planner.generatingVideo') : t('planner.shareVideo'),
              disabled: videoBusy || !p.course?.track || p.course.track.length < 2,
              onClick: doShareVideo,
              icon: (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="5" width="14" height="14" rx="2" /><path d="m16 10 6-4v12l-6-4" />
                </svg>
              ),
            },
          ].filter(Boolean)}
        />
      )}

      {SHARE_VIDEO_ENABLED && videoBusy && window.ShareVideoProgress && (
        <window.ShareVideoProgress progress={videoProgress} onCancel={() => { videoCancelRef.current = true; }} />
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
            else {
              // Under the lock a segment can't grow past what's left for the
              // remainder — say so rather than silently clamping.
              const cap = window.lockedSegmentMax(p.segments, valueEditor.id, p.totalLocked ? p.lockTarget : 0);
              p.setSegmentDistance(valueEditor.id, si);
              if (cap > 0 && si > cap + 0.005) {
                showToast(t('planner.distClamped', { dist: U ? U.fmtDist(cap) : formatKm(cap) }));
              }
            }
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

      <CopyToast show={!!toastMsg} text={toastMsg} action={toastAction} />
    </div>
  );
}

window.PlannerB = PlannerB;
