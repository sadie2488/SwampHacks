// What the guide overlay says on each screen: a few calm lines on using it with your voice and hands.
// Taken from web/src/modules/mappings/mappings.yaml (Veda's rules); if a rule changes there, change its line here.
import type { ModeId } from './modes';

export interface GuideLine {
  /** the big words: what to do */
  big: string;
  /** the small words: what happens */
  small: string;
}

/** Works on every screen: hold a fingerspelled letter for 2 seconds (a ring fills while you hold). */
const SIGNS: GuideLine = { big: 'Hold L, Y, C or W', small: 'for two seconds to open Learn, Play, Create or the Command Lab' };

const PLAY: GuideLine[] = [
  { big: 'Clap twice', small: 'to play or pause the song' },
  { big: 'Raise your right hand', small: 'to speed the song up; lower it to slow down' },
  { big: 'Make a fist with your left hand', small: 'then say play, pause, faster, slower, higher or lower' },
];

export const GUIDE_LINES: Record<ModeId | 'menu', GuideLine[]> = {
  menu: [
    { big: 'Scroll or drag', small: 'to turn the records; click the one in front to open it' },
    SIGNS,
  ],
  learn: [
    { big: 'Choose a song', small: 'then press play and read along on the sheet' },
    { big: 'Practice', small: 'listens while you play and tells you how it went, bar by bar' },
    SIGNS,
  ],
  play: [...PLAY, SIGNS],
  create: [
    { big: 'Say start', small: 'and hum: your melody becomes a layer' },
    { big: 'Raise your left fist', small: 'to end the take; say next for another layer' },
    { big: 'Say piano, synth, bass, pluck or drums', small: 'to pick the sound; reverb, delay or filter to colour it' },
    { big: 'Right hand up or down, left or right', small: 'bends the pitch and sets the volume; a left thumbs-up keeps the pitch' },
    { big: 'Close your right fist', small: 'to finish the piece' },
    SIGNS,
  ],
  lab: [
    { big: 'Try any sign or word', small: 'every rule lights up here when it fires' },
    ...PLAY.slice(0, 2),
    SIGNS,
  ],
};
