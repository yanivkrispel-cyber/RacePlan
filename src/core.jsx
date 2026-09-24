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
  /* the remainder row under the total-distance lock — derived, not editable */
  .rpt-val-fixed{cursor:default;background:transparent;border-style:dashed;
    border-color:var(--rp-line);color:var(--rp-text-dim)}
  .rpt-val-fixed:hover,.rpt-val-fixed:active{border-color:var(--rp-line)}
  .rpt-val-fixed .rpt-val-c{font-size:10px}
  .rpt-dist-stepper{display:inline-flex;flex-direction:column;align-items:center;gap:2px}
  /* elevation-inside-the-distance-button and segment-time-inside-cumulative-
     time — the mobile single-row layout's way of keeping every number the
     2-row layout showed without a second grid row. Desktop keeps its own
     separate elevation/segment-time columns (below), so these stay hidden
     there — shown only inside the mobile @container block further down. */
  .rpt-elevtag,.rpt-segtag{display:none}
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
  .rpt-seg:hover .rpt-del,.rpt-del:focus-visible{opacity:.7}
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
  .rpt-total .t-unit{font-size:11px;font-weight:600;opacity:.75;margin-inline-start:4px}

  /* ── mobile: one compact row per segment ──
     [#] [dist +val-, with elevation folded in as a 2nd line] [pace +val-]
     [cum time, with segment time folded in as a small "+X" 2nd line] [• ✕]
     Elevation and segment time used to be a second grid row of their own —
     folded into the cells that already have room to grow (the value buttons
     already resize to fit their content; the cum-time cell just gains a
     small second line) rather than spending a whole extra row on them.
     Cumulative distance is still dropped (it's in the totals row).
     No grid-template-areas needed: cumdist/elev/segtime are display:none
     here, and display:none grid items are skipped entirely by auto-
     placement, so the remaining idx/dist/pace/cumtime/status items — in
     that same order in the markup — land in these 5 columns on their own. */
  @container (max-width:600px){
    /* a slim header over the compact rows — without it "5" next to "5:42"
       doesn't say which is distance and which is pace */
    .rpt-head{grid-template-columns:18px 1fr 1fr 60px 34px;column-gap:5px;
      padding:0 9px 5px;font-size:10px}
    .rpt-head .h-cumdist,.rpt-head .h-elev,.rpt-head .h-segt{display:none}
    .rpt-head .h-cumt{text-align:end}
    .rpt-rows{gap:4px}
    .rpt-seg{display:grid;
      /* FIXED widths for the time + status columns so the dist/pace value
         buttons line up across every row even once cumulative time hits
         1:xx:xx */
      grid-template-columns:18px 1fr 1fr 60px 34px;
      align-items:center;column-gap:5px;
      padding:3px 8px;border-radius:var(--rp-r-12);
      background:var(--rp-surface);border:1px solid var(--rp-line)}
    .rpt-seg:hover{background:var(--rp-surface)}
    .rpt-cell{flex-direction:row;align-items:center;justify-content:center;gap:3px;min-width:0}
    .rpt-lbl{display:none}
    .rpt-idx{justify-content:center}
    .rpt-idxbadge{width:20px;height:20px;font-size:10.5px}
    /* .rpt-meta is display:contents (base rule) → its children are grid
       items too, in document order, alongside idx/dist/pace/status above. */
    .rpt-cumdist{display:none}
    .rpt-elev{display:none}   /* shown instead as .rpt-elevtag, inside .rpt-dist */
    .rpt-segtime{display:none} /* shown instead as .rpt-segtag, inside .rpt-cumtime */
    .rpt-elevtag,.rpt-segtag{display:block}
    .rpt-elevtag .rpt-num{font-size:11px!important;font-weight:700!important;white-space:nowrap;line-height:1}
    .rpt-segtag{font-size:8px;font-weight:600;color:var(--rp-text-dim);white-space:nowrap;line-height:1}
    /* Elevation rides beside the distance on the same line — the value
       buttons stay one line and 44px tall (they used to grow to 50px for a
       second line of 8px elevation text, and the pace button spent that
       line on a lone ▾ caret). The bordered box itself says "tap me". */
    .rpt.has-elev .rpt-val{gap:0 5px;padding:0 6px;flex-wrap:wrap;align-content:center}
    /* keep "6.22🔒" whole; only when the pair can't fit (long values on a
       narrow phone) does the elevation wrap under the number */
    .rpt-val>span{white-space:nowrap}
    .rpt.has-elev .rpt-dist-stepper{width:100%}
    .rpt-cumtime{flex-direction:column;align-items:flex-end;justify-content:center;gap:0}
    .rpt-cumtime .rpt-num{font-size:12px;font-weight:800;white-space:nowrap;line-height:1.15}
    .rpt-status{flex-direction:row;align-items:center;gap:2px;justify-content:flex-end}
    .rpt-dot{width:7px;height:7px}
    /* small glyph, finger-sized target: the ::after pad takes it to ~44px */
    .rpt-del{opacity:.55;width:24px;height:36px;font-size:13px;position:relative}
    .rpt-del::after{content:'';position:absolute;inset:-4px -6px}

    /* totals: one clean line — סה"כ · <dist> ק"מ · <avg pace> · <total time> */
    .rpt-total{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:center;
      gap:3px 12px;padding:11px 12px}
    .rpt-total>div:empty{display:none}
    .rpt-total .t-label:first-child{order:0}
    .rpt-total .t-dist{order:1}
    .rpt-total .t-unit{font-size:10px}
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

// Head/tail/crosswind badge for one segment row — a compact companion to
// ElevCell, reusing its up/down color convention (red = works against you,
// blue = helps) since crosswind carries no such lean. Shares its label copy
// with the 3D view's live wind badge (route3d.jsx's WIND_REL_LABEL_KEY).
const WIND_ICON = { head: '↓', tail: '↑', cross: '↔' };
const WIND_LABEL_KEY = { head: 'view3d.windHead', tail: 'view3d.windTail', cross: 'view3d.windCross' };
function WindCell({ wind }) {
  if (!wind) return null;
  const color = wind.kind === 'head' ? 'var(--rp-elev-up)' : wind.kind === 'tail' ? 'var(--rp-elev-down)' : 'var(--rp-text-dim)';
  return (
    <span className="rpt-num" title={t(WIND_LABEL_KEY[wind.kind])}
      style={{ color, fontSize: 12.5, fontWeight: 700, marginInlineStart: 3 }}>
      {WIND_ICON[wind.kind]}
    </span>
  );
}

function SegmentsTable({ plan, colors, stepperKind, onStepDist, onSetDist, onStepPace, onSetPace, onRemove, onEditValue, showTotals = true, paceStep, distStep, elevations, windRel, totalLocked = false }) {
  const { rows, totalDist, totalTime, avgPace } = plan;
  const hasElev = Array.isArray(elevations);
  const hasWind = Array.isArray(windRel);
  // Under the total-distance lock the last segment is the remainder: it's
  // whatever the course has left over, so it's shown rather than edited.
  const remainderIdx = totalLocked ? rows.length - 1 : -1;
  return (
    <div className={`rpt${hasElev ? ' has-elev' : ''}`}>
      <div className="rpt-head">
        <div className="h-idx">#</div>
        <div>{t('segTable.distance', { unit: U ? U.distUnit() : 'km' })}</div>
        <div>{t('segTable.targetPace')}</div>
        <div className="h-cumdist">{t('segTable.cumulative')}</div>
        {hasElev && <div className="h-elev">{t('segTable.elevation')}</div>}
        <div className="h-segt">{t('segTable.segTime')}</div>
        <div className="h-cumt">{t('segTable.cumTime')}</div>
        <div></div>
      </div>
      <div className="rpt-rows">
        {rows.map((r, i) => (
          <div className="rpt-seg" key={r.id}>
            <div className="rpt-cell rpt-idx"><span className="rpt-idxbadge">{r.index}</span></div>
            <div className="rpt-cell rpt-dist">
              <span className="rpt-lbl">{t('segTable.distance', { unit: U ? U.distUnit() : 'km' })}</span>
              {i === remainderIdx ? (
                <span className="rpt-val rpt-val-fixed" title={t('segTable.remainderHint')}>
                  <span>{U ? U.dispDistNum(r.distance) : formatKm(r.distance)}
                    <span className="rpt-val-c" aria-label={t('segTable.remainder')}>🔒</span></span>
                  {hasElev && (
                    <span className="rpt-elevtag">
                      <ElevCell value={elevations[i]} />
                      {hasWind && <WindCell wind={windRel[i]} />}
                    </span>
                  )}
                </span>
              ) : onEditValue ? (
                <button className="rpt-val" onClick={() => onEditValue(r.id, 'dist', r.distance)}>
                  <span>{U ? U.dispDistNum(r.distance) : formatKm(r.distance)}</span>
                  {hasElev && (
                    <span className="rpt-elevtag">
                      <ElevCell value={elevations[i]} />
                      {hasWind && <WindCell wind={windRel[i]} />}
                    </span>
                  )}
                </button>
              ) : (
                <div className="rpt-dist-stepper">
                  <Stepper value={r.distance} type="dist" kind={stepperKind} step={distStep}
                    onStep={(d) => onStepDist(r.id, d)} onSet={(v) => onSetDist(r.id, v)} />
                  {hasElev && (
                    <span className="rpt-elevtag">
                      <ElevCell value={elevations[i]} />
                      {hasWind && <WindCell wind={windRel[i]} />}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="rpt-cell rpt-pace">
              <span className="rpt-lbl">{t('segTable.targetPace')}</span>
              {onEditValue ? (
                <button className="rpt-val" onClick={() => onEditValue(r.id, 'pace', r.paceSec)}>
                  {U ? U.fmtPace(r.paceSec) : formatPace(r.paceSec)}
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
                  {hasWind && <WindCell wind={windRel[i]} />}
                </div>
              )}
              <div className="rpt-cell rpt-segtime">
                <span className="rpt-lbl">{t('segTable.segTime')}</span>
                <span className="rpt-num">{formatClock(r.segTime)}</span>
              </div>
              <div className="rpt-cell rpt-cumtime">
                <span className="rpt-lbl">{t('segTable.cumTime')}</span>
                <span className="rpt-num">{formatClock(r.cumTime)}</span>
                <span className="rpt-segtag" dir="ltr">+{formatClock(r.segTime)}</span>
              </div>
            </div>
            <div className="rpt-cell rpt-status">
              <span className="rpt-dot" title={t(window.ZONES[r.zone].labelKey)}
                style={{ background: colors.zones[r.zone] }} />
              <button className="rpt-del" title={t('segTable.removeSegment')}
                aria-label={`${t('segTable.removeSegment')} ${r.index}`} onClick={() => onRemove(r.id)}>✕</button>
            </div>
          </div>
        ))}
      </div>
      {showTotals && (
        <div className="rpt-total">
          <div className="t-label">{t('segTable.total')}</div>
          {/* the unit rides with the distance — it used to sit alone under
              "cumulative"; and the finish time appears once, under cum. time */}
          <div className="t-num t-dist">
            {U ? U.dispDistNum(totalDist) : formatKm(totalDist)}
            <span className="t-unit">{U ? U.distUnit() : 'km'}</span>
          </div>
          <div className="t-num t-pace">{U ? U.fmtPace(avgPace) : formatPace(avgPace)}</div>
          <div></div>
          {hasElev && <div></div>}
          <div></div>
          <div className="t-num t-cumt">{formatClock(totalTime)}</div>
          <div></div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { PresetSelector, SegmentsTable, presetLabel, presetName });
