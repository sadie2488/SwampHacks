// Spoken keywords. The instrument is loud, so words are only accepted while a gesture arms them
// (default: the left fist is held). All the logic is here and uses an injected clock so it can be tested.
import { CONFIG } from './config';

export type Keyword = (typeof CONFIG.keywords.words)[number];
type KeywordConfig = typeof CONFIG.keywords;

/**
 * What Chrome often writes instead of each command word (plurals and past tenses too). Plain data: add a line when the
 * live log shows a new mis-hearing. An entry with several words ("the lay") must be heard as those words in that order.
 * Only the current mode's words are looked up, so a Play sound-alike can never fire a Create command.
 * Deliberately left out: "stop" for start (it means the opposite) and very common words like "since", "known", "bit".
 */
export const SOUND_ALIKES: Readonly<Record<string, readonly string[]>> = {
  // Play mode
  play: ['plate', 'plates', 'played', 'plays', 'playing', 'blay', 'pley'],
  pause: ['paws', 'pores', 'pours', 'pose', 'paused', 'pauses', "pause's", 'pause it', 'porz', 'paz'],
  slower: ['slow', 'slowly', 'slowed', 'slows', 'slow down', 'slow her', 'slowa'],
  faster: ['fast', 'fasted', 'fastest', 'fasten', 'pastor'],
  higher: ['hire', 'hired', 'hires', 'hyer', 'hier', 'hi her', 'high', 'highest'],
  lower: ['lore', 'lover', 'lowered', 'lowers', 'lowest', 'low', 'lure'],
  // Create mode
  start: ['star', 'stark', 'stars', 'starts', 'started', 'starting', 'starred', 'stuart', 'start it'],
  next: ['text', 'necks', 'neck', 'nexts', 'nex', 'nexus', 'knicks'],
  piano: ['pianos', "piano's", 'pianist', 'piana', 'tiano'],
  synth: ['sense', 'sin', 'sins', 'synths', 'cinth', 'scent', "synth's", 'zinth', 'sint'],
  bass: ['base', 'bases', 'basses', "bass's", "base's", 'bas'],
  pluck: ['plug', 'plugs', 'plucked', 'plucks', 'plucking', 'plock', 'pluk'],
  drums: ['drum', "drum's", 'drummed', 'drumming', 'drumm'],
  none: ['nun', 'nuns', 'non', 'nan', 'nunn'],
  reverb: ['river', 'rivers', 'reverbs', 're verb', "reverb's", 'rever', 'revert'],
  delay: ['the lay', 'de lay', 'dee lay', 'd lay', 'delays', 'delayed', 'delaying', 'dilay'],
  filter: ['filtered', 'filters', 'filtering', 'philter', 'filta', 'filler'],
  beat: ['beet', 'beets', 'bead', 'beads', 'beats', "beat's", 'beep'],
};

