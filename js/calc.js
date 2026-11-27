// Every figure the app shows is calculated here from records; nothing is stored as a total.
import * as S from './store.js';
import { ym, sum, addMonths, monthsBetween, thisMonth, today } from './util.js'; // today used by xirr/positionStats
import * as M from './market.js';

export const BASELINE_START = '2026-07'; // full-time work began; earlier months are college history only

export const cat = (id) => S.get('categories', id);
export const acct = (id) => S.get('accounts', id);
export const activeCats = () => S.all('categories').filter((c) => !c.archived).sort((a, b) => a.name.localeCompare(b.name));

// Personal spending: not shared, not one-off, not a reimbursed work expense, and in a category that counts.
const counts = (t) => t.payer !== 'shared' && !t.oneOff && !t.reimb && t.status !== 'review' && (cat(t.catId)?.countsAsSpending !== false);
export const isPersonal = counts;
export const monthTxns = (m) => S.all('txns').filter((t) => t.status !== 'review' && ym(t.date) === m);

// Which year's budget applies to a month. From Dec 2026 on, the working (2027) budget applies.
export function budgetYear(m) {
  const y = +m.slice(0, 4);
  const years = [...new Set(S.all('budgets').map((b) => b.year))].sort();
  if (m >= '2026-12' && y < 2027 && years.includes(2027)) return 2027;
  const ok = years.filter((x) => x <= Math.max(y, 2027));
  return years.includes(y) ? y : (ok.at(-1) ?? y);
}
export function budgetFor(catId, m, payer = 'me') {
  const y = budgetYear(m);
  const b = S.all('budgets').find((x) => x.year === y && x.catId === catId && (x.payer || 'me') === payer);
  if (!b) return 0;
  return b.monthly ?? Math.round((b.annual || 0) / 12);
}

export function monthSummary(m) {
  const txns = monthTxns(m);
  const rows = {};
  const row = (id) => (rows[id] ||= { catId: id, spent: 0, oneOff: 0, shared: 0, budget: budgetFor(id, m), txns: [] });
  for (const c of S.all('categories')) if (budgetFor(c.id, m)) row(c.id);
  for (const t of txns) {
    const r = row(t.catId); r.txns.push(t);
    if (t.payer === 'shared') r.shared += t.amount; else if (t.reimb) r.reimb = (r.reimb || 0) + t.amount; else if (t.oneOff) r.oneOff += t.amount;
    else if (cat(t.catId)?.countsAsSpending !== false) r.spent += t.amount;
  }
  const list = Object.values(rows).filter((r) => (cat(r.catId)?.countsAsSpending !== false || r.spent || r.oneOff) && (r.budget || r.spent || r.oneOff || r.shared || r.reimb));
  const personal = list.filter((r) => r.budget || r.spent || r.oneOff);
  return {
    rows: list,
    budget: sum(personal, (r) => r.budget), spent: sum(personal, (r) => r.spent),
    oneOff: sum(list, (r) => r.oneOff), shared: sum(list, (r) => r.shared), reimb: sum(list, (r) => r.reimb || 0),
    income: sum(S.all('income').filter((i) => ym(i.date) === m), (i) => i.amount),
  };
}

// Average month since July 2026 (full months only, one-offs excluded), per category and overall.
export function typicalMonth(upTo = addMonths(thisMonth(), -1)) {
  const n = Math.max(0, monthsBetween(BASELINE_START, upTo) + 1);
  const per = {};
  if (!n) return { months: 0, per, total: 0 };
  for (const t of S.all('txns')) {
    const m = ym(t.date); if (m < BASELINE_START || m > upTo || !counts(t)) continue;
    per[t.catId] = (per[t.catId] || 0) + t.amount;
  }
  for (const k in per) per[k] = Math.round(per[k] / n);
  return { months: n, per, total: sum(Object.values(per)) };
}

