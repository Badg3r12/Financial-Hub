import * as S from '../store.js';
import { h, money, money0, signed, pct, today, shortDate, groupBy, sum } from '../util.js';
import * as C from '../calc.js';
import { donut, line } from '../charts.js';
import * as M from '../market.js';
import { openSheet, closeSheet, toast, options, formData } from '../ui.js';

let sortKey = 'value', sortDir = -1;
const invAccts = () => S.all('accounts').filter((a) => a.isInvestment);
const cls = (v) => (v == null ? '' : v < 0 ? 'bad' : 'good');
M.load(); // free daily prices + fund holdings published with the app (see tools/market_data.py)

// One row per ticker (all accounts combined); accounts listed underneath.
function combined() {
  const by = groupBy(C.holdings(), (x) => x.ticker);
  return Object.entries(by).map(([t, hs]) => {
    const value = sum(hs, (x) => x.value || 0), cost = sum(hs, (x) => x.cost), sec = hs[0].sec;
    return { ticker: t, sec, hs, accts: hs.map((x) => C.acct(x.acctId)?.name).join(', '), shares: sum(hs, (x) => x.shares), value, cost,
      gain: value - cost, gp: cost ? (value - cost) / cost : 0, day: sum(hs, (x) => x.day || 0), price: sec.last };
  });
}
function sorted(rows) {
  return [...rows].sort((a, b) => { const A = a[sortKey], B = b[sortKey]; return (typeof A === 'string' ? A.localeCompare(B) : (A ?? -1e15) - (B ?? -1e15)) * sortDir; });
}

