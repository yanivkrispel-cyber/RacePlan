// update.jsx — pick up a new production deploy in an app that's already open.
//
// A cold launch is always fresh (the service worker serves the shell and
// app.js network-first), but an installed PWA can sit suspended in the
// background for days and resume without reloading. So: whenever the page
// comes back to the foreground (and every 30 min while it stays there),
// fetch /version.json and compare it to the build this page is running
// (window.__RACEPLAN_BUILD__, stamped by build/build.mjs).
//
// On a mismatch: reload silently if it's safe (on the Hub, no dialog open, not
// typing) — the user just returned to the app, so there's nothing on screen to
// lose. Otherwise show a banner with a Refresh button and let them choose.
//
// Exposes window.UpdateBanner (mounted beside PlannerB by the bootstrap) and
// window.RP_UPDATE.setSafe(bool), which PlannerB sets to "on the Hub".
const I18N = window.I18N;
const t = (I18N && I18N.t) || ((k) => k);

const BUILD = window.__RACEPLAN_BUILD__ || null;
const CHECK_EVERY_MS = 30 * 60 * 1000;
const MIN_GAP_MS = 60 * 1000;

let safeView = false;
let pending = false;
let lastCheck = 0;
const listeners = new Set();

function safeToReload() {
  if (!safeView) return false;
  if (document.querySelector('[aria-modal="true"]')) return false;
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)) return false;
  return true;
}

function reload() {
  location.reload();
}

function onNewVersion() {
  if (pending) return;
  pending = true;
  // Let the browser install the new sw.js now rather than on its own schedule.
  try {
    if (navigator.serviceWorker) navigator.serviceWorker.getRegistration().then((r) => r && r.update()).catch(() => {});
  } catch (e) {}
  if (document.visibilityState === 'visible' && safeToReload()) { reload(); return; }
  listeners.forEach((fn) => fn(true));
}

async function check(force) {
  if (!BUILD || pending || !navigator.onLine) return;
  const now = Date.now();
  if (!force && now - lastCheck < MIN_GAP_MS) return;
  lastCheck = now;
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    if (!res.ok) return;
    const { build } = await res.json();
    if (build && build !== BUILD) onNewVersion();
  } catch (e) { /* offline / transient — try again next time */ }
}

if (BUILD && typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (pending && safeToReload()) reload();
    else check(false);
  });
  window.addEventListener('online', () => check(false));
  setInterval(() => { if (document.visibilityState === 'visible') check(true); }, CHECK_EVERY_MS);
}

function UpdateBanner() {
  if (I18N && I18N.useI18n) I18N.useI18n();
  const [show, setShow] = React.useState(pending);
  React.useEffect(() => { listeners.add(setShow); return () => { listeners.delete(setShow); }; }, []);
  if (!show) return null;
  return ReactDOM.createPortal((
    <div role="status" aria-live="polite" style={{
      position: 'fixed', top: 'calc(12px + env(safe-area-inset-top))',
      insetInline: 0, marginInline: 'auto', width: 'max-content', maxWidth: '92vw', zIndex: 10000,
      background: 'var(--rp-surface)', border: '1px solid var(--rp-gold-line)', borderRadius: 'var(--rp-r-12)',
      padding: 8, paddingInlineStart: 16,
      fontFamily: 'var(--rp-font-ui)', fontSize: 14, fontWeight: 600, color: 'var(--rp-text)',
      display: 'flex', alignItems: 'center', gap: 12,
      boxShadow: 'var(--rp-shadow-modal)',
    }}>
      {t('update.available')}
      <button onClick={reload} style={{
        background: 'var(--rp-gold)', color: 'var(--rp-surface)', border: 'none', cursor: 'pointer',
        borderRadius: 'var(--rp-r-12)', fontFamily: 'inherit', fontSize: 14, fontWeight: 800,
        padding: '6px 14px', minHeight: 36,
      }}>{t('update.reload')}</button>
    </div>
  ), document.body);
}

const RP_UPDATE = {
  setSafe(v) { safeView = !!v; },
  check: () => check(true),
};

Object.assign(window, { UpdateBanner, RP_UPDATE });