// ---- Investments ----
export function holdings() {
  const by = {};
  for (const l of S.all('lots')) {
    const k = l.acctId + '|' + l.ticker;
    const h = (by[k] ||= { acctId: l.acctId, ticker: l.ticker, shares: 0, cost: 0, boughtShares: 0, lots: [] });
    h.lots.push(l); h.shares += l.shares;
    if (l.kind !== 'sell') { h.cost += Math.round(l.shares * l.price * 100); h.boughtShares += l.shares; }
  }
  return Object.values(by).filter((h) => Math.abs(h.shares) > 1e-6).map((h) => {
    const s = S.get('securities', h.ticker) || {};
    const avg = h.boughtShares ? h.cost / h.boughtShares : 0; // average-cost method, cents per share
    const cost = Math.round(avg * h.shares);
    const value = s.last != null ? Math.round(h.shares * s.last * 100) : null;
    const day = s.last != null && s.prior != null ? Math.round(h.shares * (s.last - s.prior) * 100) : null;
    return { ...h, sec: s, avg, cost, value, day, gain: value == null ? null : value - cost };
  });
}
export function accountTotals() {
  const hs = holdings(); const by = {};
  for (const h of hs) { const a = (by[h.acctId] ||= { acctId: h.acctId, cost: 0, value: 0, day: 0, n: 0 }); a.cost += h.cost; a.value += h.value || 0; a.day += h.day || 0; a.n++; }
  return by;
}
export function allocation() {
  const by = {}; for (const h of holdings()) { const t = h.sec.type || 'Other'; by[t] = (by[t] || 0) + (h.value || 0); }
  return by;
}

// Annualized money-weighted return (XIRR). Flows: [{date, amount}] with money in negative, money out / current value positive.
export function xirr(flows) {
  if (flows.length < 2 || !flows.some((f) => f.amount < 0) || !flows.some((f) => f.amount > 0)) return null;
  const t0 = new Date(flows[0].date + 'T12:00'), yrs = (d) => (new Date(d + 'T12:00') - t0) / 3.15576e10;
  const span = yrs(flows.at(-1).date); if (span < 0.08) return null; // under a month: not meaningful
  const npv = (r) => flows.reduce((a, f) => a + f.amount / Math.pow(1 + r, yrs(f.date)), 0);
  let lo = -0.99, hi = 10; if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid; }
  return (lo + hi) / 2;
}
// Stats for one ticker across all accounts (or one account).
export function positionStats(ticker, acctId) {
  const lots = S.all('lots').filter((l) => l.ticker === ticker && (!acctId || l.acctId === acctId)).sort((a, b) => a.date.localeCompare(b.date));
  const hs = holdings().filter((x) => x.ticker === ticker && (!acctId || x.acctId === acctId));
  const s = S.get('securities', ticker) || {};
  const value = sum(hs, (x) => x.value || 0), cost = sum(hs, (x) => x.cost), shares = sum(hs, (x) => x.shares);
  const reinv = lots.filter((l) => l.kind === 'reinvest'), buys = lots.filter((l) => l.kind === 'buy'), sells = lots.filter((l) => l.kind === 'sell');
  const flows = lots.filter((l) => l.kind !== 'reinvest').map((l) => ({ date: l.date, amount: -Math.round(l.shares * l.price * 100) }));
  if (value) flows.push({ date: s.priceDate || today(), amount: value });
  const lotPerf = buys.map((l) => ({ l, ret: s.last ? s.last / l.price - 1 : null })).filter((x) => x.ret != null).sort((a, b) => b.ret - a.ret);
  const total = sum(holdings(), (x) => x.value || 0) + (k401().value || 0);
  return { ticker, sec: s, lots, hs, shares, value, cost, gain: value - cost, gainPct: cost ? (value - cost) / cost : null,
    day: sum(hs, (x) => x.day || 0), dayPct: s.prior ? s.last / s.prior - 1 : null, avg: shares ? cost / shares : 0,
    weight: total ? value / total : 0, firstBuy: lots[0]?.date, buys: buys.length, sells: sells.length,
    reinvested: sum(reinv, (l) => Math.round(l.shares * l.price * 100)), reinvShares: sum(reinv, (l) => l.shares),
    invested: sum(buys, (l) => Math.round(l.shares * l.price * 100)), xirr: xirr(flows), best: lotPerf[0], worst: lotPerf.at(-1) };
}
export function portfolioStats() {
  const lots = S.all('lots').sort((a, b) => a.date.localeCompare(b.date)), hs = holdings(), value = sum(hs, (x) => x.value || 0);
  const flows = lots.filter((l) => l.kind !== 'reinvest').map((l) => ({ date: l.date, amount: -Math.round(l.shares * l.price * 100) }));
  const lastPrice = S.all('securities').map((s) => s.priceDate).filter(Boolean).sort().at(-1) || today();
  if (value) flows.push({ date: lastPrice, amount: value });
  const y = today().slice(0, 4);
  return { xirr: xirr(flows), reinvestedYTD: sum(lots.filter((l) => l.kind === 'reinvest' && l.date.startsWith(y)), (l) => Math.round(l.shares * l.price * 100)),
    investedYTD: sum(lots.filter((l) => l.kind === 'buy' && l.date.startsWith(y)), (l) => Math.round(l.shares * l.price * 100)) };
}

