// Quick add: log an expense in a few taps. Also used to edit any transaction.
import * as S from '../store.js';
import { h, raw, money, today, toCents } from '../util.js';
import { openSheet, closeSheet, toast, options, formData } from '../ui.js';
import { activeCats, BASELINE_START } from '../calc.js';

const ALIASES = { dates: 'Entertainment/Dates', date: 'Entertainment/Dates', food: 'Food (Eating Out)', lunch: 'Food (Eating Out)', dinner: 'Food (Eating Out)',
  groceries: 'Groceries', grocery: 'Groceries', gifts: 'Gifts', gift: 'Gifts', wants: 'Gifts/Wants for Self', car: 'Car Maintenance', hair: 'Haircuts', haircut: 'Haircuts' };

export function catsByUse() {
  const use = {};
  for (const t of S.all('txns')) if (t.date >= BASELINE_START) use[t.catId] = (use[t.catId] || 0) + 1;
  return activeCats().filter((c) => c.countsAsSpending !== false).sort((a, b) => (use[b.id] || 0) - (use[a.id] || 0) || a.name.localeCompare(b.name));
}

// "gas 42" / "dates 36.45 chili's" -> { amount, catId, note }
export function parseQuick(text) {
  const words = text.trim().split(/\s+/); let amount = null; const rest = [];
  for (const w of words) { const c = /^\$?\d+(\.\d{1,2})?$/.test(w) ? toCents(w) : null; if (c !== null && amount === null) amount = c; else rest.push(w); }
  const cats = activeCats(); let catId = null, used = 0;
  for (let n = Math.min(3, rest.length); n >= 1 && !catId; n--) {
    const phrase = rest.slice(0, n).join(' ').toLowerCase();
    const hit = cats.find((c) => c.name.toLowerCase() === phrase) || cats.find((c) => c.name.toLowerCase().startsWith(phrase) && phrase.length >= 3)
      || (ALIASES[phrase] && cats.find((c) => c.name === ALIASES[phrase]));
    if (hit) { catId = hit.id; used = n; }
  }
  return { amount, catId, note: rest.slice(used).join(' ') };
}

export function openQuickAdd(existing) {
  const prefs = S.setting('prefs');
  const t = existing ? { ...existing } : { date: today(), acctId: prefs.defaultAccount, payer: 'me', oneOff: false, amount: 0 };
  let cents = t.amount || 0;
  const cats = catsByUse();
  const accts = S.all('accounts').filter((a) => !a.isInvestment && !a.closed);
  const draw = () => h`
    <div class="row between"><h2>${existing ? 'Edit transaction' : 'Add expense'}</h2><button class="link" data-close>Close</button></div>
    <input id="qa-text" placeholder='Type "gas 42" or "dates 36.45 chilis"' autocomplete="off" enterkeyhint="done">
    <div class="amount-display num" id="qa-amt">${money(cents)}</div>
    <div class="keypad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map((k) => h`<button type="button" data-k="${k}">${k}</button>`)}</div>
    <h3 style="margin-top:14px">Category</h3>
    <div class="chips" id="qa-cats">${cats.map((c) => h`<button type="button" data-cat="${c.id}" class="${c.id === t.catId ? 'on' : ''}">${c.name}</button>`)}</div>
    <form class="form" id="qa-form" style="margin-top:14px">
      <div class="two">
        <label>Date<input type="date" name="date" value="${t.date}" required></label>
        <label>Paid from<select name="acctId">${options(accts.map((a) => [a.id, a.name]), t.acctId)}</select></label>
      </div>
      <label>Note<input name="note" value="${t.note || ''}" placeholder="Optional"></label>
      <label class="check"><input type="checkbox" name="oneOff" ${t.oneOff ? 'checked' : ''}> One-off (doesn't count toward the monthly budget)</label>
      <details ${t.payer === 'shared' || t.reimb ? 'open' : ''}><summary>More options</summary>
        <div class="form" style="margin-top:8px">
          <label class="check"><input type="checkbox" name="shared" ${t.payer === 'shared' ? 'checked' : ''}> Not paid by me (shared)</label>
          <label class="check"><input type="checkbox" name="reimb" ${t.reimb ? 'checked' : ''}> Reimbursable (work expense)</label>
          ${existing?.merchant ? h`<p class="small muted">Statement: ${existing.merchant}</p>` : ''}
        </div>
      </details>
      <div class="row between">
        ${existing ? h`<button type="button" class="danger" id="qa-del">Delete</button>` : raw('<span></span>')}
        <button class="primary" type="submit">${existing ? 'Save' : 'Add'}</button>
      </div>
    </form>`;
  openSheet(draw(), (root) => {
    const amtEl = root.querySelector('#qa-amt'); let typed = cents ? String(cents / 100) : '';
    const showAmt = () => { amtEl.textContent = money(cents); };
    root.querySelector('[data-close]').onclick = closeSheet;
    root.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => {
      const k = b.dataset.k;
      if (k === '⌫') typed = typed.slice(0, -1); else if (!(k === '.' && typed.includes('.')) && !/\.\d\d$/.test(typed)) typed += k;
      cents = toCents(typed || '0') || 0; showAmt();
    });
    const pick = (id) => { t.catId = id; root.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('on', x.dataset.cat === id)); };
    root.querySelectorAll('[data-cat]').forEach((b) => b.onclick = () => pick(b.dataset.cat));
    const txt = root.querySelector('#qa-text');
    txt.oninput = () => { const p = parseQuick(txt.value); if (p.amount !== null) { cents = p.amount; typed = String(p.amount / 100); showAmt(); } if (p.catId) pick(p.catId); root.querySelector('[name=note]').value = p.note; };
    if (!existing && window.matchMedia('(min-width: 768px)').matches) txt.focus();
    root.querySelector('#qa-del')?.addEventListener('click', async () => { await S.remove('txns', existing.id); closeSheet(); toast('Deleted'); });
    root.querySelector('#qa-form').onsubmit = async (e) => {
      e.preventDefault(); const f = formData(e.target);
      if (!cents) return toast('Enter an amount');
      if (!t.catId) return toast('Pick a category');
      const doc = { ...t, amount: cents, date: f.date, acctId: f.acctId, note: f.note.trim(), oneOff: f.oneOff, reimb: f.reimb, payer: f.shared ? 'shared' : 'me', origin: t.origin || 'quick', status: t.status === 'review' ? 'review' : 'ok' };
      await S.put('txns', doc); closeSheet(); toast(existing ? 'Saved' : `Added ${money(cents)}`);
    };
  });
}
