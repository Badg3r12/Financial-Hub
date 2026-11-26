// App entry: opens the local database, draws navigation, routes between screens.
import * as S from './store.js';
import { h } from './util.js';
import { icon } from './ui.js';
import { inboxCount } from './calc.js';
import { openQuickAdd } from './views/quickadd.js';
import { applyTheme } from './views/more.js';

const MODULES = ['home', 'budget', 'invest', 'goals', 'more', 'inbox', 'import'];
const VIEWS = {};
const TABS = [['home', 'Home'], ['budget', 'Budget'], ['invest', 'Invest'], ['goals', 'Goals'], ['more', 'More']];
const TAB_FOR = { inbox: 'home', import: 'more', networth: 'more', car: 'more', settings: 'more', shared: 'budget', txns: 'budget', paystubs: 'more' };

function route() { const [name, ...args] = (location.hash.slice(1) || 'home').split('/'); return { name: VIEWS[name] ? name : 'home', args: args.map(decodeURIComponent) }; }

function drawNav(active) {
  const n = inboxCount(), on = TAB_FOR[active] || active;
  document.getElementById('nav').innerHTML = h`<div class="brand">Finance Hub</div>
    ${TABS.map(([k, label]) => h`<a href="#${k}" class="${on === k ? 'on' : ''}">${icon(k)}<span>${label}</span>${k === 'home' && n ? h`<span class="badge">${n}</span>` : ''}</a>`)}
    <a href="#inbox" class="desk ${active === 'inbox' ? 'on' : ''}">${icon('inbox')}<span>Inbox</span>${n ? h`<span class="badge">${n}</span>` : ''}</a>
    <a href="#import" class="desk ${active === 'import' ? 'on' : ''}">${icon('import')}<span>Import</span></a>`.__raw;
}

let lastKey = '';
function render() {
  if (document.getElementById('sheet').open) return; // don't redraw under an open form
  const { name, args } = route(), v = VIEWS[name], main = document.getElementById('main');
  const y = location.hash === lastKey ? window.scrollY : 0;
  drawNav(name);
  main.innerHTML = v.render(...args).__raw;
  v.mount?.(main, ...args);
  window.scrollTo(0, y); lastKey = location.hash;
}

async function start() {
  applyTheme();
  await S.open();
  for (const m of MODULES) Object.assign(VIEWS, (await import(`./views/${m}.js`)).views);
  const sync = await import('./sync.js');
  if (!S.all('accounts').length && !sync.getConfig()) (await import('./defaults.js')).install();
  sync.onStatus(() => { if (location.hash.startsWith('#settings')) render(); });
  sync.start().catch((e) => console.error(e));
  document.getElementById('fab').onclick = () => openQuickAdd();
  window.addEventListener('hashchange', render);
  document.getElementById('sheet').addEventListener('close', render);
  let t; S.onChange(() => { clearTimeout(t); t = setTimeout(render, 30); });
  render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
start().catch((e) => { document.getElementById('main').innerHTML = `<div class="card"><h2>Something went wrong</h2><p class="muted"></p></div>`; document.querySelector('#main .muted').textContent = String(e.stack || e); console.error(e); });
