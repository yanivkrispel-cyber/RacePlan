// elevation.jsx — elevation profile (meters vs cumulative km) from a GPX track.
// Same crisp measure-then-draw approach as the pace chart.
const { useMeasure } = window;
const t = (window.I18N && window.I18N.t) || ((k) => k);
const U = window.UNITS;

function _elevAt(data, dKm) {
  if (dKm <= data[0].d) return data[0].ele;
  if (dKm >= data[data.length - 1].d) return data[data.length - 1].ele;
  let lo = 0, hi = data.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (data[mid].d <= dKm) lo = mid; else hi = mid;
  }
  const a = data[lo], b = data[hi];
  const f = b.d > a.d ? (dKm - a.d) / (b.d - a.d) : 0;
  return a.ele + f * (b.ele - a.ele);
}

// forwardRef exposes `setProgress(distKm | null)` so a caller driving a
// high-frequency animation (the 3D flyover's runner) can move the position
// marker every frame via direct SVG attribute writes, without going through
// React state/re-render — the same imperative-ref approach route3d.jsx uses
// for its own scrub bar, for the same reason (avoiding 60×/sec re-renders).
const ElevationChart = React.forwardRef(function ElevationChart({ profile, colors, height = 230, gain, loss }, outerRef) {
  const [ref, W] = useMeasure();
  const markerRef = React.useRef(null);
  const guideRef = React.useRef(null);
  const H = height;
  const data = (profile || []).filter((p) => isFinite(p.ele) && isFinite(p.d));
  const hasData = data.length >= 2;

  const padL = 46, padR = 14, padT = 16, padB = 26;
  const plotW = Math.max(10, W - padL - padR);
  const plotH = Math.max(10, H - padT - padB);

  const xMax = hasData ? (data[data.length - 1].d || 1) : 1;
  let lo = 0, hi = 10;
  if (hasData) {
    const eles = data.map((p) => p.ele);
    lo = Math.min(...eles); hi = Math.max(...eles);
    const range = hi - lo || 10;
    lo -= range * 0.15; hi += range * 0.15;
  }

  const x = (d) => padL + (d / xMax) * plotW;
  const y = (e) => padT + ((hi - e) / (hi - lo)) * plotH; // higher elevation = higher

  React.useImperativeHandle(outerRef, () => ({
    setProgress(distKm) {
      if (!hasData || distKm == null || !isFinite(distKm)) {
        if (markerRef.current) markerRef.current.setAttribute('display', 'none');
        if (guideRef.current) guideRef.current.setAttribute('display', 'none');
        return;
      }
      const cx = x(Math.max(0, Math.min(xMax, distKm))), cy = y(_elevAt(data, distKm));
      if (markerRef.current) {
        markerRef.current.setAttribute('cx', cx); markerRef.current.setAttribute('cy', cy);
        markerRef.current.setAttribute('display', '');
      }
      if (guideRef.current) {
        guideRef.current.setAttribute('x1', cx); guideRef.current.setAttribute('x2', cx);
        guideRef.current.setAttribute('display', '');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [data, xMax, lo, hi, plotW, plotH, padL, padT]);

  if (!hasData) return <div ref={ref} style={{ width: '100%', height: H }} />;

  const line = data.map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)},${y(p.ele).toFixed(1)}`).join(' ');
  const area = `${line} L${x(xMax).toFixed(1)},${(padT + plotH).toFixed(1)} L${padL.toFixed(1)},${(padT + plotH).toFixed(1)} Z`;

  const yTicks = [hi, (hi + lo) / 2, lo].map((e) => e);
  const xStep = xMax <= 6 ? 1 : xMax <= 16 ? 2 : xMax <= 25 ? 5 : 10;
  const xTicks = [];
  for (let d = 0; d <= xMax + 0.001; d += xStep) xTicks.push(Math.min(d, xMax));

  const gid = 'el' + Math.round(W);
  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', fontFamily: 'inherit' }}>
        <defs>
          <linearGradient id={`elfill${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.line} stopOpacity="0.4" />
            <stop offset="100%" stopColor={colors.line} stopOpacity="0" />
          </linearGradient>
        </defs>
        {yTicks.map((e, i) => (
          <g key={i}>
            <line x1={padL} y1={y(e)} x2={W - padR} y2={y(e)} stroke={colors.grid} strokeWidth="1" />
            <text x={padL - 8} y={y(e) + 3.5} textAnchor="end" fontSize="11" fill={colors.textDim}>{Math.round(e)}</text>
          </g>
        ))}
        {xTicks.map((d, i) => (
          <text key={`x${i}`} x={x(d)} y={H - 8} textAnchor="middle" fontSize="11" fill={colors.textDim}>{d.toFixed(0)}</text>
        ))}
        <path d={area} fill={`url(#elfill${gid})`} />
        <path d={line} fill="none" stroke={colors.line} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        <text x={W - padR} y={padT + 2} textAnchor="end" fontSize="11.5" fill={colors.textDim}>
          ↑ {U ? U.fmtElev(gain) : gain} · ↓ {U ? U.fmtElev(loss) : loss}
        </text>
        <line ref={guideRef} y1={padT} y2={padT + plotH} stroke={colors.line} strokeWidth="1" strokeDasharray="3,3" opacity="0.55" display="none" />
        <circle ref={markerRef} r="5.5" fill={colors.line} stroke="#fff" strokeWidth="1.6" display="none" />
      </svg>
    </div>
  );
});

window.ElevationChart = ElevationChart;
