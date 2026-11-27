import * as S from '../store.js';
import { h, raw, money, money0, thisMonth, monthName, addMonths, MONTHS, ym, sum, toCents } from '../util.js';
import * as C from '../calc.js';
import { openSheet, closeSheet, toast, options } from '../ui.js';
import { txnRow, bindTxnRows } from './home.js';

const isCollege = (m) => m < C.BASELINE_START;

function render(month = thisMonth(), mode = 'month') {
  const sm = C.monthSummary(month), tm = C.typicalMonth();
  const rows = sm.rows.filter((r) => r.budget || r.spent || r.oneOff).sort((a, b) => (C.cat(a.catId)?.name || '').localeCompare(C.cat(b.catId)?.name || ''));
  const y = +month.slice(0, 4), suffix = mode === 'month' ? '' : '/' + mode, step = mode === 'year' ? 12 : 1, list = monthList(month);
  const picker = mode === 'since' ? '' : mode === 'year'
    ? h`<div class="row"><a class="btn" href="#budget/${addMonths(month, -12)}/year" aria-label="Previous year">‹</a><b class="num" style="min-width:56px;text-align:center">${y}</b><a class="btn" href="#budget/${addMonths(month, 12)}/year" aria-label="Next year">›</a></div>`
    : h`<div class="row"><a class="btn" href="#budget/${addMonths(month, -step)}${suffix}" aria-label="Previous month">‹</a>
      <select id="b-month" style="width:auto" aria-label="Month">${options(list.map((m) => [m, monthName(m) + (isCollege(m) ? ' (college)' : '')]), month)}</select>
      ${month < list.at(-1) ? h`<a class="btn" href="#budget/${addMonths(month, step)}${suffix}" aria-label="Next month">›</a>` : h`<span class="btn" aria-disabled="true" style="opacity:.4">›</span>`}</div>`;
  return h`<div class="row between wrap"><h1>Budget</h1>${picker}</div>
  <div class="tabs"><a href="#budget/${month}" class="${mode === 'month' ? 'on' : ''}">Month</a><a href="#budget/${month}/year" class="${mode === 'year' ? 'on' : ''}">Year grid</a>
    <a href="#budget/${month}/since" class="${mode === 'since' ? 'on' : ''}">Since July</a></div>
  <div class="row wrap small" style="gap:14px;margin:-4px 0 12px"><a href="#txns">All transactions ›</a><a href="#trends">Trends ›</a><a href="#subscriptions">Subscriptions ›</a><a href="#cashflow">Cash flow ›</a><a href="#shared">Shared costs ›</a></div>
  ${isCollege(month) ? h`<p class="notice">College-era month: shown as history only. Budgets and averages use July 2026 onward.</p>` : ''}
  ${mode === 'year' ? yearGrid(y) : mode === 'since' ? since(tm) : h`
  <div class="grid cols-3" style="margin-bottom:14px">
    <div class="card"><h3>Spent</h3><div class="big num">${money0(sm.spent)}</div><div class="small muted">of ${money0(sm.budget)} budgeted</div></div>
    <div class="card"><h3>Left</h3><div class="big num ${sm.budget - sm.spent < 0 ? 'bad' : ''}">${money0(sm.budget - sm.spent)}</div><div class="small muted">Income this month ${money0(sm.income)}</div></div>
    <div class="card"><h3>Outside the budget</h3><div class="big num">${money0(sm.oneOff)}</div><div class="small muted">one-off${sm.shared ? ` · ${money0(sm.shared)} shared` : ''}${sm.reimb ? ` · ${money0(sm.reimb)} work (reimbursed)` : ''}</div></div>
  </div>
  <div class="card"><ul class="list">${rows.length ? rows.map((r) => catRow(r, month)) : h`<li class="muted">Nothing this month yet.</li>`}</ul></div>`}`;
}
// From the first month with data through a year ahead, always including the month being shown.
function monthList(current) {
  const first = S.all('txns').reduce((a, t) => (t.date && t.date < a ? t.date : a), thisMonth()).slice(0, 7), last = addMonths(thisMonth(), 12);
  const out = []; for (let m = first < current ? first : current; m <= (last > current ? last : current); m = addMonths(m, 1)) out.push(m); return out;
}
function catRow(r, month) {
  const c = C.cat(r.catId), f = r.budget ? r.spent / r.budget : (r.spent ? 2 : 0);
  return h`<li class="tap" data-cat="${r.catId}" data-month="${month}"><div class="grow">
    <div class="row between"><span class="ellipsis">${c?.name || 'Uncategorized'}</span><span class="num small ${f > 1 ? 'bad' : ''}">${money0(r.spent)} / ${money0(r.budget)}</span></div>
    <div class="bar ${f > 1 ? 'bad' : f >= .85 ? 'warn' : ''}" style="margin-top:6px"><i style="width:${Math.min(100, f * 100)}%"></i></div>
    ${r.oneOff ? h`<div class="small muted" style="margin-top:4px">+ ${money0(r.oneOff)} one-off</div>` : ''}</div></li>`;
}
function yearGrid(y) {
  const months = MONTHS.map((_, i) => `${y}-${String(i + 1).padStart(2, '0')}`);
  const cats = S.all('categories').filter((c) => c.countsAsSpending !== false);
  const data = cats.map((c) => ({ c, by: months.map((m) => sum(S.all('txns').filter((t) => t.catId === c.id && C.isPersonal(t) && ym(t.date) === m), (t) => t.amount)), budget: C.budgetFor(c.id, months[0]) * 12 }))
    .filter((d) => d.budget || d.by.some(Boolean)).sort((a, b) => a.c.name.localeCompare(b.c.name));
  return h`<div class="card scroll-x"><table class="sticky-col"><thead><tr><th>Category ${y}</th><th>Budget / yr</th>${MONTHS.map((n) => h`<th>${n.slice(0, 3)}</th>`)}<th>Total</th></tr></thead>
    <tbody>${data.map((d) => h`<tr><td><a href="#txns/all/${d.c.id}">${d.c.name}</a></td><td class="num"><button class="link" data-editbudget="${d.c.id}" data-year="${C.budgetYear(months[0])}" aria-label="Change ${d.c.name} budget">${money0(d.budget)} ✎</button></td>
      ${d.by.map((v, i) => h`<td class="num">${v ? h`<a href="#txns/${months[i]}/${d.c.id}" style="color:inherit">${money0(v)}</a>` : ''}</td>`)}<td class="num ${sum(d.by) > d.budget && d.budget ? 'bad' : ''}">${money0(sum(d.by))}</td></tr>`)}
    <tr><td><b>Total</b></td><td class="num"><b>${money0(sum(data, (d) => d.budget))}</b></td>${months.map((_, i) => h`<td class="num"><b>${money0(sum(data, (d) => d.by[i]))}</b></td>`)}<td class="num"><b>${money0(sum(data, (d) => sum(d.by)))}</b></td></tr></tbody></table>
    <p class="small muted">Tap an amount to see its transactions, or the ✎ budget to change it. Shared and one-off spending are left out.</p></div>`;
}
function since(tm) {
  const cats = C.activeCats().filter((c) => c.countsAsSpending !== false);
  const m = addMonths(thisMonth(), 1 > 0 ? 0 : 0), y = C.budgetYear(thisMonth() < '2026-12' ? '2026-12' : thisMonth());
  const rows = cats.map((c) => ({ c, avg: tm.per[c.id] || 0, bud: C.budgetFor(c.id, thisMonth() < '2026-12' ? '2026-12' : thisMonth()) })).filter((r) => r.avg || r.bud);
  return h`<div class="card"><h2>Average month since July 2026</h2>
    <p class="small muted">${tm.months} full month${tm.months === 1 ? '' : 's'}, one-offs left out. The suggested budget is your average; categories you haven't used since July keep the ${y} figure.</p>
    <div class="scroll-x"><table><thead><tr><th>Category</th><th>Your average</th><th>Budget ${y}</th><th>Suggested</th></tr></thead><tbody>
    ${rows.map((r) => h`<tr><td>${r.c.name}</td><td class="num">${money(r.avg)}</td><td class="num">${money(r.bud)}</td><td class="num">${money(r.avg || r.bud)}</td></tr>`)}
    <tr><td><b>Total</b></td><td class="num"><b>${money(sum(rows, (r) => r.avg))}</b></td><td class="num"><b>${money(sum(rows, (r) => r.bud))}</b></td><td class="num"><b>${money(sum(rows, (r) => r.avg || r.bud))}</b></td></tr></tbody></table></div>
    <div class="row" style="margin-top:12px"><button class="primary" id="apply-suggest" data-year="${y}" data-cats="${rows.map((r) => r.c.id).join(',')}">Use suggested as the ${y} budget</button></div>
    <p class="small muted">You can still change any single category afterwards from the Year grid.</p></div>`;
}

