// watchcard.jsx — the "to the watch" card under the segments table (Kris, 3.11.2026: its own card; a phone
// image pace band every 5 km; open to everyone; the watch defaults are fixed, the runner doesn't tune them).
//
//   window.WatchCard      — the card: the plan as a few long watch blocks (src/watch.jsx, the same builder
//                           the Garmin send uses), the pace band image, the night-before checklist
//   window.PaceBandImage  — the lock-screen image (rendered off-screen, rasterised by RP_EXPORT.shareImage)
//
//   GarminSection         — connect / send on race day / rehearsal / disconnect, through the Cloud Functions
//                           (functions/garmin*.js). Only for the closed list (functions/.env GARMIN_ALLOW);
//                           everyone else, and a build without the functions, sees "coming soon".

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

// Garmin's consent returns to the app as /#garmin=<result>, usually onto the home screen: the result waits in
// sessionStorage until the card shows it, and the hash goes so a reload doesn't show it twice.
const BACK_KEY = 'rp-garmin-back';
try {
  const m = /^#garmin=([a-z]+)$/.exec(window.location.hash || '');
  if (m) {
    sessionStorage.setItem(BACK_KEY, m[1]);
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
} catch (e) { /* storage blocked: the result is just not shown */ }
const takeBack = () => { try { const r = sessionStorage.getItem(BACK_KEY); sessionStorage.removeItem(BACK_KEY); return r; } catch (e) { return null; } };
const hasBack = () => { try { return !!sessionStorage.getItem(BACK_KEY); } catch (e) { return false; } };

const BACK_RESULTS = new Set(['connected', 'denied', 'expired', 'failed', 'taken', 'noperm']);
const ERR_KEYS = new Set(['reconnect', 'noperm', 'rate_limited', 'not_connected', 'not_allowed', 'past', 'bad_plan']);
function errText(e) {
  const code = e && e.code;
  const past = code === 'bad_request' && Array.isArray(e.detail) && e.detail.includes('past');
  const k = past ? 'past' : code;
  return tw(ERR_KEYS.has(k) ? 'watch.g.err.' + k : 'watch.g.err.generic');
}

/** At most `max` profile points for the request (the server takes up to 3000): every k-th, and the last. */
function thinProfile(profile, max) {
  if (!Array.isArray(profile) || profile.length < 2) return null;
  if (profile.length <= max) return profile.map((p) => ({ d: p.d, ele: p.ele }));
  const k = Math.ceil(profile.length / max), out = [];
  for (let i = 0; i < profile.length; i += k) out.push({ d: profile[i].d, ele: profile[i].ele });
  const last = profile[profile.length - 1];
  if (out[out.length - 1].d !== last.d) out.push({ d: last.d, ele: last.ele });
  return out;
}

const fmtDay = (day) => {
  try { return I18N_W && I18N_W.fmtDate ? I18N_W.fmtDate(new Date(day + 'T12:00:00')) : day; } catch (e) { return day; }
};

function GarminSection({ segments, profile, raceName, raceDate, totalKm, onToast }) {
  const FB = window.RP_FIREBASE;
  const usable = !!(FB && FB.user && FB.garminCall);
  const [st, setSt] = React.useState(null); // null = asking; {allowed, connected, broken, canSend}
  const [busy, setBusy] = React.useState('');
  const [sure, setSure] = React.useState(false); // disconnect takes a second tap
  const [rehDate, setRehDate] = React.useState('');
  const [rehKm, setRehKm] = React.useState(() => Math.max(5, Math.round((totalKm || 0) * 0.65)));
  const toast = (m) => { if (onToast) onToast(m); };

  const refresh = React.useCallback(() => {
    if (!usable) return;
    FB.garminCall('Status').then(setSt).catch(() => setSt({ allowed: false }));
  }, [usable]);
  React.useEffect(() => {
    refresh();
    const r = takeBack();
    if (r && BACK_RESULTS.has(r)) toast(tw('watch.g.back.' + r));
  }, [refresh]);

  if (!usable || !st || !st.allowed) {
    return <p style={{ margin: 0, fontSize: 12, color: 'var(--rp-text-dim)' }}>{tw('watch.garminSoon')}</p>;
  }

  const run = async (what, fn) => {
    if (busy) return;
    setBusy(what);
    try { await fn(); } catch (e) { toast(errText(e)); if (e && (e.code === 'reconnect' || e.code === 'not_connected')) refresh(); }
    finally { setBusy(''); }
  };
  const connect = () => run('connect', async () => {
    const r = await FB.garminCall('Connect');
    window.location.assign(r.url);
  });
  const payload = (extra) => ({
    name: raceName || '', planId: raceName || 'plan',
    segments: segments.filter((s) => s && s.distance > 0 && s.paceSec > 0).map((s) => ({ distance: s.distance, paceSec: s.paceSec })),
    profile: thinProfile(profile, 1500), ...extra,
  });
  const sendRace = () => run('race', async () => {
    const r = await FB.garminCall('Send', payload({ date: raceDate, kind: 'race' }));
    toast(tw('watch.g.sent', { date: fmtDay(r.date) }));
  });
  const sendRehearsal = () => run('rehearsal', async () => {
    const r = await FB.garminCall('Send', payload({ date: rehDate, kind: 'rehearsal', rehearsalKm: Number(rehKm) }));
    toast(tw('watch.g.sentRehearsal', { date: fmtDay(r.date) }));
  });
  const disconnect = () => {
    if (!sure) { setSure(true); setTimeout(() => setSure(false), 4000); return; }
    setSure(false);
    run('disconnect', async () => { await FB.garminCall('Disconnect'); toast(tw('watch.g.disconnected')); refresh(); });
  };

  const box = { display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', borderRadius: 'var(--rp-r-12)',
    background: 'var(--rp-gold-wash)', border: '1px solid var(--rp-gold-line)' };
  const small = { padding: '7px 12px', fontSize: 12.5 };
  const input = { font: 'inherit', fontSize: 12.5, padding: '5px 8px', borderRadius: 8, border: '1px solid var(--rp-line-input)',
    background: 'var(--rp-surface)', color: 'var(--rp-text)' };

  if (!st.connected) {
    return (
      <div style={box}>
        <div style={{ fontSize: 13, fontWeight: 800 }}>Garmin</div>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>{tw(st.broken ? 'watch.g.reconnectIntro' : 'watch.g.intro')}</p>
        <button className="rp-btn" onClick={connect} disabled={!!busy} style={{ ...small, alignSelf: 'flex-start' }}>
          {busy === 'connect' ? tw('watch.g.connecting') : tw('watch.g.connect')}
        </button>
      </div>
    );
  }

  return (
    <div style={box}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 800 }}>Garmin</span>
        <span style={{ fontSize: 12, color: 'var(--rp-text-dim)' }}>{tw('watch.g.connected')}</span>
      </div>
      {!st.canSend && <p style={{ margin: 0, fontSize: 12.5 }}>{tw('watch.g.err.noperm')}</p>}
      {raceDate ? (
        <button className="rp-btn" onClick={sendRace} disabled={!!busy || !st.canSend} style={{ ...small, alignSelf: 'flex-start' }}>
          {busy === 'race' ? tw('watch.g.sending') : tw('watch.g.send', { date: fmtDay(raceDate) })}
        </button>
      ) : (
        <p style={{ margin: 0, fontSize: 12.5 }}>{tw('watch.g.needDate')}</p>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12.5 }}>{tw('watch.g.rehearsal')}</span>
        <input id="rp-garmin-reh-date" type="date" value={rehDate} onChange={(e) => setRehDate(e.target.value)}
          aria-label={tw('watch.g.rehearsalDate')} style={input} />
        <input id="rp-garmin-reh-km" type="number" min="5" max="45" step="1" value={rehKm}
          onChange={(e) => setRehKm(e.target.value)} aria-label={tw('watch.g.rehearsalKm')} style={{ ...input, width: 64 }} />
        <span style={{ fontSize: 12.5, color: 'var(--rp-text-dim)' }}>{tw('units.km')}</span>
        <button className="rp-btn" onClick={sendRehearsal} disabled={!!busy || !rehDate || !st.canSend} style={small}>
          {busy === 'rehearsal' ? tw('watch.g.sending') : tw('watch.g.sendRehearsal')}
        </button>
      </div>
      <button onClick={disconnect} disabled={!!busy}
        style={{ alignSelf: 'flex-start', appearance: 'none', background: 'none', border: 'none', padding: 0, font: 'inherit',
          fontSize: 12, color: sure ? 'var(--rp-gold)' : 'var(--rp-text-dim)', textDecoration: 'underline', cursor: 'pointer' }}>
        {busy === 'disconnect' ? tw('watch.g.disconnecting') : sure ? tw('watch.g.disconnectSure') : tw('watch.g.disconnect')}
      </button>
    </div>
  );
}

function WatchCard({ segments, profile, raceName, raceDate, onToast }) {
  // open by itself when coming back from Garmin's consent, so the result shows where it belongs
  const [open, setOpen] = React.useState(hasBack);
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

          <GarminSection segments={segments} profile={profile} raceName={raceName} raceDate={raceDate}
            totalKm={blocks.length ? blocks[blocks.length - 1].endKm : 0} onToast={onToast} />
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

Object.assign(window, { WatchCard, PaceBandImage, GarminSection, watchModel, thinProfile });
