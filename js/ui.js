// UI plumbing: bottom sheet / dialog, toast, simple form helpers, icons.
import { h, raw } from './util.js';

const sheet = () => document.getElementById('sheet');
let dirty = false; // something was typed or changed in the open sheet
export function openSheet(html, onMount) {
  const d = sheet(), body = document.getElementById('sheet-body'); body.innerHTML = (html.__raw ?? html);
  dirty = false;
  if (!d.open) d.showModal();
  body.scrollTop = 0;
  body.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeSheet()));
  onMount?.(body);
  decorateTaps(body);
}
export function closeSheet() { const d = sheet(); dirty = false; if (d.open) d.close(); }
// Tapping outside the sheet or pressing Escape asks first when the form has unsaved changes.
const tryDismiss = () => { if (!dirty || confirm('Discard your changes?')) closeSheet(); };
document.addEventListener('click', (e) => { if (e.target.id === 'sheet') tryDismiss(); });
document.addEventListener('input', (e) => { if (e.target.closest?.('#sheet-body')) dirty = true; });
document.addEventListener('change', (e) => { if (e.target.closest?.('#sheet-body')) dirty = true; });
let cancelHooked = false;
const hookCancel = () => { if (cancelHooked || !sheet()) return; cancelHooked = true; sheet().addEventListener('cancel', (e) => { e.preventDefault(); tryDismiss(); }); };
hookCancel(); document.addEventListener('DOMContentLoaded', hookCancel);

// Rows that open something on tap get keyboard focus and Enter/Space, like buttons.
export function decorateTaps(root) {
  root.querySelectorAll('.tap:not(a):not(button)').forEach((el) => { if (!el.hasAttribute('tabindex')) { el.tabIndex = 0; el.setAttribute('role', 'button'); } });
}
document.addEventListener('keydown', (e) => {
  const el = e.target; if ((e.key === 'Enter' || e.key === ' ') && el?.classList?.contains('tap') && el.getAttribute('role') === 'button') { e.preventDefault(); el.click(); }
});

// Short message at the bottom. Shown inside an open sheet so it isn't hidden behind it.
// toast('Deleted', { action: 'Undo', onAction: () => ... }) adds a button for a few seconds.
let tt;
export function toast(msg, { action, onAction, ms } = {}) {
  const t = document.getElementById('toast'), d = sheet();
  (d?.open ? d : document.body).append(t);
  t.innerHTML = ''; const span = document.createElement('span'); span.textContent = msg; t.append(span);
  if (action) { const b = document.createElement('button'); b.type = 'button'; b.textContent = action; b.onclick = () => { t.classList.remove('show'); onAction?.(); }; t.append(b); }
  t.classList.toggle('has-action', !!action); t.classList.add('show');
  clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), ms || (action ? 6000 : 2600));
}

// Progress panel for anything that reads or saves files. Stays put while screens redraw.
// const pr = progress('Reading statement'); pr.set(0.4, 'Page 2 of 5'); pr.done('Saved');  (set(null) = working, no %)
let prEl = null, prHide;
function prPanel() {
  if (!prEl) {
    prEl = document.createElement('div'); prEl.id = 'progress'; prEl.setAttribute('role', 'status');
    prEl.innerHTML = '<div class="pr-row"><span class="pr-label"></span><span class="pr-pct num"></span></div><div class="pr-track" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div class="pr-fill"></div></div><div class="pr-sub small muted"></div>';
    document.body.append(prEl);
  }
  return prEl;
}
export function progress(label) {
  const el = prPanel(); clearTimeout(prHide);
  const q = (c) => el.querySelector(c), track = q('.pr-track'), fill = q('.pr-fill');
  el.classList.remove('done', 'failed'); el.classList.add('show');
  const api = {
    set(frac, sub, newLabel) {
      if (newLabel) q('.pr-label').textContent = newLabel;
      if (sub !== undefined) q('.pr-sub').textContent = sub || '';
      if (frac == null) { track.classList.add('busy'); fill.style.width = ''; q('.pr-pct').textContent = ''; track.removeAttribute('aria-valuenow'); return api; }
      const pct = Math.max(0, Math.min(100, Math.round(frac * 100)));
      track.classList.remove('busy'); fill.style.width = pct + '%'; q('.pr-pct').textContent = pct + '%'; track.setAttribute('aria-valuenow', pct);
      return api;
    },
    done(msg, failed) {
      api.set(1, msg || ''); el.classList.add(failed ? 'failed' : 'done');
      if (failed) q('.pr-pct').textContent = '';
      prHide = setTimeout(() => el.classList.remove('show'), failed ? 6000 : 2200);
    },
    fail(msg) { api.done(msg || 'Something went wrong', true); },
  };
  q('.pr-label').textContent = label; return api.set(null, '');
}
// Run an async job with an indeterminate progress panel.
export async function busy(label, fn, doneMsg = 'Done') {
  const pr = progress(label);
  try { const r = await fn(pr); pr.done(typeof doneMsg === 'function' ? doneMsg(r) : doneMsg); return r; }
  catch (e) { pr.fail(e.message); throw e; }
}

export function confirmBox(msg) { return window.confirm(msg); }

// Read a form into a plain object.
export function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    o[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return o;
}

export const options = (items, sel) => raw(items.map(([v, label]) => `<option value="${String(v).replace(/"/g, '&quot;')}"${v === sel ? ' selected' : ''}>${String(label).replace(/</g, '&lt;')}</option>`).join(''));

const P = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  budget: 'M4 19V9m6 10V5m6 14v-7m4 7H2',
  invest: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  goals: 'M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5M12 11a1 1 0 1 0 1 1',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  inbox: 'M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6z',
  import: 'M12 3v12m-5-5l5 5 5-5M4 21h16',
};
export const icon = (n) => raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[n]}"/></svg>`);

export const empty = (msg) => h`<div class="empty">${msg}</div>`;
