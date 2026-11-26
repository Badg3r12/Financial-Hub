// One-time import of the old spreadsheets (downloaded from Google Sheets as .xlsx).
// Uses fixed ids, so importing again replaces rather than duplicates.
import * as S from '../store.js';
import { uid, normName, parseDate, MONTHS } from '../util.js';

const SKIP = /^(income|tax return|total expenditures|my expenditures|anticipated income|taxes)$/i;
const RENAME = { 'car maintenance/expenses': 'Car Maintenance', 'groceries (food)': 'Groceries' };
const ONE_OFF = { 'School Expenses/Supplies': ['2026-07', '2026-10'] }; // PE course and PE exam registration
const cents = (v) => { if (v === null || v === undefined || v === '') return null; if (typeof v === 'number') return Math.round(v * 100); const s = String(v).replace(/[$,\s]/g, ''); return s && !isNaN(+s) ? Math.round(+s * 100) : null; };

function monthYearDate(v) {
  if (typeof v === 'string') { const m = v.trim().match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{4})$/); if (m) { const i = MONTHS.findIndex((x) => x.startsWith(m[1])); if (i >= 0) return `${m[2]}-${String(i + 1).padStart(2, '0')}-01`; } }
  return parseDate(v);
}

export function importHistory(budgetWb, stockWb) {
  const report = { notes: [], counts: {} };
  const cats = S.all('categories'), accts = S.all('accounts');
  const catByName = (raw) => {
    let n = normName(raw); n = RENAME[n.toLowerCase()] || n;
    let c = cats.find((x) => x.name.toLowerCase() === n.toLowerCase());
    if (!c) { c = { id: uid(), name: n, group: 'Lifestyle', countsAsSpending: n !== 'Taxes', archived: true }; cats.push(c); report.notes.push(`New category from history (hidden from Quick add): ${n}`); }
    return c;
  };
  const acctByName = (n) => accts.find((a) => a.name.toLowerCase() === normName(n).toLowerCase());
  const checking = acctByName('JMCU Checking')?.id;
  const out = { categories: [], budgets: [], txns: [], income: [], snapshots: [], contributions: [], car: [], lots: [], securities: [] };

  if (budgetWb) {
    for (const [name, grid] of Object.entries(budgetWb)) {
      const ym = name.match(/^Budget (\d{4})$/); if (!ym) continue;
      const year = +ym[1], head = grid[0] || [];
      const mcol = MONTHS.map((m) => head.findIndex((x) => String(x || '').trim().toLowerCase().startsWith(m.toLowerCase())));
      let payer = 'me', seenCategory = false;
      for (const row of grid.slice(1)) {
        const label = normName(row?.[0]);
        const vals = mcol.map((c) => (c >= 0 ? cents(row?.[c]) : null));
        const any = vals.some((v) => v) || cents(row?.[1]);
        if (!label && !any) { if (seenCategory) payer = 'shared'; continue; }
        if (/not paid by me/i.test(label)) { payer = 'shared'; continue; }
        if (!any) continue; // label-only rows like "School Expenses" (2026) or "Canoe" (2025)
        if (/^(income|tax return)$/i.test(label)) {
          vals.forEach((v, i) => v && out.income.push({ id: `h-inc-${year}-${i + 1}-${label[0]}`, date: `${year}-${String(i + 1).padStart(2, '0')}-15`, amount: v, source: /tax/i.test(label) ? 'tax refund' : 'other', note: 'Imported monthly total' }));
          continue;
        }
        if (SKIP.test(label) && !/^taxes$/i.test(label)) continue;
        const c = /^taxes$/i.test(label) ? catByName('Taxes') : catByName(label);
        if (payer === 'me') seenCategory = true;
        const annual = cents(row?.[1]), monthly = cents(row?.[2]);
        if (annual) out.budgets.push({ id: `${year}-${c.id}-${payer}`, year, catId: c.id, payer, annual,
          monthly: year >= 2027 && monthly && Math.abs(monthly - Math.round(annual / 12)) > 1 ? monthly : null });
        vals.forEach((v, i) => {
          if (!v) return; const m = `${year}-${String(i + 1).padStart(2, '0')}`;
          out.txns.push({ id: `h-${m}-${c.id}-${payer}`, date: `${m}-15`, amount: v, catId: c.id, acctId: checking, payer, origin: 'imported', status: 'ok',
            note: 'Imported monthly total', oneOff: (ONE_OFF[c.name] || []).includes(m) });
        });
      }
    }
    // Net Worth snapshots
    const nw = budgetWb['Net Worth'];
    if (nw) {
      const hi = nw.findIndex((r) => (r || []).some((c) => String(c ?? '').trim() === 'Date'));
      const head = nw[hi] || [], dateCol = head.findIndex((c) => String(c ?? '').trim() === 'Date');
      for (const row of nw.slice(hi + 1)) {
        const date = monthYearDate(row?.[dateCol]); if (!date) continue;
        head.forEach((hd, i) => {
          if (i <= dateCol || !hd || /total/i.test(hd)) return; const a = acctByName(hd); const v = cents(row[i]);
          if (!a) { if (v) report.notes.push(`Net Worth column "${hd}" has no matching account; skipped.`); return; }
          if (v !== null && (v || row.slice(dateCol + 1).some((x) => cents(x)))) out.snapshots.push({ id: `${date}-${a.id}`, date, acctId: a.id, balance: v, source: 'sheet' });
        });
      }
    }
    // Sinking-fund contributions
    const pa = Object.entries(budgetWb).find(([n]) => /^Paycheck Allocations/i.test(n))?.[1];
    if (pa) {
      const hr = pa.findIndex((r) => (r || []).some((c, i) => c === 'Date' && r[i + 1] === 'Contribution'));
      const funds = S.all('funds');
      if (hr >= 0) pa[hr].forEach((c, col) => {
        if (c !== 'Date' || pa[hr][col + 1] !== 'Contribution') return;
        // The goal's name is the text above its Date column, skipping the "Total" label and money cells.
        const fname = normName(pa.slice(0, hr).map((r) => r?.[col]).filter((v) => typeof v === 'string' && v.trim() && !/^total$/i.test(v.trim()) && !/^\$?[\d,.]+$/.test(v.trim())).at(-1));
        if (!fname || /roth ira/i.test(fname)) return; // the empty "Roth IRA" goal was removed
        const BUCKET = { 'car replacement': 'car', travel: 'vacation', 'camera toys': 'camera' }; // sheet name → Capital One bucket name
        const want = BUCKET[fname.toLowerCase()] || fname.toLowerCase();
        let f = funds.find((x) => x.name.toLowerCase() === want);
        if (!f) { f = { id: uid(), name: fname, target: null, targetDate: null }; funds.push(f); S.put('funds', f); }
        pa.slice(hr + 1).forEach((r, i) => { const d = parseDate(r?.[col]), a = cents(r?.[col + 1]); if (d && a) out.contributions.push({ id: `h-fc-${f.id}-${d}-${i}`, fundId: f.id, date: d, amount: a, note: 'From spreadsheet' }); });
      });
    }
    // Car log (fixes an entry dated a year early: later mileage but an earlier date)
    const car = Object.entries(budgetWb).find(([n]) => /^Car Mainten/i.test(n))?.[1];
    if (car) {
      let prev = null;
      car.slice(1).forEach((r, i) => {
        let d = parseDate(r?.[0]); const miles = parseInt(r?.[1]) || 0; if (!d) return;
        if (prev && d < prev.date && miles > prev.miles) { while (d < prev.date) d = `${+d.slice(0, 4) + 1}${d.slice(4)}`; report.notes.push(`Car log: ${normName(r[2])} at ${miles.toLocaleString()} mi re-dated to ${d}.`); }
        const doc = { id: `h-car-${i}`, date: d, miles, desc: normName(r?.[2]), cost: null }; out.car.push(doc); prev = doc;
      });
    }
    out.categories = cats;
  }

  if (stockWb) {
    const tabs = { 'Roth IRA Purchases': 'Roth IRA', 'Roth 401k Purchases': 'Roth 401k', 'Brokerage Purchases': 'Vanguard Brokerage' };
    let reinvest = 0;
    for (const [tab, an] of Object.entries(tabs)) {
      const grid = stockWb[tab], a = acctByName(an); if (!grid || !a) continue;
      grid.slice(1).forEach((r, i) => {
        const date = parseDate(r?.[0]), ticker = normName(r?.[1]).toUpperCase(), shares = parseFloat(String(r?.[2] ?? '').replace(/,/g, '')), price = cents(r?.[3]) / 100;
        if (!date || !ticker || !shares || !price) return;
        const kind = shares * price < 30 && shares % 1 !== 0 ? 'reinvest' : 'buy'; if (kind === 'reinvest') reinvest++;
        out.lots.push({ id: `h-lot-${a.id}-${i}`, acctId: a.id, date, ticker, shares, price, kind, origin: 'sheet' });
      });
    }
    report.notes.push(`${reinvest} purchases tagged as dividend reinvestments (under $30 with fractional shares).`);
    const st = stockWb['Stock Tracker'] || [];
    let head = null;
    for (const r of st) {
      const cells = (r || []).map((c) => (typeof c === 'string' ? c.trim() : c));
      if (cells.includes('Ticker') && cells.includes('Current Price')) { head = cells; continue; }
      if (!head) continue;
      const g = (n) => cells[head.indexOf(n)];
      const t = String(g('Ticker') ?? '').trim().toUpperCase();
      if (!t || t === 'TOTAL' || !/^[A-Z.]{1,6}$/.test(t)) continue;
      const num = (v) => (typeof v === 'number' ? v : cents(v) / 100);
      out.securities.push({ id: t, name: g('Ticker Name') || t, type: g('Type') || g('Asset Class') || 'Other', last: num(g('Current Price')), prior: num(g('Prior Day Price')), priceDate: new Date().toLocaleDateString('en-CA') });
    }
  }
  for (const k of Object.keys(out)) report.counts[k] = out[k].length;
  return { out, report };
}

export async function commitHistory(out) {
  for (const [c, docs] of Object.entries(out)) if (docs.length) await S.putMany(c, docs, { silent: true });
  await S.putMany('settings', [{ id: 'historyImported', value: new Date().toISOString() }]);
}
