// One flower per section (menu, Learn, Play, Create, Command Lab), each in three states (closed, half, open), each
// state a black line picture plus an optional black fill picture. The app tints the line with the section's main
// ink and the fill with its second ink (tint.ts), so the drawings themselves stay pure black.
//
// Hand-drawn flowers: drop PNGs into web/src/ui/flowers/drawn/ named <section>-<flower>-<state>.png
// (and optionally <section>-<flower>-<state>-fill.png), e.g. learn-forgetmenot-open.png. A drawn file wins over
// the placeholder for the same section and state; nothing else needs to change. See README.md.

export type SectionId = 'menu' | 'learn' | 'play' | 'create' | 'lab';
export type FlowerState = 'closed' | 'half' | 'open';
export const SECTIONS: readonly SectionId[] = ['menu', 'learn', 'play', 'create', 'lab'];
export const STATES: readonly FlowerState[] = ['closed', 'half', 'open'];

export interface SectionLook {
  flower: string;
  /** line ink, fill ink, dark background tint */
  a: string;
  b: string;
  bg: string;
}

export const SECTION_LOOKS: Record<SectionId, SectionLook> = {
  menu: { flower: 'chrysanthemum', a: '#ff2d8a', b: '#f4e4a1', bg: '#0b0a0c' },
  learn: { flower: 'forget-me-not', a: '#1fb3bf', b: '#ff4a3d', bg: '#08161a' },
  play: { flower: 'bird of paradise', a: '#ff7a00', b: '#ff2d8a', bg: '#170c06' },
  create: { flower: 'sweet pea', a: '#c9a8ff', b: '#ff4fa3', bg: '#120d1a' },
  // cobalt only for the lines; small labels use #4a72ff (tokens.css --a-text)
  lab: { flower: 'iris', a: '#2f5bff', b: '#ff9a1f', bg: '#070b1c' },
};

export interface StatePictures {
  line: string;
  fill?: string;
}
export type SectionFlower = Record<FlowerState, StatePictures>;

const isSection = (s: string): s is SectionId => (SECTIONS as readonly string[]).includes(s);
const isState = (s: string): s is FlowerState => (STATES as readonly string[]).includes(s);

/**
 * Builds every section's pictures from two file lists ({path: url}): the placeholders (sections/<section>/<state>.svg,
 * <state>-fill.svg) and the hand-drawn PNGs (drawn/<section>-<flower>-<state>[-fill].png). Drawn files win.
 * Pure, so it can be tested with made-up file lists.
 */
export function collectFlowers(placeholders: Record<string, string>, drawn: Record<string, string>): Record<SectionId, SectionFlower> {
  const out = {} as Record<SectionId, SectionFlower>;
  for (const s of SECTIONS) out[s] = { closed: { line: '' }, half: { line: '' }, open: { line: '' } };
  const put = (s: string, st: string, fill: boolean, url: string) => {
    if (!isSection(s) || !isState(st)) return;
    if (fill) out[s][st].fill = url;
    else out[s][st].line = url;
  };
  for (const [path, url] of Object.entries(placeholders)) {
    const m = /sections\/([a-z]+)\/([a-z]+)(-fill)?\.svg$/i.exec(path);
    if (m) put(m[1].toLowerCase(), m[2].toLowerCase(), !!m[3], url);
  }
  // a drawn line replaces the placeholder's line AND fill (her fill, if any, comes from her own -fill file)
  const files = Object.entries(drawn).flatMap(([path, url]) => {
    const m = /^([a-z]+)-[a-z0-9_-]+?-(closed|half|open)(-fill)?\.png$/i.exec(path.split('/').pop() ?? '');
    return m ? [{ s: m[1].toLowerCase(), st: m[2].toLowerCase(), fill: !!m[3], url }] : [];
  });
  const hasFill = new Set(files.filter((d) => d.fill).map((d) => `${d.s}/${d.st}`));
  for (const d of files) {
    if (!d.fill && isSection(d.s) && isState(d.st) && !hasFill.has(`${d.s}/${d.st}`)) delete out[d.s][d.st].fill;
    put(d.s, d.st, d.fill, d.url);
  }
  return out;
}

const PLACEHOLDERS = import.meta.glob('./sections/*/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const DRAWN = import.meta.glob('./drawn/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export const SECTION_FLOWERS = collectFlowers(PLACEHOLDERS, DRAWN);

/** Only Lalitha's own drawings (no placeholders): a state's line is '' until her PNG exists. The records use this. */
export const DRAWN_FLOWERS = collectFlowers({}, DRAWN);
