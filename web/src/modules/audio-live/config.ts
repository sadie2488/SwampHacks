// Every number you might want to tune for the microphone lives here, with a note on what it does.
// None of these were tuned on a real microphone yet (see the report): start with the "hand" and "pitch" sections.
// Levels are RMS on a 0..1 scale (1.0 = full-scale). Handy values: 0.01 = -40 dBFS, 0.03 = -30 dBFS, 0.1 = -20 dBFS.
export const CONFIG = {
  /** Write every snap, clap and ignored loud sound (with the measurements behind the decision) to the browser console
   * at "Verbose" level. Switch the console's level filter to Verbose to read it while tuning the numbers below. */
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
  hand: {
    /** Both need a burst at least this loud ... */
    minPeakRms: 0.04,
    /** ... and this many times louder than the recent average. */
    minJumpRatio: 5,
    /** Noisiness check (spectral flatness, 0..1). Singing and instruments score near 0, hand sounds higher. Below this = not a hand sound. */
    minFlatness: 0.03,
    /** Longer than this is not a snap or clap. */
    clapMaxBurstMs: 150,
    snap: {
      /** A snap is SHORT ... */
      maxBurstMs: 25,
      /** ... and BRIGHT: energy centred high up (spectral centroid) with most of it above 2.5 kHz. */
      minCentroidHz: 3000,
      minHfRatio: 0.5,
    },
    /** Another snap or clap within this many ms of the last one is the same sound echoing, not counted twice. */
    cooldownMs: 250,
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
