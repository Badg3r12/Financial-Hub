import * as S from '../store.js';
import { h, money, money0, signed, pct, today, shortDate, toCents } from '../util.js';
import * as C from '../calc.js';
import { donut } from '../charts.js';
import { openSheet, closeSheet, toast, options, formData } from '../ui.js';

let sortKey = 'value', sortDir = -1;
const invAccts = () => S.all('accounts').filter((a) => a.isInvestment);

function render(tab = 'holdings') {
  const hs = C.holdings(), totals = C.accountTotals(), alloc = C.allocation();
  const tot = Object.values(totals).reduce((a, x) => ({ cost: a.cost + x.cost, value: a.value + x.value, day: a.day + x.day }), { cost: 0, value: 0, day: 0 });
  const k = C.k401(); if (k.value != null) tot.value += k.value; // 401(k) valued from its quarterly statement
  return h`<div class="row between wrap"><h1>Invest</h1><div class="row"><button id="add-lot">Add buy</button><button id="prices">Update prices</button></div></div>
  <div class="tabs"><a href="#invest" class="${tab === 'holdings' ? 'on' : ''}">Holdings</a><a href="#networth">Net worth</a><a href="#paystubs">Paystubs &amp; 401k</a><a href="#import">Import Vanguard file</a></div>
  <div class="grid cols-3" style="margin-bottom:14px">
    <div class="card"><h3>Total</h3><div class="big num">${money0(tot.value)}</div><div class="small ${tot.day < 0 ? 'bad' : 'good'}">${signed(tot.day)} today</div></div>
    ${invAccts().map((a) => { const t = totals[a.id]; if (a.type === 'Roth 401k' && !t) return h`<a class="card" href="#paystubs" style="text-decoration:none;color:inherit"><h3>${a.name}</h3>${k.value != null ? h`<div class="big num">${money0(k.value)}</div>
      <div class="small"><span class="${k.gain < 0 ? 'bad' : 'good'}">${signed(k.gain)} gain</span> · <span class="muted">statement ${shortDate(k.asOf)}</span></div>` : h`<p class="muted small">Add a quarterly statement under Paystubs &amp; 401k.</p>`}</a>`;
      return h`<div class="card"><h3>${a.name}</h3>${t ? h`<div class="big num">${money0(t.value)}</div>
      <div class="small"><span class="${t.value - t.cost < 0 ? 'bad' : 'good'}">${signed(t.value - t.cost)} (${pct((t.value - t.cost) / (t.cost || 1))})</span> · <span class="muted">${signed(t.day)} today</span></div>`
      : h`<p class="muted small">No lots logged yet. Import the Vanguard file for this account or add a buy.</p>`}</div>`; })}
  </div>
  <div class="grid cols-2">
    <div class="card scroll-x" style="grid-column:1/-1"><table><thead><tr>
      ${[['ticker', 'Ticker'], ['acct', 'Account'], ['shares', 'Shares'], ['avg', 'Avg cost'], ['price', 'Price'], ['day', 'Day'], ['cost', 'Cost'], ['value', 'Value'], ['gain', 'Gain/loss'], ['gp', '%']].map(([k, l]) => h`<th data-sort="${k}">${l}${sortKey === k ? (sortDir < 0 ? ' ↓' : ' ↑') : ''}</th>`)}
    </tr></thead><tbody>${sorted(hs).map((x) => h`<tr class="tap" data-holding="${x.ticker}"><td><b>${x.ticker}</b></td><td>${C.acct(x.acctId)?.name || ''}</td><td class="num">${x.shares.toFixed(3)}</td>
      <td class="num">${money(Math.round(x.avg))}</td><td class="num">${x.sec.last != null ? money(Math.round(x.sec.last * 100)) : '—'}</td><td class="num ${x.day < 0 ? 'bad' : 'good'}">${x.day == null ? '—' : signed(x.day)}</td>
      <td class="num">${money(x.cost)}</td><td class="num">${money(x.value)}</td><td class="num ${x.gain < 0 ? 'bad' : 'good'}">${x.gain == null ? '—' : signed(x.gain)}</td><td class="num">${x.gain == null ? '—' : pct(x.gain / (x.cost || 1))}</td></tr>`)}
    </tbody></table>${hs.length ? '' : h`<p class="empty">No holdings yet. Import your history or a Vanguard file.</p>`}</div>
    <div class="card"><h3>Allocation</h3>${donut(Object.entries(alloc).map(([label, value]) => ({ label, value })))}</div>
    <div class="card"><h3>Prices</h3><p class="small muted">Prices as of ${[...new Set(S.all('securities').map((s) => s.priceDate).filter(Boolean))].sort().at(-1) || '—'}. Update them by hand or from a Vanguard file (its holdings section carries prices).</p></div>
  </div>`;
}
function sorted(hs) {
  const v = (x) => ({ ticker: x.ticker, acct: C.acct(x.acctId)?.name, shares: x.shares, avg: x.avg, price: x.sec.last, day: x.day, cost: x.cost, value: x.value, gain: x.gain, gp: x.gain / (x.cost || 1) }[sortKey]);
  return [...hs].sort((a, b) => { const A = v(a), B = v(b); return (typeof A === 'string' ? A.localeCompare(B) : (A ?? -1e15) - (B ?? -1e15)) * sortDir; });
}

