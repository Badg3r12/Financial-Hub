// Import screen: old spreadsheets (one time), bank/card statements, Vanguard files.
import * as S from '../store.js';
import { h, raw, money, fid, today, shortDate } from '../util.js';
import * as C from '../calc.js';
import { options, toast, busy } from '../ui.js';
import { readXlsx } from '../import/xlsx.js';
import { importHistory, commitHistory } from '../import/history.js';
import { parseBankCSV, parseOFX, classify, emailMatcher } from '../import/bank.js';
import { parseVanguard, vanguardLots, isSettlement } from '../import/vanguard.js';

let pending = null; // preview waiting for confirmation

function lastImport(acctId) { return S.all('imports').filter((i) => i.acctId === acctId).sort((a, b) => b.date.localeCompare(a.date))[0]; }

function render() {
  const bankAccts = S.all('accounts').filter((a) => !a.isInvestment && !a.closed && !/cash$/i.test(a.type)), inv = S.all('accounts').filter((a) => (a.isInvestment || /cash plus/i.test(a.name)) && a.type !== 'Roth 401k'); // the 401(k) is with Ekon Benefits, not Vanguard
  return h`<h1>Import</h1>
  <div class="grid cols-2">
  <div class="card stack"><h2>Bank or card statement</h2>
    <p class="small muted">CSV, OFX or QFX from your bank's website. Rows go to the Inbox for review. Account and card number columns are thrown away when the file is read.</p>
    <label>Account<select id="st-acct">${options(bankAccts.map((a) => [a.id, a.name + (lastImport(a.id) ? ` (last ${shortDate(lastImport(a.id).date)})` : '')]))}</select></label>
    <label>File<input type="file" id="st-file" accept=".csv,.ofx,.qfx,.pdf"></label>
    <p class="small muted">PDF statements from JMCU, the Discover it card and Discover savings are recognized automatically and go to the right accounts (the account picker is only used for CSV and OFX). Ending balances become net-worth snapshots.</p></div>
  <div class="card stack"><h2>Vanguard file</h2>
    <p class="small muted">On vanguard.com: Transaction history → Download → spreadsheet-compatible CSV. <b>Select one account per download</b> so rows can be assigned without reading account numbers. Any file can still update prices.</p>
    <label>Account<select id="vg-acct">${options(inv.map((a) => [a.id, a.name]))}</select></label>
    <label>File<input type="file" id="vg-file" accept=".csv,text/csv"></label></div>
  <div class="card stack"><h2>Paystubs and 401(k) statements</h2>
    <p class="small muted">PDFs from Ajera (paystubs) and Ekon Benefits (quarterly Roth 401(k) statements). Choose several at once; each is read on this device and sorted automatically. You can also drop them in the bank statement box above.</p>
    <label class="btn btn-primary">Choose PDFs<input type="file" id="pk-files" accept=".pdf,.png,.jpg,.jpeg,.heic" multiple hidden></label></div>
  <div class="card stack"><h2>History from the spreadsheets</h2>
    <p class="small muted">One time. In Google Sheets: File → Download → Microsoft Excel (.xlsx), for Budget and for Stock_Tracker. Importing again replaces the earlier import.${S.setting('historyImported', null) ? ` Last imported ${shortDate(S.setting('historyImported').slice(0, 10))}.` : ''}</p>
    <label>Budget.xlsx<input type="file" id="hx-budget" accept=".xlsx"></label>
    <label>Stock_Tracker.xlsx<input type="file" id="hx-stock" accept=".xlsx"></label>
    <button class="primary" id="hx-go">Read files</button></div>
  </div>
  <div id="preview" style="margin-top:14px"></div>`;
}

