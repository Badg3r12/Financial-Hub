// App entry: opens the local database, draws navigation, routes between screens.
import * as S from './store.js';
import { h } from './util.js';
import { icon, decorateTaps } from './ui.js';
import { inboxCount } from './calc.js';
import { openQuickAdd } from './views/quickadd.js';
import { applyTheme } from './views/more.js';

const MODULES = ['home', 'budget', 'invest', 'goals', 'more', 'inbox', 'import'];
const VIEWS = {};
const TABS = [['home', 'Home'], ['budget', 'Budget'], ['invest', 'Invest'], ['goals', 'Goals'], ['more', 'More']];
const TAB_FOR = { trades: 'invest', inbox: 'home', import: 'more', networth: 'more', car: 'more', settings: 'more', shared: 'budget', txns: 'budget', paystubs: 'more' };

// Screens that aren't one of the main tabs get a Back button (the installed app has no browser back button).
const PARENT = { txns: 'budget', shared: 'budget', car: 'more', settings: 'more', networth: 'more', paystubs: 'more', import: 'more', inbox: 'home', trades: 'invest' };
const LABEL = Object.fromEntries(TABS);
function parentOf(name, args) {
  if (PARENT[name]) return PARENT[name];
  if ((name === 'invest' || name === 'goals' || name === 'home' || name === 'more') && args.length) return name; // e.g. #invest/exposure
  return null; // budget/<month> is still the Budget tab
}
const trail = []; // in-app history, so Back returns to exactly where you were (same month, same scroll)
const NAMES = { txns: 'Transactions', shared: 'Shared costs', car: 'Car log', settings: 'Settings', networth: 'Net worth', paystubs: 'Paystubs', import: 'Import', inbox: 'Inbox', trades: 'Buys & sells' };
const nameOf = (hash) => { const [n, ...a] = (hash || '#home').slice(1).split('/'); return n === 'invest' && a[0] === 'exposure' ? 'Overlap' : LABEL[n] || NAMES[n] || 'Back'; };
// Back returns to the screen you came from (same month, same scroll); on a fresh launch it goes to the parent tab.
function backTarget() { const prev = trail.at(-2); return prev && prev !== location.hash ? { prev, label: nameOf(prev) } : null; }
function goBack() {
  const { name, args } = route(), parent = parentOf(name, args); if (!parent) return;
  if (backTarget()) history.back(); else location.hash = '#' + parent;
}

function route() { const [name, ...args] = (location.hash.slice(1) || 'home').split('/'); return { name: VIEWS[name] ? name : 'home', args: args.map(decodeURIComponent) }; }

function drawNav(active) {
  const n = inboxCount(), on = TAB_FOR[active] || active;
  document.getElementById('nav').innerHTML = h`<div class="brand">Finance Hub</div>
    ${TABS.map(([k, label]) => h`<a href="#${k}" class="${on === k ? 'on' : ''}">${icon(k)}<span>${label}</span>${k === 'home' && n ? h`<span class="badge">${n}</span>` : ''}</a>`)}
    <a href="#inbox" class="desk ${active === 'inbox' ? 'on' : ''}">${icon('inbox')}<span>Inbox</span>${n ? h`<span class="badge">${n}</span>` : ''}</a>
    <a href="#import" class="desk ${active === 'import' ? 'on' : ''}">${icon('import')}<span>Import</span></a>`.__raw;
}

let lastKey = '', wentBack = false; const scrolls = {};
function render() {
  if (document.getElementById('sheet').open) return; // don't redraw under an open form
  const { name, args } = route(), v = VIEWS[name], main = document.getElementById('main');
  if (lastKey && location.hash !== lastKey) scrolls[lastKey] = window.scrollY;
  const y = location.hash === lastKey ? window.scrollY : wentBack ? scrolls[location.hash] || 0 : 0; wentBack = false;
  drawNav(name);
  const parent = parentOf(name, args);
  main.innerHTML = (parent ? `<button type="button" class="back-btn" id="back-btn"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>${backTarget()?.label || LABEL[parent] || 'Back'}</button>` : '') + v.render(...args).__raw;
  main.querySelector('#back-btn')?.addEventListener('click', goBack);
  v.mount?.(main, ...args);
  decorateTaps(main);
  if (location.hash !== lastKey) main.focus({ preventScroll: true });
  window.scrollTo(0, y); lastKey = location.hash;
}

async function start() {
  applyTheme();
  await S.open();
  for (const m of MODULES) Object.assign(VIEWS, (await import(`./views/${m}.js`)).views);
  const sync = await import('./sync.js');
  if (!S.all('accounts').length && !Object.keys(localStorage).some((k) => k.startsWith('synced-'))) (await import('./defaults.js')).install();
  // The Roth 401(k) is with Ekon Benefits; early versions labeled it Vanguard.
  setTimeout(() => { for (const a of S.all('accounts')) if (a.type === 'Roth 401k' && a.institution === 'Vanguard') S.put('accounts', { ...a, institution: 'Ekon Benefits' }); }, 5000);
  sync.onStatus(() => { if (location.hash.startsWith('#settings')) render(); });
  sync.start().catch((e) => console.error(e));
  document.getElementById('fab').onclick = () => openQuickAdd();
  trail.push(location.hash || '#home');
  window.addEventListener('hashchange', () => { if (trail.at(-1) === location.hash) { /* same screen redrawn */ } else if (trail.at(-2) === location.hash) { trail.pop(); wentBack = true; } else trail.push(location.hash); render(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.getElementById('sheet').open && !/input|textarea|select/i.test(e.target.tagName)) goBack(); });
  document.getElementById('sheet').addEventListener('close', render);
  let t; S.onChange(() => { clearTimeout(t); t = setTimeout(render, 30); });
  render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
start().catch((e) => { document.getElementById('main').innerHTML = `<div class="card"><h2>Something went wrong</h2><p class="muted"></p></div>`; document.querySelector('#main .muted').textContent = String(e.stack || e); console.error(e); });
