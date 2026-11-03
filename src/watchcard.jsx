// watchcard.jsx — the "to the watch" card under the segments table (Kris, 3.11.2026: its own card; a phone
// image pace band every 5 km; open to everyone; the watch defaults are fixed, the runner doesn't tune them).
//
//   window.WatchCard      — the card: the plan as a few long watch blocks (src/watch.jsx, the same builder
//                           the Garmin send uses), the pace band image, the night-before checklist
//   window.PaceBandImage  — the lock-screen image (rendered off-screen, rasterised by RP_EXPORT.shareImage)
//
// Send to Garmin is not here yet: it waits for RacePlan's own Garmin app (docs/GARMIN.md).

const WP = window.WATCHPLAN;
const I18N_W = window.I18N;
const tw = (k, p) => (I18N_W && I18N_W.t ? I18N_W.t(k, p) : k);
const UW = window.UNITS;

const BAND_STEP_KM = 5;
const CHECK_KEYS = ['watch.check.charged', 'watch.check.workout', 'watch.check.autolap', 'watch.check.band', 'watch.check.start'];

/** The card's data, from the plan's segments and the course profile. Null when there is nothing to show. */
function watchModel(segments, profile) {
  if (!WP || !Array.isArray(segments) || !segments.length) return null;
  const segs = segments.filter((s) => s && s.distance > 0 && s.paceSec > 0)
    .map((s) => ({ distance: s.distance, paceSec: s.paceSec }));
  if (!segs.length) return null;
  const blocks = WP.watchBlocks(WP.condense(segs, profile || null));
  // every 5 km, or every 5 miles for a runner on miles (a 3.11 mi mark reads as noise)
  const step = UW && UW.system === 'imperial' ? BAND_STEP_KM * 1.609344 : BAND_STEP_KM;
  return { blocks, splits: WP.splits(segs, step), total: blocks.reduce((a, b) => a + b.time, 0) };
}

const cueKey = (b, i, n) => (n > 1 && i === 0 ? 'first' : n > 1 && i === n - 1 ? 'last' : b.kind);

function WatchCard({ segments, profile, raceName, raceDate, onToast }) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const bandRef = React.useRef(null);
  const units = UW ? UW.system : 'metric';
  const model = React.useMemo(() => watchModel(segments, profile), [segments, profile, units]);
  if (!model) return null;
  const { blocks, splits, total } = model;
  const n = blocks.length;
  const fmtClock = WP.formatClock;
  const km = (v) => (UW ? UW.dispDistNum(v) : v);

  const saveBand = async () => {
    const X = window.RP_EXPORT;
    if (!X || !X.shareImage || !bandRef.current || busy) return;
    setBusy(true);
    try {
      const r = await X.shareImage(bandRef.current, 'raceplan-pace-band.png', raceName || tw('watch.band.title'));
      if (r !== 'cancelled' && onToast) onToast(tw('watch.band.saved'));
    } catch (e) {
      if (onToast) onToast(tw('watch.band.failed'));
    } finally { setBusy(false); }
  };

  const th = { fontSize: 11, fontWeight: 700, color: 'var(--rp-text-dim)', textAlign: 'start', padding: '4px 6px' };
  const td = { fontSize: 13, padding: '6px', borderTop: '1px solid var(--rp-line)', fontVariantNumeric: 'tabular-nums', verticalAlign: 'top' };

  return (
    <div className="rp-watch-card" style={{ background: 'var(--rp-surface)', border: '1px solid var(--rp-line)',
      borderRadius: 'var(--rp-r-12)', overflow: 'hidden', marginBottom: 10 }}>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open}
        style={{ appearance: 'none', background: 'transparent', border: 'none', width: '100%', font: 'inherit',
          cursor: 'pointer', color: 'var(--rp-text)', display: 'flex', alignItems: 'center', gap: 8,
          padding: '9px 12px', textAlign: 'start' }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--rp-gold)" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" style={{ flex: '0 0 auto' }}>
          <rect x="6" y="6" width="12" height="12" rx="3" /><path d="M9 6 10 2h4l1 4M9 18l1 4h4l1-4M12 10v2l1.5 1" />
        </svg>
        <span style={{ fontFamily: 'var(--rp-font-display)', fontSize: 15, fontWeight: 800 }}>{tw('watch.title')}</span>
        <span style={{ fontSize: 12, color: 'var(--rp-text-dim)' }}>{tw('watch.blocks', { count: n })}</span>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
          strokeLinecap="round" strokeLinejoin="round"
          style={{ flex: '0 0 auto', marginInlineStart: 'auto', color: 'var(--rp-text-dim)',
            transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--rp-t-fast)' }}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div style={{ borderTop: '1px solid var(--rp-line)', padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--rp-text-dim)', lineHeight: 1.5 }}>{tw('watch.sub')}</p>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>{tw('watch.col.where', { unit: UW ? UW.distUnit() : 'km' })}</th>
                <th style={th}>{tw('watch.col.pace')}</th>
                <th style={th}>{tw('watch.col.alert')}</th>
                <th style={th}>{tw('watch.col.cue')}</th>
              </tr></thead>
              <tbody>
                {blocks.map((b, i) => (
                  <tr key={i}>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{tw('watch.span', { a: km(b.startKm), b: km(b.endKm) })}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{UW ? UW.fmtPace(b.paceSec) : WP.formatPace(b.paceSec)}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{tw('watch.fasterThan', { pace: UW ? UW.fmtPace(b.fastSec) : WP.formatPace(b.fastSec) })}</td>
                    <td style={{ ...td, color: 'var(--rp-text-dim)' }}>{tw('watch.cue.' + cueKey(b, i, n))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--rp-text-dim)' }}>
            {tw('watch.rules', { drift: WP.DEFAULTS.driftPct })}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 800 }}>{tw('watch.band.title')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {splits.map((s, i) => (
                <span key={i} style={{ fontSize: 12.5, padding: '3px 8px', borderRadius: 99, background: 'var(--rp-gold-wash)',
                  border: '1px solid var(--rp-gold-line)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  {s.finish ? tw('watch.band.finish') : (UW ? UW.fmtDist(s.km) : s.km)} · {fmtClock(s.sec)}
                </span>
              ))}
            </div>
            <button className="rp-btn" onClick={saveBand} disabled={busy}
              style={{ alignSelf: 'flex-start', padding: '7px 12px', fontSize: 12.5 }}>
              {busy ? tw('watch.band.saving') : tw('watch.band.save')}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 800 }}>{tw('watch.check.title')}</div>
            <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 12.5, lineHeight: 1.6 }}>
              {CHECK_KEYS.map((k) => <li key={k}>{tw(k)}</li>)}
            </ul>
          </div>

          <p style={{ margin: 0, fontSize: 12, color: 'var(--rp-text-dim)' }}>{tw('watch.garminSoon')}</p>
        </div>
      )}

      <div className="rp-band-wrap" aria-hidden="true">
        <PaceBandImage ref={bandRef} raceName={raceName} raceDate={raceDate} total={total} splits={splits} blocks={blocks} />
      </div>
    </div>
  );
}

