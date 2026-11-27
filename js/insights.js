// Insights built from the records: monthly review, projections, benchmark, recurring charges, alerts,
// dividends, allocation, taxes, Roth/401(k) tracking, trends, cash flow and data health.
// Like calc.js, nothing here is stored; every figure is worked out from transactions, lots and snapshots.
import * as S from './store.js';
import * as C from './calc.js';
import * as M from './market.js';
import { ym, sum, addMonths, thisMonth, today, monthsBetween, daysBetween, groupBy } from './util.js';

const DAY = 864e5;
export const addDays = (d, n) => new Date(new Date(d + 'T12:00').getTime() + n * DAY).toLocaleDateString('en-CA');
const median = (xs) => { const a = [...xs].sort((x, y) => x - y); return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : null; };
const monthEnd = (m) => addDays(addMonths(m, 1) + '-01', -1);

// Assumptions used by projections; editable on the Plan screen.
export const planPrefs = () => ({ birthYear: null, retireAge: 60, ret: 0.07, extra: 0, ...S.setting('plan', {}) });

// ---------------- Portfolio value through time (from lots + daily closes) ----------------
// Shares held of each ticker at the end of a date, and value at that date's close (null when no price yet).
function priceOn(ticker, date) {
  const hs = M.history(ticker); if (!hs.length || hs[0].date > date) return null;
  let lo = 0, hi = hs.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (hs[mid].date <= date) lo = mid; else hi = mid - 1; }
  return hs[lo].close;
}
export function portfolioValueOn(date) {
  const sh = {};
  for (const l of S.all('lots')) if (l.date <= date) sh[l.ticker] = (sh[l.ticker] || 0) + l.shares;
  let v = 0, missing = 0;
  for (const [t, n] of Object.entries(sh)) { if (Math.abs(n) < 1e-6) continue; const p = priceOn(t, date); if (p == null) missing++; else v += n * p * 100; }
  return { value: Math.round(v), missing };
}
// Net money put in (buys minus sells; dividend reinvestments are returns, not new money) between two dates.
export const netDeposits = (from, to) => sum(S.all('lots').filter((l) => l.kind !== 'reinvest' && l.date > from && l.date <= to), (l) => Math.round(l.shares * l.price * 100));

// Your portfolio vs putting the same deposits on the same dates into one index fund (default VTI), over the price history (about a year).
export function benchmark(ticker = 'VTI') {
  const dates = M.pricesData()?.dates || [], bh = M.history(ticker); if (dates.length < 10 || bh.length < 10) return null;
  const d0 = dates.find((d) => d >= bh[0].date && portfolioValueOn(d).value > 0) || null; if (!d0) return null;
  const v0 = portfolioValueOn(d0).value;
  let units = v0 / (priceOn(ticker, d0) * 100);
  const flows = S.all('lots').filter((l) => l.kind !== 'reinvest' && l.date > d0).sort((a, b) => a.date.localeCompare(b.date));
  const pts = []; let fi = 0;
  const step = Math.max(1, Math.round(dates.filter((d) => d >= d0).length / 60));
  dates.filter((d) => d >= d0).forEach((d, i, arr) => {
    while (fi < flows.length && flows[fi].date <= d) { const f = flows[fi++], p = priceOn(ticker, f.date); if (p) units += (f.shares * f.price) / p; }
    if (i % step === 0 || i === arr.length - 1) pts.push({ date: d, you: portfolioValueOn(d).value, bench: Math.round(units * priceOn(ticker, d) * 100) });
  });
  const last = pts.at(-1), deposits = netDeposits(d0, last.date);
  return { ticker, from: d0, v0, deposits, pts, you: last.you, bench: last.bench, diff: last.you - last.bench,
    youGain: last.you - v0 - deposits, benchGain: last.bench - v0 - deposits };
}