/** Lower case, punctuation gone (apostrophes kept inside words), split into words. */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .split(/[^a-z']+/)
    .map((t) => t.replace(/^'+|'+$/g, ''))
    .filter(Boolean);
}

type Form = { word: string; form: string[] };
const formCache = new Map<readonly string[], Form[]>();
/** Every way of saying each word (the word itself, then its sound-alikes), as word lists, longest first. */
function formsFor(words: readonly string[]): Form[] {
  let out = formCache.get(words);
  if (out) return out;
  out = [];
  for (const w of words) for (const f of [w, ...(SOUND_ALIKES[w] ?? [])]) out.push({ word: w, form: tokens(f) });
  out.sort((a, b) => b.form.length - a.form.length);
  formCache.set(words, out);
  return out;
}

/** The command words in these words, in order, repeats included (a sound-alike counts as its word). */
function scan(toks: readonly string[], words: readonly string[]): string[] {
  const forms = formsFor(words);
  const found: string[] = [];
  for (let i = 0; i < toks.length; ) {
    const hit = forms.find(({ form }) => form.every((t, k) => toks[i + k] === t));
    if (hit) {
      found.push(hit.word);
      i += hit.form.length;
    } else i++;
  }
  return found;
}

/** How many times each keyword (or a sound-alike of it) appears as a whole word in the text (case does not matter). */
export function countKeywords(text: string, words: readonly string[] = CONFIG.keywords.words): Map<string, number> {
  const counts = new Map<string, number>();
  for (const w of scan(tokens(text), words)) counts.set(w, (counts.get(w) ?? 0) + 1);
  return counts;
}

/** The keywords heard in the text, in the order they were said (each listed once). */
export function matchKeywords(text: string, words: readonly string[] = CONFIG.keywords.words): string[] {
  return [...new Set(scan(tokens(text), words))];
}

const LEAD_INS = new Set(['ok', 'okay', 'now']);
/**
 * The keyword, when the phrase is just that word (an "ok"/"okay"/"now" before it, a "please" after it, and punctuation
 * are fine; sound-alikes count), otherwise null. "Start" and "Okay, next!" count; "let's start" and "next I'll add drums" do not.
 */
export function loneKeyword(text: string, words: readonly string[] = CONFIG.keywords.words): string | null {
  const toks = tokens(text);
  while (toks.length > 1 && LEAD_INS.has(toks[0])) toks.shift();
  if (toks.length > 1 && toks[toks.length - 1] === 'please') toks.pop();
  const hit = formsFor(words).find(({ form }) => form.length === toks.length && form.every((t, k) => toks[k] === t));
  return hit ? hit.word : null;
}

/** The words that count in this mode. */
export function modeWords(createMode: boolean, cfg: KeywordConfig = CONFIG.keywords): readonly string[] {
  return [...(createMode ? cfg.createWords : cfg.playWords), ...cfg.globalWords];
}

/** One speech result: the browser's guesses, best first (a plain string means just one guess). */
export type Heard = string | readonly string[];

export class KeywordGate {
  private isArmed = false;
  private disarmedAt = -Infinity;
  /** The speech results (by index) that already fired their one command (interim results repeat the same words). */
  private firedFor = new Set<number>();
  private lastFired = new Map<string, number>();
  private readonly playList: readonly string[];
  private readonly createList: readonly string[];
  /** Gets one line per finished phrase: what was heard and why it did or did not fire (for live tuning). */
  log: ((line: string) => void) | null = null;

  constructor(
    private readonly now: () => number,
    private readonly cfg: KeywordConfig = CONFIG.keywords,
  ) {
    this.playList = modeWords(false, cfg);
    this.createList = modeWords(true, cfg);
  }

  get armed(): boolean {
    return this.isArmed;
  }

  /** Start accepting words. Returns true if this changed anything. */
  arm(): boolean {
    if (this.isArmed) return false;
    this.isArmed = true;
    this.newSession();
    return true;
  }

  /** Stop accepting words. Returns true if this changed anything. */
  disarm(): boolean {
    if (!this.isArmed) return false;
    this.isArmed = false;
    this.disarmedAt = this.now();
    return true;
  }

  /** A fresh speech recognition run starts numbering its results from 0 again. */
  newSession(): void {
    this.firedFor.clear();
  }

  /**
   * Give the gate speech results `firstIndex`, `firstIndex + 1`, ... and get back the keywords to fire now.
   * Each result is its text, or the browser's guesses for it (best first). Every guess of a finished result is checked;
   * of an unfinished (interim) one only the best guess, so a clear word fires fast and odd early guesses do not.
   * Only the current mode's words count (`createMode` false = Play). Nothing is accepted while disarmed, except in
   * Create, where a finished phrase that is the word alone fires without the fist.
   * Each result fires at most one word (the first command word of the first guess that has one), and a word does not
   * fire again within the cooldown. `finals[k]` false = result k is interim.
   */
  accept(results: readonly Heard[], firstIndex = 0, createMode = false, finals: readonly boolean[] = []): string[] {
    const t = this.now();
    const open = this.isArmed || (this.cfg.graceAfterReleaseMs > 0 && t - this.disarmedAt <= this.cfg.graceAfterReleaseMs);
    const words = createMode ? this.createList : this.playList;
    const fire: string[] = [];
    results.forEach((heard, k) => {
      const guesses = typeof heard === 'string' ? [heard] : heard;
      const final = finals[k] !== false;
      const note = (word: string | null, reason: string) => {
        if (!final || !this.log) return;
        const alts = guesses.slice(1).map((g) => `"${g.trim()}"`).join(', ');
        this.log(`[speech] heard: "${(guesses[0] ?? '').trim()}" | alts: ${alts || '-'} -> ${word ?? 'none'} (${reason})`);
      };
      if (!open && !createMode) return note(null, 'fist not held');
      const idx = firstIndex + k;
      // One phrase = one command: once a word fired for this phrase (often already from an interim guess), the rest of
      // it, and every other guess of it, fire nothing ("slower" must not also fire "lower" from another guess).
      if (this.firedFor.has(idx)) return note(null, 'this phrase already fired');
      let word: string | null = null;
      if (!open) {
        // Sat-night fix: in Create without the fist, narration like "let's start" or "next I'll add drums" used to fire
        // commands. Unarmed, only a finished phrase that is the keyword alone (in any guess) counts.
        if (!final) return;
        word = guesses.map((g) => loneKeyword(g, words)).find((w) => w !== null) ?? null;
        if (!word) return note(null, matchKeywords(guesses.join(' . '), words).length ? 'not said alone; hold the fist for phrases' : 'no command word');
      } else {
        // The first guess (in the browser's order) with a command word decides; its first command word wins.
        const checked = final ? guesses : guesses.slice(0, 1);
        for (const g of checked) {
          const found = scan(tokens(g), words);
          if (found.length) {
            word = found[0];
            break;
          }
        }
        if (!word) return note(null, 'no command word');
      }
      this.firedFor.add(idx);
      if (t - (this.lastFired.get(word) ?? -Infinity) < this.cfg.cooldownMs) return note(null, 'cooling down');
      this.lastFired.set(word, t);
      fire.push(word);
      note(word, open ? 'fist held' : 'said alone');
    });
    return fire;
  }
}

export const KEYWORD_STATUS = {
  armed: 'Listening for commands (fist held)',
  disarmed: 'Keywords off: hold your left fist to give voice commands',
  unsupported: 'Voice commands are not available in this browser (they need Chrome). The microphone still works.',
} as const;
