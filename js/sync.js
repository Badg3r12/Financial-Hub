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

export function getConfig() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }
// Accepts the snippet Firebase shows (const firebaseConfig = { apiKey: "...", ... }) or plain JSON.
export function saveConfig(text) {
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
    const localIsFresh = !S.all('txns').length && !S.all('lots').length && !S.all('snapshots').length;
    if (remoteHasData && localIsFresh) await S.clearAll(); // new device: take the cloud copy, drop the starter setup
    else for (const c of S.COLLECTIONS) { const docs = await S.rawAll(c); if (docs.length) await upload(c, docs); }
    localStorage.setItem(flag, '1');
  }
  setTimeout(async () => { if (user && !S.all('accounts').length) (await import('./defaults.js')).install(); }, 4000); // brand-new everywhere
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