function editBudget(catId, year) {
  const c = C.cat(catId), id = `${year}-${catId}-me`, b = S.get('budgets', id) || { id, year, catId, payer: 'me', annual: 0, monthly: null };
  openSheet(h`<div class="row between"><h2>${c.name} · ${year} budget</h2><button class="link" data-close>Close</button></div><form class="form" id="bf">
    <label>Monthly amount<input name="m" inputmode="decimal" required value="${((b.monthly ?? Math.round(b.annual / 12)) / 100).toFixed(2)}"></label>
    <p class="small muted" id="bf-help" style="margin:0"></p><p class="form-error" id="bf-err" role="alert"></p>
    <div class="row between"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div></form>`, (root) => {
    const inp = root.querySelector('[name=m]'), help = () => { const m = toCents(inp.value); root.querySelector('#bf-help').textContent = m != null ? `Applies to every month of ${year}: ${money(m)} a month, ${money(m * 12)} a year.` : ''; };
    inp.oninput = help; help();
    root.querySelector('#bf').onsubmit = async (e) => {
      e.preventDefault(); const m = toCents(inp.value);
      if (m == null || m < 0) { root.querySelector('#bf-err').textContent = 'Enter an amount like 150 or 150.00.'; return; }
      await S.put('budgets', { ...b, monthly: m, annual: m * 12 }); closeSheet(); toast(`${c.name}: ${money0(m)} a month`);
    };
  });
}

