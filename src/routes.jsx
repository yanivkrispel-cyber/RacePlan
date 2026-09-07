// routes.jsx — the shared "route library" sheet (window.RouteLibrary).
//
// Two ways to give a plan a course without hand-uploading a GPX file:
//   1. Library  — search the races catalog (Firestore `races`). A race with an
//      attached route loads straight into the plan; one without just says so.
//   2. Link / paste — paste a .gpx URL or the raw GPX XML. The URL is fetched
//      client-side (works when the host sends CORS headers); on failure we tell
//      the user to download the file and use "ייבוא GPX" instead.
//
// The owner additionally gets "save to library": writes the course payload onto
// the race doc (profileFlat / trackFlat — Firestore forbids nested arrays) and
// uploads the raw .gpx to Storage.

const { parseGpx, RouteMap } = window;
const RP_FB_R = (typeof window !== 'undefined' && window.RP_FIREBASE) || null;

// keep ~N evenly-spaced samples (always including the last)
function rl_downsample(arr, max) {
  if (arr.length <= max) return arr;
  const step = Math.ceil(arr.length / max);
  const out = [];
  for (let i = 0; i < arr.length; i += step) out.push(arr[i]);
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
  return out;
}

function flagFor(cc) {
  if (!cc || cc.length !== 2) return '🏳️';
  return cc.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

const DIST_LABEL = { marathon: 'מרתון', half_marathon: 'חצי מרתון' };
const looksLikeXml = (s) => /^\s*<(\?xml|gpx)[\s>]/i.test(s || '');

// Firestore Timestamp → "DD/MM" (best-effort; tolerates plain {seconds} too)
function fmtSubDate(ts) {
  const ms = !ts ? 0
    : typeof ts.toMillis === 'function' ? ts.toMillis()
      : typeof ts.seconds === 'number' ? ts.seconds * 1000 : 0;
  if (!ms) return '';
  try { return new Date(ms).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' }); }
  catch (e) { return ''; }
}
const round1 = (n) => Math.round(n * 10) / 10;
const round3 = (n) => Math.round(n * 1000) / 1000;
const round5 = (n) => Math.round(n * 1e5) / 1e5;

// flat number arrays (profileFlat / trackFlat) → the { profile, track, … }
// shape the planner's p.loadCourse understands. Shared by library races and
// community submissions.
function decodeFlatCourse(rec, opts) {
  opts = opts || {};
  const pf = rec.profileFlat || [];
  const tf = rec.trackFlat || [];
  const profile = [];
  for (let i = 0; i + 1 < pf.length; i += 2) profile.push({ d: pf[i], ele: pf[i + 1] });
  const track = [];
  for (let i = 0; i + 1 < tf.length; i += 2) track.push([tf[i], tf[i + 1]]);
  return {
    name: opts.name || rec.nameHe || rec.name || rec.courseName || 'מסלול',
    dist: rec.distanceKm || (profile.length ? profile[profile.length - 1].d : 0),
    gain: rec.gain || 0,
    loss: rec.loss || 0,
    source: opts.source || 'ספריית מסלולים',
    profile: profile.length ? profile : null,
    track: track.length ? track : null,
    lat: rec.startLat != null ? rec.startLat : (track.length ? track[0][0] : null),
    lon: rec.startLon != null ? rec.startLon : (track.length ? track[0][1] : null),
  };
}

// race doc  →  course object the planner understands (p.loadCourse)
function courseFromRace(rc) {
  return decodeFlatCourse(rc, { name: rc.nameHe || rc.name, source: 'ספריית מסלולים' });
}

// community submission doc  →  course object
function courseFromSubmission(sub) {
  return decodeFlatCourse(sub, {
    name: sub.courseName || sub.raceName || 'מסלול מהקהילה',
    source: 'הצעה מהקהילה',
  });
}

// pending payload (from courseFromGpx) + chosen race + submitter
//   → the routeSubmissions/{id} document body (server fills status/submitter/dates).
function buildSubmissionRecord(pending, race, user) {
  const c = (pending && pending.course) || {};
  return {
    raceId: race.id,
    raceName: race.nameHe || race.name || '',
    courseName: c.name || '',
    status: 'pending',
    submitterUid: (user && user.uid) || '',
    submitterEmail: (user && user.email) || '',
    submitterName: (user && user.name) || '',
    source: c.source || (pending && pending.sourceUrl ? 'קישור' : 'קובץ GPX'),
    sourceUrl: (pending && pending.sourceUrl) || null,
    distanceKm: round3(c.dist || 0),
    gain: Math.round(c.gain || 0),
    loss: Math.round(c.loss || 0),
    startLat: c.lat != null ? round5(c.lat) : null,
    startLon: c.lon != null ? round5(c.lon) : null,
    profileFlat: (pending && pending.profileFlat) || null,
    trackFlat: (pending && pending.trackFlat) || [],
    gpxPath: (pending && pending.gpxPath) || null,
  };
}

// parsed GPX  →  { course, gpxText, flats } for saving
function courseFromGpx(parsed, xml, fallbackName, source) {
  const hasEle = parsed.points.some((pt) => isFinite(pt.ele));
  const prof = hasEle
    ? rl_downsample(parsed.points.map((pt) => ({ d: pt.cum / 1000, ele: pt.ele })), 320)
    : null;
  const trk = rl_downsample(parsed.points.map((pt) => [pt.lat, pt.lon]), 500);
  const course = {
    name: parsed.name || fallbackName || 'מסלול מיובא',
    dist: parsed.totalDist, gain: parsed.elevGain, loss: parsed.elevLoss,
    source: source || 'קישור', profile: prof, track: trk,
    lat: parsed.startLat, lon: parsed.startLon,
  };
  const profileFlat = prof ? prof.flatMap((p) => [round3(p.d), round1(p.ele)]) : null;
  const trackFlat = trk.flatMap((t) => [round5(t[0]), round5(t[1])]);
  return { course, gpxText: xml, profileFlat, trackFlat };
}

// slug for a race doc id — Latin only; Hebrew names fall back to a timestamp id.
function rl_slug(s) {
  return String(s || '').toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}
function makeRaceId(name, city, distance, taken) {
  const distTag = distance === 'marathon' ? 'marathon'
    : distance === 'half_marathon' ? 'half-marathon' : '';
  let base = [rl_slug(name) || rl_slug(city), distTag].filter(Boolean).join('-');
  if (base.length < 3) base = 'race-' + Date.now().toString(36);
  let id = base; let i = 2;
  while (taken && taken.has(id)) { id = base + '-' + i; i += 1; }
  return id;
}

function StatusBadge({ status }) {
  const map = {
    available: ['מסלול זמין', 'var(--rp-gold)', 'var(--rp-gold-wash)', 'var(--rp-gold-line)'],
    candidate: ['מועמד לפרסום', '#C9A24B', 'transparent', 'var(--rp-line)'],
    none: ['מסלול טרם פורסם', 'var(--rp-text-dim)', 'transparent', 'var(--rp-line)'],
  };
  const [txt, fg, bg, bd] = map[status] || map.none;
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 700, color: fg, background: bg,
      border: `1px solid ${bd}`, borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap',
    }}>{txt}</span>
  );
}

