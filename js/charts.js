// Tiny dependency-free SVG charts. Line charts get an area fill and a hover/tap readout.
import { raw, esc, money0 } from './util.js';

const REG = new Map(); let seq = 0; // chart id -> { xs, series, fmt, label } for the readout
const PALETTE = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)'];

// series: [{ name, points:[{x,y}], color }] sharing the same x positions. Options:
//   height, label(p) for x labels, fmt(y) for values (default dollars), tone:'auto' colors one series red when it ends lower.
export function lines(series, { height = 160, label = (p) => p.x, fmt = money0, tone, dots } = {}) {
  series = series.filter((s) => s.points.length >= 2);
  if (!series.length) return raw('<p class="muted small">Not enough points for a chart yet.</p>');
  const W = 600, H = height, padL = 6, padR = 6, top = 18, bot = 22, n = series[0].points.length;
  const ys = series.flatMap((s) => s.points.map((p) => p.y)), min = Math.min(...ys), max = Math.max(...ys), span = max - min || 1;
  const X = (i) => padL + (i * (W - padL - padR)) / Math.max(1, n - 1), Y = (v) => top + (1 - (v - min) / span) * (H - top - bot);
  const id = 'c' + (++seq);
  const body = series.map((s, si) => {
    let col = s.color || PALETTE[si % 5];
    if (tone === 'auto' && series.length === 1) col = s.points.at(-1).y < s.points[0].y ? 'var(--bad)' : 'var(--good)';
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
    const area = si === 0 ? `<path d="${d}L${X(s.points.length - 1).toFixed(1)},${H - bot}L${X(0)},${H - bot}Z" fill="${col}" opacity=".12"/>` : '';
    const dd = (dots ?? n <= 24) ? s.points.map((p, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="3" fill="${col}"/>`).join('') : '';
    s._col = col;
    return `${area}<path d="${d}" fill="none" stroke="${col}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>${dd}`;
  }).join('');
  REG.set(id, { n, X, Y, series, fmt, label, W, H, top, bot });
  if (REG.size > 60) REG.delete(REG.keys().next().value);
  const xl = [0, n - 1].map((i) => `<text x="${X(i)}" y="${H - 5}" text-anchor="${i ? 'end' : 'start'}">${esc(label(series[0].points[i]))}</text>`).join('');
  const legend = series.length > 1 ? `<div class="chart-legend small">${series.map((s) => `<span><i style="background:${s._col}"></i>${esc(s.name || '')}</span>`).join('')}</div>` : '';
  return raw(`<div class="chart-wrap">${legend}<svg class="chart" data-cid="${id}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Line chart">
    <text x="${padL}" y="11">${esc(fmt(max))}</text><text x="${padL}" y="${H - bot - 4}">${esc(fmt(min))}</text>
    ${body}${xl}<line class="cursor" x1="0" x2="0" y1="${top}" y2="${H - bot}" stroke="var(--muted)" stroke-dasharray="3 3" opacity="0"/></svg><div class="chart-tip" hidden></div></div>`);
}
export function line(points, opts = {}) { return lines([{ points }], opts); }

// Readout: nearest point under the pointer or finger.
function readout(e) {
  const svg = e.target.closest?.('svg.chart[data-cid]'); const c = svg && REG.get(svg.dataset.cid); if (!c) return;
  const r = svg.getBoundingClientRect(), x = ((e.touches?.[0] || e).clientX - r.left) * (c.W / r.width);
  let i = 0, best = Infinity; for (let k = 0; k < c.n; k++) { const dx = Math.abs(c.X(k) - x); if (dx < best) { best = dx; i = k; } }
  const tip = svg.parentElement.querySelector('.chart-tip'), cur = svg.querySelector('.cursor');
  cur.setAttribute('x1', c.X(i)); cur.setAttribute('x2', c.X(i)); cur.setAttribute('opacity', '1');
  tip.hidden = false;
  tip.innerHTML = `<b>${esc(c.label(c.series[0].points[i]))}</b>` + c.series.map((s) => `<div><i style="background:${s._col}"></i>${s.name ? esc(s.name) + ' ' : ''}<span class="num">${esc(c.fmt(s.points[i]?.y))}</span></div>`).join('');
  const px = (c.X(i) / c.W) * r.width; tip.style.left = Math.min(Math.max(px - tip.offsetWidth / 2, 0), r.width - tip.offsetWidth) + 'px';
}
function hide(e) { const svg = e.target.closest?.('svg.chart[data-cid]'); if (!svg) return; svg.querySelector('.cursor')?.setAttribute('opacity', '0'); const t = svg.parentElement.querySelector('.chart-tip'); if (t) t.hidden = true; }
document.addEventListener('pointermove', readout); document.addEventListener('pointerdown', readout); document.addEventListener('pointerleave', hide, true);

// Bars: [{label, value}] (cents). Negative values drop below the line.
export function bars(items, { height = 140, fmt = money0, color = 'var(--s1)' } = {}) {
  if (!items.length || !items.some((x) => x.value)) return raw('<p class="muted small">Nothing to show yet.</p>');
  const W = 600, H = height, bot = 20, top = 14, max = Math.max(0, ...items.map((x) => x.value)), min = Math.min(0, ...items.map((x) => x.value)), span = max - min || 1;
  const bw = (W / items.length) * 0.7, Y = (v) => top + (1 - (v - min) / span) * (H - top - bot);
  const out = items.map((x, i) => { const cx = (i + 0.5) * (W / items.length), y0 = Y(0), y1 = Y(x.value);
    return `<rect x="${(cx - bw / 2).toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, Math.abs(y1 - y0)).toFixed(1)}" rx="3" fill="${x.value < 0 ? 'var(--bad)' : x.color || color}"><title>${esc(x.label)}: ${esc(fmt(x.value))}</title></rect>`
      + (items.length <= 14 || i % Math.ceil(items.length / 8) === 0 ? `<text x="${cx.toFixed(1)}" y="${H - 5}" text-anchor="middle">${esc(x.short ?? x.label)}</text>` : ''); }).join('');
  return raw(`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Bar chart"><text x="2" y="10">${esc(fmt(max))}</text>${out}</svg>`);
}

export function donut(segs) {
  const total = segs.reduce((a, s) => a + Math.max(0, s.value), 0); if (!total) return raw('');
  let a0 = -Math.PI / 2; const R = 60, r = 38, cx = 70, cy = 70;
  const live = segs.filter((s) => s.value > 0);
  const arcs = live.map((s, i) => {
    const a1 = a0 + (s.value / total) * Math.PI * 2, big = a1 - a0 > Math.PI ? 1 : 0;
    const p = (ang, rad) => `${(cx + rad * Math.cos(ang)).toFixed(2)},${(cy + rad * Math.sin(ang)).toFixed(2)}`;
    const path = live.length === 1 ? `M${cx - R},${cy}a${R},${R} 0 1,0 ${2 * R},0a${R},${R} 0 1,0 ${-2 * R},0M${cx - r},${cy}a${r},${r} 0 1,1 ${2 * r},0a${r},${r} 0 1,1 ${-2 * r},0` :
      `M${p(a0, R)}A${R},${R} 0 ${big} 1 ${p(a1, R)}L${p(a1, r)}A${r},${r} 0 ${big} 0 ${p(a0, r)}Z`;
    a0 = a1; return `<path d="${path}" fill="${PALETTE[i % 5]}" fill-rule="evenodd"><title>${esc(s.label)}</title></path>`;
  }).join('');
  const legend = live.map((s, i) => `<div class="row small"><span style="width:10px;height:10px;border-radius:3px;background:${PALETTE[i % 5]};flex:none"></span><span class="grow">${esc(s.label)}</span><span class="num">${((s.value / total) * 100).toFixed(1)}%</span></div>`).join('');
  return raw(`<div class="row" style="gap:18px"><svg viewBox="0 0 140 140" width="120" height="120" role="img" aria-label="Allocation" style="flex:none">${arcs}</svg><div style="flex:1;min-width:0">${legend}</div></div>`);
}

export function ring(fraction) {
  const f = Math.max(0, Math.min(1, fraction || 0)), C = 2 * Math.PI * 22;
  return raw(`<svg class="ring" viewBox="0 0 56 56"><circle cx="28" cy="28" r="22" fill="none" stroke="var(--surface-2)" stroke-width="6"/>
    <circle cx="28" cy="28" r="22" fill="none" stroke="var(--accent)" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(C * f).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 28 28)"/></svg>`);
}

// Range picker for charts: rangeTabs('nw', '1Y') -> buttons with data-range; filterRange(points, '3M', p => p.x)
export const RANGES = [['1M', 31], ['3M', 92], ['6M', 183], ['1Y', 366], ['All', 1e6]];
export function rangeTabs(name, on) {
  return raw(`<div class="seg-row" role="tablist" aria-label="Chart range">${RANGES.map(([k]) => `<button type="button" class="${k === on ? 'on' : ''}" data-range="${name}:${k}" role="tab" aria-selected="${k === on}">${k}</button>`).join('')}</div>`);
}
export function filterRange(points, range, dateOf = (p) => p.x) {
  const days = (RANGES.find(([k]) => k === range) || RANGES[3])[1], cut = new Date(Date.now() - days * 864e5).toLocaleDateString('en-CA');
  const f = points.filter((p) => dateOf(p) >= cut); return f.length >= 2 ? f : points.slice(-2);
}
