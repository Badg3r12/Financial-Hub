// Offline support: cache the app files so it opens without a connection. Data lives in IndexedDB, not here.
const CACHE = 'finance-hub-v6';
const FILES = ['./', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icon.svg', 'icon-180.png',
  'js/app.js', 'js/util.js', 'js/store.js', 'js/calc.js', 'js/ui.js', 'js/charts.js', 'js/defaults.js',
  'js/views/home.js', 'js/views/budget.js', 'js/views/invest.js', 'js/views/goals.js', 'js/views/more.js', 'js/views/inbox.js', 'js/views/import.js', 'js/views/quickadd.js',
  'js/market.js', 'js/sync.js', 'vendor/firebase/firebase-app.js', 'vendor/firebase/firebase-auth.js', 'vendor/firebase/firebase-firestore.js',
  'js/import/xlsx.js', 'js/import/history.js', 'js/import/bank.js', 'js/import/vanguard.js', 'js/import/paystub.js', 'js/import/k401.js', 'js/import/pdf.js', 'js/import/ocr.js', 'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs'];
// Market data files (published by the repo's action) are cached too, but a missing one must not block install.
const DATA = ['data/prices.json', 'data/holdings.json'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES).then(() => Promise.all(DATA.map((f) => c.add(f).catch(() => {}))))).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
// Network first (so updates show up), cache as fallback when offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