function showPreview(html, onCommit, label = 'Import') {
  const el = document.getElementById('preview');
  el.innerHTML = h`<div class="card stack">${html}<div class="row"><button class="primary" id="pv-go">${label}</button><button id="pv-cancel">Cancel</button></div></div>`.__raw;
  el.querySelector('#pv-cancel').onclick = () => { el.innerHTML = ''; pending = null; };
  el.querySelector('#pv-go').onclick = async () => { el.querySelector('#pv-go').disabled = true; try { await busy('Saving', onCommit, 'Saved'); el.innerHTML = ''; } catch (e) { alert(e.message); el.querySelector('#pv-go').disabled = false; } };
  el.scrollIntoView({ behavior: 'smooth' });
}

const byName = (n) => S.all('accounts').find((a) => a.name === n);

// Paystub and 401(k) PDFs are read on the Paystubs & 401k screen, which shows progress and the results.
async function toPaystubs(files) {
  location.hash = '#paystubs';
  await new Promise((r) => setTimeout(r, 150));
  (await import('./more.js')).readFiles(files, 'auto');
}

// PDF statements pick their own accounts: JMCU (savings + checking), the Discover it card, Discover savings.
async function readPdfStatement(file) {
  const P = await import('../import/pdf.js'), pages = await P.pdfLines(file), type = P.detect(pages);
  if (type === 'jmcu') {
    const j = P.parseJMCU(pages), groups = [], snaps = [];
    for (const [sec, s] of Object.entries(j.sections)) {
      const a = byName(sec === 'savings' ? 'JMCU Savings' : 'JMCU Checking'); if (!a) continue;
      groups.push({ acctId: a.id, rows: s.rows.map((r) => ({ date: r.date, desc: r.merchant, outflow: -r.amount })) });
      if (s.end != null) snaps.push({ acctId: a.id, date: s.endDate, balance: s.end });
    }
    return { label: 'JMCU member statement', groups, snaps };
  }
  if (type === 'card') { const c = P.parseCard(pages), a = byName('Discover it card'); return { label: 'Discover it card statement', groups: [{ acctId: a.id, rows: c.rows }], snaps: c.end != null ? [{ acctId: a.id, date: c.endDate, balance: c.end }] : [] }; }
  if (type === 'discoverBank') { const d = P.parseDiscoverBank(pages), a = byName('Discover Savings'); return { label: 'Discover savings statement (balance only)', groups: [], snaps: d.end != null ? [{ acctId: a.id, date: d.endDate, balance: d.end }] : [] }; }
  return null; // not a bank layout: likely a paystub or 401(k) statement (image-only or scrambled text)
}

