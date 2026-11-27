import * as S from '../store.js';
import { h, money, money0, signed, thisMonth, monthName, shortDate, pct } from '../util.js';
import * as C from '../calc.js';
import { line, ring } from '../charts.js';
import { openQuickAdd } from './quickadd.js';
import { budgetAlerts } from '../insights.js';
import { backupDue, saveBackup, snoozeBackup } from '../backup.js';

export function txnRow(t) {
  const c = C.cat(t.catId);
  return h`<li class="tap" data-txn="${t.id}"><div class="grow"><div class="ellipsis">${t.note || t.merchant || c?.name || 'Uncategorized'}</div>
    <div class="small muted">${shortDate(t.date)} · ${c?.name || '—'}${t.oneOff ? ' · one-off' : ''}${t.payer === 'shared' ? ' · shared' : ''}${t.origin === 'imported' ? ' · monthly total (imported)' : ''}</div></div>
    <div class="num">${money(t.amount)}</div></li>`;
}
export function bindTxnRows(root) { root.querySelectorAll('[data-txn]').forEach((el) => el.onclick = () => openQuickAdd(S.get('txns', el.dataset.txn))); }

function render() {
  const m = thisMonth(), sm = C.monthSummary(m), nw = C.netWorth(), totals = C.accountTotals();
  const port = Object.values(totals).reduce((a, x) => ({ value: a.value + x.value, day: a.day + x.day }), { value: 0, day: 0 });
  const hist = C.netWorthHistory(); const prev = hist.at(-2);
  const left = sm.budget - sm.spent, inbox = C.inboxCount();
  const recent = S.all('txns').filter((t) => t.status !== 'review').sort((a, b) => b.date.localeCompare(a.date) || (b.updatedAt - a.updatedAt)).slice(0, 5);
  const funds = S.all('funds'), alerts = budgetAlerts().slice(0, 3), due = backupDue();
  return h`<h1>Home</h1>
  ${alerts.length ? h`<div class="alert-list">${alerts.map((a) => h`<a class="notice ${a.level}" href="#txns/${m}/${a.catId}"><span class="grow">${a.text} <b class="num">${money0(a.amount)}</b>${a.level === 'warn' ? ' left' : ''}</span><span aria-hidden="true">›</span></a>`)}</div>` : ''}
  ${due ? h`<div class="notice row between wrap" style="margin-bottom:14px"><span>It's been over a week since your last backup.</span><span class="row"><button class="link" id="bk-later">Later</button><button class="primary" id="bk-now">Back up now</button></span></div>` : ''}
  ${inbox ? h`<a class="card tap row between" href="#inbox" style="text-decoration:none;color:inherit;margin-bottom:14px"><span><b>${inbox}</b> item${inbox === 1 ? '' : 's'} to review</span><span class="badge">${inbox}</span></a>` : ''}
  <div class="grid cols-2">
    <a class="card tap plain" href="#budget"><h3>Budget left · ${monthName(m)}</h3>
      <div class="big num ${left < 0 ? 'bad' : ''}">${money0(left)}</div>
      <div class="bar ${sm.spent > sm.budget ? 'bad' : sm.spent > sm.budget * .85 ? 'warn' : ''}" style="margin:8px 0"><i style="width:${Math.min(100, sm.budget ? sm.spent / sm.budget * 100 : 0)}%"></i></div>
      <div class="small muted">${money0(sm.spent)} spent of ${money0(sm.budget)}${sm.oneOff ? ` · ${money0(sm.oneOff)} one-off` : ''}</div></a>
    <a class="card tap plain" href="#networth"><h3>Net worth</h3><div class="big num">${money0(nw.total)}</div>
      <div class="small muted">${prev ? `${signed(nw.total - prev.total)} since ${shortDate(prev.date)} snapshot` : 'Tap to add your first balances'}${nw.gaps ? ` · ${money0(nw.gaps)} unexplained` : ''}</div></a>
    <a class="card tap plain" href="#invest"><h3>Portfolio</h3><div class="big num">${money0(port.value)}</div>
      ${port.value ? h`<div class="small ${port.day < 0 ? 'bad' : 'good'}">${signed(port.day)} today</div>` : h`<div class="small muted">Import a Vanguard file to see holdings</div>`}</a>
    <div class="card"><h3>Goals</h3>${funds.length ? h`<div class="row wrap" style="gap:14px">${funds.map((f) => { const st = C.fundStatus(f); return h`<a href="#goals" class="row" style="gap:6px;text-decoration:none;color:inherit">${ring(st.progress ?? 0)}<div class="small"><div>${f.name}</div><div class="muted num">${money0(st.bal)}${f.target ? ' / ' + money0(f.target) : ''}</div></div></a>`; })}</div>` : h`<p class="muted">No goals yet. <a href="#goals">Set one up</a></p>`}</div>
    <div class="card"><div class="row between"><h3>Recent</h3><a class="small" href="#txns">All</a></div>
      ${recent.length ? h`<ul class="list">${recent.map(txnRow)}</ul>` : h`<p class="muted">Tap + to add your first expense.</p>`}</div>
    <div class="card"><h3>Insights</h3><ul class="list">${[['review', 'Monthly review', 'How last month went'], ['plan', 'Plan', 'Savings rate, projections, Roth IRA, 401(k)'], ['cashflow', 'Cash flow', 'Paydays and bills coming up'], ['subscriptions', 'Subscriptions', 'Repeating charges and price increases'], ['trends', 'Spending trends', 'Category by month, year over year']].map(([k, t, d]) => h`<li class="menu-row"><a href="#${k}" style="text-decoration:none;color:inherit;display:flex;align-items:center;width:100%;min-height:40px"><span class="grow"><b>${t}</b><div class="small muted">${d}</div></span><span class="muted" aria-hidden="true">›</span></a></li>`)}</ul></div>
    <div class="card only-desk"><h3>Net worth history</h3>${line(hist.map((p) => ({ x: p.date, y: p.total })), { label: (p) => shortDate(p.x) })}</div>
  </div>`;
}
function mount(root) {
  bindTxnRows(root);
  root.querySelector('#bk-now')?.addEventListener('click', async () => { if (await saveBackup()) window.dispatchEvent(new HashChangeEvent('hashchange')); });
  root.querySelector('#bk-later')?.addEventListener('click', () => { snoozeBackup(); window.dispatchEvent(new HashChangeEvent('hashchange')); });
}

export const views = { home: { render, mount } };
