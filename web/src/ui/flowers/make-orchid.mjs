// The PLACEHOLDER stippled orchid printed on every record (ported from the Overture mockup's code-drawn orchid).
// Dots in dark print ink; the lip dots use currentColor so each record can tint them with its mode colour.
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

function petal(px, py, ang, len, wid, rnd) {
  const c = Math.cos(ang), s = Math.sin(ang), qx = c * px + s * py, qy = -s * px + c * py, v = qy / len;
  if (v <= 0 || v >= 1) return 0;
  const w = wid * Math.pow(Math.sin(Math.PI * Math.pow(v, 0.75)), rnd), ax = Math.abs(qx) / Math.max(w, 1e-4);
  const fr = (x) => x - Math.floor(x), veins = (1 - ss(0, 0.1, Math.abs(fr(qx / w * 3.5 + 0.5) - 0.5))) * 0.22 * (1 - v * 0.6);
  return ss(1, 0.93, ax) * (0.22 + ss(0.72, 0.98, ax) * 0.9 + ss(0.8, 1, v) * 0.35 + veins + (1 - ss(0, 0.05, ax)) * 0.35);
}

// moth orchid: narrow sepals, two wide petals, a three-lobed lip
function orchid(x, y) {
  const d = petal(x, y, 0, 0.95, 0.3, 0.8) + petal(x, y, 2.35, 0.95, 0.3, 0.8) + petal(x, y, -2.35, 0.95, 0.3, 0.8)
    + petal(x, y, 1.25, 1, 0.62, 0.45) + petal(x, y, -1.25, 1, 0.62, 0.45);
  const lip = (petal(x, y, Math.PI, 0.55, 0.2, 0.6) + petal(x, y, 2.6, 0.38, 0.17, 0.5) + petal(x, y, -2.6, 0.38, 0.17, 0.5)) * 1.4;
  return [d + lip + ss(0.1, 0, Math.hypot(x, (y - 0.02) * 0.75)) * 0.9, lip];
}

export function orchidSVG({ cell = 2.4, size = 82, angle = 0.35 } = {}) {
  let seed = 3;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const buckets = new Map();
  const c = Math.cos(angle), s = Math.sin(angle);
  for (let y = -100 + cell / 2; y < 100; y += cell) for (let x = -100 + cell / 2; x < 100; x += cell) {
    const ux = x, uy = -y, fx = (c * ux + s * uy) / size, fy = (-s * ux + c * uy) / size;
    const [d, lip] = orchid(fx, fy);
    if (d <= 0) continue;
    const xr = 1 - Math.exp(-d * 1.5), sol = ss(1.05, 0.3, Math.hypot(fx, fy)), v = xr * (0.25 + 0.75 * sol) * (0.75 + 0.5 * rnd());
    const r = cell * 0.62 * Math.sqrt(v);
    if (r < 0.35) continue;
    const size4 = Math.max(1, Math.min(4, Math.round(r / (cell * 0.62) * 4))), key = `${lip / d > 0.3 ? 'lip' : 'ink'}${size4}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(`M${(x + rnd() - 0.5).toFixed(1)} ${(y + rnd() - 0.5).toFixed(1)}h0`);
  }
  const paths = [...buckets.entries()].map(([key, d]) => {
    const lip = key.startsWith('lip'), k = +key.slice(-1), w = ((k / 4) * cell * 0.62 * 2).toFixed(2);
    return `<path d="${d.join('')}" stroke="${lip ? 'currentColor' : '#191617'}" stroke-width="${w}"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-100 -100 200 200" fill="none" stroke-linecap="round">
  <!-- placeholder stippled orchid for the record labels, drawn by make-orchid.mjs; lip dots use currentColor -->
  <g id="flower" fill="none" stroke-linecap="round">
  ${paths.join('\n  ')}
  </g>
</svg>
`;
}
