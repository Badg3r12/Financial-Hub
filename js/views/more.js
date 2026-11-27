import * as S from '../store.js';
import { h, raw, money, money0, signed, today, shortDate, toCents, sum, uid } from '../util.js';
import * as C from '../calc.js';
import { line } from '../charts.js';
import { openSheet, closeSheet, toast, options, formData, progress, busy } from '../ui.js';
import { parsePaystub, checkPaystub, PAYSTUB_FIELDS } from '../import/paystub.js';
import * as sync from '../sync.js';

function render() {
  const links = [['networth', 'Net worth', 'Snapshots, account breakdown, unexplained differences'], ['paystubs', 'Paystubs & 401k', 'Income, taxes, Roth 401k and match'],
    ['inbox', 'Inbox', 'Imported rows waiting for review'], ['import', 'Import', 'Statements, Vanguard files, history from the spreadsheets'],
    ['shared', 'Shared costs', 'College-era costs not paid by you'], ['car', 'Car log', 'Service history and next oil change'], ['settings', 'Settings', 'Backup, categories, accounts, theme']];
  return h`<h1>More</h1><div class="card"><ul class="list">${links.map(([k, t, d]) => h`<li class="menu-row"><a href="#${k}" style="text-decoration:none;color:inherit;display:flex;align-items:center;width:100%;min-height:44px"><span class="grow"><b>${t}</b><div class="small muted">${d}</div></span><span class="muted" aria-hidden="true" style="font-size:20px">›</span></a></li>`)}</ul></div>`;
}

// ---- Net worth ----
function networth() {
  const nw = C.netWorth(), hist = C.netWorthHistory();
  return h`<div class="row between wrap"><h1>Net worth</h1><button class="primary" id="nw-add">Add snapshot</button></div>
  <div class="grid cols-3" style="margin-bottom:14px"><div class="card"><h3>Calculated</h3><div class="big num">${money0(nw.total)}</div><div class="small muted">Investments at current prices</div></div>
    <div class="card"><h3>Including unexplained</h3><div class="big num">${money0(nw.withGaps)}</div><div class="small muted">Matches your latest snapshots</div></div></div>
  <div class="card" style="margin-bottom:14px"><h3>Snapshot history</h3>${line(hist.map((p) => ({ x: p.date, y: p.total })), { label: (p) => shortDate(p.x) })}</div>
  <div class="card scroll-x"><table><thead><tr><th>Account</th><th>Latest snapshot</th><th>Calculated</th><th>Unexplained</th></tr></thead><tbody>
  ${nw.rows.map((r) => h`<tr><td>${r.acct.name}</td><td class="num">${r.snap ? money(r.snap.balance) : '—'} <span class="small muted">${r.snap ? shortDate(r.snap.date) : ''}</span></td>
    <td class="num">${r.calc == null ? '' : money(r.calc)}</td><td class="num ${r.gap ? 'warn' : ''}">${r.gap ? signed(r.gap) : ''}</td></tr>`)}
  <tr><td><b>Total</b></td><td></td><td class="num"><b>${money(nw.total)}</b></td><td class="num"><b>${nw.gaps ? signed(nw.gaps) : ''}</b></td></tr></tbody></table>
  <p class="small muted">"Unexplained" is the latest snapshot minus the value of logged lots. It closes as missing buys, cash or 401k contributions are imported.</p></div>`;
}
function mountNetworth(root) {
  root.querySelector('#nw-add').onclick = () => {
    const accts = S.all('accounts').filter((a) => !a.closed);
    openSheet(h`<h2>Add snapshot</h2><form class="form" id="sf"><label>Date<input type="date" name="date" value="${today()}"></label>
      ${accts.map((a) => h`<label>${a.name}${a.isLiability ? ' (amount owed)' : ''}<input name="a-${a.id}" inputmode="decimal" placeholder="${C.latestSnapshot(a.id) ? (C.latestSnapshot(a.id).balance / 100).toFixed(2) : ''}"></label>`)}
      <p class="small muted">Leave blank to skip an account.</p><p class="form-error" id="sf-err" role="alert"></p><div class="row between"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div></form>`, (r) => {
      r.querySelector('#sf').onsubmit = async (e) => {
        e.preventDefault(); const d = formData(e.target), bad = [];
        for (const a of accts) { const v = String(d['a-' + a.id] || '').trim(), inp = r.querySelector(`[name="a-${a.id}"]`), ok = !v || toCents(v) !== null; inp.style.borderColor = ok ? '' : 'var(--bad)'; if (!ok) bad.push(a.name); }
        if (bad.length) { r.querySelector('#sf-err').textContent = `Check ${bad.join(', ')}: use a number like 1250.00.`; return; }
        const docs = accts.filter((a) => String(d['a-' + a.id] || '').trim()).map((a) => ({ id: `${d.date}-${a.id}`, date: d.date, acctId: a.id, balance: toCents(d['a-' + a.id]), source: 'typed' }));
        if (!docs.length) { r.querySelector('#sf-err').textContent = 'Enter at least one balance.'; return; }
        await S.putMany('snapshots', docs); closeSheet(); toast(`Saved ${docs.length} balance${docs.length > 1 ? 's' : ''}`);
      };
    });
  };
}

