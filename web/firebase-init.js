// web/firebase-init.js — Firebase (Auth + Firestore) glue for RacePlan.
// Exposes window.RP_FIREBASE; the app bundle (app.js) waits on RP_FIREBASE.ready
// before it mounts. Loaded as a deferred ES module, before app.js.

//
// Load-time budget: only firebase-app + firebase-auth are on the pre-mount
// critical path. Firestore (~440 KB) and Storage are imported on first use —
// the mount only needs the auth state, never a document.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence,
  browserPopupRedirectResolver, GoogleAuthProvider, onAuthStateChanged,
  signInWithRedirect, signInWithPopup, getRedirectResult, signOut,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

const FB_CDN = 'https://www.gstatic.com/firebasejs/10.14.1/';

const firebaseConfig = {
  apiKey: 'AIzaSyBW6HPQ-W3uEvDtjo8mOAn5RejAik-agzU',
  // Same-origin auth handler. This value decides the OAuth redirect_uri Google
  // sees ( <authDomain>/__/auth/handler ); both this one and the …firebaseapp.com
  // handler are now registered as authorized redirect URIs on the OAuth web
  // client, so redirect and popup both work. Serving the handler from the app's
  // own origin also means iOS Safari's ITP can't break the signInWithRedirect
  // credential hand-back (no cross-site storage read). Firebase Hosting serves
  // /__/auth/* on this domain automatically.
  authDomain: 'raceplan.coachkrispel.com',
  projectId: 'raceplan-17e5b',
  storageBucket: 'raceplan-17e5b.firebasestorage.app',
  messagingSenderId: '13899079695',
  appId: '1:13899079695:web:01fdf5fb2d6c6c4e15837a',
  measurementId: 'G-T89TYJTDZQ',
};

// The account that gets the full app (athlete bank). Everyone else is "free".
const OWNER_EMAIL = 'yaniv.krispel@gmail.com';

const app = initializeApp(firebaseConfig);

// Same setup as getAuth() (same persistence chain, same popup/redirect
// resolver), with one change. On mobile / Safari / iOS the stock resolver
// reports `_shouldInitProactively`, and Firebase then *awaits* its hidden
// iframe (apis.google.com gapi + /__/auth/iframe.js, ~4 round trips) before the
// first auth state — which is what the mount waits on. The iframe is only
// there so a sign-in popup can open straight from the tap, so instead we mount
// first and warm it right after, only when the user is signed out (see
// warmSignIn). The resolver class is otherwise untouched.
class LazyInitResolver extends browserPopupRedirectResolver {
  get _shouldInitProactively() { return false; }
}
const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
  popupRedirectResolver: LazyInitResolver,
});

// What Firebase's proactive init would have done, off the critical path: load
// the resolver's iframe so a later signInWithPopup opens without a network
// wait (Safari blocks popups opened after one). A tap that beats the warm-up
// still works — it waits on this same in-flight promise, and at worst falls
// back to the redirect flow in signIn(). Idempotent (Firebase caches it).
let warmed = false;
function warmSignIn() {
  if (warmed) return;
  warmed = true;
  try {
    const r = auth._popupRedirectResolver;
    if (r && typeof r._initialize === 'function') r._initialize(auth).catch(() => { warmed = false; });
  } catch (e) { warmed = false; }
}

// Firestore / Storage, loaded on first use (then cached).
let _fs = null;
function fs() {
  if (!_fs) {
    _fs = import(FB_CDN + 'firebase-firestore.js').then((m) => ({ ...m, db: m.getFirestore(app) }));
    _fs.catch(() => { _fs = null; }); // a failed fetch (offline) may retry later
  }
  return _fs;
}
let _st = null;
function st() {
  if (!_st) {
    _st = import(FB_CDN + 'firebase-storage.js').then((m) => ({ ...m, storage: m.getStorage(app) }));
    _st.catch(() => { _st = null; });
  }
  return _st;
}

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

function tierFor(email) {
  return (email || '').toLowerCase() === OWNER_EMAIL ? 'owner' : 'free';
}