function RouteLibrary({ onClose, onLoadCourse, raceName, onRaceName, isOwner, initialPending }) {
  const [races, setRaces] = React.useState(null);   // null = loading
  const [q, setQ] = React.useState('');
  const [dist, setDist] = React.useState('all');
  const [tab, setTab] = React.useState(initialPending ? 'link' : 'library');
  const [linkText, setLinkText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const [note, setNote] = React.useState(
    !initialPending ? ''
      : isOwner ? 'המסלול מהקובץ מוכן. בחרו מרוץ לשיוך ולחצו "שמור מסלול בספרייה".'
        : 'המסלול מהקובץ מוכן. בחרו מרוץ ושלחו אותו למנהל המערכת לצירוף קבוע.'
  );
  const [pending, setPending] = React.useState(initialPending || null); // { course, gpxText, profileFlat, trackFlat, sourceUrl }
  const [selId, setSelId] = React.useState('');
  const [seeding, setSeeding] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false); // community submission sent

  // owner review queue (routeSubmissions, status=pending)
  const [subs, setSubs] = React.useState(null);       // null = not loaded
  const [subBusy, setSubBusy] = React.useState('');   // id being approved/rejected
  const [expanded, setExpanded] = React.useState(''); // expanded submission id

  // "new race" form (owner)
  const [showNewRace, setShowNewRace] = React.useState(false);
  const [nr, setNr] = React.useState({ name: '', nameHe: '', city: '', cc: '', dist: 'marathon' });
  const setNrField = (k) => (e) => setNr((s) => ({ ...s, [k]: e.target.value }));

  const refresh = React.useCallback((force) => {
    if (!RP_FB_R) { setRaces([]); return Promise.resolve(); }
    return RP_FB_R.racesList(force).then((list) => setRaces(list || []));
  }, []);
  React.useEffect(() => { refresh(false); }, [refresh]);

  const loadSubs = React.useCallback(() => {
    if (!isOwner || !RP_FB_R || !RP_FB_R.submissionsList) return Promise.resolve();
    return RP_FB_R.submissionsList('pending').then((list) => setSubs(list || []));
  }, [isOwner]);
  React.useEffect(() => { loadSubs(); }, [loadSubs]);

  const filtered = React.useMemo(() => {
    const list = races || [];
    const needle = q.trim().toLowerCase();
    return list
      .filter((r) => dist === 'all' || r.distance === dist)
      .filter((r) => !needle || (r.search || (r.name + ' ' + r.city).toLowerCase()).includes(needle))
      .sort((a, b) => {
        const av = a.routeStatus === 'available' ? 0 : 1;
        const bv = b.routeStatus === 'available' ? 0 : 1;
        return av - bv || (a.tier - b.tier) || String(a.name).localeCompare(b.name);
      })
      .slice(0, 120);
  }, [races, q, dist]);

  const pickRace = (rc) => {
    if (rc.routeStatus === 'available') {
      onLoadCourse(courseFromRace(rc));
      if (onRaceName) onRaceName(rc.nameHe || rc.name);
      onClose();
      return;
    }
    // no route yet — carry the name over and nudge toward link/paste
    if (onRaceName) onRaceName(rc.nameHe || rc.name);
    setSelId(rc.id);
    setTab('link');
    setNote(`למרוץ "${rc.nameHe || rc.name}" עדיין אין מסלול. הדביקו כאן קישור ל-GPX או את תוכן הקובץ.`);
  };

  const handleLink = async () => {
    const t = linkText.trim();
    if (!t) return;
    setBusy(true); setErr(''); setNote('');
    try {
      let xml = t;
      let sourceUrl = null;
      if (!looksLikeXml(t)) {
        sourceUrl = t;
        const res = await fetch(t);
        if (!res.ok) throw new Error('השרת החזיר ' + res.status);
        xml = await res.text();
        if (looksLikeXml(xml) === false && !/<trkpt|<rtept/i.test(xml)) {
          throw new Error('הקישור לא מחזיר קובץ GPX');
        }
      }
      const parsed = parseGpx(xml);
      const built = courseFromGpx(parsed, xml, raceName);
      built.sourceUrl = sourceUrl;
      setPending(built);
      setSubmitted(false);
      setNote(isOwner
        ? 'המסלול נטען. אפשר לצרף אותו לתוכנית, או לשמור אותו בספרייה למטה.'
        : 'המסלול נטען. אפשר לצרף אותו לתוכנית שלך, או להציע אותו למנהל המערכת לצירוף קבוע למרוץ.');
    } catch (e) {
      setErr('לא ניתן לטעון: ' + (e && e.message ? e.message : e) +
        '. אם זה קישור — ייתכן שהאתר חוסם טעינה ישירה מהדפדפן. פתחו אותו, הורידו את קובץ ה-GPX, והשתמשו בכפתור "ייבוא GPX"; או הדביקו כאן את תוכן ה-GPX עצמו.');
    } finally {
      setBusy(false);
    }
  };

  const applyPending = () => {
    if (!pending) return;
    onLoadCourse(pending.course);
    onClose();
  };

  const savePendingToLibrary = async () => {
    if (!pending || !isOwner || !RP_FB_R) return;
    const id = selId;
    if (!id) { setErr('בחרו מרוץ מהרשימה לשיוך המסלול.'); return; }
    setBusy(true); setErr('');
    try {
      const gpxPath = await RP_FB_R.racePutGpx(id, pending.gpxText);
      await RP_FB_R.raceSave(id, {
        routeStatus: 'available',
        distanceKm: round3(pending.course.dist),
        gain: pending.course.gain, loss: pending.course.loss,
        startLat: round5(pending.course.lat), startLon: round5(pending.course.lon),
        profileFlat: pending.profileFlat, trackFlat: pending.trackFlat,
        gpxPath: gpxPath || null,
        sourceUrl: pending.sourceUrl || null,
      });
      onLoadCourse(pending.course);
      onClose();
    } catch (e) {
      setErr('שמירה נכשלה: ' + (e && e.message ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  // ── community: a signed-in (non-owner) user proposes the pending route ──
  const submitPending = async () => {
    if (!pending || !RP_FB_R || !RP_FB_R.submitRoute) return;
    if (!selId) { setErr('בחרו מרוץ מהרשימה.'); return; }
    const race = (races || []).find((r) => r.id === selId);
    if (!race) { setErr('המרוץ לא נמצא. רעננו ונסו שוב.'); return; }
    setBusy(true); setErr('');
    try {
      const id = RP_FB_R.submissionId();
      const gpxPath = pending.gpxText ? await RP_FB_R.submitPutGpx(id, pending.gpxText) : '';
      const user = (window.RP_FIREBASE && window.RP_FIREBASE.user) || null;
      const rec = buildSubmissionRecord({ ...pending, gpxPath: gpxPath || null }, race, user);
      const res = await RP_FB_R.submitRoute(id, rec);
      if (res !== 'ok') throw new Error('השליחה נדחתה');
      setSubmitted(true);
      setNote('תודה! ההצעה נשלחה למנהל המערכת לבדיקה. המסלול כבר טעון בתוכנית שלך.');
      onLoadCourse(pending.course);
    } catch (e) {
      setErr('שליחת ההצעה נכשלה: ' + (e && e.message ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  // ── owner review queue ────────────────────────────────────────────────
  const approveSub = async (s) => {
    if (!isOwner || !RP_FB_R) return;
    setSubBusy(s.id); setErr('');
    try {
      const saveRes = await RP_FB_R.raceSave(s.raceId, {
        routeStatus: 'available',
        distanceKm: round3(s.distanceKm || 0),
        gain: s.gain || 0, loss: s.loss || 0,
        startLat: s.startLat != null ? round5(s.startLat) : null,
        startLon: s.startLon != null ? round5(s.startLon) : null,
        profileFlat: s.profileFlat || null,
        trackFlat: s.trackFlat || [],
        gpxPath: s.gpxPath || null,
        sourceUrl: s.sourceUrl || null,
        contributor: s.submitterEmail || null,
        routeFrom: 'community',
      });
      if (saveRes !== 'ok') throw new Error('שמירת המרוץ נדחתה');
      await RP_FB_R.submissionReview(s.id, 'approved');
      setSubs((list) => (list || []).filter((x) => x.id !== s.id));
      await refresh(true);
      setNote(`המסלול שולב במרוץ "${s.raceName || s.raceId}".`);
    } catch (e) {
      setErr('אישור נכשל: ' + (e && e.message ? e.message : e));
    } finally {
      setSubBusy('');
    }
  };

  const rejectSub = async (s) => {
    if (!isOwner || !RP_FB_R) return;
    setSubBusy(s.id); setErr('');
    try {
      await RP_FB_R.submissionReview(s.id, 'rejected');
      setSubs((list) => (list || []).filter((x) => x.id !== s.id));
      setNote('ההצעה נדחתה.');
    } catch (e) {
      setErr('הדחייה נכשלה: ' + (e && e.message ? e.message : e));
    } finally {
      setSubBusy('');
    }
  };

  const previewSub = (s) => {
    onLoadCourse(courseFromSubmission(s));
    onClose();
  };

  const runSeed = async () => {
    if (!isOwner || !RP_FB_R) return;
    setSeeding(true); setErr('');
    try {
      const res = await fetch('races-seed.json', { cache: 'no-store' });
      const recs = await res.json();
      const n = await RP_FB_R.racesSeed(recs);
      setNote(`נוספו ${n} מרוצים לספרייה.`);
      refresh(true);
    } catch (e) {
      setErr('טעינת הקטלוג נכשלה: ' + (e && e.message ? e.message : e));
    } finally {
      setSeeding(false);
    }
  };

  const createRace = async () => {
    if (!isOwner || !RP_FB_R) return;
    const name = nr.name.trim();
    const nameHe = nr.nameHe.trim();
    if (!name && !nameHe) { setErr('צריך שם למרוץ (אנגלית או עברית).'); return; }
    setBusy(true); setErr(''); setNote('');
    try {
      const taken = new Set((races || []).map((r) => r.id));
      const id = makeRaceId(name || rl_slug(nameHe), nr.city, nr.dist, taken);
      const cc = nr.cc.trim().toUpperCase().slice(0, 2);
      const km = nr.dist === 'marathon' ? 42.195 : nr.dist === 'half_marathon' ? 21.0975 : null;
      await RP_FB_R.raceSave(id, {
        name: name || nameHe,
        nameHe: nameHe || null,
        distance: nr.dist,
        distanceKm: km,
        city: nr.city.trim(),
        countryCode: cc,
        tier: 3,
        seed: false,
        routeStatus: 'none',
        search: [name, nameHe, nr.city, cc, nr.dist]
          .join(' ').toLowerCase().replace(/\s+/g, ' ').trim(),
      });
      setNr({ name: '', nameHe: '', city: '', cc: '', dist: 'marathon' });
      setShowNewRace(false);
      await refresh(true);
      setSelId(id);
      setNote(`המרוץ "${nameHe || name}" נוסף${pending ? ' — אפשר לשמור אליו את המסלול למטה.' : '.'}`);
    } catch (e) {
      setErr('יצירת מרוץ נכשלה: ' + (e && e.message ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const TEXT = 'var(--rp-text)';
  const DIM = 'var(--rp-text-dim)';
  const BD = 'var(--rp-line)';
  const FIELD_BG = 'var(--rp-surface-2)';
  const FIELD_BD = 'var(--rp-line-input)';
  const fieldStyle = {
    width: '100%', background: FIELD_BG, border: `1px solid ${FIELD_BD}`,
    borderRadius: 8, padding: '8px 10px', fontSize: 13, color: TEXT,
    fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  };
  const tabBtn = (id, label) => (
    <button onClick={() => { setTab(id); setErr(''); }} style={{
      flex: 1, padding: '9px 10px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
      background: tab === id ? 'var(--rp-gold-wash)' : 'transparent',
      color: tab === id ? 'var(--rp-gold)' : DIM,
      border: 'none', borderBottom: `2px solid ${tab === id ? 'var(--rp-gold)' : 'transparent'}`,
      fontFamily: 'inherit',
    }}>{label}</button>
  );

  return ReactDOM.createPortal((
    <div
      className="rp-sheet-wrap rp-cq-scope"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(9,11,22,.78)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, direction: 'rtl', fontFamily: 'var(--rp-font-ui)', color: TEXT,
      }}
    >
      <style>{`
        @media (max-width: 640px){
          .rp-sheet-wrap{ align-items: flex-end !important; padding: 0 !important; }
          .rl-sheet{ max-width: none !important; width: 100% !important;
            max-height: 92vh !important; border-radius: 20px 20px 0 0 !important; }
          .rl-sheet input, .rl-sheet textarea, .rl-sheet button{ font-size: 15px; }
          .rl-row{ min-height: 52px; }
        }
      `}</style>

      <div className="rl-sheet" style={{
        background: 'var(--rp-surface)', border: `1px solid ${BD}`,
        borderRadius: 'var(--rp-r-14)', width: '100%', maxWidth: 640, maxHeight: '88vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: 'var(--rp-shadow-modal)', direction: 'rtl',
      }}>

        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: `1px solid ${BD}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--rp-gold)"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3Z" /><path d="M9 3v15M15 6v15" />
            </svg>
            <span style={{ fontSize: 17, fontWeight: 800 }}>ספריית מסלולים</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer',
            color: DIM, fontSize: 20, lineHeight: 1, padding: '2px 6px' }}>✕</button>
        </div>

        {/* tabs */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${BD}` }}>
          {tabBtn('library', 'חיפוש מרוץ')}
          {tabBtn('link', 'קישור / הדבקה')}
          {isOwner && tabBtn('inbox',
            `הצעות מהקהילה${subs && subs.length ? ` (${subs.length})` : ''}`)}
        </div>

        {/* body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', minHeight: 0 }}>

          {tab === 'library' && (
            <>
              <input
                value={q} onChange={(e) => setQ(e.target.value)} autoFocus
                placeholder="שם מרוץ או עיר…"
                style={{ width: '100%', background: FIELD_BG, border: `1px solid ${FIELD_BD}`,
                  borderRadius: 10, padding: '9px 12px', fontSize: 14, color: TEXT,
                  fontFamily: 'inherit', outline: 'none' }}
              />
              <div style={{ display: 'flex', gap: 6, margin: '10px 0 4px', alignItems: 'center', flexWrap: 'wrap' }}>
                {[['all', 'הכל'], ['marathon', 'מרתון'], ['half_marathon', 'חצי מרתון']].map(([v, l]) => (
                  <button key={v} onClick={() => setDist(v)} style={{
                    padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    borderRadius: 999, fontFamily: 'inherit',
                    background: dist === v ? 'var(--rp-gold-wash)' : 'transparent',
                    color: dist === v ? 'var(--rp-gold)' : DIM,
                    border: `1px solid ${dist === v ? 'var(--rp-gold-line)' : BD}`,
                  }}>{l}</button>
                ))}
                {isOwner && (
                  <button onClick={() => { setShowNewRace((v) => !v); setErr(''); }} style={{
                    marginInlineStart: 'auto', padding: '6px 12px', fontSize: 12, fontWeight: 700,
                    cursor: 'pointer', borderRadius: 999, fontFamily: 'inherit',
                    background: showNewRace ? 'var(--rp-gold-wash)' : 'transparent',
                    color: showNewRace ? 'var(--rp-gold)' : DIM,
                    border: `1px solid ${showNewRace ? 'var(--rp-gold-line)' : BD}`,
                  }}>{showNewRace ? 'ביטול' : '+ מרוץ חדש'}</button>
                )}
              </div>

              {isOwner && showNewRace && (
                <div style={{ margin: '8px 0 10px', padding: 12, border: `1px solid ${BD}`,
                  borderRadius: 10, background: 'var(--rp-surface-2)', display: 'grid', gap: 8 }}>
                  <input value={nr.name} onChange={setNrField('name')} style={fieldStyle}
                    placeholder="שם באנגלית (למשל Eilat Marathon)" />
                  <input value={nr.nameHe} onChange={setNrField('nameHe')} style={fieldStyle}
                    placeholder="שם בעברית (אופציונלי)" />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input value={nr.city} onChange={setNrField('city')} style={{ ...fieldStyle, flex: 1 }}
                      placeholder="עיר" />
                    <input value={nr.cc} onChange={setNrField('cc')} maxLength={2}
                      style={{ ...fieldStyle, width: 96, flex: '0 0 auto', textTransform: 'uppercase' }}
                      placeholder="מדינה" />
                  </div>
                  <select value={nr.dist} onChange={setNrField('dist')} style={fieldStyle}>
                    <option value="marathon">מרתון</option>
                    <option value="half_marathon">חצי מרתון</option>
                    <option value="custom">מרחק אחר</option>
                  </select>
                  <button onClick={createRace} disabled={busy} className="rp-btn rp-btn-primary">
                    {busy ? 'שומר…' : 'צור מרוץ'}
                  </button>
                </div>
              )}

              {races === null && (
                <div style={{ padding: 24, textAlign: 'center', color: DIM, fontSize: 13 }}>טוען…</div>
              )}

              {races && races.length === 0 && (
                <div style={{ padding: '16px 8px', textAlign: 'center', color: DIM, fontSize: 13 }}>
                  הספרייה ריקה.
                  {isOwner && (
                    <div style={{ marginTop: 10 }}>
                      <button onClick={runSeed} disabled={seeding} className="rp-btn rp-btn-primary">
                        {seeding ? 'טוען…' : 'טען קטלוג מרוצים בסיסי'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {races && races.length > 0 && filtered.length === 0 && (
                <div style={{ padding: '16px 8px', textAlign: 'center', color: DIM, fontSize: 13 }}>
                  אין תוצאות ל"{q}".
                </div>
              )}

              <div style={{ marginTop: 6 }}>
                {filtered.map((rc) => (
                  <div key={rc.id} className="rl-row" onClick={() => pickRace(rc)} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 8px',
                    borderRadius: 10, cursor: 'pointer', borderBottom: `1px solid ${BD}`,
                  }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--rp-surface-2)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                    <span style={{ fontSize: 18, flex: '0 0 auto' }}>{flagFor(rc.countryCode)}</span>
                    <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap',
                        overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {rc.nameHe || rc.name}
                      </div>
                      <div style={{ fontSize: 11.5, color: DIM, marginTop: 2 }}>
                        {rc.city}{rc.city ? ' · ' : ''}{DIST_LABEL[rc.distance] || ''}
                      </div>
                    </div>
                    <StatusBadge status={rc.routeStatus} />
                  </div>
                ))}
              </div>

              {isOwner && races && races.length > 0 && races.length < 40 && (
                <div style={{ marginTop: 12, textAlign: 'center' }}>
                  <button onClick={runSeed} disabled={seeding} className="rp-btn" style={{ fontSize: 12 }}>
                    {seeding ? 'טוען…' : 'השלם קטלוג מרוצים בסיסי'}
                  </button>
                </div>
              )}
            </>
          )}

          {tab === 'link' && (
            <>
              <div style={{ fontSize: 12.5, color: DIM, marginBottom: 8, lineHeight: 1.6 }}>
                הדביקו כתובת של קובץ <b>.gpx</b>, או את תוכן ה-GPX עצמו (ה-XML).
                קישורי Strava/Komoot מלאים יתווספו בהמשך.
              </div>
              <textarea
                value={linkText} onChange={(e) => setLinkText(e.target.value)} rows={5}
                placeholder="https://…/route.gpx    או    <?xml version…><gpx …>"
                style={{ width: '100%', background: FIELD_BG, border: `1px solid ${FIELD_BD}`,
                  borderRadius: 10, padding: '10px 12px', fontSize: 13, color: TEXT,
                  fontFamily: 'ui-monospace, monospace', outline: 'none', resize: 'vertical' }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button onClick={handleLink} disabled={busy || !linkText.trim()}
                  className="rp-btn rp-btn-primary">
                  {busy ? 'טוען…' : 'טען מסלול'}
                </button>
                {pending && (
                  <button onClick={applyPending} className="rp-btn">צרף לתוכנית</button>
                )}
              </div>

              {isOwner && pending && (
                <div style={{ marginTop: 14, padding: 12, borderRadius: 10,
                  border: `1px solid ${BD}`, background: 'var(--rp-surface-2)' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
                    שמירה בספרייה — שייכו למרוץ:
                  </div>
                  <select value={selId} onChange={(e) => setSelId(e.target.value)}
                    style={{ width: '100%', background: FIELD_BG, border: `1px solid ${FIELD_BD}`,
                      borderRadius: 8, padding: '8px 10px', fontSize: 13, color: TEXT,
                      fontFamily: 'inherit', outline: 'none' }}>
                    <option value="">— בחרו מרוץ —</option>
                    {(races || []).slice()
                      .sort((a, b) => String(a.name).localeCompare(b.name))
                      .map((rc) => (
                        <option key={rc.id} value={rc.id}>
                          {(rc.nameHe || rc.name) + (rc.routeStatus === 'available' ? ' ✓' : '')}
                        </option>
                      ))}
                  </select>
                  <button onClick={savePendingToLibrary} disabled={busy || !selId}
                    className="rp-btn rp-btn-primary" style={{ marginTop: 10 }}>
                    {busy ? 'שומר…' : 'שמור מסלול בספרייה'}
                  </button>
                </div>
              )}

              {!isOwner && pending && RP_FB_R && RP_FB_R.submitRoute && (
                <div style={{ marginTop: 14, padding: 12, borderRadius: 10,
                  border: `1px solid ${BD}`, background: 'var(--rp-surface-2)' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
                    הצעת המסלול למנהל המערכת — בחרו מרוץ:
                  </div>
                  <select value={selId} onChange={(e) => setSelId(e.target.value)}
                    disabled={submitted}
                    style={{ width: '100%', background: FIELD_BG, border: `1px solid ${FIELD_BD}`,
                      borderRadius: 8, padding: '8px 10px', fontSize: 13, color: TEXT,
                      fontFamily: 'inherit', outline: 'none' }}>
                    <option value="">— בחרו מרוץ —</option>
                    {(races || []).slice()
                      .sort((a, b) => String(a.name).localeCompare(b.name))
                      .map((rc) => (
                        <option key={rc.id} value={rc.id}>
                          {(rc.nameHe || rc.name) + (rc.routeStatus === 'available' ? ' ✓' : '')}
                        </option>
                      ))}
                  </select>
                  <button onClick={submitPending} disabled={busy || !selId || submitted}
                    className="rp-btn rp-btn-primary" style={{ marginTop: 10 }}>
                    {submitted ? 'ההצעה נשלחה ✓' : busy ? 'שולח…' : 'שלח הצעה למנהל המערכת'}
                  </button>
                  <div style={{ fontSize: 11, color: DIM, marginTop: 6, lineHeight: 1.5 }}>
                    מנהל המערכת יבדוק את המסלול ויחליט אם לצרף אותו דרך קבע למרוץ.
                    עד אז המסלול זמין לתוכנית שלכם.
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'inbox' && isOwner && (
            <>
              {subs === null && (
                <div style={{ padding: 24, textAlign: 'center', color: DIM, fontSize: 13 }}>טוען…</div>
              )}
              {subs && subs.length === 0 && (
                <div style={{ padding: '16px 8px', textAlign: 'center', color: DIM, fontSize: 13 }}>
                  אין הצעות ממתינות מהקהילה.
                </div>
              )}
              {subs && subs.map((s) => {
                const open = expanded === s.id;
                const trk = decodeFlatCourse(s).track || [];
                return (
                  <div key={s.id} style={{ border: `1px solid ${BD}`, borderRadius: 10,
                    marginBottom: 10, overflow: 'hidden', background: 'var(--rp-surface-2)' }}>
                    <div onClick={() => setExpanded(open ? '' : s.id)}
                      style={{ cursor: 'pointer', padding: '10px 12px' }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700 }}>{s.raceName || s.raceId}</div>
                      <div style={{ fontSize: 11.5, color: DIM, marginTop: 2 }}>
                        {s.submitterEmail || 'משתמש'} · {round1(s.distanceKm || 0)} ק"מ ·
                        {' '}↑{Math.round(s.gain || 0)} ↓{Math.round(s.loss || 0)} · {fmtSubDate(s.createdAt)}
                      </div>
                      {(s.courseName || s.source) && (
                        <div style={{ fontSize: 11, color: DIM, marginTop: 2 }}>
                          {[s.courseName, s.source].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </div>
                    {open && (
                      <div style={{ padding: '0 12px 12px' }}>
                        {RouteMap && trk.length > 1 && <RouteMap track={trk} height={160} />}
                        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                          <button className="rp-btn" onClick={() => previewSub(s)}>טען לתצוגה</button>
                          <button className="rp-btn rp-btn-primary" disabled={subBusy === s.id}
                            onClick={() => approveSub(s)}>
                            {subBusy === s.id ? 'מאשר…' : 'אשר ושייך למרוץ'}
                          </button>
                          <button className="rp-btn" disabled={subBusy === s.id}
                            onClick={() => rejectSub(s)}>דחה</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {note && (
            <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--rp-gold)',
              background: 'var(--rp-gold-wash)', border: '1px solid var(--rp-gold-line)',
              borderRadius: 8, padding: '8px 10px' }}>{note}</div>
          )}
          {err && (
            <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--rp-danger, #d9736a)',
              border: '1px solid var(--rp-danger, #d9736a)', borderRadius: 8, padding: '8px 10px',
              lineHeight: 1.6 }}>{err}</div>
          )}
        </div>
      </div>
    </div>
  ), document.body);
}

window.RouteLibrary = RouteLibrary;

// Used by planner-b's "ייבוא GPX" so a file-picked route can also be saved to
// the library: returns the same { course, gpxText, profileFlat, trackFlat }
// "pending" shape RouteLibrary expects as initialPending.
window.RP_ROUTES = {
  buildFromGpx(parsed, xml, fallbackName, source) {
    try { return courseFromGpx(parsed, xml, fallbackName, source); }
    catch (e) { return null; }
  },
  buildSubmissionRecord,
  courseFromSubmission,
};
