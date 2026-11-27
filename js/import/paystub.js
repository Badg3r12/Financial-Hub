// Paystub text reader: works on text copied from a screenshot with Apple Live Text (iPhone Photos or Mac Preview).
// No AI or network involved. Labels vary by employer, so each field has synonyms; adjust them here if the Ajera stub uses others.
import { toCents, parseDate } from '../util.js';

export const PAYSTUB_FIELDS = [
  ['payDate', 'Pay date', 'date'], ['periodStart', 'Period start', 'date'], ['periodEnd', 'Period end', 'date'],
  ['gross', 'Gross pay'], ['federal', 'Federal withholding'], ['state', 'State withholding'], ['socialSecurity', 'Social Security'], ['medicare', 'Medicare'],
  ['roth401k', 'Roth 401k (you)'], ['match', 'Employer 401k match'], ['health', 'Health / dental / vision'], ['hsa', 'HSA / FSA'], ['otherDeductions', 'Other deductions'],
  ['reimbursed', 'Reimbursed expenses (added to pay)'], ['net', 'Net pay (deposit)'], ['ytdGross', 'Gross year-to-date'], ['ytdRoth401k', 'Roth 401k year-to-date'],
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

// Labels for amount fields, matched anywhere in a line (paystubs often print two columns of labels side by side).
const SEG = {
  gross: /total pay|gross pay|total earnings/i, federal: /federal withholding|federal income tax|fed(eral)? w\/?h|\bfitw\b/i,
  state: /missouri withholding|state withholding|state income tax|\bmo w\/?h\b|\bsitw\b/i,
  socialSecurity: /social security(?!\s*-\s*employer)|\boasdi\b/i, medicare: /medicare(?!\s*-\s*employer)/i,
  roth401k: /401\s*\(?k\)?\s*-?\s*roth|roth\s*401\s*\(?k\)?/i, match: /401\s*\(?k\)?\s*match(ing)?|employer match|safe harbor match/i,
  health: /medical|dental|vision|health ins/i, hsa: /\bhsa\b|\bfsa\b/i, net: /net pay|net check|take home/i, reimbursed: /reimbursed expenses|reimbursement/i,
};
const D = (s) => { const m = s.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/); return m ? parseDate(`${m[1]}/${m[2]}/${m[3]}`) : null; };

// For each label, read the amounts right after it, up to the next label: [hours] [rate] current year-to-date.
export function parsePaystub(text) {
  const out = {}, lines = text.split(/\r?\n/).map((l) => l.replace(/[\][(){}]/g, ' ').trim()).filter(Boolean);
  const take = (k, v) => { if (out[k] == null && v != null && !Number.isNaN(v)) out[k] = v; };
  for (const line of lines) {
    const pp = line.match(/PAY PERIOD\s+(\S+)\s+TO\s+(\S+)/i); if (pp) { take('periodStart', D(pp[1])); take('periodEnd', D(pp[2])); }
    const pd = line.match(/(?:PAY |CHECK )?DATE[:\s|]+(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i); if (pd) take('payDate', D(pd[1]));
    for (const [key, re] of Object.entries(SEG)) {
      const m = line.match(re); if (!m) continue;
      if (key === 'match' && /roth/i.test(m[0])) continue;
      const rest = line.slice(m.index + m[0].length), stop = rest.search(/[A-Za-z]{4,}/);
      const amts = ((stop < 0 ? rest : rest.slice(0, stop)).match(AMT) || []).map((a) => toCents(a));
      if (!amts.length) continue;
      if (key === 'reimbursed') { if (amts.length >= 2) take('reimbursed', Math.abs(amts.at(-2))); take('reimbursedYTD', Math.abs(amts.at(-1))); continue; }
      const vals = amts.length >= 3 ? amts.slice(-2) : amts; // drop hours/rate columns
      take(key, Math.abs(vals[0]));
      if (vals.length > 1) take('ytd' + key[0].toUpperCase() + key.slice(1), Math.abs(vals[1]));
    }
  }
  return out;
}

// Arithmetic checks before saving. Returns a list of problems (empty = all good).
export function checkPaystub(p, others = []) {
  const issues = [], c = (k) => p[k] || 0;
  if (p.gross != null && p.net != null) {
    const ded = c('federal') + c('state') + c('socialSecurity') + c('medicare') + c('roth401k') + c('health') + c('hsa') + c('otherDeductions');
    const diff = p.gross - ded + c('reimbursed') - p.net; // reimbursed expenses are paid on top of net pay
    if (Math.abs(diff) > 1) issues.push(`Gross minus taxes and deductions is ${(diff / 100).toFixed(2)} away from net pay (a figure may be misread or missing, or put it in "Other deductions").`);
  }
  if (p.gross && p.socialSecurity && Math.abs(p.socialSecurity - Math.round(p.gross * 0.062)) > Math.max(100, p.gross * 0.01)) issues.push('Social Security is usually 6.2% of gross pay; check that figure.');
  if (p.gross && p.medicare && Math.abs(p.medicare - Math.round(p.gross * 0.0145)) > Math.max(50, p.gross * 0.005)) issues.push('Medicare is usually 1.45% of gross pay; check that figure.');
  const prev = others.filter((o) => o.payDate < p.payDate && o.payDate?.slice(0, 4) === p.payDate?.slice(0, 4)).sort((a, b) => a.payDate.localeCompare(b.payDate)).at(-1);
  if (prev && prev.ytdGross && p.ytdGross && Math.abs(prev.ytdGross + p.gross - p.ytdGross) > 1) issues.push(`Year-to-date gross doesn't follow from the previous stub (${(prev.ytdGross / 100).toFixed(2)} + this gross).`);
  if (others.some((o) => o.payDate === p.payDate && o.net === p.net)) issues.push('A paystub with the same date and net pay already exists.');
  return issues;
}