let currentUser = null;
let currentProfile = null;   // the users/{uid} doc data (locale, units, …), if loaded
const authSubs = new Set();
function emitAuth() { authSubs.forEach((fn) => { try { fn(currentUser); } catch (e) {} }); }

// resolves once the first auth state is known (signed in or not)
let resolveReady;
const ready = new Promise((res) => { resolveReady = res; });

// finish any redirect-based sign-in that just came back
getRedirectResult(auth).catch(() => {});

onAuthStateChanged(auth, (u) => {
  currentUser = u ? {
    uid: u.uid,
    email: u.email || '',
    name: u.displayName || '',
    tier: tierFor(u.email),
  } : null;
  emitAuth();
  resolveReady();
  if (currentUser) logVisit().catch(() => {});
  // Signed out → the sign-in screen is up; get its popup ready. Deferred a
  // tick so the mount (queued on `ready`) paints first.
  else setTimeout(warmSignIn, 0);
});

async function signIn() {
  // Popup first: it returns the credential over postMessage, so it survives
  // iOS Safari's ITP (which breaks the signInWithRedirect storage hand-back
  // when authDomain isn't same-origin as the app). Popup is fine on desktop
  // and on mobile Safari when it's opened from a tap (this is).
  //
  // Fall back to a full-page redirect only when the popup can't run at all
  // (blocked, or an installed PWA / in-app webview with no popup support).
  //
  // No explicit resolver argument: the auth instance's own (warmed) one is used.
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    const code = (e && e.code) || '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/user-cancelled') return;
    try { await signInWithRedirect(auth, provider); } catch (e2) { /* give up */ }
  }
}

function userRef(f) { return f.doc(f.db, 'users', currentUser.uid); }
function bankRef(f) { return f.doc(f.db, 'users', currentUser.uid, 'bank', 'data'); }

async function logVisit() {
  if (!currentUser) return;
  const f = await fs();
  const { getDoc, setDoc, updateDoc, serverTimestamp, increment } = f;
  if (!currentUser) return;
  const ref = userRef(f);
  const snap = await getDoc(ref);
  currentProfile = snap.exists() ? snap.data() : {};
  const base = { email: currentUser.email, name: currentUser.name, tier: currentUser.tier,
    lastSeenAt: serverTimestamp() };
  if (snap.exists()) {
    await updateDoc(ref, { ...base, visits: increment(1) });
  } else {
    await setDoc(ref, { ...base, createdAt: serverTimestamp(), visits: 1 });
  }
}

// Persist a small set of user preferences (locale, units) onto users/{uid}.
async function saveProfile(fields) {
  if (!currentUser || !fields) return 'denied';
  const allow = ['locale', 'units'];
  const clean = {};
  for (const k of allow) if (fields[k] != null) clean[k] = String(fields[k]);
  if (!Object.keys(clean).length) return 'noop';
  currentProfile = { ...(currentProfile || {}), ...clean };
  try {
    const f = await fs();
    await f.setDoc(userRef(f), { ...clean, prefsAt: f.serverTimestamp() }, { merge: true });
    return 'ok';
  } catch (e) { return 'error'; }
}

async function loadBank() {
  if (!currentUser || currentUser.tier !== 'owner') return '';
  try {
    const f = await fs();
    const snap = await f.getDoc(bankRef(f));
    return (snap.exists() && snap.data().json) || '';
  } catch (e) { return ''; }
}

async function saveBank(json) {
  if (!currentUser || currentUser.tier !== 'owner') return 'denied';
  json = json == null ? '' : String(json);
  if (json.length > 900000) throw new Error('athlete bank too large');
  const f = await fs();
  await f.setDoc(bankRef(f), { json, updatedAt: f.serverTimestamp() });
  return 'ok';
}

// ── "my plans" — every signed-in user's own saved-plan store ───────────
// A single JSON blob at users/{uid}/plans/data, private to the account.
function myPlansRef(f) { return f.doc(f.db, 'users', currentUser.uid, 'plans', 'data'); }

