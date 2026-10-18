// Draws each record ONCE, ahead of time, into four canvases: the vinyl and the frosted face, each in colour and in
// a ready-made gray copy (for the records at rest). After that the menu only moves, turns and fades these pictures.
// The face is drawn with the page's own Archivo font (canvas text), so the cut-out letters match the design.
import { stackedName, type ModeLook } from './modes';
import { HOLE, vinylSVG } from './recordVinyl';

export interface RecordCanvases {
  vinyl: HTMLCanvasElement;
  face: HTMLCanvasElement;
  vinylGray: HTMLCanvasElement;
  faceGray: HTMLCanvasElement;
}

const GRAY = '#a29d97';
const REST = 'grayscale(0.9) brightness(0.5)';
let grainTile: HTMLCanvasElement | null = null;

/** A small tile of dark speckles (the frost's grain), made once and repeated. */
function grain(): HTMLCanvasElement {
  if (grainTile) return grainTile;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    const img = g.createImageData(128, 128);
    let s = 7;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < img.data.length; i += 4) {
      // soft noise centred on the middle (like fractal noise), so most speckles are faint
      const n = (rnd() + rnd() + rnd()) / 3;
      img.data[i] = 26;
      img.data[i + 1] = 23;
      img.data[i + 2] = 23;
      img.data[i + 3] = Math.max(0, Math.min(255, (n * 1.6 - 0.55) * 255));
    }
    g.putImageData(img, 0, 0);
  }
  return (grainTile = c);
}

function loadSVG(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('record picture'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

function drawFace(c: HTMLCanvasElement, m: ModeLook): void {
  const g = c.getContext('2d');
  if (!g) return;
  const k = c.width / 220;
  g.setTransform(k, 0, 0, k, c.width / 2, c.height / 2);
  // the frost: a flat tint plus grain, over the whole face
  g.beginPath();
  g.arc(0, 0, 100, 0, Math.PI * 2);
  g.fillStyle = m.a;
  g.globalAlpha = 0.45;
  g.fill();
  g.globalAlpha = 0.55;
  g.save();
  g.clip();
  // the grain is drawn at the canvas's own pixel size, so it stays fine
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = g.createPattern(grain(), 'repeat') ?? 'transparent';
  g.fillRect(0, 0, c.width, c.height);
  g.restore();
  // cut the name and the hole out of the frost
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'destination-out';
  const lines = stackedName(m.name);
  const size = 78 * (Math.max(...lines.map((l) => l.length)) > 4 ? 0.8 : 1);
  g.font = `900 ${size}px Archivo, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((ln, i) => {
    const w = g.measureText(ln).width || 1;
    g.save();
    g.translate(0, (i - (lines.length - 1) / 2) * size * 0.9);
    g.scale(178 / w, 1);
    g.fillText(ln, 0, size * 0.04);
    g.restore();
  });
  g.beginPath();
  g.arc(0, 0, HOLE, 0, Math.PI * 2);
  g.fill();
  // rim and hole outlines: light catches one side and fades into the mode colour
  g.globalCompositeOperation = 'source-over';
  const rim = g.createLinearGradient(-100, -100, 100, 100);
  rim.addColorStop(0, GRAY);
  rim.addColorStop(0.35, m.a);
  rim.addColorStop(0.6, 'rgba(162,157,151,0.15)');
  rim.addColorStop(1, GRAY);
  g.strokeStyle = rim;
  g.globalAlpha = 0.7;
  g.lineWidth = 2.4;
  g.beginPath();
  g.arc(0, 0, 98.8, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 2;
  g.beginPath();
  g.arc(0, 0, HOLE + 1, 0, Math.PI * 2);
  g.stroke();
}

function grayCopy(from: HTMLCanvasElement, to: HTMLCanvasElement): void {
  const g = to.getContext('2d');
  if (!g) return;
  g.filter = REST;
  g.drawImage(from, 0, 0);
}

/** Draw one record into the given canvases (each `px` pixels square). */
export async function drawRecord(c: RecordCanvases, m: ModeLook, index: number, px: number): Promise<void> {
  for (const cv of Object.values(c)) cv.width = cv.height = px;
  try {
    await document.fonts?.load(`900 64px Archivo`);
  } catch {
    // font not ready: the fallback font still cuts readable letters
  }
  drawFace(c.face, m);
  grayCopy(c.face, c.faceGray);
  const img = await loadSVG(vinylSVG(m, index));
  c.vinyl.getContext('2d')?.drawImage(img, 0, 0, px, px);
  grayCopy(c.vinyl, c.vinylGray);
}