// ---- Car log ----
function car() {
  const log = S.all('car').sort((a, b) => b.date.localeCompare(a.date)), prefs = S.setting('prefs');
  const lastOil = log.find((x) => /oil/i.test(x.desc)), cur = Math.max(0, ...log.map((x) => x.miles || 0));
  return h`<div class="row between"><h1>Car log</h1><button class="primary" id="car-add">Add service</button></div>
  <div class="grid cols-3" style="margin-bottom:14px"><div class="card"><h3>Current mileage</h3><div class="big num">${cur.toLocaleString()}</div></div>
    <div class="card"><h3>Next oil change</h3><div class="big num">${lastOil ? (lastOil.miles + (prefs.oilInterval || 5000)).toLocaleString() : '—'}</div><div class="small muted">Every ${(prefs.oilInterval || 5000).toLocaleString()} miles (<a href="#settings">change in Settings</a>)</div></div></div>
  <div class="card"><ul class="list">${log.map((x) => h`<li class="tap" data-car="${x.id}"><div class="grow">${x.desc}<div class="small muted">${shortDate(x.date)} · ${(x.miles || 0).toLocaleString()} mi</div></div><span class="num">${x.cost ? money(x.cost) : ''}</span></li>`)}</ul>${log.length ? '' : h`<p class="muted">No service records yet. Choose Add service after an oil change or repair.</p>`}</div>`;
}
function mountCar(root) {
  const edit = (x = { date: today(), miles: '', desc: '', cost: null }) => openSheet(h`<div class="row between"><h2>${x.id ? 'Edit service' : 'Add service'}</h2><button class="link" data-close>Close</button></div><form class="form" id="cf">
    <div class="two"><label>Date<input type="date" name="date" value="${x.date}" required></label><label>Mileage<input name="miles" inputmode="numeric" value="${x.miles}"></label></div>
    <label>What was done<input name="desc" value="${x.desc}" required placeholder="Oil change"></label><label>Cost<input name="cost" inputmode="decimal" value="${x.cost ? x.cost / 100 : ''}"></label>
    <div class="row between">${x.id ? h`<button type="button" class="danger" id="cdel">Delete</button>` : h`<button type="button" data-close>Cancel</button>`}<button class="primary">Save</button></div></form>`, (r) => {
    r.querySelector('#cdel')?.addEventListener('click', async () => { if (!confirm(`Delete "${x.desc}" from ${shortDate(x.date)}?`)) return; await S.remove('car', x.id); closeSheet(); toast('Service deleted', { action: 'Undo', onAction: () => S.put('car', x) }); });
    r.querySelector('#cf').onsubmit = async (e) => { e.preventDefault(); const d = formData(e.target); await S.put('car', { ...x, date: d.date, miles: parseInt(String(d.miles).replace(/[,\s]/g, '')) || 0, desc: d.desc.trim(), cost: toCents(d.cost) }); closeSheet(); toast('Service saved'); };
  });
  root.querySelector('#car-add').onclick = () => edit();
  root.querySelectorAll('[data-car]').forEach((el) => el.onclick = () => edit(S.get('car', el.dataset.car)));
}

// ---- Paystubs ----
function paystubs() {
  const list = S.all('paystubs').sort((a, b) => b.payDate.localeCompare(a.payDate)), y = today().slice(0, 4);
  const ytd = list.filter((p) => p.payDate.startsWith(y)), s = (k) => sum(ytd, (p) => p[k] || 0);
  const taxes = s('federal') + s('state') + s('socialSecurity') + s('medicare');
  return h`<div class="row between wrap"><h1>Paystubs &amp; 401k</h1><div class="row wrap"><button id="ps-add">Type one in</button>
    <label class="btn btn-primary">Add paystubs<input type="file" id="ps-files" accept=".pdf,.png,.jpg,.jpeg,.heic" multiple hidden></label></div></div>
  <p class="small muted">Choose the paystub PDFs from Ajera or screenshots, and the quarterly 401(k) PDFs from Ekon Benefits (several at once is fine). They're read on this device; nothing is typed by hand. Files that pass the math checks are saved automatically; any that don't open for you to check.</p>
  <div class="grid cols-3" style="margin-bottom:14px">
    <div class="card"><h3>Gross ${y}</h3><div class="big num">${money0(s('gross'))}</div><div class="small muted">Net ${money0(s('net'))}</div></div>
    <div class="card"><h3>Taxes ${y}</h3><div class="big num">${money0(taxes)}</div><div class="small muted">${s('gross') ? ((taxes / s('gross')) * 100).toFixed(1) + '% of gross' : ''}</div></div>
    <div class="card"><h3>Roth 401k ${y}</h3><div class="big num">${money0(s('roth401k'))}</div><div class="small muted">+ ${money0(s('match'))} employer match</div></div></div>
  <div class="card"><ul class="list">${list.map((p) => h`<li class="tap" data-ps="${p.id}"><div class="grow">Paid ${shortDate(p.payDate)}<div class="small muted">Gross ${money(p.gross)} · 401k ${money(p.roth401k)} · match ${money(p.match)}</div></div><span class="num">${money(p.net)}</span></li>`)}</ul>
  ${list.length ? '' : h`<p class="muted">No paystubs yet. Choose Add paystubs and pick the PDFs downloaded from Ajera.</p>`}</div>
  ${k401Section()}`;
}