// A phone lock screen: 390 css px wide (1170 px at scale 3), dark so it reads in sunlight and at night.
// Colours per skin: classic navy + gold, or lime (black, lime, off-white).
const BAND = window.RP_LIME
  ? { bg: '#050605', text: '#F4F6EE', accent: '#DDFF4A', dim: '#8f9686', soft: '#cdd2c3', line: 'rgba(221,255,74,.16)' }
  : { bg: '#0d1626', text: '#f2ead6', accent: '#e3b75a', dim: '#a3abc0', soft: '#c9d5ef', line: '#25324d' };
const PaceBandImage = React.forwardRef(function PaceBandImage({ raceName, raceDate, total, splits, blocks }, ref) {
  const fmtClock = WP.formatClock;
  const n = blocks.length;
  return (
    <div ref={ref} style={{ width: 390, minHeight: 844, boxSizing: 'border-box', background: BAND.bg, color: BAND.text,
      padding: '170px 26px 40px', fontFamily: '"Heebo", system-ui, sans-serif', direction: I18N_W ? I18N_W.dir : 'rtl' }}>
      {window.RP_LIME && window.RPMark
        ? <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><window.RPMark width={54} />
            <div dir="ltr" style={{ lineHeight: 1 }}><div style={{ fontSize: 15, fontWeight: 900, letterSpacing: '.02em' }}>RACE PLAN</div>
            <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: '.42em', color: BAND.accent, marginTop: 4 }}>BY KRISPEL</div></div></div>
        : <div style={{ fontSize: 13, letterSpacing: '.14em', fontWeight: 800, color: BAND.accent }}>RACE PLAN</div>}
      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4, lineHeight: 1.2 }}>{raceName || tw('watch.band.title')}</div>
      <div style={{ fontSize: 14, color: BAND.dim, marginTop: 4 }}>
        {[raceDate, tw('watch.band.goal', { time: fmtClock(total) })].filter(Boolean).join(' · ')}
      </div>
      <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column' }}>
        {splits.map((s, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '9px 2px',
            borderBottom: '1px solid ' + BAND.line, fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ fontSize: 17, color: s.finish ? BAND.accent : BAND.soft, fontWeight: s.finish ? 800 : 500 }}>
              {s.finish ? tw('watch.band.finish') : (UW ? UW.fmtDist(s.km) : s.km)}
            </span>
            <span style={{ fontSize: 26, fontWeight: 800, color: s.finish ? BAND.accent : BAND.text }}>{fmtClock(s.sec)}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {blocks.map((b, i) => (
          <div key={i} style={{ fontSize: 13, color: BAND.dim, fontVariantNumeric: 'tabular-nums' }}>
            {tw('watch.span', { a: UW ? UW.dispDistNum(b.startKm) : b.startKm, b: UW ? UW.dispDistNum(b.endKm) : b.endKm })}
            {' · '}<b style={{ color: BAND.text }}>{UW ? UW.fmtPace(b.paceSec) : WP.formatPace(b.paceSec)}</b>
            {' · '}{tw('watch.cue.' + cueKey(b, i, n))}
          </div>
        ))}
      </div>
    </div>
  );
});

Object.assign(window, { WatchCard, PaceBandImage, watchModel });
