// The four modes as Overture shows them: one record each in the menu, one ink pair each (color-scheme.md).
// Words come from the Overture mockup's CONFIG block.

export type ModeId = 'learn' | 'play' | 'create' | 'lab';
export type Screen = 'entrance' | 'menu' | 'mode';

export interface ModeLook {
  id: ModeId;
  name: string;
  /** The two giant lines wrapped round the record: the first sits behind it, the second runs in front. */
  big: [string, string];
  /** One plain sentence about the mode (menu top-left corner, and under the mode title). */
  sub: string;
  /** Main ink and second ink. */
  a: string;
  b: string;
}

export const MODES: readonly ModeLook[] = [
  { id: 'learn', name: 'Learn', big: ['Learn', 'By Ear'], sub: 'Upload a song. Read it. Play along.', a: '#1fb3bf', b: '#ff4a3d' },
  // the third record: History (the id stays 'play' because the contracts' Mode type is learn | play | create)
  { id: 'play', name: 'History', big: ['History', 'Your Journey'], sub: 'Your feedback and progress, in one place.', a: '#ff7a00', b: '#ff2d8a' },
  { id: 'create', name: 'Create', big: ['Create', 'From Hums'], sub: 'Hum it. Loop it. Keep it.', a: '#c9a8ff', b: '#ff4fa3' },
  { id: 'lab', name: 'Command Lab', big: ['Command', 'Lab'], sub: 'Try every gesture and word.', a: '#2f5bff', b: '#ff9a1f' },
];

/** The entrance's own inks (the flower poster). */
export const INTRO_INKS = { a: '#ff2d8a', b: '#f4e4a1' } as const;

export const modeLook = (id: ModeId): ModeLook => MODES.find((m) => m.id === id) ?? MODES[0];

/** What each screen follows with the guide line (hand as dots, head as outline). */
export const GUIDES: Record<ModeId | 'menu', ReadonlyArray<'hand' | 'head'>> = {
  menu: ['hand'],
  learn: [],
  play: [],
  create: ['hand'],
  lab: ['head', 'hand'],
};

/**
 * The record's name in big stacked letters: two words stack as they are, one long word splits in half
 * (LEA / RN, HIST / ORY, CRE / ATE, COMMAND / LAB).
 */
export function stackedName(name: string): string[] {
  const upper = name.toUpperCase();
  if (upper.includes(' ')) return upper.split(' ');
  const half = Math.ceil(upper.length / 2);
  return upper.length > 3 ? [upper.slice(0, half), upper.slice(half)] : [upper];
}