function k401Section() {
  const k = C.k401(), last = k.last;
  return h`<div class="row between wrap" style="margin-top:22px"><h2 style="margin:0">Roth 401(k) · Ekon Benefits</h2><div class="row wrap"><button id="k-add">Type one in</button>
    <label class="btn btn-primary">Add statements<input type="file" id="k-files" accept=".pdf,.png,.jpg,.jpeg,.heic" multiple hidden></label></div></div>
  <div class="grid cols-3" style="margin:12px 0">
    <div class="card"><h3>Value${last ? ' · ' + shortDate(k.asOf) : ''}</h3><div class="big num">${money0(k.value)}</div><div class="small muted">From the latest statement</div></div>
    <div class="card"><h3>Put in</h3><div class="big num">${money0(k.employee + k.match)}</div><div class="small muted">${money0(k.employee)} you · ${money0(k.match)} employer match</div></div>
    <div class="card"><h3>Investment gain</h3><div class="big num ${k.gain < 0 ? 'bad' : 'good'}">${signed(k.gain)}</div><div class="small muted">Since you joined the plan</div></div></div>
  ${last ? h`<div class="card" style="margin-bottom:12px"><h3>Funds on ${shortDate(last.periodEnd)}</h3><ul class="list">${(last.funds || []).map((f) => h`<li><span class="grow">${f.name}<div class="small muted">${f.category}</div></span><span class="num">${money(f.end)}</span><span class="small muted num" style="width:52px;text-align:right">${last.end ? ((f.end / last.end) * 100).toFixed(1) + '%' : ''}</span></li>`)}</ul></div>` : ''}
  <div class="card scroll-x"><table><thead><tr><th>Quarter ending</th><th>Start</th><th>You</th><th>Match</th><th>Gain</th><th>End</th></tr></thead><tbody>
    ${[...k.statements].reverse().map((s) => h`<tr class="tap" data-k="${s.id}"><td>${shortDate(s.periodEnd)}</td><td class="num">${money(s.begin)}</td><td class="num">${money((s.employee || 0) + (s.employeePretax || 0))}</td><td class="num">${money(s.match)}</td><td class="num ${s.gain < 0 ? 'bad' : ''}">${money(s.gain)}</td><td class="num">${money(s.end)}</td></tr>`)}</tbody></table>
    ${k.statements.length ? '' : h`<p class="muted">No statements yet. Choose Add statements and pick the quarterly PDFs from Ekon Benefits.</p>`}</div>`;
}

