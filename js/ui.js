// UI plumbing: bottom sheet / dialog, toast, simple form helpers, icons.
import { h, raw } from './util.js';

const sheet = () => document.getElementById('sheet');
export function openSheet(html, onMount) {
  const d = sheet(); document.getElementById('sheet-body').innerHTML = (html.__raw ?? html);
  if (!d.open) d.showModal();
  onMount?.(document.getElementById('sheet-body'));
}
export function closeSheet() { const d = sheet(); if (d.open) d.close(); }
document.addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });

let tt;
export function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2600); }

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
