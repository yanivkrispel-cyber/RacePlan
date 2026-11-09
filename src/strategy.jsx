// strategy.jsx — change the race strategy from the plan screen (lime skin).
//   StrategyStrip  the row on the race card: which strategy the plan follows
//   StrategyRoom   full-screen editor: the plan itself becomes the preview, the
//                  finish time stays, nothing changes until "apply"
// The numbers come from gpx.jsx (reshapePlanSegments, resolveStrategy); this file
// only draws them.

const LIME_S = !!window.RP_LIME;
const tS = (window.I18N && window.I18N.t) || ((k) => k);
const US = window.UNITS;
const STRATEGIES_S = ['negative', 'even', 'positive', 'staged', 'strong'];
const buzzS = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} };
const paceS = (sec) => (US ? US.fmtPace(sec) : window.formatPace(sec));
const nameS = (k) => tS(k ? 'strategy.' + k : 'strategy.custom');

if (LIME_S && !document.getElementById('rp-strategy-styles')) {
  const s = document.createElement('style');
  s.id = 'rp-strategy-styles';
  s.textContent = `
  .rp-str-strip{appearance:none;font:inherit;color:inherit;cursor:pointer;text-align:start;display:grid;grid-template-columns:auto minmax(0,1fr) auto;
    gap:11px;align-items:center;width:100%;margin-top:11px;padding:10px 12px;border-radius:14px;background:var(--rp-gold-wash);border:1px solid var(--rp-gold-line);
    transition:transform .12s}
  .rp-str-strip:active{transform:scale(.985)}
  .rp-str-strip:focus-visible{outline:none;box-shadow:var(--rp-focus)}
  .rp-str-strip .ico{width:56px;height:26px;color:var(--rp-gold)}
  .rp-str-strip .ico svg{width:100%;height:100%;display:block}
  .rp-str-strip small{display:block;font-size:11.5px;color:var(--rp-text-dim)}
  .rp-str-strip b{font-size:15px;font-weight:800}
  .rp-str-strip .cta{font-weight:800;font-size:13px;color:var(--rp-gold);padding:5px 12px;border:1px solid var(--rp-gold-line);border-radius:999px}

  .rp-str-wrap{position:fixed;inset:0;z-index:1100;background:rgba(0,0,0,.72);color:var(--rp-text);font-family:var(--rp-font-ui)}
  .rp-str-panel{position:relative;height:100%;max-width:560px;margin-inline:auto;background:#050605;display:flex;flex-direction:column;overflow:hidden;
    animation:rp-str-in .24s cubic-bezier(.2,.8,.2,1)}
  @keyframes rp-str-in{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
  .rp-str-top{flex:0 0 auto;padding-top:env(safe-area-inset-top,0px);padding-bottom:4px;border-bottom:1px solid var(--rp-line)}
  .rp-str-head{display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:8px;padding:14px 14px 6px}
  .rp-str-x{appearance:none;border:0;font:inherit;cursor:pointer;width:34px;height:34px;display:grid;place-items:center;border-radius:50%;background:var(--rp-surface-2);color:var(--rp-text-dim);font-size:15px}
  .rp-str-head b{font-size:17px;font-weight:900;display:block}
  .rp-str-kept{display:flex;gap:4px;align-items:center;font-size:11.5px;color:var(--rp-text-dim)}
  .rp-str-kept svg{color:var(--rp-gold)}
  .rp-str-clock{display:flex;direction:ltr;align-items:center;gap:2px;transform:skewX(-6deg);filter:drop-shadow(0 0 6px rgba(221,255,74,.4));
    --rc-on:#DDFF4A;--rc-off:rgba(221,255,74,.07);--rc-glow:rgba(221,255,74,.85)}
  .rp-str-clock i{display:grid;gap:5px;margin-inline:1px}
  .rp-str-clock i::before,.rp-str-clock i::after{content:"";width:3px;height:3px;border-radius:50%;background:#DDFF4A}
  .rp-str-chart{padding:0 8px;direction:ltr}
  .rp-str-chart svg{display:block;width:100%;height:auto}
  .rp-str-legend{display:flex;flex-wrap:wrap;gap:4px 14px;padding:1px 16px 7px;font-size:11.5px;color:var(--rp-text-dim)}
  .rp-str-legend span{display:inline-flex;gap:6px;align-items:center}
  .rp-str-legend i{display:block;width:18px;height:0;border-top:2.5px solid var(--rp-gold)}
  .rp-str-legend i.was{border-top:2px dashed rgba(244,246,238,.5)}
  .rp-str-legend i.avg{border-top:1px dashed rgba(244,246,238,.5)}
  .rp-str-rail{display:flex;gap:7px;overflow-x:auto;padding:2px 12px 8px;scrollbar-width:none}
  .rp-str-rail::-webkit-scrollbar{display:none}
  .rp-str-chip{appearance:none;font:inherit;cursor:pointer;text-align:start;flex:0 0 auto;min-width:98px;min-height:58px;padding:8px 10px;border-radius:12px;border:1px solid var(--rp-line);
    background:var(--rp-surface-2);display:grid;gap:3px;align-content:center;color:var(--rp-text-dim);transition:background .18s,border-color .18s,color .18s}
  .rp-str-chip svg{width:44px;height:15px;display:block}
  .rp-str-chip b{font-size:13px;font-weight:800;color:var(--rp-text);white-space:nowrap}
  .rp-str-chip.on{border-color:var(--rp-gold);background:var(--rp-gold-wash);color:var(--rp-gold);box-shadow:0 0 18px rgba(221,255,74,.12)}
  .rp-str-chip.on b{color:var(--rp-gold)}
  .rp-str-chip:focus-visible,.rp-str-x:focus-visible,.rp-str-pin:focus-visible,.rp-str-foot button:focus-visible{outline:none;box-shadow:var(--rp-focus)}
  .rp-str-ctl{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 12px;align-items:center;padding:0 16px 4px;font-size:12.5px;color:var(--rp-text-dim);font-weight:700;transition:opacity .18s}
  .rp-str-ctl.off{opacity:.45}
  .rp-str-ctl output{color:var(--rp-gold);font-weight:800;font-variant-numeric:tabular-nums}
  .rp-str-ctl input{grid-column:1/-1;width:100%;margin:0;height:24px;accent-color:var(--rp-gold)}
  .rp-str-hint{margin:0;padding:0 16px 6px;font-size:12px;color:var(--rp-text-dim)}
  .rp-str-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding-bottom:calc(92px + env(safe-area-inset-bottom,0px))}
  .rp-str-sw{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px 16px 8px;font-size:12.5px;color:var(--rp-text-dim);font-weight:700;cursor:pointer}
  .rp-str-sw input{appearance:none;width:38px;height:22px;border-radius:999px;background:var(--rp-surface-3);position:relative;margin:0;cursor:pointer;transition:background .2s;flex:none}
  .rp-str-sw input::after{content:"";position:absolute;top:3px;inset-inline-start:3px;width:16px;height:16px;border-radius:50%;background:var(--rp-text-dim);transition:inset-inline-start .2s,background .2s}
  .rp-str-sw input:checked{background:var(--rp-gold-wash);box-shadow:inset 0 0 0 1px var(--rp-gold-line)}
  .rp-str-sw input:checked::after{inset-inline-start:19px;background:var(--rp-gold)}
  .rp-str-sw input:focus-visible{outline:none;box-shadow:var(--rp-focus)}
  .rp-str-tiles{display:grid;grid-template-columns:repeat(3,1fr);padding:4px 14px 10px}
  .rp-str-tiles div{display:grid;padding-inline:8px}
  .rp-str-tiles div+div{border-inline-start:1px solid var(--rp-line)}
  .rp-str-tiles b{font-size:17px;font-weight:900;font-variant-numeric:tabular-nums}
  .rp-str-tiles span{font-size:11px;color:var(--rp-text-dim)}
  .rp-str-listhead{display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:4px 16px 5px;font-size:11px;color:var(--rp-text-dim)}
  .rp-str-listhead .rp-hud{font-size:10px;color:var(--rp-gold)}
  .rp-str-row{display:grid;grid-template-columns:32px minmax(0,1fr) 44px auto;gap:6px;align-items:center;padding:8px 14px;border-bottom:1px solid var(--rp-line);transition:background .18s}
  .rp-str-row.pinned{background:var(--rp-gold-wash)}
  .rp-str-pin{appearance:none;border:0;background:none;font:inherit;cursor:pointer;width:32px;height:32px;display:grid;place-items:center;border-radius:9px;color:var(--rp-text-dim)}
  .rp-str-pin[aria-pressed="true"]{color:var(--rp-on-gold);background:var(--rp-gold)}
  .rp-str-row .w{min-width:0}
  .rp-str-row .w b{font-size:14px;font-weight:800;display:block}
  .rp-str-row .w>span{font-size:11px;color:var(--rp-text-dim);white-space:nowrap}
  .rp-str-row .up{color:var(--rp-elev-up)} .rp-str-row .dn{color:var(--rp-elev-down)}
  .rp-str-delta{justify-self:center;font-size:12px;font-weight:800;font-variant-numeric:tabular-nums;min-width:38px;text-align:center;padding:2px 0;border-radius:7px;background:var(--rp-surface-2);color:var(--rp-text-dim)}
  .rp-str-delta.f{color:var(--rp-gold);background:var(--rp-gold-wash)}
  .rp-str-delta.s{color:var(--rp-zone-easy);background:rgba(127,211,255,.1)}
  .rp-str-row .p{text-align:end;line-height:1.05}
  .rp-str-row .p>b{font-size:22px;font-weight:900;font-variant-numeric:tabular-nums;display:block}
  .rp-str-row .p small{font-size:10.5px;color:var(--rp-text-dim);font-variant-numeric:tabular-nums}
  .rp-str-foot{position:absolute;inset:auto 0 0 0;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;
    padding:14px 14px calc(16px + env(safe-area-inset-bottom,0px));background:linear-gradient(transparent,#050605 26%)}
  .rp-str-foot .rp-btn{justify-content:center;min-height:48px}
  .rp-str-foot .rp-btn:disabled{opacity:.38;box-shadow:none;cursor:default}
  @media (max-height:600px){
    .rp-str-panel{overflow-y:auto}
    .rp-str-body{flex:none;overflow:visible}
  }
  @media (min-width:700px){.rp-str-panel{box-shadow:0 0 0 1px var(--rp-line)}}
  @media (prefers-reduced-motion:reduce){.rp-str-panel{animation:none}.rp-str-chip,.rp-str-row,.rp-str-ctl{transition:none}}
  `;
  document.head.appendChild(s);
}

