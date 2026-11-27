import * as S from '../store.js';
import { h, money, money0, today, shortDate, toCents, pct } from '../util.js';
import * as C from '../calc.js';
import { ring } from '../charts.js';
import { openSheet, closeSheet, toast, options, formData } from '../ui.js';

function render() {
  const funds = S.all('funds').sort((a, b) => a.name.localeCompare(b.name));
  const pay = S.setting('paycheck', { splits: [], funds: [] });
  const contribs = S.all('contributions').sort((a, b) => b.date.localeCompare(a.date));
  const total = funds.reduce((a, f) => a + C.fundBalance(f.id), 0);
  const bucketAccts = [...new Set(funds.map((f) => f.acctId).filter(Boolean))];
  if (!funds.length) return h`<div class="row between wrap"><h1>Goals</h1></div>
    <div class="card empty stack" style="align-items:center"><p style="margin:0">No savings goals yet. Make one for each savings bucket (Emergency Fund, Car, Vacation…).</p><button class="primary" id="g-new">New goal</button></div>`;
  return h`<div class="row between wrap"><h1>Goals</h1><div class="row wrap"><button id="g-new">New goal</button><button id="g-rec">Match bank balances</button><button class="primary" id="g-apply">Apply paycheck</button></div></div>
  <p class="muted">Savings goals total <b class="num">${money(total)}</b>.</p>
  ${bucketAccts.map((id) => { const b = C.buckets(id); return h`<div class="notice" style="margin-bottom:12px">Savings buckets in <b>${C.acct(id)?.name}</b>: ${money(b.inBuckets)} in buckets${b.balance != null ? h` of ${money(b.balance)} balance (${shortDate(b.asOf)}) · <span class="${b.unassigned < 0 ? 'warn' : ''}">${money(b.unassigned)} not in a bucket</span>` : ''}</div>`; })}
  <div class="grid cols-3">${funds.map((f) => { const st = C.fundStatus(f); return h`<div class="card tap" data-fund="${f.id}">
    <div class="row">${ring(st.progress ?? 0)}<div class="grow"><b>${f.name}</b><div class="num">${money(st.bal)}${f.target ? h` <span class="muted">of ${money0(f.target)}</span>` : ''}</div>
    <div class="small ${st.onTrack === false ? 'warn' : st.onTrack ? 'good' : 'muted'}">${st.onTrack == null ? 'Set a target' : st.onTrack ? `On track · ${pct(st.progress, 0)}` : `Behind · due ${shortDate(f.targetDate)}`}</div></div></div></div>`; })}</div>
  <div class="grid cols-2" style="margin-top:14px">
    <div class="card"><div class="row between"><h2>Paycheck template</h2><button class="link" id="g-tpl">Edit</button></div>
      <p class="small muted">Net ${money(pay.net)} · Roth 401k ${money(pay.k401)}</p>
      <ul class="list">${(pay.splits || []).map(([d, a]) => h`<li><span class="grow">${d}</span><span class="num">${money(a)}</span></li>`)}</ul>
      <h3 style="margin-top:10px">Into goals each paycheck</h3>
      <ul class="list">${(pay.funds || []).map(([id, a]) => h`<li><span class="grow">${S.get('funds', id)?.name || '(deleted goal)'}</span><span class="num">${money(a)}</span></li>`)}</ul>
      ${(pay.funds || []).length ? '' : h`<p class="small muted">Not set up yet. Choose Edit to say how much goes to each goal per paycheck.</p>`}</div>
    <div class="card"><h2>Contribution history</h2><ul class="list">${contribs.slice(0, 40).map((c) => h`<li><div class="grow">${S.get('funds', c.fundId)?.name || '—'}<div class="small muted">${shortDate(c.date)}${c.note ? ' · ' + c.note : ''}</div></div><span class="num ${c.amount < 0 ? 'bad' : ''}">${money(c.amount)}</span><button class="link x-btn" data-delc="${c.id}" aria-label="Delete ${S.get('funds', c.fundId)?.name || ''} ${money(c.amount)} on ${shortDate(c.date)}">✕</button></li>`)}</ul>
      ${contribs.length ? '' : h`<p class="muted">No contributions yet.</p>`}</div>
  </div>`;
}

