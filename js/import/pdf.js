// PDF statements → text lines (pdf.js, Mozilla, vendored), then statement-specific readers.
// Readers only pick out dates, descriptions, amounts and balances; account numbers are never read.

let lib;
async function pdfjs() {
  if (!lib) { lib = await import('../../vendor/pdfjs/pdf.min.mjs'); lib.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href; }
  return lib;
}

// Draw PDF pages to canvases (for text recognition of scanned or scrambled-font PDFs).
export async function renderPdfPages(file, pages = [1], scale = 3) {
  const { getDocument } = await pdfjs();
  const doc = await getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise, out = [];
  for (const n of pages) {
    if (n > doc.numPages) continue;
    const page = await doc.getPage(n), vp = page.getViewport({ scale }), c = document.createElement('canvas');
    c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise; out.push(c);
  }
  return out;
}

// Group text pieces into lines by vertical position; a wide horizontal gap becomes " | ".
export async function pdfLines(file) {
  const { getDocument } = await pdfjs();
  const doc = await getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const items = tc.items.filter((i) => i.str.trim()).map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width }));
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = [];
    for (const it of items) { const r = rows.at(-1); if (r && Math.abs(r.y - it.y) < 2.5) r.items.push(it); else rows.push({ y: it.y, items: [it] }); }
    pages.push(rows.map((r) => { r.items.sort((a, b) => a.x - b.x); let s = '', end = null;
      for (const it of r.items) { if (end !== null) s += it.x - end > 12 ? ' | ' : (it.x - end > 1 ? ' ' : ''); s += it.s; end = it.x + it.w; }
      return s.trim(); }));
  }
  return pages;
}

const money = (s) => { const m = String(s).match(/(-?)\$?\s?(\d{1,3}(?:,\d{3})*|\d*)\.(\d{2})(-?)/); if (!m) return null; const v = Math.round(parseFloat((m[2] || '0').replace(/,/g, '') + '.' + m[3]) * 100); return (m[1] || m[4]) ? -v : v; };
const AMT_RE = /-?\$?\s?(?:\d{1,3}(?:,\d{3})*|\d*)\.\d{2}-?/g;
const mdY = (s, fallbackYear) => { const m = s.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/); if (!m) return null; let y = m[3] || fallbackYear; if (String(y).length === 2) y = '20' + y; return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; };

// "WAL-MART #4470 WAL-MART #4470 JOPLIN" → "WAL-MART #4470 JOPLIN" (the bank prints the merchant twice)
function undouble(s) {
  const w = s.split(' ');
  for (let j = 1; j < w.length; j++) for (let m = Math.min(j, w.length - j); m >= 1; m--) {
    if ((m >= 2 || w[0].length >= 4) && w.slice(j, j + m).join(' ') === w.slice(0, m).join(' ')) return [...w.slice(0, j), ...w.slice(j + m)].join(' ');
  }
  return s;
}

export function detect(pages) {
  const t = pages.flat().join('\n');
  if (/SUFFIX\s+\d+\s+(Savings|Checking)/i.test(t) && /Joplin|JMCU|MEMBER/i.test(t)) return 'jmcu';
  if (/Discover it|discover\.capitalone\.com|Cashback Bonus/i.test(t) && /PURCHASES/i.test(t)) return 'card';
  if (/ONLINE SAVINGS|Annual Percentage Yield Earned/i.test(t)) return 'discoverBank';
  return null;
}

