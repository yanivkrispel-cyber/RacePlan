// web/firebase-init.js — Firebase (Auth + Firestore) glue for RacePlan.
// Exposes window.RP_FIREBASE; the app bundle (app.js) waits on RP_FIREBASE.ready
// before it mounts. Loaded as a deferred ES module, before app.js.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged,
  signInWithRedirect, signInWithPopup, getRedirectResult, signOut,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, increment,
  collection, getDocs, query, where,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {
  getStorage, ref as storageRef, uploadString,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBW6HPQ-W3uEvDtjo8mOAn5RejAik-agzU',
  // Same-origin auth handler. This value decides the OAuth redirect_uri Google
  // sees ( <authDomain>/__/auth/handler ); both this one and the …firebaseapp.com
  // handler are now registered as authorized redirect URIs on the OAuth web
  // client, so redirect and popup both work. Serving the handler from the app's
  // own origin also means iOS Safari's ITP can't break the signInWithRedirect
  // credential hand-back (no cross-site storage read). Firebase Hosting serves
  // /__/auth/* on this domain automatically.
  authDomain: 'raceplan-17e5b.web.app',
  projectId: 'raceplan-17e5b',
  storageBucket: 'raceplan-17e5b.firebasestorage.app',
  messagingSenderId: '13899079695',
  appId: '1:13899079695:web:01fdf5fb2d6c6c4e15837a',
  measurementId: 'G-T89TYJTDZQ',
};

// The account that gets the full app (athlete bank). Everyone else is "free".
const OWNER_EMAIL = 'yaniv.krispel@gmail.com';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
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
});

async function signIn() {
  // Popup first: it returns the credential over postMessage, so it survives
  // iOS Safari's ITP (which breaks the signInWithRedirect storage hand-back
  // when authDomain isn't same-origin as the app). Popup is fine on desktop
  // and on mobile Safari when it's opened from a tap (this is).
  //
  // Fall back to a full-page redirect only when the popup can't run at all
  // (blocked, or an installed PWA / in-app webview with no popup support).
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    const code = (e && e.code) || '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/user-cancelled') return;
    try { await signInWithRedirect(auth, provider); } catch (e2) { /* give up */ }
  }
}

function userRef() { return doc(db, 'users', currentUser.uid); }
function bankRef() { return doc(db, 'users', currentUser.uid, 'bank', 'data'); }

async function logVisit() {
  if (!currentUser) return;
  const ref = userRef();
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
    await setDoc(userRef(), { ...clean, prefsAt: serverTimestamp() }, { merge: true });
    return 'ok';
  } catch (e) { return 'error'; }
}

async function loadBank() {
  if (!currentUser || currentUser.tier !== 'owner') return '';
  try {
    const snap = await getDoc(bankRef());
    return (snap.exists() && snap.data().json) || '';
  } catch (e) { return ''; }
}

async function saveBank(json) {
  if (!currentUser || currentUser.tier !== 'owner') return 'denied';
  json = json == null ? '' : String(json);
  if (json.length > 900000) throw new Error('athlete bank too large');
  await setDoc(bankRef(), { json, updatedAt: serverTimestamp() });
  return 'ok';
}

// ── "my plans" — every signed-in user's own saved-plan store ───────────
// A single JSON blob at users/{uid}/plans/data, private to the account.
function myPlansRef() { return doc(db, 'users', currentUser.uid, 'plans', 'data'); }

async function loadPlans() {
  if (!currentUser) return '';
  try {
    const snap = await getDoc(myPlansRef());
    return (snap.exists() && snap.data().json) || '';
  } catch (e) { return ''; }
}

async function savePlans(json) {
  if (!currentUser) return 'denied';
  json = json == null ? '' : String(json);
  if (json.length > 900000) throw new Error('plans store too large');
  await setDoc(myPlansRef(), { json, updatedAt: serverTimestamp() });
  return 'ok';
}

// ── shared race library (races/{raceId}) ───────────────────────────────
// Any signed-in user can browse it; only the owner curates routes.
// A course payload lives right in the doc (profileFlat / trackFlat as flat
// number arrays — Firestore forbids nested arrays), so loading a race needs
// no extra fetch. The raw .gpx goes to Storage at routes/{raceId}.gpx for
// provenance.
function raceRef(id) { return doc(db, 'races', id); }
let _racesCache = null;

