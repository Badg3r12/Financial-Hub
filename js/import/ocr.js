// On-device text recognition (Tesseract.js, vendored) for paystub screenshots/PDFs and 401(k) statement PDFs.
// Nothing leaves the device. Output is text lines where wide gaps become " | " so the column readers work.

const BASE = new URL('../../vendor/tesseract/', import.meta.url).href;
let workerP = null, report = null; // report: progress callback of the read in progress

function loadScript(src) {
  return new Promise((res, rej) => { if (window.Tesseract) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load the text reader')); document.head.appendChild(s); });
}
async function worker() {
  if (!workerP) workerP = (async () => {
    await loadScript(BASE + 'tesseract.min.js');
    return window.Tesseract.createWorker('eng', 1, { workerPath: BASE + 'worker.min.js', corePath: BASE, langPath: BASE, gzip: true, workerBlobURL: false,
      logger: (m) => report?.(m) });
  })();
  return workerP;
}

// Turn an image file or each page of a PDF into canvases at a resolution good for reading.
export async function toCanvases(file, { pages = [1, 2], scale = 3 } = {}) {
  if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) {
    const { renderPdfPages } = await import('./pdf.js');
    return renderPdfPages(file, pages, scale);
  }
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 2600 / Math.max(bmp.width, bmp.height)) * (bmp.width < 1200 ? 2 : 1); // upscale small screenshots
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return [c];
}

function wordsOf(data) {
  if (data.words?.length) return data.words;
  const out = []; for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) out.push(...(l.words || []));
  return out;
}

// Recognize text and rebuild rows from word positions (works for multi-column paystubs and tables).
// opts.onProgress(fraction 0–1, label) is called while the reader loads and as each page is read.
export async function ocrLines(file, opts = {}) {
  const tell = opts.onProgress || (() => {});
  report = (m) => { if (!/recogniz/i.test(m.status)) tell(0, 'Loading the text reader (first time only)…'); };
  const w = await worker(); tell(0, 'Opening the file…');
  const canvases = await toCanvases(file, opts), lines = [];
  for (const [k, c] of canvases.entries()) {
    const n = canvases.length, page = n > 1 ? `page ${k + 1} of ${n}` : 'the page';
    report = (m) => { if (/recogniz/i.test(m.status)) tell((k + (m.progress || 0)) / n, `Reading ${page}…`); };
    tell(k / n, `Reading ${page}…`);
    const { data } = await w.recognize(c, {}, { blocks: true, text: true });
    const words = wordsOf(data).filter((x) => x.text?.trim()).map((x) => ({ s: x.text.trim(), x0: x.bbox.x0, x1: x.bbox.x1, y: (x.bbox.y0 + x.bbox.y1) / 2, hgt: x.bbox.y1 - x.bbox.y0 }));
    words.sort((a, b) => a.y - b.y || a.x0 - b.x0);
    const rows = [];
    for (const wd of words) { const r = rows.at(-1); if (r && Math.abs(r.y - wd.y) < Math.max(8, wd.hgt * 0.55)) { r.items.push(wd); r.y = (r.y + wd.y) / 2; } else rows.push({ y: wd.y, items: [wd] }); }
    for (const r of rows) {
      r.items.sort((a, b) => a.x0 - b.x0); const hgt = r.items.reduce((a, x) => a + x.hgt, 0) / r.items.length;
      let s = '', end = null; for (const it of r.items) { if (end !== null) s += it.x0 - end > hgt * 1.6 ? ' | ' : ' '; s += it.s; end = it.x1; }
      lines.push(s);
    }
  }
  report = null; tell(1, 'Checking the numbers…');
  return lines.join('\n');
}
