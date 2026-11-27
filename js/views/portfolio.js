// Invest sub-screens: performance vs a benchmark, dividends, allocation targets + sectors, and taxes.
import * as S from '../store.js';
import { h, money, money0, signed, pct, shortDate, monthName, MONTHS, toCents, sum } from '../util.js';
import * as I from '../insights.js';
import * as M from '../market.js';
import { lines, bars, donut, rangeTabs, filterRange } from '../charts.js';
import { openSheet, closeSheet, toast, options, formData } from '../ui.js';

const cls = (v) => (v == null ? '' : v < 0 ? 'bad' : 'good');
const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
const kpi = (title, value, sub, cl = '') => h`<div class="card kpi"><h3>${title}</h3><div class="big num ${cl}">${value}</div>${sub ? h`<div class="sub">${sub}</div>` : ''}</div>`;
const noData = (what) => h`<div class="card"><p class="muted" style="margin:0">${what} needs the market data (prices published with the app). It loads automatically; if it doesn't appear, check your connection and pull down to refresh.</p></div>`;

let benchT = 'VTI', perfRange = '1Y';
export function performance() {
  if (!M.pricesData()) return noData('Performance');
  const b = I.benchmark(benchT);
  if (!b) return h`<div class="card"><p class="muted" style="margin:0">Not enough price history yet to compare.</p></div>`;
  const pts = filterRange(b.pts, perfRange, (p) => p.date);
  const ahead = b.diff >= 0;
  return h`<div class="grid cols-3" style="margin-bottom:14px">
    ${kpi('Your portfolio', money0(b.you), h`gain ${signed(b.youGain)} since ${shortDate(b.from)}`)}
    ${kpi(`Same money in ${b.ticker}`, money0(b.bench), h`gain ${signed(b.benchGain)}`)}
    ${kpi(ahead ? 'You are ahead by' : 'You are behind by', money0(Math.abs(b.diff)), ahead ? 'your picks beat the index' : 'the index did better', ahead ? 'good' : 'bad')}</div>
  <div class="card" style="margin-bottom:14px"><div class="row between wrap" style="margin-bottom:8px"><div class="row wrap"><h3 style="margin:0">Compared with</h3>
    <select id="bench" style="width:auto;padding:4px 8px;font-size:14px">${options([['VTI', 'VTI · US total market'], ['VOO', 'VOO · S&P 500'], ['VT', 'VT · whole world'], ['QQQ', 'QQQ · Nasdaq-100'], ['SCHD', 'SCHD · dividend stocks']], benchT)}</select></div>${rangeTabs('perf', perfRange)}</div>
    ${lines([{ name: 'You', points: pts.map((p) => ({ x: p.date, y: p.you })) }, { name: b.ticker, points: pts.map((p) => ({ x: p.date, y: p.bench })), color: 'var(--s2)' }], { height: 200, label: (p) => shortDate(p.x) })}
    <p class="small muted">Brokerage + Roth IRA. Starts with what you held on ${shortDate(b.from)} and puts every later buy and sell into ${b.ticker} on the same day instead. Your line includes reinvested dividends; the ${b.ticker} line is price only, so it's about 1–1.5% a year low for funds that pay dividends. The 401(k) isn't included (no daily prices).</p></div>`;
}
export function mountPerformance(root) {
  root.querySelector('#bench')?.addEventListener('change', (e) => { benchT = e.target.value; rerender(); });
  root.querySelectorAll('[data-range^="perf:"]').forEach((b) => b.onclick = () => { perfRange = b.dataset.range.split(':')[1]; rerender(); });
}