function mount(root, month = thisMonth()) {
  root.querySelector('#b-month')?.addEventListener('change', (e) => { location.hash = `#budget/${e.target.value}`; });
  root.querySelectorAll('li[data-cat]').forEach((el) => el.onclick = () => { location.hash = `#txns/${el.dataset.month}/${el.dataset.cat}`; });
  root.querySelectorAll('[data-editbudget]').forEach((el) => el.onclick = () => editBudget(el.dataset.editbudget, +el.dataset.year));
  root.querySelector('#apply-suggest')?.addEventListener('click', async (e) => {
    const y = +e.target.dataset.year, tm = C.typicalMonth(), ref = thisMonth() < '2026-12' ? '2026-12' : thisMonth(), ids = e.target.dataset.cats.split(',').filter(Boolean);
    const docs = ids.map((id) => { const m = tm.per[id] || C.budgetFor(id, ref); return { id: `${y}-${id}-me`, year: y, catId: id, payer: 'me', monthly: m, annual: m * 12 }; })
      .filter((d) => (S.get('budgets', d.id)?.monthly ?? null) !== d.monthly);
    if (!docs.length) return toast('Your budget already matches the suggestion');
    const before = sum(docs, (d) => C.budgetFor(d.catId, ref)), after = sum(docs, (d) => d.monthly);
    if (!confirm(`Change ${docs.length} categor${docs.length === 1 ? 'y' : 'ies'} in the ${y} budget? Those categories go from ${money0(before)} to ${money0(after)} a month.`)) return;
    const old = docs.map((d) => S.get('budgets', d.id)).filter(Boolean), added = docs.filter((d) => !S.get('budgets', d.id)).map((d) => d.id);
    await S.putMany('budgets', docs);
    toast(`${y} budget updated`, { action: 'Undo', onAction: async () => { if (old.length) await S.putMany('budgets', old); if (added.length) await S.removeMany('budgets', added); toast('Budget restored'); } });
  });
}

// ---- Shared (college-era "Not paid by me") ----
function shared() {
  const t = S.all('txns').filter((x) => x.payer === 'shared');
  const by = {}; for (const x of t) { const m = ym(x.date); (by[m] ||= {})[x.catId] = (by[m][x.catId] || 0) + x.amount; }
  const months = Object.keys(by).sort().reverse();
  return h`<h1>Shared costs</h1><p class="muted">Costs not paid by you, mostly the college apartment. Never counted in personal spending.</p>
    <div class="card">${months.length ? h`<ul class="list">${months.map((m) => h`<li><div class="grow"><b>${monthName(m)}</b><div class="small muted">${Object.entries(by[m]).map(([c, v]) => `${C.cat(c)?.name || '—'} ${money0(v)}`).join(' · ')}</div></div><div class="num">${money0(sum(Object.values(by[m])))}</div></li>`)}</ul>` : h`<p class="muted">No shared costs.</p>`}</div>`;
}

