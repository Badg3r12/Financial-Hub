// Paystub text reader: works on text copied from a screenshot with Apple Live Text (iPhone Photos or Mac Preview).
// No AI or network involved. Labels vary by employer, so each field has synonyms; adjust them here if the Ajera stub uses others.
import { toCents, parseDate } from '../util.js';

export const PAYSTUB_FIELDS = [
  ['payDate', 'Pay date', 'date'], ['periodStart', 'Period start', 'date'], ['periodEnd', 'Period end', 'date'],
  ['gross', 'Gross pay'], ['federal', 'Federal withholding'], ['state', 'State withholding'], ['socialSecurity', 'Social Security'], ['medicare', 'Medicare'],
  ['roth401k', 'Roth 401k (you)'], ['match', 'Employer 401k match'], ['health', 'Health / dental / vision'], ['hsa', 'HSA / FSA'], ['otherDeductions', 'Other deductions'],
  ['net', 'Net pay'], ['ytdGross', 'Gross year-to-date'], ['ytdRoth401k', 'Roth 401k year-to-date'],
];

const LABELS = {
  payDate: [/pay\s*date|check\s*date|date\s*paid|^date\b|\bdate\s+\d/i], periodStart: [/period\s*(begin|start)|begin\s*date|\bfrom\b/i], periodEnd: [/period\s*end|end\s*date|through|\bto\b/i],
  gross: [/^gross(\s*pay|\s*earnings)?|total\s*(gross|earnings|pay)/i], federal: [/fed(eral)?\s*(income\s*)?(tax|w\/?h|withholding)|fitw/i],
  state: [/state\s*(income\s*)?(tax|w\/?h|withholding)|missouri\s*(tax|w\/?h|withholding)|\bmo\s*(tax|w\/?h)|\bsitw/i], socialSecurity: [/^social\s*security(?!\s*-\s*employer)|soc\s*sec|oasdi|fica\s*-?\s*ss/i],
  medicare: [/^medicare(?!\s*-\s*employer)|fica\s*-?\s*med/i], roth401k: [/roth\s*401\s*\(?k\)?|401\s*\(?k\)?\s*-?\s*roth/i], match: [/401\s*\(?k\)?\s*match|match|employer\s*401|er\s*401|401\s*\(?k\)?\s*(er|employer)/i],
  health: [/medical|health|dental|vision/i], hsa: [/\bhsa\b|\bfsa\b/i], net: [/net\s*(pay|amount|check)|take\s*home/i],
};
const AMT = /-?\$?\(?\d{1,3}(,\d{3})*(\.\d{2})\)?|-?\$?\d+\.\d{2}/g;
const DATE = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/g;

// For each line: find a label; the first amount on the line is "current", the last is often "year-to-date".
export function parsePaystub(text) {
  const out = {}, lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const take = (key, val) => { if (out[key] == null && val != null) out[key] = val; };
  lines.forEach((line, i) => {
    const next = lines[i + 1] || '';
    for (const [key, res] of Object.entries(LABELS)) {
      if (!res.some((re) => re.test(line))) continue;
      const isDate = ['payDate', 'periodStart', 'periodEnd'].includes(key);
      if (isDate) { const d = (line.match(DATE) || next.match(DATE) || [])[0]; take(key, parseDate(d)); continue; }
      if (key === 'match' && /roth/i.test(line)) continue;
      if (key === 'gross' && /ytd|year/i.test(line) && !/current/i.test(line)) continue;
      const amts = (line.match(AMT) || next.match(AMT) || []).map((a) => Math.abs(toCents(a)));
      if (!amts.length) continue;
      // Lines read "label [hours] [rate] current year-to-date": current is second to last when there are two or more amounts.
      take(key, amts.length > 1 ? amts.at(-2) : amts[0]);
      if (amts.length > 1 && key === 'gross') take('ytdGross', amts.at(-1));
      if (amts.length > 1 && key === 'roth401k') take('ytdRoth401k', amts.at(-1));
    }
  });
  return out;
}

// Arithmetic checks before saving. Returns a list of problems (empty = all good).
export function checkPaystub(p, others = []) {
  const issues = [], c = (k) => p[k] || 0;
  if (p.gross != null && p.net != null) {
    const ded = c('federal') + c('state') + c('socialSecurity') + c('medicare') + c('roth401k') + c('health') + c('hsa') + c('otherDeductions');
    const diff = p.gross - ded - p.net;
    if (Math.abs(diff) > 1) issues.push(`Gross minus taxes and deductions is ${(diff / 100).toFixed(2)} away from net pay (a figure may be misread or missing, or put it in "Other deductions").`);
  }
  if (p.gross && p.socialSecurity && Math.abs(p.socialSecurity - Math.round(p.gross * 0.062)) > Math.max(100, p.gross * 0.01)) issues.push('Social Security is usually 6.2% of gross pay; check that figure.');
  if (p.gross && p.medicare && Math.abs(p.medicare - Math.round(p.gross * 0.0145)) > Math.max(50, p.gross * 0.005)) issues.push('Medicare is usually 1.45% of gross pay; check that figure.');
  const prev = others.filter((o) => o.payDate < p.payDate && o.payDate?.slice(0, 4) === p.payDate?.slice(0, 4)).sort((a, b) => a.payDate.localeCompare(b.payDate)).at(-1);
  if (prev && prev.ytdGross && p.ytdGross && Math.abs(prev.ytdGross + p.gross - p.ytdGross) > 1) issues.push(`Year-to-date gross doesn't follow from the previous stub (${(prev.ytdGross / 100).toFixed(2)} + this gross).`);
  if (others.some((o) => o.payDate === p.payDate && o.net === p.net)) issues.push('A paystub with the same date and net pay already exists.');
  return issues;
}