// The strategy's own shape, drawn from the same multiplier the paces use.
function StrategyShape({ k, w = 44, h = 15 }) {
  const pts = [];
  for (let i = 0; i <= 30; i++) {
    const f = i / 30;
    const v = k ? window.strategyMult(k, k === 'even' ? 0 : 0.05, f) : 1 + 0.04 * Math.sin(f * 11);
    pts.push((1.5 + f * (w - 3)).toFixed(1) + ',' + (h / 2 + (v - 1) * (h / 2 - 1.5) / 0.05).toFixed(1));
  }
  return (
    <svg viewBox={`0 0 ${w} ${h}`} fill="none" aria-hidden="true">
      <polyline points={pts.join(' ')} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function StrategyStrip({ info, onOpen }) {
  const pct = info.k && info.k !== 'even' ? `${info.pct}%` : '';
  return (
    <button type="button" className="rp-str-strip" onClick={onOpen}>
      <span className="ico"><StrategyShape k={info.k} w={56} h={26} /></span>
      <span><small>{tS('setup.strategy')}</small><b>{nameS(info.k)}{pct && <> <bdi>{pct}</bdi></>}</b></span>
      <span className="cta">{tS('strategy.change')}</span>
    </button>
  );
}

function StrategyClock({ sec }) {
  const t = Math.max(0, Math.round(sec));
  const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); const s = t % 60;
  const d = (v, key) => <window.SevenSeg key={key} value={v} h={22} />;
  return (
    <span className="rp-str-clock" role="timer" aria-label={window.formatClock(t)}>
      {String(h).split('').map((c, i) => d(+c, 'h' + i))}<i />
      {d(Math.floor(m / 10), 'm0')}{d(m % 10, 'm1')}<i />
      {d(Math.floor(s / 10), 's0')}{d(s % 10, 's1')}
    </span>
  );
}

// Round axis steps in display units; `n` = roughly how many marks fit.
function stepS(range, n, steps) {
  for (const s of steps) if (range / s <= n) return s;
  return steps[steps.length - 1];
}

function StrategyChart({ cur, was, segments, profile, avg, domain }) {
  const W = 340; const H = 146; const L = 34; const R = 6; const T = 8; const B = 20;
  const total = segments.reduce((a, s) => a + s.distance, 0);
  const x = (km) => L + (km / total) * (W - L - R);
  const y = (p) => T + ((window.clamp(p, domain[0], domain[1]) - domain[0]) / (domain[1] - domain[0])) * (H - T - B);
  const base = H - B;
  const step = (paces) => {
    let at = 0; let d = '';
    paces.forEach((p, i) => {
      const nx = at + segments[i].distance;
      d += `${i ? 'L' : 'M'}${x(at).toFixed(1)} ${y(p).toFixed(1)}L${x(nx).toFixed(1)} ${y(p).toFixed(1)}`;
      at = nx;
    });
    return d;
  };
  const disp = (sec) => (US ? US.dispPaceSec(sec) : sec);
  const perUnit = disp(1); // display seconds per stored second
  const pStep = stepS((domain[1] - domain[0]) * perUnit, 4, [10, 15, 20, 30, 60, 120]);
  const paceTicks = [];
  for (let v = Math.ceil(disp(domain[0]) / pStep) * pStep; v <= disp(domain[1]); v += pStep) paceTicks.push(v);
  const kmPer = US ? 1 / US.dispDist(1) : 1;
  const dTotal = total / kmPer;
  const dStep = stepS(dTotal, 5, [1, 2, 5, 10, 20, 50]);
  const distTicks = [];
  for (let v = 0; v <= dTotal; v += dStep) distTicks.push(v);

  let elev = null;
  if (Array.isArray(profile) && profile.length > 1) {
    let lo = Infinity; let hi = -Infinity;
    profile.forEach((p) => { if (isFinite(p.ele)) { lo = Math.min(lo, p.ele); hi = Math.max(hi, p.ele); } });
    const h = (H - T - B) * 0.3; const span = Math.max(1, hi - lo);
    const every = Math.max(1, Math.floor(profile.length / 90));
    elev = `M${x(0)} ${base}`;
    for (let i = 0; i < profile.length; i += every) {
      if (isFinite(profile[i].ele)) elev += `L${x(Math.min(profile[i].d, total)).toFixed(1)} ${(base - ((profile[i].ele - lo) / span) * h).toFixed(1)}`;
    }
    elev += `L${x(total)} ${base}Z`;
  }
  const line = step(cur);
  const mono = 'var(--rp-font-mono,monospace)';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tS('strategy.chartAria')}>
      <defs><linearGradient id="rp-str-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#DDFF4A" stopOpacity=".22" /><stop offset="1" stopColor="#DDFF4A" stopOpacity="0" />
      </linearGradient></defs>
      {paceTicks.map((v) => {
        const yy = y(v / perUnit);
        return (<g key={v}>
          <line x1={L} x2={W - R} y1={yy} y2={yy} stroke="rgba(221,255,74,.07)" />
          <text x={L - 5} y={yy + 3.5} textAnchor="end" fontSize="10" fill="#9aa08f" fontFamily={mono}>{window.formatPace(v)}</text>
        </g>);
      })}
      {distTicks.map((v) => (
        <text key={v} x={x(v * kmPer)} y={H - 5} textAnchor="middle" fontSize="10" fill="#9aa08f" fontFamily={mono}>{v}</text>
      ))}
      {elev && <path d={elev} fill="rgba(143,150,134,.2)" />}
      <path d={`${line}L${x(total)} ${base}L${x(0)} ${base}Z`} fill="url(#rp-str-fill)" />
      <line x1={L} x2={W - R} y1={y(avg)} y2={y(avg)} stroke="rgba(244,246,238,.36)" strokeDasharray="3 4" />
      <path d={step(was)} fill="none" stroke="rgba(244,246,238,.5)" strokeWidth="1.6" strokeDasharray="4 4" />
      <path d={line} fill="none" stroke="#DDFF4A" strokeOpacity=".16" strokeWidth="6" />
      <path d={line} fill="none" stroke="#DDFF4A" strokeWidth="2.6" strokeLinejoin="round" />
    </svg>
  );
}

