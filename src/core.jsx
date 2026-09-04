// core.jsx — shared composable building blocks themed entirely by CSS vars.
// Skins arrange these differently and recolor via custom properties, so the
// heavy/repetitive segments table lives here once.
const { formatPace, formatClock, formatKm, Stepper } = window;

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

  /* ── mobile reflow: each segment becomes a compact card ── */
  @container (max-width:600px){
    .rpt-head{display:none}
    .rpt-rows{gap:var(--rp-s-10)}
    .rpt-seg{display:grid;grid-template-columns:1fr 1fr;
      grid-template-areas:"idx status" "dist pace" "meta meta";
      align-items:center;column-gap:12px;row-gap:12px;
      padding:13px 14px;border-radius:var(--rp-r-14);
      background:var(--rp-surface);border:1px solid var(--rp-line)}
    .rpt-seg:hover{background:var(--rp-surface)}
    .rpt-cell{flex-direction:column;align-items:flex-start;justify-content:center;gap:4px}
    .rpt-lbl{display:block;font-size:10px;letter-spacing:.05em;text-transform:uppercase}
    .rpt-idx{grid-area:idx;align-items:flex-start}
    .rpt-dist{grid-area:dist}
    .rpt-pace{grid-area:pace}
    .rpt-status{grid-area:status;flex-direction:row;align-items:center;justify-content:flex-end}
    .rpt-meta{display:flex;grid-area:meta;flex-wrap:wrap;gap:9px 18px;
      padding-top:11px;border-top:1px solid var(--rp-line-soft)}
    .rpt-meta .rpt-cell{flex:0 0 auto;flex-direction:row;align-items:baseline;gap:6px}
    .rpt-total{display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px;padding:16px}
    .rpt-total>div{text-align:center;flex:1 1 30%}
    .rpt-total .t-label{font-size:12px}
  }
  `;
  document.head.appendChild(s);
}

function PresetSelector({ active, onPick, label = 'מרחק' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--rp-text-dim)' }}>{label}</span>
      <div className="rpt-presets">
        {window.PRESETS.map((p) => (
          <button key={p.km} className="rpt-preset" aria-pressed={active === p.km} onClick={() => onPick(p.km)}>
            {p.label}<small>{p.name}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function ElevCell({ value }) {
  if (value === null || value === undefined) return <span className="rpt-num dim">—</span>;
  const abs = Math.abs(value);
  const color = value > 0 ? 'var(--rp-danger-text)' : value < 0 ? 'var(--rp-zone-easy)' : 'var(--rp-text-dim)';
  const arrow = value > 0 ? '▲' : value < 0 ? '▼' : '';
  return (
    <span className="rpt-num" style={{ color, fontSize: 12.5, fontWeight: 700 }}>
      {arrow}{abs}מ׳
    </span>
  );
}

function SegmentsTable({ plan, colors, stepperKind, onStepDist, onSetDist, onStepPace, onSetPace, onRemove, showTotals = true, paceStep, distStep, elevations }) {
  const { rows, totalDist, totalTime, avgPace } = plan;
  const hasElev = Array.isArray(elevations);
  return (
    <div className={`rpt${hasElev ? ' has-elev' : ''}`}>
      <div className="rpt-head">
        <div className="h-idx">#</div>
        <div>מרחק (ק"מ)</div>
        <div>קצב יעד</div>
        <div>מצטבר</div>
        {hasElev && <div>גובה</div>}
        <div>זמן קטע</div>
        <div>זמן מצטבר</div>
        <div></div>
      </div>
      <div className="rpt-rows">
        {rows.map((r, i) => (
          <div className="rpt-seg" key={r.id}>
            <div className="rpt-cell rpt-idx"><span className="rpt-idxbadge">{r.index}</span></div>
            <div className="rpt-cell rpt-dist">
              <span className="rpt-lbl">מרחק (ק"מ)</span>
              <Stepper value={r.distance} type="dist" kind={stepperKind} step={distStep}
                onStep={(d) => onStepDist(r.id, d)} onSet={(v) => onSetDist(r.id, v)} />
            </div>
            <div className="rpt-cell rpt-pace">
              <span className="rpt-lbl">קצב יעד</span>
              <Stepper value={r.paceSec} type="pace" kind={stepperKind} step={paceStep}
                onStep={(d) => onStepPace(r.id, d)} onSet={(v) => onSetPace(r.id, v)} />
            </div>
            <div className="rpt-meta">
              <div className="rpt-cell rpt-cumdist">
                <span className="rpt-lbl">מצטבר</span>
                <span className="rpt-num dim">{formatKm(r.cumDist)}</span>
              </div>
              {hasElev && (
                <div className="rpt-cell rpt-elev">
                  <span className="rpt-lbl">גובה</span>
                  <ElevCell value={elevations[i]} />
                </div>
              )}
              <div className="rpt-cell rpt-segtime">
                <span className="rpt-lbl">זמן קטע</span>
                <span className="rpt-num">{formatClock(r.segTime)}</span>
              </div>
              <div className="rpt-cell rpt-cumtime">
                <span className="rpt-lbl">זמן מצטבר</span>
                <span className="rpt-num">{formatClock(r.cumTime)}</span>
              </div>
            </div>
            <div className="rpt-cell rpt-status">
              <span className="rpt-dot" title={window.ZONES[r.zone].label}
                style={{ background: colors.zones[r.zone] }} />
              <button className="rpt-del" title="מחק קטע" onClick={() => onRemove(r.id)}>✕</button>
            </div>
          </div>
        ))}
      </div>
      {showTotals && (
        <div className="rpt-total">
          <div className="t-label">סה"כ</div>
          <div className="t-num">{formatKm(totalDist)}</div>
          <div className="t-num">{formatPace(avgPace)}</div>
          <div className="t-label" style={{ opacity: .75 }}>ק"מ</div>
          {hasElev && <div></div>}
          <div className="t-num">{formatClock(totalTime)}</div>
          <div className="t-num">{formatClock(totalTime)}</div>
          <div></div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { PresetSelector, SegmentsTable });
