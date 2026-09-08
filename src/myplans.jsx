// myplans.jsx — "My plans": every signed-in user's own saved-plan store.
// A lighter sibling of athletes.jsx (no per-athlete column): named snapshots
// of the current plan the user can reload later. Exposes MyPlansDB and
// MyPlansPanel on window.
//
// Storage mirrors the athlete bank: MyPlansDB is a synchronous, localStorage-
// backed API; when Firebase is present the source of truth is Firestore
// users/{uid}/plans/data (one JSON blob, private to the account, any tier).
const { round2 } = window;
const I18N = window.I18N;
const t = (I18N && I18N.t) || ((k) => k);
const U = window.UNITS;

const LS_MYPLANS = 'rp-myplans-v1';

// ── change subscribers ────────────────────────────────────────────────
const _mpSubs = new Set();
function _notifyMp() { _mpSubs.forEach((fn) => { try { fn(); } catch (e) {} }); }

// ── server sync (Firebase) ────────────────────────────────────────────
const MyPlansSync = (() => {
  const fb = (typeof window !== 'undefined' && window.RP_FIREBASE) || null;
  if (!fb || !fb.loadPlans) return { pull() {}, push() {}, enabled: false };

  const whenReady = (fn) => fb.ready.then(fn).catch(() => {});
  let timer = null;

  return {
    enabled: true,
    pull() {
      whenReady(() => fb.loadPlans().then((json) => {
        if (!json) return;
        try {
          const db = JSON.parse(json);
          if (db && Array.isArray(db.plans)) {
            localStorage.setItem(LS_MYPLANS, json);
            _notifyMp();
          }
        } catch (e) {}
      }).catch(() => {}));
    },
    push(db) {
      const json = JSON.stringify(db);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        whenReady(() => fb.savePlans(json).catch(() => {}));
      }, 600);
    },
  };
})();

// ── unique id ─────────────────────────────────────────────────────────
let _mpid = 0;
const mpid = () => `p${Date.now()}${++_mpid}`;

