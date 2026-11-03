// lime.jsx — the pieces only the lime skin adds on top of the planner:
//   TabBar        bottom navigation (home · plan · route · share), phones only
//   RaceDayScreen race-morning mode: countdown to the gun, then elapsed time
//                 with where the plan says you should be
//   raceDayState  pure timing helper the two above (and the auto-open) share
//   NextRaceCard  the Hub's hero: the plan in progress with its clock
// Nothing here changes a calculation: everything reads the plan rows that
// engine.jsx already computes. With the skin off (window.RP_LIME false) none of
// it renders.

const LIME_ON = !!window.RP_LIME;
const tL = (window.I18N && window.I18N.t) || ((k) => k);
const UL = window.UNITS;

// ── timing ─────────────────────────────────────────────────────────────
// raceDate 'YYYY-MM-DD', raceTime 'HH:MM' (local). Returns null when there is
// no date. phase: 'before' | 'running' | 'after'.
function raceStartMs(raceDate, raceTime) {
  if (!raceDate || !/^\d{4}-\d{2}-\d{2}$/.test(raceDate)) return null;
  const [y, m, d] = raceDate.split('-').map(Number);
  const [hh, mm] = /^\d{1,2}:\d{2}$/.test(raceTime || '') ? raceTime.split(':').map(Number) : [7, 0];
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}
function raceDayState(raceDate, raceTime, totalSec, nowMs) {
  const start = raceStartMs(raceDate, raceTime);
  if (start == null) return null;
  const now = nowMs != null ? nowMs : Date.now();
  const end = start + Math.max(0, totalSec || 0) * 1000;
  const phase = now < start ? 'before' : (now < end + 3600e3 ? 'running' : 'after');
  return { start, end, phase, toStartSec: Math.max(0, Math.round((start - now) / 1000)),
    elapsedSec: Math.max(0, Math.round((now - start) / 1000)) };
}
// Local calendar day of a timestamp, 'YYYY-MM-DD'.
function _dayKey(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
// Should race-day mode open by itself? On the race date, from midnight until an
// hour after the planned finish — once per race date (closing it is remembered).
function raceDayAutoOpen(raceDate, raceTime, totalSec, nowMs) {
  const st = raceDayState(raceDate, raceTime, totalSec, nowMs);
  if (!st || st.phase === 'after') return false;
  if (_dayKey(nowMs != null ? nowMs : Date.now()) !== raceDate) return false;
  try { if (localStorage.getItem('rp-raceday-closed') === raceDate) return false; } catch (e) {}
  return true;
}
function daysUntil(raceDate, nowMs) {
  const start = raceStartMs(raceDate, '12:00');
  if (start == null) return null;
  const today = new Date(nowMs != null ? nowMs : Date.now());
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12).getTime();
  return Math.round((start - t0) / 86400e3);
}
// Where the plan puts the runner `sec` seconds after the gun.
function planPosition(rows, sec) {
  if (!rows || !rows.length) return null;
  let prevT = 0; let prevD = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (sec < r.cumTime) {
      const f = r.segTime > 0 ? (sec - prevT) / r.segTime : 0;
      return { index: i, row: r, dist: prevD + f * r.distance, next: rows[i + 1] || null };
    }
    prevT = r.cumTime; prevD = r.cumDist;
  }
  const last = rows[rows.length - 1];
  return { index: rows.length - 1, row: last, dist: last.cumDist, next: null, finished: true };
}

const fmtClockL = (sec) => (window.formatClock ? window.formatClock(sec) : String(sec));
const fmtPaceL = (sec) => (UL ? UL.fmtPace(sec) : (window.formatPace ? window.formatPace(sec) : String(sec)));
const fmtDistL = (km) => (UL ? UL.fmtDist(km) : (Math.round(km * 100) / 100) + ' km');

