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

function RouteLibrary({ onClose, onLoadCourse, raceName, onRaceName, isOwner, initialPending, zIndex = 1000 }) {
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
  const fileRef = React.useRef(null);

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
      .filter((r) => isOwner || r.listed !== false)
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
    setNote(`למרוץ "${rc.nameHe || rc.name}" עדיין אין מסלול. העלו קובץ GPX או הדביקו קישור ישיר לקובץ .gpx.`);
  };

  // shared tail: parsed GPX xml → pending course
  const acceptGpx = (xml, sourceUrl, fallbackName, sourceLabel) => {
    if (!looksLikeXml(xml) && !/<trkpt|<rtept/i.test(xml)) {
      throw new Error(sourceUrl ? 'הקישור לא מחזיר קובץ GPX' : 'הקובץ אינו קובץ GPX תקין');
    }
    const parsed = parseGpx(xml);
    const built = courseFromGpx(parsed, xml, parsed.name || fallbackName || raceName, sourceLabel);
    built.sourceUrl = sourceUrl || null;
    setPending(built);
    setSubmitted(false);
    setNote(isOwner
      ? 'המסלול נטען. אפשר לצרף אותו לתוכנית, או לשמור אותו בספרייה למטה.'
      : 'המסלול נטען. אפשר לצרף אותו לתוכנית שלך, או להציע אותו למנהל המערכת לצירוף קבוע למרוץ.');
  };

  const handleUrl = async () => {
    const url = linkText.trim();
    if (!url) return;
    setBusy(true); setErr(''); setNote('');
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('השרת החזיר ' + res.status);
      acceptGpx(await res.text(), url, null, 'קישור');
    } catch (e) {
      setErr('לא ניתן לטעון מהקישור: ' + (e && e.message ? e.message : e) +
        '. ייתכן שהאתר חוסם טעינה ישירה מהדפדפן — הורידו את קובץ ה-GPX והעלו אותו כאן.');
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setErr(''); setNote('');
    try {
      acceptGpx(await file.text(), null, file.name.replace(/\.gpx$/i, ''), 'קובץ GPX');
    } catch (er) {
      setErr('לא ניתן לקרוא את הקובץ: ' + (er && er.message ? er.message : er));
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
        listed: true,
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
        position: 'fixed', inset: 0, zIndex,
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
          {tabBtn('link', 'קובץ / קישור')}
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
              <div style={{ fontSize: 12.5, color: DIM, marginBottom: 10, lineHeight: 1.6 }}>
                העלו קובץ <b>.gpx</b> מהמכשיר, או הדביקו כתובת ישירה לקובץ <b>.gpx</b>.
                קישורי Strava/Komoot מלאים יתווספו בהמשך.
              </div>

              <button onClick={() => fileRef.current && fileRef.current.click()} disabled={busy}
                className="rp-btn rp-btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                {busy ? 'טוען…' : 'העלה קובץ GPX'}
              </button>
              <input ref={fileRef} type="file" accept=".gpx,application/gpx+xml,text/xml"
                onChange={handleFile} style={{ display: 'none' }} />

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '12px 0' }}>
                <span style={{ flex: 1, height: 1, background: BD }} />
                <span style={{ fontSize: 11.5, color: DIM }}>או קישור</span>
                <span style={{ flex: 1, height: 1, background: BD }} />
              </div>

              <input
                type="url" value={linkText} onChange={(e) => setLinkText(e.target.value)}
                placeholder="https://…/route.gpx"
                style={{ width: '100%', background: FIELD_BG, border: `1px solid ${FIELD_BD}`,
                  borderRadius: 10, padding: '10px 12px', fontSize: 13, color: TEXT,
                  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', direction: 'ltr' }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button onClick={handleUrl} disabled={busy || !linkText.trim()}
                  className="rp-btn">
                  {busy ? 'טוען…' : 'טען מקישור'}
                </button>
                {pending && (
                  <button onClick={applyPending} className="rp-btn rp-btn-primary">צרף לתוכנית</button>
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

// ── RaceAdminPanel (window.RaceAdminPanel) ────────────────────────────────
// Owner-only race catalog manager, opened from the Hub. Per race: show / hide
// (listed flag), edit core fields, attach / replace / detach a GPX route (file
// upload or a direct .gpx link, inside the edit form), delete. Bulk show / hide
// / delete on a multi-select. New races via the same "+ מרוץ חדש" form as the
// route library.
const DIST_OPTS = [
  ['marathon', 'מרתון'], ['half_marathon', 'חצי מרתון'], ['custom', 'מרחק אחר'],
];
const KM_FOR = { marathon: 42.195, half_marathon: 21.0975 };

function buildSearch(r) {
  return [r.name, r.nameHe, r.city, r.countryCode, r.distance]
    .filter(Boolean).join(' ').toLowerCase().replace(/\s+/g, ' ').trim();
}

function RaceAdminPanel({ onClose, zIndex = 1000 }) {
  const [races, setRaces] = React.useState(null);   // null = loading
  const [q, setQ] = React.useState('');
  const [dist, setDist] = React.useState('all');
  const [vis, setVis] = React.useState('all');       // all | shown | hidden
  const [sel, setSel] = React.useState(() => new Set());
  const [busy, setBusy] = React.useState('');        // race id mid-write ('*' = bulk)
  const [editId, setEditId] = React.useState('');
  const [ef, setEf] = React.useState(null);          // edit form fields
  const [confirmId, setConfirmId] = React.useState('');
  const [detachId, setDetachId] = React.useState('');
  const [pend, setPend] = React.useState(null);        // parsed route awaiting save (for editId)
  const [routeUrl, setRouteUrl] = React.useState('');
  const [routeLoading, setRouteLoading] = React.useState(false);
  const routeFileRef = React.useRef(null);
  const [note, setNote] = React.useState('');
  const [err, setErr] = React.useState('');
  const [showNewRace, setShowNewRace] = React.useState(false);
  const [nr, setNr] = React.useState({ name: '', nameHe: '', city: '', cc: '', dist: 'marathon' });
  const setNrField = (k) => (e) => setNr((s) => ({ ...s, [k]: e.target.value }));

  const load = React.useCallback((force) => {
    if (!RP_FB_R) { setRaces([]); return Promise.resolve(); }
    return RP_FB_R.racesList(force).then((list) => setRaces((list || []).slice()));
  }, []);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (RP_FB_R && RP_FB_R.racesEnsureListed) {
          const n = await RP_FB_R.racesEnsureListed();
          if (alive && n) setNote(`סומנו ${n} מרוצים ותיקים כ"מוצג".`);
        }
      } catch (e) { /* non-fatal */ }
      if (alive) load(true);
    })();
    return () => { alive = false; };
  }, [load]);

  const patch = (id, fields) =>
    setRaces((list) => (list || []).map((r) => (r.id === id ? { ...r, ...fields } : r)));

  const isShown = (r) => r.listed !== false;

  const filtered = React.useMemo(() => {
    const list = races || [];
    const needle = q.trim().toLowerCase();
    return list
      .filter((r) => dist === 'all' || r.distance === dist)
      .filter((r) => vis === 'all' || (vis === 'shown' ? isShown(r) : !isShown(r)))
      .filter((r) => !needle || (r.search || buildSearch(r)).includes(needle))
      .sort((a, b) => (a.tier - b.tier)
        || String(a.nameHe || a.name).localeCompare(String(b.nameHe || b.name), 'he'));
  }, [races, q, dist, vis]);

  const shownCount = (races || []).filter(isShown).length;

  // ── single-race actions ────────────────────────────────────────────────
  const toggleListed = async (r) => {
    if (!RP_FB_R) return;
    const next = !isShown(r);
    setBusy(r.id); setErr('');
    try {
      const res = await RP_FB_R.raceSave(r.id, { listed: next });
      if (res !== 'ok') throw new Error('העדכון נדחה');
      patch(r.id, { listed: next });
    } catch (e) {
      setErr('לא ניתן לעדכן: ' + (e && e.message ? e.message : e));
    } finally { setBusy(''); }
  };

  const startEdit = (r) => {
    setEditId(r.id); setConfirmId(''); setDetachId(''); setErr('');
    setPend(null); setRouteUrl('');
    setEf({
      nameHe: r.nameHe || '', name: r.name || '', city: r.city || '',
      cc: r.countryCode || '', dist: r.distance || 'custom',
      tier: r.tier == null ? 3 : r.tier,
    });
  };

  const closeEdit = () => { setEditId(''); setEf(null); setPend(null); setRouteUrl(''); setDetachId(''); };

  const saveEdit = async (r) => {
    if (!RP_FB_R || !ef) return;
    const name = ef.name.trim();
    const nameHe = ef.nameHe.trim();
    if (!name && !nameHe) { setErr('צריך שם למרוץ (עברית או אנגלית).'); return; }
    setBusy(r.id); setErr('');
    const cc = ef.cc.trim().toUpperCase().slice(0, 2);
    const tier = Math.max(1, Math.min(5, parseInt(ef.tier, 10) || 3));
    const km = KM_FOR[ef.dist] != null ? KM_FOR[ef.dist] : (r.distanceKm || null);
    const next = {
      name: name || nameHe, nameHe: nameHe || null, city: ef.city.trim(),
      countryCode: cc, distance: ef.dist, distanceKm: km, tier,
    };
    next.search = buildSearch({ ...r, ...next });
    try {
      const res = await RP_FB_R.raceSave(r.id, next);
      if (res !== 'ok') throw new Error('השמירה נדחתה');
      patch(r.id, next);
      closeEdit();
      setNote(`"${nameHe || name}" עודכן.`);
    } catch (e) {
      setErr('שמירה נכשלה: ' + (e && e.message ? e.message : e));
    } finally { setBusy(''); }
  };

  const detachRoute = async (r) => {
    if (!RP_FB_R) return;
    setBusy(r.id); setErr('');
    const cleared = {
      routeStatus: 'none', profileFlat: null, trackFlat: null, gpxPath: null,
      sourceUrl: null, gain: null, loss: null, startLat: null, startLon: null,
    };
    try {
      const res = await RP_FB_R.raceSave(r.id, cleared);
      if (res !== 'ok') throw new Error('הפעולה נדחתה');
      patch(r.id, cleared);
      setDetachId('');
      setNote(`המסלול נותק מ"${r.nameHe || r.name}".`);
    } catch (e) {
      setErr('ניתוק המסלול נכשל: ' + (e && e.message ? e.message : e));
    } finally { setBusy(''); }
  };

  // ── attach a route while editing (file upload or a direct .gpx link) ────
  const acceptRouteGpx = (xml, sourceUrl, fallbackName) => {
    if (!looksLikeXml(xml) && !/<trkpt|<rtept/i.test(xml)) {
      throw new Error(sourceUrl ? 'הקישור לא מחזיר קובץ GPX' : 'הקובץ אינו קובץ GPX תקין');
    }
    const parsed = parseGpx(xml);
    const built = courseFromGpx(parsed, xml, parsed.name || fallbackName,
      sourceUrl ? 'קישור' : 'קובץ GPX');
    setPend({
      course: built.course, gpxText: built.gpxText,
      profileFlat: built.profileFlat, trackFlat: built.trackFlat,
      sourceUrl: sourceUrl || null,
    });
  };

  const loadRouteFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setRouteLoading(true); setErr('');
    try {
      acceptRouteGpx(await file.text(), null, file.name.replace(/\.gpx$/i, ''));
    } catch (er) {
      setErr('קריאת הקובץ נכשלה: ' + (er && er.message ? er.message : er));
    } finally { setRouteLoading(false); }
  };

  const loadRouteUrl = async () => {
    const url = routeUrl.trim();
    if (!url) return;
    setRouteLoading(true); setErr('');
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('השרת החזיר ' + res.status);
      acceptRouteGpx(await res.text(), url);
    } catch (e) {
      setErr('טעינת המסלול מהקישור נכשלה: ' + (e && e.message ? e.message : e)
        + '. ייתכן שהאתר חוסם טעינה ישירה — הורידו את הקובץ והעלו אותו.');
    } finally { setRouteLoading(false); }
  };

  const saveRoute = async (r) => {
    if (!RP_FB_R || !pend) return;
    setBusy(r.id); setErr('');
    try {
      const c = pend.course;
      const gpxPath = pend.gpxText ? await RP_FB_R.racePutGpx(r.id, pend.gpxText) : '';
      const next = {
        routeStatus: 'available',
        distanceKm: round3(c.dist || 0),
        gain: Math.round(c.gain || 0), loss: Math.round(c.loss || 0),
        startLat: c.lat != null ? round5(c.lat) : null,
        startLon: c.lon != null ? round5(c.lon) : null,
        profileFlat: pend.profileFlat || null,
        trackFlat: pend.trackFlat || [],
        gpxPath: gpxPath || null,
        sourceUrl: pend.sourceUrl || null,
      };
      const res = await RP_FB_R.raceSave(r.id, next);
      if (res !== 'ok') throw new Error('השמירה נדחתה');
      patch(r.id, next);
      setPend(null); setRouteUrl('');
      setNote(`מסלול צורף ל"${r.nameHe || r.name}" · ${round1(c.dist || 0)} ק"מ.`);
    } catch (e) {
      setErr('צירוף המסלול נכשל: ' + (e && e.message ? e.message : e));
    } finally { setBusy(''); }
  };

  const del = async (r) => {
    if (!RP_FB_R || !RP_FB_R.raceDelete) return;
    setBusy(r.id); setErr('');
    try {
      const res = await RP_FB_R.raceDelete(r.id);
      if (res !== 'ok') throw new Error('המחיקה נדחתה');
      setRaces((list) => (list || []).filter((x) => x.id !== r.id));
      setSel((s) => { const n = new Set(s); n.delete(r.id); return n; });
      setConfirmId('');
      setNote(`"${r.nameHe || r.name}" נמחק מהקטלוג.`);
    } catch (e) {
      setErr('מחיקה נכשלה: ' + (e && e.message ? e.message : e));
    } finally { setBusy(''); }
  };

  // ── bulk actions ───────────────────────────────────────────────────────
  const bulk = async (kind) => {
    if (!RP_FB_R || !sel.size) return;
    const ids = [...sel];
    setBusy('*'); setErr('');
    let ok = 0;
    for (const id of ids) {
      try {
        if (kind === 'delete') {
          // eslint-disable-next-line no-await-in-loop
          if ((await RP_FB_R.raceDelete(id)) === 'ok') ok++;
        } else {
          const listed = kind === 'show';
          // eslint-disable-next-line no-await-in-loop
          if ((await RP_FB_R.raceSave(id, { listed })) === 'ok') { patch(id, { listed }); ok++; }
        }
      } catch (e) { /* keep going */ }
    }
    if (kind === 'delete') {
      setRaces((list) => (list || []).filter((x) => !sel.has(x.id)));
    }
    setSel(new Set());
    setBusy('');
    setNote(kind === 'delete' ? `${ok} מרוצים נמחקו.`
      : kind === 'show' ? `${ok} מרוצים סומנו כ"מוצג".`
        : `${ok} מרוצים הוסתרו.`);
  };

  const toggleSel = (id) => setSel((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const allVisibleSelected = filtered.length > 0 && filtered.every((r) => sel.has(r.id));
  const toggleSelAll = () => setSel((s) => {
    if (allVisibleSelected) { const n = new Set(s); filtered.forEach((r) => n.delete(r.id)); return n; }
    const n = new Set(s); filtered.forEach((r) => n.add(r.id)); return n;
  });

  const createRace = async () => {
    if (!RP_FB_R) return;
    const name = nr.name.trim();
    const nameHe = nr.nameHe.trim();
    if (!name && !nameHe) { setErr('צריך שם למרוץ (אנגלית או עברית).'); return; }
    setBusy('*'); setErr(''); setNote('');
    try {
      const taken = new Set((races || []).map((r) => r.id));
      const id = makeRaceId(name || rl_slug(nameHe), nr.city, nr.dist, taken);
      const cc = nr.cc.trim().toUpperCase().slice(0, 2);
      const km = KM_FOR[nr.dist] != null ? KM_FOR[nr.dist] : null;
      const rec = {
        name: name || nameHe, nameHe: nameHe || null, distance: nr.dist, distanceKm: km,
        city: nr.city.trim(), countryCode: cc, tier: 3, seed: false, listed: true,
        routeStatus: 'none',
      };
      rec.search = buildSearch(rec);
      const res = await RP_FB_R.raceSave(id, rec);
      if (res !== 'ok') throw new Error('היצירה נדחתה');
      setNr({ name: '', nameHe: '', city: '', cc: '', dist: 'marathon' });
      setShowNewRace(false);
      await load(true);
      setNote(`המרוץ "${nameHe || name}" נוסף לקטלוג.`);
    } catch (e) {
      setErr('יצירת מרוץ נכשלה: ' + (e && e.message ? e.message : e));
    } finally { setBusy(''); }
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
  const miniBtn = (extra) => ({
    padding: '5px 10px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
    borderRadius: 999, fontFamily: 'inherit', background: 'transparent',
    color: DIM, border: `1px solid ${BD}`, ...extra,
  });
  const pill = (on) => ({
    padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
    borderRadius: 999, fontFamily: 'inherit',
    background: on ? 'var(--rp-gold-wash)' : 'transparent',
    color: on ? 'var(--rp-gold)' : DIM,
    border: `1px solid ${on ? 'var(--rp-gold-line)' : BD}`,
  });

  return ReactDOM.createPortal((
    <div
      className="rp-sheet-wrap rp-cq-scope"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex,
        background: 'rgba(9,11,22,.78)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, direction: 'rtl', fontFamily: 'var(--rp-font-ui)', color: TEXT,
      }}
    >
      <style>{`
        @media (max-width: 640px){
          .rp-sheet-wrap{ align-items: flex-end !important; padding: 0 !important; }
          .ra-sheet{ max-width: none !important; width: 100% !important;
            max-height: 92vh !important; border-radius: 20px 20px 0 0 !important; }
          .ra-sheet input, .ra-sheet select, .ra-sheet button{ font-size: 15px; }
        }
      `}</style>

      <div className="ra-sheet" style={{
        background: 'var(--rp-surface)', border: `1px solid ${BD}`,
        borderRadius: 'var(--rp-r-14)', width: '100%', maxWidth: 680, maxHeight: '88vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: 'var(--rp-shadow-modal)', direction: 'rtl',
      }}>

        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: `1px solid ${BD}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--rp-gold)"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3Z" /><path d="M9 3v15M15 6v15" />
            </svg>
            <span style={{ fontSize: 17, fontWeight: 800 }}>ניהול מרוצים</span>
            {races && (
              <span style={{ fontSize: 11.5, color: DIM }}>
                {shownCount} מוצגים · {races.length} סה"כ
              </span>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer',
            color: DIM, fontSize: 20, lineHeight: 1, padding: '2px 6px' }}>✕</button>
        </div>

        {/* filters */}
        <div style={{ padding: '12px 16px 8px', borderBottom: `1px solid ${BD}` }}>
          <input
            value={q} onChange={(e) => setQ(e.target.value)} autoFocus
            placeholder="שם מרוץ או עיר…"
            style={{ width: '100%', background: FIELD_BG, border: `1px solid ${FIELD_BD}`,
              borderRadius: 10, padding: '9px 12px', fontSize: 14, color: TEXT,
              fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {[['all', 'הכל'], ['shown', 'מוצגים'], ['hidden', 'מוסתרים']].map(([v, l]) => (
              <button key={v} onClick={() => setVis(v)} style={pill(vis === v)}>{l}</button>
            ))}
            <span style={{ width: 1, height: 18, background: BD, margin: '0 2px' }} />
            {[['all', 'כל המרחקים'], ['marathon', 'מרתון'], ['half_marathon', 'חצי מרתון']].map(([v, l]) => (
              <button key={v} onClick={() => setDist(v)} style={pill(dist === v)}>{l}</button>
            ))}
            <button onClick={() => { setShowNewRace((v) => !v); setErr(''); }}
              style={{ ...pill(showNewRace), marginInlineStart: 'auto' }}>
              {showNewRace ? 'ביטול' : '+ מרוץ חדש'}
            </button>
          </div>

          {showNewRace && (
            <div style={{ margin: '10px 0 4px', padding: 12, border: `1px solid ${BD}`,
              borderRadius: 10, background: 'var(--rp-surface-2)', display: 'grid', gap: 8 }}>
              <input value={nr.nameHe} onChange={setNrField('nameHe')} style={fieldStyle}
                placeholder="שם בעברית" />
              <input value={nr.name} onChange={setNrField('name')} style={fieldStyle}
                placeholder="שם באנגלית (אופציונלי)" />
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={nr.city} onChange={setNrField('city')} style={{ ...fieldStyle, flex: 1 }}
                  placeholder="עיר" />
                <input value={nr.cc} onChange={setNrField('cc')} maxLength={2}
                  style={{ ...fieldStyle, width: 92, flex: '0 0 auto', textTransform: 'uppercase' }}
                  placeholder="מדינה" />
              </div>
              <select value={nr.dist} onChange={setNrField('dist')} style={fieldStyle}>
                {DIST_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <button onClick={createRace} disabled={busy === '*'} className="rp-btn rp-btn-primary">
                {busy === '*' ? 'שומר…' : 'צור מרוץ'}
              </button>
            </div>
          )}
        </div>

        {/* bulk bar */}
        {sel.size > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            padding: '9px 16px', borderBottom: `1px solid ${BD}`, background: 'var(--rp-gold-wash)' }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--rp-gold)' }}>
              נבחרו {sel.size}
            </span>
            <button disabled={busy === '*'} onClick={() => bulk('show')} style={miniBtn()}>הצג</button>
            <button disabled={busy === '*'} onClick={() => bulk('hide')} style={miniBtn()}>הסתר</button>
            <button disabled={busy === '*'} onClick={() => bulk('delete')}
              style={miniBtn({ color: 'var(--rp-danger, #d9736a)', borderColor: 'var(--rp-danger, #d9736a)' })}>
              {busy === '*' ? 'מוחק…' : 'מחק'}
            </button>
            <button onClick={() => setSel(new Set())} style={{ ...miniBtn(), marginInlineStart: 'auto' }}>
              נקה בחירה
            </button>
          </div>
        )}

        {/* list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 16px 14px', minHeight: 0 }}>
          {races === null && (
            <div style={{ padding: 24, textAlign: 'center', color: DIM, fontSize: 13 }}>טוען…</div>
          )}
          {races && races.length === 0 && (
            <div style={{ padding: '16px 8px', textAlign: 'center', color: DIM, fontSize: 13 }}>
              אין מרוצים בקטלוג. הוסיפו מרוץ חדש למעלה.
            </div>
          )}
          {races && races.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 2px',
              fontSize: 11.5, color: DIM }}>
              <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelAll}
                style={{ accentColor: 'var(--rp-gold)' }} />
              <span>בחר הכל ({filtered.length})</span>
            </div>
          )}

          {filtered.map((r) => {
            const shown = isShown(r);
            const hasRoute = r.routeStatus === 'available';
            const editing = editId === r.id;
            const rowBusy = busy === r.id;
            return (
              <div key={r.id} style={{
                border: `1px solid ${BD}`, borderRadius: 10, marginBottom: 8,
                background: 'var(--rp-surface-2)', opacity: shown ? 1 : 0.62,
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px' }}>
                  <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggleSel(r.id)}
                    style={{ accentColor: 'var(--rp-gold)', marginTop: 3 }} />
                  <span style={{ fontSize: 18, flex: '0 0 auto', marginTop: 1 }}>
                    {flagFor(r.countryCode)}
                  </span>
                  <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13.5, fontWeight: 700 }}>{r.nameHe || r.name}</span>
                      {!shown && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: DIM,
                          border: `1px solid ${BD}`, borderRadius: 999, padding: '1px 7px' }}>מוסתר</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11.5, color: DIM, marginTop: 2 }}>
                      {[r.city, DIST_LABEL[r.distance] || 'מרחק אחר',
                        hasRoute ? 'מסלול זמין' : 'ללא מסלול'].filter(Boolean).join(' · ')}
                    </div>

                    {editing && ef && (
                      <div style={{ display: 'grid', gap: 7, marginTop: 10 }}>
                        <input value={ef.nameHe} onChange={(e) => setEf((s) => ({ ...s, nameHe: e.target.value }))}
                          style={fieldStyle} placeholder="שם בעברית" />
                        <input value={ef.name} onChange={(e) => setEf((s) => ({ ...s, name: e.target.value }))}
                          style={fieldStyle} placeholder="שם באנגלית" />
                        <div style={{ display: 'flex', gap: 7 }}>
                          <input value={ef.city} onChange={(e) => setEf((s) => ({ ...s, city: e.target.value }))}
                            style={{ ...fieldStyle, flex: 1 }} placeholder="עיר" />
                          <input value={ef.cc} maxLength={2}
                            onChange={(e) => setEf((s) => ({ ...s, cc: e.target.value }))}
                            style={{ ...fieldStyle, width: 80, flex: '0 0 auto', textTransform: 'uppercase' }}
                            placeholder="מדינה" />
                        </div>
                        <div style={{ display: 'flex', gap: 7 }}>
                          <select value={ef.dist} onChange={(e) => setEf((s) => ({ ...s, dist: e.target.value }))}
                            style={{ ...fieldStyle, flex: 1 }}>
                            {DIST_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                          <input type="number" min="1" max="5" value={ef.tier}
                            onChange={(e) => setEf((s) => ({ ...s, tier: e.target.value }))}
                            style={{ ...fieldStyle, width: 96, flex: '0 0 auto' }} aria-label="עדיפות" />
                        </div>
                        <div style={{ fontSize: 10.5, color: DIM }}>עדיפות 1–5 (1 = ראש הרשימה)</div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={() => saveEdit(r)} disabled={rowBusy}
                            className="rp-btn rp-btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                            {rowBusy ? 'שומר…' : 'שמור'}
                          </button>
                          <button onClick={closeEdit} className="rp-btn">ביטול</button>
                        </div>

                        {/* route: attach / replace / detach */}
                        <div style={{ marginTop: 2, padding: 10, border: `1px solid ${BD}`,
                          borderRadius: 8 }}>
                          <div style={{ fontSize: 11.5, fontWeight: 700, color: DIM, marginBottom: 8 }}>
                            מסלול
                          </div>

                          {hasRoute && detachId !== r.id && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8,
                              flexWrap: 'wrap', marginBottom: 8 }}>
                              <span style={{ fontSize: 12 }}>
                                מסלול מצורף · {round1(r.distanceKm || 0)} ק"מ
                                {(r.gain || r.loss)
                                  ? ` · ↑${Math.round(r.gain || 0)} ↓${Math.round(r.loss || 0)}` : ''}
                              </span>
                              <button disabled={rowBusy} onClick={() => setDetachId(r.id)}
                                style={miniBtn()}>ניתוק</button>
                            </div>
                          )}
                          {hasRoute && detachId === r.id && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8,
                              flexWrap: 'wrap', marginBottom: 8 }}>
                              <span style={{ fontSize: 11.5, color: DIM }}>לנתק את המסלול?</span>
                              <button disabled={rowBusy} onClick={() => detachRoute(r)}
                                style={miniBtn({ color: 'var(--rp-gold)', borderColor: 'var(--rp-gold-line)' })}>
                                {rowBusy ? 'מנתק…' : 'כן, נתק'}
                              </button>
                              <button onClick={() => setDetachId('')} style={miniBtn()}>ביטול</button>
                            </div>
                          )}

                          <button onClick={() => routeFileRef.current && routeFileRef.current.click()}
                            disabled={routeLoading} className="rp-btn"
                            style={{ width: '100%', justifyContent: 'center' }}>
                            {routeLoading ? 'טוען…' : 'העלה קובץ GPX'}
                          </button>
                          <input ref={routeFileRef} type="file"
                            accept=".gpx,application/gpx+xml,text/xml"
                            onChange={loadRouteFile} style={{ display: 'none' }} />

                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0' }}>
                            <span style={{ flex: 1, height: 1, background: BD }} />
                            <span style={{ fontSize: 11, color: DIM }}>או קישור</span>
                            <span style={{ flex: 1, height: 1, background: BD }} />
                          </div>
                          <div style={{ display: 'flex', gap: 7 }}>
                            <input type="url" value={routeUrl}
                              onChange={(e) => setRouteUrl(e.target.value)}
                              placeholder="https://…/route.gpx"
                              style={{ ...fieldStyle, flex: 1, direction: 'ltr' }} />
                            <button onClick={loadRouteUrl} disabled={routeLoading || !routeUrl.trim()}
                              className="rp-btn" style={{ flex: '0 0 auto' }}>טען</button>
                          </div>

                          {pend && (
                            <div style={{ marginTop: 10, padding: 9, borderRadius: 8,
                              background: 'var(--rp-surface)', border: `1px solid ${BD}` }}>
                              <div style={{ fontSize: 12, fontWeight: 700 }}>
                                {pend.course.name || 'מסלול חדש'}
                              </div>
                              <div style={{ fontSize: 11.5, color: DIM, marginTop: 2 }}>
                                {round1(pend.course.dist || 0)} ק"מ · ↑{Math.round(pend.course.gain || 0)}
                                {' '}↓{Math.round(pend.course.loss || 0)}
                                {pend.course.profile ? '' : ' · אין נתוני גובה'}
                              </div>
                              {hasRoute && (
                                <div style={{ fontSize: 11, color: 'var(--rp-danger, #d9736a)', marginTop: 4 }}>
                                  המרוץ כבר כולל מסלול — שמירה תחליף אותו.
                                </div>
                              )}
                              <div style={{ display: 'flex', gap: 7, marginTop: 8 }}>
                                <button onClick={() => saveRoute(r)} disabled={rowBusy}
                                  className="rp-btn rp-btn-primary"
                                  style={{ flex: 1, justifyContent: 'center' }}>
                                  {rowBusy ? 'שומר…' : hasRoute ? 'החלף מסלול' : 'שמור מסלול'}
                                </button>
                                <button onClick={() => { setPend(null); setRouteUrl(''); }}
                                  className="rp-btn">בטל</button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {!editing && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 9 }}>
                        <button disabled={rowBusy} onClick={() => toggleListed(r)}
                          style={miniBtn(shown ? {} : { color: 'var(--rp-gold)', borderColor: 'var(--rp-gold-line)' })}>
                          {rowBusy ? '…' : shown ? 'הסתר' : 'הצג'}
                        </button>
                        <button disabled={rowBusy} onClick={() => startEdit(r)} style={miniBtn()}>עריכה</button>
                        <button disabled={rowBusy} onClick={() => startEdit(r)}
                          style={miniBtn(hasRoute ? {} : { color: 'var(--rp-gold)', borderColor: 'var(--rp-gold-line)' })}>
                          {hasRoute ? 'החלף מסלול' : 'הוסף מסלול'}
                        </button>
                        {confirmId !== r.id && (
                          <button disabled={rowBusy} onClick={() => { setConfirmId(r.id); setDetachId(''); }}
                            style={miniBtn({ color: 'var(--rp-danger, #d9736a)', borderColor: 'var(--rp-danger, #d9736a)' })}>
                            מחיקה
                          </button>
                        )}
                        {confirmId === r.id && (
                          <>
                            <span style={{ fontSize: 11.5, color: 'var(--rp-danger, #d9736a)', alignSelf: 'center' }}>
                              למחוק לצמיתות?
                            </span>
                            <button disabled={rowBusy} onClick={() => del(r)}
                              style={miniBtn({ color: '#fff', background: 'var(--rp-danger, #d9736a)',
                                borderColor: 'var(--rp-danger, #d9736a)' })}>
                              {rowBusy ? 'מוחק…' : 'מחק'}
                            </button>
                            <button onClick={() => setConfirmId('')} style={miniBtn()}>ביטול</button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {races && races.length > 0 && filtered.length === 0 && (
            <div style={{ padding: '16px 8px', textAlign: 'center', color: DIM, fontSize: 13 }}>
              אין תוצאות לסינון הנוכחי.
            </div>
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

window.RaceAdminPanel = RaceAdminPanel;

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
