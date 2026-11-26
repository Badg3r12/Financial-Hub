// Local data store: every collection lives in IndexedDB on this device and is mirrored in memory.
// All writes go through put/remove so a sync adapter (Firebase, added later) can hook in one place.
import { uid } from './util.js';

export const COLLECTIONS = ['accounts', 'categories', 'budgets', 'txns', 'income', 'transfers', 'funds', 'contributions',
  'lots', 'securities', 'snapshots', 'car', 'rules', 'imports', 'paystubs', 'k401', 'settings'];

const DB_NAME = 'finance-hub', VERSION = 2;
let db; const mem = {}; const listeners = new Set(); let syncHook = null;

function req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

export async function open() {
  const r = indexedDB.open(DB_NAME, VERSION);
  r.onupgradeneeded = () => { for (const c of COLLECTIONS) if (!r.result.objectStoreNames.contains(c)) r.result.createObjectStore(c, { keyPath: 'id' }); };
  db = await req(r);
  for (const c of COLLECTIONS) {
    const all = await req(db.transaction(c).objectStore(c).getAll());
    mem[c] = new Map(all.filter((d) => !d.deleted).map((d) => [d.id, d]));
  }
  try { await navigator.storage?.persist?.(); } catch { /* not critical */ }
}

export const all = (c) => [...mem[c].values()];
export const get = (c, id) => mem[c].get(id);
export const setting = (id, fallback = {}) => mem.settings.get(id)?.value ?? fallback;
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function setSyncHook(fn) { syncHook = fn; }
const notify = () => listeners.forEach((fn) => fn());

export async function putMany(c, docs, { silent } = {}) {
  if (!docs.length) return;
  const tx = db.transaction(c, 'readwrite'), os = tx.objectStore(c), now = Date.now();
  for (const d of docs) { d.id ||= uid(); d.updatedAt = now; os.put(d); if (d.deleted) mem[c].delete(d.id); else mem[c].set(d.id, d); }
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  syncHook?.(c, docs);
  if (!silent) notify();
}
// Apply documents that came from the cloud: keep their timestamps, don't echo them back, newest version wins.
export async function applyRemote(c, docs) {
  const fresh = docs.filter((d) => { const local = mem[c].get(d.id); return !local || (d.updatedAt || 0) > (local.updatedAt || 0) || (d.deleted && local); });
  if (!fresh.length) return 0;
  const tx = db.transaction(c, 'readwrite'), os = tx.objectStore(c);
  for (const d of fresh) { os.put(d); if (d.deleted) mem[c].delete(d.id); else mem[c].set(d.id, d); }
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  notify(); return fresh.length;
}
// Everything stored on this device, including deletion markers (for the first upload to the cloud).
export async function rawAll(c) { return req(db.transaction(c).objectStore(c).getAll()); }

export const put = (c, doc) => putMany(c, [doc]).then(() => doc);
export const remove = (c, id) => putMany(c, [{ ...(get(c, id) || { id }), deleted: true }]);
export const removeMany = (c, ids) => putMany(c, ids.map((id) => ({ ...(get(c, id) || { id }), deleted: true })));
export const saveSetting = (id, value) => put('settings', { id, value });

export async function clearAll() {
  const tx = db.transaction(COLLECTIONS, 'readwrite');
  for (const c of COLLECTIONS) { tx.objectStore(c).clear(); mem[c] = new Map(); }
  await new Promise((res) => { tx.oncomplete = res; });
  notify();
}

export function exportAll() {
  const out = { app: 'finance-hub', version: 1, exportedAt: new Date().toISOString(), data: {} };
  for (const c of COLLECTIONS) out.data[c] = all(c);
  return out;
}
export async function importAll(json) {
  if (json?.app !== 'finance-hub' || !json.data) throw new Error('This is not a Finance Hub export file.');
  await clearAll();
  for (const c of COLLECTIONS) if (json.data[c]?.length) await putMany(c, json.data[c], { silent: true });
  notify();
}