// ── date formatter ────────────────────────────────────────────────────
function formatSavedAt(iso) {
  try {
    return new Intl.DateTimeFormat(I18N ? I18N.locale : 'he',
      { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      .format(new Date(iso));
  } catch (e) {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
}

// current planner state  →  the serialised body of a saved plan
function serializePlan(cur) {
  cur = cur || {};
  return {
    raceName: cur.raceName || '',
    raceDate: cur.raceDate || '',
    raceTime: cur.raceTime || '',
    trainer: cur.trainer || '',
    segments: (cur.segments || []).map((s) => [round2(s.distance), s.paceSec]),
    preset: cur.preset ?? null,
    course: cur.course ? {
      name: cur.course.name || '',
      dist: cur.course.dist,
      gain: cur.course.gain,
      loss: cur.course.loss,
      source: cur.course.source || '',
      profile: cur.course.profile || null,
      track: cur.course.track || null,
    } : null,
  };
}

function defaultPlanName(cur, iso) {
  return `${(cur && cur.raceName) || t('myplans.untitled')} — ${formatSavedAt(iso)}`;
}

// ── MyPlansDB ─────────────────────────────────────────────────────────
const MyPlansDB = {
  _load() {
    try {
      const raw = localStorage.getItem(LS_MYPLANS);
      if (!raw) return { plans: [] };
      const db = JSON.parse(raw);
      if (!Array.isArray(db.plans)) return { plans: [] };
      return db;
    } catch { return { plans: [] }; }
  },
  _save(db) {
    try { localStorage.setItem(LS_MYPLANS, JSON.stringify(db)); } catch {}
    MyPlansSync.push(db);
  },
  subscribe(fn) { _mpSubs.add(fn); return () => _mpSubs.delete(fn); },
  getAll() { return this._load().plans; },
  save(cur, name) {
    const db = this._load();
    const now = new Date().toISOString();
    const plan = {
      id: mpid(),
      name: (name || '').trim() || defaultPlanName(cur, now),
      savedAt: now,
      ...serializePlan(cur),
    };
    db.plans.unshift(plan);
    this._save(db);
    return plan;
  },
  rename(id, name) {
    const db = this._load();
    const plan = db.plans.find((p) => p.id === id);
    if (!plan) return;
    plan.name = (name || '').trim() || plan.name;
    this._save(db);
  },
  remove(id) {
    const db = this._load();
    db.plans = db.plans.filter((p) => p.id !== id);
    this._save(db);
  },
};

// ── MyPlansPanel ──────────────────────────────────────────────────────
function MyPlansPanel({
  onClose,
  currentRaceName, currentRaceDate, currentRaceTime, currentTrainer,
  currentSegments, currentPreset, currentCourse,
  onLoadPlan,
}) {
  const [db, setDb] = React.useState(() => MyPlansDB._load());
  const [nameInput, setNameInput] = React.useState(currentRaceName || '');
  const [confirmDel, setConfirmDel] = React.useState(null);
  const [savedFlash, setSavedFlash] = React.useState(false);
  const [renaming, setRenaming] = React.useState('');   // plan id being renamed
  const [renameText, setRenameText] = React.useState('');

  const refresh = () => setDb(MyPlansDB._load());

  React.useEffect(() => {
    refresh();
    MyPlansSync.pull();
    return MyPlansDB.subscribe(refresh);
  }, []);

  const curState = () => ({
    raceName: currentRaceName, raceDate: currentRaceDate, raceTime: currentRaceTime,
    trainer: currentTrainer, segments: currentSegments, preset: currentPreset,
    course: currentCourse,
  });

  const handleSave = () => {
    MyPlansDB.save(curState(), nameInput);
    refresh();
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
  };

  const handleLoad = (plan) => { onLoadPlan(plan); onClose(); };

  const startRename = (plan) => { setRenaming(plan.id); setRenameText(plan.name); };
  const commitRename = () => {
    if (renaming) { MyPlansDB.rename(renaming, renameText); refresh(); }
    setRenaming(''); setRenameText('');
  };

  const handleDelConfirm = () => {
    if (confirmDel) { MyPlansDB.remove(confirmDel.id); }
    setConfirmDel(null);
    refresh();
  };

  const PANEL_BG   = 'var(--rp-surface)';
  const COL_BORDER = 'var(--rp-line)';
  const ITEM_BG    = 'var(--rp-surface-2)';
  const ACCENT     = 'var(--rp-gold)';
  const TEXT       = 'var(--rp-text)';
  const DIM        = 'var(--rp-text-dim)';
  const DIMMER     = 'var(--rp-placeholder)';
  const FIELD_BG   = 'var(--rp-surface-2)';
  const FIELD_BD   = 'var(--rp-line-input)';

  const plans = db.plans || [];

  return ReactDOM.createPortal((
    <div
      className="rp-sheet-wrap rp-cq-scope"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(9,11,22,.78)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, direction: I18N.dir, fontFamily: 'var(--rp-font-ui)', color: TEXT,
      }}
    >
      <style>{`
        @media (max-width: 640px){
          .rp-sheet-wrap{ align-items: flex-end !important; padding: 0 !important; }
          .mp-sheet{ max-width: none !important; width: 100% !important;
            max-height: 92vh !important; border-radius: 20px 20px 0 0 !important; }
          .mp-sheet input, .mp-sheet button{ font-size: 15px; }
          .mp-foot{ flex-direction: column; align-items: stretch !important; }
          .mp-foot > *{ width: 100%; }
        }
      `}</style>

      <div className="mp-sheet" style={{
        background: PANEL_BG, border: `1px solid ${COL_BORDER}`,
        borderRadius: 'var(--rp-r-14)', width: '100%', maxWidth: 560, maxHeight: '88vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: 'var(--rp-shadow-modal)', direction: I18N.dir,
      }}>

        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: `1px solid ${COL_BORDER}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={ACCENT}
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
            <span style={{ fontSize: 17, fontWeight: 800 }}>{t('myplans.title')}</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer',
            color: DIM, fontSize: 20, lineHeight: 1, padding: '2px 6px' }}>✕</button>
        </div>

        {/* list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', minHeight: 0 }}>
          {plans.length === 0 && (
            <div style={{ padding: '40px 20px', color: DIMMER, fontSize: 14, textAlign: 'center' }}>
              {t('myplans.noneYet')}
              <div style={{ fontSize: 12, marginTop: 6 }}>
                {t('myplans.noneYetHint')}
              </div>
            </div>
          )}

          {plans.map((plan) => (
            <div key={plan.id} style={{
              background: ITEM_BG, border: '1px solid var(--rp-line)', borderRadius: 12,
              padding: '12px 14px', marginBottom: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {renaming === plan.id ? (
                    <input
                      value={renameText} autoFocus
                      onChange={(e) => setRenameText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setRenaming(''); } }}
                      onBlur={commitRename}
                      style={{ width: '100%', background: FIELD_BG, border: `1px solid ${FIELD_BD}`,
                        borderRadius: 8, padding: '5px 8px', fontSize: 13.5, color: TEXT,
                        fontFamily: 'inherit', outline: 'none', direction: I18N.dir }}
                    />
                  ) : (
                    <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{plan.name}</div>
                  )}
                  <div style={{ fontSize: 11.5, color: DIM, marginTop: 3 }}>
                    {formatSavedAt(plan.savedAt)}
                    {plan.course
                      ? ` · GPX: ${plan.course.name || ''}${plan.course.dist ? ' ' + (U ? U.fmtDist(plan.course.dist) : round2(plan.course.dist)) : ''}`
                      : plan.segments ? ` · ${t('athletes.segCount', { count: plan.segments.length })}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button onClick={() => handleLoad(plan)} style={{
                    background: 'var(--rp-gold-wash)', border: '1px solid var(--rp-gold-line)',
                    borderRadius: 8, padding: '5px 12px', cursor: 'pointer',
                    color: 'var(--rp-gold)', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                  }}>{t('common.load')}</button>
                  <button onClick={() => startRename(plan)} aria-label={t('myplans.rename')} style={{
                    background: 'transparent', border: `1px solid ${FIELD_BD}`, borderRadius: 8,
                    padding: '5px 8px', cursor: 'pointer', color: DIMMER, fontFamily: 'inherit', lineHeight: 1,
                  }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                  </button>
                  <button onClick={() => setConfirmDel({ id: plan.id })} aria-label={t('common.delete')} style={{
                    background: 'transparent', border: `1px solid ${FIELD_BD}`, borderRadius: 8,
                    padding: '5px 8px', cursor: 'pointer', color: DIMMER, fontSize: 13,
                    fontFamily: 'inherit', lineHeight: 1,
                  }}>✕</button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* footer — save current */}
        <div className="mp-foot" style={{
          padding: '12px 18px calc(12px + env(safe-area-inset-bottom))',
          borderTop: `1px solid ${COL_BORDER}`,
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            placeholder={t('myplans.namePlaceholder')}
            style={{ flex: 1, minWidth: 140, background: FIELD_BG, border: `1px solid ${FIELD_BD}`,
              borderRadius: 8, padding: '9px 12px', fontSize: 13, color: TEXT,
              fontFamily: 'inherit', outline: 'none', direction: I18N.dir }}
          />
          <button onClick={handleSave} style={{
            background: savedFlash ? 'var(--rp-gold-soft)' : ACCENT, border: 'none',
            borderRadius: 10, padding: '9px 18px', cursor: 'pointer', color: 'var(--rp-on-gold)',
            fontWeight: 700, fontSize: 13.5, fontFamily: 'inherit', transition: 'background .3s',
            display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap',
          }}>
            {savedFlash ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {t('myplans.saved')}
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                  <polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
                </svg>
                {t('myplans.saveCurrent')}
              </>
            )}
          </button>
        </div>
      </div>

      {/* confirm-delete */}
      {confirmDel && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1001, background: 'rgba(0,0,0,.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--rp-surface)', border: `1px solid ${FIELD_BD}`, borderRadius: 16,
            padding: '26px 30px', maxWidth: 340, textAlign: 'center', direction: I18N.dir,
            boxShadow: '0 16px 48px rgba(0,0,0,.7)',
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>{t('myplans.deleteQ')}</div>
            <div style={{ fontSize: 13, color: DIM, marginBottom: 22 }}>{t('common.irreversible')}</div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button onClick={() => setConfirmDel(null)} style={{
                background: 'var(--rp-surface-2)', border: `1px solid ${FIELD_BD}`, borderRadius: 9,
                padding: '8px 18px', cursor: 'pointer', color: TEXT, fontFamily: 'inherit',
                fontWeight: 600, fontSize: 13,
              }}>{t('common.cancel')}</button>
              <button onClick={handleDelConfirm} style={{
                background: 'var(--rp-danger)', border: 'none', borderRadius: 9,
                padding: '8px 18px', cursor: 'pointer', color: 'var(--rp-text)',
                fontFamily: 'inherit', fontWeight: 700, fontSize: 13,
              }}>{t('common.delete')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  ), document.body);
}

// Warm the local mirror from the server for any signed-in user.
if (typeof window !== 'undefined' && window.RP_FIREBASE) MyPlansSync.pull();

Object.assign(window, { MyPlansDB, MyPlansPanel, serializePlan });