const reviewNote = (ctx) => ctx?.file ? h`<p class="notice warn">${ctx.n > 1 ? `${ctx.i} of ${ctx.n} to check · ` : ''}<b>${ctx.file}</b>: ${ctx.reason}</p>` : '';
function k401Form(s = { funds: [] }, ctx) {
  const F = [['periodEnd', 'Quarter ending', 'date'], ['begin', 'Beginning value'], ['employee', 'Your Roth contributions'], ['employeePretax', 'Your pre-tax contributions'], ['match', 'Employer match'], ['withdrawals', 'Withdrawals'], ['gain', 'Investment gain or loss'], ['end', 'Ending value']];
  openSheet(h`<div class="row between"><h2>${s.id ? 'Edit 401(k) statement' : 'Add 401(k) statement'}</h2><button class="link" data-close>Close</button></div><form class="form" id="kf">
    ${reviewNote(ctx)}${s.id || ctx ? '' : h`<p class="small muted" style="margin:0">Easier: choose <b>Add statements</b> and pick the PDF; it's read for you. Or type the figures below.</p>`}
    <div class="two">${F.map(([k, l, t]) => h`<label>${l}<input name="${k}" ${t === 'date' ? 'type="date"' : 'inputmode="decimal"'} value="${t === 'date' ? (s[k] || '') : (s[k] != null ? (s[k] / 100).toFixed(2) : '')}"></label>`)}</div>
    <p class="small muted" id="k-funds">${(s.funds || []).length ? `${s.funds.length} funds read` : ''}</p><p class="form-error" id="k-err" role="alert"></p>
    <div class="row between">${s.id ? h`<button type="button" class="danger" id="kdel">Delete</button>` : h`<span></span>`}<button class="primary">Save</button></div></form>`, (r) => {
    const form = r.querySelector('#kf'); let funds = s.funds || [], start = s.periodStart;
    r.querySelector('[data-close]').onclick = closeSheet;
    r.querySelector('#k-text')?.addEventListener('input', async (e) => {
      const { parseK401 } = await import('../import/k401.js'); const got = parseK401(e.target.value);
      for (const [k, , t] of F) if (got[k] != null) form.elements[k].value = t === 'date' ? got[k] : (got[k] / 100).toFixed(2);
      funds = got.funds; start = got.periodStart; r.querySelector('#k-funds').textContent = `${funds.length} funds read. Check the figures before saving.`;
    });
    r.querySelector('#kdel')?.addEventListener('click', async () => {
      if (!confirm(`Delete the statement for the quarter ending ${shortDate(s.periodEnd)}? Its net-worth snapshot is removed too.`)) return;
      const acct = S.all('accounts').find((a) => a.type === 'Roth 401k'), snapId = acct && `${s.periodEnd}-${acct.id}`, snap = snapId && S.get('snapshots', snapId);
      await S.remove('k401', s.id); if (snap?.source === '401k statement') await S.remove('snapshots', snapId); closeSheet();
      toast('Statement deleted', { action: 'Undo', onAction: async () => { await S.put('k401', s); if (snap) await S.put('snapshots', snap); } });
    });
    form.onsubmit = async (e) => {
      e.preventDefault(); const d = formData(form), doc = { ...s, funds, periodStart: start };
      for (const [k, , t] of F) doc[k] = t === 'date' ? d[k] : toCents(d[k]);
      if (!doc.periodEnd || doc.end == null) { r.querySelector('#k-err').textContent = 'Quarter ending date and ending value are required.'; return; }
      const { checkK401 } = await import('../import/k401.js'); const issues = checkK401(doc);
      if (issues.length && !confirm('These checks failed:\n\n' + issues.join('\n') + '\n\nSave anyway?')) return;
      doc.id = doc.periodEnd; await S.put('k401', doc);
      const acct = S.all('accounts').find((a) => a.type === 'Roth 401k');
      if (acct) await S.put('snapshots', { id: `${doc.periodEnd}-${acct.id}`, date: doc.periodEnd, acctId: acct.id, balance: doc.end, source: '401k statement' });
      closeSheet(); toast('401(k) statement saved');
    };
  });
}
function paystubForm(p = {}, ctx) {
  const issues = p.gross ? checkPaystub(p, S.all('paystubs').filter((x) => x.id !== p.id)) : [];
  openSheet(h`<div class="row between"><h2>${p.id ? 'Edit paystub' : 'Add paystub'}</h2><button class="link" data-close>Close</button></div>
    <form class="form" id="pf">
    ${reviewNote(ctx)}${p.id || ctx ? '' : h`<p class="small muted" style="margin:0">Easier: choose <b>Add paystubs</b> and pick the PDFs from Ajera; they're read for you. Or type the figures below.</p>`}
    ${issues.length ? h`<div class="notice">${issues.map((i) => h`<div class="warn">• ${i}</div>`)}</div>` : ''}
    <div class="two">${PAYSTUB_FIELDS.map(([k, label, type]) => h`<label>${label}<input name="${k}" ${type === 'date' ? 'type="date"' : 'inputmode="decimal"'} value="${type === 'date' ? (p[k] || '') : (p[k] != null ? (p[k] / 100).toFixed(2) : '')}"></label>`)}</div>
    <label class="check"><input type="checkbox" name="addIncome" ${!p.id || S.get('income', 'pay-' + p.id) ? 'checked' : ''}> Record net pay as income</label>
    <p class="small muted">The Roth 401(k) contribution and match are kept here for year-to-date totals; the 401(k) balance comes from the Ekon Benefits quarterly statement.</p><p class="form-error" id="ps-err" role="alert"></p>
    <div class="row between">${p.id ? h`<button type="button" class="danger" id="psdel">Delete</button>` : h`<span></span>`}<button class="primary">Save paystub</button></div></form>`, (r) => {
    r.querySelector('[data-close]').onclick = closeSheet;
    const form = r.querySelector('#pf');
    r.querySelector('#ps-text')?.addEventListener('input', (e) => {
      const got = parsePaystub(e.target.value);
      for (const [k, , type] of PAYSTUB_FIELDS) if (got[k] != null) form.elements[k].value = type === 'date' ? got[k] : (got[k] / 100).toFixed(2);
      toast(`Read ${Object.keys(got).length} fields. Check them before saving.`);
    });
    r.querySelector('#psdel')?.addEventListener('click', async () => {
      if (!confirm(`Delete the paystub paid ${shortDate(p.payDate)}? The income it recorded is removed too.`)) return;
      const inc = ['pay-' + p.id, 'reimb-' + p.id].map((id) => S.get('income', id)).filter(Boolean);
      await S.remove('paystubs', p.id); if (inc.length) await S.removeMany('income', inc.map((x) => x.id)); closeSheet();
      toast('Paystub deleted', { action: 'Undo', onAction: async () => { await S.put('paystubs', p); if (inc.length) await S.putMany('income', inc); } });
    });
    form.onsubmit = async (e) => {
      e.preventDefault(); const d = formData(form), doc = { ...p };
      for (const [k, , type] of PAYSTUB_FIELDS) doc[k] = type === 'date' ? (d[k] || null) : toCents(d[k]);
      if (!doc.payDate || doc.gross == null || doc.net == null) { r.querySelector('#ps-err').textContent = 'Pay date, gross pay and net pay are required.'; return; }
      const problems = checkPaystub(doc, S.all('paystubs').filter((x) => x.id !== p.id));
      if (problems.length && !confirm('These checks failed:\n\n' + problems.join('\n') + '\n\nSave anyway?')) return;
      await savePaystub(doc, d.addIncome);
      closeSheet(); toast('Paystub saved');
    };
  });
}
// Paycheck income = net minus any reimbursement; the reimbursement is recorded as its own income.
async function savePaystub(doc, addIncome = true) {
  doc.id ||= 'ps-' + doc.payDate + '-' + (doc.net || 0); await S.put('paystubs', doc);
  const ids = ['pay-' + doc.id, 'reimb-' + doc.id].filter((id) => S.get('income', id));
  if (!addIncome) { if (ids.length) await S.removeMany('income', ids); return; }
  await S.put('income', { id: 'pay-' + doc.id, date: doc.payDate, amount: doc.net - (doc.reimbursed || 0), source: 'paycheck', paystubId: doc.id });
  if (doc.reimbursed) await S.put('income', { id: 'reimb-' + doc.id, date: doc.payDate, amount: doc.reimbursed, source: 'reimbursement', paystubId: doc.id, note: 'Work expenses paid back' });
  else if (S.get('income', 'reimb-' + doc.id)) await S.remove('income', 'reimb-' + doc.id);
}
async function saveK401(doc) {
  doc.id = doc.periodEnd; await S.put('k401', doc);
  const acct = S.all('accounts').find((a) => a.type === 'Roth 401k');
  if (acct) await S.put('snapshots', { id: `${doc.periodEnd}-${acct.id}`, date: doc.periodEnd, acctId: acct.id, balance: doc.end, source: '401k statement' });
}

// Read files on-device, save the ones whose numbers check out, open the rest for review.
// kind: 'paystub', 'k401', or 'auto' (decide per file from what the text reader finds).
export async function readFiles(files, kind) {
  files = [...files]; const n = files.length, noun = kind === 'paystub' ? 'paystub' : kind === 'k401' ? '401(k) statement' : 'file';
  const pr = progress(`Reading ${n} ${noun}${n > 1 ? 's' : ''}`);
  const { ocrLines } = await import('../import/ocr.js');
  const P = await import('../import/paystub.js'), K = await import('../import/k401.js');
  let saved = 0; const review = [], dupes = [];
  for (const [i, f] of files.entries()) {
    const head = n > 1 ? `File ${i + 1} of ${n}: ` : '';
    pr.set(i / n, `${head}${f.name}`);
    try {
      const text = await ocrLines(f, { pages: kind === 'paystub' ? [1] : [1, 2], onProgress: (frac, what) => pr.set((i + frac) / n, `${head}${what}`) });
      let as = kind;
      if (as === 'auto') {
        const k = K.parseK401(text), p = P.parsePaystub(text);
        as = k.periodEnd && k.end != null ? 'k401' : p.payDate && p.net != null ? 'paystub' : /401\s*\(?k|ekon|savings spectrum|vested/i.test(String(text)) ? 'k401' : 'paystub';
      }
      if (as === 'paystub') {
        const p = P.parsePaystub(text), others = S.all('paystubs');
        if (p.payDate && others.some((o) => o.payDate === p.payDate && o.net === p.net)) { dupes.push(f.name); continue; }
        if (p.payDate && p.gross != null && p.net != null && !P.checkPaystub(p, others).length) { await savePaystub(p); saved++; } else review.push(['paystub', p, f.name, p.payDate ? "the totals don't add up; check the figures" : "couldn't find the pay date"]);
      } else {
        const k = K.parseK401(text);
        if (k.periodEnd && k.end != null && !K.checkK401(k).length) { await saveK401(k); saved++; } else review.push(['k401', k, f.name, k.periodEnd ? "the totals don't add up; check the figures" : "couldn't find the quarter or ending value"]);
      }
    } catch (e) { console.error(e); review.push([kind === 'k401' ? 'k401' : 'paystub', {}, f.name, "couldn't read this file; type the figures in"]); }
  }
  const done = `${saved} saved${dupes.length ? `, ${dupes.length} already in the app` : ''}${review.length ? `, ${review.length} need a look` : ''}.`;
  if (saved || dupes.length || !review.length) pr.done(done); else pr.fail(done);
  for (const [i, [as, r, file, reason]] of review.entries()) { const ctx = { file, reason, i: i + 1, n: review.length }; if (as === 'paystub') paystubForm(r, ctx); else k401Form(r, ctx); await new Promise((res) => document.getElementById('sheet').addEventListener('close', res, { once: true })); }
}

function mountPaystubs(root) {
  root.querySelector('#ps-files').onchange = (e) => { if (e.target.files.length) readFiles(e.target.files, 'paystub'); e.target.value = ''; };
  root.querySelector('#k-files').onchange = (e) => { if (e.target.files.length) readFiles(e.target.files, 'k401'); e.target.value = ''; };
  root.querySelector('#ps-add').onclick = () => paystubForm();
  root.querySelectorAll('[data-ps]').forEach((el) => el.onclick = () => paystubForm(S.get('paystubs', el.dataset.ps)));
  root.querySelector('#k-add').onclick = () => k401Form();
  root.querySelectorAll('[data-k]').forEach((el) => el.onclick = () => k401Form(S.get('k401', el.dataset.k)));
}

// ---- Settings ----
function settings() {
  const prefs = S.setting('prefs'), cats = S.all('categories').sort((a, b) => a.name.localeCompare(b.name)), accts = S.all('accounts');
  const sy = sync.syncState();
  const syncCard = h`<div class="card stack"><h2>Sync between devices</h2>
    ${!sy.configured ? h`<p class="small muted">Connect your free Firebase project to sync this device with your other devices. Paste the firebaseConfig block from the Firebase console (Project settings → Your apps).</p>
      <textarea id="fb-config" placeholder="const firebaseConfig = { apiKey: ..., projectId: ... }"></textarea><button class="primary" id="fb-save">Connect</button>`
    : sy.email ? h`<p>Signed in as <b>${sy.email}</b>.</p><p class="small ${sy.status === 'error' ? 'bad' : 'muted'}">${sy.status === 'on' ? `Synced${sy.lastSync ? ' at ' + sy.lastSync.toLocaleTimeString() : ''}. Changes made offline upload when you're back online.` : sy.status === 'error' ? 'Sync error. Check your connection and the Firestore rules.' : 'Syncing…'}</p>
      <div class="row wrap"><button id="fb-out">Sign out</button></div>`
    : h`<p class="small muted">Sign in with the email and password for your Finance Hub account. Your data then downloads to this device. Use "Create account" only once, on your first device.</p>
      <form class="form" id="fb-login"><input name="email" type="email" autocomplete="username" placeholder="Email" required><input name="password" type="password" autocomplete="current-password" placeholder="Password" required minlength="6">
      <div class="row wrap"><button class="primary">Sign in</button><button type="button" id="fb-create">Create account</button><button type="button" class="link" id="fb-reset">Forgot password</button></div></form>`}</div>`;
  return h`<h1>Settings</h1><div class="grid cols-2">${syncCard}
  <div class="card stack"><h2>Backup</h2><p class="small muted">Your data lives on this device${sy.email ? ' and in your Firebase project' : ''}. Export a backup regularly and keep it in iCloud Drive.</p>
    <div class="row wrap"><button class="primary" id="exp">Export backup</button><label class="btn" style="color:var(--text)">Restore from backup<input type="file" id="imp" accept=".json,application/json" hidden></label></div>
    <button class="danger" id="wipe">Erase all data on this device</button></div>
  <div class="card stack"><h2>Preferences</h2>
    <label>Default account for Quick add<select id="pref-acct">${options(accts.filter((a) => !a.isInvestment).map((a) => [a.id, a.name]), prefs.defaultAccount)}</select></label>
    <label>Spreadsheet history covers spending through<input type="date" id="pref-cutoff" value="${S.setting('historyCutoff', '') || ''}"></label>
    <p class="small muted" style="margin-top:-6px">Statement rows on or before this date are skipped, because the spreadsheet already counted them. After it, the app is the record.</p>
    <label>Oil change interval (miles)<input id="pref-oil" inputmode="numeric" value="${prefs.oilInterval || 5000}"></label>
    <label>Theme<select id="pref-theme">${options([['', 'Follow device'], ['light', 'Light'], ['dark', 'Dark']], localStorage.getItem('theme') || '')}</select></label></div>
  <div class="card"><div class="row between"><h2>Categories</h2><button class="link" id="cat-new">Add</button></div><ul class="list">${cats.map((c) => h`<li class="tap" data-catedit="${c.id}"><span class="grow">${c.name}</span><span class="small muted">${c.archived ? 'hidden' : c.group || ''}${c.countsAsSpending === false ? ' · not spending' : ''}</span></li>`)}</ul></div>
  <div class="card"><div class="row between"><h2>Accounts</h2><button class="link" id="acct-new">Add</button></div><ul class="list">${accts.map((a) => h`<li class="tap" data-acctedit="${a.id}"><span class="grow">${a.name}</span><span class="small muted">${a.type}${a.closed ? ' · closed' : ''}</span></li>`)}</ul>
    <p class="small muted">Account numbers are never stored. Accounts are identified only by the names you give them.</p></div>
  <div class="card"><h2>Merchant rules</h2><ul class="list">${S.all('rules').map((r) => h`<li><span class="grow">"${r.pattern}" → ${C.cat(r.catId)?.name || '—'}</span><button class="link x-btn" data-delrule="${r.id}" aria-label="Delete rule for ${r.pattern}">✕</button></li>`)}</ul>${S.all('rules').length ? '' : h`<p class="small muted">Rules are created when you categorize imported rows.</p>`}</div>
  </div>`;
}
const AUTH_MESSAGES = {
  'auth/invalid-credential': 'Email or password is wrong. If Safari filled in an old password, clear it and type the new one. Or choose Forgot password.',
  'auth/wrong-password': 'Wrong password. Choose Forgot password to set a new one.',
  'auth/user-not-found': 'No account with that email. Check the spelling, or choose Create account.',
  'auth/email-already-in-use': 'That email already has an account. Choose Sign in instead (or Forgot password).',
  'auth/weak-password': 'Use at least 6 characters for the password.',
  'auth/invalid-email': 'That email address doesn\'t look right.',
  'auth/too-many-requests': 'Too many tries. Wait about 15 minutes, or choose Forgot password.',
  'auth/network-request-failed': 'Couldn\'t reach the sync service. Check your connection and try again.',
};
const authMessage = (e) => AUTH_MESSAGES[e.code] || (e.code ? `${e.code.replace('auth/', '').replace(/-/g, ' ')}` : e.message);
function mountSettings(root) {
  root.querySelector('#fb-save')?.addEventListener('click', async () => { try { sync.saveConfig(root.querySelector('#fb-config').value); await sync.start(); location.reload(); } catch (e) { alert(e.message); } });
  root.querySelector('#fb-out')?.addEventListener('click', () => sync.signOutNow());
  const login = root.querySelector('#fb-login');
  const go = async (create) => { const d = formData(login); try { await sync.signIn(d.email.trim().toLowerCase(), d.password, create); toast('Signed in'); } catch (e) { alert(authMessage(e)); } };
  root.querySelector('#fb-reset')?.addEventListener('click', async () => {
    const email = login.email.value.trim().toLowerCase(); if (!email) { alert('Type your email first, then choose Forgot password.'); return; }
    try { await sync.resetPassword(email); alert(`If ${email} has an account, a reset link is on its way. Check spam too.`); } catch (e) { alert(authMessage(e)); } });
  login?.addEventListener('submit', (e) => { e.preventDefault(); go(false); });
  root.querySelector('#fb-create')?.addEventListener('click', () => { if (login.reportValidity()) go(true); });
  // On iPhone the share sheet lets you save straight to iCloud Drive; elsewhere it downloads.
  root.querySelector('#exp').onclick = async () => {
    const name = `finance-hub-backup-${today()}.json`, text = JSON.stringify(S.exportAll(), null, 1), file = new File([text], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] }) && /iPhone|iPad/.test(navigator.userAgent)) {
      try { await navigator.share({ files: [file], title: 'Finance Hub backup' }); toast('Backup ready'); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`Saved ${name} to Downloads`);
  };
  root.querySelector('#imp').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; if (!confirm('Replace all data on this device with this backup?')) return;
    try { await busy('Restoring backup', async () => S.importAll(JSON.parse(await f.text())), 'Backup restored'); } catch (err) { alert(err.message); } };
  root.querySelector('#wipe').onclick = async () => { if (confirm('Erase all Finance Hub data on this device? Export a backup first.') && confirm('Really erase everything?')) { await S.clearAll(); location.reload(); } };
  const prefs = S.setting('prefs');
  root.querySelector('#pref-acct').onchange = async (e) => { await S.saveSetting('prefs', { ...S.setting('prefs'), defaultAccount: e.target.value }); toast('Default account saved'); };
  root.querySelector('#pref-cutoff').onchange = async (e) => { await S.saveSetting('historyCutoff', e.target.value || null); toast(e.target.value ? 'Cutoff date saved' : 'Cutoff cleared'); };
  root.querySelector('#pref-oil').onchange = async (e) => {
    const n = parseInt(String(e.target.value).replace(/[,\s]/g, ''));
    if (!(n >= 500 && n <= 30000)) { toast('Use a number of miles between 500 and 30,000'); e.target.value = S.setting('prefs').oilInterval || 5000; return; }
    await S.saveSetting('prefs', { ...S.setting('prefs'), oilInterval: n }); toast('Oil change interval saved');
  };
  root.querySelector('#pref-theme').onchange = (e) => { const v = e.target.value; v ? localStorage.setItem('theme', v) : localStorage.removeItem('theme'); applyTheme(); };
  const catForm = (c = { name: '', group: 'Lifestyle', countsAsSpending: true, archived: false }) => openSheet(h`<div class="row between"><h2>${c.id ? c.name : 'New category'}</h2><button class="link" data-close>Close</button></div><form class="form" id="kf">
    <label>Name<input name="name" value="${c.name}" required></label><label>Group<select name="group">${options(['Essentials', 'Lifestyle', 'Car', 'Giving', 'Taxes', 'Shared'].map((g) => [g, g]), c.group)}</select></label>
    <label class="check"><input type="checkbox" name="countsAsSpending" ${c.countsAsSpending !== false ? 'checked' : ''}> Counts as spending</label>
    <label class="check"><input type="checkbox" name="archived" ${c.archived ? 'checked' : ''}> Hidden from Quick add (kept in history)</label>
    <div class="row between"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div></form>`, (r) => {
    r.querySelector('[data-close]').onclick = closeSheet;
    r.querySelector('#kf').onsubmit = async (e) => { e.preventDefault(); const d = formData(e.target); await S.put('categories', { ...c, ...d, name: d.name.trim() }); closeSheet(); toast('Category saved'); };
  });
  const TYPES = [['checking', 'Checking', 0, 0], ['savings', 'Savings', 0, 0], ['CD', 'CD', 0, 0], ['credit card', 'Credit card', 0, 1], ['loan', 'Loan', 0, 1], ['brokerage', 'Brokerage', 1, 0], ['Roth IRA', 'Roth IRA', 1, 0], ['Roth 401k', 'Roth 401(k)', 1, 0], ['cash', 'Cash', 0, 0], ['Venmo', 'Venmo / PayPal', 0, 0]];
  const acctForm = (a = { name: '', type: 'checking', institution: '', isInvestment: false, isLiability: false }) => openSheet(h`<div class="row between"><h2>${a.id ? a.name : 'New account'}</h2><button class="link" data-close>Close</button></div><form class="form" id="af">
    <label>Name<input name="name" value="${a.name}" required></label><div class="two"><label>Type<select name="type">${options([...TYPES.map(([v, l]) => [v, l]), ...(TYPES.some(([v]) => v === a.type) ? [] : [[a.type, a.type]])], a.type)}</select></label><label>Institution<input name="institution" value="${a.institution || ''}"></label></div>
    <label class="check"><input type="checkbox" name="isInvestment" ${a.isInvestment ? 'checked' : ''}> Investment account (value from lots)</label>
    <label class="check"><input type="checkbox" name="isLiability" ${a.isLiability ? 'checked' : ''}> Money owed (credit card or loan)</label>
    <label class="check"><input type="checkbox" name="closed" ${a.closed ? 'checked' : ''}> Closed</label>
    <div class="row between"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div></form>`, (r) => {
    r.querySelector('[data-close]').onclick = closeSheet;
    r.querySelector('[name=type]').onchange = (e) => { const t = TYPES.find(([v]) => v === e.target.value); if (t) { r.querySelector('[name=isInvestment]').checked = !!t[2]; r.querySelector('[name=isLiability]').checked = !!t[3]; } };
    r.querySelector('#af').onsubmit = async (e) => { e.preventDefault(); const d = formData(e.target); await S.put('accounts', { ...a, ...d, name: d.name.trim() }); closeSheet(); toast('Account saved'); };
  });
  root.querySelector('#cat-new').onclick = () => catForm();
  root.querySelector('#acct-new').onclick = () => acctForm();
  root.querySelectorAll('[data-catedit]').forEach((el) => el.onclick = () => catForm(S.get('categories', el.dataset.catedit)));
  root.querySelectorAll('[data-acctedit]').forEach((el) => el.onclick = () => acctForm(S.get('accounts', el.dataset.acctedit)));
  root.querySelectorAll('[data-delrule]').forEach((b) => b.onclick = async () => { const r = S.get('rules', b.dataset.delrule); await S.remove('rules', r.id); toast(`Rule for "${r.pattern}" deleted`, { action: 'Undo', onAction: () => S.put('rules', r) }); });
}
export function applyTheme() { const t = localStorage.getItem('theme'); t ? document.documentElement.setAttribute('data-theme', t) : document.documentElement.removeAttribute('data-theme'); }

export const views = {
  more: { render }, networth: { render: networth, mount: mountNetworth }, car: { render: car, mount: mountCar },
  paystubs: { render: paystubs, mount: mountPaystubs }, settings: { render: settings, mount: mountSettings },
};
