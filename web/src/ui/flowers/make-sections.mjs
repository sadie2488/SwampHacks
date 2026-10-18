// Draws the placeholder section flowers (black line + black fill, three states each) as small SVGs:
//   node web/src/ui/flowers/make-sections.mjs
// Every flower is centred exactly in the middle of its square (that point becomes the record hole). The app tints
// the black with the section's inks, the same way it will tint Lalitha's hand-drawn PNGs (see README.md).
// It overwrites sections/*: do not run it to replace hand-drawn files (those go in drawn/ and win anyway).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'sections');
const f = (n) => +n.toFixed(1);
const rot = ([x, y], deg) => {
  const a = (deg * Math.PI) / 180;
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
};
const P = (pts, deg) => pts.map((p) => rot(p, deg).map(f).join(' '));

/** A petal from radius r0 out to r0 + len along `deg`, `w` wide; `round` makes the tip broad. */
function petal(deg, r0, len, w, round = 0) {
  const t = r0 + len;
  const [b, c1, c2, tip, c3, c4] = P(
    [[r0, 0], [r0 + len * 0.25, w], [t + len * 0.1 * round, w * (0.7 + round * 0.4)], [t, 0], [t + len * 0.1 * round, -w * (0.7 + round * 0.4)], [r0 + len * 0.25, -w]],
    deg,
  );
  return `M${b}C${c1} ${c2} ${tip}C${c3} ${c4} ${b}Z`;
}
const ring = (r) => `M${-r} 0a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
const fan = (n, from, to, r0, len, w, round = 0) => Array.from({ length: n }, (_, i) => petal(from + ((to - from) * i) / Math.max(1, n - 1), r0, len, w, round));
const around = (n, off, r0, len, w, round = 0) => Array.from({ length: n }, (_, i) => petal(off + (360 * i) / n, r0, len, w, round));
/** A tight ball of petal edges (closed flowers). */
function ball(r, n) {
  const arcs = Array.from({ length: n }, (_, i) => {
    const a = (360 * i) / n;
    const [p, q] = P([[r * 0.35, 0], [r * 0.85, 0]], a);
    const [c] = P([[r * 0.6, r * 0.3]], a);
    return `M${p}Q${c} ${q}`;
  });
  return [ring(r), ...arcs];
}
/** A ruffled petal edge from angle a0 to a1 (sweet pea standard). */
function ruffle(r, a0, a1, waves, amp) {
  const pts = [];
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    const a = a0 + (a1 - a0) * t;
    pts.push(rot([r + amp * Math.sin(t * waves * Math.PI * 2), 0], a).map(f).join(' '));
  }
  return `M0 0L${pts.join('L')}Z`;
}
const dashes = (deg, from, to, n) => Array.from({ length: n }, (_, i) => {
  const r = from + ((to - from) * i) / n;
  const [p, q] = P([[r, -2], [r + 3, 2]], deg);
  return `M${p}L${q}`;
});

// [petals (line + fill), details (line only)] for each section and state
const FLOWERS = {
  menu: { name: 'chrysanthemum',
    closed: [ball(34, 9), []],
    half: [[...around(22, 0, 26, 40, 4), ...ball(28, 8)], []],
    open: [[...around(24, 0, 14, 64, 4.5), ...around(18, 10, 10, 44, 4), ...around(12, 5, 6, 24, 3.5)], [ring(7)]] },
  learn: { name: 'forget-me-not',
    closed: [[petal(-90, 4, 34, 11, 1), petal(-35, 4, 28, 9, 1), petal(-145, 4, 28, 9, 1)], [ring(5)]],
    half: [around(5, -90, 7, 42, 17, 1), [ring(9)]],
    open: [around(5, -90, 8, 62, 27, 1.2), [ring(11), ring(5), ...around(5, -54, 11, 9, 0.6)]] },
  play: { name: 'bird of paradise',
    closed: [[petal(-32, 0, 26, 5), petal(-44, 0, 22, 4), 'M-86 22C-40 32 20 18 62 -4C20 8 -40 10 -86 22Z'], []],
    half: [[...fan(3, -55, -95, 0, 52, 6), petal(-25, 0, 38, 4), 'M-86 22C-40 32 20 18 62 -4C20 8 -40 10 -86 22Z'], []],
    open: [[...fan(5, -40, -120, 0, 84, 7), petal(-18, 0, 58, 5), 'M-86 22C-40 32 20 18 62 -4C20 8 -40 10 -86 22Z'], ['M-86 22L-70 96']] },
  create: { name: 'sweet pea',
    closed: [[petal(-70, 0, 52, 13, 0.6)], ['M0 -8C10 -20 -6 -34 6 -46']],
    half: [[ruffle(46, -160, -20, 4, 4), petal(160, 0, 30, 14, 1), petal(20, 0, 30, 14, 1)], []],
    open: [[ruffle(72, -175, -5, 6, 5), petal(155, 0, 48, 22, 1), petal(25, 0, 48, 22, 1), petal(90, 0, 32, 10, 0.5)], ['M0 0L0 -40']] },
  lab: { name: 'iris',
    closed: [[petal(-90, -6, 88, 12), petal(-84, 0, 70, 8)], ['M-8 4C4 -20 -6 -50 4 -80']],
    half: [[...fan(3, -75, -105, 0, 52, 12), ...fan(3, 50, 130, 0, 36, 14, 0.8)], []],
    open: [[...fan(3, -55, -125, 0, 66, 18, 0.6), ...fan(3, 35, 145, 0, 72, 22, 1)], [...dashes(35, 10, 50, 6), ...dashes(90, 10, 54, 6), ...dashes(145, 10, 50, 6)]] },
};

const svg = (body, note) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="-100 -100 200 200">\n  <!-- ${note} -->\n  ${body}\n</svg>\n`;
for (const [section, fl] of Object.entries(FLOWERS)) {
  for (const state of ['closed', 'half', 'open']) {
    const [petals, details] = fl[state];
    const note = `placeholder ${fl.name} (${state}), drawn by make-sections.mjs; hand-drawn PNGs in drawn/ replace it`;
    const line = `<path d="${[...petals, ...details].join('')}" fill="none" stroke="#000" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
    const fill = `<path d="${petals.join('')}" fill="#000" fill-rule="nonzero"/>`;
    const dir = join(OUT, section);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${state}.svg`), svg(line, note));
    writeFileSync(join(dir, `${state}-fill.svg`), svg(fill, note));
  }
}
console.log('wrote', Object.keys(FLOWERS).length * 6, 'files to', OUT);