// ── icons ──────────────────────────────────────────────────────────────
const Ico = {
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  plan: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l3 2M9 2h6" /></>,
  route: <><path d="M4 19c3 0 3-6 6-6s2 4 5 4 3-9 5-11" /><circle cx="4" cy="19" r="1.5" /></>,
  share: <path d="M12 3v12M7 8l5-5 5 5M5 14v6h14v-6" />,
  flag: <><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></>,
};
function Svg({ children, size = 20, sw = 1.9 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
  );
}

// ── bottom tab bar ─────────────────────────────────────────────────────
// items: [{ id, label, icon, onClick, disabled }]; active: id. Fixed to the
// bottom edge on phones; the page reserves --rp-tabbar-h under its content.
function TabBar({ items, active }) {
  return ReactDOM.createPortal((
    <nav className="rp-tabbar" aria-label={tL('tabs.label')}
      style={{ direction: window.I18N ? window.I18N.dir : 'rtl' }}>
      {items.map((it) => (
        <button key={it.id} type="button" className="rp-tab-btn"
          aria-current={active === it.id ? 'page' : undefined}
          disabled={it.disabled} onClick={it.onClick}>
          <Svg>{Ico[it.icon]}</Svg>
          <span>{it.label}</span>
        </button>
      ))}
    </nav>
  ), document.body);
}

if (LIME_ON && !document.getElementById('rp-lime-styles')) {
  const s = document.createElement('style');
  s.id = 'rp-lime-styles';
  s.textContent = `
  .rp-tabbar{position:fixed;left:0;right:0;bottom:0;z-index:900;display:grid;grid-auto-flow:column;grid-auto-columns:1fr;
    height:calc(var(--rp-tabbar-h) + env(safe-area-inset-bottom));padding:6px max(8px,env(safe-area-inset-right)) env(safe-area-inset-bottom) max(8px,env(safe-area-inset-left));
    background:rgba(5,6,5,.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
    border-top:1px solid rgba(221,255,74,.14);font-family:var(--rp-font-ui)}
  .rp-tab-btn{appearance:none;background:none;border:0;cursor:pointer;display:flex;flex-direction:column;align-items:center;
    justify-content:flex-start;gap:3px;padding-top:6px;font:inherit;font-size:10.5px;font-weight:600;color:var(--rp-text-dim);
    position:relative;-webkit-tap-highlight-color:transparent}
  .rp-tab-btn[aria-current="page"]{color:var(--rp-gold);font-weight:800}
  .rp-tab-btn[aria-current="page"]::before{content:"";position:absolute;top:-6px;width:22px;height:2px;border-radius:2px;
    background:var(--rp-gold);box-shadow:0 0 10px var(--rp-lime-glow)}
  .rp-tab-btn:disabled{opacity:.35;cursor:default}
  .rp-tab-btn:active:not(:disabled){transform:scale(.94)}
  /* phones only: wide screens keep the two-column layout and their own bars */
  @media (min-width:1024px){.rp-tabbar{display:none}}
  .rp-has-tabbar{padding-bottom:calc(var(--rp-tabbar-h) + env(safe-area-inset-bottom) + 12px)!important}
  @media (min-width:1024px){.rp-has-tabbar{padding-bottom:24px!important}}
  .rp-segbar{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:3px}
  .rp-segbar i{height:4px;border-radius:2px;background:var(--rp-surface-3)}
  .rp-segbar i.on{background:var(--rp-gold);box-shadow:0 0 8px var(--rp-lime-glow)}
  .rp-segbar i.cur{background:var(--rp-text)}
  `;
  document.head.appendChild(s);
}

// N little bars, one per segment — the same strip on the Hub, the plan and
// race-day mode. `upto`: bars before it are lit, `cur` is the one in progress.
function SegBar({ n, upto, cur, style }) {
  const bars = [];
  for (let i = 0; i < n; i++) {
    const cls = cur === i ? 'cur' : ((upto == null || i < upto) ? 'on' : '');
    bars.push(<i key={i} className={cls} />);
  }
  return <div className="rp-segbar" style={style} aria-hidden="true">{bars}</div>;
}

