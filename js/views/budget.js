import * as S from '../store.js';
import { h, raw, money, money0, thisMonth, monthName, addMonths, MONTHS, ym, sum, toCents } from '../util.js';
import * as C from '../calc.js';
import { openSheet, closeSheet, toast, options } from '../ui.js';
import { txnRow, bindTxnRows } from './home.js';

const isCollege = (m) => m < C.BASELINE_START;

function render(month = thisMonth(), mode = 'month') {
  const sm = C.monthSummary(month), tm = C.typicalMonth();
  const rows = sm.rows.filter((r) => r.budget || r.spent || r.oneOff).sort((a, b) => (C.cat(a.catId)?.name || '').localeCompare(C.cat(b.catId)?.name || ''));
  const y = +month.slice(0, 4);
  return h`<div class="row between wrap"><h1>Budget</h1>
    <div class="row"><a class="btn" href="#budget/${addMonths(month, -1)}" aria-label="Previous month">‹</a>
      <select id="b-month" style="width:auto">${options(monthList().map((m) => [m, monthName(m) + (isCollege(m) ? ' (college)' : '')]), month)}</select>
      <a class="btn" href="#budget/${addMonths(month, 1)}" aria-label="Next month">›</a></div></div>
  <div class="tabs"><a href="#budget/${month}" class="${mode === 'month' ? 'on' : ''}">Month</a><a href="#budget/${month}/year" class="${mode === 'year' ? 'on' : ''}">Year grid</a>
    <a href="#budget/${month}/since" class="${mode === 'since' ? 'on' : ''}">Since July</a><a href="#shared">Shared</a><a href="#txns">All transactions</a></div>
  ${isCollege(month) ? h`<p class="notice">College-era month: shown as history only. Budgets and averages use July 2026 onward.</p>` : ''}
  ${mode === 'year' ? yearGrid(y) : mode === 'since' ? since(tm) : h`
  <div class="grid cols-3" style="margin-bottom:14px">
    <div class="card"><h3>Spent</h3><div class="big num">${money0(sm.spent)}</div><div class="small muted">of ${money0(sm.budget)} budgeted</div></div>
    <div class="card"><h3>Left</h3><div class="big num ${sm.budget - sm.spent < 0 ? 'bad' : ''}">${money0(sm.budget - sm.spent)}</div><div class="small muted">Income this month ${money0(sm.income)}</div></div>
    <div class="card"><h3>Outside the budget</h3><div class="big num">${money0(sm.oneOff)}</div><div class="small muted">one-off${sm.shared ? ` · ${money0(sm.shared)} shared` : ''}${sm.reimb ? ` · ${money0(sm.reimb)} work (reimbursed)` : ''}</div></div>
  </div>
  <div class="card"><ul class="list">${rows.length ? rows.map((r) => catRow(r, month)) : h`<li class="muted">Nothing this month yet.</li>`}</ul></div>`}`;
}
function monthList() { const out = []; for (let m = '2023-01'; m <= '2027-12'; m = addMonths(m, 1)) out.push(m); return out; }
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
  return h`<div class="card scroll-x"><table><thead><tr><th>Category ${y}</th><th>Budget</th>${MONTHS.map((n) => h`<th>${n.slice(0, 3)}</th>`)}<th>Total</th></tr></thead>
    <tbody>${data.map((d) => h`<tr><td><button class="link" data-editbudget="${d.c.id}" data-year="${C.budgetYear(months[0])}">${d.c.name}</button></td><td class="num">${money0(d.budget)}</td>
      ${d.by.map((v) => h`<td class="num">${v ? money0(v) : ''}</td>`)}<td class="num ${sum(d.by) > d.budget && d.budget ? 'bad' : ''}">${money0(sum(d.by))}</td></tr>`)}
    <tr><td><b>Total</b></td><td class="num"><b>${money0(sum(data, (d) => d.budget))}</b></td>${months.map((_, i) => h`<td class="num"><b>${money0(sum(data, (d) => d.by[i]))}</b></td>`)}<td class="num"><b>${money0(sum(data, (d) => sum(d.by)))}</b></td></tr></tbody></table>
    <p class="small muted">Tap a category to change its budget. Shared and one-off spending are left out.</p></div>`;
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
    <div class="row" style="margin-top:12px"><button class="primary" id="apply-suggest" data-year="${y}">Use suggested as the ${y} budget</button></div>
    <p class="small muted">You can still change any single category afterwards from the Year grid.</p></div>`;
}

function editBudget(catId, year) {
  const c = C.cat(catId), id = `${year}-${catId}-me`, b = S.get('budgets', id) || { id, year, catId, payer: 'me', annual: 0, monthly: null };
  openSheet(h`<h2>${c.name} · ${year} budget</h2><form class="form" id="bf">
    <label>Monthly amount<input name="m" inputmode="decimal" value="${((b.monthly ?? Math.round(b.annual / 12)) / 100).toFixed(2)}"></label>
    <div class="row between"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div></form>`, (root) => {
    root.querySelector('[data-close]').onclick = closeSheet;
    root.querySelector('#bf').onsubmit = async (e) => { e.preventDefault(); const m = toCents(e.target.m.value) || 0; await S.put('budgets', { ...b, monthly: m, annual: m * 12 }); closeSheet(); toast('Budget saved'); };
  });
}

function mount(root, month = thisMonth()) {
  root.querySelector('#b-month')?.addEventListener('change', (e) => { location.hash = `#budget/${e.target.value}`; });
  root.querySelectorAll('[data-cat]').forEach((el) => el.onclick = () => { location.hash = `#txns/${el.dataset.month}/${el.dataset.cat}`; });
  root.querySelectorAll('[data-editbudget]').forEach((el) => el.onclick = () => editBudget(el.dataset.editbudget, +el.dataset.year));
  root.querySelector('#apply-suggest')?.addEventListener('click', async (e) => {
    const y = +e.target.dataset.year, tm = C.typicalMonth(), ref = thisMonth() < '2026-12' ? '2026-12' : thisMonth();
    const docs = C.activeCats().filter((c) => c.countsAsSpending !== false).map((c) => { const m = tm.per[c.id] || C.budgetFor(c.id, ref); return { id: `${y}-${c.id}-me`, year: y, catId: c.id, payer: 'me', monthly: m, annual: m * 12 }; });
    await S.putMany('budgets', docs); toast(`${y} budget updated`);
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

// ---- All transactions, optionally filtered by month and category ----
function txns(month, catId) {
  let list = S.all('txns').filter((t) => t.status !== 'review');
  if (month) list = list.filter((t) => ym(t.date) === month);
  if (catId) list = list.filter((t) => t.catId === catId);
  list.sort((a, b) => b.date.localeCompare(a.date));
  const shown = list.slice(0, 300);
  return h`<h1>${catId ? C.cat(catId)?.name : 'Transactions'}</h1>
    <p class="muted">${month ? monthName(month) : 'All months'} · ${list.length} transaction${list.length === 1 ? '' : 's'} · ${money(sum(list, (t) => t.amount))}${month ? raw(` · <a href="#txns">show all</a>`) : ''}</p>
    <div class="card"><ul class="list">${shown.length ? shown.map(txnRow) : h`<li class="muted">None.</li>`}</ul>${list.length > 300 ? h`<p class="small muted">Showing the latest 300.</p>` : ''}</div>`;
}

export const views = {
  budget: { render, mount },
  shared: { render: shared },
  txns: { render: txns, mount: (root) => bindTxnRows(root) },
};
