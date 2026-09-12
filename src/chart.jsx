// chart.jsx — themeable pace-profile chart (SVG). Reads window helpers.
// Supports optional elevation overlay (dual Y-axis) when elevationProfile is provided.
const { formatPace, formatKm } = window;
const I18N = window.I18N;
const t = (I18N && I18N.t) || ((k) => k);
const U = window.UNITS;

function useMeasure() {
  const ref = React.useRef(null);
  const [w, setW] = React.useState(600);
  React.useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0].contentRect.width;
      if (cw > 0) setW(cw);
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// Elevation overlay — cool slate, distinct from the gold pace line and from
// every pace-zone color (DESIGN_TOKENS: --rp-elev).
const EL_LINE  = '#7C88B0';
const EL_FILL  = 'rgba(124,136,176,0.16)';
const EL_AXIS  = 'rgba(124,136,176,0.75)';

const SNAP_PX = 12;

// Gentle moving-average over elevation only (distance untouched) — knocks the
// GPS/barometer jitter off the line without flattening real hills, since the
// window stays a small fraction of the point count.
function smoothElevProfile(data) {
  const n = data.length;
  if (n < 5) return data;
  const r = Math.min(4, Math.max(1, Math.round(n / 100)));
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0, cnt = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) { sum += data[j].ele; cnt++; }
    out[i] = { d: data[i].d, ele: sum / cnt };
  }
  return out;
}
window.smoothElevProfile = smoothElevProfile;