async function loadPlans() {
  if (!currentUser) return '';
  try {
    const f = await fs();
    const snap = await f.getDoc(myPlansRef(f));
    return (snap.exists() && snap.data().json) || '';
  } catch (e) { return ''; }
}

async function savePlans(json) {
  if (!currentUser) return 'denied';
  json = json == null ? '' : String(json);
  if (json.length > 900000) throw new Error('plans store too large');
  const f = await fs();
  await f.setDoc(myPlansRef(f), { json, updatedAt: f.serverTimestamp() });
  return 'ok';
}

// ── shared race library (races/{raceId}) ───────────────────────────────
// Any signed-in user can browse it; only the owner curates routes.
// A course payload lives right in the doc (profileFlat / trackFlat as flat
// number arrays — Firestore forbids nested arrays), so loading a race needs
// no extra fetch. The raw .gpx goes to Storage at routes/{raceId}.gpx for
// provenance.
function raceRef(f, id) { return f.doc(f.db, 'races', id); }
let _racesCache = null;

function isOwnerNow() { return !!currentUser && currentUser.tier === 'owner'; }

async function racesList(force) {
  if (_racesCache && !force) return _racesCache;
  try {
    const f = await fs();
    const { collection, getDocs, query, where, db } = f;
    const read = async (q) => (await getDocs(q)).docs.map((d) => ({ id: d.id, ...d.data() }));
    if (isOwnerNow()) {
      // The owner curates the whole catalog, hidden races included.
      _racesCache = await read(collection(db, 'races'));
    } else {
      // Everyone else only ever sees races flagged listed:true — the where()
      // clause is also what firestore.rules checks to allow the list query.
      _racesCache = await read(query(collection(db, 'races'), where('listed', '==', true)));
      // Transitional: catalog predating the listed flag. Before the hardened
      // rules ship, an unfiltered read still works; after, it throws and we
      // fall through to whatever we already had.
      if (_racesCache.length === 0) {
        try { _racesCache = await read(collection(db, 'races')); } catch (e2) { /* rules enforced */ }
      }
    }
  } catch (e) { _racesCache = _racesCache || []; }
  return _racesCache;
}

async function raceDelete(id) {
  if (!isOwnerNow() || !id) return 'denied';
  const f = await fs();
  await f.deleteDoc(raceRef(f, id));
  _racesCache = null;
  return 'ok';
}

// One-time backfill: stamp listed:true on any race doc that predates the field,
// so non-owner list queries (where listed == true) can see them. Idempotent —
// only touches docs that are missing the flag.
async function racesEnsureListed() {
  if (!isOwnerNow()) return 0;
  const all = await racesList(true);
  const f = await fs();
  const stale = all.filter((r) => r.listed === undefined);
  let n = 0;
  for (let i = 0; i < stale.length; i += 20) {
    const chunk = stale.slice(i, i + 20);
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(chunk.map((r) => f.setDoc(raceRef(f, r.id), { listed: true }, { merge: true })
      .then(() => { n++; }).catch(() => {})));
  }
  if (n) _racesCache = null;
  return n;
}

async function raceSave(id, data) {
  if (!isOwnerNow() || !id) return 'denied';
  const f = await fs();
  const clean = JSON.parse(JSON.stringify(data || {}));
  clean.updatedAt = f.serverTimestamp();
  clean.updatedBy = currentUser.email;
  await f.setDoc(raceRef(f, id), clean, { merge: true });
  _racesCache = null;
  return 'ok';
}

async function racePutGpx(id, gpxText) {
  if (!isOwnerNow() || !id || !gpxText) return '';
  const path = 'routes/' + id + '.gpx';
  try {
    const s = await st();
    await s.uploadString(s.ref(s.storage, path), String(gpxText), 'raw',
      { contentType: 'application/gpx+xml' });
    return path;
  } catch (e) { return ''; }
}

// ── community route submissions (routeSubmissions/{id}) ────────────────
// Any signed-in (verified) user may propose a GPX route for a race; only the
// owner reads the queue and approves / rejects. Approval writes the course
// onto races/{id} via raceSave; the raw .gpx sits at submissions/{id}.gpx.
function subCol(f) { return f.collection(f.db, 'routeSubmissions'); }