// ── race-day mode ──────────────────────────────────────────────────────
function RaceDayScreen({ raceName, raceDate, raceTime, rows, totalTime, weather, onClose, onSetDate }) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  // keep the screen on while it's open (where the browser allows it)
  React.useEffect(() => {
    let lock = null; let alive = true;
    const req = () => {
      try {
        if (navigator.wakeLock && document.visibilityState === 'visible') {
          navigator.wakeLock.request('screen').then((l) => { if (alive) lock = l; else l.release(); }).catch(() => {});
        }
      } catch (e) {}
    };
    req();
    document.addEventListener('visibilitychange', req);
    return () => { alive = false; document.removeEventListener('visibilitychange', req); try { if (lock) lock.release(); } catch (e) {} };
  }, []);
  if (window.useEscape) window.useEscape(onClose);

  const st = raceDayState(raceDate, raceTime, totalTime, now);
  const phase = st ? st.phase : 'nodate';
  const pos = phase === 'running' ? planPosition(rows, st.elapsedSec) : null;
  const focusRow = pos ? pos.row : (rows[0] || null);
  const ClockDisplay = window.ClockDisplay;
  // More than a day out a countdown in hours is noise: show the planned time,
  // and say how many days are left.
  const farOff = phase === 'before' && st.toStartSec >= 86400;
  const clockSec = phase === 'before' && !farOff ? st.toStartSec : (phase === 'running' ? st.elapsedSec : totalTime);
  const clockLabel = farOff ? tL('hub.daysLeft', { count: daysUntil(raceDate, now) }) + ' · ' + tL('raceday.planned')
    : phase === 'before' ? tL('raceday.toStart')
    : phase === 'running' ? tL('raceday.elapsed') : tL('raceday.planned');
  const startClock = st ? new Date(st.start).toTimeString().slice(0, 5) : null;
  const finishClock = st ? new Date(st.end).toTimeString().slice(0, 5) : null;
  const upcoming = phase === 'running' && pos
    ? rows.slice(pos.index, pos.index + 3)
    : rows.slice(0, 3);

  return ReactDOM.createPortal((
    <div className="rp-cq-scope" role="dialog" aria-modal="true" aria-label={tL('raceday.title')}
      style={{ position: 'fixed', inset: 0, zIndex: 1400, overflowY: 'auto',
        background: 'radial-gradient(90% 50% at 50% 26%, rgba(221,255,74,.12), transparent 70%), #020302',
        color: 'var(--rp-text)', fontFamily: 'var(--rp-font-ui)', direction: window.I18N ? window.I18N.dir : 'rtl',
        padding: 'max(16px, env(safe-area-inset-top)) max(18px, env(safe-area-inset-right)) max(22px, env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-left))' }}>
      <div style={{ maxWidth: 460, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16, minHeight: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span className="rp-pulse" style={{ background: 'var(--rp-gold)', color: 'var(--rp-on-gold)', fontWeight: 900,
            fontSize: 12, borderRadius: 999, padding: '4px 12px' }}>{tL('raceday.title')}</span>
          <button type="button" onClick={onClose} aria-label={tL('common.close')}
            style={{ width: 38, height: 38, borderRadius: 12, border: '1px solid var(--rp-line)', background: 'var(--rp-surface)',
              color: 'var(--rp-text)', fontSize: 16, cursor: 'pointer' }}>✕</button>
        </div>

        <div>
          <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1.1 }}>{raceName}</div>
          {st && (
            <div style={{ fontSize: 12.5, color: 'var(--rp-text-dim)', marginTop: 4 }}>
              {tL('raceday.startFinish', { start: startClock, finish: finishClock })}
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: 12.5, color: 'var(--rp-text-dim)', textAlign: 'center', marginBottom: 6 }}>{clockLabel}</div>
          {ClockDisplay && <ClockDisplay totalSec={clockSec} digitH={46} />}
          {phase === 'running' && pos && (
            <SegBar n={rows.length} upto={pos.index} cur={pos.finished ? null : pos.index} style={{ marginTop: 10 }} />
          )}
        </div>

        {phase === 'nodate' && (
          <div style={{ border: '1px solid var(--rp-warn-line)', background: 'var(--rp-warn-bg)', borderRadius: 14,
            padding: '12px 14px', fontSize: 13.5 }}>
            {tL('raceday.noDate')}
            {onSetDate && (
              <button type="button" className="rp-btn" onClick={onSetDate}
                style={{ marginTop: 10, width: '100%', justifyContent: 'center' }}>{tL('raceday.setDate')}</button>
            )}
          </div>
        )}

        {focusRow && phase !== 'after' && (
          <div style={{ background: 'var(--rp-surface)', border: '1px solid var(--rp-gold-line)', borderRadius: 18,
            padding: '14px 16px', textAlign: 'center', display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 12.5, color: 'var(--rp-text-dim)' }}>
              {phase === 'running' && pos
                ? (pos.finished ? tL('raceday.finishedPlan') : tL('raceday.nowSegment', { n: pos.index + 1 }))
                : tL('raceday.firstSegment')}
            </span>
            <b dir="ltr" style={{ fontSize: 54, fontWeight: 900, color: 'var(--rp-gold)', lineHeight: 1,
              fontVariantNumeric: 'tabular-nums', textShadow: '0 0 24px var(--rp-lime-glow)' }}>{fmtPaceL(focusRow.paceSec)}</b>
            <span style={{ fontSize: 12.5, color: 'var(--rp-text-dim)' }}>
              {tL('planner.pacePerUnit', { unit: UL ? UL.distUnit() : tL('units.km') })} · {tL('raceday.untilKm', { dist: fmtDistL(focusRow.cumDist) })}
              {phase === 'running' && pos && !pos.finished && <> · {tL('raceday.planSays', { dist: fmtDistL(pos.dist) })}</>}
            </span>
            {phase === 'before' && (
              <span style={{ fontSize: 12.5, color: 'var(--rp-text-soft)', marginTop: 4 }}>{tL('raceday.dontRush')}</span>
            )}
          </div>
        )}

        {upcoming.length > 0 && phase !== 'after' && (
          <div style={{ background: 'var(--rp-surface)', border: '1px solid var(--rp-line)', borderRadius: 16, padding: '4px 14px' }}>
            {upcoming.map((r, i) => (
              <div key={r.id || i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                padding: '10px 0', borderBottom: i < upcoming.length - 1 ? '1px solid var(--rp-line)' : 'none' }}>
                <span style={{ fontSize: 13.5 }}>{tL('raceday.untilKm', { dist: fmtDistL(r.cumDist) })}</span>
                <span dir="ltr" style={{ display: 'flex', gap: 14, alignItems: 'baseline', fontVariantNumeric: 'tabular-nums' }}>
                  <b style={{ fontSize: 17, fontWeight: 800 }}>{fmtPaceL(r.paceSec)}</b>
                  <span style={{ fontSize: 12.5, color: 'var(--rp-text-dim)' }}>
                    {st ? new Date(st.start + r.cumTime * 1000).toTimeString().slice(0, 5) : fmtClockL(r.cumTime)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}

        {weather && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, textAlign: 'center' }}>
            {[
              [weather.temp + '°', tL('raceday.tempAtStart')],
              [weather.humidityPct + '%', tL('raceday.humidity')],
              [String(UL ? Math.round(UL.dispSpeed(weather.windSpeed)) : weather.windSpeed), tL('raceday.wind') + ' · ' + (UL ? UL.speedUnit() : tL('units.kmh'))],
            ].map(([v, k], i) => (
              <div key={i} style={{ background: 'var(--rp-surface)', border: '1px solid var(--rp-line)', borderRadius: 14, padding: '9px 6px' }}>
                <b dir="ltr" style={{ fontSize: 17, fontVariantNumeric: 'tabular-nums' }}>{v}</b>
                <div style={{ fontSize: 11, color: 'var(--rp-text-dim)' }}>{k}</div>
              </div>
            ))}
          </div>
        )}

        {phase === 'after' && (
          <div style={{ textAlign: 'center', fontSize: 15, color: 'var(--rp-text-soft)' }}>{tL('raceday.after')}</div>
        )}

        <div style={{ marginTop: 'auto', textAlign: 'center', fontSize: 11.5, color: 'var(--rp-text-dim)' }}>
          {tL('raceday.footer')}
        </div>
      </div>
    </div>
  ), document.body);
}

