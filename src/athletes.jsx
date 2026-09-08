// athletes.jsx — Athlete bank: per-athlete plan storage with history.
// Exposes AthleteDB (CRUD) and AthletePanel (modal UI) on window.
const { round2 } = window;

const LS_ATHLETES = 'rp-athletes-v1';

// ── Change subscribers ────────────────────────────────────────────────
// AthletePanel subscribes so it re-renders when a background server pull
// replaces the local mirror.
const _athSubs = new Set();
function _notifyAth() { _athSubs.forEach((fn) => { try { fn(); } catch (e) {} }); }

// ── Server sync (Firebase) ────────────────────────────────────────────
// AthleteDB stays a synchronous, localStorage-backed API so the UI needs no
// changes. When Firebase is present (window.RP_FIREBASE) localStorage is an
// offline mirror and the source of truth is Firestore users/{uid}/bank/data —
// private to the signed-in account, owner only. On plain static hosting both
// calls are no-ops.
const AthleteSync = (() => {
  const fb = (typeof window !== 'undefined' && window.RP_FIREBASE) || null;
  if (!fb) return { pull() {}, push() {}, enabled: false };

  const whenReady = (fn) => fb.ready.then(fn).catch(() => {});
  let timer = null;

  return {
    enabled: true,
    pull() {
      whenReady(() => fb.loadBank().then((json) => {
        if (!json) return;
        try {
          const db = JSON.parse(json);
          if (db && Array.isArray(db.athletes)) {
            localStorage.setItem(LS_ATHLETES, json);
            _notifyAth();
          }
        } catch (e) {}
      }).catch(() => {}));
    },
    push(db) {
      const json = JSON.stringify(db);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        whenReady(() => fb.saveBank(json).catch(() => {}));
      }, 600);
    },
  };
})();

// ── Unique ID ──────────────────────────────────────────────────────────
let _aid = 0;
const aid = () => `a${Date.now()}${++_aid}`;