function tsMillis(t) {
  if (!t) return 0;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.seconds === 'number') return t.seconds * 1000;
  return 0;
}

// A fresh doc id, no write — needed so the Storage path can be built first.
// Synchronous (callers use it inline), so it can't wait on the lazily-loaded
// Firestore SDK; this is the same 20-char alphanumeric scheme as its autoId().
function submissionId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const max = Math.floor(256 / chars.length) * chars.length; // reject-sample: no modulo bias
  let id = '';
  while (id.length < 20) {
    const bytes = crypto.getRandomValues(new Uint8Array(40));
    for (let i = 0; i < bytes.length && id.length < 20; i++) {
      if (bytes[i] < max) id += chars.charAt(bytes[i] % chars.length);
    }
  }
  return id;
}

async function submitRoute(id, data) {
  if (!currentUser || !id) return 'denied';
  const f = await fs();
  const body = {
    ...JSON.parse(JSON.stringify(data || {})),
    status: 'pending',
    submitterUid: currentUser.uid,
    submitterEmail: currentUser.email,
    submitterName: currentUser.name,
    createdAt: f.serverTimestamp(),
    reviewedAt: null,
  };
  await f.setDoc(f.doc(subCol(f), id), body);
  return 'ok';
}

async function submitPutGpx(id, gpxText) {
  if (!currentUser || !id || !gpxText) return '';
  const path = 'submissions/' + id + '.gpx';
  try {
    const s = await st();
    await s.uploadString(s.ref(s.storage, path), String(gpxText), 'raw',
      { contentType: 'application/gpx+xml' });
    return path;
  } catch (e) { return ''; }
}

async function submissionsList(status) {
  if (!isOwnerNow()) return [];
  try {
    const f = await fs();
    const snap = await f.getDocs(f.query(subCol(f), f.where('status', '==', status || 'pending')));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
  } catch (e) { return []; }
}

async function submissionReview(id, action, note) {
  if (!isOwnerNow() || !id) return 'denied';
  if (action !== 'approved' && action !== 'rejected') return 'bad-action';
  const f = await fs();
  await f.updateDoc(f.doc(subCol(f), id), {
    status: action,
    reviewedAt: f.serverTimestamp(),
    reviewedBy: currentUser.email,
    reviewNote: note || null,
  });
  return 'ok';
}

// One-time bulk import of the shipped catalog. Skips ids that already exist,
// so it never clobbers a route the owner has already attached.
async function racesSeed(records) {
  if (!isOwnerNow() || !Array.isArray(records)) return 0;
  const have = new Set((await racesList(true)).map((r) => r.id));
  const f = await fs();
  const pending = records.filter((r) => r && r.id && !have.has(r.id));
  let n = 0;
  for (let i = 0; i < pending.length; i += 20) {
    const chunk = pending.slice(i, i + 20);
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(chunk.map((rec) => {
      const { id, ...rest } = rec;
      return f.setDoc(raceRef(f, id), {
        ...rest,
        seed: true,
        listed: rest.listed !== false,
        routeStatus: rest.routeStatus || 'none',
        createdAt: f.serverTimestamp(),
        updatedBy: currentUser.email,
      }).then(() => { n++; }).catch(() => {});
    }));
  }
  _racesCache = null;
  return n;
}

window.RP_FIREBASE = {
  ready,
  get user() { return currentUser; },
  get profile() { return currentProfile; },
  onAuth(fn) { authSubs.add(fn); return () => authSubs.delete(fn); },
  signIn,
  signOut: () => signOut(auth),
  saveProfile,
  loadBank,
  saveBank,
  loadPlans,
  savePlans,
  logVisit,
  racesList,
  raceSave,
  raceDelete,
  racesEnsureListed,
  racePutGpx,
  racesSeed,
  submissionId,
  submitRoute,
  submitPutGpx,
  submissionsList,
  submissionReview,
};
