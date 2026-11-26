// Inbox: imported statement rows wait here until confirmed. Nothing imported counts until it's confirmed.
import * as S from '../store.js';
import { h, money, shortDate, daysBetween } from '../util.js';
import * as C from '../calc.js';
import { options, toast } from '../ui.js';
import { HINTS } from '../import/bank.js';

const ruleFor = (merchant) => { const m = String(merchant || '').toUpperCase(); return S.all('rules').find((r) => m.includes(r.pattern)); };
export function suggestCat(merchant, hint) {
  const rule = ruleFor(merchant);
  if (rule) return rule.catId;
  const hl = String(hint || '').toLowerCase(), key = Object.keys(HINTS).find((k) => hl.includes(k)), n = key && HINTS[key];
  return n ? S.all('categories').find((c) => c.name === n)?.id : null;
}
export function findMatch(t) {
  return S.all('txns').find((q) => q.origin === 'quick' && q.status !== 'review' && !q.matched && q.acctId === t.acctId && q.amount === t.amount && Math.abs(daysBetween(q.date, t.date)) <= 3);
}
// First words of the merchant, skipping numbers; three words when the second is short ("DEPT OF NATURAL").
const ruleKey = (merchant) => { const w = String(merchant || '').toUpperCase().replace(/[#*]?\d[\d\s#*-]*/g, ' ').replace(/\s+/g, ' ').trim().split(' '); return w.slice(0, (w[1] || '').length < 4 ? 3 : 2).join(' '); };

async function confirmRow(t, { catId, kind }) {
  if (kind === 'ignore') { await S.put('imports', { id: 'ign-' + t.fid, kind: 'ignored', fid: t.fid, date: t.date }); await S.remove('txns', t.id); return; }
  if (kind === 'transfer') { await S.put('transfers', { id: 't-' + t.id, date: t.date, amount: Math.abs(t.amount), acctId: t.acctId, direction: t.amount > 0 ? 'out' : 'in', note: t.merchant, fid: t.fid }); await S.remove('txns', t.id); return; }
  if (kind === 'income') { await S.put('income', { id: 'i-' + t.id, date: t.date, amount: Math.abs(t.amount), source: /PAYROLL|DIR/i.test(t.merchant) ? 'paycheck' : 'other', note: t.merchant, fid: t.fid }); await S.remove('txns', t.id); return; }
  const match = findMatch(t);
  if (match) { await S.put('txns', { ...match, merchant: t.merchant, postedDate: t.date, matched: true, fid: t.fid }); await S.remove('txns', t.id); return; }
  const work = kind === 'work'; // reimbursed work expense: kept on record, never counted as spending
  if (!catId && !work) throw new Error('Pick a category');
  await S.put('txns', { ...t, catId: catId || null, kind: 'spend', reimb: work, oneOff: work || t.oneOff, status: 'ok', note: work ? 'Work expense (reimbursed)' : t.note });
  const key = ruleKey(t.merchant);
  if (key.length >= 3 && !S.all('rules').some((r) => key.includes(r.pattern) || r.pattern.includes(key))) await S.put('rules', { pattern: key, catId: catId || null, work });
}

function render() {
  const rows = S.all('txns').filter((t) => t.status === 'review').sort((a, b) => a.date.localeCompare(b.date));
  const cats = C.activeCats();
  return h`<div class="row between wrap"><h1>Inbox</h1>${rows.length ? h`<button class="primary" id="ib-all">Confirm all ready</button>` : ''}</div>
  <p class="muted">Imported rows wait here. Matches with your Quick add entries merge automatically when confirmed. Choosing a category also saves a rule for that merchant.</p>
  <div class="card">${rows.length ? h`<ul class="list">${rows.map((t) => {
    const m = findMatch(t), sug = t.catId || suggestCat(t.merchant, t.hint), kind = t.kind === 'spend' && ruleFor(t.merchant)?.work ? 'work' : t.kind;
    return h`<li data-row="${t.id}" style="flex-wrap:wrap"><div class="grow" style="min-width:200px"><div class="ellipsis"><b>${t.merchant}</b></div>
      <div class="small muted">${shortDate(t.date)} · ${C.acct(t.acctId)?.name || ''}${m ? h` · <span class="good">matches your entry "${m.note || C.cat(m.catId)?.name}"</span>` : ''}</div></div>
      <div class="num" style="min-width:90px;text-align:right">${money(t.amount)}</div>
      <div class="row" style="width:100%;gap:6px"><select data-kind style="width:auto">${options([['spend', t.amount < 0 ? 'Refund' : 'Spending'], ['work', 'Work (reimbursed)'], ['transfer', 'Transfer'], ['income', 'Income'], ['ignore', 'Ignore']], kind || 'spend')}</select>
      <select data-cat ${m ? 'disabled' : ''}>${options([['', 'Category…'], ...cats.map((c) => [c.id, c.name])], sug || '')}</select><button data-ok>✓</button></div></li>`; })}</ul>`
    : h`<p class="empty">All caught up. Import a statement from the Import screen.</p>`}</div>`;
}

function mount(root) {
  const read = (li) => ({ kind: li.querySelector('[data-kind]').value, catId: li.querySelector('[data-cat]').value });
  root.querySelectorAll('[data-row]').forEach((li) => {
    const sync = () => { li.querySelector('[data-cat]').style.visibility = read(li).kind === 'spend' ? 'visible' : 'hidden'; };
    li.querySelector('[data-kind]').onchange = sync; sync();
    li.querySelector('[data-ok]').onclick = async () => { try { await confirmRow(S.get('txns', li.dataset.row), read(li)); } catch (e) { toast(e.message); } };
  });
  root.querySelector('#ib-all')?.addEventListener('click', async () => {
    let n = 0;
    for (const li of root.querySelectorAll('[data-row]')) {
      const t = S.get('txns', li.dataset.row), v = read(li);
      if (v.kind !== 'spend' || v.catId || findMatch(t)) { await confirmRow(t, v); n++; } // 'work' needs no category
    }
    toast(`Confirmed ${n}. Rows without a category are still here.`);
  });
}
export const views = { inbox: { render, mount } };
