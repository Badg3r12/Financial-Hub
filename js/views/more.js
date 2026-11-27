import * as S from '../store.js';
import { h, raw, money, money0, signed, today, shortDate, toCents, sum, uid } from '../util.js';
import * as C from '../calc.js';
import { line } from '../charts.js';
import { openSheet, closeSheet, toast, options, formData } from '../ui.js';
import { parsePaystub, checkPaystub, PAYSTUB_FIELDS } from '../import/paystub.js';
import * as sync from '../sync.js';

function render() {
  const links = [['networth', 'Net worth', 'Snapshots, account breakdown, unexplained differences'], ['paystubs', 'Paystubs & 401k', 'Income, taxes, Roth 401k and match'],
    ['inbox', 'Inbox', 'Imported rows waiting for review'], ['import', 'Import', 'Statements, Vanguard files, history from the spreadsheets'],
    ['shared', 'Shared costs', 'College-era costs not paid by you'], ['car', 'Car log', 'Service history and next oil change'], ['settings', 'Settings', 'Backup, categories, accounts, theme']];
  return h`<h1>More</h1><div class="card"><ul class="list">${links.map(([k, t, d]) => h`<li><a href="#${k}" style="text-decoration:none;color:inherit;display:block;width:100%"><b>${t}</b><div class="small muted">${d}</div></a></li>`)}</ul></div>`;
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
      <p class="small muted">Leave blank to skip an account.</p><div class="row between"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div></form>`, (r) => {
      r.querySelector('[data-close]').onclick = closeSheet;
      r.querySelector('#sf').onsubmit = async (e) => {
        e.preventDefault(); const d = formData(e.target);
        await S.putMany('snapshots', accts.filter((a) => toCents(d['a-' + a.id]) !== null).map((a) => ({ id: `${d.date}-${a.id}`, date: d.date, acctId: a.id, balance: toCents(d['a-' + a.id]), source: 'typed' })));
        closeSheet(); toast('Snapshot saved');
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
    <div class="card"><h3>Next oil change</h3><div class="big num">${lastOil ? (lastOil.miles + (prefs.oilInterval || 5000)).toLocaleString() : '—'}</div><div class="small muted">Every ${(prefs.oilInterval || 5000).toLocaleString()} miles (change in Settings)</div></div></div>
  <div class="card"><ul class="list">${log.map((x) => h`<li class="tap" data-car="${x.id}"><div class="grow">${x.desc}<div class="small muted">${shortDate(x.date)} · ${(x.miles || 0).toLocaleString()} mi</div></div><span class="num">${x.cost ? money(x.cost) : ''}</span></li>`)}</ul>${log.length ? '' : h`<p class="muted">No service records yet.</p>`}</div>`;
}
function mountCar(root) {
  const edit = (x = { date: today(), miles: '', desc: '', cost: null }) => openSheet(h`<h2>${x.id ? 'Edit service' : 'Add service'}</h2><form class="form" id="cf">
    <div class="two"><label>Date<input type="date" name="date" value="${x.date}"></label><label>Mileage<input name="miles" inputmode="numeric" value="${x.miles}"></label></div>
    <label>What was done<input name="desc" value="${x.desc}" required></label><label>Cost<input name="cost" inputmode="decimal" value="${x.cost ? x.cost / 100 : ''}"></label>
    <div class="row between">${x.id ? h`<button type="button" class="danger" id="cdel">Delete</button>` : h`<span></span>`}<button class="primary">Save</button></div></form>`, (r) => {
    r.querySelector('#cdel')?.addEventListener('click', async () => { await S.remove('car', x.id); closeSheet(); });
    r.querySelector('#cf').onsubmit = async (e) => { e.preventDefault(); const d = formData(e.target); await S.put('car', { ...x, date: d.date, miles: parseInt(d.miles) || 0, desc: d.desc, cost: toCents(d.cost) }); closeSheet(); };
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
    <label class="btn btn-primary">Add paystubs<input type="file" id="ps-files" accept="image/*,.pdf,application/pdf" multiple hidden></label></div></div>
  <p class="small muted">Choose paystub screenshots or PDFs (several at once is fine). They're read on this device. Stubs that pass the math checks are saved automatically; any that don't open for you to fix.</p>
  <div id="ocr-status"></div>
  <div class="grid cols-3" style="margin-bottom:14px">
    <div class="card"><h3>Gross ${y}</h3><div class="big num">${money0(s('gross'))}</div><div class="small muted">Net ${money0(s('net'))}</div></div>
    <div class="card"><h3>Taxes ${y}</h3><div class="big num">${money0(taxes)}</div><div class="small muted">${s('gross') ? ((taxes / s('gross')) * 100).toFixed(1) + '% of gross' : ''}</div></div>
    <div class="card"><h3>Roth 401k ${y}</h3><div class="big num">${money0(s('roth401k'))}</div><div class="small muted">+ ${money0(s('match'))} employer match</div></div></div>
  <div class="card"><ul class="list">${list.map((p) => h`<li class="tap" data-ps="${p.id}"><div class="grow">Paid ${shortDate(p.payDate)}<div class="small muted">Gross ${money(p.gross)} · 401k ${money(p.roth401k)} · match ${money(p.match)}</div></div><span class="num">${money(p.net)}</span></li>`)}</ul>
  ${list.length ? '' : h`<p class="muted">No paystubs yet. On your iPhone: take a screenshot in Ajera, open it in Photos, long-press the text and choose Copy (Live Text), then paste it here. On the Mac, open the screenshot in Preview, select all the text and copy it.</p>`}</div>
  ${k401Section()}`;
}

function k401Section() {
  const k = C.k401(), last = k.last;
  return h`<div class="row between wrap" style="margin-top:22px"><h2 style="margin:0">Roth 401(k) · Ekon Benefits</h2><div class="row wrap"><button id="k-add">Type one in</button>
    <label class="btn btn-primary">Add statements<input type="file" id="k-files" accept=".pdf,application/pdf,image/*" multiple hidden></label></div></div>
  <div class="grid cols-3" style="margin:12px 0">
    <div class="card"><h3>Value${last ? ' · ' + shortDate(k.asOf) : ''}</h3><div class="big num">${money0(k.value)}</div><div class="small muted">From the latest statement</div></div>
    <div class="card"><h3>Put in</h3><div class="big num">${money0(k.employee + k.match)}</div><div class="small muted">${money0(k.employee)} you · ${money0(k.match)} employer match</div></div>
    <div class="card"><h3>Investment gain</h3><div class="big num ${k.gain < 0 ? 'bad' : 'good'}">${signed(k.gain)}</div><div class="small muted">Since you joined the plan</div></div></div>
  ${last ? h`<div class="card" style="margin-bottom:12px"><h3>Funds on ${shortDate(last.periodEnd)}</h3><ul class="list">${(last.funds || []).map((f) => h`<li><span class="grow">${f.name}<div class="small muted">${f.category}</div></span><span class="num">${money(f.end)}</span><span class="small muted num" style="width:52px;text-align:right">${last.end ? ((f.end / last.end) * 100).toFixed(1) + '%' : ''}</span></li>`)}</ul></div>` : ''}
  <div class="card scroll-x"><table><thead><tr><th>Quarter ending</th><th>Start</th><th>You</th><th>Match</th><th>Gain</th><th>End</th></tr></thead><tbody>
    ${[...k.statements].reverse().map((s) => h`<tr class="tap" data-k="${s.id}"><td>${shortDate(s.periodEnd)}</td><td class="num">${money(s.begin)}</td><td class="num">${money((s.employee || 0) + (s.employeePretax || 0))}</td><td class="num">${money(s.match)}</td><td class="num ${s.gain < 0 ? 'bad' : ''}">${money(s.gain)}</td><td class="num">${money(s.end)}</td></tr>`)}</tbody></table>
    ${k.statements.length ? '' : h`<p class="muted">No statements yet. Screenshot pages 1 and 2 of the quarterly PDF, copy the text with Live Text, and paste it here.</p>`}</div>`;
}

function k401Form(s = { funds: [] }) {
  const F = [['periodEnd', 'Quarter ending', 'date'], ['begin', 'Beginning value'], ['employee', 'Your Roth contributions'], ['employeePretax', 'Your pre-tax contributions'], ['match', 'Employer match'], ['withdrawals', 'Withdrawals'], ['gain', 'Investment gain or loss'], ['end', 'Ending value']];
  openSheet(h`<div class="row between"><h2>${s.id ? 'Edit 401(k) statement' : 'Add 401(k) statement'}</h2><button class="link" data-close>Close</button></div><form class="form" id="kf">
    ${s.id ? '' : h`<label>Paste the statement text (pages 1–2, copied with Live Text)<textarea id="k-text"></textarea></label>`}
    <div class="two">${F.map(([k, l, t]) => h`<label>${l}<input name="${k}" ${t === 'date' ? 'type="date"' : 'inputmode="decimal"'} value="${t === 'date' ? (s[k] || '') : (s[k] != null ? (s[k] / 100).toFixed(2) : '')}"></label>`)}</div>
    <p class="small muted" id="k-funds">${(s.funds || []).length ? `${s.funds.length} funds read` : ''}</p>
    <div class="row between">${s.id ? h`<button type="button" class="danger" id="kdel">Delete</button>` : h`<span></span>`}<button class="primary">Save</button></div></form>`, (r) => {
    const form = r.querySelector('#kf'); let funds = s.funds || [], start = s.periodStart;
    r.querySelector('[data-close]').onclick = closeSheet;
    r.querySelector('#k-text')?.addEventListener('input', async (e) => {
      const { parseK401 } = await import('../import/k401.js'); const got = parseK401(e.target.value);
      for (const [k, , t] of F) if (got[k] != null) form.elements[k].value = t === 'date' ? got[k] : (got[k] / 100).toFixed(2);
      funds = got.funds; start = got.periodStart; r.querySelector('#k-funds').textContent = `${funds.length} funds read. Check the figures before saving.`;
    });
    r.querySelector('#kdel')?.addEventListener('click', async () => { if (confirm('Delete this statement?')) { await S.remove('k401', s.id); closeSheet(); } });
    form.onsubmit = async (e) => {
      e.preventDefault(); const d = formData(form), doc = { ...s, funds, periodStart: start };
      for (const [k, , t] of F) doc[k] = t === 'date' ? d[k] : toCents(d[k]);
      if (!doc.periodEnd || doc.end == null) return toast('Quarter ending date and ending value are required');
      const { checkK401 } = await import('../import/k401.js'); const issues = checkK401(doc);
      if (issues.length && !confirm('These checks failed:\n\n' + issues.join('\n') + '\n\nSave anyway?')) return;
      doc.id = doc.periodEnd; await S.put('k401', doc);
      const acct = S.all('accounts').find((a) => a.type === 'Roth 401k');
      if (acct) await S.put('snapshots', { id: `${doc.periodEnd}-${acct.id}`, date: doc.periodEnd, acctId: acct.id, balance: doc.end, source: '401k statement' });
      closeSheet(); toast('401(k) statement saved');
    };
  });
}
function paystubForm(p = {}) {
  const issues = p.gross ? checkPaystub(p, S.all('paystubs').filter((x) => x.id !== p.id)) : [];
  openSheet(h`<div class="row between"><h2>${p.id ? 'Edit paystub' : 'Add paystub'}</h2><button class="link" data-close>Close</button></div>
    <form class="form" id="pf">
    ${p.id ? '' : h`<label>Paste the paystub text (Live Text from a screenshot)<textarea id="ps-text" placeholder="Paste here, then check the figures below"></textarea></label>`}
    ${issues.length ? h`<div class="notice">${issues.map((i) => h`<div class="warn">• ${i}</div>`)}</div>` : ''}
    <div class="two">${PAYSTUB_FIELDS.map(([k, label, type]) => h`<label>${label}<input name="${k}" ${type === 'date' ? 'type="date"' : 'inputmode="decimal"'} value="${type === 'date' ? (p[k] || '') : (p[k] != null ? (p[k] / 100).toFixed(2) : '')}"></label>`)}</div>
    <label class="check"><input type="checkbox" name="addIncome" ${p.id ? '' : 'checked'}> Record net pay as income</label>
    <p class="small muted">The Roth 401k contribution and match are kept on the paystub for the year-to-date totals; the 401k's shares come from the Vanguard plan file.</p>
    <div class="row between">${p.id ? h`<button type="button" class="danger" id="psdel">Delete</button>` : h`<span></span>`}<button class="primary">Save paystub</button></div></form>`, (r) => {
    r.querySelector('[data-close]').onclick = closeSheet;
    const form = r.querySelector('#pf');
    r.querySelector('#ps-text')?.addEventListener('input', (e) => {
      const got = parsePaystub(e.target.value);
      for (const [k, , type] of PAYSTUB_FIELDS) if (got[k] != null) form.elements[k].value = type === 'date' ? got[k] : (got[k] / 100).toFixed(2);
      toast(`Read ${Object.keys(got).length} fields. Check them before saving.`);
    });
    r.querySelector('#psdel')?.addEventListener('click', async () => { if (confirm('Delete this paystub?')) { await S.remove('paystubs', p.id); closeSheet(); } });
    form.onsubmit = async (e) => {
      e.preventDefault(); const d = formData(form), doc = { ...p };
      for (const [k, , type] of PAYSTUB_FIELDS) doc[k] = type === 'date' ? (d[k] || null) : toCents(d[k]);
      if (!doc.payDate || doc.gross == null || doc.net == null) return toast('Pay date, gross and net are required');
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
  if (!addIncome) return;
  await S.put('income', { id: 'pay-' + doc.id, date: doc.payDate, amount: doc.net - (doc.reimbursed || 0), source: 'paycheck', paystubId: doc.id });
  if (doc.reimbursed) await S.put('income', { id: 'reimb-' + doc.id, date: doc.payDate, amount: doc.reimbursed, source: 'reimbursement', paystubId: doc.id, note: 'Work expenses paid back' });
}
async function saveK401(doc) {
  doc.id = doc.periodEnd; await S.put('k401', doc);
  const acct = S.all('accounts').find((a) => a.type === 'Roth 401k');
  if (acct) await S.put('snapshots', { id: `${doc.periodEnd}-${acct.id}`, date: doc.periodEnd, acctId: acct.id, balance: doc.end, source: '401k statement' });
}

// Read files on-device, save the ones whose numbers check out, open the rest for review.
async function readFiles(files, kind, root) {
  const status = root.querySelector('#ocr-status') || document.createElement('div');
  const say = (t) => { status.innerHTML = ''; const p = document.createElement('p'); p.className = 'notice'; p.textContent = t; status.append(p); };
  const { ocrLines } = await import('../import/ocr.js');
  const P = await import('../import/paystub.js'), K = await import('../import/k401.js');
  let saved = 0; const review = [], dupes = [];
  for (const [i, f] of [...files].entries()) {
    say(`Reading ${f.name} (${i + 1} of ${files.length})… the first file takes longer while the reader loads.`);
    try {
      const text = await ocrLines(f, { pages: kind === 'paystub' ? [1] : [1, 2] });
      if (kind === 'paystub') {
        const p = P.parsePaystub(text), others = S.all('paystubs');
        if (p.payDate && others.some((o) => o.payDate === p.payDate && o.net === p.net)) { dupes.push(f.name); continue; }
        if (p.payDate && p.gross != null && p.net != null && !P.checkPaystub(p, others).length) { await savePaystub(p); saved++; } else review.push(p);
      } else {
        const k = K.parseK401(text);
        if (k.periodEnd && k.end != null && !K.checkK401(k).length) { await saveK401(k); saved++; } else review.push(k);
      }
    } catch (e) { console.error(e); review.push({}); }
  }
  const done = `${saved} saved${dupes.length ? `, ${dupes.length} already in the app` : ''}${review.length ? `, ${review.length} need a look` : ''}.`;
  say(done); toast(done);
  for (const r of review) { if (kind === 'paystub') paystubForm(r); else k401Form(r); await new Promise((res) => document.getElementById('sheet').addEventListener('close', res, { once: true })); }
}

function mountPaystubs(root) {
  root.querySelector('#ps-files').onchange = (e) => e.target.files.length && readFiles(e.target.files, 'paystub', root);
  root.querySelector('#k-files').onchange = (e) => e.target.files.length && readFiles(e.target.files, 'k401', root);
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
      <div class="row wrap"><button id="fb-out">Sign out</button><button class="danger" id="fb-forget">Disconnect this device</button></div>`
    : h`<p class="small muted">Sign in with the email and password for your Finance Hub account. Use "Create account" once, on your first device.</p>
      <form class="form" id="fb-login"><input name="email" type="email" autocomplete="username" placeholder="Email" required><input name="password" type="password" autocomplete="current-password" placeholder="Password" required minlength="6">
      <div class="row wrap"><button class="primary">Sign in</button><button type="button" id="fb-create">Create account</button><button type="button" class="link" id="fb-forget">Use a different project</button></div></form>`}</div>`;
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
  <div class="card"><h2>Merchant rules</h2><ul class="list">${S.all('rules').map((r) => h`<li><span class="grow">"${r.pattern}" → ${C.cat(r.catId)?.name || '—'}</span><button class="link" data-delrule="${r.id}">✕</button></li>`)}</ul>${S.all('rules').length ? '' : h`<p class="small muted">Rules are created when you categorize imported rows.</p>`}</div>
  </div>`;
}
function mountSettings(root) {
  root.querySelector('#fb-save')?.addEventListener('click', async () => { try { sync.saveConfig(root.querySelector('#fb-config').value); await sync.start(); location.reload(); } catch (e) { alert(e.message); } });
  root.querySelectorAll('#fb-forget').forEach((b) => b.onclick = async () => { if (!confirm('Disconnect this device from sync? Data stays on this device.')) return; try { await sync.signOutNow(); } catch { /* not signed in */ } sync.forgetConfig(); location.reload(); });
  root.querySelector('#fb-out')?.addEventListener('click', () => sync.signOutNow());
  const login = root.querySelector('#fb-login');
  const go = async (create) => { const d = formData(login); try { await sync.signIn(d.email.trim(), d.password, create); toast('Signed in'); } catch (e) { alert(e.code ? e.code.replace('auth/', '').replace(/-/g, ' ') : e.message); } };
  login?.addEventListener('submit', (e) => { e.preventDefault(); go(false); });
  root.querySelector('#fb-create')?.addEventListener('click', () => { if (login.reportValidity()) go(true); });
  root.querySelector('#exp').onclick = () => {
    const blob = new Blob([JSON.stringify(S.exportAll(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `finance-hub-backup-${today()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  root.querySelector('#imp').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; if (!confirm('Replace all data on this device with this backup?')) return;
    try { await S.importAll(JSON.parse(await f.text())); toast('Backup restored'); } catch (err) { alert(err.message); } };
  root.querySelector('#wipe').onclick = async () => { if (confirm('Erase all Finance Hub data on this device? Export a backup first.') && confirm('Really erase everything?')) { await S.clearAll(); location.reload(); } };
  const prefs = S.setting('prefs');
  root.querySelector('#pref-acct').onchange = (e) => S.saveSetting('prefs', { ...prefs, defaultAccount: e.target.value });
  root.querySelector('#pref-cutoff').onchange = (e) => S.saveSetting('historyCutoff', e.target.value || null);
  root.querySelector('#pref-oil').onchange = (e) => S.saveSetting('prefs', { ...prefs, oilInterval: parseInt(e.target.value) || 5000 });
  root.querySelector('#pref-theme').onchange = (e) => { const v = e.target.value; v ? localStorage.setItem('theme', v) : localStorage.removeItem('theme'); applyTheme(); };
  const catForm = (c = { name: '', group: 'Lifestyle', countsAsSpending: true, archived: false }) => openSheet(h`<h2>${c.id ? c.name : 'New category'}</h2><form class="form" id="kf">
    <label>Name<input name="name" value="${c.name}" required></label><label>Group<select name="group">${options(['Essentials', 'Lifestyle', 'Car', 'Giving', 'Taxes', 'Shared'].map((g) => [g, g]), c.group)}</select></label>
    <label class="check"><input type="checkbox" name="countsAsSpending" ${c.countsAsSpending !== false ? 'checked' : ''}> Counts as spending</label>
    <label class="check"><input type="checkbox" name="archived" ${c.archived ? 'checked' : ''}> Hidden from Quick add (kept in history)</label>
    <div class="row between"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div></form>`, (r) => {
    r.querySelector('[data-close]').onclick = closeSheet;
    r.querySelector('#kf').onsubmit = async (e) => { e.preventDefault(); const d = formData(e.target); await S.put('categories', { ...c, ...d, name: d.name.trim() }); closeSheet(); };
  });
  const acctForm = (a = { name: '', type: 'checking', institution: '', isInvestment: false, isLiability: false }) => openSheet(h`<h2>${a.id ? a.name : 'New account'}</h2><form class="form" id="af">
    <label>Name<input name="name" value="${a.name}" required></label><div class="two"><label>Type<input name="type" value="${a.type}"></label><label>Institution<input name="institution" value="${a.institution || ''}"></label></div>
    <label class="check"><input type="checkbox" name="isInvestment" ${a.isInvestment ? 'checked' : ''}> Investment account (value from lots)</label>
    <label class="check"><input type="checkbox" name="isLiability" ${a.isLiability ? 'checked' : ''}> Money owed (credit card or loan)</label>
    <label class="check"><input type="checkbox" name="closed" ${a.closed ? 'checked' : ''}> Closed</label>
    <div class="row between"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div></form>`, (r) => {
    r.querySelector('[data-close]').onclick = closeSheet;
    r.querySelector('#af').onsubmit = async (e) => { e.preventDefault(); const d = formData(e.target); await S.put('accounts', { ...a, ...d, name: d.name.trim() }); closeSheet(); };
  });
  root.querySelector('#cat-new').onclick = () => catForm();
  root.querySelector('#acct-new').onclick = () => acctForm();
  root.querySelectorAll('[data-catedit]').forEach((el) => el.onclick = () => catForm(S.get('categories', el.dataset.catedit)));
  root.querySelectorAll('[data-acctedit]').forEach((el) => el.onclick = () => acctForm(S.get('accounts', el.dataset.acctedit)));
  root.querySelectorAll('[data-delrule]').forEach((b) => b.onclick = () => S.remove('rules', b.dataset.delrule));
}
export function applyTheme() { const t = localStorage.getItem('theme'); t ? document.documentElement.setAttribute('data-theme', t) : document.documentElement.removeAttribute('data-theme'); }

export const views = {
  more: { render }, networth: { render: networth, mount: mountNetworth }, car: { render: car, mount: mountCar },
  paystubs: { render: paystubs, mount: mountPaystubs }, settings: { render: settings, mount: mountSettings },
};
