// heat.jsx — window.RP_HEAT: converts a target pace to the pace the same
// effort actually produces at forecast temperature + humidity.
//
// Math ported from johnjdavisiv/heat-adjusted-pace (MIT License, Copyright
// (c) 2025 John Davis, Running Writings) — https://github.com/johnjdavisiv/heat-adjusted-pace
// Data: src/heat-tables.jsx (load that file first). Full write-up + caveats:
// docs/HEAT.md.
//
// The source model predicts log(marathon speed) from a smooth, non-linear
// temp x humidity surface fitted to 3,891 real marathon performances. It is
// most accurate for continuous, marathon-like efforts by heat-acclimated
// runners, tends to be optimistic for everyone else, and has no opinion on
// interval sessions (rest breaks let heat dissipate — see docs/HEAT.md §9).
// Treat its output as a starting estimate, not a ceiling.
const RP_HEAT = (function () {
  const FINE = (typeof window !== 'undefined' && window.RP_HEAT_FINE_TABLE) || null;
  const INDEX = (typeof window !== 'undefined' && window.RP_HEAT_INDEX_TABLE) || null;

  // ---- bilinear interpolation over the (temp °C x humidity %) grid ---------
  function createLogspeedAdjustInterpolator(table) {
    const { air_temp_c, humidity_pct, logspeed_adjust } = table;
    const xVals = Array.from(new Set(air_temp_c)).sort((a, b) => a - b);
    const yVals = Array.from(new Set(humidity_pct)).sort((a, b) => a - b);
    const val = new Map();
    for (let i = 0; i < air_temp_c.length; i++) {
      val.set(air_temp_c[i] + '|' + humidity_pct[i], logspeed_adjust[i]);
    }
    const getZij = (ix, iy) => val.get(xVals[ix] + '|' + yVals[iy]);

    function bracket(arr, q) {
      const n = arr.length;
      if (q <= arr[0]) return [0, 1, (q - arr[0]) / (arr[1] - arr[0])];
      if (q >= arr[n - 1]) return [n - 2, n - 1, (q - arr[n - 2]) / (arr[n - 1] - arr[n - 2])];
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (arr[mid] >= q) hi = mid; else lo = mid;
      }
      return [lo, hi, (q - arr[lo]) / (arr[hi] - arr[lo])];
    }

    return function interp(tC, hPct) {
      const [ix0, ix1, tx] = bracket(xVals, tC);
      const [iy0, iy1, ty] = bracket(yVals, hPct);
      const z11 = getZij(ix0, iy0), z21 = getZij(ix1, iy0);
      const z12 = getZij(ix0, iy1), z22 = getZij(ix1, iy1);
      const a = z11 * (1 - tx) + z21 * tx;
      const b = z12 * (1 - tx) + z22 * tx;
      return a * (1 - ty) + b * ty;
    };
  }

  // ---- 1D interpolation over the heat-index axis (fallback path) ----------
  function create1DInterpolationLookup(xValues, yValues) {
    return function lookup(x) {
      let i = 0;
      for (i = 0; i < xValues.length; i++) {
        if (x === xValues[i]) return yValues[i];
        if (x < xValues[i]) break;
      }
      if (i === 0) i = 1;
      else if (i === xValues.length) i = xValues.length - 1;
      const x1 = xValues[i - 1], x2 = xValues[i];
      const y1 = yValues[i - 1], y2 = yValues[i];
      return y1 + (x - x1) * (y2 - y1) / (x2 - x1);
    };
  }

  const heatHumidityLookup = FINE ? createLogspeedAdjustInterpolator(FINE) : null;
  const heatIndexLookup = INDEX
    ? create1DInterpolationLookup(INDEX.heat_index_noaa_2014, INDEX.logspeed_adjust)
    : null;

  // ---- effort mode: ideal-conditions pace -> actual pace in the heat -------
  // logResult = logSpeed + adj (adj <= 0 away from the ~9°C/50% optimum), so
  // the returned pace is >= idealPaceSecPerKm — never faster.
  function adjustedPaceSec(idealPaceSecPerKm, tempC, humidityPct) {
    const pace = +idealPaceSecPerKm;
    if (!heatHumidityLookup || !isFinite(pace) || pace <= 0 || !isFinite(tempC) || !isFinite(humidityPct)) {
      return pace;
    }
    const adj = heatHumidityLookup(tempC, humidityPct);
    const idealSpeed = 1 / pace; // km/sec — arbitrary unit is fine, only the ratio matters
    const actualSpeed = Math.exp(Math.log(idealSpeed) + adj);
    return actualSpeed > 0 ? 1 / actualSpeed : pace;
  }

  // sec/km slowdown for a given base pace + conditions (>= 0; 0 in the
  // ~2-13°C "no adjustment needed" band).
  function paceDeltaSec(idealPaceSecPerKm, tempC, humidityPct) {
    const adjusted = adjustedPaceSec(idealPaceSecPerKm, tempC, humidityPct);
    return Math.max(0, adjusted - idealPaceSecPerKm);
  }

  // Out-of-distribution guard rails — the source model's training data barely
  // covers these ranges, so treat its output there as a rough guess at best.
  function warnings(tempC, humidityPct) {
    const out = [];
    if (isFinite(humidityPct) && humidityPct <= 25) out.push('low-humidity');
    if (isFinite(tempC) && tempC >= 32) out.push('extreme-heat');
    if (isFinite(tempC) && tempC <= 0) out.push('freezing');
    return out;
  }

  return {
    heatHumidityLookup,
    heatIndexLookup,
    adjustedPaceSec,
    paceDeltaSec,
    warnings,
    // exposed for tests only
    _createLogspeedAdjustInterpolator: createLogspeedAdjustInterpolator,
    _create1DInterpolationLookup: create1DInterpolationLookup,
  };
})();

if (typeof window !== 'undefined') {
  window.RP_HEAT = RP_HEAT;
}
