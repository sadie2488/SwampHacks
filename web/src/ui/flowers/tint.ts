// Tints a black drawing (PNG or SVG) with one colour, once: it is drawn into a small canvas, the colour is laid over
// its inked pixels only, and the result is kept as a plain picture (a blob URL). Animating it later costs nothing
// more than any other picture. Results are cached, so a flower that re-opens on every beat is tinted only once.

/** Size of the tinted picture in pixels (the largest flower shows at about 190 px, x2 for sharp screens). */
export const TINT_PX = 400;

const done = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
const key = (url: string, colour: string) => `${colour}|${url}`;

/** The tinted picture if it is ready already (no waiting), so a re-made flower shows at once. */
export const tintedNow = (url: string, colour: string): string | undefined => done.get(key(url, colour));

export function tinted(url: string, colour: string, px = TINT_PX): Promise<string> {
  const k = key(url, colour);
  const ready = done.get(k);
  if (ready) return Promise.resolve(ready);
  let p = pending.get(k);
  if (!p) {
    p = paint(url, colour, px)
      .catch(() => url)
      .then((out) => {
        done.set(k, out);
        pending.delete(k);
        return out;
      });
    pending.set(k, p);
  }
  return p;
}

async function paint(url: string, colour: string, px: number): Promise<string> {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = px;
  c.height = px;
  const g = c.getContext('2d');
  if (!g) return url;
  g.drawImage(img, 0, 0, px, px);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = colour;
  g.fillRect(0, 0, px, px);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
  return blob ? URL.createObjectURL(blob) : c.toDataURL('image/png');
}
