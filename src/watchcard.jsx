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

// A translation with one value isolated in <bdi>: a pace or a date glued to Hebrew text ("מהיר מ-3:26") otherwise
// takes the hyphen along and shows "3:26-".
function tIso(key, params, slot) {
  const MARK = '';
  const parts = tw(key, { ...params, [slot]: MARK }).split(MARK);
  if (parts.length !== 2) return tw(key, params);
  return <>{parts[0]}<bdi>{params[slot]}</bdi>{parts[1]}</>;
}

const fmtDay = (day) => {
  try { return I18N_W && I18N_W.fmtDate ? I18N_W.fmtDate(new Date(day + 'T12:00:00')) : day; } catch (e) { return day; }
};

// What the Garmin part needs, for the classic card's GarminSection and the lime sheet alike: the link status,
// connect / send (race day, rehearsal) / disconnect, and which plan was last sent from this device.
const SENT_KEY = 'rp-watch-sent';
const planSig = (segments, raceDate) => JSON.stringify([raceDate || '', (segments || [])
  .filter((s) => s && s.distance > 0 && s.paceSec > 0).map((s) => [Math.round(s.distance * 1000), Math.round(s.paceSec)])]);
const readSent = (key) => { try { return (JSON.parse(localStorage.getItem(SENT_KEY) || '{}') || {})[key] || null; } catch (e) { return null; } };
const writeSent = (key, v) => {
  try { const all = JSON.parse(localStorage.getItem(SENT_KEY) || '{}') || {}; all[key] = v; localStorage.setItem(SENT_KEY, JSON.stringify(all)); }
  catch (e) { /* storage blocked: the status just isn't remembered */ }
};

function useGarmin({ segments, profile, raceName, raceDate, onToast }) {
  const FB = window.RP_FIREBASE;
  const usable = !!(FB && FB.user && FB.garminCall);
  const [st, setSt] = React.useState(null); // null = asking; {allowed, connected, broken, canSend}
  const [busy, setBusy] = React.useState('');
  const [sure, setSure] = React.useState(false); // disconnect takes a second tap
  const planKey = raceName || 'plan';
  const [sent, setSent] = React.useState(() => readSent(planKey));
  React.useEffect(() => { setSent(readSent(planKey)); }, [planKey]);
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

  const run = async (what, fn) => {
    if (busy) return false;
    setBusy(what);
    try { await fn(); return true; }
    catch (e) { toast(errText(e)); if (e && (e.code === 'reconnect' || e.code === 'not_connected')) refresh(); return false; }
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
    const rec = { sig: planSig(segments, raceDate), date: r.date || raceDate, at: Date.now() };
    writeSent(planKey, rec); setSent(rec);
    try { if (navigator.vibrate) navigator.vibrate([8, 40, 14]); } catch (e) {}
    toast(tw('watch.g.sent', { date: fmtDay(r.date) }));
  });
  const sendRehearsal = (date, km) => run('rehearsal', async () => {
    const r = await FB.garminCall('Send', payload({ date, kind: 'rehearsal', rehearsalKm: Number(km) }));
    toast(tw('watch.g.sentRehearsal', { date: fmtDay(r.date) }));
  });
  const disconnect = () => {
    if (!sure) { setSure(true); setTimeout(() => setSure(false), 4000); return; }
    setSure(false);
    run('disconnect', async () => { await FB.garminCall('Disconnect'); toast(tw('watch.g.disconnected')); refresh(); });
  };
  const ready = usable && st && st.allowed;
  // 'off' (not for this account / signed out / asking), 'connect', 'nodate', 'noperm', 'unsent', 'changed', 'sent'
  const phase = !ready ? 'off' : !st.connected ? 'connect' : !st.canSend ? 'noperm' : !raceDate ? 'nodate'
    : !sent ? 'unsent' : sent.sig === planSig(segments, raceDate) ? 'sent' : 'changed';
  return { usable, st, busy, sure, sent, phase, connect, sendRace, sendRehearsal, disconnect };
}

