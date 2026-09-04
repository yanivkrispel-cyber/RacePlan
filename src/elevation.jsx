// elevation.jsx — elevation profile (meters vs cumulative km) from a GPX track.
// Same crisp measure-then-draw approach as the pace chart.
const { useMeasure } = window;

function ElevationChart({ profile, colors, height = 230, gain, loss }) {
  const [ref, W] = useMeasure();
  const H = height;
  const data = (profile || []).filter((p) => isFinite(p.ele) && isFinite(p.d));
  if (data.length < 2) return <div ref={ref} style={{ width: '100%', height: H }} />;

  const padL = 46, padR = 14, padT = 16, padB = 26;
  const plotW = Math.max(10, W - padL - padR);
  const plotH = Math.max(10, H - padT - padB);

  const xMax = data[data.length - 1].d || 1;
  const eles = data.map((p) => p.ele);
  let lo = Math.min(...eles), hi = Math.max(...eles);
  const range = hi - lo || 10;
  lo -= range * 0.15; hi += range * 0.15;

  const x = (d) => padL + (d / xMax) * plotW;
  const y = (e) => padT + ((hi - e) / (hi - lo)) * plotH; // higher elevation = higher

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
          ↑ {gain} מ׳ · ↓ {loss} מ׳
        </text>
      </svg>
    </div>
  );
}

window.ElevationChart = ElevationChart;