// ---- Net worth ----
export function latestSnapshot(acctId, onOrBefore = '9999-12-31') {
  return S.all('snapshots').filter((s) => s.acctId === acctId && s.date <= onOrBefore).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
}
export function netWorth() {
  const totals = accountTotals(); const rows = [];
  for (const a of S.all('accounts').filter((x) => !x.closed)) {
    const snap = latestSnapshot(a.id);
    let value = snap?.balance ?? 0, calc = null, gap = null;
    if (a.isInvestment) {
      calc = totals[a.id]?.value ?? null;
      if (calc != null && snap) gap = snap.balance - calc; // unexplained difference (missing lots, cash, stale snapshot)
      value = calc ?? snap?.balance ?? 0;
    }
    const sign = a.isLiability ? -1 : 1;
    rows.push({ acct: a, snap, value: sign * value, calc, gap: gap == null ? null : sign * gap });
  }
  const total = sum(rows, (r) => r.value); const gaps = sum(rows, (r) => r.gap || 0);
  return { rows, total, gaps, withGaps: total + gaps };
}
export function netWorthHistory() {
  const dates = [...new Set(S.all('snapshots').map((s) => s.date))].sort();
  return dates.map((d) => ({ date: d, total: sum(S.all('accounts'), (a) => (a.isLiability ? -1 : 1) * (latestSnapshot(a.id, d)?.balance || 0)) }));
}

// ---- Sinking funds ----
export function fundBalance(fundId) { return sum(S.all('contributions').filter((c) => c.fundId === fundId), (c) => c.amount); }
export function fundStatus(f) {
  const bal = fundBalance(f.id);
  if (!f.target || !f.targetDate) return { bal, onTrack: null, progress: null };
  const first = S.all('contributions').filter((c) => c.fundId === f.id).map((c) => c.date).sort()[0] || today();
  const total = Math.max(1, monthsBetween(ym(first), ym(f.targetDate)));
  const elapsed = Math.min(total, Math.max(0, monthsBetween(ym(first), thisMonth())));
  return { bal, progress: bal / f.target, onTrack: bal >= f.target * (elapsed / total) };
}

// ---- 401(k) from quarterly statements ----
export function k401() { return k401Impl(); }
function k401Impl() {
  const st = S.all('k401').sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)), last = st.at(-1);
  return { statements: st, last, value: last?.end ?? null, asOf: last?.periodEnd,
    employee: sum(st, (s) => (s.employee || 0) + (s.employeePretax || 0)), match: sum(st, (s) => s.match || 0), gain: sum(st, (s) => s.gain || 0) };
}

// ---- Savings buckets (goals kept inside a savings account) ----
export function buckets(acctId) {
  const funds = S.all('funds').filter((f) => f.acctId === acctId), snap = latestSnapshot(acctId);
  const inBuckets = sum(funds, (f) => fundBalance(f.id));
  return { funds, inBuckets, balance: snap?.balance ?? null, asOf: snap?.date, unassigned: snap ? snap.balance - inBuckets : null };
}

export const inboxCount = () => S.all('txns').filter((t) => t.status === 'review').length;

// ---- Market data: price history stats, fund overlap, look-through exposure ----
// Return over a period from daily closes: close on/before the start date vs the latest close.
export function priceStats(ticker) {
  const hs = M.history(ticker); if (hs.length < 2) return null;
  const last = hs.at(-1), d = new Date(last.date + 'T12:00');
  const back = (days) => { const t = new Date(d); t.setDate(t.getDate() - days); return t.toLocaleDateString('en-CA'); };
  const at = (date) => { let x = null; for (const p of hs) { if (p.date <= date) x = p; else break; } return x; };
  const ret = (date) => { const p = at(date); return p && p.date < last.date && p.close ? last.close / p.close - 1 : null; };
  const yr = hs.filter((p) => p.date > back(365)), closes = yr.map((p) => p.close);
  return { last, history: hs, r1m: ret(back(30)), r3m: ret(back(91)), ytd: ret((+last.date.slice(0, 4) - 1) + '-12-31'), r1y: hs[0].date <= back(360) ? ret(back(365)) : null,
    low: Math.min(...closes), high: Math.max(...closes) };
}

