// Turns Lalitha's hand-drawn flowers (2048 px transparent PNGs, thin line art) into the section flower files in
// drawn/: <section>-<flower>-<state>.png (her line + main-ink stipple) and <state>-fill.png (second-ink stipple +
// a light wash). Her lines are kept exactly: the only changes are crop + centre on a square, scale, removing specks a
// few pixels big, and turning the ink black (the app tints it with the section colour). Everything else is ADDED:
// dots inside her petals, densest along the inner side of her strokes and toward the flower centre (like
// orchid-stipple.svg), seeded so the result never changes between runs.
//
// Run from the repo root:  node web/src/ui/flowers/make-drawn.mjs "<folder with IMG_0584.png ...>"
// Uses playwright-core + the installed Chrome (a canvas does the pixel work). No other packages.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const SRC = process.argv[2] ?? 'C:/Users/sadie/Desktop/Overture flowers';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'drawn');
const PX = 800;

// section, flower name, and per state: source drawing + scale (a smaller copy of the open drawing stands in for a
// stage she did not draw separately)
const PLAN = [
  { section: 'create', flower: 'lily', states: { closed: ['IMG_0589', 1], half: ['IMG_0591', 1], open: ['IMG_0592', 1] } },
  { section: 'menu', flower: 'chrysanthemum', states: { closed: ['IMG_0594', 0.62], half: ['IMG_0595', 0.82], open: ['IMG_0595', 1] } },
  { section: 'learn', flower: 'orchid', states: { closed: ['IMG_0593', 0.7], half: ['IMG_0593', 0.85], open: ['IMG_0593', 1] } },
  { section: 'play', flower: 'hibiscus', states: { closed: ['IMG_0584', 1], half: ['IMG_0587', 0.85], open: ['IMG_0587', 1] } },
  { section: 'lab', flower: 'tulip', states: { closed: ['IMG_0588', 0.7], half: ['IMG_0588', 0.85], open: ['IMG_0588', 1] } },
];

