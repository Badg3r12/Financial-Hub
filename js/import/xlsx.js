// Minimal .xlsx reader using only browser built-ins (zip via DecompressionStream, XML via DOMParser).
// Returns { sheetName: [[cell, ...], ...] } with numbers as numbers and text as strings.

async function unzip(buf) {
  const dv = new DataView(buf), files = {};
  let eocd = buf.byteLength - 22; while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('Not an .xlsx file');
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  for (let i = 0; i < count; i++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true),
      elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nlen));
    const lnlen = dv.getUint16(off + 26, true), lelen = dv.getUint16(off + 28, true);
    const data = new Uint8Array(buf, off + 30 + lnlen + lelen, csize);
    files[name] = { method, data };
    p += 46 + nlen + elen + clen;
  }
  return async (name) => {
    const f = files[name]; if (!f) return null;
    if (f.method === 0) return new TextDecoder().decode(f.data);
    const stream = new Blob([f.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(stream).text();
  };
}

const colIdx = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

export async function readXlsx(file) {
  const read = await unzip(await file.arrayBuffer());
  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const wb = xml(await read('xl/workbook.xml')), rels = xml(await read('xl/_rels/workbook.xml.rels'));
  const relMap = {}; for (const r of rels.getElementsByTagName('Relationship')) relMap[r.getAttribute('Id')] = r.getAttribute('Target');
  const ssText = await read('xl/sharedStrings.xml'), shared = [];
  if (ssText) for (const si of xml(ssText).getElementsByTagName('si')) shared.push([...si.getElementsByTagName('t')].map((t) => t.textContent).join(''));
  const out = {};
  for (const s of wb.getElementsByTagName('sheet')) {
    const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let target = relMap[rid]; if (!target) continue;
    target = target.replace(/^\/?xl\//, '').replace(/^\//, '');
    const doc = xml(await read('xl/' + target)); const grid = [];
    for (const row of doc.getElementsByTagName('row')) {
      const r = +row.getAttribute('r') - 1, line = (grid[r] ||= []);
      for (const c of row.getElementsByTagName('c')) {
        const t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0]?.textContent;
        let val = null;
        if (t === 's') val = shared[+v]; else if (t === 'inlineStr') val = [...c.getElementsByTagName('t')].map((x) => x.textContent).join('');
        else if (t === 'str' || t === 'e') val = v ?? null; else if (t === 'b') val = v === '1'; else if (v != null) val = +v;
        line[colIdx(c.getAttribute('r'))] = val;
      }
    }
    for (let i = 0; i < grid.length; i++) grid[i] ||= [];
    out[s.getAttribute('name')] = grid;
  }
  return out;
}