// ── Date formatter ─────────────────────────────────────────────────────
function formatSavedAt(iso) {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yy} ${hh}:${mi}`;
}

// ── AthleteDB ──────────────────────────────────────────────────────────
const AthleteDB = {
  _load() {
    try {
      const raw = localStorage.getItem(LS_ATHLETES);
      if (!raw) return { athletes: [] };
      const db = JSON.parse(raw);
      if (!Array.isArray(db.athletes)) return { athletes: [] };
      return db;
    } catch { return { athletes: [] }; }
  },
  _save(db) {
    try { localStorage.setItem(LS_ATHLETES, JSON.stringify(db)); } catch {}
    AthleteSync.push(db);
  },
  subscribe(fn) { _athSubs.add(fn); return () => _athSubs.delete(fn); },
  getAll() { return this._load().athletes; },
  findByName(name) {
    if (!name) return null;
    const q = name.trim().toLowerCase();
    return this.getAll().find(a => a.name.toLowerCase() === q) || null;
  },
  addAthlete(name) {
    const db = this._load();
    const athlete = { id: aid(), name: name.trim(), plans: [] };
    db.athletes.push(athlete);
    this._save(db);
    return athlete;
  },
  deleteAthlete(athleteId) {
    const db = this._load();
    db.athletes = db.athletes.filter(a => a.id !== athleteId);
    this._save(db);
  },
  savePlan(athleteId, { raceName, segments, preset, course }) {
    const db = this._load();
    const athlete = db.athletes.find(a => a.id === athleteId);
    if (!athlete) return null;
    const now = new Date().toISOString();
    const plan = {
      id: aid(),
      name: `${raceName} — ${formatSavedAt(now)}`,
      savedAt: now,
      raceName,
      segments: segments.map(s => [round2(s.distance), s.paceSec]),
      preset: preset ?? null,
      course: course ? {
        name: course.name || '',
        dist: course.dist,
        gain: course.gain,
        loss: course.loss,
        source: course.source || '',
        profile: course.profile || null,
        track: course.track || null,
      } : null,
    };
    athlete.plans.unshift(plan);
    this._save(db);
    return plan;
  },
  deletePlan(athleteId, planId) {
    const db = this._load();
    const athlete = db.athletes.find(a => a.id === athleteId);
    if (!athlete) return;
    athlete.plans = athlete.plans.filter(p => p.id !== planId);
    this._save(db);
  },
};

// ── AthletePanel ───────────────────────────────────────────────────────
function AthletePanel({
  onClose,
  currentTrainer,
  onLoadPlan,
  onPlanForAthlete,
}) {
  const [db, setDb] = React.useState(() => AthleteDB._load());
  const [selId, setSelId] = React.useState(() => {
    const found = AthleteDB.findByName(currentTrainer);
    return found ? found.id : null;
  });
  const [newName, setNewName] = React.useState('');
  const [confirmDel, setConfirmDel] = React.useState(null);
  const newNameRef = React.useRef(null);

  const refresh = () => setDb(AthleteDB._load());

  // Read fresh data on mount, pull the latest from the server, and re-render
  // when a later pull lands.
  React.useEffect(() => {
    refresh();
    AthleteSync.pull();
    return AthleteDB.subscribe(refresh);
  }, []);

  const selAthlete = db.athletes.find(a => a.id === selId) || null;

  const handleAdd = () => {
    const name = newName.trim();
    if (!name) return;
    const a = AthleteDB.addAthlete(name);
    setNewName('');
    refresh();
    setSelId(a.id);
  };

  const handleLoad = (plan) => {
    onLoadPlan(plan, selAthlete?.name || '');
    onClose();
  };

  const handlePlanNew = () => {
    if (!selAthlete || !onPlanForAthlete) return;
    onPlanForAthlete(selAthlete.name);
    onClose();
  };

  const handleDelConfirm = () => {
    if (!confirmDel) return;
    if (confirmDel.type === 'athlete') {
      AthleteDB.deleteAthlete(confirmDel.id);
      if (selId === confirmDel.id) setSelId(null);
    } else {
      AthleteDB.deletePlan(confirmDel.athleteId, confirmDel.id);
    }
    setConfirmDel(null);
    refresh();
  };

  // Colors from the design tokens (shared.jsx :root)
  const PANEL_BG   = 'var(--rp-surface)';
  const COL_BORDER = 'var(--rp-line)';
  const ITEM_BG    = 'var(--rp-surface-2)';
  const ACCENT     = 'var(--rp-gold)';
  const TEXT       = 'var(--rp-text)';
  const DIM        = 'var(--rp-text-dim)';
  const DIMMER     = 'var(--rp-placeholder)';
  const FIELD_BG   = 'var(--rp-surface-2)';
  const FIELD_BD   = 'var(--rp-line-input)';

  // Portal to <body>: the app root is a CSS container (container-type), which
  // would otherwise re-anchor this position:fixed overlay to the container
  // instead of the viewport.
  return ReactDOM.createPortal((
    <div
      className="rp-sheet-wrap rp-cq-scope"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(9,11,22,.78)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, direction: 'rtl', fontFamily: 'var(--rp-font-ui)',
        color: 'var(--rp-text)',
      }}
    >
      <style>{`
        @media (max-width: 640px){
          .rp-sheet-wrap{ align-items: flex-end !important; padding: 0 !important; }
          .rp-sheet{ max-width: none !important; width: 100% !important;
            max-height: 92vh !important; border-radius: 20px 20px 0 0 !important; }
          .rp-sheet-body{ flex-direction: column !important; }
          .rp-sheet-athletes{ width: auto !important;
            border-inline-end: none !important;
            border-bottom: 1px solid var(--rp-line) !important; max-height: 38vh; }
          .rp-sheet-foot{ flex-direction: column; align-items: stretch !important; }
          .rp-sheet-foot > button{ width: 100%; justify-content: center; min-height: 46px; }
          .rp-sheet input{ min-height: 44px; font-size: 15px; }
          .rp-sheet button{ min-height: 40px; }
        }
      `}</style>
      <div className="rp-sheet" style={{
        background: PANEL_BG, border: `1px solid ${COL_BORDER}`,
        borderRadius: 'var(--rp-r-14)', width: '100%', maxWidth: 800, maxHeight: '88vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: 'var(--rp-shadow-modal)',
        direction: 'rtl',
      }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: `1px solid ${COL_BORDER}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={ACCENT}
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            <span style={{ fontSize: 17, fontWeight: 800, color: TEXT }}>מאגר מתאמנים</span>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: DIM, fontSize: 20, lineHeight: 1, padding: '2px 6px', borderRadius: 6,
          }}>✕</button>
        </div>

        {/* Body: two columns (stack on phones) */}
        <div className="rp-sheet-body" style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>

          {/* Left column: Athletes */}
          <div className="rp-sheet-athletes" style={{
            width: 230, flexShrink: 0,
            borderInlineEnd: `1px solid ${COL_BORDER}`,
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ padding: '10px 16px 8px', fontSize: 11, fontWeight: 700,
              color: DIMMER, letterSpacing: '.07em', textTransform: 'uppercase',
              borderBottom: `1px solid ${COL_BORDER}` }}>
              מתאמנים ({db.athletes.length})
            </div>

            {/* List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '6px 6px' }}>
              {db.athletes.length === 0 && (
                <div style={{ padding: '18px 12px', color: DIMMER, fontSize: 13, textAlign: 'center' }}>
                  אין מתאמנים עדיין
                </div>
              )}
              {db.athletes.map(a => (
                <div key={a.id}
                  onClick={() => setSelId(a.id)}
                  style={{
                    padding: '9px 12px', borderRadius: 9, cursor: 'pointer', marginBottom: 2,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: a.id === selId ? 'var(--rp-gold-wash)' : 'transparent',
                    color: a.id === selId ? TEXT : DIM,
                    fontWeight: a.id === selId ? 700 : 500,
                    fontSize: 14, transition: 'all .1s',
                  }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {a.name}
                  </span>
                  <span style={{ fontSize: 11, color: DIMMER, marginInlineStart: 6, flexShrink: 0,
                    background: 'var(--rp-surface-3)', borderRadius: 5, padding: '1px 6px' }}>
                    {a.plans.length}
                  </span>
                </div>
              ))}
            </div>

            {/* Add new athlete */}
            <div style={{ padding: '8px', borderTop: `1px solid ${COL_BORDER}` }}>
              <div style={{ display: 'flex', gap: 5 }}>
                <input
                  ref={newNameRef}
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
                  placeholder="שם מתאמן חדש..."
                  style={{
                    flex: 1, background: FIELD_BG, border: `1px solid ${FIELD_BD}`,
                    borderRadius: 8, padding: '7px 10px', fontSize: 13, color: TEXT,
                    fontFamily: 'inherit', outline: 'none', minWidth: 0,
                    direction: 'rtl',
                  }}
                />
                <button onClick={handleAdd} style={{
                  background: ACCENT, border: 'none', borderRadius: 8,
                  width: 34, cursor: 'pointer', color: 'var(--rp-on-gold)',
                  fontWeight: 800, fontSize: 18, lineHeight: 1,
                }}>+</button>
              </div>
            </div>
          </div>

          {/* Right column: the selected athlete */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div style={{ padding: '10px 18px 8px', fontSize: 11, fontWeight: 700,
              color: DIMMER, letterSpacing: '.07em', textTransform: 'uppercase',
              borderBottom: `1px solid ${COL_BORDER}` }}>
              {selAthlete ? selAthlete.name : 'מתאמן'}
            </div>

            {selAthlete && onPlanForAthlete && (
              <div style={{ padding: '12px 14px 4px' }}>
                <button onClick={handlePlanNew} style={{
                  width: '100%', background: ACCENT, border: 'none', borderRadius: 10,
                  padding: '11px 16px', cursor: 'pointer', color: 'var(--rp-on-gold)',
                  fontWeight: 800, fontSize: 14, fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                  תכנן מרוץ ל{selAthlete.name}
                </button>
                {selAthlete.plans.length > 0 && (
                  <div style={{ fontSize: 11, fontWeight: 700, color: DIMMER, letterSpacing: '.06em',
                    textTransform: 'uppercase', margin: '14px 4px 2px' }}>תכנונים שמורים</div>
                )}
              </div>
            )}

            <div style={{ flex: 1, overflowY: 'auto', padding: '6px 14px 10px' }}>
              {!selAthlete && (
                <div style={{ padding: '40px 20px', color: DIMMER, fontSize: 14, textAlign: 'center' }}>
                  בחרו מתאמן מהרשימה, או הוסיפו חדש
                </div>
              )}
              {selAthlete && selAthlete.plans.length === 0 && (
                <div style={{ padding: '24px 20px', color: DIMMER, fontSize: 13, textAlign: 'center' }}>
                  אין עדיין תכנונים שמורים למתאמן הזה
                </div>
              )}
              {selAthlete && selAthlete.plans.map(plan => (
                <div key={plan.id}
                  style={{
                    background: ITEM_BG, border: '1px solid var(--rp-line)',
                    borderRadius: 12, padding: '12px 14px', marginBottom: 8,
                    transition: 'border-color .12s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--rp-gold-line)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--rp-line)'}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: TEXT,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {plan.raceName}
                      </div>
                      <div style={{ fontSize: 11.5, color: DIM, marginTop: 3 }}>
                        {formatSavedAt(plan.savedAt)}
                        {plan.course
                          ? ` · GPX: ${plan.course.name || plan.course.source || ''} ${plan.course.dist ? plan.course.dist + ' ק"מ' : ''}`
                          : plan.segments ? ` · ${plan.segments.length} קטעים` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button onClick={() => handleLoad(plan)} style={{
                        background: 'var(--rp-gold-wash)', border: '1px solid var(--rp-gold-line)',
                        borderRadius: 8, padding: '5px 12px', cursor: 'pointer',
                        color: 'var(--rp-gold)', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                      }}>טען</button>
                      <button
                        onClick={() => setConfirmDel({ type: 'plan', id: plan.id, athleteId: selId })}
                        style={{
                          background: 'transparent', border: `1px solid ${FIELD_BD}`,
                          borderRadius: 8, padding: '5px 8px', cursor: 'pointer',
                          color: DIMMER, fontSize: 13, fontFamily: 'inherit',
                          lineHeight: 1,
                        }}>✕</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="rp-sheet-foot" style={{
          padding: '12px 18px calc(12px + env(safe-area-inset-bottom))', borderTop: `1px solid ${COL_BORDER}`,
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          {selAthlete ? (
            <>
              <span style={{ fontSize: 12.5, color: DIMMER }}>
                {selAthlete.plans.length} תכנונים שמורים
              </span>
              <div style={{ marginInlineStart: 'auto' }}>
                <button
                  onClick={() => setConfirmDel({ type: 'athlete', id: selId })}
                  style={{
                    background: 'transparent', border: `1px solid ${FIELD_BD}`,
                    borderRadius: 8, padding: '6px 12px', cursor: 'pointer',
                    color: 'var(--rp-danger-text)', fontSize: 12.5, fontFamily: 'inherit',
                  }}>מחק מתאמן</button>
              </div>
            </>
          ) : (
            <span style={{ fontSize: 13, color: DIMMER }}>
              בחרו מתאמן כדי לתכנן לו מרוץ או לפתוח תכנון קיים
            </span>
          )}
        </div>
      </div>

      {/* Confirm-delete dialog */}
      {confirmDel && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1001,
          background: 'rgba(0,0,0,.55)', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--rp-surface)', border: `1px solid ${FIELD_BD}`,
            borderRadius: 16, padding: '26px 30px', maxWidth: 340,
            textAlign: 'center', direction: 'rtl',
            boxShadow: '0 16px 48px rgba(0,0,0,.7)',
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, marginBottom: 10 }}>
              {confirmDel.type === 'athlete' ? 'מחק מתאמן?' : 'מחק תכנית?'}
            </div>
            <div style={{ fontSize: 13, color: DIM, marginBottom: 22 }}>
              {confirmDel.type === 'athlete'
                ? 'כל התכניות של המתאמן יימחקו לצמיתות.'
                : 'הפעולה אינה ניתנת לביטול.'}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button onClick={() => setConfirmDel(null)} style={{
                background: 'var(--rp-surface-2)', border: `1px solid ${FIELD_BD}`,
                borderRadius: 9, padding: '8px 18px', cursor: 'pointer',
                color: TEXT, fontFamily: 'inherit', fontWeight: 600, fontSize: 13,
              }}>ביטול</button>
              <button onClick={handleDelConfirm} style={{
                background: 'var(--rp-danger)', border: 'none',
                borderRadius: 9, padding: '8px 18px', cursor: 'pointer',
                color: 'var(--rp-text)', fontFamily: 'inherit', fontWeight: 700, fontSize: 13,
              }}>מחק</button>
            </div>
          </div>
        </div>
      )}
    </div>
  ), document.body);
}

// Warm the local mirror from the server as early as possible — but only for the
// owner; free users have no server-side bank (and the panel never mounts).
const _rpUser = (typeof window !== 'undefined' && window.__RACEPLAN_USER__) || null;
if (!_rpUser || _rpUser.tier === 'owner') AthleteSync.pull();

Object.assign(window, { AthleteDB, AthletePanel });