function editFund(f = { name: '', target: null, targetDate: null }) {
  openSheet(h`<div class="row between"><h2>${f.id ? f.name : 'New goal'}</h2><button class="link" data-close>Close</button></div><form class="form" id="ff">
    <label>Name<input name="name" value="${f.name}" required></label>
    <div class="two"><label>Target amount<input name="target" inputmode="decimal" value="${f.target ? f.target / 100 : ''}"></label><label>Target date<input type="date" name="targetDate" value="${f.targetDate || ''}"></label></div>
    <label>Kept in (savings bucket of)<select name="acctId">${options([['', 'Not linked to an account'], ...S.all('accounts').filter((a) => /savings/i.test(a.type)).map((a) => [a.id, a.name])], f.acctId || '')}</select></label>
    ${f.id ? h`<h3>Add money in or take money out</h3>
      <div class="tabs" role="radiogroup" aria-label="Direction" style="margin:0"><label class="seg"><input type="radio" name="dir" value="in" checked> Put in</label><label class="seg"><input type="radio" name="dir" value="out"> Take out</label></div>
      <div class="two"><label>Amount<input name="amt" inputmode="decimal" placeholder="0.00"></label><label>Date<input type="date" name="date" value="${today()}"></label></div>` : ''}
    <div class="row between"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div>
    ${f.id ? h`<button type="button" class="link danger-link" id="fdel" style="justify-self:start">Delete this goal…</button>` : ''}</form>`, (root) => {
    root.querySelector('#fdel')?.addEventListener('click', async () => { if (confirm(`Delete ${f.name} and its contributions?`)) { await S.removeMany('contributions', S.all('contributions').filter((c) => c.fundId === f.id).map((c) => c.id)); await S.remove('funds', f.id); closeSheet(); } });
    root.querySelector('#ff').onsubmit = async (e) => {
      e.preventDefault(); const d = formData(e.target);
      const doc = await S.put('funds', { ...f, name: d.name.trim(), target: toCents(d.target), targetDate: d.targetDate || null, acctId: d.acctId || null });
      const amt = toCents(d.amt); if (amt) await S.put('contributions', { fundId: doc.id, date: d.date, amount: d.dir === 'out' ? -Math.abs(amt) : Math.abs(amt) });
      closeSheet(); toast(amt ? `${d.dir === 'out' ? 'Took out' : 'Added'} ${money(Math.abs(amt))}` : 'Saved');
    };
  });
}

function applyPaycheck() {
  const pay = S.setting('paycheck', { funds: [] });
  if (!pay.funds?.length) return openSheet(h`<div class="row between"><h2>Apply paycheck</h2><button class="link" data-close>Close</button></div>
    <p>Set up your paycheck template first, so the app knows how much goes to each goal.</p><div class="row"><button class="primary" id="ap-tpl">Set up template</button></div>`, (r) => { r.querySelector('#ap-tpl').onclick = editTemplate; });
  openSheet(h`<h2>Apply paycheck</h2><p class="muted small">Adds each goal's amount from the template, dated the paycheck date.</p><form class="form" id="ap">
    <label>Paycheck date<input type="date" name="date" value="${today()}"></label>
    <ul class="list">${pay.funds.map(([id, a]) => h`<li><span class="grow">${S.get('funds', id)?.name}</span><span class="num">${money(a)}</span></li>`)}</ul>
    <div class="row between"><button type="button" data-close>Cancel</button><button class="primary">Add contributions</button></div></form>`, (root) => {
    root.querySelector('#ap').onsubmit = async (e) => {
      e.preventDefault(); const date = e.target.date.value;
      if (S.all('contributions').some((c) => c.note === 'Paycheck' && c.date === date) && !confirm(`A paycheck was already applied on ${shortDate(date)}. Add it again?`)) return;
      await S.putMany('contributions', pay.funds.filter(([id]) => S.get('funds', id)).map(([fundId, amount]) => ({ fundId, date, amount, note: 'Paycheck' })));
      closeSheet(); toast('Contributions added');
    };
  });
}

