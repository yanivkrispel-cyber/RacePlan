// datepicker.jsx — the app's own date and time pickers (Kris, 4.11.2026: "the calendar in the app's style, premium,
// on every iPhone and Android"). The browser's picker looked like a system dialog in English on a Hebrew lime screen.
//
//   window.RPDatePicker({ value:'YYYY-MM-DD', onChange(iso), onClose, title, min, max, marks:{iso:'race'}, clearable })
//   window.RPTimePicker({ value:'HH:MM', onChange(hhmm), onClose, title, clearable })
//
// Bottom sheets (centred on wide screens), RTL-aware: in Hebrew the week runs from the right, the "previous" arrow
// points right. Weeks start on Sunday (he/en) or Monday (fr/es). A tap picks and closes; the month title opens a
// month-and-year grid for races far away. Swipe sideways to change month.

const DP_I18N = window.I18N;
const dpt = (k, p) => (DP_I18N && DP_I18N.t ? DP_I18N.t(k, p) : k);
const dpLoc = () => (DP_I18N && DP_I18N.locale) || document.documentElement.lang || 'he';
const dpFmt = (d, o) => { try { return new Intl.DateTimeFormat(dpLoc(), o).format(d); } catch (e) { return d.toDateString(); } };
const dpIso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const dpParse = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3], 12) : null; };
const dpRtl = () => (DP_I18N && DP_I18N.dir ? DP_I18N.dir === 'rtl' : document.documentElement.dir === 'rtl');
const dpWeekStart = () => (/^(fr|es)/.test(dpLoc()) ? 1 : 0);
const dpBuzz = () => { try { if (navigator.vibrate) navigator.vibrate(6); } catch (e) {} };