function GarminSection({ segments, profile, raceName, raceDate, totalKm, onToast }) {
  const g = useGarmin({ segments, profile, raceName, raceDate, onToast });
  const { usable, st, busy, sure, connect, sendRace, disconnect } = g;
  const [rehDate, setRehDate] = React.useState('');
  const [rehKm, setRehKm] = React.useState(() => Math.max(5, Math.round((totalKm || 0) * 0.65)));
  const sendRehearsal = () => g.sendRehearsal(rehDate, rehKm);

  if (!usable || !st || !st.allowed) {
    return <p style={{ margin: 0, fontSize: 12, color: 'var(--rp-text-dim)' }}>{tw('watch.garminSoon')}</p>;
  }

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
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{tIso('watch.fasterThan', { pace: UW ? UW.fmtPace(b.fastSec) : WP.formatPace(b.fastSec) }, 'pace')}</td>
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
      {/* the step list only while it fits the lock screen; a 43-segment plan keeps the 5 km marks */}
      {n <= 8 && (
      <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {blocks.map((b, i) => (
          <div key={i} style={{ fontSize: 13, color: BAND.dim, fontVariantNumeric: 'tabular-nums' }}>
            {tw('watch.span', { a: UW ? UW.dispDistNum(b.startKm) : b.startKm, b: UW ? UW.dispDistNum(b.endKm) : b.endKm })}
            {' · '}<b style={{ color: BAND.text }}>{UW ? UW.fmtPace(b.paceSec) : WP.formatPace(b.paceSec)}</b>
            {' · '}{tw('watch.cue.' + cueKey(b, i, n))}
          </div>
        ))}
      </div>
      )}
    </div>
  );
});

// ── Lime: the watch strip under the segments and its bottom sheet (Kris, 3.11.2026, option B of
// https://claude.ai/artifact/RWnARACoeYgeyUQeHfamau: "the send is hidden, lots of scrolling, not premium").
// One strip with the state and one button; the sheet shows the watch itself, one big send, the rehearsal as
// chips, then the pace band, the night-before list and the step detail folded away.

const CHECK_STORE = 'rp-watch-check';
const isoDay = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const fmtPaceW = (sec) => (UW ? UW.fmtPace(sec) : WP.formatPace(sec));
const fmtShortDay = (iso) => {
  try { return I18N_W && I18N_W.fmtDate ? I18N_W.fmtDate(new Date(iso + 'T12:00:00'), { day: 'numeric', month: 'numeric' }) : iso; }
  catch (e) { return iso; }
};
const weekday = (iso) => {
  try { return I18N_W && I18N_W.fmtDate ? I18N_W.fmtDate(new Date(iso + 'T12:00:00'), { weekday: 'long' }) : iso; }
  catch (e) { return iso; }
};