function editTemplate() {
  const pay = S.setting('paycheck', { net: 0, k401: 0, splits: [], funds: [] }), funds = S.all('funds');
  const amt = (id) => (pay.funds.find((x) => x[0] === id)?.[1] ?? 0) / 100;
  openSheet(h`<h2>Paycheck template</h2><form class="form" id="tf">
    <div class="two"><label>Net pay<input name="net" inputmode="decimal" value="${pay.net / 100}"></label><label>Roth 401k per paycheck<input name="k401" inputmode="decimal" value="${pay.k401 / 100}"></label></div>
    <h3>Where net pay goes</h3>${['Checking', 'Savings', 'Brokerage', 'Other'].map((d) => h`<label>${d}<input name="s-${d}" inputmode="decimal" value="${(pay.splits.find((x) => x[0] === d)?.[1] ?? 0) / 100}"></label>`)}
    <h3>Into goals (comes out of Savings)</h3>${funds.map((f) => h`<label>${f.name}<input name="f-${f.id}" inputmode="decimal" value="${amt(f.id)}"></label>`)}
    <p class="small muted" id="tf-check"></p>
    <div class="row between"><button type="button" data-close>Cancel</button><button class="primary">Save template</button></div></form>`, (root) => {
    const form = root.querySelector('#tf'), chk = root.querySelector('#tf-check');
    const check = () => { const d = formData(form); const net = toCents(d.net) || 0; const sp = ['Checking', 'Savings', 'Brokerage', 'Other'].reduce((a, k) => a + (toCents(d['s-' + k]) || 0), 0);
      const fs = funds.reduce((a, f) => a + (toCents(d['f-' + f.id]) || 0), 0), sav = toCents(d['s-Savings']) || 0;
      chk.innerHTML = `Allocated ${money(sp)} of ${money(net)} net (${money(net - sp)} left). Goals ${money(fs)} vs Savings ${money(sav)}${fs > sav ? ' <b class="warn">— goals exceed the Savings line</b>' : ''}.`; };
    form.oninput = check; check();
    form.onsubmit = async (e) => {
      e.preventDefault(); const d = formData(form);
      await S.saveSetting('paycheck', { net: toCents(d.net) || 0, k401: toCents(d.k401) || 0,
        splits: ['Checking', 'Savings', 'Brokerage', 'Other'].map((k) => [k, toCents(d['s-' + k]) || 0]).filter((x) => x[1]),
        funds: funds.map((f) => [f.id, toCents(d['f-' + f.id]) || 0]).filter((x) => x[1]) });
      closeSheet(); toast('Template saved');
    };
  });
}

// Type in each bucket's balance from the bank app; the app adds an adjustment so they agree.
function reconcile() {
  const funds = S.all('funds').sort((a, b) => a.name.localeCompare(b.name));
  if (!funds.length) return toast('Make a goal first');
  openSheet(h`<h2>Match bank balances</h2><p class="small muted">Enter each bucket's balance as your bank shows it. Any difference is recorded as an adjustment dated today.</p><form class="form" id="rf">
    ${funds.map((f) => h`<label>${f.name} <span class="muted">(app: ${money(C.fundBalance(f.id))})</span><input name="f-${f.id}" inputmode="decimal" placeholder="${(C.fundBalance(f.id) / 100).toFixed(2)}"></label>`)}
    <label>Date<input type="date" name="date" value="${today()}"></label>
    <div class="row between"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div></form>`, (r) => {
    r.querySelector('#rf').onsubmit = async (e) => {
      e.preventDefault(); const d = formData(e.target);
      const adj = funds.map((f) => ({ f, v: toCents(d['f-' + f.id]) })).filter((x) => x.v !== null && x.v !== C.fundBalance(x.f.id))
        .map((x) => ({ fundId: x.f.id, date: d.date, amount: x.v - C.fundBalance(x.f.id), note: 'Matched to bank balance' }));
      await S.putMany('contributions', adj); closeSheet(); toast(adj.length ? `${adj.length} bucket${adj.length > 1 ? 's' : ''} adjusted` : 'Everything already matched');
    };
  });
}

function mount(root) {
  root.querySelector('#g-new').onclick = () => editFund();
  root.querySelector('#g-rec')?.addEventListener('click', reconcile);
  root.querySelector('#g-apply')?.addEventListener('click', applyPaycheck);
  root.querySelector('#g-tpl')?.addEventListener('click', editTemplate);
  root.querySelectorAll('[data-fund]').forEach((el) => el.onclick = () => editFund(S.get('funds', el.dataset.fund)));
  root.querySelectorAll('[data-delc]').forEach((b) => b.onclick = async () => {
    const c = S.get('contributions', b.dataset.delc); await S.remove('contributions', c.id);
    toast(`Deleted ${money(c.amount)} from ${S.get('funds', c.fundId)?.name || 'goal'}`, { action: 'Undo', onAction: () => S.put('contributions', c) });
  });
}
export const views = { goals: { render, mount } };