if (!document.getElementById('rp-dp-styles')) {
  const s = document.createElement('style');
  s.id = 'rp-dp-styles';
  s.textContent = `
  .rp-dp-wrap{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;padding:16px;
    background:rgba(0,0,0,.72);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
  .rp-dp{width:100%;max-width:400px;background:var(--rp-surface);border:1px solid var(--rp-line);border-radius:24px;
    box-shadow:var(--rp-shadow-modal);padding:14px 16px 16px;color:var(--rp-text);font-family:var(--rp-font-ui);
    display:flex;flex-direction:column;gap:12px;max-height:94vh;overflow-y:auto}
  :root[data-ui="lime"] .rp-dp{background:linear-gradient(180deg,#13160f,#070807);border-color:rgba(221,255,74,.16)}
  @media (max-width:640px){
    .rp-dp-wrap{align-items:flex-end;padding:0}
    .rp-dp{max-width:none;border-radius:26px 26px 0 0;padding-bottom:calc(18px + env(safe-area-inset-bottom));
      animation:rp-dp-up .26s cubic-bezier(.2,.9,.25,1)}
  }
  @keyframes rp-dp-up{from{transform:translateY(40px);opacity:.4}to{transform:none;opacity:1}}
  .rp-dp-grab{display:block;width:38px;height:4px;border-radius:2px;background:rgba(244,246,238,.25);margin:-4px auto 2px}
  .rp-dp-head{display:flex;align-items:flex-start;gap:10px}
  .rp-dp-head .tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
  .rp-dp-head .lbl{font-size:12px;color:var(--rp-text-dim);font-weight:600}
  .rp-dp-head .big{font-family:var(--rp-font-display);font-size:21px;font-weight:900;line-height:1.2}
  .rp-dp-x{appearance:none;background:none;border:0;color:var(--rp-text-dim);cursor:pointer;width:36px;height:36px;
    border-radius:50%;display:grid;place-items:center;flex:0 0 auto}
  .rp-dp-bar{display:flex;align-items:center;gap:6px}
  .rp-dp-month{appearance:none;background:none;border:0;font:inherit;color:var(--rp-text);cursor:pointer;flex:1;
    text-align:start;font-size:16px;font-weight:800;display:flex;align-items:center;gap:6px;padding:6px 2px}
  .rp-dp-month svg{color:var(--rp-gold);transition:transform .2s}
  .rp-dp-month[aria-expanded="true"] svg{transform:rotate(180deg)}
  .rp-dp-nav{appearance:none;width:38px;height:38px;border-radius:50%;border:1px solid var(--rp-line);background:transparent;
    color:var(--rp-text);display:grid;place-items:center;cursor:pointer}
  .rp-dp-nav:disabled{opacity:.25;cursor:default}
  .rp-dp-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px 0;touch-action:pan-y}
  .rp-dp-wd{text-align:center;font-size:11.5px;font-weight:700;color:var(--rp-text-dim);padding:2px 0 6px}
  .rp-dp-day{appearance:none;background:none;border:0;font:inherit;color:var(--rp-text);cursor:pointer;position:relative;
    aspect-ratio:1;max-height:48px;width:100%;display:grid;place-items:center;font-size:15px;font-weight:600;
    font-variant-numeric:tabular-nums;border-radius:50%;-webkit-tap-highlight-color:transparent}
  .rp-dp-day span{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;transition:background .15s,transform .15s}
  .rp-dp-day:hover:not(:disabled) span{background:rgba(255,255,255,.06)}
  .rp-dp-day:active:not(:disabled) span{transform:scale(.92)}
  .rp-dp-day.today span{box-shadow:inset 0 0 0 1.5px var(--rp-gold-line);color:var(--rp-gold)}
  .rp-dp-day.sel span{background:var(--rp-gold);color:var(--rp-on-gold);font-weight:900;box-shadow:0 0 16px var(--rp-lime-glow, rgba(221,255,74,.35))}
  .rp-dp-day:disabled{color:var(--rp-text-dim);opacity:.32;cursor:default}
  .rp-dp-day.race::after{content:"";position:absolute;bottom:3px;left:50%;width:5px;height:5px;margin-left:-2.5px;border-radius:50%;background:var(--rp-gold)}
  .rp-dp-day.sel.race::after{background:var(--rp-text)}
  .rp-dp-months{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
  .rp-dp-mo{appearance:none;font:inherit;font-size:14px;font-weight:700;cursor:pointer;border-radius:14px;padding:13px 4px;
    border:1px solid var(--rp-line);background:transparent;color:var(--rp-text)}
  .rp-dp-mo[aria-pressed="true"]{background:var(--rp-gold);color:var(--rp-on-gold);border-color:var(--rp-gold)}
  .rp-dp-mo:disabled{opacity:.3;cursor:default}
  .rp-dp-foot{display:flex;gap:8px;align-items:center}
  .rp-dp-chip{appearance:none;font:inherit;font-size:13px;font-weight:700;cursor:pointer;border-radius:999px;padding:8px 14px;min-height:38px;
    border:1px solid var(--rp-gold-line);background:transparent;color:var(--rp-gold)}
  .rp-dp-chip.ghost{border-color:var(--rp-line);color:var(--rp-text-dim)}
  .rp-dp-legend{font-size:11.5px;color:var(--rp-text-dim);display:flex;align-items:center;gap:6px;margin-inline-start:auto}
  .rp-dp-legend i{width:6px;height:6px;border-radius:50%;background:var(--rp-gold);display:inline-block}
  .rp-tp-led{display:flex;align-items:center;justify-content:center;gap:14px;direction:ltr;padding:6px 0}
  .rp-tp-col{display:flex;flex-direction:column;align-items:center;gap:6px}
  .rp-tp-num{font-family:var(--rp-font-mono);font-size:46px;font-weight:700;color:var(--rp-gold);line-height:1;
    font-variant-numeric:tabular-nums;text-shadow:0 0 14px var(--rp-lime-glow, rgba(221,255,74,.35));min-width:2.2ch;text-align:center}
  .rp-tp-colon{font-family:var(--rp-font-mono);font-size:40px;color:var(--rp-gold);opacity:.7;padding-bottom:4px}
  .rp-tp-step{appearance:none;width:48px;height:36px;border-radius:12px;border:1px solid var(--rp-line);background:transparent;
    color:var(--rp-text);display:grid;place-items:center;cursor:pointer}
  .rp-tp-chips{display:flex;flex-wrap:wrap;gap:7px;justify-content:center}
  .rp-tp-chips .rp-dp-chip{border-color:var(--rp-line);color:var(--rp-text);font-family:var(--rp-font-mono);direction:ltr}
  .rp-tp-chips .rp-dp-chip[aria-pressed="true"]{border-color:var(--rp-gold);color:var(--rp-gold);background:var(--rp-gold-wash)}
  .rp-dp-ok{appearance:none;flex:1;border:0;cursor:pointer;font:inherit;font-size:15.5px;font-weight:900;border-radius:16px;
    padding:13px 16px;background:var(--rp-gold);color:var(--rp-on-gold)}
  @media (prefers-reduced-motion:reduce){.rp-dp{animation:none!important}}
  `;
  document.head.appendChild(s);
}

const DpChevron = ({ d }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const DP_LEFT = 'm15 6-6 6 6 6', DP_RIGHT = 'm9 6 6 6-6 6', DP_DOWN = 'm6 9 6 6 6-6', DP_UP = 'm6 15 6-6 6 6';
const DpClose = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"
    aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
);

function DpSheet({ onClose, label, children }) {
  React.useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);
  return ReactDOM.createPortal((
    <div className="rp-dp-wrap rp-cq-scope" role="dialog" aria-modal="true" aria-label={label}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ direction: DP_I18N ? DP_I18N.dir : 'rtl' }}>
      <div className="rp-dp"><i className="rp-dp-grab" aria-hidden="true" />{children}</div>
    </div>
  ), document.body);
}