function render(sub) {
  if (sub === 'exposure') return exposure();
  const totals = C.accountTotals(), alloc = C.allocation(), k = C.k401(), ps = C.portfolioStats(), rows = combined();
  const tot = Object.values(totals).reduce((a, x) => ({ cost: a.cost + x.cost, value: a.value + x.value, day: a.day + x.day }), { cost: 0, value: 0, day: 0 });
  const all = tot.value + (k.value || 0);
  return h`<div class="row between wrap"><h1>Invest</h1><div class="row wrap"><button id="add-lot">Add trade</button><button id="prices">Update prices</button></div></div>
  <div class="tabs"><a href="#invest" class="on">Holdings</a><a href="#trades">All buys &amp; sells</a><a href="#invest/exposure">Overlap &amp; exposure</a><a href="#networth">Net worth</a><a href="#paystubs">401(k) &amp; paystubs</a><a href="#import">Import</a></div>
  <div class="grid cols-3" style="margin-bottom:14px">
    <div class="card"><h3>All investments</h3><div class="big num">${money0(all)}</div><div class="small ${cls(tot.day)}">${signed(tot.day)} today</div></div>
    <div class="card"><h3>Gain on brokerage + IRA</h3><div class="big num ${cls(tot.value - tot.cost)}">${signed(tot.value - tot.cost)}</div>
      <div class="small muted">${pct((tot.value - tot.cost) / (tot.cost || 1))} on ${money0(tot.cost)} cost${ps.xirr != null ? ` · ${pct(ps.xirr)} a year (money-weighted)` : ''}</div></div>
    <div class="card"><h3>This year</h3><div class="big num">${money0(ps.investedYTD)}</div><div class="small muted">invested · ${money(ps.reinvestedYTD)} dividends reinvested</div></div>
  </div>
  <div class="grid cols-3" style="margin-bottom:14px">${invAccts().map((a) => {
    const t = totals[a.id];
    if (a.type === 'Roth 401k' && !t) return h`<a class="card" href="#paystubs" style="text-decoration:none;color:inherit"><h3>${a.name}</h3>${k.value != null ? h`<div class="big num">${money0(k.value)}</div><div class="small"><span class="${cls(k.gain)}">${signed(k.gain)} gain</span> · <span class="muted">statement ${shortDate(k.asOf)}</span></div>` : h`<p class="muted small">Add a quarterly statement.</p>`}</a>`;
    return h`<div class="card"><h3>${a.name}</h3>${t ? h`<div class="big num">${money0(t.value)}</div><div class="small"><span class="${cls(t.value - t.cost)}">${signed(t.value - t.cost)} (${pct((t.value - t.cost) / (t.cost || 1))})</span> · <span class="muted">${signed(t.day)} today</span></div>` : h`<p class="muted small">No holdings yet.</p>`}</div>`; })}</div>
  <div class="card only-desk scroll-x" style="margin-bottom:14px"><table><thead><tr>
    ${[['ticker', 'Holding'], ['accts', 'Accounts'], ['shares', 'Shares'], ['price', 'Price'], ['day', 'Today'], ['cost', 'Cost'], ['value', 'Value'], ['gain', 'Gain'], ['gp', '%']].map(([key, l]) => h`<th data-sort="${key}">${l}${sortKey === key ? (sortDir < 0 ? ' ↓' : ' ↑') : ''}</th>`)}
  </tr></thead><tbody>${sorted(rows).map((x) => h`<tr class="tap" data-holding="${x.ticker}"><td><b>${x.ticker}</b><div class="small muted ellipsis" style="max-width:220px">${x.sec.name || ''}</div></td><td class="small">${x.accts}</td><td class="num">${x.shares.toFixed(3)}</td>
    <td class="num">${x.price != null ? money(Math.round(x.price * 100)) : '—'}</td><td class="num ${cls(x.day)}">${signed(x.day)}</td><td class="num">${money(x.cost)}</td><td class="num">${money(x.value)}</td>
    <td class="num ${cls(x.gain)}">${signed(x.gain)}</td><td class="num ${cls(x.gain)}">${pct(x.gp)}</td></tr>`)}</tbody></table>
    ${rows.length ? '' : h`<p class="empty">No holdings yet. Import your history or a Vanguard file.</p>`}</div>
  <div class="only-phone" style="margin-bottom:14px">
    <div class="row between" style="margin-bottom:8px"><h3 style="margin:0">Holdings</h3><select id="m-sort" style="width:auto;padding:4px 8px;font-size:14px">${options([['value', 'By value'], ['gp', 'By % gain'], ['day', 'By today'], ['ticker', 'A–Z']], sortKey)}</select></div>
    <div class="card" style="padding:4px 14px"><ul class="list">${sorted(rows).map((x) => h`<li class="tap" data-holding="${x.ticker}"><div class="grow"><b>${x.ticker}</b> <span class="small muted">${x.shares.toFixed(3)} sh</span>
      <div class="small muted ellipsis">${x.sec.name || ''}</div></div><div style="text-align:right"><div class="num">${money(x.value)}</div>
      <div class="small num ${cls(x.gain)}">${signed(x.gain)} · ${pct(x.gp)}</div><div class="small num ${cls(x.day)}">${signed(x.day)} today</div></div></li>`)}</ul>
    ${rows.length ? '' : h`<p class="empty">No holdings yet.</p>`}</div></div>
  <div class="grid cols-2">
    <div class="card"><h3>Allocation by type</h3>${donut(Object.entries(alloc).map(([label, value]) => ({ label, value })))}</div>
    <div class="card"><h3>Prices</h3><p class="small muted">As of ${[...new Set(S.all('securities').map((s) => s.priceDate).filter(Boolean))].sort().at(-1) || '—'}. ${M.pricesData() ? `Closing prices update automatically each weekday evening (market data from ${shortDate(M.pricesData().asOf)}).` : 'Update them by hand or from a Vanguard file (its holdings section carries prices).'}</p></div>
  </div>`;
}

// Price chart and returns from the published daily closes (hidden when the ticker isn't in the data).
function priceBlock(ticker) {
  const st = C.priceStats(ticker); if (!st) return '';
  const hs = st.history.filter((x, i, a) => i === a.length - 1 || i % 5 === 0 || (a.length - i <= 260 && (x.close === st.high || x.close === st.low))); // weekly points (plus the 52-week high/low) keep the chart light
  const pos = st.high > st.low ? (st.last.close - st.low) / (st.high - st.low) : 0.5;
  return h`<div style="margin-bottom:14px">${line(hs.map((x) => ({ x: x.date, y: Math.round(x.close * 100) })), { height: 150, label: (q) => shortDate(q.x) })}
    <div class="grid" style="grid-template-columns:repeat(4,1fr);gap:8px;margin-top:8px">${stat('1 month', pct(st.r1m), cls(st.r1m))}${stat('3 months', pct(st.r3m), cls(st.r3m))}${stat('This year', pct(st.ytd), cls(st.ytd))}${stat('1 year', pct(st.r1y), cls(st.r1y))}</div>
    <div class="small muted" style="margin-top:10px">52-week range</div>
    <div class="row small num" style="gap:8px"><span>${money(Math.round(st.low * 100))}</span><span class="grow" style="position:relative;height:6px;border-radius:3px;background:var(--surface-2)"><span style="position:absolute;top:-3px;left:calc(${(pos * 100).toFixed(1)}% - 6px);width:12px;height:12px;border-radius:6px;background:var(--accent)"></span></span><span>${money(Math.round(st.high * 100))}</span></div>
    <p class="small muted" style="margin:6px 0 0">Price returns from daily closes through ${shortDate(st.last.date)}; dividends not included.</p></div>`;
}

