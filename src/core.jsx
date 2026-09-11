// core.jsx — shared composable building blocks themed entirely by CSS vars.
// Skins arrange these differently and recolor via custom properties, so the
// heavy/repetitive segments table lives here once.
const { formatPace, formatClock, formatKm, Stepper } = window;
const I18N = window.I18N;
const t = (I18N && I18N.t) || ((k) => k);
const U = window.UNITS;

if (!document.getElementById('rp-core-styles')) {
  const s = document.createElement('style');
  s.id = 'rp-core-styles';
  s.textContent = `
  .rp-cq{container-type:inline-size}

  /* ── preset selector ── */
  .rpt-presets{display:flex;gap:var(--rp-s-6);flex-wrap:wrap}
  .rpt-preset{appearance:none;border:1px solid var(--rp-line);background:var(--rp-surface-2);
    color:var(--rp-text-dim);font:inherit;font-weight:600;font-size:14px;padding:7px 15px;border-radius:var(--rp-r-8);
    cursor:pointer;transition:color var(--rp-t-fast),border-color var(--rp-t-fast),background var(--rp-t-fast);
    line-height:1.1;display:flex;flex-direction:column;align-items:center;gap:1px}
  .rpt-preset small{font-size:10px;font-weight:500;opacity:.7}
  .rpt-preset:hover{color:var(--rp-text);border-color:var(--rp-gold)}
  .rpt-preset[aria-pressed="true"]{background:var(--rp-gold);border-color:var(--rp-gold);
    color:var(--rp-on-gold)}
  .rpt-preset[aria-pressed="true"] small{opacity:.85}

  /* ── action buttons ── */
  .rp-btn{appearance:none;font:inherit;font-weight:600;font-size:14px;padding:9px 16px;border-radius:var(--rp-r-8);
    cursor:pointer;transition:color var(--rp-t-fast),border-color var(--rp-t-fast),background var(--rp-t-fast);
    border:1px solid var(--rp-line);background:var(--rp-surface-2);
    color:var(--rp-text);display:inline-flex;align-items:center;gap:7px;line-height:1;white-space:nowrap}
  .rp-btn:hover{border-color:var(--rp-gold);color:var(--rp-gold)}
  .rp-btn:active{background:var(--rp-surface-3)}
  .rp-btn-primary{background:var(--rp-gold);border-color:var(--rp-gold);color:var(--rp-on-gold)}
  .rp-btn-primary:hover{filter:brightness(1.06);color:var(--rp-on-gold)}

  /* tap-to-open value button (mobile-friendly alternative to the stepper) */
  .rpt-val{appearance:none;font:inherit;font-weight:700;font-variant-numeric:tabular-nums;
    background:var(--rp-field-bg);border:1px solid var(--rp-field-border);border-radius:9px;
    color:var(--rp-text);cursor:pointer;min-height:40px;width:100%;max-width:100px;
    display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:0 8px;
    transition:border-color .12s,background .12s}
  .rpt-val:hover,.rpt-val:active{border-color:var(--rp-accent)}
  .rpt-val .rpt-val-c{font-size:9px;color:var(--rp-text-dim)}
  @container (max-width:600px){ .rpt-val{min-height:44px;max-width:none;font-size:15px} }

  /* ── segments table ── (col order: # · dist · pace · cumdist · [elev] · segT · cumT · del) */
  .rpt{--cols:38px 1.5fr 1.5fr .9fr .95fr 1fr 60px}
  .rpt.has-elev{--cols:38px 1.5fr 1.5fr .9fr .65fr .95fr 1fr 60px}
  .rpt-meta{display:contents}
  .rpt-head,.rpt-seg{display:grid;grid-template-columns:var(--cols);align-items:center;gap:8px}
  .rpt-head{padding:0 14px 10px;font-size:11.5px;font-weight:600;color:var(--rp-text-dim);
    letter-spacing:.02em}
  .rpt-head>div{text-align:center}
  .rpt-head .h-idx{text-align:center}
  .rpt-rows{display:flex;flex-direction:column;gap:var(--rp-seg-gap,2px)}
  .rpt-seg{padding:7px 14px;border-radius:var(--rp-seg-radius,8px);background:var(--rp-seg-bg,transparent);
    border:var(--rp-seg-border,1px solid transparent);transition:background .12s;position:relative}
  .rpt-seg:hover{background:var(--rp-seg-hover,rgba(255,255,255,.03))}
  .rpt-cell{display:flex;align-items:center;justify-content:center;gap:7px;min-width:0}
  .rpt-idx{justify-content:center}
  .rpt-idxbadge{width:24px;height:24px;border-radius:var(--rp-r-8);display:flex;align-items:center;justify-content:center;
    font-size:12.5px;font-weight:700;color:var(--rp-text-dim);background:var(--rp-surface-2)}
  .rpt-num{font-variant-numeric:tabular-nums;font-weight:600;color:var(--rp-text)}
  .rpt-num.dim{color:var(--rp-text-dim);font-weight:500}
  .rpt-dot{width:11px;height:11px;border-radius:50%;flex:0 0 auto;box-shadow:0 0 0 3px var(--rp-dot-halo,transparent)}
  .rpt-del{width:24px;height:24px;border-radius:var(--rp-r-8);border:none;background:transparent;cursor:pointer;
    color:var(--rp-text-dim);opacity:0;transition:opacity var(--rp-t-fast),color var(--rp-t-fast),background var(--rp-t-fast);
    font-size:15px;display:flex;align-items:center;justify-content:center}
  .rpt-seg:hover .rpt-del{opacity:.7}
  .rpt-del:hover{opacity:1;color:var(--rp-danger-text);background:var(--rp-danger-wash)}
  .rpt-lbl{display:none;font-size:11px;font-weight:700;color:var(--rp-text-dim);letter-spacing:.02em}
  .rpt-status{justify-content:flex-start;gap:8px}

  /* ── totals row ── */
  .rpt-total{display:grid;grid-template-columns:var(--cols);align-items:center;gap:8px;
    padding:13px 14px;border-radius:var(--rp-r-12);background:var(--rp-gold);color:var(--rp-on-gold);
    font-weight:700;margin-top:var(--rp-s-8)}
  .rpt-total>div{text-align:center}
  .rpt-total .t-label{font-size:13px;font-weight:600;opacity:.9}
  .rpt-total .t-num{font-variant-numeric:tabular-nums;font-size:16px}

  /* ── mobile: one compact 2-row grid per segment ──
     row 1 (tiny):  [seg elevation, if GPX] [seg time]
     row 2:         [#] [dist +val-] [pace +val-] [cum time] [• ✕]
     # and the •✕ span both rows. Cumulative distance is dropped (it's in the
     totals row); segment elevation only shows when a GPX profile is loaded. */
  @container (max-width:600px){
    .rpt-head{display:none}
    .rpt-rows{gap:3px}
    .rpt-seg{display:grid;
      /* FIXED widths for the time + status columns so the dist/pace steppers
         line up across every row even once the cumulative time hits 1:xx:xx */
      grid-template-columns:18px 1fr 1fr 52px 28px;
      grid-template-rows:auto auto;
      grid-template-areas:
        "idx sp   elev segt stat"
        "idx dist pace cumt stat";
      align-items:center;column-gap:5px;row-gap:0;
      padding:4px 8px;border-radius:var(--rp-r-12);
      background:var(--rp-surface);border:1px solid var(--rp-line)}
    .rpt-seg:hover{background:var(--rp-surface)}
    .rpt-cell{flex-direction:row;align-items:center;justify-content:center;gap:3px;min-width:0}
    .rpt-lbl{display:none}
    .rpt-idx{grid-area:idx;justify-content:center}
    .rpt-idxbadge{width:22px;height:22px;font-size:11px}
    .rpt-dist{grid-area:dist}
    .rpt-pace{grid-area:pace}
    /* .rpt-meta is display:contents (base rule) → its children are grid items.
       elev is centered over the pace stepper (same column). */
    .rpt-cumdist{display:none}
    .rpt-elev{grid-area:elev;justify-content:center}
    /* keep the climb/descent colour from ElevCell, just shrink it */
    .rpt-elev .rpt-num{font-size:9.5px!important;font-weight:700!important;white-space:nowrap}
    .rpt-segtime{grid-area:segt;justify-content:flex-end}
    .rpt-segtime .rpt-num{font-size:9.5px;font-weight:600;color:var(--rp-text-dim);white-space:nowrap}
    .rpt-cumtime{grid-area:cumt;justify-content:flex-end}
    .rpt-cumtime .rpt-num{font-size:12px;font-weight:800;white-space:nowrap}
    .rpt-status{grid-area:stat;flex-direction:row;align-items:center;gap:2px;justify-content:flex-end}
    .rpt-dot{width:7px;height:7px}
    .rpt-del{opacity:.5;width:18px;height:18px;font-size:12px}

    /* totals: one clean line — סה"כ · <dist> ק"מ · <avg pace> · <total time> */
    .rpt-total{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:center;
      gap:3px 12px;padding:11px 12px}
    .rpt-total>div:empty,.rpt-total .t-segt{display:none}
    .rpt-total .t-label:first-child{order:0}
    .rpt-total .t-dist{order:1}
    .rpt-total .t-unit{order:1;font-size:10px}
    .rpt-total .t-pace{order:2}
    .rpt-total .t-cumt{order:3}
    .rpt-total .t-label{font-size:11px}
    .rpt-total .t-num{font-size:14px}
  }
  `;
  document.head.appendChild(s);
}