/** Rehearsal dates to offer: tomorrow, the coming Friday and Saturday (long-run days here), all before race day. */
function rehearsalDays(raceDate, now = new Date()) {
  const out = [];
  const add = (d, label) => {
    const iso = isoDay(d);
    if (raceDate && iso >= raceDate) return;
    if (out.some((x) => x.iso === iso)) return;
    out.push({ iso, label });
  };
  const day = (n) => { const d = new Date(now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
  add(day(1), tw('watch.reh.tomorrow'));
  for (const wd of [5, 6]) { // Friday, Saturday
    let n = (wd - now.getDay() + 7) % 7; if (n < 2) n += 7;
    add(day(n), null);
  }
  out.sort((a, b) => (a.iso < b.iso ? -1 : 1));
  return out.map((x) => ({ ...x, label: x.label || weekday(x.iso) }));
}
/** Rehearsal lengths: half, two thirds and three quarters of the race, whole km, between 5 and 45. */
function rehearsalKms(totalKm) {
  const set = [];
  for (const f of [0.5, 0.65, 0.75]) {
    const k = Math.min(45, Math.max(5, Math.round(totalKm * f)));
    if (!set.includes(k)) set.push(k);
  }
  return set;
}

if (window.RP_LIME && !document.getElementById('rp-watch-styles')) {
  const s = document.createElement('style');
  s.id = 'rp-watch-styles';
  s.textContent = `
  .rp-wstrip{appearance:none;width:100%;display:flex;align-items:center;gap:12px;cursor:pointer;font:inherit;color:var(--rp-text);
    text-align:start;padding:12px 14px;margin-bottom:10px;border-radius:20px;border:1px solid var(--rp-gold-line);
    background:linear-gradient(180deg,rgba(221,255,74,.07),rgba(221,255,74,.02));-webkit-tap-highlight-color:transparent;
    transition:transform var(--rp-t-fast),border-color var(--rp-t-fast)}
  .rp-wstrip:active{transform:scale(.985)}
  .rp-wstrip:focus-visible,.rp-wbtn:focus-visible,.rp-wchip:focus-visible,.rp-wrow-h:focus-visible{outline:2px solid var(--rp-gold);outline-offset:2px}
  .rp-wring{flex:0 0 auto;width:42px;height:42px;border-radius:50%;display:grid;place-items:center;color:var(--rp-gold);
    border:2px solid var(--rp-gold);box-shadow:0 0 14px var(--rp-lime-glow),inset 0 0 10px rgba(221,255,74,.12)}
  .rp-wtx{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
  .rp-wtx b{font-size:16px;font-weight:900;font-family:var(--rp-font-display)}
  .rp-wst{font-size:12.5px;color:var(--rp-text-dim);display:flex;align-items:center;gap:6px;min-width:0}
  .rp-wst i{flex:0 0 auto;width:7px;height:7px;border-radius:50%;background:currentColor}
  .rp-wst.ok{color:#8EE89A}.rp-wst.warn{color:#FFB547}
  .rp-wgo{flex:0 0 auto;font-weight:900;font-size:13.5px;border-radius:14px;padding:9px 15px;background:var(--rp-gold);color:var(--rp-on-gold)}
  .rp-wgo.ghost{background:transparent;color:var(--rp-gold);border:1px solid var(--rp-gold-line)}

  .rp-wsheet{display:flex;flex-direction:column;gap:14px}
  .rp-wsheet > *{flex-shrink:0}
  .rp-wface-row{display:flex;align-items:center;justify-content:center;gap:10px;touch-action:pan-y}
  .rp-wnav{appearance:none;width:36px;height:36px;border-radius:50%;border:1px solid var(--rp-line);background:transparent;
    color:var(--rp-text);display:grid;place-items:center;cursor:pointer}
  .rp-wnav:disabled{opacity:.25;cursor:default}
  .rp-wface{position:relative;width:212px;height:212px;flex:0 0 auto;border-radius:50%;
    background:radial-gradient(circle at 50% 38%,#161a12,#040504 72%);
    box-shadow:0 0 0 8px #1b1e1a,0 0 0 9px #2a2e27,0 18px 40px rgba(0,0,0,.6);display:grid;place-items:center}
  .rp-wface svg.ring{position:absolute;inset:0}
  .rp-wface-in{display:flex;flex-direction:column;align-items:center;gap:5px;animation:rp-wf-in .26s ease-out}
  @keyframes rp-wf-in{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
  .rp-wled{display:flex;align-items:center;gap:3px;direction:ltr;filter:drop-shadow(0 0 6px var(--rc-glow))}
  .rp-wcolon{display:flex;flex-direction:column;gap:9px;margin:0 2px}.rp-wcolon b{width:5px;height:5px;border-radius:50%;background:var(--rc-on)}
  .rp-wdots{display:flex;gap:5px;justify-content:center;flex-wrap:wrap}
  .rp-wdots b{width:6px;height:6px;border-radius:3px;background:rgba(244,246,238,.18);transition:width .2s}
  .rp-wdots b.on{width:16px;background:var(--rp-gold)}
  .rp-walert{font-size:12.5px;color:var(--rp-text-dim);text-align:center}

  .rp-wbtn{appearance:none;width:100%;border:0;cursor:pointer;font:inherit;border-radius:18px;padding:14px 16px;
    display:flex;flex-direction:column;align-items:center;gap:2px;background:var(--rp-gold);color:var(--rp-on-gold);
    box-shadow:0 8px 26px rgba(221,255,74,.18);transition:transform var(--rp-t-fast)}
  .rp-wbtn:active:not(:disabled){transform:scale(.98)}
  .rp-wbtn b{font-size:16.5px;font-weight:900}.rp-wbtn small{font-size:12px;font-weight:600;opacity:.72}
  .rp-wbtn:disabled{opacity:.4;cursor:default;box-shadow:none}
  .rp-wbtn.second{background:transparent;color:var(--rp-gold);border:1px solid var(--rp-gold-line);box-shadow:none;padding:11px 14px}
  .rp-wbtn.second b{font-size:14.5px}
  .rp-wdone{display:flex;gap:12px;align-items:flex-start;padding:13px 14px;border-radius:18px;
    background:rgba(142,232,154,.07);border:1px solid rgba(142,232,154,.3)}
  .rp-wdone svg path{stroke-dasharray:30;stroke-dashoffset:30;animation:rp-draw .5s .1s ease-out forwards}
  .rp-wnote{font-size:12.5px;line-height:1.5;color:var(--rp-text-dim);margin:0}
  .rp-wlink{appearance:none;background:none;border:0;padding:0;font:inherit;font-size:12.5px;font-weight:700;color:var(--rp-gold);cursor:pointer}

  .rp-wcard{border:1px solid var(--rp-line);border-radius:18px;background:rgba(255,255,255,.02);overflow:hidden}
  .rp-wcard-in{padding:12px 14px;display:flex;flex-direction:column;gap:10px}
  .rp-wchips{display:flex;gap:7px;flex-wrap:wrap}
  .rp-wchip{appearance:none;font:inherit;font-size:13px;cursor:pointer;border-radius:999px;padding:7px 13px;min-height:36px;
    border:1px solid var(--rp-line);background:transparent;color:var(--rp-text);display:inline-flex;align-items:center;gap:6px}
  .rp-wchip small{color:var(--rp-text-dim);font-size:11.5px}
  .rp-wchip[aria-pressed="true"]{border-color:var(--rp-gold);color:var(--rp-gold);background:var(--rp-gold-wash);font-weight:800}
  .rp-wchip[aria-pressed="true"] small{color:inherit;opacity:.8}
  .rp-wrow-h{appearance:none;width:100%;background:none;border:0;font:inherit;color:var(--rp-text);cursor:pointer;
    display:flex;align-items:center;gap:12px;padding:12px 14px;text-align:start}
  .rp-wrow-h + .rp-wrow-h,.rp-wcard > * + *{border-top:1px solid var(--rp-line)}
  .rp-wrow-t{flex:1;min-width:0;display:flex;flex-direction:column}
  .rp-wrow-t b{font-size:14.5px;font-weight:800}.rp-wrow-t span{font-size:12px;color:var(--rp-text-dim)}
  .rp-wmeta{font-size:12.5px;color:var(--rp-text-dim);font-variant-numeric:tabular-nums;white-space:nowrap}
  .rp-wthumb{flex:0 0 auto;width:47px;height:101px;border-radius:9px;overflow:hidden;border:1px solid var(--rp-line);position:relative}
  .rp-wthumb > div{transform:scale(.12);transform-origin:top left;position:absolute;top:0;left:0}
  .rp-wcheck{display:flex;align-items:center;gap:11px;padding:9px 14px;font-size:13.5px;cursor:pointer}
  .rp-wcheck input{appearance:none;flex:0 0 auto;width:22px;height:22px;border-radius:7px;border:1.5px solid var(--rp-line-input);
    display:grid;place-items:center;margin:0;cursor:pointer;background:transparent}
  .rp-wcheck input:checked{background:var(--rp-gold);border-color:var(--rp-gold)}
  .rp-wcheck input:checked::after{content:"";width:6px;height:11px;border:solid var(--rp-on-gold);border-width:0 2.5px 2.5px 0;transform:rotate(45deg) translate(-1px,-1px)}
  .rp-wcheck input:checked + span{color:var(--rp-text-dim);text-decoration:line-through}
  .rp-wstep{display:grid;grid-template-columns:24px 1fr auto;gap:10px;align-items:center;padding:10px 14px}
  .rp-wstep + .rp-wstep{border-top:1px solid var(--rp-line)}
  .rp-wstep .n{font-family:var(--rp-font-mono);font-size:11px;color:var(--rp-text-dim)}
  .rp-wstep .p{font-family:var(--rp-font-mono);font-size:17px;font-weight:700;font-variant-numeric:tabular-nums}
  .rp-wstep .t{display:flex;flex-direction:column;min-width:0}.rp-wstep .t b{font-size:13.5px}.rp-wstep .t span{font-size:11.5px;color:var(--rp-text-dim)}
  .rp-wstep.on{background:var(--rp-gold-wash)}
  .rp-wspin{width:16px;height:16px;border-radius:50%;border:2px solid currentColor;border-top-color:transparent;animation:rp-wspin .7s linear infinite;display:inline-block}
  @keyframes rp-wspin{to{transform:rotate(360deg)}}
  @media (prefers-reduced-motion:reduce){.rp-wface-in,.rp-wdone svg path,.rp-wspin{animation:none!important}.rp-wdone svg path{stroke-dashoffset:0}}
  `;
  document.head.appendChild(s);
}

const WatchIcon = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="6" y="6" width="12" height="12" rx="3" /><path d="M9 6 10 2h4l1 4M9 18l1 4h4l1-4M12 10v2l1.5 1" />
  </svg>
);
const Chevron = ({ dir }) => ( // dir: 'left' | 'right' | 'down' | 'up'
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <path d={{ left: 'm15 6-6 6 6 6', right: 'm9 6 6 6-6 6', down: 'm6 9 6 6 6-6', up: 'm6 15 6-6 6 6' }[dir]} />
  </svg>
);

/** A pace in the app's LED digits. */
function PaceLED({ text, h = 46 }) {
  const Seg = window.SevenSeg;
  if (!Seg) return <span style={{ fontFamily: 'var(--rp-font-mono)', fontSize: h * 0.8, fontWeight: 700, color: 'var(--rp-gold)' }}>{text}</span>;
  return (
    <span className="rp-wled" style={window.CLOCK_VARS || null} aria-label={text}>
      {String(text).split('').map((c, i) => (c === ':'
        ? <span key={i} className="rp-wcolon"><b /><b /></span>
        : /\d/.test(c) ? <Seg key={i} value={c} h={h} /> : null))}
    </span>
  );
}

function WatchFace({ blocks, total }) {
  const [i, setI] = React.useState(0);
  const n = blocks.length;
  const idx = Math.min(i, n - 1);
  const b = blocks[idx];
  const rtl = !I18N_W || I18N_W.dir === 'rtl';
  const go = (d) => { const j = Math.max(0, Math.min(n - 1, idx + d)); if (j !== idx) { setI(j); try { if (navigator.vibrate) navigator.vibrate(5); } catch (e) {} } };
  const touch = React.useRef(null);
  const onStart = (e) => { touch.current = e.touches && e.touches[0] ? e.touches[0].clientX : null; };
  const onEnd = (e) => {
    if (touch.current == null || !e.changedTouches || !e.changedTouches[0]) return;
    const dx = e.changedTouches[0].clientX - touch.current; touch.current = null;
    if (Math.abs(dx) < 36) return;
    go((dx < 0) !== rtl ? 1 : -1); // swipe toward the reading direction's start = next
  };
  const lastKm = blocks[n - 1].endKm || 1;
  const R = 97, C = 2 * Math.PI * R;
  const from = (b.startKm / lastKm) * C, len = Math.max(4, ((b.endKm - b.startKm) / lastKm) * C);
  const n2 = (v) => String(v).padStart(2, '0');
  const kmTxt = UW ? UW.fmtDist(b.endKm) : b.endKm + ' km';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="rp-wface-row" onTouchStart={onStart} onTouchEnd={onEnd}>
        <button type="button" className="rp-wnav" onClick={() => go(-1)} disabled={idx === 0} aria-label={tw('watch.face.prev')}>
          <Chevron dir={rtl ? 'right' : 'left'} /></button>
        <div className="rp-wface" role="img" aria-label={tw('watch.face.step', { i: idx + 1, n }) + ', ' + fmtPaceW(b.paceSec)}>
          <svg className="ring" viewBox="0 0 212 212" aria-hidden="true">
            <circle cx="106" cy="106" r={R} fill="none" stroke="rgba(221,255,74,.09)" strokeWidth="5" />
            <circle cx="106" cy="106" r={R} fill="none" stroke="var(--rp-gold)" strokeWidth="5" strokeLinecap="round"
              strokeDasharray={`${len} ${C}`} strokeDashoffset={-from} transform="rotate(-90 106 106)"
              style={{ filter: 'drop-shadow(0 0 4px rgba(221,255,74,.7))', transition: 'stroke-dasharray .3s, stroke-dashoffset .3s' }} />
          </svg>
          <div className="rp-wface-in" key={idx}>
            <span className="rp-hud" style={{ fontSize: 10, color: 'var(--rp-text-dim)' }}>{n2(idx + 1)} / {n2(n)}</span>
            <PaceLED text={fmtPaceW(b.paceSec)} />
            <span style={{ fontSize: 13, fontWeight: 700 }}>{tIso('watch.face.to', { km: kmTxt }, 'km')}</span>
            <span style={{ fontSize: 11.5, color: 'var(--rp-gold)' }}>{tw('watch.cue.' + cueKey(b, idx, n))}</span>
          </div>
        </div>
        <button type="button" className="rp-wnav" onClick={() => go(1)} disabled={idx === n - 1} aria-label={tw('watch.face.next')}>
          <Chevron dir={rtl ? 'left' : 'right'} /></button>
      </div>
      {n <= 16 && <div className="rp-wdots" aria-hidden="true">{blocks.map((_, k) => <b key={k} className={k === idx ? 'on' : undefined} />)}</div>}
      <div className="rp-walert">{tIso('watch.alertAt', { pace: fmtPaceW(b.fastSec) }, 'pace')} · {tw('watch.alertOnly')}</div>
    </div>
  );
}