// 401(k) funds come from statements by name, without tickers. Map the obvious ones to an ETF with the same
// (or a near-identical) index; anything unmatched is left out of look-through with a note. Edit freely.
export const K401_MAP = [
  [/tot(al)?\.?\s*st(oc)?k\s*m(ar)?k?t/i, 'VTI'],   // Vanguard MStar Tot Stk Mkt Idx ~ US total market
  [/sm(al)?l?\s*cap/i, 'VB'],                      // Vanguard MStar Small Cap Idx ~ US small caps
  [/s\s*&?\s*p\s*500|500\s*index/i, 'VOO'],
];
const SAME_CO = { GOOG: 'GOOGL', 'BRK.A': 'BRK.B' }; // share classes of one company
const coKey = (t, name) => (t && /^[A-Z][A-Z.]{0,6}$/.test(t) ? SAME_CO[t] || t : 'n:' + String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());

// Everything the owner holds, as {label, ticker, value (cents), kind: 'fund'|'stock'|'none', fund}.
export function exposurePositions() {
  const by = {};
  for (const x of holdings()) { const r = (by[x.ticker] ||= { label: x.ticker, ticker: x.ticker, value: 0, sec: x.sec }); r.value += x.value || 0; }
  const out = Object.values(by).map((r) => {
    const f = M.fund(r.ticker);
    return { ...r, fund: f, kind: f ? 'fund' : /fund|etf|trust|index/i.test((r.sec.type || '') + ' ' + (r.sec.name || '')) ? 'none' : 'stock' };
  });
  const k = k401();
  for (const f of k.last?.funds || []) {
    if (!f.end) continue;
    const m = K401_MAP.find(([re]) => re.test(f.name)), fd = m && M.fund(m[1]);
    out.push({ label: f.name, ticker: m?.[1] || null, value: f.end, k401: true, fund: fd, kind: fd ? 'fund' : 'none' });
  }
  return out.filter((r) => r.value > 0);
}

// Look-through: each company's dollars across direct shares and every fund's top holdings.
export function lookThrough() {
  const pos = exposurePositions(), total = sum(pos, (p) => p.value), cos = {};
  let other = 0, unmapped = 0;
  for (const p of pos) {
    if (p.kind === 'stock') {
      const c = (cos[coKey(p.ticker, p.sec?.name)] ||= { ticker: p.ticker, name: p.sec?.name || p.ticker, direct: 0, funds: 0, from: {} });
      c.direct += p.value; continue;
    }
    if (p.kind !== 'fund') { unmapped += p.value; continue; }
    let covered = 0;
    for (const x of p.fund.holdings) {
      const k = coKey(x.ticker, x.name), v = p.value * x.weight;
      const c = (cos[k] ||= { ticker: /^[A-Z][A-Z.]{0,6}$/.test(x.ticker) ? SAME_CO[x.ticker] || x.ticker : '', name: x.name, direct: 0, funds: 0, from: {} });
      c.funds += v; const via = p.k401 ? '401(k)' : p.label; c.from[via] = (c.from[via] || 0) + v; covered += x.weight;
    }
    other += p.value * Math.max(0, 1 - covered);
  }
  const rows = Object.values(cos).map((c) => ({ ...c, total: c.direct + c.funds, share: total ? (c.direct + c.funds) / total : 0 })).sort((a, b) => b.total - a.total);
  return { rows, total, other, unmapped, positions: pos };
}

// Overlap between two funds: sum over companies of the smaller weight (0 = nothing shared, 1 = identical).
export function fundOverlap() {
  const fs = exposurePositions().filter((p) => p.kind === 'fund');
  const w = fs.map((p) => { const m = {}; for (const x of p.fund.holdings) { const k = coKey(x.ticker, x.name); m[k] = (m[k] || 0) + x.weight; } return m; });
  const matrix = fs.map((_, i) => fs.map((__, j) => { if (i === j) return 1; let s = 0; for (const k in w[i]) if (w[j][k]) s += Math.min(w[i][k], w[j][k]); return s; }));
  return { funds: fs, matrix };
}
