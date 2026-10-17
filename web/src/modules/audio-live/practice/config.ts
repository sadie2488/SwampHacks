// Every number the practice code uses, in one place. None of these were tuned on a real microphone yet.
export const PRACTICE = {
  // ---- the clap check (calibration) ----
  calibration: {
    /** How many clicks to play. */
    clicks: 6,
    bpm: 90,
    /** Quiet time before the first click, so the person can get ready. */
    leadInSec: 1.0,
    /** Keep listening this long after the last click. */
    tailMs: 800,
    /** A clap further than this from its click is not a match. */
    maxApartMs: 400,
    /** At least this share of the clicks must have a clap (4 of 6). */
    minMatchFraction: 2 / 3,
    /** If the matched claps are scattered more than this (median absolute deviation) the result is not trustworthy. */
    maxSpreadMs: 120,
    /** A clap and an onset closer together than this are the same sound. */
    mergeHitsMs: 100,
    /** Click loudness (0..1). Kept low so the microphone hears the clap more than the click. */
    clickGain: 0.35,
  },
  // ---- made-up data (?fake=1) ----
  fake: {
    /** How late the pretend player's sound arrives, like a real microphone would add. */
    latencyMs: 120,
    calibrationLeadInSec: 0.4,
    calibrationTailMs: 500,
  },
  // ---- lining up what was played with the song ----
  compare: {
    /** A played note belongs to an expected note when it is this close (at a slower tempo: divided by the tempo factor). */
    windowMs: 250,
    /** The window is never wider than this share of the typical gap between notes. */
    maxWindowOfGap: 0.6,
    /** Rounds of pairing, each re-reading the player's pace from the previous round's pairs. */
    maxPasses: 4,
  },
  // ---- the rules that turn numbers into coaching (music-notes sections 2, 6 and 7) ----
  rules: {
    /** Timing: within this is on time; up to aBitMs is "a bit early/late"; beyond is off. */
    onTimeMs: 50,
    aBitMs: 100,
    /** Tempo within this share of the target counts as steady. */
    steadyBand: 0.05,
    /** Two or more bars in a row this far from the song's tempo are worth a mention even when the whole run was steady. */
    localBand: 0.08,
    /** Pitch (median over the note): within this is fine, past mentionCents we say sharp or flat. */
    pitchFineCents: 25,
    pitchMentionCents: 40,
    /** A pitch this far off (a semitone) is a different note, not an out-of-tune one. */
    wrongNoteCents: 100,
    /** A note this far from the player's own pace line counts as a wobble. */
    wobbleMs: 100,
    /** Needed before saying anything about tempo or timing. */
    minMatchedNotes: 3,
    /** A bar needs at least this many note-to-note gaps before its own tempo is judged. */
    minGapsPerBar: 2,
  },
  // ---- following the song while it plays ----
  run: {
    /** The song position moving by more than this between two updates is a jump (seek or loop). */
    jumpSec: 0.5,
    /** After the song stops, wait until nothing new has been heard for this long (a note is reported when it ends, so this must be longer than a typical note). */
    settleMs: 1200,
    /** ... but never wait longer than this in total. */
    settleLimitMs: 5000,
    /** When playback is paused or practice stopped, notes in the last stretch were not due yet. */
    pauseGraceSec: 0.4,
    /** Sound played this much before the song started still counts (ms). */
    startSlackMs: 300,
    /** A note that starts this long after an onset (or less) takes the onset's time (ms). */
    onsetBeforeNoteMs: 150,
    /** ... and this long before it (ms). */
    onsetAfterNoteMs: 40,
    /**
     * How much later than the song clock the song is really heard, beyond what the clap check measured (ms).
     * The song clock moves in blocks of about 90 ms; if real-device tests show everyone "late" or "early", adjust here.
     */
    transportLagMs: 0,
  },
};

export type PracticeConfig = typeof PRACTICE;
