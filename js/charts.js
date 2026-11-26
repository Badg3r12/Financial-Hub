// Tiny dependency-free SVG charts.
import { raw, esc, money0 } from './util.js';

export function line(points, { height = 160, label = (p) => p.x } = {}) {
  if (points.length < 2) return raw('<p class="muted small">Not enough points for a chart yet.</p>');
  const W = 600, H = height, pad = 28, ys = points.map((p) => p.y);
  const min = Math.min(...ys), max = Math.max(...ys), span = max - min || 1;
  const X = (i) => pad + (i * (W - pad * 2)) / (points.length - 1), Y = (v) => H - pad - ((v - min) / span) * (H - pad * 2);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  const dots = points.map((p, i) => `<circle cx="${X(i)}" cy="${Y(p.y)}" r="3.5" fill="var(--s1)"><title>${esc(label(p))}: ${esc(money0(p.y))}</title></circle>`).join('');
  const xl = [0, points.length - 1].map((i) => `<text x="${X(i)}" y="${H - 6}" text-anchor="${i ? 'end' : 'start'}">${esc(label(points[i]))}</text>`).join('');
  return raw(`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Line chart">
    <text x="${pad}" y="12">${esc(money0(max))}</text><text x="${pad}" y="${H - pad + 14}">${esc(money0(min))}</text>
    <path d="${d}" fill="none" stroke="var(--s1)" stroke-width="2.5" stroke-linejoin="round"/>${dots}${xl}</svg>`);
}

const PALETTE = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)'];
export function donut(segs) {
  const total = segs.reduce((a, s) => a + Math.max(0, s.value), 0); if (!total) return raw('');
  let a0 = -Math.PI / 2; const R = 60, r = 38, cx = 70, cy = 70;
  const arcs = segs.filter((s) => s.value > 0).map((s, i) => {
    const a1 = a0 + (s.value / total) * Math.PI * 2, big = a1 - a0 > Math.PI ? 1 : 0;
    const p = (ang, rad) => `${(cx + rad * Math.cos(ang)).toFixed(2)},${(cy + rad * Math.sin(ang)).toFixed(2)}`;
    const path = segs.length === 1 ? `M${cx - R},${cy}a${R},${R} 0 1,0 ${2 * R},0a${R},${R} 0 1,0 ${-2 * R},0` :
      `M${p(a0, R)}A${R},${R} 0 ${big} 1 ${p(a1, R)}L${p(a1, r)}A${r},${r} 0 ${big} 0 ${p(a0, r)}Z`;
    a0 = a1; return `<path d="${path}" fill="${PALETTE[i % 5]}"><title>${esc(s.label)}</title></path>`;
  }).join('');
  const legend = segs.filter((s) => s.value > 0).map((s, i) => `<div class="row small"><span style="width:10px;height:10px;border-radius:3px;background:${PALETTE[i % 5]}"></span><span class="grow">${esc(s.label)}</span><span class="num">${((s.value / total) * 100).toFixed(1)}%</span></div>`).join('');
  return raw(`<div class="row" style="gap:18px"><svg viewBox="0 0 140 140" width="120" height="120" role="img" aria-label="Allocation">${arcs}</svg><div style="flex:1">${legend}</div></div>`);
}

export function ring(fraction) {
  const f = Math.max(0, Math.min(1, fraction || 0)), C = 2 * Math.PI * 22;
  return raw(`<svg class="ring" viewBox="0 0 56 56"><circle cx="28" cy="28" r="22" fill="none" stroke="var(--surface-2)" stroke-width="6"/>
    <circle cx="28" cy="28" r="22" fill="none" stroke="var(--accent)" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(C * f).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 28 28)"/></svg>`);
}