function Fold({ title, sub, meta, lead, children, initial = false }) {
  const [open, setOpen] = React.useState(initial);
  return (
    <>
      <button type="button" className="rp-wrow-h" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {lead}
        <span className="rp-wrow-t"><b>{title}</b>{sub && <span>{sub}</span>}</span>
        {meta != null && <span className="rp-wmeta">{meta}</span>}
        <span style={{ color: 'var(--rp-text-dim)', display: 'flex' }}><Chevron dir={open ? 'up' : 'down'} /></span>
      </button>
      {open && <div>{children}</div>}
    </>
  );
}

function WatchSheet({ g, model, segments, raceName, raceDate, onClose, onSaveBand, bandBusy }) {
  const { blocks, splits, total } = model;
  const n = blocks.length;
  const totalKm = blocks[n - 1].endKm;
  const raceKm = segments.reduce((a, s) => a + (s && s.distance > 0 ? s.distance : 0), 0) || totalKm;
  const days = React.useMemo(() => rehearsalDays(raceDate), [raceDate]);
  const kms = React.useMemo(() => rehearsalKms(raceKm), [raceKm]);
  const [rehDay, setRehDay] = React.useState(() => (days.find((d) => new Date(d.iso + 'T12:00:00').getDay() === 5) || days[0] || {}).iso || '');
  const [rehOther, setRehOther] = React.useState(false);
  const [rehKm, setRehKm] = React.useState(kms[1] || kms[0]);
  const checkKey = (raceName || 'plan') + '|' + (raceDate || '');
  const [checked, setChecked] = React.useState(() => {
    try { return (JSON.parse(localStorage.getItem(CHECK_STORE) || '{}') || {})[checkKey] || []; } catch (e) { return []; }
  });
  const toggle = (k) => setChecked((prev) => {
    const next = prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k];
    try { const all = JSON.parse(localStorage.getItem(CHECK_STORE) || '{}') || {}; all[checkKey] = next; localStorage.setItem(CHECK_STORE, JSON.stringify(all)); } catch (e) {}
    return next;
  });
  React.useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const { st, busy, phase } = g;
  const dateTxt = raceDate ? fmtDay(raceDate) : '';
  const spinner = <span className="rp-wspin" aria-hidden="true" />;

  let primary = null;
  if (phase === 'off') {
    primary = g.usable && !st
      ? <button type="button" className="rp-wbtn" disabled><b>{spinner}</b></button>
      : <p className="rp-wnote" style={{ textAlign: 'center' }}>{tw('watch.garminSoon')}</p>;
  } else if (phase === 'connect') {
    primary = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <p className="rp-wnote">{tw(st.broken ? 'watch.g.reconnectIntro' : 'watch.g.intro')}</p>
        <button type="button" className="rp-wbtn" onClick={g.connect} disabled={!!busy}>
          <b>{busy === 'connect' ? tw('watch.g.connecting') : tw('watch.g.connect')}</b></button>
      </div>
    );
  } else if (phase === 'noperm') {
    primary = <p className="rp-wnote">{tw('watch.g.err.noperm')}</p>;
  } else if (phase === 'sent') {
    primary = (
      <div className="rp-wdone">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#8EE89A" strokeWidth="2.4" strokeLinecap="round"
          strokeLinejoin="round" style={{ flex: '0 0 auto' }} aria-hidden="true">
          <circle cx="12" cy="12" r="10" strokeOpacity=".35" /><path d="m7.5 12.5 3 3 6-6.5" /></svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <b style={{ fontSize: 15 }}>{tIso('watch.g.doneTitle', { date: fmtDay(g.sent.date) }, 'date')}</b>
          <p className="rp-wnote">{tw('watch.g.doneNext')}</p>
          <button type="button" className="rp-wlink" style={{ alignSelf: 'flex-start' }} onClick={g.sendRace} disabled={!!busy}>
            {busy === 'race' ? tw('watch.g.sending') : tw('watch.g.resend')}</button>
        </div>
      </div>
    );
  } else {
    primary = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {phase === 'changed' && <div className="rp-wst warn" style={{ justifyContent: 'center' }}><i />{tw('watch.strip.changed')}</div>}
        <button type="button" className="rp-wbtn" onClick={g.sendRace} disabled={!!busy || phase === 'nodate'}>
          {busy === 'race'
            ? <b style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{spinner}{tw('watch.g.sending')}</b>
            : <><b>{tw(phase === 'changed' ? 'watch.g.ctaUpdate' : 'watch.g.cta')}</b>
                {dateTxt && <small>{tIso('watch.g.ctaSub', { date: dateTxt }, 'date')}</small>}</>}
        </button>
        {phase === 'nodate' && <p className="rp-wnote" style={{ textAlign: 'center' }}>{tw('watch.g.needDate')}</p>}
      </div>
    );
  }

  const connected = st && st.allowed && st.connected && st.canSend;
  const kmLabel = (k) => (UW ? UW.fmtDist(k, 0) : k + ' km');

  return ReactDOM.createPortal((
    <div role="dialog" aria-modal="true" aria-label={tw('watch.title')} className="rp-cq-scope rp-lsheet-wrap"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,.78)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        direction: I18N_W ? I18N_W.dir : 'rtl', fontFamily: 'var(--rp-font-ui)', color: 'var(--rp-text)' }}>
      <div className="rp-lsheet rp-wsheet" style={{ background: 'var(--rp-surface)', border: '1px solid var(--rp-line)',
        borderRadius: 'var(--rp-r-14)', width: '100%', maxWidth: 440, maxHeight: '92vh', overflowY: 'auto',
        boxShadow: 'var(--rp-shadow-modal)', padding: '18px 16px 16px' }}>
        <i className="rp-lgrab" aria-hidden="true" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: -4 }}>
          <span style={{ color: 'var(--rp-gold)', display: 'flex' }}><WatchIcon size={22} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--rp-font-display)', fontSize: 19, fontWeight: 900 }}>{tw('watch.title')}</div>
            <div style={{ fontSize: 12, color: 'var(--rp-text-dim)' }}>{[raceName, tw('watch.blocks', { count: n })].filter(Boolean).join(' · ')}</div>
          </div>
          <button type="button" onClick={onClose} aria-label={tw('common.close')} style={{ background: 'none', border: 'none',
            cursor: 'pointer', color: 'var(--rp-text-dim)', fontSize: 20, lineHeight: 1, padding: '2px 6px' }}>✕</button>
        </div>

        <WatchFace blocks={blocks} total={total} />

        {primary}

        {connected && (
          <div className="rp-wcard"><div className="rp-wcard-in">
            <div className="rp-wrow-t"><b>{tw('watch.reh.title')}</b><span>{tw('watch.reh.sub')}</span></div>
            <div className="rp-wchips" role="group" aria-label={tw('watch.g.rehearsalDate')}>
              {days.map((d) => (
                <button type="button" key={d.iso} className="rp-wchip" aria-pressed={!rehOther && rehDay === d.iso}
                  onClick={() => { setRehOther(false); setRehDay(d.iso); }}>
                  {d.label}<small><bdi>{fmtShortDay(d.iso)}</bdi></small></button>
              ))}
              <button type="button" className="rp-wchip" aria-pressed={rehOther} onClick={() => setRehOther(true)}>{tw('watch.reh.other')}</button>
            </div>
            {rehOther && (
              <input id="rp-watch-reh-date" type="date" value={rehDay} min={isoDay(new Date())} max={raceDate || undefined}
                onChange={(e) => setRehDay(e.target.value)} aria-label={tw('watch.g.rehearsalDate')}
                style={{ font: 'inherit', fontSize: 15, padding: '9px 12px', borderRadius: 12, border: '1px solid var(--rp-line-input)',
                  background: 'transparent', color: 'var(--rp-text)', colorScheme: 'dark' }} />
            )}
            <div className="rp-wchips" role="group" aria-label={tw('watch.g.rehearsalKm')}>
              {kms.map((k) => (
                <button type="button" key={k} className="rp-wchip" aria-pressed={rehKm === k} onClick={() => setRehKm(k)}>
                  <bdi>{kmLabel(k)}</bdi></button>
              ))}
            </div>
            <button type="button" className="rp-wbtn second" disabled={!!busy || !rehDay}
              onClick={() => g.sendRehearsal(rehDay, rehKm)}>
              <b>{busy === 'rehearsal' ? tw('watch.g.sending')
                : rehDay ? tIso('watch.reh.sendOn', { date: fmtShortDay(rehDay) }, 'date') : tw('watch.reh.send')}</b>
            </button>
          </div></div>
        )}

        <div className="rp-wcard">
          <div className="rp-wrow-h" style={{ cursor: 'default' }}>
            <span className="rp-wthumb" aria-hidden="true">
              <div><PaceBandImage raceName={raceName} raceDate={raceDate} total={total} splits={splits} blocks={blocks} /></div>
            </span>
            <span className="rp-wrow-t"><b>{tw('watch.band.row')}</b><span>{tw('watch.band.rowSub')}</span></span>
            <button type="button" className="rp-wchip" onClick={onSaveBand} disabled={bandBusy}
              style={{ borderColor: 'var(--rp-gold-line)', color: 'var(--rp-gold)', fontWeight: 800 }}>
              {bandBusy ? spinner : tw('watch.band.saveShort')}</button>
          </div>
          <Fold title={tw('watch.check.short')} meta={tw('watch.check.count', { done: checked.length, n: CHECK_KEYS.length })}>
            {CHECK_KEYS.map((k) => (
              <label key={k} className="rp-wcheck">
                <input type="checkbox" checked={checked.includes(k)} onChange={() => toggle(k)} />
                <span>{tw(k)}</span>
              </label>
            ))}
          </Fold>
          <Fold title={tw('watch.steps.title')} meta={tw('watch.blocks', { count: n })}>
            {blocks.map((b, i) => (
              <div key={i} className="rp-wstep">
                <span className="n">{String(i + 1).padStart(2, '0')}</span>
                <span className="t">
                  <b>{tw('watch.span', { a: UW ? UW.dispDistNum(b.startKm) : b.startKm, b: UW ? UW.dispDistNum(b.endKm) : b.endKm })}
                    {' '}<span style={{ fontWeight: 500, color: 'var(--rp-text-dim)' }}>{UW ? UW.distUnit() : 'km'}</span></b>
                  <span>{tw('watch.cue.' + cueKey(b, i, n))} · {tIso('watch.alertAt', { pace: fmtPaceW(b.fastSec) }, 'pace')}</span>
                </span>
                <span className="p">{fmtPaceW(b.paceSec)}</span>
              </div>
            ))}
            <p className="rp-wnote" style={{ padding: '4px 14px 12px' }}>{tw('watch.drift', { drift: WP.DEFAULTS.driftPct })}</p>
          </Fold>
        </div>

        {st && st.allowed && st.connected && (
          <button type="button" className="rp-wlink" onClick={g.disconnect} disabled={!!busy}
            style={{ alignSelf: 'center', color: g.sure ? 'var(--rp-gold)' : 'var(--rp-text-dim)', fontWeight: 600 }}>
            {busy === 'disconnect' ? tw('watch.g.disconnecting') : g.sure ? tw('watch.g.disconnectSure') : tw('watch.g.disconnect')}
          </button>
        )}
      </div>
    </div>
  ), document.body);
}