// ---------------- Monthly review ----------------
export function netWorthOn(date) {
  return sum(S.all('accounts').filter((a) => !a.closed), (a) => (a.isLiability ? -1 : 1) * (C.latestSnapshot(a.id, date)?.balance || 0));
}
export function monthReview(m) {
  const sm = C.monthSummary(m), start = addDays(m + '-01', -1), end = monthEnd(m) < today() ? monthEnd(m) : today();
  const out = sm.spent + sm.oneOff, saved = sm.income - out;
  const p0 = portfolioValueOn(start), p1 = portfolioValueOn(end), deposits = netDeposits(start, end);
  const stubs = S.all('paystubs').filter((p) => ym(p.payDate || '') === m);
  const k401in = sum(stubs, (p) => (p.roth401k || 0) + (p.match || 0));
  const over = sm.rows.filter((r) => r.budget && r.spent > r.budget).map((r) => ({ ...r, by: r.spent - r.budget })).sort((a, b) => b.by - a.by).slice(0, 3);
  const under = sm.rows.filter((r) => r.budget && r.spent < r.budget).map((r) => ({ ...r, by: r.budget - r.spent })).sort((a, b) => b.by - a.by).slice(0, 3);
  const prev = C.monthSummary(addMonths(m, -1)), tm = C.typicalMonth(addMonths(m, -1));
  const nw0 = netWorthOn(start), nw1 = netWorthOn(end);
  const biggest = S.all('txns').filter((t) => ym(t.date) === m && C.isPersonal(t)).sort((a, b) => b.amount - a.amount).slice(0, 5);
  return { m, sm, out, saved, rate: sm.income ? saved / sm.income : null, deposits, k401in,
    port: { start: p0.value, end: p1.value, change: p1.value - p0.value, market: p1.value - p0.value - deposits, missing: p1.missing },
    nw: { start: nw0, end: nw1, change: nw1 - nw0 }, over, under, prevSpent: prev.spent, typical: tm.total, biggest };
}

// ---------------- Savings rate & projections ----------------
export function savingsHistory(n = 12) {
  const out = [];
  for (let i = n; i >= 1; i--) {
    const m = addMonths(thisMonth(), -i); if (m < C.BASELINE_START) continue;
    const sm = C.monthSummary(m), saved = sm.income - sm.spent - sm.oneOff;
    const k = sum(S.all('paystubs').filter((p) => ym(p.payDate || '') === m), (p) => (p.roth401k || 0) + (p.match || 0));
    out.push({ m, income: sm.income, spent: sm.spent + sm.oneOff, saved, k401: k, rate: sm.income ? saved / sm.income : null });
  }
  return out;
}
// Months to grow from `start` to `goal` adding `monthly` at annual return `ret` (null if never within 80 years).
export function monthsTo(goal, start, monthly, ret) {
  const r = Math.pow(1 + ret, 1 / 12) - 1; let v = start;
  for (let i = 0; i <= 960; i++) { if (v >= goal) return i; v = v * (1 + r) + monthly; }
  return null;
}
export function projectSeries(start, monthly, ret, years) {
  const r = Math.pow(1 + ret, 1 / 12) - 1, pts = []; let v = start;
  for (let i = 0; i <= years * 12; i++) { if (i % 12 === 0) pts.push({ year: i / 12, value: Math.round(v) }); v = v * (1 + r) + monthly; }
  return pts;
}

// Roth IRA contribution limits by tax year (IRS, under age 50). Add new years as they're announced.
export const ROTH_LIMITS = { 2024: 700000, 2025: 700000, 2026: 750000 };
export const rothLimit = (y) => ROTH_LIMITS[y] ?? ROTH_LIMITS[Math.max(...Object.keys(ROTH_LIMITS).map(Number))];
// Contributions for a tax year: typed in on the Plan screen, otherwise estimated from buys in Roth IRA accounts that calendar year.
export function rothStatus(y) {
  const ids = new Set(S.all('accounts').filter((a) => /roth ira/i.test(a.type)).map((a) => a.id));
  const est = sum(S.all('lots').filter((l) => ids.has(l.acctId) && l.kind === 'buy' && l.date.startsWith(String(y))), (l) => Math.round(l.shares * l.price * 100));
  const typed = S.setting('rothContrib', {})[y];
  const amount = typed ?? est, limit = rothLimit(y);
  return { y, amount, estimated: typed == null, limit, left: Math.max(0, limit - amount), deadline: `${y + 1}-04-15` };
}

