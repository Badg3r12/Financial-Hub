// Bank and card statement CSVs: Capital One (Debit/Credit columns), Discover (signed Amount, purchases positive),
// or any bank CSV with date / description / amount columns. Account and card number columns are dropped on read.
import { parseCSV, parseDate, toCents, SENSITIVE_HEADER } from '../util.js';

export function parseBankCSV(text, { isCard } = {}) {
  const rows = parseCSV(text).filter((r) => r.some((c) => c.trim()));
  const hi = rows.findIndex((r) => r.some((c) => /date/i.test(c)) && r.some((c) => /desc|memo|payee|name|merchant/i.test(c)));
  if (hi < 0) throw new Error("Couldn't find a header row with a date and a description column.");
  const header = rows[hi].map((c) => c.trim());
  const keep = header.map((hd) => !SENSITIVE_HEADER.test(hd));
  const col = (re) => header.findIndex((hd, i) => keep[i] && re.test(hd));
  const iDate = col(/^(trans(action)?\.?\s*date|date)$/i) >= 0 ? col(/^(trans(action)?\.?\s*date|date)$/i) : col(/date/i);
  const iDesc = col(/desc|memo|payee|merchant|name/i), iCat = col(/category/i);
  const iDebit = col(/^debit|withdrawal/i), iCredit = col(/^credit|deposit/i), iAmt = col(/^amount|^amt/i);
  const layout = iDebit >= 0 && iCredit >= 0 ? 'debitcredit' : header.some((x) => /^Trans\.\s*Date$/i.test(x)) ? 'discover' : 'signed';
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    const date = parseDate(r[iDate]); if (!date) continue;
    let outflow; // positive = money spent / charged
    if (layout === 'debitcredit') outflow = (toCents(r[iDebit]) || 0) - (toCents(r[iCredit]) || 0);
    else if (layout === 'discover' || isCard) outflow = toCents(r[iAmt]) || 0; // card exports: charges positive
    else outflow = -(toCents(r[iAmt]) || 0); // bank exports: withdrawals negative
    out.push({ date, desc: (r[iDesc] || '').trim().replace(/\s+/g, ' '), outflow, hint: iCat >= 0 ? (r[iCat] || '').trim() : '' });
  }
  return { layout, rows: out };
}

// OFX/QFX (Quicken) files: SGML or XML. FITID gives each row a unique id from the bank.
export function parseOFX(text) {
  const out = [];
  for (const blk of text.split(/<STMTTRN>/i).slice(1)) {
    const tag = (t) => (blk.match(new RegExp(`<${t}>([^<\\r\\n]*)`, 'i')) || [])[1]?.trim();
    const d = tag('DTPOSTED'); if (!d) continue;
    out.push({ date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, desc: [tag('NAME'), tag('MEMO')].filter(Boolean).join(' ').replace(/\s+/g, ' '),
      outflow: -(toCents(tag('TRNAMT')) || 0), fitid: tag('FITID'), hint: '' });
  }
  return { layout: 'ofx', rows: out };
}

// Guess what a statement row is from its description.
export function classify(row, isCard) {
  const d = row.desc.toUpperCase();
  if (isCard && row.outflow < 0 && /PAYMENT|PYMT|AUTOPAY|THANK YOU/.test(d)) return 'transfer';
  if (/VENMO CASHOUT|VENMO TRANSFER|DISCOVER \(CONA\)|\bCONA\b|FT TRANSFER|SHARE \d+/.test(d)) return 'transfer';
  if (/PAYROLL|DIRECT DEP|DIR DEP|SALARY/.test(d) && row.outflow < 0) return 'income';
  if (/INTEREST (PAID|EARNED|PAYMENT)|DIVIDEND/.test(d) && row.outflow < 0) return 'income';
  if (/TRANSFER|XFER|VANGUARD|VMC CASH|ACH (WITHDRAWAL|DEPOSIT)|DISCOVER BANK|CAPITAL ONE|CRCARDPMT|CARD PAYMENT|ONLINE PMT|ZELLE TO SELF/.test(d)) return 'transfer';
  return 'spend';
}

// Map a card's own category label to one of ours, as a first guess.
export const HINTS = { gas: 'Gas', gasoline: 'Gas', 'fuel': 'Gas', supermarkets: 'Groceries', groceries: 'Groceries', restaurants: 'Food (Eating Out)', dining: 'Food (Eating Out)',
  entertainment: 'Entertainment/Dates', 'merchandise': null, 'travel': 'Trips', 'airfare': 'Trips', 'lodging': 'Trips', 'phone/cable': 'Phone', 'health care': 'Healthcare', 'medical': 'Healthcare' };