function WatchStrip({ segments, profile, raceName, raceDate, onToast }) {
  const [open, setOpen] = React.useState(hasBack);
  const [bandBusy, setBandBusy] = React.useState(false);
  const bandRef = React.useRef(null);
  const units = UW ? UW.system : 'metric';
  const model = React.useMemo(() => watchModel(segments, profile), [segments, profile, units]);
  const g = useGarmin({ segments, profile, raceName, raceDate, onToast });
  const close = React.useCallback(() => setOpen(false), []);
  if (!model) return null;
  const n = model.blocks.length;

  const saveBand = async () => {
    const X = window.RP_EXPORT;
    if (!X || !X.shareImage || !bandRef.current || bandBusy) return;
    setBandBusy(true);
    try {
      const r = await X.shareImage(bandRef.current, 'raceplan-pace-band.png', raceName || tw('watch.band.title'));
      if (r !== 'cancelled' && onToast) onToast(tw('watch.band.saved'));
    } catch (e) { if (onToast) onToast(tw('watch.band.failed')); }
    finally { setBandBusy(false); }
  };

  const { phase } = g;
  const status = {
    off: [null, tw('watch.blocks', { count: n }) + ' · ' + tw('watch.strip.band')],
    connect: [null, tw('watch.strip.connect')],
    noperm: ['warn', tw('watch.g.err.noperm')],
    nodate: [null, tw('watch.strip.needDate')],
    unsent: [null, tw('watch.strip.notSent')],
    changed: ['warn', tw('watch.strip.changed')],
    sent: ['ok', g.sent ? tIso('watch.strip.sent', { date: fmtShortDay(g.sent.date) }, 'date') : ''],
  }[phase];
  const go = phase === 'unsent' ? ['', tw('watch.strip.send')]
    : phase === 'changed' ? ['', tw('watch.strip.update')]
    : phase === 'connect' ? ['', tw('watch.g.connect')]
    : ['ghost', tw('watch.strip.open')];

  return (
    <>
      <button type="button" className="rp-wstrip" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span className="rp-wring"><WatchIcon /></span>
        <span className="rp-wtx">
          <b>{tw('watch.title')}</b>
          <span className={'rp-wst' + (status[0] ? ' ' + status[0] : '')}>{status[0] && <i />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{status[1]}</span></span>
        </span>
        <span className={'rp-wgo' + (go[0] ? ' ' + go[0] : '')}>{go[1]}</span>
      </button>
      {open && <WatchSheet g={g} model={model} segments={segments} raceName={raceName} raceDate={raceDate}
        onClose={close} onSaveBand={saveBand} bandBusy={bandBusy} />}
      <div className="rp-band-wrap" aria-hidden="true">
        <PaceBandImage ref={bandRef} raceName={raceName} raceDate={raceDate} total={model.total} splits={model.splits} blocks={model.blocks} />
      </div>
    </>
  );
}

Object.assign(window, { WatchCard, WatchStrip, PaceBandImage, GarminSection, watchModel, thinProfile, rehearsalDays, rehearsalKms });
