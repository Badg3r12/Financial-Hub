// Reader for the quarterly 401(k) statement from Ekon Benefits (Savings Spectrum).
// The PDF's own text is scrambled, so text comes from Live Text (a screenshot of pages 1–2, then Copy).
// No account or participant numbers are read.
import { parseDate, MONTHS } from '../util.js';

const NUM = /-?\(?\$?\s?\d{1,3}(?:,\d{3})*\.\d{2}\)?/g;
const nums = (s) => (s.match(NUM) || []).map((x) => { const neg = /^-|\(/.test(x.trim()); const v = Math.round(parseFloat(x.replace(/[^\d.]/g, '')) * 100); return neg ? -v : v; });
const longDate = (s) => { const m = s.match(/([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})/); if (!m) return null; const i = MONTHS.indexOf(m[1]); return i < 0 ? null : `${m[3]}-${String(i + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`; };

export function parseK401(text) {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s*\|\s*/g, ' | ').trim()).filter(Boolean);
  const out = { funds: [] };
  // A label's numbers are on its own line; when the reader wraps them, they sit on the line just before (or after).
  const first = (re, pick = 0) => {
    const i = lines.findIndex((x) => re.test(x)); if (i < 0) return null;
    for (const l of [lines[i].replace(re, ' '), lines[i - 1] || '', lines[i + 1] || '']) { const n = nums(l); if (n.length > pick && !/[A-Za-z]{4,}.*\d.*\|/.test(l.split('|')[0])) return n[pick]; }
    return null;
  };
  const period = lines.find((l) => /[A-Z][a-z]+ \d{1,2}, \d{4}\s*-\s*[A-Z][a-z]+ \d{1,2}, \d{4}/.test(l));
  if (period) { const [a, b] = period.split(/\s-\s/); out.periodStart = longDate(a); out.periodEnd = longDate(b); }
  out.begin = first(/Account Value Beginning of Period/i);
  out.employee = first(/^Employee Roth 401\(?k\)?(?!.*\$\s*$)/i);
  out.employeePretax = first(/^Employee 401\(?k\)?/i);
  out.match = first(/^(Safe Harbor )?Match(ing)?/i);
  out.withdrawals = first(/^Withdrawals/i);
  out.gain = first(/Investment Gain\/?\(?Loss\)?/i);
  const endLine = lines.find((l) => /Account Value on \d/i.test(l));
  if (endLine) { const d = endLine.match(/on (\d{1,2}\/\d{1,2}\/\d{4})/); out.periodEnd ||= parseDate(d?.[1]); const n = nums(endLine.replace(/on \d{1,2}\/\d{1,2}\/\d{4}/, '')); out.end = n[0] ?? null; }
  out.ytdEmployee = first(/^Employee Roth 401\(?k\)?(?!.*\$\s*$)/i, 1);
  out.ytdMatch = first(/^(Safe Harbor )?Match(ing)?/i, 1);
  // Fund rows on page 2: name | category | beginning | withdrawals | contribution | loan | earnings | other | ending | risk ...
  for (const l of lines) {
    const parts = l.split(' | ');
    const ni = parts.findIndex((p) => /^-?\d{1,3}(,\d{3})*\.\d{2}$/.test(p));
    if (ni < 1 || parts.length < ni + 7) continue;
    const v = parts.slice(ni, ni + 7).map((p) => nums(p)[0] ?? 0);
    if (v.length < 7 || !v.some(Boolean) || /^total/i.test(parts[0])) continue;
    const name = parts.slice(0, ni).filter((p) => !/^(Funds?|Bond|Stock|Blend|Value|Growth|Balanced|Stable|Asset)$/i.test(p));
    // The fund name is the longest label piece (scanned text sometimes puts a stray category word first).
    const byLen = [...name].sort((a, b) => b.length - a.length);
    out.funds.push({ name: byLen[0], category: name.find((p) => p !== byLen[0]) || '', begin: v[0], contribution: v[2], earnings: v[4], end: v[6] });
  }
  return out;
}

// Arithmetic check: beginning + contributions − withdrawals + gain = ending (to the cent).
export function checkK401(s) {
  const issues = [];
  if ([s.begin, s.end].some((x) => x == null)) issues.push('Beginning or ending value is missing.');
  else {
    const calc = s.begin + (s.employee || 0) + (s.employeePretax || 0) + (s.match || 0) - Math.abs(s.withdrawals || 0) + (s.gain || 0);
    if (Math.abs(calc - s.end) > 2) issues.push(`Beginning + contributions + gain = ${(calc / 100).toFixed(2)}, but the ending value is ${(s.end / 100).toFixed(2)}.`);
  }
  const fundSum = (s.funds || []).reduce((a, f) => a + (f.end || 0), 0);
  if (s.funds?.length && s.end != null && Math.abs(fundSum - s.end) > 2) issues.push(`Fund balances add up to ${(fundSum / 100).toFixed(2)}, not ${(s.end / 100).toFixed(2)}.`);
  return issues;
}