// Paces glide to their new values. rAF stops in a hidden tab, so a timer makes
// sure the numbers always land.
function useGlide(target) {
  const [shown, setShown] = React.useState(target);
  const fromRef = React.useRef(target);
  const key = target.join(',');
  React.useEffect(() => {
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = fromRef.current;
    if (reduce || start.length !== target.length) { fromRef.current = target; setShown(target); return undefined; }
    const t0 = performance.now(); const dur = 280; let raf = 0;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur); const e = 1 - Math.pow(1 - p, 3);
      const v = start.map((s, i) => s + (target[i] - s) * e);
      fromRef.current = v; setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const done = setTimeout(() => { cancelAnimationFrame(raf); fromRef.current = target; setShown(target); }, dur + 80);
    return () => { cancelAnimationFrame(raf); clearTimeout(done); };
  }, [key]);
  return shown;
}

function StrategyRoom({ segments, profile, elevations, totalTime, avgPace, info, onClose, onApply }) {
  window.useEscape(onClose);
  const hasProfile = Array.isArray(profile) && profile.length > 1;
  const [k, setK] = React.useState(info.k);
  const [pct, setPct] = React.useState(info.pct || 3);
  const [grade, setGrade] = React.useState(info.grade && hasProfile);
  const [pins, setPins] = React.useState(info.pins || []);
  const railRef = React.useRef(null);

  React.useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  // The chosen strategy is never left half off the edge of the rail.
  React.useEffect(() => {
    const on = railRef.current && railRef.current.querySelector('.on');
    if (on && on.scrollIntoView) on.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [k]);

  const base = React.useMemo(() => segments.map((s) => s.paceSec), [segments]);
  const pinKey = pins.slice().sort((a, b) => a - b).join(',');
  const startKey = (info.pins || []).slice().sort((a, b) => a - b).join(',');
  const untouched = k === info.k && pct === (info.pct || 3) && grade === (info.grade && hasProfile) && pinKey === startKey;
  const shape = (key, split, g) => window.reshapePlanSegments(segments, profile, {
    goalSec: totalTime, strategy: key, splitPct: split, gradeAdjust: g, pins,
  }).map((s) => s.paceSec);
  // The current choice shows exactly today's plan, not a re-rounded copy of it.
  const target = React.useMemo(
    () => (!k || untouched ? base : shape(k, pct, grade && hasProfile)),
    [k, pct, grade, pinKey, untouched, base],
  );
  const shown = useGlide(target);

  // One axis for the whole visit, wide enough for every strategy at full strength,
  // so a change moves the line and never the scale.
  const domain = React.useMemo(() => {
    let lo = Math.min(...base); let hi = Math.max(...base);
    STRATEGIES_S.forEach((key) => {
      const p = shape(key, 8, hasProfile);
      lo = Math.min(lo, ...p); hi = Math.max(hi, ...p);
    });
    return [lo - 6, Math.max(hi + 6, lo + 40)];
  }, []);

  const distTotal = segments.reduce((a, s) => a + s.distance, 0);
  const timeAt = (paces, km) => {
    let t = 0; let at = 0;
    for (let i = 0; i < paces.length; i++) {
      const d = segments[i].distance;
      if (km >= at + d) t += paces[i] * d;
      else { if (km > at) t += paces[i] * (km - at); break; }
      at += d;
    }
    return t;
  };
  const total = shown.reduce((a, p, i) => a + p * segments[i].distance, 0);
  const h1 = timeAt(shown, distTotal / 2); const h2 = total - h1; const gap = h1 - h2;
  let cum = 0;
  const changed = target.some((p, i) => p !== base[i]);
  const canApply = !!k && (changed || !untouched);
  const disp = (sec) => (US ? US.dispPaceSec(sec) : sec);
  const unit = US ? US.distUnit() : tS('units.km');

  const pick = (key) => { setK(key); buzzS(6); };
  const togglePin = (i) => {
    setPins((list) => (list.includes(i) ? list.filter((x) => x !== i) : [...list, i]));
    buzzS(6);
  };
  const apply = () => {
    if (!canApply) return;
    buzzS([8, 40, 14]);
    onApply(segments.map((s, i) => ({ ...s, paceSec: target[i] })),
      { k, pct, grade: grade && hasProfile, pins, n: segments.length });
  };
  const Lock = window.RPGlyph && window.RPGlyph.lock;
  const sliderOff = !k || k === 'even';

  return ReactDOM.createPortal((
    <div className="rp-str-wrap rp-cq-scope" role="dialog" aria-modal="true" aria-label={tS('setup.strategy')} dir={window.I18N.dir}>
      <div className="rp-str-panel">
        <div className="rp-str-top">
          <div className="rp-str-head">
            <button type="button" className="rp-str-x" onClick={onClose} aria-label={tS('common.close')}>✕</button>
            <div>
              <b>{tS('setup.strategy')}</b>
              <span className="rp-str-kept">{Lock && <Lock size={11} sw={2.4} />}{tS('strategy.timeKept')}</span>
            </div>
            <StrategyClock sec={total} />
          </div>
          <div className="rp-str-chart">
            <StrategyChart cur={shown} was={base} segments={segments} profile={profile} avg={avgPace} domain={domain} />
          </div>
          <div className="rp-str-legend">
            <span><i />{tS('strategy.legendNew')}</span>
            <span><i className="was" />{tS('strategy.legendNow')}</span>
            <span><i className="avg" />{tS('strategy.legendAvg', { pace: paceS(avgPace) })}</span>
          </div>
          <div className="rp-str-rail" ref={railRef}>
            {STRATEGIES_S.map((key) => (
              <button key={key} type="button" className={'rp-str-chip' + (k === key ? ' on' : '')}
                aria-pressed={k === key} onClick={() => pick(key)}>
                <StrategyShape k={key} /><b>{nameS(key)}</b>
              </button>
            ))}
          </div>
          {!k && <p className="rp-str-hint">{tS('strategy.customHint')}</p>}
          <div className={'rp-str-ctl' + (sliderOff ? ' off' : '')}>
            <label htmlFor="rp-str-split">{tS('setup.splitStrength')}</label>
            <output htmlFor="rp-str-split"><bdi>{k === 'even' ? tS('strategy.notForEven') : pct + '%'}</bdi></output>
            <input id="rp-str-split" type="range" min="0" max="8" step="0.5" value={pct} disabled={sliderOff}
              onChange={(e) => setPct(+e.target.value)} />
          </div>
        </div>

        <div className="rp-str-body">
          {hasProfile && (
            <label className="rp-str-sw">
              <span>{tS('setup.gradeAdjust')}</span>
              <input type="checkbox" checked={grade} onChange={(e) => setGrade(e.target.checked)} />
            </label>
          )}
          <div className="rp-str-tiles" style={hasProfile ? undefined : { paddingTop: 12 }}>
            <div><b dir="ltr">{window.formatClock(h1)}</b><span>{tS('strategy.half1')}</span></div>
            <div><b dir="ltr">{window.formatClock(h2)}</b><span>{tS('strategy.half2')}</span></div>
            <div><b dir="ltr">{window.formatClock(Math.abs(gap))}</b>
              <span>{tS(Math.abs(gap) < 3 ? 'strategy.halvesEven' : gap > 0 ? 'strategy.secondFaster' : 'strategy.firstFaster')}</span></div>
          </div>
          <div className="rp-str-listhead">
            <span className="rp-hud" dir="ltr">SEGMENTS · {String(segments.length).padStart(2, '0')}</span>
            <span>{tS('strategy.deltaHint', { unit })}</span>
          </div>
          {segments.map((s, i) => {
            cum += s.distance;
            const now = Math.round(shown[i]);
            const d = Math.round(disp(target[i])) - Math.round(disp(base[i]));
            const el = elevations ? elevations[i] : null;
            const elTxt = el == null ? null
              : (el > 0 ? '▲ ' : el < 0 ? '▼ ' : '') + (US ? US.elevInt(Math.abs(el)) + US.elevUnit() : Math.abs(el) + 'm');
            const pinned = pins.includes(i);
            return (
              <div key={s.id} className={'rp-str-row' + (pinned ? ' pinned' : '')}>
                <button type="button" className="rp-str-pin" aria-pressed={pinned}
                  aria-label={tS('strategy.pinRow', { n: i + 1 })} title={tS('strategy.pinHint')} onClick={() => togglePin(i)}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 16v6" /><path d="M8 3h8l-1 7 3 3v3H6v-3l3-3z" /></svg>
                </button>
                <div className="w">
                  <b>{tS('raceday.untilKm', { dist: US ? US.fmtDist(cum) : window.formatKm(cum) })}</b>
                  <span><bdi>{US ? US.dispDistNum(s.distance) : s.distance} {unit}</bdi>
                    {elTxt && <> · <bdi className={el > 0 ? 'up' : el < 0 ? 'dn' : ''}>{elTxt}</bdi></>}</span>
                </div>
                <span className={'rp-str-delta' + (d < 0 ? ' f' : d > 0 ? ' s' : '')} dir="ltr">
                  {d === 0 ? '=' : (d > 0 ? '+' : '−') + Math.abs(d)}</span>
                <div className="p">
                  <b dir="ltr">{paceS(now)}</b>
                  <small>{d === 0 ? tS('strategy.same') : <>{tS('strategy.was')} <bdi>{paceS(base[i])}</bdi></>}</small>
                </div>
              </div>
            );
          })}
        </div>

        <div className="rp-str-foot">
          <button type="button" className="rp-btn rp-btn-primary" disabled={!canApply} onClick={apply}>{tS('strategy.apply')}</button>
          <button type="button" className="rp-btn" onClick={onClose}>{tS('common.cancel')}</button>
        </div>
      </div>
    </div>
  ), document.body);
}

Object.assign(window, { StrategyStrip, StrategyRoom });