// 401(k): value from the latest statement, yearly contributions from paystubs (you + match), projected to retirement.
export function k401Plan() {
  const k = C.k401(), stubs = S.all('paystubs').filter((p) => p.payDate).sort((a, b) => a.payDate.localeCompare(b.payDate)).slice(-6);
  const gaps = stubs.slice(1).map((p, i) => daysBetween(stubs[i].payDate, p.payDate)).filter((g) => g > 5);
  const perYear = gaps.length ? Math.round(365 / median(gaps)) : 26;
  let per = stubs.length ? sum(stubs, (p) => (p.roth401k || 0) + (p.match || 0)) / stubs.length : 0;
  if (!per) { const pay = S.setting('paycheck', {}); per = pay.k401 || 0; }
  const yearly = Math.round(per * perYear), pp = planPrefs();
  const age = pp.birthYear ? +today().slice(0, 4) - pp.birthYear : null, years = age != null ? Math.max(0, pp.retireAge - age) : 35;
  const series = projectSeries(k.value || 0, yearly / 12, pp.ret, years);
  return { value: k.value, asOf: k.asOf, perPaycheck: Math.round(per), perYear, yearly, years, atRetirement: series.at(-1).value, series, age };
}

// ---------------- Recurring charges & subscriptions ----------------
const keyOf = (t) => String(t.merchant || t.note || '').toUpperCase().replace(/\d{3,}|[#*]+\S*|\b(POS|PURCHASE|DEBIT|CARD|ACH|PMT|PAYMENT|RECURRING)\b/g, ' ').replace(/[^A-Z&' ]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' ');
const CADENCE = [['weekly', 5, 9, 52], ['every 2 weeks', 12, 16, 26], ['monthly', 25, 36, 12], ['quarterly', 80, 100, 4], ['yearly', 340, 390, 1]];
export function recurring() {
  const txns = S.all('txns').filter((t) => t.status !== 'review' && t.payer !== 'shared' && !t.reimb && t.amount > 0);
  const out = [];
  for (const [key, ts] of Object.entries(groupBy(txns, keyOf))) {
    if (key.length < 3 || ts.length < 2) continue;
    ts.sort((a, b) => a.date.localeCompare(b.date));
    const gaps = ts.slice(1).map((t, i) => daysBetween(ts[i].date, t.date)), g = median(gaps);
    const cad = CADENCE.find(([, lo, hi]) => g >= lo && g <= hi); if (!cad || (ts.length < 3 && cad[0] !== 'yearly')) continue;
    const amts = ts.slice(-4).map((t) => t.amount); if (Math.max(...amts) > Math.min(...amts) * 1.35) continue;
    if (gaps.slice(-3).some((x) => x < cad[1] * 0.6 || x > cad[2] * 1.6)) continue;
    const last = ts.at(-1), prev = ts.at(-2), next = addDays(last.date, Math.round(g));
    const lapsed = daysBetween(last.date, today()) > cad[2] * 1.8;
    out.push({ key, name: last.note || last.merchant || key, catId: last.catId, acctId: last.acctId, cadence: cad[0], every: Math.round(g), amount: last.amount, annual: last.amount * cad[3], last: last.date, next, count: ts.length,
      raised: last.amount > prev.amount * 1.03 ? last.amount - prev.amount : 0, isNew: daysBetween(ts[0].date, today()) < 100, lapsed });
  }
  return out.sort((a, b) => (a.lapsed - b.lapsed) || b.annual - a.annual);
}

// ---------------- Budget alerts (this month) ----------------
export function budgetAlerts(m = thisMonth()) {
  const sm = C.monthSummary(m), d = new Date(), days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(), day = m === thisMonth() ? d.getDate() : days;
  const left = days - day, pace = day / days, out = [];
  for (const r of sm.rows) {
    if (!r.budget) continue; const f = r.spent / r.budget, name = C.cat(r.catId)?.name || 'Uncategorized';
    if (f > 1) out.push({ level: 'bad', catId: r.catId, text: `${name} is over budget by`, amount: r.spent - r.budget, f });
    else if (f >= 0.8 && left > 3 && f > pace + 0.1) out.push({ level: 'warn', catId: r.catId, text: `${name} is at ${Math.round(f * 100)}% with ${left} days left`, amount: r.budget - r.spent, f });
  }
  return out.sort((a, b) => b.f - a.f);
}

// ---------------- Dividends (reinvested) ----------------
export function dividends() {
  const re = S.all('lots').filter((l) => l.kind === 'reinvest').map((l) => ({ ...l, amount: Math.round(l.shares * l.price * 100) }));
  const y1 = addDays(today(), -365), ttm = re.filter((l) => l.date > y1);
  const byTicker = Object.entries(groupBy(ttm, (l) => l.ticker)).map(([t, ls]) => {
    const pos = C.positionStats(t), last = sum(ls, (l) => l.amount);
    const half = addDays(today(), -182), sharesThen = sum(S.all('lots').filter((l) => l.ticker === t && l.date <= half), (l) => l.shares);
    const scale = sharesThen > 0 ? Math.min(3, Math.max(1, pos.shares / sharesThen)) : 1;
    return { ticker: t, ttm: last, count: ls.length, forward: Math.round(last * scale), yoc: pos.cost ? last / pos.cost : null, yieldNow: pos.value ? last / pos.value : null };
  }).sort((a, b) => b.ttm - a.ttm);
  const months = []; for (let i = 23; i >= 0; i--) { const m = addMonths(thisMonth(), -i); months.push({ m, amount: sum(re.filter((l) => ym(l.date) === m), (l) => l.amount) }); }
  const byYear = Object.entries(groupBy(re, (l) => l.date.slice(0, 4))).map(([y, ls]) => ({ y, amount: sum(ls, (l) => l.amount) })).sort((a, b) => b.y.localeCompare(a.y));
  return { ttm: sum(ttm, (l) => l.amount), forward: sum(byTicker, (x) => x.forward), byTicker, months, byYear, total: sum(re, (l) => l.amount) };
}

// ---------------- Allocation: classes, targets, sectors ----------------
export const CLASSES = ['US stock funds', 'International', 'Individual stocks', 'Bonds', 'Other'];
export const targets = () => ({ 'US stock funds': 60, International: 25, 'Individual stocks': 15, Bonds: 0, Other: 0, ...S.setting('targets', {}) });
const isUS = (h) => { if (!h.ticker || !/^[A-Z][A-Z.]{0,6}$/.test(h.ticker)) return false; const s = M.sectorOf(h.ticker); return !s || !s[1] || s[1] === 'United States'; };
export function allocationClasses() {
  const by = Object.fromEntries(CLASSES.map((c) => [c, 0]));
  for (const p of C.exposurePositions()) {
    const nm = `${p.sec?.name || ''} ${p.label || ''}`;
    if (p.kind === 'stock') by['Individual stocks'] += p.value;
    else if (p.kind === 'fund') {
      const hs = p.fund.holdings, cov = sum(hs, (x) => x.weight) || 1, us = sum(hs.filter(isUS), (x) => x.weight) / cov;
      by['US stock funds'] += p.value * us; by.International += p.value * (1 - us);
    } else if (/bond|income|treasury|fixed/i.test(nm)) by.Bonds += p.value;
    else if (/target|trgt|retire|20[3-7]\d/i.test(nm)) { by['US stock funds'] += p.value * 0.55; by.International += p.value * 0.35; by.Bonds += p.value * 0.1; }
    else if (/international|intl|world|ex.?us|emerging/i.test(nm)) by.International += p.value;
    else by['US stock funds'] += p.value;
  }
  const total = sum(Object.values(by)), t = targets();
  const rows = CLASSES.map((c) => ({ cls: c, value: Math.round(by[c]), share: total ? by[c] / total : 0, target: (t[c] || 0) / 100 }));
  return { rows, total };
}
// Where the next deposit should go to move closest to the targets without selling anything.
export function nextDeposit(amount) {
  const { rows, total } = allocationClasses(), after = total + amount;
  const need = rows.map((r) => ({ ...r, gap: Math.max(0, r.target * after - r.value) })), gaps = sum(need, (r) => r.gap);
  return need.filter((r) => r.gap > 0).map((r) => ({ cls: r.cls, amount: Math.round(gaps ? amount * (r.gap / gaps) : 0) })).filter((r) => r.amount > 0);
}
export function sectorBreakdown() {
  const lt = C.lookThrough(), by = {}, geo = { 'United States': 0, International: 0 };
  for (const r of lt.rows) {
    const s = r.ticker ? M.sectorOf(r.ticker) : null;
    const sector = s?.[0] || (r.ticker && /^[A-Z]/.test(r.ticker) ? 'Unclassified' : 'International (not classified)');
    by[sector] = (by[sector] || 0) + r.total;
    geo[s ? (s[1] === 'United States' || !s[1] ? 'United States' : 'International') : r.ticker ? 'United States' : 'International'] += r.total;
  }
  const covered = sum(Object.values(by));
  return { sectors: Object.entries(by).map(([sector, value]) => ({ sector, value, share: covered ? value / covered : 0 })).sort((a, b) => b.value - a.value), geo, covered, other: lt.other, total: lt.total };
}

// ---------------- Taxes: lots in taxable accounts (first-in, first-out) ----------------
export const taxableAccts = () => S.all('accounts').filter((a) => a.isInvestment && !/roth|ira|401|hsa/i.test(a.type));
export function taxLots() {
  const ids = new Set(taxableAccts().map((a) => a.id)), open = [], realized = [];
  const lots = S.all('lots').filter((l) => ids.has(l.acctId)).sort((a, b) => a.date.localeCompare(b.date));
  const q = {};
  for (const l of lots) {
    const k = l.acctId + '|' + l.ticker; q[k] ||= [];
    if (l.shares > 0) { q[k].push({ ...l, left: l.shares }); continue; }
    let n = -l.shares;
    while (n > 1e-9 && q[k].length) {
      const b = q[k][0], take = Math.min(n, b.left);
      realized.push({ ticker: l.ticker, date: l.date, bought: b.date, shares: take, gain: Math.round(take * (l.price - b.price) * 100), long: daysBetween(b.date, l.date) > 365 });
      b.left -= take; n -= take; if (b.left < 1e-9) q[k].shift();
    }
  }
  for (const k in q) for (const b of q[k]) {
    const last = (S.get('securities', b.ticker) || {}).last, held = daysBetween(b.date, today());
    open.push({ ...b, shares: b.left, cost: Math.round(b.left * b.price * 100), value: last != null ? Math.round(b.left * last * 100) : null,
      gain: last != null ? Math.round(b.left * (last - b.price) * 100) : null, long: held > 365, toLong: held > 365 ? 0 : 366 - held });
  }
  const y = today().slice(0, 4), ry = realized.filter((r) => r.date.startsWith(y));
  // A loss sale is a wash sale if the same ticker was bought within 30 days before or after, in any account (IRAs included).
  const recentBuy = (t) => S.all('lots').filter((l) => l.ticker === t && l.shares > 0 && Math.abs(daysBetween(l.date, today())) <= 30);
  const harvest = open.filter((o) => o.gain != null && o.gain < -2500).map((o) => ({ ...o, wash: recentBuy(o.ticker).length > 0 })).sort((a, b) => a.gain - b.gain);
  return { open: open.sort((a, b) => a.ticker.localeCompare(b.ticker) || a.date.localeCompare(b.date)), realized: ry, shortGain: sum(ry.filter((r) => !r.long), (r) => r.gain), longGain: sum(ry.filter((r) => r.long), (r) => r.gain),
    soonLong: open.filter((o) => !o.long && o.toLong <= 60 && (o.gain || 0) > 0).sort((a, b) => a.toLong - b.toLong), harvest };
}

// ---------------- Spending trends ----------------
export function trends(n = 12) {
  const months = []; for (let i = n - 1; i >= 0; i--) months.push(addMonths(thisMonth(), -i));
  const txns = S.all('txns').filter(C.isPersonal), cats = C.activeCats().filter((c) => c.countsAsSpending !== false);
  const rows = cats.map((c) => {
    const by = months.map((m) => sum(txns.filter((t) => t.catId === c.id && ym(t.date) === m), (t) => t.amount));
    const ly = months.map((m) => sum(txns.filter((t) => t.catId === c.id && ym(t.date) === addMonths(m, -12)), (t) => t.amount));
    return { c, by, ly, max: Math.max(...by), total: sum(by), budget: C.budgetFor(c.id, thisMonth()) };
  }).filter((r) => r.total || r.budget).sort((a, b) => b.total - a.total);
  const totals = months.map((_, i) => sum(rows, (r) => r.by[i])), lastYear = months.map((_, i) => sum(rows, (r) => r.ly[i]));
  return { months, rows, totals, lastYear };
}

// ---------------- Cash flow (next weeks) ----------------
export function cashflow(days = 45) {
  const end = addDays(today(), days), events = [];
  for (const r of recurring()) {
    if (r.lapsed) continue;
    for (let d = r.next, i = 0; d <= end && i < 60; d = addDays(d, r.every), i++) if (d >= today()) events.push({ date: d, kind: 'bill', name: r.name, amount: -r.amount, acctId: r.acctId });
  }
  const pays = S.all('income').filter((x) => x.source === 'paycheck').sort((a, b) => a.date.localeCompare(b.date)).slice(-6);
  if (pays.length >= 2) {
    const g = Math.round(median(pays.slice(1).map((p, i) => daysBetween(pays[i].date, p.date)))), last = pays.at(-1);
    const split = (S.setting('paycheck', {}).splits || []).find(([k]) => k === 'Checking')?.[1];
    for (let d = addDays(last.date, g), i = 0; d <= end && i < 40; d = addDays(d, g), i++) if (d >= today()) events.push({ date: d, kind: 'pay', name: 'Paycheck', amount: split || last.amount, toChecking: !!split });
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
  const chk = S.all('accounts').find((a) => a.type === 'checking' && !a.closed), snap = chk && C.latestSnapshot(chk.id);
  let bal = snap?.balance ?? null;
  for (const e of events) if (bal != null) { bal += e.amount; e.balance = bal; }
  return { events, start: snap?.balance ?? null, asOf: snap?.date, acct: chk?.name, low: events.reduce((a, e) => (e.balance != null && (a == null || e.balance < a.balance) ? e : a), null) };
}

// ---------------- Goals autopilot ----------------
export function goalPace(f) {
  const bal = C.fundBalance(f.id), since = addDays(today(), -91);
  const recent = sum(S.all('contributions').filter((c) => c.fundId === f.id && c.date > since && c.note !== 'Matched to bank balance'), (c) => c.amount) / 3;
  if (!f.target) return { bal, actual: Math.round(recent), need: null };
  const months = f.targetDate ? Math.max(1, monthsBetween(thisMonth(), ym(f.targetDate))) : null;
  const need = months ? Math.max(0, Math.round((f.target - bal) / months)) : null;
  const eta = recent > 0 ? addMonths(thisMonth(), Math.ceil(Math.max(0, f.target - bal) / recent)) : null;
  return { bal, actual: Math.round(recent), need, months, eta, done: bal >= f.target };
}

// ---------------- Data health ----------------
export function suggestedRules() {
  const ruled = (m) => S.all('rules').some((r) => m.includes(r.pattern));
  const by = groupBy(S.all('txns').filter((t) => t.merchant && t.catId && t.status !== 'review'), keyOf);
  return Object.entries(by).filter(([k, ts]) => k.length >= 3 && ts.length >= 3 && !ruled(String(ts[0].merchant).toUpperCase()))
    .map(([k, ts]) => { const c = groupBy(ts, (t) => t.catId), [catId, hits] = Object.entries(c).sort((a, b) => b[1].length - a[1].length)[0]; return { pattern: k, catId, hits: hits.length, of: ts.length }; })
    .filter((s) => s.hits / s.of >= 0.8).sort((a, b) => b.hits - a.hits).slice(0, 15);
}
export function health() {
  const issues = [], t = today();
  const held = C.holdings();
  const noPrice = held.filter((x) => x.sec.last == null).map((x) => x.ticker);
  if (noPrice.length) issues.push({ level: 'bad', title: 'Holdings with no price', detail: [...new Set(noPrice)].join(', '), href: '#invest' });
  const stale = [...new Set(held.filter((x) => x.sec.priceDate && daysBetween(x.sec.priceDate, t) > 6).map((x) => x.ticker))];
  if (stale.length) issues.push({ level: 'warn', title: 'Prices more than 6 days old', detail: stale.join(', '), href: '#invest' });
  const nw = C.netWorth();
  for (const r of nw.rows) if (r.gap && Math.abs(r.gap) > 5000) issues.push({ level: 'warn', title: `${r.acct.name}: holdings and balance differ`, detail: `${(r.gap / 100).toFixed(0)} dollars unexplained (missing trades, cash, or an old snapshot)`, href: '#networth' });
  for (const a of S.all('accounts').filter((x) => !x.closed && !x.isInvestment)) { const s = C.latestSnapshot(a.id); if (s && daysBetween(s.date, t) > 45) issues.push({ level: 'warn', title: `${a.name} balance is from ${s.date}`, detail: 'Add a snapshot so net worth stays current', href: '#networth' }); }
  const uncat = S.all('txns').filter((x) => x.status !== 'review' && !x.catId && !x.reimb).length;
  if (uncat) issues.push({ level: 'warn', title: `${uncat} transaction${uncat > 1 ? 's' : ''} without a category`, detail: 'They are left out of the budget', href: '#txns' });
  const inbox = C.inboxCount(); if (inbox) issues.push({ level: 'warn', title: `${inbox} imported row${inbox > 1 ? 's' : ''} to review`, detail: 'Waiting in the Inbox', href: '#inbox' });
  const lb = (() => { try { return localStorage.getItem('lastBackup'); } catch { return null; } })();
  if (!lb || daysBetween(lb, t) > 7) issues.push({ level: 'warn', title: lb ? `Last backup ${lb}` : 'No backup saved from this device yet', detail: 'Save one to iCloud Drive or Files', action: 'backup' });
  const k = C.k401(); if (k.asOf && daysBetween(k.asOf, t) > 120) issues.push({ level: 'warn', title: '401(k) statement is over a quarter old', detail: `Latest ends ${k.asOf}`, href: '#paystubs' });
  if (M.pricesData() && daysBetween(M.pricesData().asOf, t) > 5) issues.push({ level: 'warn', title: 'Market data is not updating', detail: `Last close ${M.pricesData().asOf}; check the Market data action on GitHub`, href: '' });
  return { issues, rules: suggestedRules() };
}
