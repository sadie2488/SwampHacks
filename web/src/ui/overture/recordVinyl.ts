// The record's vinyl as an SVG picture (drawn ONCE into a canvas by recordImages.ts, never live):
// see-through vinyl in the mode colour, gray streaks along the grooves, soft gray clouds, the dotted orchid,
// a dark centre label and fine grooves. No filters or blend modes: soft edges come from gradients.
import orchidRaw from '@/ui/flowers/orchid-stipple.svg?raw';
import type { ModeLook } from './modes';

export const HOLE = 14;
const LABEL_R = 34;
const GRAY = '#a29d97';
const NIGHT = '#0b0a0c';

function streaks(seed: number): string {
  let s = seed * 97 + 11;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  let out = '';
  for (let k = 0; k < 16; k++) {
    const r = LABEL_R + 6 + rnd() * (92 - LABEL_R), a0 = rnd() * 6.283, span = 0.4 + rnd() * 1.8, a1 = a0 + span;
    const p = (a: number) => `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`;
    out += `<path d="M${p(a0)} A${r.toFixed(1)},${r.toFixed(1)} 0 ${span > Math.PI ? 1 : 0},1 ${p(a1)}" stroke="${GRAY}" stroke-width="${(1 + rnd() * 3).toFixed(1)}" stroke-opacity="${(0.25 + rnd() * 0.75).toFixed(2)}"/>`;
  }
  return out;
}

function grooves(): string {
  let out = '';
  for (let k = 0, r = 97; r > HOLE + 5; k++, r -= 1.8) {
    const band = Math.floor(k / 4) % 3, light = k % 2 === 1;
    const o = 0.13 * [1.8, 0.6, 1.1][band] * (light ? 0.9 : 1) * (0.8 + (0.4 * ((k * 37) % 11)) / 11);
    out += `<circle r="${r.toFixed(1)}" stroke="${light ? GRAY : '#191617'}" stroke-width="${light ? 0.45 : 0.35}" stroke-opacity="${o.toFixed(3)}"/>`;
  }
  for (let r = 94; r > LABEL_R + 2; r -= 4) out += `<circle r="${r}" stroke="${GRAY}" stroke-width=".5" stroke-opacity="${r % 12 ? 0.25 : 0.55}"/>`;
  return out;
}

const MIST: Array<[number, number, number, number]> = [[-40, -35, 45, 32], [45, 40, 40, 30], [10, -70, 35, 20], [-60, 50, 30, 24]];

/** The orchid's drawing without its outer <svg>, with its accent dots in the record's colour. */
function orchidInner(color: string): string {
  const start = orchidRaw.indexOf('<g');
  const end = orchidRaw.lastIndexOf('</g>');
  return start < 0 || end < 0 ? '' : orchidRaw.slice(start, end + 4).replace(/currentColor/g, color);
}

export function vinylSVG(m: ModeLook, index: number): string {
  const turn = [0, 20, -17, 34][index % 4];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-110 -110 220 220" width="220" height="220">
<defs>
  <radialGradient id="body"><stop offset=".3" stop-color="${m.a}" stop-opacity=".3"/><stop offset="1" stop-color="${m.a}" stop-opacity=".55"/></radialGradient>
  <radialGradient id="mist"><stop offset="0" stop-color="${GRAY}" stop-opacity=".5"/><stop offset="1" stop-color="${GRAY}" stop-opacity="0"/></radialGradient>
  <mask id="off"><rect x="-110" y="-110" width="220" height="220" fill="#fff"/><circle r="${HOLE}" fill="#000"/></mask>
  <clipPath id="face"><circle r="100"/></clipPath>
</defs>
<g mask="url(#off)">
  <circle r="100" fill="${NIGHT}" fill-opacity=".33"/>
  <circle r="100" fill="url(#body)"/>
  <g fill="none" stroke-linecap="round" opacity=".35">${streaks(index)}</g>
  <g clip-path="url(#face)">${MIST.map(([x, y, rx, ry]) => `<ellipse cx="${x}" cy="${y}" rx="${rx * 1.5}" ry="${ry * 1.5}" fill="url(#mist)"/>`).join('')}</g>
  <g clip-path="url(#face)" opacity=".45" transform="rotate(${turn})">${orchidInner(m.a)}</g>
  <circle r="${LABEL_R}" fill="${NIGHT}" fill-opacity=".88"/>
  <circle r="${LABEL_R}" fill="none" stroke="${m.a}" stroke-opacity=".6" stroke-width=".6"/>
  <g fill="none">${grooves()}</g>
</g>
<circle r="98.8" fill="none" stroke="${GRAY}" stroke-opacity=".55" stroke-width="2.4"/>
</svg>`;
}