function isOwnerNow() { return !!currentUser && currentUser.tier === 'owner'; }

async function racesList(force) {
  if (_racesCache && !force) return _racesCache;
  const read = async (q) => (await getDocs(q)).docs.map((d) => ({ id: d.id, ...d.data() }));
  try {
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
  await deleteDoc(raceRef(id));
  _racesCache = null;
  return 'ok';
}

// One-time backfill: stamp listed:true on any race doc that predates the field,
// so non-owner list queries (where listed == true) can see them. Idempotent —
// only touches docs that are missing the flag.
async function racesEnsureListed() {
  if (!isOwnerNow()) return 0;
  const all = await racesList(true);
  const stale = all.filter((r) => r.listed === undefined);
  let n = 0;
  for (let i = 0; i < stale.length; i += 20) {
    const chunk = stale.slice(i, i + 20);
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(chunk.map((r) => setDoc(raceRef(r.id), { listed: true }, { merge: true })
      .then(() => { n++; }).catch(() => {})));
  }
  if (n) _racesCache = null;
  return n;
}

async function raceSave(id, data) {
  if (!isOwnerNow() || !id) return 'denied';
  const clean = JSON.parse(JSON.stringify(data || {}));
  clean.updatedAt = serverTimestamp();
  clean.updatedBy = currentUser.email;
  await setDoc(raceRef(id), clean, { merge: true });
  _racesCache = null;
  return 'ok';
}

async function racePutGpx(id, gpxText) {
  if (!isOwnerNow() || !id || !gpxText) return '';
  const path = 'routes/' + id + '.gpx';
  try {
    await uploadString(storageRef(storage, path), String(gpxText), 'raw',
      { contentType: 'application/gpx+xml' });
    return path;
  } catch (e) { return ''; }
}

// ── community route submissions (routeSubmissions/{id}) ────────────────
// Any signed-in (verified) user may propose a GPX route for a race; only the
// owner reads the queue and approves / rejects. Approval writes the course
// onto races/{id} via raceSave; the raw .gpx sits at submissions/{id}.gpx.
function subCol() { return collection(db, 'routeSubmissions'); }

function tsMillis(t) {
  if (!t) return 0;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.seconds === 'number') return t.seconds * 1000;
  return 0;
}

// A fresh doc id, no write — needed so the Storage path can be built first.
function submissionId() { return doc(subCol()).id; }

async function submitRoute(id, data) {
  if (!currentUser || !id) return 'denied';
  const body = {
    ...JSON.parse(JSON.stringify(data || {})),
    status: 'pending',
    submitterUid: currentUser.uid,
    submitterEmail: currentUser.email,
    submitterName: currentUser.name,
    createdAt: serverTimestamp(),
    reviewedAt: null,
  };
  await setDoc(doc(subCol(), id), body);
  return 'ok';
}

async function submitPutGpx(id, gpxText) {
  if (!currentUser || !id || !gpxText) return '';
  const path = 'submissions/' + id + '.gpx';
  try {
    await uploadString(storageRef(storage, path), String(gpxText), 'raw',
      { contentType: 'application/gpx+xml' });
    return path;
  } catch (e) { return ''; }
}

async function submissionsList(status) {
  if (!isOwnerNow()) return [];
  try {
    const snap = await getDocs(query(subCol(), where('status', '==', status || 'pending')));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
  } catch (e) { return []; }
}

async function submissionReview(id, action, note) {
  if (!isOwnerNow() || !id) return 'denied';
  if (action !== 'approved' && action !== 'rejected') return 'bad-action';
  await updateDoc(doc(subCol(), id), {
    status: action,
    reviewedAt: serverTimestamp(),
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
  const pending = records.filter((r) => r && r.id && !have.has(r.id));
  let n = 0;
  for (let i = 0; i < pending.length; i += 20) {
    const chunk = pending.slice(i, i + 20);
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(chunk.map((rec) => {
      const { id, ...rest } = rec;
      return setDoc(raceRef(id), {
        ...rest,
        seed: true,
        listed: rest.listed !== false,
        routeStatus: rest.routeStatus || 'none',
        createdAt: serverTimestamp(),
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
