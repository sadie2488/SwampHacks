// Every number you might want to tune for the microphone lives here, with a note on what it does.
// None of these were tuned on a real microphone yet (see the report): start with the "hand" and "pitch" sections.
// Levels are RMS on a 0..1 scale (1.0 = full-scale). Handy values: 0.01 = -40 dBFS, 0.03 = -30 dBFS, 0.1 = -20 dBFS.
export const CONFIG = {
  /** Write every snap, clap and ignored loud sound (with the measurements behind the decision) to the browser console
   * at "Verbose" level, one short line each. Switch the console's level filter to Verbose to read it while tuning the
   * numbers below: clap, snap and tap a few times, then copy the "[audio-live]" lines. */
  debug: true,

  // ---- pitch (the hum or voice) ----
  pitch: {
    /** How often a pitch frame is made, in ms (20 = about 50 per second). */
    hopMs: 20,
    /** Samples looked at for each frame (a power of 2). 2048 is about 43 ms at 48 kHz. Bigger = steadier but slower. */
    windowSize: 2048,
    /** Quieter than this and there is "no pitch" (midi = null). Raise it if room noise makes ghost notes. */
    minRms: 0.004,
    /** pitchy "clarity" (0..1) needed to trust a pitch. Pure tones score about 0.99, voices 0.9+, noise under 0.6. */
    minClarity: 0.88,
    /** Pitches outside this range are ignored (about MIDI 31 to 98). */
    minHz: 50,
    maxHz: 2600,
  },

  // ---- turning pitch frames into notes ----
  note: {
    /** A pitch must hold at least this long to count as a note. */
    minNoteMs: 80,
    /** A short dropout (no pitch) up to this long does not end a note. */
    maxGapMs: 60,
    /** A frame belongs to the current note if it is within this many semitones of the note's average (allows vibrato). */
    toleranceSemitones: 0.7,
    /** A different pitch must last this many frames in a row before the old note ends and a new one starts. */
    switchFrames: 3,
  },

  // ---- audio.loudness (slider 0..1) ----
  loudness: {
    /** Level (in dB below full scale) that maps to 0 and to 1. */
    floorDb: -60,
    ceilDb: -15,
    /** Smoothing per pitch frame: fast to rise, slower to fall. 1 = no smoothing. */
    attack: 0.6,
    release: 0.2,
    /** The signal is sent this often (50 ms = 20 per second). */
    emitEveryMs: 50,
  },

  // ---- audio.hum.pitch (slider) ----
  hum: {
    /** value = (midi - lowMidi) / (highMidi - lowMidi), clamped to 0..1. Matches the catalog range 36..96. */
    lowMidi: 36,
    highMidi: 96,
    /** The signal is sent this often (40 ms = 25 per second) and only while a clear pitch is heard. */
    emitEveryMs: 40,
    /** The sent pitch is the median of this many latest pitches (removes single-frame jumps). */
    medianOf: 3,
  },

  // ---- attacks (audio.onset) from sudden jumps in loudness ----
  onset: {
    /** Loudness is measured in blocks this long. */
    blockMs: 5,
    /** The "recent average" a jump is compared against covers this long. */
    historyMs: 120,
    /** A block must be at least this many times louder than the recent average ... */
    jumpRatio: 3,
    /** ... and at least this loud (stops quiet room noise from counting as attacks). */
    minRms: 0.015,
    /** Stand-in for the recent average when the room is silent. */
    noiseFloorRms: 0.002,
    /** No second attack within this many ms of the last one. */
    refractoryMs: 80,
    /** Ignore the first moments after the mic opens (streams often start with a pop). */
    warmupMs: 300,
    /** An attack found by a changing pitch is dropped if another attack was heard this recently. */
    mergeWithPitchMs: 150,
  },

  // ---- watching a loud burst to see whether it is a snap or a clap ----
  burst: {
    /** The burst is "over" when it falls below this fraction of its peak ... */
    decayFrac: 0.2,
    /** ... or after this long (a sound that keeps going is not a snap or clap). */
    maxWaitMs: 160,
    /** The sound is analysed from the attack for this long. */
    analysisMs: 30,
  },

  // ---- snap vs clap ----
  // What the made-up test sounds in test-signals.ts measure (8 of each, at 48 and 44.1 kHz):
  //                  peak        flatness    length     attack   centre          share above 2.5 kHz
  //   clap           0.17-0.30   0.09-0.14   25-40 ms   0-5 ms   1.9-2.2 kHz     22-37 %
  //   snap + echo    0.15-0.26   0.20-0.26   15-70 ms   0-5 ms   5.1-5.7 kHz     91-96 %   (a duller snap: 3.7-4.1 kHz, 77-86 %)
  //   desk thump     0.27-0.42   0.00-0.02   10-30 ms   0-10 ms  0.3-0.4 kHz     0-1 %
  //   key click      0.08-0.11   0.31-0.51   5-10 ms    0 ms     3.8-5.4 kHz     67-91 %
  //   speech burst   0.13-0.15   0.08-0.13   95-100 ms  20-70 ms 1.6-2.1 kHz     17-38 %
  // A real clap a metre from a laptop mic is roughly 0.1 peak (-20 dBFS) in a quiet room: an estimate, not measured yet.
  // Every loud sound is written to the console with these same numbers (see `debug` at the top): use them to tune.
  hand: {
    /** Both need a burst at least this loud ... */
    minPeakRms: 0.04,
    /** ... and this many times louder than the recent average. (Unchanged: in a quiet room a clap jumps 20 times or more.) */
    minJumpRatio: 5,
    /** While the song is playing, the two numbers above are multiplied by this (so 0.064 and 8). The song coming back through
     * the speakers makes the room louder and its drums sound like claps, so a hand sound must stand out more. 1 = no change. */
    playingStrictness: 1.6,
    /** Noisiness check (spectral flatness, 0..1). Singing and instruments score near 0, hand sounds higher. Below this = not a hand sound.
     * Was 0.03. Raised to 0.05: the test claps score 0.08 or more, a desk thump 0.02 or less. */
    minFlatness: 0.05,
    /** New check. The centre of the sound (spectral centroid) must be at least this high. A thump on the desk sits under
     * 500 Hz, a clap at 1-2.5 kHz. */
    minCentroidHz: 700,
    /** New check. The loudest moment must come within this many ms of the start (measured in 5 ms steps). Hands are
     * instant; speech and music swell up over 15 ms or more. */
    maxAttackMs: 10,
    /** New check. Shorter than this is a click (a key press right next to the mic), not a snap or clap: those are over in
     * 5-10 ms, while a snap or clap at arm's length rings on in the room for 15 ms or more (measured in 5 ms steps).
     * Downside: a "dry" snap right next to the mic in a dead room is ignored too. Set to 5 to allow those again. */
    minBurstMs: 15,
    /** Longer than this is not a snap or clap. */
    clapMaxBurstMs: 150,
    snap: {
      /** A snap lasts at most this long ... Was 25 ms: a real snap with room echo lasts about 30-60 ms, so it was missed. */
      maxBurstMs: 80,
      /** ... and is BRIGHT: centre of the sound (spectral centroid) high up, a good share of the energy above 2.5 kHz.
       * Was 3000 Hz and 50 %. Lowered a little because the room echo of a snap is duller than the crack itself. The test
       * clap stays at 2.2 kHz and 37 % or below, so it stays a clap. A very bright, flat-handed clap may now count as a snap. */
      minCentroidHz: 2800,
      minHfRatio: 0.45,
    },
    /** Another snap or clap within this many ms of the last one is the same sound echoing, not counted twice.
     * Was 250. Lowered to 200 so a quick double clap (claps about 0.2 s apart) still counts as two. */
    cooldownMs: 200,
  },

  // ---- audio.clap.double (two claps close together; the play/pause rule uses it, so one stray sound cannot) ----
  doubleClap: {
    /** The second clap must come at least this long after the first ... (claps closer than hand.cooldownMs, 200 ms,
     * are already counted as one, so in practice the gap is 200 ms or more) */
    minGapMs: 150,
    /** ... and at most this long after it. */
    maxGapMs: 700,
    // A run of claps (each within maxGapMs of the one before) gives ONE double clap, at its second clap. The run has to
    // stop (a pause longer than maxGapMs) before another double clap can happen. So clapping along to music, or a
    // drum beat in the song, toggles at most once instead of flipping play/pause on every other beat.
  },

  // ---- spoken keywords ----
  keywords: {
    words: ['play', 'pause', 'slower', 'faster', 'higher', 'lower', 'start', 'next', 'piano', 'synth', 'bass', 'pluck', 'drums', 'none', 'reverb', 'delay', 'filter', 'beat'] as const,
    /** The same word is not accepted again within this many ms. */
    cooldownMs: 800,
    /** Voice results are only accepted while the arming gesture is held (plus this many ms after letting go). */
    graceAfterReleaseMs: 0,
    /** The signal that arms voice commands while it is held. */
    armSignal: 'vision.hand.left.fist',
  },
};

export type AudioLiveConfig = typeof CONFIG;