function stat(label, value, cl = '') { return h`<div><div class="small muted">${label}</div><div class="num ${cl}" style="font-weight:600">${value}</div></div>`; }

export function holdingDetail(ticker) {
  const p = C.positionStats(ticker);
  openSheet(h`<div class="row between"><div><h2 style="margin:0">${ticker}</h2><div class="small muted">${p.sec.name || ''} · ${p.sec.type || ''}</div></div><button class="link" data-close>Close</button></div>
    <div class="row between" style="margin:14px 0"><div><div class="big num">${money(p.value)}</div><div class="small ${cls(p.day)}">${signed(p.day)} today${p.dayPct != null ? ` (${pct(p.dayPct, 2)})` : ''}</div></div>
      <div style="text-align:right"><div class="num">${p.sec.last != null ? money(Math.round(p.sec.last * 100)) : '—'}</div><div class="small muted">price ${p.sec.priceDate ? shortDate(p.sec.priceDate) : ''}</div></div></div>
    ${priceBlock(ticker)}
    <div class="grid" style="grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:14px">
      ${stat('Total gain', signed(p.gain), cls(p.gain))}${stat('Return', pct(p.gainPct), cls(p.gain))}${stat('Per year', p.xirr == null ? '—' : pct(p.xirr), cls(p.xirr))}
      ${stat('Shares', p.shares.toFixed(4))}${stat('Avg cost', money(Math.round(p.avg)))}${stat('Cost basis', money(p.cost))}
      ${stat('Share of portfolio', pct(p.weight))}${stat('Held since', p.firstBuy ? shortDate(p.firstBuy) : '—')}${stat('Price vs avg cost', p.avg && p.sec.last ? pct(p.sec.last * 100 / p.avg - 1) : '—')}
      ${stat('Buys / sells', `${p.buys} / ${p.sells}`)}${stat('Dividends reinvested', money(p.reinvested))}${stat('Shares from dividends', p.reinvShares.toFixed(4))}
    </div>
    ${p.best && p.lots.length > 1 ? h`<p class="small muted">Best buy: ${shortDate(p.best.l.date)} at ${money(Math.round(p.best.l.price * 100))} (${pct(p.best.ret)}). Worst: ${shortDate(p.worst.l.date)} at ${money(Math.round(p.worst.l.price * 100))} (${pct(p.worst.ret)}).</p>` : ''}
    ${p.hs.length > 1 ? h`<h3>By account</h3><ul class="list">${p.hs.map((x) => h`<li><span class="grow">${C.acct(x.acctId)?.name}</span><span class="small muted num">${x.shares.toFixed(3)} sh</span><span class="num">${money(x.value)}</span><span class="num small ${cls(x.gain)}" style="width:80px;text-align:right">${signed(x.gain)}</span></li>`)}</ul>` : ''}
    <div class="row between" style="margin-top:12px"><h3 style="margin:0">Trades</h3><a class="small" href="#trades/${ticker}">Open full list</a></div>
    <ul class="list">${[...p.lots].reverse().map((l) => tradeRow(l))}</ul>
    <p class="small muted">"Per year" is your money-weighted return: it accounts for when each dollar went in. Dividend reinvestments count as return, not new money.</p>`, (root) => {
    root.querySelector('[data-close]').onclick = closeSheet;
    root.querySelectorAll('[data-dellot]').forEach((b) => b.onclick = async () => { if (confirm('Delete this trade?')) { await S.remove('lots', b.dataset.dellot); holdingDetail(ticker); } });
    root.querySelector('a[href^="#trades"]').onclick = closeSheet;
  });
}

function tradeRow(l, withTicker) {
  const amt = Math.round(Math.abs(l.shares) * l.price * 100), kind = l.kind === 'reinvest' ? 'Dividend reinvest' : l.kind === 'sell' ? 'Sell' : 'Buy';
  return h`<li><div class="grow">${withTicker ? h`<b>${l.ticker}</b> · ` : ''}${kind}<div class="small muted">${shortDate(l.date)} · ${C.acct(l.acctId)?.name || ''}</div></div>
    <div class="num small" style="text-align:right">${Math.abs(l.shares).toFixed(4)} @ ${money(Math.round(l.price * 100))}<div class="${l.kind === 'sell' ? 'good' : 'muted'}">${l.kind === 'sell' ? '+' : ''}${money(amt)}</div></div>
    <button class="link" data-dellot="${l.id}" aria-label="Delete trade">✕</button></li>`;
}

