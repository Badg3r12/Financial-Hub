// Cloud sync through your own free Firebase project (Firestore + email sign-in).
// The app works fully without it; when set up, every change is copied to users/<your id>/<collection>/<doc>
// and changes made on your other devices flow back in. Firestore queues writes while offline.
import * as S from './store.js';

const KEY = 'firebaseConfig';
let fb = null, auth = null, fs = null, user = null, unsubs = [], status = 'off', lastSync = null;
const listeners = new Set();
const setStatus = (s) => { status = s; listeners.forEach((f) => f()); };
export const onStatus = (f) => { listeners.add(f); return () => listeners.delete(f); };
export const syncState = () => ({ status, email: user?.email || null, lastSync, configured: !!getConfig() });

// Your Firebase project, built in so no device needs it pasted. This block only names the project; it is not a password.
// Sign-in and the Firestore rules (only your own account can read or write users/<your id>) are what protect the data.
const BUILT_IN = { apiKey: 'AIzaSyAA0Ri1Ub3zuR4aDTHk31htFbo8j9YHAGI', authDomain: 'finance-hub-52289.firebaseapp.com', projectId: 'finance-hub-52289', appId: '1:87312358002:web:2160b4de401204d21ac0eb' };
export function getConfig() {
  try { localStorage.removeItem(KEY); } catch { /* a config pasted by hand on older versions could be mistyped; never use it */ }
  return BUILT_IN;
}
// Accepts the snippet Firebase shows (const firebaseConfig = { apiKey: "...", ... }) or plain JSON.
export function saveConfig(text) {
  text = text.replace(/[\u201c\u201d\u2018\u2019]/g, '"'); // curly quotes from Notes or Messages
  const pick = (k) => (text.match(new RegExp(`["']?${k}["']?\\s*:\\s*["']([^"']+)["']`)) || [])[1];
  const cfg = { apiKey: pick('apiKey'), authDomain: pick('authDomain'), projectId: pick('projectId'), appId: pick('appId') };
  if (!cfg.apiKey || !cfg.projectId) throw new Error('That doesn\'t look like a Firebase config. Copy the whole firebaseConfig block.');
  localStorage.setItem(KEY, JSON.stringify(cfg)); return cfg;
}
export function forgetConfig() { localStorage.removeItem(KEY); }

async function load() {
  if (fb) return;
  const cfg = getConfig(); if (!cfg) return;
  const [app, a, f] = await Promise.all([import('../vendor/firebase/firebase-app.js'), import('../vendor/firebase/firebase-auth.js'), import('../vendor/firebase/firebase-firestore.js')]);
  const inst = app.initializeApp(cfg);
  auth = a.getAuth(inst);
  fs = f.initializeFirestore(inst, { localCache: f.persistentLocalCache({ tabManager: f.persistentMultipleTabManager() }) });
  fb = { a, f };
}

export async function start() {
  if (!getConfig()) return setStatus('off');
  try { await load(); } catch (e) { console.error(e); return setStatus('error'); }
  fb.a.onAuthStateChanged(auth, (u) => { user = u; if (u) connect(); else { stop(); setStatus('signed-out'); } });
}

export async function signIn(email, password, create) {
  await load();
  const fn = create ? fb.a.createUserWithEmailAndPassword : fb.a.signInWithEmailAndPassword;
  await fn(auth, email, password);
}
export async function resetPassword(email) { await load(); await fb.a.sendPasswordResetEmail(auth, email); }
export async function signOutNow() { await load(); await fb.a.signOut(auth); }

const col = (c) => fb.f.collection(fs, 'users', user.uid, c);
const clean = (d) => JSON.parse(JSON.stringify(d)); // Firestore rejects undefined values

async function upload(c, docs) {
  for (let i = 0; i < docs.length; i += 400) {
    const batch = fb.f.writeBatch(fs);
    for (const d of docs.slice(i, i + 400)) batch.set(fb.f.doc(col(c), String(d.id)), clean(d));
    await batch.commit();
  }
}

async function connect() {
  stop(); setStatus('syncing');
  // First time on this device: send everything this device has (the newest version of each record wins on the other side).
  const flag = 'synced-' + user.uid;
  if (!localStorage.getItem(flag)) {
    const remoteHasData = !(await fb.f.getDocs(fb.f.query(col('accounts'), fb.f.limit(1)))).empty;
    if (!remoteHasData && !S.all('accounts').length) (await import('./defaults.js')).install(); // brand-new everywhere
    const localIsFresh = !S.all('txns').length && !S.all('lots').length && !S.all('snapshots').length;
    if (remoteHasData && localIsFresh) await S.clearAll(); // new device: take the cloud copy, drop the starter setup
    else for (const c of S.COLLECTIONS) { const docs = await S.rawAll(c); if (docs.length) await upload(c, docs); }
    localStorage.setItem(flag, '1');
  }
  S.setSyncHook((c, docs) => { if (user) upload(c, docs).catch((e) => { console.error(e); setStatus('error'); }); });
  for (const c of S.COLLECTIONS) {
    unsubs.push(fb.f.onSnapshot(col(c), { includeMetadataChanges: false }, async (snap) => {
      const docs = snap.docChanges().filter((ch) => ch.type !== 'removed').map((ch) => ch.doc.data());
      if (docs.length) await S.applyRemote(c, docs);
      lastSync = new Date(); setStatus('on');
    }, (e) => { console.error(e); setStatus('error'); }));
  }
}
function stop() { unsubs.forEach((u) => u()); unsubs = []; S.setSyncHook(null); }
