// Every flower the app shows, in one place. Each entrance / section flower has three states (closed, half, open),
// each its own file in the flower's folder; the app cross-fades between them (only opacity changes).
// To swap a flower: replace its three files (same names), or add a folder and list it here. See README.md.
import budClosed from './bud/closed.svg?url';
import budHalf from './bud/half.svg?url';
import budOpen from './bud/open.svg?url';
import aClosed from './chrysanthemum-a/closed.svg?url';
import aHalf from './chrysanthemum-a/half.svg?url';
import aOpen from './chrysanthemum-a/open.svg?url';
import bClosed from './chrysanthemum-b/closed.svg?url';
import bHalf from './chrysanthemum-b/half.svg?url';
import bOpen from './chrysanthemum-b/open.svg?url';
import cClosed from './chrysanthemum-c/closed.svg?url';
import cHalf from './chrysanthemum-c/half.svg?url';
import cOpen from './chrysanthemum-c/open.svg?url';

export interface FlowerStates {
  closed: string;
  half: string;
  open: string;
}

export const FLOWERS = {
  'chrysanthemum-a': { closed: aClosed, half: aHalf, open: aOpen },
  'chrysanthemum-b': { closed: bClosed, half: bHalf, open: bOpen },
  'chrysanthemum-c': { closed: cClosed, half: cHalf, open: cOpen },
  bud: { closed: budClosed, half: budHalf, open: budOpen },
} satisfies Record<string, FlowerStates>;

export type FlowerName = keyof typeof FLOWERS;

// The flower of each section (menu and the four modes) lives in sections.ts (placeholders in sections/, hand-drawn
// PNGs in drawn/), shown by SectionBloom.tsx.
