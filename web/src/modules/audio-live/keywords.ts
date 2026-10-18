// Spoken keywords. The instrument is loud, so words are only accepted while a gesture arms them
// (default: the left fist is held). All the logic is here and uses an injected clock so it can be tested.
import { CONFIG } from './config';

export type Keyword = (typeof CONFIG.keywords.words)[number];

/** How many times each keyword appears as a whole word in the text (case does not matter). */
export function countKeywords(text: string, words: readonly string[] = CONFIG.keywords.words): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of text.toLowerCase().split(/[^a-z']+/)) {
    if (token && words.includes(token)) counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

/** The keywords heard in the text, in the order they were said (each listed once). */
export function matchKeywords(text: string, words: readonly string[] = CONFIG.keywords.words): string[] {
  const found: string[] = [];
  for (const token of text.toLowerCase().split(/[^a-z']+/)) if (token && words.includes(token) && !found.includes(token)) found.push(token);
  return found;
}

/**
 * The keyword, when the phrase is just that word (an "ok"/"okay" before it and punctuation are fine), otherwise null.
 * "Start" and "Okay, next!" count; "let's start" and "next I'll add drums" do not.
 */
export function loneKeyword(text: string, words: readonly string[] = CONFIG.keywords.words): string | null {
  const t = text.trim().toLowerCase().replace(/^(?:ok|okay)\b[\s,.!?]*/, '').replace(/[\s.,!?;:]+$/, '');
  return words.includes(t) ? t : null;
}

export class KeywordGate {
  private isArmed = false;
  private disarmedAt = -Infinity;
  /** Per speech result: how many times each word has already been accepted (interim results repeat the same words). */
  private seen = new Map<number, Map<string, number>>();
  private lastFired = new Map<string, number>();

  constructor(
    private readonly now: () => number,
    private readonly cfg = CONFIG.keywords,
  ) {}

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
    this.seen.clear();
  }

  /**
   * Give the gate the text of speech results `firstIndex`, `firstIndex + 1`, ... and get back the keywords to fire now.
   * Nothing is accepted while disarmed. A word is only accepted once per result, and not again within the cooldown.
   * `allowWhileDisarmed` (Create mode) lets words through without the fist, but only a final result that is the word alone.
   * `finals[k]` says whether result k is final (missing means final).
   */
  accept(texts: readonly string[], firstIndex = 0, allowWhileDisarmed = false, finals: readonly boolean[] = []): string[] {
    const t = this.now();
    const open = this.isArmed || (this.cfg.graceAfterReleaseMs > 0 && t - this.disarmedAt <= this.cfg.graceAfterReleaseMs);
    if (!open && !allowWhileDisarmed) return [];
    // Sat-night fix: in Create without the fist, narration like "let's start" or "next I'll add drums" used to fire
    // commands. Unarmed, only a finished phrase that is the keyword alone counts. With the fist held nothing changes.
    const loneOnly = !open;
    const fire: string[] = [];
    texts.forEach((text, k) => {
      const idx = firstIndex + k;
      let done = this.seen.get(idx);
      if (!done) this.seen.set(idx, (done = new Map()));
      const lone = loneOnly ? (finals[k] === false ? null : loneKeyword(text, this.cfg.words)) : undefined;
      if (lone === null) return;
      for (const [word, count] of countKeywords(lone ?? text, this.cfg.words)) {
        const already = done.get(word) ?? 0;
        if (count <= already) continue;
        done.set(word, count);
        if (t - (this.lastFired.get(word) ?? -Infinity) < this.cfg.cooldownMs) continue;
        this.lastFired.set(word, t);
        fire.push(word);
      }
    });
    return fire;
  }
}

export const KEYWORD_STATUS = {
  armed: 'Listening for commands (fist held)',
  disarmed: 'Keywords off: hold your left fist to give voice commands',
  unsupported: 'Voice commands are not available in this browser (they need Chrome). The microphone still works.',
} as const;