function holdingDetail(ticker) {
  const lots = S.all('lots').filter((l) => l.ticker === ticker).sort((a, b) => a.date.localeCompare(b.date));
  const s = S.get('securities', ticker) || {};
  openSheet(h`<div class="row between"><h2>${ticker}</h2><button class="link" data-close>Close</button></div><p class="muted small">${s.name || ''} · ${s.type || ''}</p>
    <ul class="list">${lots.map((l) => h`<li><div class="grow"><div>${l.kind === 'reinvest' ? 'Dividend reinvest' : l.kind === 'sell' ? 'Sell' : 'Buy'} · ${C.acct(l.acctId)?.name || ''}</div><div class="small muted">${shortDate(l.date)}</div></div>
      <div class="num small" style="text-align:right">${l.shares.toFixed(4)} @ ${money(Math.round(l.price * 100))}<div class="muted">${money(Math.round(l.shares * l.price * 100))}</div></div><button class="link" data-dellot="${l.id}" aria-label="Delete lot">✕</button></li>`)}</ul>`, (root) => {
    root.querySelector('[data-close]').onclick = closeSheet;
    root.querySelectorAll('[data-dellot]').forEach((b) => b.onclick = async () => { if (confirm('Delete this lot?')) { await S.remove('lots', b.dataset.dellot); holdingDetail(ticker); } });
  });
}

export function addLot() {
  openSheet(h`<h2>Add a buy, sell or reinvestment</h2><form class="form" id="lf">
    <div class="two"><label>Account<select name="acctId">${options(invAccts().map((a) => [a.id, a.name]))}</select></label><label>Date<input type="date" name="date" value="${today()}"></label></div>
    <div class="two"><label>Ticker<input name="ticker" required autocapitalize="characters"></label><label>Kind<select name="kind">${options([['buy', 'Buy'], ['sell', 'Sell'], ['reinvest', 'Dividend reinvest']])}</select></label></div>
    <div class="two"><label>Shares<input name="shares" inputmode="decimal" required></label><label>Price per share<input name="price" inputmode="decimal" required></label></div>
    <label>Fund name (new tickers only)<input name="name"></label>
    <div class="row between"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div></form>`, (root) => {
    root.querySelector('[data-close]').onclick = closeSheet;
    root.querySelector('#lf').onsubmit = async (e) => {
      e.preventDefault(); const f = formData(e.target), t = f.ticker.trim().toUpperCase(), sh = Math.abs(parseFloat(f.shares)), pr = parseFloat(String(f.price).replace(/[$,]/g, ''));
      if (!sh || !pr) return toast('Enter shares and price');
      await S.put('lots', { acctId: f.acctId, date: f.date, ticker: t, shares: f.kind === 'sell' ? -sh : sh, price: pr, kind: f.kind, origin: 'manual' });
      if (!S.get('securities', t)) await S.put('securities', { id: t, name: f.name || t, type: 'Stock', last: pr, prior: pr, priceDate: f.date });
      closeSheet(); toast('Saved');
    };
  });
}

function updatePrices() {
  const secs = S.all('securities').filter((s) => C.holdings().some((x) => x.ticker === s.id)).sort((a, b) => a.id.localeCompare(b.id));
  openSheet(h`<h2>Update prices</h2><form id="pf"><table><thead><tr><th>Ticker</th><th>Price</th><th>Prior close</th></tr></thead><tbody>
    ${secs.map((s) => h`<tr><td>${s.id}</td><td><input name="l-${s.id}" inputmode="decimal" value="${s.last ?? ''}"></td><td><input name="p-${s.id}" inputmode="decimal" value="${s.prior ?? ''}"></td></tr>`)}</tbody></table>
    <div class="row between" style="margin-top:12px"><button type="button" data-close>Cancel</button><button class="primary">Save prices</button></div></form>`, (root) => {
    root.querySelector('[data-close]').onclick = closeSheet;
    root.querySelector('#pf').onsubmit = async (e) => {
      e.preventDefault(); const f = formData(e.target);
      await S.putMany('securities', secs.map((s) => ({ ...s, last: parseFloat(f['l-' + s.id]) || s.last, prior: parseFloat(f['p-' + s.id]) || s.prior, priceDate: today() })));
      closeSheet(); toast('Prices updated');
    };
  });
}

function mount(root) {
  root.querySelector('#add-lot').onclick = addLot;
  root.querySelector('#prices').onclick = updatePrices;
  root.querySelectorAll('[data-sort]').forEach((th) => th.onclick = () => { const k = th.dataset.sort; sortDir = sortKey === k ? -sortDir : -1; sortKey = k; window.dispatchEvent(new HashChangeEvent('hashchange')); });
  root.querySelectorAll('[data-holding]').forEach((tr) => tr.onclick = () => holdingDetail(tr.dataset.holding));
}
export const views = { invest: { render, mount } };