// Runs inside the browser: one drawing in, two PNG data URLs out.
async function processInPage({ src, px, scale, seed }) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const W = img.naturalWidth, H = img.naturalHeight;
  const c0 = document.createElement('canvas');
  c0.width = W; c0.height = H;
  const g0 = c0.getContext('2d');
  g0.drawImage(img, 0, 0);
  const a0 = g0.getImageData(0, 0, W, H).data;
  // the ink's extent: centre = middle of its bounding box; radius = farthest ink from there (all ink stays inside the
  // record's round face)
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (a0[(y * W + x) * 4 + 3] > 60) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  let rmax = 1;
  for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) if (a0[(y * W + x) * 4 + 3] > 60) rmax = Math.max(rmax, Math.hypot(x - cx, y - cy));
  const k = ((px / 2) * 0.96 / rmax) * scale;

  // her line, cropped, centred and scaled (nothing else)
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.setTransform(k, 0, 0, k, px / 2 - cx * k, px / 2 - cy * k);
  g.drawImage(img, 0, 0);
  g.setTransform(1, 0, 0, 1, 0, 0);
  const line = g.getImageData(0, 0, px, px);
  const N = px * px, L = line.data;
  const ink = new Uint8Array(N);
  for (let i = 0; i < N; i++) ink[i] = L[i * 4 + 3] > 60 ? 1 : 0;

  // remove specks: ink pieces only a few pixels big
  const comp = new Int32Array(N).fill(-1), stack = [];
  const label = (mask, want) => {
    const sizes = [];
    comp.fill(-1);
    for (let i = 0; i < N; i++) {
      if (mask[i] !== want || comp[i] >= 0) continue;
      const id = sizes.length;
      let n = 0;
      comp[i] = id; stack.push(i);
      while (stack.length) {
        const j = stack.pop(); n++;
        const x = j % px, y = (j / px) | 0;
        if (x > 0 && mask[j - 1] === want && comp[j - 1] < 0) { comp[j - 1] = id; stack.push(j - 1); }
        if (x < px - 1 && mask[j + 1] === want && comp[j + 1] < 0) { comp[j + 1] = id; stack.push(j + 1); }
        if (y > 0 && mask[j - px] === want && comp[j - px] < 0) { comp[j - px] = id; stack.push(j - px); }
        if (y < px - 1 && mask[j + px] === want && comp[j + px] < 0) { comp[j + px] = id; stack.push(j + px); }
      }
      sizes.push(n);
    }
    return sizes;
  };
  const inkSizes = label(ink, 1);
  let specks = 0;
  for (let i = 0; i < N; i++) if (ink[i] && inkSizes[comp[i]] < 12) { ink[i] = 0; specks++; }
  // a speck's faint edge pixels go too (anything not next to kept ink)
  for (let i = 0; i < N; i++) {
    const x = i % px, y = (i / px) | 0;
    let near = false;
    for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2 && !near; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < px && yy < px && ink[yy * px + xx]) near = true;
    }
    if (!near) L[i * 4 + 3] = 0;
  }

  // distance (px) to the nearest pixel of a mask (two-pass chamfer)
  const dist = (mask) => {
    const d = new Float32Array(N);
    for (let i = 0; i < N; i++) d[i] = mask[i] ? 0 : 1e9;
    const a = 1, b = Math.SQRT2;
    for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
      const i = y * px + x; let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + a);
      if (y > 0) { v = Math.min(v, d[i - px] + a); if (x > 0) v = Math.min(v, d[i - px - 1] + b); if (x < px - 1) v = Math.min(v, d[i - px + 1] + b); }
      d[i] = v;
    }
    for (let y = px - 1; y >= 0; y--) for (let x = px - 1; x >= 0; x--) {
      const i = y * px + x; let v = d[i];
      if (x < px - 1) v = Math.min(v, d[i + 1] + a);
      if (y < px - 1) { v = Math.min(v, d[i + px] + a); if (x < px - 1) v = Math.min(v, d[i + px + 1] + b); if (x > 0) v = Math.min(v, d[i + px - 1] + b); }
      d[i] = v;
    }
    return d;
  };
  const dInk = dist(ink);
  // inside a petal = not reachable from the edge once small gaps in her line are bridged (for finding only)
  const GAP = Math.round(px / 110);
  const open = new Uint8Array(N);
  for (let i = 0; i < N; i++) open[i] = dInk[i] > GAP ? 1 : 0;
  const outside = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const x = i % px, y = (i / px) | 0;
    if ((x === 0 || y === 0 || x === px - 1 || y === px - 1) && open[i] && !outside[i]) {
      outside[i] = 1; stack.push(i);
      while (stack.length) {
        const j = stack.pop(), jx = j % px, jy = (j / px) | 0;
        for (const n of [jx > 0 ? j - 1 : -1, jx < px - 1 ? j + 1 : -1, jy > 0 ? j - px : -1, jy < px - 1 ? j + px : -1])
          if (n >= 0 && open[n] && !outside[n]) { outside[n] = 1; stack.push(n); }
      }
    }
  }
  const dOut = dist(outside);
  const inside = new Uint8Array(N);
  for (let i = 0; i < N; i++) inside[i] = !ink[i] && dOut[i] > GAP + 1 ? 1 : 0;
  // drop pieces that are too big to be a petal (a loop of stem) or too small to hold dots
  const inSizes = label(inside, 1);
  for (let i = 0; i < N; i++) if (inside[i] && (inSizes[comp[i]] > N * 0.06 || inSizes[comp[i]] < px * 0.15)) inside[i] = 0;

  // line picture: her line in black, alpha kept
  for (let i = 0; i < N; i++) { L[i * 4] = 0; L[i * 4 + 1] = 0; L[i * 4 + 2] = 0; }
  g.putImageData(line, 0, 0);
  // fill picture: light flat wash inside the petals (two steps: a touch stronger along her strokes)
  const f = document.createElement('canvas');
  f.width = f.height = px;
  const fg = f.getContext('2d');
  const wash = fg.createImageData(px, px);
  for (let i = 0; i < N; i++) if (inside[i]) wash.data[i * 4 + 3] = dInk[i] < px / 45 ? 36 : 20;
  fg.putImageData(wash, 0, 0);

  // stipple: jittered grid, dot size from closeness to her line and to the flower centre
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const cell = px / 90, near = px / 70;
  let dots = 0;
  g.fillStyle = '#000';
  fg.fillStyle = '#000';
  for (let y = cell / 2; y < px; y += cell) for (let x = cell / 2; x < px; x += cell) {
    const jx = x + (rnd() - 0.5) * cell * 0.9, jy = y + (rnd() - 0.5) * cell * 0.9, r0 = rnd(), r1 = rnd();
    const i = (Math.round(jy) | 0) * px + (Math.round(jx) | 0);
    if (i < 0 || i >= N || !inside[i]) continue;
    const d = dInk[i], rc = Math.min(1, Math.hypot(jx - px / 2, jy - px / 2) / (px / 2));
    const v = (Math.exp(-d / near) * 1.1 + 0.03) * (0.45 + 0.55 * (1 - rc)) * (0.7 + 0.6 * r0);
    const r = cell * 0.36 * Math.sqrt(Math.min(1, v));
    if (r < cell * 0.1 || d < r + 1.5 || r1 > 0.3 + v * 1.4) continue;
    const ctx = rnd() < 0.25 ? fg : g;
    ctx.beginPath();
    ctx.arc(jx, jy, r, 0, Math.PI * 2);
    ctx.fill();
    dots++;
  }
  return { line: c.toDataURL('image/png'), fill: f.toDataURL('image/png'), specks, dots };
}

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.setContent('<body></body>');
mkdirSync(OUT, { recursive: true });
let seed = 11;
for (const p of PLAN) {
  for (const [state, [file, scale]] of Object.entries(p.states)) {
    const src = `data:image/png;base64,${readFileSync(join(SRC, `${file}.png`)).toString('base64')}`;
    const r = await page.evaluate(processInPage, { src, px: PX, scale, seed: seed++ * 7919 });
    const name = `${p.section}-${p.flower}-${state}`;
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.line.split(',')[1], 'base64'));
    writeFileSync(join(OUT, `${name}-fill.png`), Buffer.from(r.fill.split(',')[1], 'base64'));
    console.log(`${name}: from ${file} x${scale}, ${r.dots} dots added, ${r.specks} speck pixels removed`);
  }
}
await browser.close();
