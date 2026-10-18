// Draws the PLACEHOLDER flowers as SVG files (the team's own code-drawn shapes, ported from the Overture mockup).
// Lalitha will replace them with hand-drawn flowers; see README.md in this folder for the rules a new file must follow.
// Run from the repo root:  node web/src/ui/flowers/make-placeholders.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const hash = (x, y) => { const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return s - Math.floor(s); };
const f1 = (n) => +n.toFixed(1);

// A chrysanthemum: three rings of petals. b = 0 is a tight closed ball, b = 1 is fully open (thin rays, centre showing).
// The outer size never changes. Returns [density, centre density].
function mum(qx, qy, b, rings) {
  const r = Math.hypot(qx, qy), a = Math.atan2(qy, qx);
  if (r > 1.05) return [0, 0];
  let d = 0;
  rings.forEach((n, k) => {
    let bk = Math.min(1, Math.max(0, b * 1.5 - k * 0.25)); bk = bk * bk * (3 - 2 * bk);
    const sp = (Math.PI * 2) / n, off = k * 0.37 + 0.13 * k * k;
    const tip = (1 - k * 0.24) + ((1 - k * 0.1) - (1 - k * 0.24)) * bk;
    const base = (k === 2 ? 0 : tip * 0.42) + ((0.1 + k * 0.03) - (k === 2 ? 0 : tip * 0.42)) * bk;
    if (r < base || r > tip) return;
    const t = (r - base) / (tip - base), da = ((((a - off + sp * 0.5) % sp) + sp) % sp) - sp * 0.5;
    const cup = Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2)), strap = Math.pow(Math.sin(Math.PI * Math.min(t * 1.15, 1)), 0.6);
    const prof = cup + (strap - cup) * bk, w = sp * (0.75 + (0.3 - 0.75) * bk) * Math.max(prof, 0.02), ax = Math.abs(da) / w;
    if (ax > 1) return;
    const rim = ss(0.65, 1, ax) * 0.7 + ss(0.85, 1, t) * 0.3 * bk, rib = (1 - ss(0, 0.12, ax)) * 0.25 * bk, curl = (1 - bk) * ss(0.5, 1, t) * 0.35;
    d += ss(1, 0.85, ax) * (0.25 + rim + rib + curl);
  });
  const disc = 0.17 * ss(0.6, 1, b), cen = disc > 0.01 ? ss(disc, disc * 0.6, r) * 0.9 : 0;
  return [d + cen, cen];
}

// Turn a density function into type marks on a grid: + crosses and dots where faint, dashes in the middle,
// long runs and small boxes where dense. Cool blue for faint marks, paper white for the rest, magenta centres.
function marks(density, { cw = 7.2, ch = 5.2, seed = 0 } = {}) {
  const groups = { cool: [], light: [], centre: [], dots: [] };
  for (let y = -100 + ch / 2; y < 100; y += ch) for (let x = -100 + cw / 2; x < 100; x += cw) {
    const [d, cen] = density(x, y);
    if (d <= 0) continue;
    const v = (1 - Math.exp(-d * 1.6)) * (0.4 + 0.6 * ss(105, 30, Math.hypot(x, y)));
    const h = hash(x + seed, y), x0 = x - cw / 2, cy = y;
    const g = cen / Math.max(d, 1e-3) > 0.3 ? groups.centre : v < 0.35 ? groups.cool : groups.light;
    const plus = () => g.push(`M${f1(x - cw * 0.38)} ${f1(cy)}h${f1(cw * 0.76)}M${f1(x)} ${f1(cy - ch * 0.4)}v${f1(ch * 0.8)}`);
    if (v > 0.1 && v < 0.3) { if (h < 0.35) plus(); else if (h < 0.5) groups.dots.push(`M${f1(x)} ${f1(cy)}h0`); }
    else if (v >= 0.3 && v < 0.6) { if (h < 0.15) plus(); else g.push(`M${f1(x0)} ${f1(cy)}h${f1(cw * Math.min(1, 0.3 + v))}`); }
    else if (v >= 0.6) {
      if (h < 0.08) g.push(`M${f1(x - cw * 0.36)} ${f1(cy - ch * 0.36)}h${f1(cw * 0.72)}v${f1(ch * 0.72)}h${f1(-cw * 0.72)}z`);
      else if (h < 0.16) plus(); else g.push(`M${f1(x0)} ${f1(cy)}h${f1(cw)}`);
    }
  }
  const sw = (ch * 0.22).toFixed(2);
  return [
    groups.cool.length && `<path d="${groups.cool.join('')}" stroke="#6f8fe0" stroke-width="${sw}" opacity=".8"/>`,
    groups.light.length && `<path d="${groups.light.join('')}" stroke="#f6f2ea" stroke-width="${sw}"/>`,
    groups.centre.length && `<path d="${groups.centre.join('')}" stroke="#e0185a" stroke-width="${sw}"/>`,
    groups.dots.length && `<path d="${groups.dots.join('')}" stroke="#6f8fe0" stroke-width="1.4" stroke-linecap="round" opacity=".8"/>`,
  ].filter(Boolean).join('\n    ');
}

// One state of one flower, as its own file (closed, half or open): every state has the same outer size.
function stateSVG(rings, seed, b, state) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-100 -100 200 200" fill="none">
  <!-- placeholder chrysanthemum (${state}), drawn by make-placeholders.mjs; replace with a hand-drawn flower (see README.md) -->
  ${marks((x, y) => mum(x / 95, y / 95, b, rings), { seed })}
</svg>
`;
}

// [rings of petals, seed, how open each state is: closed, half, open]
const FLOWERS = {
  'chrysanthemum-a': [[21, 16, 11], 1, [0, 0.45, 1]],
  'chrysanthemum-b': [[24, 18, 12], 7, [0, 0.45, 1]],
  'chrysanthemum-c': [[18, 14, 9], 13, [0, 0.45, 1]],
  bud: [[16, 12, 8], 21, [0, 0.08, 0.16]],
};
const written = [];
for (const [name, [rings, seed, opens]] of Object.entries(FLOWERS)) {
  mkdirSync(join(HERE, name), { recursive: true });
  ['closed', 'half', 'open'].forEach((state, k) => {
    writeFileSync(join(HERE, name, `${state}.svg`), stateSVG(rings, seed, opens[k], state));
    written.push(`${name}/${state}.svg`);
  });
}
const { orchidSVG } = await import('./make-orchid.mjs');
writeFileSync(join(HERE, 'orchid-stipple.svg'), orchidSVG());
console.log('wrote', [...written, 'orchid-stipple.svg'].join(', '));
