// chart.jsx — themeable pace-profile chart (SVG). Reads window helpers.
// Supports optional elevation overlay (dual Y-axis) when elevationProfile is provided.
const { formatPace, formatKm } = window;

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

function PaceChart({
  rows, avgPace, totalDist,
  variant = 'step', colors, height = 230, compact = false,
  elevationProfile = null,   // [{d, ele}] — when present, draws overlay
  showElevation = false,     // controlled toggle
}) {
  const [ref, W] = useMeasure();
  const H = height;
  const c = colors;

  if (!rows.length) return <div ref={ref} style={{ width: '100%', height: H }} />;

  // Elevation data: filter valid points
  const elData = (showElevation && elevationProfile)
    ? elevationProfile.filter((p) => isFinite(p.ele) && isFinite(p.d))
    : [];
  const hasEl = elData.length >= 2;

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
    const elRange = elHi - elLo || 10;
    elLo -= elRange * 0.12;
    elHi += elRange * 0.12;
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

  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', fontFamily: 'inherit' }}>
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
            <text x={padL - 8} y={y(p) + 3.5} textAnchor="end" fontSize={compact ? 9.5 : 11} fill={c.textDim}>{formatPace(p)}</text>
          </g>
        ))}

        {/* elevation Y-axis labels (right) */}
        {hasEl && elYTicks.map((e, i) => (
          <text key={`el${i}`} x={W - padR + 6} y={ye(e) + 3.5}
            textAnchor="start" fontSize={compact ? 9 : 10.5} fill={EL_AXIS}>
            {Math.round(e)}מ׳
          </text>
        ))}

        {/* x labels */}
        {xTicks.map((d, i) => (
          <text key={`x${i}`} x={x(d)} y={H - 8} textAnchor="middle" fontSize={compact ? 9.5 : 11} fill={c.textDim}>{d.toFixed(1)}</text>
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
      </svg>
    </div>
  );
}

window.PaceChart = PaceChart;
window.useMeasure = useMeasure;