export function dividendsView() {
  const d = I.dividends();
  if (!d.total) return h`<div class="card"><p class="muted" style="margin:0">No dividend reinvestments recorded yet. They come in with your Vanguard transaction history.</p></div>`;
  return h`<div class="grid cols-3" style="margin-bottom:14px">${kpi('Last 12 months', money(d.ttm), 'reinvested dividends')}
    ${kpi('Next 12 months', money(d.forward), 'estimate, adjusted for shares you added')}${kpi('All time', money(d.total), `${d.byYear.map((y) => `${y.y}: ${money0(y.amount)}`).join(' · ')}`)}</div>
  <div class="card" style="margin-bottom:14px"><h3>By month</h3>${bars(d.months.map((x) => ({ label: monthName(x.m), short: MONTHS[+x.m.slice(5) - 1].slice(0, 1), value: x.amount })), { fmt: money })}</div>
  <div class="card scroll-x"><h3>By holding (last 12 months)</h3><table><thead><tr><th>Holding</th><th class="num">Dividends</th><th class="num">Payments</th><th class="num">Yield now</th><th class="num">Yield on cost</th><th class="num">Next 12 mo</th></tr></thead>
    <tbody>${d.byTicker.map((x) => h`<tr><td><b>${x.ticker}</b></td><td class="num">${money(x.ttm)}</td><td class="num">${x.count}</td><td class="num">${pct(x.yieldNow, 2)}</td><td class="num">${pct(x.yoc, 2)}</td><td class="num">${money(x.forward)}</td></tr>`)}</tbody></table>
    <p class="small muted">Yield on cost compares the last year's dividends with what you paid. Holdings bought recently show a low yield until a full year of dividends has come in.</p></div>`;
}