// JMCU member statement: one section per share (Savings / Checking). Rows: "MM/DD/YY Description amount[-] balance",
// often followed by a detail line with the merchant. Trailing "-" means money out.
export function parseJMCU(pages) {
  const out = { kind: 'jmcu', sections: {} }, AMT = '(?:\\d{1,3}(?:,\\d{3})*|\\d*)\\.\\d{2}-?';
  const rowRe = new RegExp(`^(\\d{1,2}/\\d{1,2}/\\d{2}) \\| (.+?) \\| (${AMT}) \\| (${AMT})`);
  let sec = null, last = null;
  for (const l of pages.flat()) {
    const s = l.match(/^_+SUFFIX\s*\|?\s*\d+\s+(Savings|Checking)/i); // history header (the summary table has both on one line)
    if (s) { const next = s[1].toLowerCase(); if (next !== sec || !/CONTINUED/i.test(l)) last = null; sec = next; out.sections[sec] ||= { rows: [] }; continue; }
    if (!sec) continue;
    const row = l.match(rowRe);
    if (row) { last = { date: mdY(row[1]), desc: row[2].trim(), amount: money(row[3]), balance: money(row[4]) }; out.sections[sec].rows.push(last); continue; }
    // Detail line under a row: "10/02/26 17:19 WAL-MART #4470 ..." or "10/08/26 | ALLGEIER, MARTIN | PAYROLL"
    if (last && /^\d{1,2}\/\d{1,2}\/\d{2}\b/.test(l) && !last.detail) {
      let d = l.replace(/^\d{1,2}\/\d{1,2}\/\d{2}\s*\|?\s*(\d{1,2}:\d{2}\s+)?/, '').split(' | ').filter((p) => p.trim() && p.trim() !== last.desc).join(' ');
      last.detail = d.replace(/\b\d{6,}\b/g, '').replace(/\s+/g, ' ').trim();
    }
  }
  for (const s of Object.values(out.sections)) {
    for (const r of s.rows) r.merchant = undouble(/^(Purchase|POS|Debit Card)/i.test(r.desc) && r.detail ? r.detail : [r.desc, r.detail].filter(Boolean).join(' '));
    if (s.rows.length) { s.end = s.rows.at(-1).balance; s.endDate = s.rows.at(-1).date; }
  }
  return out;
}

// Capital One / Discover it card statement: "MM/DD DESCRIPTION ... $amount" under PAYMENTS AND CREDITS and PURCHASES.
export function parseCard(pages) {
  const t = pages.flat().join('\n');
  const period = t.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})/) || t.match(/OPEN TO CLOSE DATE:\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
  const endDate = period ? mdY(period[2]) : null, year = endDate?.slice(0, 4);
  const out = { kind: 'card', rows: [], endDate, end: money((t.match(/New Balance:[\s|]*\$?([\d,]+\.\d{2})/i) || [])[1] || '') };
  let mode = null;
  for (const l of pages.flat()) {
    if (/:\s*PAYMENTS AND CREDITS$/i.test(l)) { mode = 'credit'; continue; }
    if (/:\s*PURCHASES$/i.test(l) || /:\s*(FEES|INTEREST)/i.test(l)) { mode = /PURCHASES/i.test(l) ? 'purchase' : 'fee'; continue; }
    const m = l.match(/^(\d{1,2}\/\d{1,2})\s+(.+?)\s*\|\s*(-\s*)?\$([\d,]+\.\d{2})$/);
    if (!m || !mode) continue;
    let d = mdY(m[1], year); if (endDate && d > endDate) d = `${+year - 1}${d.slice(4)}`;
    const amt = money(m[4]);
    out.rows.push({ date: d, desc: m[2].replace(/\s*\|\s*/g, ' ').replace(/\s+/g, ' ').trim(), outflow: mode === 'credit' || m[3] ? -amt : amt });
  }
  return out;
}

// Discover / Capital One online savings: summary ending balance plus deposits and withdrawals.
export function parseDiscoverBank(pages) {
  const t = pages.flat().join('\n');
  const per = t.match(/Statement Period:\s*([A-Z][a-z]{2}) (\d{2}), (\d{4})\s*-\s*([A-Z][a-z]{2}) (\d{2}), (\d{4})/);
  const M = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
  const endDate = per ? `${per[6]}-${M[per[4]]}-${per[5]}` : null;
  return { kind: 'discoverBank', endDate, end: money((t.match(/Ending Balance\s*\.*\s*\$([\d,]+\.\d{2})/i) || [])[1] || ''),
    interest: money((t.match(/Interest Earned This Period\.*\s*\$([\d,]+\.\d{2})/i) || [])[1] || '') };
}
