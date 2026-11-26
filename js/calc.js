// Every figure the app shows is calculated here from records; nothing is stored as a total.
import * as S from './store.js';
import { ym, sum, addMonths, monthsBetween, thisMonth, today } from './util.js';

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
export function k401() {
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