let depositAmt = 50000;
export function allocationView() {
  const a = I.allocationClasses(), sb = I.sectorBreakdown(), next = I.nextDeposit(depositAmt);
  const drift = a.rows.filter((r) => r.target || r.value);
  return h`<div class="grid cols-2" style="margin-bottom:14px">
    <div class="card"><div class="row between"><h3 style="margin:0">Mix vs your targets</h3><button class="link" id="al-edit">Set targets</button></div>
      <ul class="list">${drift.map((r) => { const off = r.share - r.target; return h`<li><div class="grow"><div class="row between"><b>${r.cls}</b><span class="num small">${pct(r.share, 0)} <span class="muted">/ ${pct(r.target, 0)}</span> <span class="${Math.abs(off) > 0.05 ? 'warn' : 'muted'}">(${off > 0 ? '+' : ''}${(off * 100).toFixed(0)})</span></span></div>
        <div class="meter" style="margin-top:6px"><i style="width:${Math.min(100, r.share * 100)}%"></i><b style="left:${Math.min(100, r.target * 100)}%"></b></div><div class="small muted num" style="margin-top:3px">${money0(r.value)}</div></div></li>`; })}</ul>
      <p class="small muted">The black tick is your target. Funds are split into US and international using their holdings; the 401(k) is included.</p></div>
    <div class="card"><h3>Where to put your next deposit</h3>
      <label class="row" style="gap:8px;color:var(--text)">Amount <input id="al-amt" inputmode="decimal" value="${(depositAmt / 100).toFixed(0)}" style="width:120px"></label>
      ${next.length ? h`<ul class="list">${next.map((x) => h`<li><span class="grow">${x.cls}</span><b class="num">${money0(x.amount)}</b></li>`)}</ul>` : h`<p class="muted">You're already on target.</p>`}
      <p class="small muted">Splits new money toward whatever is furthest below target, so you rebalance without selling (and without taxes).</p></div></div>
  <div class="grid cols-2">
    <div class="card"><h3>Sectors (look-through)</h3>${donut(sb.sectors.slice(0, 9).map((s) => ({ label: s.sector, value: s.value })).concat(sb.sectors.length > 9 ? [{ label: 'Other sectors', value: sum(sb.sectors.slice(9), (s) => s.value) }] : []))}
      <p class="small muted">Covers ${money0(sb.covered)} of ${money0(sb.total)}: each fund's published top holdings plus your stocks. Sector labels come from Nasdaq's stock screener.</p></div>
    <div class="card"><h3>Where the companies are</h3>${donut([{ label: 'United States', value: sb.geo['United States'] }, { label: 'International', value: sb.geo.International }])}
      <ul class="list" style="margin-top:8px">${sb.sectors.slice(0, 6).map((s) => h`<li><span class="grow">${s.sector}</span><span class="num">${money0(s.value)}</span><span class="num small muted" style="width:52px;text-align:right">${pct(s.share, 0)}</span></li>`)}</ul></div></div>`;
}
export function mountAllocation(root) {
  root.querySelector('#al-edit').onclick = editTargets;
  const inp = root.querySelector('#al-amt'); inp.onchange = () => { const c = toCents(inp.value); if (c > 0) { depositAmt = c; rerender(); } };
}
function editTargets() {
  const t = I.targets();
  openSheet(h`<div class="row between"><h2>Target mix</h2><button class="link" data-close>Close</button></div><form class="form" id="tg">
    ${I.CLASSES.map((c) => h`<label>${c} (%)<input name="${c}" inputmode="numeric" value="${t[c] || 0}"></label>`)}
    <p class="small muted" id="tg-sum" style="margin:0"></p><p class="form-error" id="tg-err" role="alert"></p>
    <div class="row between sheet-actions"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div></form>`, (root) => {
    const f = root.querySelector('#tg'), total = () => sum(I.CLASSES, (c) => parseFloat(f.elements[c].value) || 0);
    const show = () => { root.querySelector('#tg-sum').textContent = `Adds up to ${total()}%`; }; f.oninput = show; show();
    f.onsubmit = async (e) => { e.preventDefault(); if (Math.round(total()) !== 100) { root.querySelector('#tg-err').textContent = 'Targets need to add up to 100%.'; return; }
      const d = formData(f); await S.saveSetting('targets', Object.fromEntries(I.CLASSES.map((c) => [c, parseFloat(d[c]) || 0]))); closeSheet(); toast('Targets saved'); };
  });
}

export function taxesView() {
  const tx = I.taxLots(), accts = I.taxableAccts().map((a) => a.name).join(', ');
  if (!tx.open.length && !tx.realized.length) return h`<div class="card"><p class="muted" style="margin:0">No holdings in a taxable account${accts ? ` (${accts})` : ''}. Roth accounts are tax-free, so they're left out here.</p></div>`;
  const y = new Date().getFullYear();
  return h`<div class="grid cols-3" style="margin-bottom:14px">${kpi(`Realized gains ${y}`, signed(tx.shortGain + tx.longGain), `short-term ${signed(tx.shortGain)} · long-term ${signed(tx.longGain)}`, cls(tx.shortGain + tx.longGain))}
    ${kpi('Unrealized gain', signed(sum(tx.open, (o) => o.gain || 0)), `${accts}`, cls(sum(tx.open, (o) => o.gain || 0)))}
    ${kpi('Turning long-term soon', String(tx.soonLong.length), tx.soonLong.length ? `next: ${tx.soonLong[0].ticker} in ${tx.soonLong[0].toLong} days` : 'none in the next 60 days')}</div>
  ${tx.harvest.length ? h`<div class="card" style="margin-bottom:14px"><h3>Losses you could harvest</h3><ul class="list">${tx.harvest.map((o) => h`<li><div class="grow"><b>${o.ticker}</b> <span class="small muted">bought ${shortDate(o.date)} · ${o.shares.toFixed(3)} sh</span>${o.wash ? h` <span class="pill warn">bought within 30 days</span>` : ''}</div><span class="num bad">${signed(o.gain)}</span></li>`)}</ul>
    <p class="small muted">Selling at a loss can offset gains and up to $3,000 of income a year. Buying the same fund within 30 days before or after (in any account, IRA included, and dividend reinvestments count) makes it a wash sale and the loss doesn't count. This is information, not tax advice.</p></div>` : ''}
  <div class="card scroll-x"><h3>Open lots (first in, first out)</h3><table><thead><tr><th>Holding</th><th>Bought</th><th class="num">Shares</th><th class="num">Cost</th><th class="num">Value</th><th class="num">Gain</th><th>Term</th></tr></thead><tbody>
    ${tx.open.map((o) => h`<tr><td><b>${o.ticker}</b></td><td>${shortDate(o.date)}</td><td class="num">${o.shares.toFixed(3)}</td><td class="num">${money(o.cost)}</td><td class="num">${money(o.value)}</td><td class="num ${cls(o.gain)}">${signed(o.gain)}</td>
      <td>${o.long ? h`<span class="pill good">long</span>` : h`<span class="pill">short · ${o.toLong}d</span>`}</td></tr>`)}</tbody></table>
    <p class="small muted">Long-term means held more than a year; those gains are taxed at lower rates. The app's holdings screen uses average cost; this view matches each sale to your oldest shares first, which is the IRS default.</p></div>`;
}