// ── the Hub's hero: the plan in progress ───────────────────────────────
// resume: { raceName, dist, sec, segs, raceDate, raceTime }
function NextRaceCard({ resume, onOpen, onRaceDay }) {
  const ClockDisplay = window.ClockDisplay;
  const days = resume.raceDate ? daysUntil(resume.raceDate) : null;
  const today = days === 0;
  const pill = days == null ? null
    : today ? tL('raceday.title')
    : days > 0 ? tL('hub.daysLeft', { count: days }) : null;
  let dateText = '';
  if (resume.raceDate) {
    const [y, m, d] = resume.raceDate.split('-').map(Number);
    dateText = window.I18N && window.I18N.fmtDate
      ? window.I18N.fmtDate(new Date(y, m - 1, d), { weekday: 'long', day: 'numeric', month: 'numeric' })
      : resume.raceDate;
    if (resume.raceTime) dateText += ' · ' + resume.raceTime;
  }
  return (
    <div style={{ width: '100%', display: 'grid', gap: 10, padding: 14, borderRadius: 20, textAlign: 'start',
      background: 'linear-gradient(160deg, #151a0e, #070807)', border: '1px solid var(--rp-gold-line)',
      boxShadow: '0 20px 50px rgba(0,0,0,.5)' }}>
      <button type="button" onClick={onOpen} style={{ all: 'unset', cursor: 'pointer', display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 22 }}>
          {pill ? <span className={today ? 'rp-pulse' : undefined} style={{ background: 'var(--rp-gold)', color: 'var(--rp-on-gold)',
            fontSize: 11.5, fontWeight: 800, borderRadius: 999, padding: '2px 10px' }}>{pill}</span> : <span />}
          {dateText && <span style={{ fontSize: 11.5, color: 'var(--rp-text-dim)' }}>{dateText}</span>}
        </div>
        <div>
          <div style={{ fontSize: 21, fontWeight: 900, lineHeight: 1.15, color: 'var(--rp-text)' }}>{resume.raceName}</div>
          <div style={{ fontSize: 12, color: 'var(--rp-text-dim)', marginTop: 2 }}>
            {fmtDistL(resume.dist)} · {tL('hub.segmentsN', { count: resume.segs })}
          </div>
        </div>
        {ClockDisplay && <ClockDisplay totalSec={resume.sec} digitH={30} />}
        <SegBar n={Math.min(resume.segs, 30)} />
      </button>
      {today && onRaceDay && (
        <button type="button" className="rp-btn rp-btn-primary" onClick={onRaceDay}
          style={{ justifyContent: 'center', width: '100%' }}>
          <Svg size={16} sw={2.2}>{Ico.flag}</Svg>{tL('raceday.open')}
        </button>
      )}
    </div>
  );
}

Object.assign(window, { RP_LIME_UI: { TabBar, RaceDayScreen, NextRaceCard, SegBar, raceDayState, raceDayAutoOpen,
  planPosition, daysUntil, raceStartMs } });