async function statement(file, acctId) {
  let groups, snaps = [], label;
  if (/\.pdf$/i.test(file.name)) {
    const r = await readPdfStatement(file);
    if (!r) { toPaystubs([file]); return 'handed-off'; } // the paystub/401(k) reader shows its own progress
    ({ groups, snaps, label } = r);
  }
  else {
    const a = C.acct(acctId), text = await file.text();
    const parsed = /\.(ofx|qfx)$/i.test(file.name) || /<OFX>/i.test(text) ? parseOFX(text) : parseBankCSV(text, { isCard: !!a.isLiability });
    groups = [{ acctId, rows: parsed.rows }]; label = `format: ${parsed.layout}`;
  }
  const known = new Set([...S.all('txns'), ...S.all('income'), ...S.all('transfers'), ...S.all('imports')].map((x) => x.fid).filter(Boolean));
  const fromEmail = emailMatcher({ txns: S.all('txns'), transfers: S.all('transfers'), income: S.all('income') });
  const fresh = [], cutoff = S.setting('historyCutoff', null); let total = 0, early = 0, emailed = 0;
  for (const g of groups) {
    const isCard = !!C.acct(g.acctId).isLiability, seen = {};
    for (const r of g.rows) {
      total++;
      if (cutoff && r.date <= cutoff) { early++; continue; } // already counted in the spreadsheet history
      const base = r.fitid ? fid(g.acctId, r.fitid) : fid(g.acctId, r.date, r.outflow, r.desc);
      const k = base + '#' + (seen[base] = (seen[base] || 0) + 1);
      if (known.has(k)) continue;
      if (fromEmail(g.acctId, r.date, r.outflow)) { emailed++; continue; } // already in from an alert email
      fresh.push({ id: 'st-' + crypto.randomUUID(), date: r.date, amount: r.outflow, merchant: r.desc, hint: r.hint, acctId: g.acctId, payer: 'me', origin: 'statement', status: 'review', kind: classify(r, isCard), fid: k, importFile: file.name });
    }
  }
  const dates = groups.flatMap((g) => g.rows.map((r) => r.date)).sort();
  showPreview(h`<h2>${file.name}</h2><p>${label}. ${total} rows${dates[0] ? ` (${shortDate(dates[0])} – ${shortDate(dates.at(-1))})` : ''}: <b>${fresh.length} new</b>, ${total - fresh.length - early - emailed} already imported${emailed ? `, ${emailed} already in from alert emails` : ''}${early ? h`, <b>${early} skipped</b> because they're on or before ${shortDate(cutoff)}, which your spreadsheet history already covers` : ''}.</p>
    ${groups.length > 1 ? h`<p class="small">${groups.map((g) => `${C.acct(g.acctId).name}: ${g.rows.length}`).join(' · ')}</p>` : ''}
    ${snaps.length ? h`<p class="small">Ending balances saved as snapshots: ${snaps.map((s) => `${C.acct(s.acctId).name} ${money(s.balance)} on ${shortDate(s.date)}`).join(' · ')}</p>` : ''}
    <p class="small muted">${fresh.filter((x) => x.kind === 'transfer').length} look like transfers or card payments, ${fresh.filter((x) => x.kind === 'income').length} like income. You can change any of them in the Inbox.</p>`,
    async () => {
      await S.putMany('txns', fresh);
      await S.putMany('snapshots', snaps.map((s) => ({ id: `${s.date}-${s.acctId}`, ...s, source: 'statement' })));
      for (const g of groups) await S.put('imports', { kind: 'statement', acctId: g.acctId, date: today(), file: file.name, count: fresh.filter((x) => x.acctId === g.acctId).length });
      location.hash = fresh.length ? '#inbox' : '#networth';
    }, fresh.length ? `Send ${fresh.length} to Inbox` : 'Save balances');
}

async function vanguard(file, acctId) {
  const p = parseVanguard(await file.text()), lots = vanguardLots(p).filter((l) => C.acct(acctId).type === 'Roth 401k' ? l.plan : !l.plan);
  const blocks = p.holdings.length + (p.planHoldings.length ? 1 : 0);
  const multi = p.holdings.length > 1 || (p.holdings.length && p.planHoldings.length);
  // Prices from the holdings sections (account-agnostic)
  const prices = {};
  for (const b of p.holdings) for (const x of b) if (x.symbol && !isSettlement(x.symbol, x.name) && x.price) prices[x.symbol] = { name: x.name, price: x.price };
  for (const x of p.planHoldings) if (x.price) prices[vanguardLots({ txns: [], planTxns: [{ name: x.name, shares: 1, price: 1 }] })[0].ticker] = { name: x.name, price: x.price };
  const existing = S.all('lots').filter((l) => l.acctId === acctId);
  const isDup = (l) => existing.some((e) => e.ticker === l.ticker && e.date === l.date && Math.abs(e.shares - l.shares) < 0.002);
  const newLots = multi ? [] : lots.filter((l) => !isDup(l));
  // Share check: file holdings vs app after import
  let check = [];
  if (!multi) {
    const fileHold = {}; for (const x of (p.holdings[0] || [])) if (x.symbol && !isSettlement(x.symbol, x.name)) fileHold[x.symbol] = x.shares;
    for (const x of p.planHoldings) fileHold[vanguardLots({ txns: [], planTxns: [{ name: x.name, shares: 1, price: 1 }] })[0].ticker] = x.shares;
    const app = {}; for (const l of [...existing, ...newLots]) app[l.ticker] = (app[l.ticker] || 0) + l.shares;
    check = [...new Set([...Object.keys(fileHold), ...Object.keys(app)])].map((t) => ({ t, file: fileHold[t] ?? 0, app: app[t] ?? 0 })).filter((x) => Math.abs(x.file - x.app) > 0.002);
  }
  showPreview(h`<h2>${file.name}</h2>
    ${multi ? h`<p class="notice warn">This file covers ${blocks} accounts. To keep account numbers out of the app, transactions can only be imported from a file with one account selected. Prices from this file can still be updated.</p>`
      : h`<p><b>${newLots.length} new</b> buys, sells and reinvestments for ${C.acct(acctId).name}; ${lots.length - newLots.length} already in the app.</p>
      ${check.length ? h`<p class="warn">Share differences after import (file vs app):</p><ul class="small">${check.map((x) => h`<li>${x.t}: Vanguard ${x.file.toFixed(4)}, app ${x.app.toFixed(4)}</li>`)}</ul><p class="small muted">Usually a buy logged in the wrong account or missing from the history. Fix it under Invest.</p>`
        : h`<p class="good">Shares match Vanguard for every holding.</p>`}`}
    <p class="small muted">${Object.keys(prices).length} prices in the file will be updated.</p>`,
    async () => {
      const t = today();
      await S.putMany('securities', Object.entries(prices).map(([id, v]) => { const s = S.get('securities', id) || { id, name: v.name, type: id.startsWith('PLAN-') ? 'Mutual Fund' : 'Stock' }; return { ...s, prior: s.priceDate === t ? s.prior : (s.last ?? v.price), last: v.price, priceDate: t }; }));
      if (newLots.length) await S.putMany('lots', newLots.map((l) => ({ acctId, date: l.date, ticker: l.ticker, shares: l.shares, price: l.price, kind: l.kind, origin: 'vanguard' })));
      await S.put('imports', { kind: 'vanguard', acctId, date: t, file: file.name, count: newLots.length });
      toast(`Imported ${newLots.length} lots and ${Object.keys(prices).length} prices`); location.hash = '#invest';
    }, multi ? 'Update prices only' : 'Import');
}

async function history(root) {
  const b = root.querySelector('#hx-budget').files[0], s = root.querySelector('#hx-stock').files[0];
  if (!b && !s) return toast('Choose at least one .xlsx file');
  const [bw, sw] = await Promise.all([b ? readXlsx(b) : null, s ? readXlsx(s) : null]);
  const { out, report } = importHistory(bw, sw);
  showPreview(h`<h2>History import</h2><ul class="small">${Object.entries(report.counts).filter(([, n]) => n).map(([k, n]) => h`<li>${n} ${k}</li>`)}</ul>
    ${report.notes.length ? h`<h3>Please check</h3><ul class="small">${report.notes.map((n) => h`<li>${n}</li>`)}</ul>` : ''}`,
    async () => { await commitHistory(out); toast('History imported'); location.hash = '#home'; location.reload(); }, 'Import history');
}

function mount(root) {
  // Every file read shows the progress panel; the input is cleared so choosing the same file again works.
  const pick = (sel, label, fn) => root.querySelector(sel).onchange = (e) => {
    const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
    busy(label, () => fn(files), (r) => (r === 'handed-off' ? undefined : 'Ready to review below')).catch((err) => alert(err.message));
  };
  pick('#st-file', 'Reading statement', (f) => statement(f[0], root.querySelector('#st-acct').value));
  pick('#vg-file', 'Reading Vanguard file', (f) => vanguard(f[0], root.querySelector('#vg-acct').value));
  root.querySelector('#pk-files').onchange = (e) => { const files = [...e.target.files]; e.target.value = ''; if (files.length) toPaystubs(files); };
  root.querySelector('#hx-go').onclick = () => busy('Reading spreadsheets', () => history(root), 'Ready to review below').catch((err) => alert(err.message));
}
export const views = { import: { render, mount } };
