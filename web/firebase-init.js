// web/firebase-init.js — Firebase (Auth + Firestore) glue for RacePlan.
// Exposes window.RP_FIREBASE; the app bundle (app.js) waits on RP_FIREBASE.ready
// before it mounts. Loaded as a deferred ES module, before app.js.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged,
  signInWithRedirect, signInWithPopup, getRedirectResult, signOut,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp, increment,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBW6HPQ-W3uEvDtjo8mOAn5RejAik-agzU',
  authDomain: 'raceplan-17e5b.firebaseapp.com',
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
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

function tierFor(email) {
  return (email || '').toLowerCase() === OWNER_EMAIL ? 'owner' : 'free';
}

let currentUser = null;
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
  // Redirect is the one flow that works everywhere — installed PWA, iOS, and
  // desktop — with a single consent. (Popup double-prompts when it's blocked
  // and then falls back to redirect.)
  try { await signInWithRedirect(auth, provider); }
  catch (e) { try { await signInWithPopup(auth, provider); } catch (e2) {} }
}

function userRef() { return doc(db, 'users', currentUser.uid); }
function bankRef() { return doc(db, 'users', currentUser.uid, 'bank', 'data'); }

async function logVisit() {
  if (!currentUser) return;
  const ref = userRef();
  const snap = await getDoc(ref);
  const base = { email: currentUser.email, name: currentUser.name, tier: currentUser.tier,
    lastSeenAt: serverTimestamp() };
  if (snap.exists()) {
    await updateDoc(ref, { ...base, visits: increment(1) });
  } else {
    await setDoc(ref, { ...base, createdAt: serverTimestamp(), visits: 1 });
  }
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

window.RP_FIREBASE = {
  ready,
  get user() { return currentUser; },
  onAuth(fn) { authSubs.add(fn); return () => authSubs.delete(fn); },
  signIn,
  signOut: () => signOut(auth),
  loadBank,
  saveBank,
  logVisit,
};