// ---- All transactions, optionally filtered by month and category, with search ----
const q = { text: '', min: '', max: '', acct: '' }; // kept while you move around the app
function filtered(month, catId) {
  let list = S.all('txns').filter((t) => t.status !== 'review');
  if (month) list = list.filter((t) => ym(t.date) === month);
  if (catId) list = list.filter((t) => t.catId === catId);
  const words = q.text.trim().toLowerCase().split(/\s+/).filter(Boolean), lo = toCents(q.min), hi = toCents(q.max);
  if (words.length) list = list.filter((t) => { const hay = `${t.merchant || ''} ${t.note || ''} ${C.cat(t.catId)?.name || ''} ${(t.amount / 100).toFixed(2)}`.toLowerCase(); return words.every((w) => hay.includes(w)); });
  if (lo != null) list = list.filter((t) => t.amount >= lo);
  if (hi != null) list = list.filter((t) => t.amount <= hi);
  if (q.acct) list = list.filter((t) => t.acctId === q.acct);
  return list.sort((a, b) => b.date.localeCompare(a.date));
}
function txnList(list, month, c) {
  const shown = list.slice(0, 300), counted = sum(list.filter(C.isPersonal), (t) => t.amount), other = sum(list, (t) => t.amount) - counted, catId = c?.id;
  return h`<p class="muted">${month ? monthName(month) : 'All months'} · ${list.length} transaction${list.length === 1 ? '' : 's'} · <b>${money(counted)}</b> counts toward the budget${other ? ` · ${money(other)} one-off, shared or reimbursed` : ''}${c && month ? raw(` · <a href="#txns/all/${catId}">All months for ${c.name.replace(/</g, '&lt;')}</a>`) : ''}</p>
    <div class="card"><ul class="list">${shown.length ? shown.map(txnRow) : h`<li class="muted">${q.text || q.min || q.max || q.acct ? 'Nothing matches the search.' : c ? `No ${c.name} spending ${month ? 'in ' + monthName(month) : 'yet'}.` : 'No transactions yet. Tap + to add one.'}</li>`}</ul>${list.length > 300 ? h`<p class="small muted">Showing the latest 300.</p>` : ''}</div>`;
}
function txns(month, catId) {
  if (month === 'all') month = null;
  const c = catId && C.cat(catId), yr = C.budgetYear(month || thisMonth());
  const accts = S.all('accounts').filter((a) => !a.isInvestment);
  return h`<div class="row between wrap"><h1>${c ? c.name : 'Transactions'}</h1>${c ? h`<button id="tx-budget" data-cat="${catId}" data-year="${yr}">Edit ${yr} budget</button>` : ''}</div>
    <div class="row wrap" style="gap:8px;margin-bottom:12px"><input id="tx-q" type="search" placeholder="Search merchant, note, category or amount" value="${q.text}" style="flex:1 1 220px" aria-label="Search transactions">
      <input id="tx-min" inputmode="decimal" placeholder="Min $" value="${q.min}" style="width:90px" aria-label="Minimum amount"><input id="tx-max" inputmode="decimal" placeholder="Max $" value="${q.max}" style="width:90px" aria-label="Maximum amount">
      <select id="tx-acct" style="width:auto" aria-label="Account">${options([['', 'All accounts'], ...accts.map((a) => [a.id, a.name])], q.acct)}</select>
      ${q.text || q.min || q.max || q.acct ? h`<button class="link" id="tx-clear">Clear</button>` : ''}</div>
    <div id="tx-results">${txnList(filtered(month, catId), month, c)}</div>`;
}
function mountTxns(root, month, catId) {
  if (month === 'all') month = null;
  bindTxnRows(root); root.querySelector('#tx-budget')?.addEventListener('click', (e) => editBudget(e.target.dataset.cat, +e.target.dataset.year));
  const box = root.querySelector('#tx-results'), c = catId && C.cat(catId);
  const update = () => { box.innerHTML = txnList(filtered(month, catId), month, c).__raw; bindTxnRows(box); };
  let t; const on = (id, key) => root.querySelector(id).addEventListener('input', (e) => { q[key] = e.target.value; clearTimeout(t); t = setTimeout(update, 120); });
  on('#tx-q', 'text'); on('#tx-min', 'min'); on('#tx-max', 'max');
  root.querySelector('#tx-acct').onchange = (e) => { q.acct = e.target.value; update(); };
  root.querySelector('#tx-clear')?.addEventListener('click', () => { Object.assign(q, { text: '', min: '', max: '', acct: '' }); window.dispatchEvent(new HashChangeEvent('hashchange')); });
}

export const views = {
  budget: { render, mount },
  shared: { render: shared },
  txns: { render: txns, mount: mountTxns },
};