function RPDatePicker({ value, onChange, onClose, title, min, max, marks, clearable }) {
  const sel = dpParse(value);
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const minD = dpParse(min), maxD = dpParse(max);
  const start = sel || (minD && minD > today ? minD : today);
  const [view, setView] = React.useState({ y: start.getFullYear(), m: start.getMonth() });
  const [months, setMonths] = React.useState(false);
  const [yearV, setYearV] = React.useState(start.getFullYear());
  const rtl = dpRtl();
  const ws = dpWeekStart();
  const isoToday = dpIso(today);

  const monthKey = (y, m) => y * 12 + m;
  const canPrev = !minD || monthKey(view.y, view.m) > monthKey(minD.getFullYear(), minD.getMonth());
  const canNext = !maxD || monthKey(view.y, view.m) < monthKey(maxD.getFullYear(), maxD.getMonth());
  const shift = (d) => {
    if ((d < 0 && !canPrev) || (d > 0 && !canNext)) return;
    const k = monthKey(view.y, view.m) + d; setView({ y: Math.floor(k / 12), m: k % 12 }); dpBuzz();
  };
  const pick = (iso) => { dpBuzz(); onChange(iso); setTimeout(onClose, 160); };
  const off = (d) => (minD && d < minD && dpIso(d) !== dpIso(minD)) || (maxD && d > maxD && dpIso(d) !== dpIso(maxD));

  // the weeks of the month in view
  const first = new Date(view.y, view.m, 1, 12);
  const lead = (first.getDay() - ws + 7) % 7;
  const nDays = new Date(view.y, view.m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= nDays; d++) cells.push(new Date(view.y, view.m, d, 12));
  const wd = [];
  for (let i = 0; i < 7; i++) wd.push(dpFmt(new Date(2026, 10, 1 + ((ws + i) % 7), 12), { weekday: 'narrow' })); // 1.11.2026 is a Sunday

  const touch = React.useRef(null);
  const onTs = (e) => { touch.current = e.touches && e.touches[0] ? e.touches[0].clientX : null; };
  const onTe = (e) => {
    if (touch.current == null || !e.changedTouches || !e.changedTouches[0]) return;
    const dx = e.changedTouches[0].clientX - touch.current; touch.current = null;
    if (Math.abs(dx) > 44) shift((dx < 0) !== rtl ? 1 : -1);
  };

  const big = sel ? dpFmt(sel, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : dpt('cal.none');
  return (
    <DpSheet onClose={onClose} label={title || dpt('cal.title')}>
      <div className="rp-dp-head">
        <div className="tx"><span className="lbl">{title || dpt('cal.title')}</span><span className="big">{big}</span></div>
        <button type="button" className="rp-dp-x" onClick={onClose} aria-label={dpt('common.close')}><DpClose /></button>
      </div>

      <div className="rp-dp-bar">
        <button type="button" className="rp-dp-month" aria-expanded={months} onClick={() => { setYearV(view.y); setMonths((v) => !v); }}>
          {months ? yearV : dpFmt(first, { month: 'long', year: 'numeric' })}<DpChevron d={DP_DOWN} />
        </button>
        {months ? (
          <>
            <button type="button" className="rp-dp-nav" aria-label={dpt('cal.prevYear')} onClick={() => setYearV((y) => y - 1)}
              disabled={minD && yearV <= minD.getFullYear()}><DpChevron d={rtl ? DP_RIGHT : DP_LEFT} /></button>
            <button type="button" className="rp-dp-nav" aria-label={dpt('cal.nextYear')} onClick={() => setYearV((y) => y + 1)}
              disabled={maxD && yearV >= maxD.getFullYear()}><DpChevron d={rtl ? DP_LEFT : DP_RIGHT} /></button>
          </>
        ) : (
          <>
            <button type="button" className="rp-dp-nav" aria-label={dpt('cal.prevMonth')} onClick={() => shift(-1)} disabled={!canPrev}>
              <DpChevron d={rtl ? DP_RIGHT : DP_LEFT} /></button>
            <button type="button" className="rp-dp-nav" aria-label={dpt('cal.nextMonth')} onClick={() => shift(1)} disabled={!canNext}>
              <DpChevron d={rtl ? DP_LEFT : DP_RIGHT} /></button>
          </>
        )}
      </div>

      {months ? (
        <div className="rp-dp-months">
          {Array.from({ length: 12 }, (_, m) => {
            const k = monthKey(yearV, m);
            const dis = (minD && k < monthKey(minD.getFullYear(), minD.getMonth())) || (maxD && k > monthKey(maxD.getFullYear(), maxD.getMonth()));
            return (
              <button type="button" key={m} className="rp-dp-mo" disabled={dis} aria-pressed={view.y === yearV && view.m === m}
                onClick={() => { setView({ y: yearV, m }); setMonths(false); dpBuzz(); }}>
                {dpFmt(new Date(yearV, m, 1, 12), { month: 'short' })}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="rp-dp-grid" onTouchStart={onTs} onTouchEnd={onTe} role="grid">
          {wd.map((w, i) => <div key={'w' + i} className="rp-dp-wd" aria-hidden="true">{w}</div>)}
          {cells.map((d, i) => {
            if (!d) return <div key={'e' + i} />;
            const iso = dpIso(d);
            const cls = ['rp-dp-day', iso === isoToday ? 'today' : '', value === iso ? 'sel' : '', marks && marks[iso] ? marks[iso] : ''].join(' ');
            return (
              <button type="button" key={iso} className={cls} disabled={off(d)} aria-pressed={value === iso}
                aria-label={dpFmt(d, { weekday: 'long', day: 'numeric', month: 'long' }) + (marks && marks[iso] === 'race' ? ', ' + dpt('cal.raceDay') : '')}
                onClick={() => pick(iso)}><span>{d.getDate()}</span></button>
            );
          })}
        </div>
      )}

      <div className="rp-dp-foot">
        {!off(today) && <button type="button" className="rp-dp-chip" onClick={() => { setView({ y: today.getFullYear(), m: today.getMonth() }); setMonths(false); }}>{dpt('cal.today')}</button>}
        {clearable && value && <button type="button" className="rp-dp-chip ghost" onClick={() => pick('')}>{dpt('cal.clear')}</button>}
        {marks && Object.values(marks).includes('race') && <span className="rp-dp-legend"><i />{dpt('cal.raceDay')}</span>}
      </div>
    </DpSheet>
  );
}

function RPTimePicker({ value, onChange, onClose, title, clearable }) {
  const m0 = /^(\d{1,2}):(\d{2})$/.exec(value || '');
  const [h, setH] = React.useState(m0 ? +m0[1] : 6);
  const [mi, setMi] = React.useState(m0 ? +m0[2] : 0);
  const fmt = (a, b) => String(a).padStart(2, '0') + ':' + String(b).padStart(2, '0');
  const stepH = (d) => { setH((x) => (x + d + 24) % 24); dpBuzz(); };
  const stepM = (d) => { setMi((x) => (x + d + 60) % 60); dpBuzz(); };
  const common = ['05:00', '05:30', '06:00', '06:30', '07:00', '07:30', '08:00', '20:00'];
  const cur = fmt(h, mi);
  const done = (v) => { dpBuzz(); onChange(v); onClose(); };
  const Step = ({ up, on, label }) => (
    <button type="button" className="rp-tp-step" onClick={on} aria-label={label}><DpChevron d={up ? DP_UP : DP_DOWN} /></button>
  );
  return (
    <DpSheet onClose={onClose} label={title || dpt('time.title')}>
      <div className="rp-dp-head">
        <div className="tx"><span className="lbl">{title || dpt('time.title')}</span></div>
        <button type="button" className="rp-dp-x" onClick={onClose} aria-label={dpt('common.close')}><DpClose /></button>
      </div>
      <div className="rp-tp-led">
        <div className="rp-tp-col">
          <Step up on={() => stepH(1)} label={dpt('time.hourUp')} />
          <span className="rp-tp-num" aria-live="polite">{String(h).padStart(2, '0')}</span>
          <Step on={() => stepH(-1)} label={dpt('time.hourDown')} />
        </div>
        <span className="rp-tp-colon" aria-hidden="true">:</span>
        <div className="rp-tp-col">
          <Step up on={() => stepM(5)} label={dpt('time.minUp')} />
          <span className="rp-tp-num" aria-live="polite">{String(mi).padStart(2, '0')}</span>
          <Step on={() => stepM(-5)} label={dpt('time.minDown')} />
        </div>
      </div>
      <div className="rp-tp-chips">
        {common.map((c) => (
          <button type="button" key={c} className="rp-dp-chip" aria-pressed={c === cur}
            onClick={() => { const [a, b] = c.split(':').map(Number); setH(a); setMi(b); dpBuzz(); }}>{c}</button>
        ))}
      </div>
      <div className="rp-dp-foot">
        {clearable && value && <button type="button" className="rp-dp-chip ghost" onClick={() => done('')}>{dpt('cal.clear')}</button>}
        <button type="button" className="rp-dp-ok" onClick={() => done(cur)}>{dpt('time.set', { time: cur })}</button>
      </div>
    </DpSheet>
  );
}

window.RPDatePicker = RPDatePicker;
window.RPTimePicker = RPTimePicker;