function presetLabel(p) {
  const km = p.km;
  return U ? U.dispDistNum(km, km % 1 === 0 ? 0 : 1) : String(km);
}
function presetName(p) {
  return p.nameKey ? t(p.nameKey) : t('preset.km', { n: presetLabel(p), unit: U ? U.distUnit() : 'km' });
}

function PresetSelector({ active, onPick, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--rp-text-dim)' }}>{label || t('setup.distance')}</span>
      <div className="rpt-presets">
        {window.PRESETS.map((p) => (
          <button key={p.km} className="rpt-preset" aria-pressed={active === p.km} onClick={() => onPick(p.km)}>
            {presetLabel(p)}<small>{p.nameKey ? t(p.nameKey) : ''}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function ElevCell({ value }) {
  if (value === null || value === undefined) return <span className="rpt-num dim">—</span>;
  const abs = Math.abs(value);
  const color = value > 0 ? 'var(--rp-elev-up)' : value < 0 ? 'var(--rp-elev-down)' : 'var(--rp-text-dim)';
  const arrow = value > 0 ? '▲' : value < 0 ? '▼' : '';
  return (
    <span className="rpt-num" style={{ color, fontSize: 12.5, fontWeight: 700 }}>
      {arrow}{U ? U.elevInt(abs) + U.elevUnit() : abs + 'm'}
    </span>
  );
}

function SegmentsTable({ plan, colors, stepperKind, onStepDist, onSetDist, onStepPace, onSetPace, onRemove, onEditValue, showTotals = true, paceStep, distStep, elevations }) {
  const { rows, totalDist, totalTime, avgPace } = plan;
  const hasElev = Array.isArray(elevations);
  return (
    <div className={`rpt${hasElev ? ' has-elev' : ''}`}>
      <div className="rpt-head">
        <div className="h-idx">#</div>
        <div>{t('segTable.distance', { unit: U ? U.distUnit() : 'km' })}</div>
        <div>{t('segTable.targetPace')}</div>
        <div>{t('segTable.cumulative')}</div>
        {hasElev && <div>{t('segTable.elevation')}</div>}
        <div>{t('segTable.segTime')}</div>
        <div>{t('segTable.cumTime')}</div>
        <div></div>
      </div>
      <div className="rpt-rows">
        {rows.map((r, i) => (
          <div className="rpt-seg" key={r.id}>
            <div className="rpt-cell rpt-idx"><span className="rpt-idxbadge">{r.index}</span></div>
            <div className="rpt-cell rpt-dist">
              <span className="rpt-lbl">{t('segTable.distance', { unit: U ? U.distUnit() : 'km' })}</span>
              {onEditValue ? (
                <button className="rpt-val" onClick={() => onEditValue(r.id, 'dist', r.distance)}>
                  {U ? U.dispDistNum(r.distance) : formatKm(r.distance)}<span className="rpt-val-c">▾</span>
                </button>
              ) : (
                <Stepper value={r.distance} type="dist" kind={stepperKind} step={distStep}
                  onStep={(d) => onStepDist(r.id, d)} onSet={(v) => onSetDist(r.id, v)} />
              )}
            </div>
            <div className="rpt-cell rpt-pace">
              <span className="rpt-lbl">{t('segTable.targetPace')}</span>
              {onEditValue ? (
                <button className="rpt-val" onClick={() => onEditValue(r.id, 'pace', r.paceSec)}>
                  {U ? U.fmtPace(r.paceSec) : formatPace(r.paceSec)}<span className="rpt-val-c">▾</span>
                </button>
              ) : (
                <Stepper value={r.paceSec} type="pace" kind={stepperKind} step={paceStep}
                  onStep={(d) => onStepPace(r.id, d)} onSet={(v) => onSetPace(r.id, v)} />
              )}
            </div>
            <div className="rpt-meta">
              <div className="rpt-cell rpt-cumdist">
                <span className="rpt-lbl">{t('segTable.cumulative')}</span>
                <span className="rpt-num dim">{U ? U.dispDistNum(r.cumDist) : formatKm(r.cumDist)}</span>
              </div>
              {hasElev && (
                <div className="rpt-cell rpt-elev">
                  <span className="rpt-lbl">{t('segTable.elevation')}</span>
                  <ElevCell value={elevations[i]} />
                </div>
              )}
              <div className="rpt-cell rpt-segtime">
                <span className="rpt-lbl">{t('segTable.segTime')}</span>
                <span className="rpt-num">{formatClock(r.segTime)}</span>
              </div>
              <div className="rpt-cell rpt-cumtime">
                <span className="rpt-lbl">{t('segTable.cumTime')}</span>
                <span className="rpt-num">{formatClock(r.cumTime)}</span>
              </div>
            </div>
            <div className="rpt-cell rpt-status">
              <span className="rpt-dot" title={t(window.ZONES[r.zone].labelKey)}
                style={{ background: colors.zones[r.zone] }} />
              <button className="rpt-del" title={t('segTable.removeSegment')} onClick={() => onRemove(r.id)}>✕</button>
            </div>
          </div>
        ))}
      </div>
      {showTotals && (
        <div className="rpt-total">
          <div className="t-label">{t('segTable.total')}</div>
          <div className="t-num t-dist">{U ? U.dispDistNum(totalDist) : formatKm(totalDist)}</div>
          <div className="t-num t-pace">{U ? U.fmtPace(avgPace) : formatPace(avgPace)}</div>
          <div className="t-label t-unit" style={{ opacity: .75 }}>{U ? U.distUnit() : 'km'}</div>
          {hasElev && <div></div>}
          <div className="t-num t-segt">{formatClock(totalTime)}</div>
          <div className="t-num t-cumt">{formatClock(totalTime)}</div>
          <div></div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { PresetSelector, SegmentsTable, presetLabel, presetName });