function PaceChart({
  rows, avgPace, totalDist,
  variant = 'step', colors, height = 230, compact = false,
  elevationProfile = null,   // [{d, ele}] — when present, draws overlay
  showElevation = false,     // controlled toggle
  interactive = false,       // draggable segment boundaries on the elevation
  segments = null,           // [{distance, paceSec}] — required for interactive
  extrema = null,            // [{d, ele, kind}] — snap targets while dragging
  onSegmentsChange = null,   // (newSegments) => void, fired live during a drag
}) {
  const [ref, W] = useMeasure();
  const svgRef = React.useRef(null);
  const dragRef = React.useRef(null);
  const moveLogic = React.useRef(() => {});
  const upLogic = React.useRef(() => {});
  const boundMove = React.useRef((e) => moveLogic.current(e)).current;
  const boundUp = React.useRef((e) => upLogic.current(e)).current;
  const [drag, setDrag] = React.useState(null); // { k, d, snapped:false|'peak'|'valley' }
  React.useEffect(() => () => {
    window.removeEventListener('pointermove', boundMove);
    window.removeEventListener('pointerup', boundUp);
    window.removeEventListener('pointercancel', boundUp);
  }, []);
  const H = height;
  const c = colors;

  if (!rows.length) return <div ref={ref} style={{ width: '100%', height: H }} />;

  // Elevation data: filter valid points
  const elDataRaw = (showElevation && elevationProfile)
    ? elevationProfile.filter((p) => isFinite(p.ele) && isFinite(p.d))
    : [];
  const hasEl = elDataRaw.length >= 2;
  const elData = hasEl ? smoothElevProfile(elDataRaw) : elDataRaw;

  const padL = compact ? 40 : 48;
  const padR = hasEl ? 46 : 14;   // extra room for right-axis labels
  const padT = 16;
  const padB = 26;
  const plotW = Math.max(10, W - padL - padR);
  const plotH = Math.max(10, H - padT - padB);

  // ── pace Y scale (left axis) ──────────────────────────────────────────
  const xMax = totalDist || 1;
  const x = (d) => padL + (d / xMax) * plotW;

  const paces = rows.map((r) => r.paceSec);
  let lo = Math.min(...paces, avgPace);
  let hi = Math.max(...paces, avgPace);
  const range = hi - lo || 30;
  const pad = Math.max(8, range * 0.35);
  lo -= pad; hi += pad;
  const y = (p) => padT + ((p - lo) / (hi - lo)) * plotH;

  const tickCount = compact ? 3 : 4;
  const yTicks = [];
  for (let i = 0; i <= tickCount; i++) {
    yTicks.push(lo + ((hi - lo) * i) / tickCount);
  }
  const xStep = xMax <= 6 ? 1 : xMax <= 16 ? 2 : xMax <= 25 ? 5 : 10;
  const xTicks = [];
  for (let d = 0; d <= xMax + 0.001; d += xStep) xTicks.push(Math.min(d, xMax));

  // ── elevation Y scale (right axis) ────────────────────────────────────
  let elLo = 0, elHi = 1;
  let ye = () => padT; // fallback no-op
  let elYTicks = [];
  let elLine = '', elArea = '';

  if (hasEl) {
    const eles = elData.map((p) => p.ele);
    elLo = Math.min(...eles);
    elHi = Math.max(...eles);
    // Always show at least this many meters of vertical span, so a flat
    // course doesn't get stretched to fill the chart and read as a climb.
    const MIN_EL_RANGE = 60;
    if (elHi - elLo < MIN_EL_RANGE) {
      const mid = (elHi + elLo) / 2;
      elLo = mid - MIN_EL_RANGE / 2; elHi = mid + MIN_EL_RANGE / 2;
    }
    const elPad = (elHi - elLo) * 0.12;
    elLo -= elPad; elHi += elPad;
    ye = (e) => padT + ((elHi - e) / (elHi - elLo)) * plotH; // higher = up

    // Right-axis ticks (3 levels)
    elYTicks = [elHi, (elHi + elLo) / 2, elLo];

    // SVG paths for elevation
    const elXMax = elData[elData.length - 1].d || xMax;
    const elX = (d) => padL + (d / elXMax) * plotW; // normalise to plot width
    elLine = elData.map((p, i) => `${i ? 'L' : 'M'}${elX(p.d).toFixed(1)},${ye(p.ele).toFixed(1)}`).join(' ');
    elArea = `${elLine} L${elX(elXMax).toFixed(1)},${(padT + plotH).toFixed(1)} L${padL.toFixed(1)},${(padT + plotH).toFixed(1)} Z`;
  }

  // ── pace step path ────────────────────────────────────────────────────
  let cum = 0;
  const stepPts = [];
  for (const r of rows) {
    const x0 = x(cum);
    const x1 = x(r.cumDist);
    const yy = y(r.paceSec);
    stepPts.push([x0, yy], [x1, yy]);
    cum = r.cumDist;
  }
  const stepLine = stepPts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const areaPath = `${stepLine} L${x(totalDist).toFixed(1)},${(padT + plotH).toFixed(1)} L${padL.toFixed(1)},${(padT + plotH).toFixed(1)} Z`;

  const zoneColor = (z) => c.zones[z];
  const gid = React.useId ? React.useId().replace(/:/g, '') : 'g' + Math.random().toString(36).slice(2);

  // ── interactive boundary dragging (on the elevation) ─────────────────
  const canDrag = interactive && segments && segments.length > 1
    && typeof onSegmentsChange === 'function' && Array.isArray(elevationProfile);

  const distAt = (clientX) => {
    const rect = svgRef.current.getBoundingClientRect();
    const px = (clientX - rect.left) * (W / (rect.width || W));
    return ((px - padL) / plotW) * xMax;
  };
  const snap = (d) => {
    if (!extrema || !extrema.length) return { d, kind: false };
    let best = null, bestDx = SNAP_PX;
    for (const ex of extrema) {
      const dx = Math.abs(x(ex.d) - x(d));
      if (dx < bestDx) { bestDx = dx; best = ex; }
    }
    return best ? { d: best.d, kind: best.kind } : { d, kind: false };
  };
  const emit = (st, d) => {
    const next = window.adjustSegmentBoundary(st.segs, elevationProfile, st.k, d);
    onSegmentsChange(next);
  };
  // Move / up run against window (not setPointerCapture — flaky for SVG on iOS
  // Safari). The bound* wrappers have a stable identity so removeEventListener
  // works even though the logic closures are rebuilt every render.
  moveLogic.current = (e) => {
    const st = dragRef.current;
    if (!st) return;
    if (e.cancelable) e.preventDefault();
    const s = snap(distAt(e.clientX));
    st.pending = s.d;
    setDrag({ k: st.k, d: s.d, snapped: s.kind });
    if (!st.raf) st.raf = requestAnimationFrame(() => { st.raf = 0; emit(st, st.pending); });
  };
  upLogic.current = () => {
    const st = dragRef.current;
    window.removeEventListener('pointermove', boundMove);
    window.removeEventListener('pointerup', boundUp);
    window.removeEventListener('pointercancel', boundUp);
    if (!st) return;
    if (st.raf) cancelAnimationFrame(st.raf);
    emit(st, st.pending != null ? st.pending : rows[st.k].cumDist);
    dragRef.current = null;
    setDrag(null);
  };
  const onDown = (e, k) => {
    if (!canDrag) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
    dragRef.current = { k, segs: segments.map((s) => ({ ...s })), raf: 0, pending: null };
    setDrag({ k, d: rows[k].cumDist, snapped: false });
    window.addEventListener('pointermove', boundMove, { passive: false });
    window.addEventListener('pointerup', boundUp);
    window.addEventListener('pointercancel', boundUp);
  };

  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg ref={svgRef} width={W} height={H} viewBox={`0 0 ${W} ${H}`}
        style={{ display: 'block', fontFamily: 'inherit', touchAction: canDrag ? 'pan-y' : undefined }}>
        <defs>
          <linearGradient id={`fill${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c.line} stopOpacity={variant === 'area' ? 0.42 : 0.26} />
            <stop offset="100%" stopColor={c.line} stopOpacity="0" />
          </linearGradient>
          {hasEl && (
            <linearGradient id={`elfill${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={EL_LINE} stopOpacity="0.32" />
              <stop offset="100%" stopColor={EL_LINE} stopOpacity="0.02" />
            </linearGradient>
          )}
        </defs>

        {/* y gridlines + pace labels (left) */}
        {yTicks.map((p, i) => (
          <g key={`y${i}`}>
            <line x1={padL} y1={y(p)} x2={W - padR} y2={y(p)} stroke={c.grid} strokeWidth="1" />
            <text x={padL - 8} y={y(p) + 3.5} textAnchor="end" fontSize={compact ? 9.5 : 11} fill={c.textDim}>{U ? U.fmtPace(p) : formatPace(p)}</text>
          </g>
        ))}

        {/* elevation Y-axis labels (right) */}
        {hasEl && elYTicks.map((e, i) => (
          <text key={`el${i}`} x={W - padR + 6} y={ye(e) + 3.5}
            textAnchor="start" fontSize={compact ? 9 : 10.5} fill={EL_AXIS}>
            {U ? U.elevInt(e) + U.elevUnit() : Math.round(e) + 'm'}
          </text>
        ))}

        {/* x labels */}
        {xTicks.map((d, i) => (
          <text key={`x${i}`} x={x(d)} y={H - 8} textAnchor="middle" fontSize={compact ? 9.5 : 11} fill={c.textDim}>{(U ? U.dispDist(d) : d).toFixed(1)}</text>
        ))}

        {/* ── elevation overlay (drawn first, behind pace) ── */}
        {hasEl && (
          <g opacity="1">
            <path d={elArea} fill={`url(#elfill${gid})`} />
            <path d={elLine} fill="none" stroke={EL_LINE} strokeWidth="1.8"
              strokeLinejoin="round" strokeLinecap="round" opacity="0.8" />
          </g>
        )}

        {/* average pace dashed line */}
        <line x1={padL} y1={y(avgPace)} x2={W - padR} y2={y(avgPace)}
          stroke={c.avg} strokeWidth="1.5" strokeDasharray="5 4" opacity="0.85" />

        {/* ── pace variants ── */}
        {variant === 'bars' && rows.map((r, i) => {
          let prev = i === 0 ? 0 : rows[i - 1].cumDist;
          const bx = x(prev), bw = Math.max(2, x(r.cumDist) - x(prev) - 3);
          const by = y(r.paceSec);
          return <rect key={r.id} x={bx + 1.5} y={by} width={bw} height={padT + plotH - by}
            fill={zoneColor(r.zone)} opacity="0.9" rx="2" />;
        })}

        {(variant === 'step' || variant === 'area') && (
          <>
            {variant === 'area' && <path d={areaPath} fill={`url(#fill${gid})`} />}
            <path d={stepLine} fill="none" stroke={c.line} strokeWidth={compact ? 2 : 2.4}
              strokeLinejoin="round" strokeLinecap="round" />
            {rows.map((r) => (
              <circle key={r.id} cx={x(r.cumDist)} cy={y(r.paceSec)} r={compact ? 3 : 3.6}
                fill={c.dotFill} stroke={zoneColor(r.zone)} strokeWidth="2.4" />
            ))}
          </>
        )}

        {variant === 'dots' && (
          <>
            <path d={stepLine} fill="none" stroke={c.line} strokeWidth="1.6" opacity="0.5" strokeLinejoin="round" />
            {rows.map((r, i) => {
              let prev = i === 0 ? 0 : rows[i - 1].cumDist;
              const mx = x((prev + r.cumDist) / 2);
              return (
                <g key={r.id}>
                  <circle cx={mx} cy={y(r.paceSec)} r={compact ? 5 : 6.5} fill={zoneColor(r.zone)} />
                  <circle cx={mx} cy={y(r.paceSec)} r={compact ? 5 : 6.5} fill="none" stroke={c.dotFill} strokeWidth="1.5" opacity="0.5" />
                </g>
              );
            })}
          </>
        )}

        {/* ── draggable segment boundaries (align a segment to a climb/descent) ── */}
        {canDrag && hasEl && extrema && extrema.map((ex, i) => (
          <circle key={`ex${i}`} cx={x(ex.d)} cy={ye(ex.ele)} r="2.4"
            fill={ex.kind === 'peak' ? 'var(--rp-elev-up, #C36079)' : 'var(--rp-elev-down, #7C9BD6)'}
            opacity={drag && drag.snapped && Math.abs(x(ex.d) - x(drag.d)) < 1 ? 1 : 0.4} />
        ))}
        {canDrag && rows.slice(0, -1).map((r, k) => {
          const hx = x(r.cumDist);
          const on = drag && drag.k === k;
          return (
            <g key={`bnd${k}`}>
              <line x1={hx} y1={padT} x2={hx} y2={padT + plotH}
                stroke={on ? c.line : 'rgba(201,162,75,0.4)'}
                strokeWidth={on ? 1.6 : 1} strokeDasharray={on ? '0' : '3 3'} />
              <rect x={hx - 6} y={padT + plotH / 2 - 13} width="12" height="26" rx="3"
                fill={c.line} opacity={on ? 1 : 0.72} pointerEvents="none" />
              {/* finger-sized transparent hit area */}
              <rect x={hx - 13} y={padT} width="26" height={plotH}
                fill="transparent" style={{ cursor: 'ew-resize', touchAction: 'none' }}
                onPointerDown={(e) => onDown(e, k)} />
            </g>
          );
        })}
        {canDrag && drag && dragRef.current && (() => {
          const nx = window.adjustSegmentBoundary(dragRef.current.segs, elevationProfile, drag.k, drag.d);
          const a = nx[drag.k], b = nx[drag.k + 1];
          if (!a || !b) return null;
          const lx = Math.min(Math.max(x(drag.d), padL + 66), W - padR - 66);
          const label = drag.snapped === 'peak' ? '⭯ ' + t('chart.snapPeak')
            : drag.snapped === 'valley' ? '⭯ ' + t('chart.snapValley')
            : (U ? U.fmtDist(drag.d) : `${formatKm(drag.d)}`);
          return (
            <g pointerEvents="none">
              <rect x={lx - 64} y={padT + 1} width="128" height="31" rx="5"
                fill={c.dotFill} stroke={c.line} strokeWidth="1" opacity="0.97" />
              <text x={lx} y={padT + 13} textAnchor="middle" fontSize="9.5" fill={c.textDim}>{label}</text>
              <text x={lx} y={padT + 25} textAnchor="middle" fontSize="10" fontWeight="700" fill={c.line}>
                {(U ? U.dispDistNum(a.distance) : formatKm(a.distance))}·{(U ? U.fmtPace(a.paceSec) : formatPace(a.paceSec))}
                {' ׀ '}
                {(U ? U.dispDistNum(b.distance) : formatKm(b.distance))}·{(U ? U.fmtPace(b.paceSec) : formatPace(b.paceSec))}
              </text>
            </g>
          );
        })()}
      </svg>
    </div>
  );
}

window.PaceChart = PaceChart;
window.useMeasure = useMeasure;