// ---- All buys & sells ----
let tradeFilter = { acct: '', kind: '' };
function trades(ticker = '') {
  let lots = S.all('lots').filter((l) => (!ticker || l.ticker === ticker) && (!tradeFilter.acct || l.acctId === tradeFilter.acct) && (!tradeFilter.kind || l.kind === tradeFilter.kind));
  lots.sort((a, b) => b.date.localeCompare(a.date));
  const amt = (l) => Math.round(Math.abs(l.shares) * l.price * 100);
  const byMonth = groupBy(lots, (l) => l.date.slice(0, 7));
  return h`<div class="row between wrap"><h1>${ticker ? ticker + ' trades' : 'All buys & sells'}</h1><button id="add-lot">Add trade</button></div>
  <div class="tabs"><a href="#invest">Holdings</a><a href="#trades" class="on">All buys &amp; sells</a><a href="#invest/exposure">Overlap &amp; exposure</a></div>
  <div class="row wrap" style="margin-bottom:12px">
    <select id="tf-acct" style="width:auto">${options([['', 'All accounts'], ...invAccts().map((a) => [a.id, a.name])], tradeFilter.acct)}</select>
    <select id="tf-kind" style="width:auto">${options([['', 'Buys, sells & reinvestments'], ['buy', 'Buys'], ['sell', 'Sells'], ['reinvest', 'Dividend reinvestments']], tradeFilter.kind)}</select>
    ${ticker ? h`<a class="btn" href="#trades">All tickers</a>` : ''}</div>
  <div class="grid cols-3" style="margin-bottom:14px">
    <div class="card"><h3>Bought</h3><div class="big num">${money0(sum(lots.filter((l) => l.kind === 'buy'), amt))}</div><div class="small muted">${lots.filter((l) => l.kind === 'buy').length} buys</div></div>
    <div class="card"><h3>Sold</h3><div class="big num">${money0(sum(lots.filter((l) => l.kind === 'sell'), amt))}</div><div class="small muted">${lots.filter((l) => l.kind === 'sell').length} sells</div></div>
    <div class="card"><h3>Reinvested</h3><div class="big num">${money(sum(lots.filter((l) => l.kind === 'reinvest'), amt))}</div><div class="small muted">${lots.filter((l) => l.kind === 'reinvest').length} dividends</div></div></div>
  ${Object.entries(byMonth).map(([m, ls]) => h`<h3 style="margin-top:14px">${new Date(m + '-15T12:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h3><div class="card" style="padding:4px 14px"><ul class="list">${ls.map((l) => tradeRow(l, true))}</ul></div>`)}
  ${lots.length ? '' : h`<p class="empty">No trades match.</p>`}`;
}
function mountTrades(root, ticker) {
  root.querySelector('#add-lot').onclick = addLot;
  root.querySelector('#tf-acct').onchange = (e) => { tradeFilter.acct = e.target.value; rerender(); };
  root.querySelector('#tf-kind').onchange = (e) => { tradeFilter.kind = e.target.value; rerender(); };
  root.querySelectorAll('[data-dellot]').forEach((b) => b.onclick = async () => { if (confirm('Delete this trade?')) await S.remove('lots', b.dataset.dellot); });
}
const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

export function addLot() {
  openSheet(h`<h2>Add a trade</h2><form class="form" id="lf">
    <div class="two"><label>Account<select name="acctId">${options(invAccts().map((a) => [a.id, a.name]))}</select></label><label>Date<input type="date" name="date" value="${today()}"></label></div>
    <div class="two"><label>Ticker<input name="ticker" required autocapitalize="characters"></label><label>Kind<select name="kind">${options([['buy', 'Buy'], ['sell', 'Sell'], ['reinvest', 'Dividend reinvest']])}</select></label></div>
    <div class="two"><label>Shares<input name="shares" inputmode="decimal" required></label><label>Price per share<input name="price" inputmode="decimal" required></label></div>
    <label>Name (new tickers only)<input name="name"></label>
    <div class="row between"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div></form>`, (root) => {
    root.querySelector('[data-close]').onclick = closeSheet;
    root.querySelector('#lf').onsubmit = async (e) => {
      e.preventDefault(); const f = formData(e.target), t = f.ticker.trim().toUpperCase(), sh = Math.abs(parseFloat(f.shares)), pr = parseFloat(String(f.price).replace(/[$,]/g, ''));
      if (!sh || !pr) return toast('Enter shares and price');
      if (f.kind === 'sell') { const held = sum(S.all('lots').filter((l) => l.ticker === t && l.acctId === f.acctId), (l) => l.shares); if (sh > held + 1e-6) return toast(`You only hold ${held.toFixed(4)} ${t} in that account`); }
      await S.put('lots', { acctId: f.acctId, date: f.date, ticker: t, shares: f.kind === 'sell' ? -sh : sh, price: pr, kind: f.kind, origin: 'manual' });
      if (!S.get('securities', t)) await S.put('securities', { id: t, name: f.name || t, type: 'Stock', last: pr, prior: pr, priceDate: f.date });
      closeSheet(); toast('Trade saved');
    };
  });
}

function updatePrices() {
  const held = new Set(C.holdings().map((x) => x.ticker));
  const secs = S.all('securities').filter((s) => held.has(s.id)).sort((a, b) => a.id.localeCompare(b.id));
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

function mount(root, sub) {
  if (sub === 'exposure') return mountExposure(root);
  root.querySelector('#add-lot').onclick = addLot;
  root.querySelector('#prices').onclick = updatePrices;
  root.querySelectorAll('[data-sort]').forEach((th) => th.onclick = () => { const key = th.dataset.sort; sortDir = sortKey === key ? -sortDir : (key === 'ticker' || key === 'accts' ? 1 : -1); sortKey = key; rerender(); });
  root.querySelector('#m-sort').onchange = (e) => { sortKey = e.target.value; sortDir = sortKey === 'ticker' ? 1 : -1; rerender(); };
  root.querySelectorAll('[data-holding]').forEach((el) => el.onclick = () => holdingDetail(el.dataset.holding));
}
// ---- Overlap & exposure ----
let expAll = false;
function exposure() {
  const lt = C.lookThrough(), ov = C.fundOverlap(), fs = ov.funds, total = lt.total;
  const missing = lt.positions.filter((p) => p.kind === 'none');
  const pairs = [];
  fs.forEach((a, i) => fs.forEach((b, j) => { if (j > i) pairs.push({ a, b, v: ov.matrix[i][j] }); }));
  pairs.sort((x, y) => y.v - x.v);
  const rows = expAll ? lt.rows : lt.rows.slice(0, 25);
  const tone = (v) => `background:color-mix(in srgb, var(--accent) ${Math.round(v * 70)}%, transparent)`;
  const asOf = [...new Set(fs.map((f) => f.fund.asOf))].sort();
  const nm = (f) => f.k401 ? `401(k) ≈${f.ticker}` : f.label;
  return h`<div class="row between wrap"><h1>Overlap &amp; exposure</h1></div>
  <div class="tabs"><a href="#invest">Holdings</a><a href="#trades">All buys &amp; sells</a><a href="#invest/exposure" class="on">Overlap &amp; exposure</a></div>
  ${!M.loaded() ? h`<div class="card"><p class="muted">Market data hasn't loaded yet. It comes from <code>data/holdings.json</code>, which the repo's "Market data" action publishes. Check the setup steps in README.md.</p></div>` : h`
  <div class="grid cols-3" style="margin-bottom:14px">
    <div class="card"><h3>Looked through</h3><div class="big num">${money0(total - lt.unmapped)}</div><div class="small muted">of ${money0(total)} across ${lt.positions.length} holdings</div></div>
    <div class="card"><h3>Biggest company</h3>${lt.rows[0] ? h`<div class="big num">${lt.rows[0].ticker || lt.rows[0].name}</div><div class="small muted">${money0(lt.rows[0].total)} · ${pct(lt.rows[0].share)} of portfolio</div>` : h`<p class="muted small">—</p>`}</div>
    <div class="card"><h3>Top 10 companies</h3><div class="big num">${pct(total ? sum(lt.rows.slice(0, 10), (r) => r.total) / total : null)}</div><div class="small muted">of everything you have invested</div></div>
  </div>
  <div class="card" style="margin-bottom:14px"><h3>How much your funds overlap</h3>
    ${fs.length < 2 ? h`<p class="muted small">Overlap needs at least two funds with holdings data.</p>` : h`
    <div class="only-desk scroll-x"><table><thead><tr><th></th>${fs.map((f) => h`<th class="num">${nm(f)}</th>`)}</tr></thead><tbody>
      ${fs.map((a, i) => h`<tr><td><b>${nm(a)}</b>${a.k401 ? h`<div class="small muted">${a.label}</div>` : ''}</td>${fs.map((b, j) => h`<td class="num" style="${i === j ? '' : tone(ov.matrix[i][j])}">${i === j ? '—' : pct(ov.matrix[i][j], 0)}</td>`)}</tr>`)}</tbody></table></div>
    <ul class="list only-phone">${pairs.slice(0, 12).map((x) => h`<li><span class="grow">${nm(x.a)} &amp; ${nm(x.b)}</span><span class="num" style="padding:2px 8px;border-radius:6px;${tone(x.v)}">${pct(x.v, 0)}</span></li>`)}</ul>
    <p class="small muted">Overlap is the share of a fund's money in the same companies as the other (sum of the smaller weight for each company). Funds with large overlap move together.</p>`}</div>
  <div class="card" style="margin-bottom:14px"><div class="row between"><h3 style="margin:0">What you own, company by company</h3><span class="small muted">direct shares + your share of each fund</span></div>
    <div class="only-desk scroll-x"><table><thead><tr><th>#</th><th style="text-align:left">Company</th><th class="num">Direct</th><th class="num">Through funds</th><th class="num">Total</th><th class="num">% of portfolio</th><th style="text-align:left">Via</th></tr></thead><tbody>
      ${rows.map((r, i) => h`<tr><td class="muted">${i + 1}</td><td style="text-align:left"><b>${r.ticker || ''}</b> <span class="small muted">${r.name}</span></td><td class="num">${r.direct ? money0(r.direct) : ''}</td><td class="num">${r.funds ? money0(r.funds) : ''}</td><td class="num"><b>${money0(r.total)}</b></td><td class="num">${pct(r.share, 2)}</td>
        <td class="small muted" style="text-align:left">${Object.entries(r.from).sort((a, b) => b[1] - a[1]).map(([k]) => k).join(', ')}</td></tr>`)}</tbody></table></div>
    <ul class="list only-phone">${rows.map((r, i) => h`<li><div class="grow"><b>${r.ticker || r.name}</b>${r.ticker ? h` <span class="small muted ellipsis">${r.name}</span>` : ''}
      <div class="small muted ellipsis">${[r.direct ? 'direct ' + money0(r.direct) : '', ...Object.entries(r.from).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + money0(v))].filter(Boolean).join(' · ')}</div></div>
      <div style="text-align:right"><div class="num">${money0(r.total)}</div><div class="small muted num">${pct(r.share, 2)}</div></div></li>`)}</ul>
    ${lt.rows.length > 25 ? h`<button class="link" id="exp-all">${expAll ? 'Show top 25' : `Show all ${lt.rows.length}`}</button>` : ''}
    ${lt.rows.length ? '' : h`<p class="empty">No holdings with data yet.</p>`}
    <p class="small muted">${lt.other > 0 ? `${money0(lt.other)} sits in fund holdings beyond the top ones published (shown as "Other", not in the table). ` : ''}Fund holdings as of ${asOf.map(shortDate).join(', ') || '—'}; weights move with prices between updates.</p></div>
  <div class="card"><h3>What's included</h3><ul class="list">${lt.positions.map((p) => h`<li><span class="grow"><b>${p.label}</b>${p.k401 ? h` <span class="small muted">401(k)${p.ticker ? ` · treated as ${p.ticker}` : ''}</span>` : ''}
    <div class="small muted">${p.kind === 'stock' ? 'Company stock' : p.kind === 'fund' ? `${p.fund.holdings.length} holdings${p.fund.via ? ` (same portfolio as ${p.fund.via})` : ''}${p.fund.note ? ' · ' + p.fund.note : ''}` : 'No holdings data, left out of look-through'}</div></span><span class="num">${money0(p.value)}</span></li>`)}</ul>
    ${missing.length ? h`<p class="small muted">Left out: ${missing.map((p) => p.label).join(', ')}. ${missing.some((p) => p.k401) ? '401(k) funds are matched by name in K401_MAP (js/calc.js); target-date funds hold other funds and are not broken down.' : ''}</p>` : ''}</div>`}`;
}
function mountExposure(root) {
  root.querySelector('#exp-all')?.addEventListener('click', () => { expAll = !expAll; rerender(); });
}

export const views = { invest: { render, mount }, trades: { render: trades, mount: mountTrades } };
