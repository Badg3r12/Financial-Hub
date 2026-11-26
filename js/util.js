// Small shared helpers. Money is integer cents everywhere; dates are 'YYYY-MM-DD' strings.

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function toCents(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Math.round(v * 100);
  let s = String(v).trim();
  if (!s) return null;
  let neg = /^\(.*\)$/.test(s) || s.startsWith('-');
  s = s.replace(/[$,()\s-]/g, '');
  if (!s || isNaN(+s)) return null;
  const c = Math.round(parseFloat(s) * 100);
  return neg ? -c : c;
}

const fmtUSD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const money = (c) => (c === null || c === undefined || isNaN(c)) ? '—' : fmtUSD.format(c / 100);
export const money0 = (c) => (c === null || c === undefined || isNaN(c)) ? '—' :
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(c / 100);
export const pct = (x, d = 1) => (x === null || !isFinite(x)) ? '—' : (x * 100).toFixed(d) + '%';
export const signed = (c) => (c > 0 ? '+' : '') + money(c);

export const today = () => new Date().toLocaleDateString('en-CA');
export const ym = (d) => d.slice(0, 7);
export const thisMonth = () => today().slice(0, 7);
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (m) => { const [y, mo] = m.split('-'); return MONTHS[+mo - 1] + ' ' + y; };
export const shortDate = (d) => d ? new Date(d + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.slice(0, 4) === today().slice(0, 4) ? undefined : 'numeric' }) : '';
export function addMonths(m, n) { const [y, mo] = m.split('-').map(Number); const t = y * 12 + mo - 1 + n; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`; }
export function monthsBetween(a, b) { const [y1, m1] = a.split('-').map(Number), [y2, m2] = b.split('-').map(Number); return (y2 - y1) * 12 + (m2 - m1); }
export function daysBetween(a, b) { return Math.round((new Date(b + 'T12:00') - new Date(a + 'T12:00')) / 864e5); }

// Parse many date styles: 2026-01-26, 01/26/2026, 6/26/26, Excel serials.
export function parseDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5); return d.toISOString().slice(0, 10); }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; }
  const t = Date.parse(s); if (!isNaN(t)) return new Date(t).toLocaleDateString('en-CA');
  return null;
}

// RFC-4180-ish CSV parser (quotes, commas, CRLF).
export function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Tagged template that escapes interpolations unless wrapped with raw().
export const raw = (s) => ({ __raw: String(s) });
export function h(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => {
    if (Array.isArray(v)) out += v.map((x) => (x && x.__raw !== undefined) ? x.__raw : esc(x)).join('');
    else out += (v && v.__raw !== undefined) ? v.__raw : esc(v);
    out += strings[i + 1];
  });
  return raw(out);
}

export const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + (f(x) || 0), 0);
export const groupBy = (arr, f) => arr.reduce((m, x) => { const k = f(x); (m[k] ||= []).push(x); return m; }, {});
export const normName = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
// Stable key for dedup of imported rows (no account numbers are ever part of it).
export const fid = (...parts) => parts.map((p) => String(p ?? '').toUpperCase().replace(/\s+/g, ' ').trim()).join('|');

// Drop any column that looks like an account/card/plan number. Applied to every import.
export const SENSITIVE_HEADER = /account\s*(number|no|#)|acct|card\s*(no|number|#)|plan\s*number|routing/i;
