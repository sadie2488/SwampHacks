#!/usr/bin/env node
// Writes every fake-data file in fixtures/. One generator keeps the fixtures consistent with each other.
// Layout: fixtures/<contract>/<name>.json (or .yaml for mapping). A file may hold one item or an array of items.
// fixtures/_invalid/<contract>/*.json must FAIL validation (scripts/validate-contracts.mjs checks both).
// Run: node scripts/make-fixtures.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const put = (rel, data) => {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`);
};
const r3 = (n) => Math.round(n * 1000) / 1000;

// ---------- demo song: "Twinkle, Twinkle, Little Star" (public domain), C major, 4/4, 100 bpm, 12 bars ----------
const BPM = 100;
const SEC = 60 / BPM; // seconds per beat
const C = 60, D = 62, E = 64, F = 65, G = 67, A = 69;
const bars = [
  [[C, 1], [C, 1], [G, 1], [G, 1]], [[A, 1], [A, 1], [G, 2]], [[F, 1], [F, 1], [E, 1], [E, 1]], [[D, 1], [D, 1], [C, 2]],
  [[G, 1], [G, 1], [F, 1], [F, 1]], [[E, 1], [E, 1], [D, 2]], [[G, 1], [G, 1], [F, 1], [F, 1]], [[E, 1], [E, 1], [D, 2]],
  [[C, 1], [C, 1], [G, 1], [G, 1]], [[A, 1], [A, 1], [G, 2]], [[F, 1], [F, 1], [E, 1], [E, 1]], [[D, 1], [D, 1], [C, 2]],
];
const melody = [];
let beat = 0;
for (const bar of bars) {
  for (const [pitch, len] of bar) {
    melody.push({ id: `m${melody.length + 1}`, pitch, onset_sec: r3(beat * SEC), duration_sec: r3(len * SEC * 0.95), onset_beat: beat, duration_beat: len, velocity: 0.8, part: 'melody', confidence: 0.95 });
    beat += len;
  }
}
const bassRoots = [48, 53, 48, 55, 48, 55, 48, 55, 48, 53, 48, 55];
const bass = bassRoots.map((pitch, i) => ({ id: `b${i + 1}`, pitch, onset_sec: r3(i * 4 * SEC), duration_sec: r3(4 * SEC * 0.95), onset_beat: i * 4, duration_beat: 4, velocity: 0.6, part: 'bass', confidence: 0.9 }));
const totalBeats = beat; // 48
const twinkle = {
  version: 1,
  song_id: 'demo-twinkle',
  title: 'Twinkle, Twinkle, Little Star',
  source: { kind: 'demo', file_name: 'twinkle.mp3' },
  analyzed_at: '2026-10-17T09:00:00Z',
  duration_sec: r3(totalBeats * SEC),
  tempo_bpm: BPM,
  tempo_confidence: 0.98,
  beats: Array.from({ length: totalBeats }, (_, i) => r3(i * SEC)),
  downbeats: Array.from({ length: totalBeats / 4 }, (_, i) => r3(i * 4 * SEC)),
  key: { tonic: 'C', mode: 'major', confidence: 0.97 },
  time_signature: { numerator: 4, denominator: 4 },
  sections: [
    { label: 'A', start_sec: 0, end_sec: r3(16 * SEC) },
    { label: 'B', start_sec: r3(16 * SEC), end_sec: r3(32 * SEC) },
    { label: 'A', start_sec: r3(32 * SEC), end_sec: r3(48 * SEC) },
  ],
  parts: [
    { id: 'melody', name: 'Melody', kind: 'melody', instrument: 'clarinet', notes: melody },
    { id: 'bass', name: 'Bass', kind: 'bass', instrument: 'trombone', notes: bass },
  ],
};
put('song-analysis/twinkle.json', twinkle);
put('song-analysis/minimal.json', {
  version: 1, song_id: 'demo-minimal', duration_sec: 4, tempo_bpm: 120, key: { tonic: 'C', mode: 'major' }, time_signature: { numerator: 4, denominator: 4 },
  parts: [{ id: 'melody', name: 'Melody', notes: [{ pitch: 60, onset_sec: 0, duration_sec: 0.5 }, { pitch: 62, onset_sec: 0.5, duration_sec: 0.5 }, { pitch: 64, onset_sec: 1, duration_sec: 1 }] }],
});

// ---------- note-event ----------
put('note-event/middle-c.json', { version: 1, id: 'n1', pitch: 60, onset_sec: 0, duration_sec: 0.5, onset_beat: 0, duration_beat: 1, velocity: 0.8, part: 'melody', confidence: 0.95 });
put('note-event/bare-minimum.json', { version: 1, pitch: 72, onset_sec: 2.25, duration_sec: 0.25 });

// ---------- performance-event: the learner plays the melody's first 8 notes about 10% too slow, with ~120 ms latency ----------
const LATENCY_MS = 120;
const slow = melody.slice(0, 8).map((n, i) => ({
  version: 1, type: 'note', session_id: 'fixture-session-1',
  time_sec: r3(n.onset_sec / 0.9 + LATENCY_MS / 1000), pitch: i === 3 ? n.pitch + 0.3 : n.pitch, cents_off: i === 3 ? 30 : 0,
  duration_sec: r3(n.duration_sec / 0.9), loudness: 0.6, confidence: 0.9, latency_offset_ms: LATENCY_MS,
}));
put('performance-event/twinkle-played-slow.json', slow);
put('performance-event/onset.json', { version: 1, type: 'onset', session_id: 'fixture-session-1', time_sec: 1.234, loudness: 0.7, confidence: 0.8 });
put('performance-event/calibration.json', { version: 1, type: 'calibration', session_id: 'fixture-session-1', time_sec: 3.0, latency_offset_ms: LATENCY_MS, confidence: 0.95 });

// ---------- feedback ----------
put('feedback/rules-tempo.json', {
  version: 1, session_id: 'fixture-session-1', song_id: 'demo-twinkle', generated_at: '2026-10-17T09:05:00Z', source: 'rules', pending: true,
  summary: 'You played about 10% slower than the song and held steady notes. One note was a little sharp.',
  tempo: { target_bpm: 100, played_bpm: 90, ratio: 0.9, verdict: 'dragging' },
  issues: [
    { kind: 'tempo', start_sec: 0, end_sec: 4.8, bars: [1, 2], severity: 'medium', message: 'You dragged in bars 1-2: try counting along with the metronome.' },
    { kind: 'pitch', start_sec: 1.8, end_sec: 2.4, severity: 'low', message: 'The 4th note was about 30 cents sharp.' },
  ],
  strengths: ['Every note was in the right order', 'Clean attacks'],
  next_step: 'Play bars 1-2 at 80% speed, then bring it up to 100%.',
});
put('feedback/gemini-coaching.json', {
  version: 1, session_id: 'fixture-session-1', song_id: 'demo-twinkle', generated_at: '2026-10-17T09:05:08Z', source: 'gemini', pending: false,
  summary: 'Nice work: right notes, steady sound. Speed is the one thing to fix.',
  coaching: 'You nailed the notes. Your tempo drifted slow, which is really common on a first pass. Try the first two bars at 80% speed with a metronome, then nudge it back up.',
});
put('feedback/canned.json', { version: 1, song_id: 'demo-twinkle', source: 'canned', summary: 'Good effort. Keep a steady beat and try again at a slower tempo.', next_step: 'Slow the song to 80% and play along.' });

// ---------- signal: fake sensors to replay ----------
put('signal/hand-height.json', { version: 1, id: 'vision.hand.right.height', kind: 'slider', value: 0.72, confidence: 0.93, t_ms: 1520.5 });
put('signal/clap.json', { version: 1, id: 'audio.clap', kind: 'moment', state: 'start', confidence: 0.88, t_ms: 4010 });
put('signal/hum-pitch.json', { version: 1, id: 'audio.hum.pitch', kind: 'slider', value: 0.45, raw: 62.3, confidence: 0.8, t_ms: 900 });
put('signal/fist-held.json', [
  { version: 1, id: 'vision.hand.left.fist', kind: 'moment', state: 'start', confidence: 0.9, t_ms: 2000 },
  { version: 1, id: 'vision.hand.left.fist', kind: 'moment', state: 'end', confidence: 0.9, t_ms: 3500 },
]);
// a right hand sweeping up and back down over 4 s at 15 fps
put('signal/hand-sweep.json', Array.from({ length: 60 }, (_, i) => ({
  version: 1, id: 'vision.hand.right.height', kind: 'slider', value: r3(0.5 - 0.45 * Math.cos((i / 59) * 2 * Math.PI)), confidence: 0.95, t_ms: Math.round(i * (1000 / 15)),
})));

// ---------- command-event ----------
put('command-event/button-tempo.json', { version: 1, command: 'playback.tempo', source: 'button', how: 'set', value: 0.8, mode: 'play', t_ms: 5000 });
put('command-event/gesture-follow.json', { version: 1, command: 'playback.tempo', source: 'gesture', how: 'follow', value: 1.1, mode: 'play', mapping: 'hand height controls tempo', signal: 'vision.hand.right.height', t_ms: 6100 });
put('command-event/voice-pause.json', { version: 1, command: 'playback.pause', source: 'voice', how: 'trigger', mode: 'play', mapping: 'pause by voice', signal: 'audio.keyword.pause', t_ms: 7200 });

// ---------- mapping (Veda's file format) ----------
put('mapping/starter.yaml', `# Starter mappings. Veda owns this file and may change anything in it.
# "When [signal] happens in [mode], do [control], [this way]". Full guide: docs/commands-guide.md

- name: hand height controls tempo
  mode: play
  when: vision.hand.right.height
  do: playback.tempo
  how: follow
  range: [0.5, 1.5]
  smoothing: 0.3
  min_confidence: 0.6

- name: head tilt slows down        # switched off: it would fight with the hand-height rule above
  enabled: false
  mode: play
  when: vision.head.tilt
  do: playback.tempo
  how: follow
  range: [1.0, 0.5]
  smoothing: 0.5

- name: clap toggles play/pause
  mode: play
  when: audio.clap
  do: playback.toggle
  how: trigger
  cooldown_ms: 600

- name: say "pause" only while left fist is held
  mode: play
  when: audio.keyword.pause
  only_while: vision.hand.left.fist
  do: playback.pause
  how: trigger

- name: say "play" only while left fist is held
  mode: play
  when: audio.keyword.play
  only_while: vision.hand.left.fist
  do: playback.play
  how: trigger

- name: say "slower" only while left fist is held
  mode: play
  when: audio.keyword.slower
  only_while: vision.hand.left.fist
  do: playback.tempo
  how: nudge
  step: -0.1

- name: say "faster" only while left fist is held
  mode: play
  when: audio.keyword.faster
  only_while: vision.hand.left.fist
  do: playback.tempo
  how: nudge
  step: 0.1

- name: say "higher" only while left fist is held
  mode: play
  when: audio.keyword.higher
  only_while: vision.hand.left.fist
  do: playback.pitch
  how: nudge
  step: 1

- name: snap adds a layer
  mode: create
  when: audio.snap
  do: create.layer.add
  how: trigger
  cooldown_ms: 500

- name: drum hit toggles the beat
  mode: create
  when: vision.hand.right.drum_hit
  do: create.beat
  how: toggle
  cooldown_ms: 400
`);

// ---------- td-message ----------
put('td-message/frame.json', {
  version: 1, t_ms: 12345.6, mode: 'play', intensity: 0.6,
  audio: { rms: 0.35, onset: true, pitch_midi: 62.2, bpm: 100, beat_phase: 0.25, bands: [0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1] },
  hands: { left: null, right: { x: 0.62, y: 0.3, height: 0.7, fist: false, open_palm: true, pinch: 0.1 }, distance: 0.4 },
});
put('td-message/no-hands.json', { version: 1, t_ms: 100, audio: { rms: 0, onset: false, pitch_midi: null }, hands: { left: null, right: null } });

// ---------- invalid examples: each must be REJECTED ----------
put('_invalid/note-event/pitch-out-of-range.json', { version: 1, pitch: 300, onset_sec: 0, duration_sec: 1 });
put('_invalid/note-event/missing-duration.json', { version: 1, pitch: 60, onset_sec: 0 });
put('_invalid/signal/slider-without-value.json', { version: 1, id: 'vision.hand.right.height', kind: 'slider', t_ms: 10 });
put('_invalid/signal/bad-id.json', { version: 1, id: 'Hand Height', kind: 'slider', value: 0.5, t_ms: 10 });
put('_invalid/command-event/unknown-source.json', { version: 1, command: 'playback.tempo', source: 'telepathy', t_ms: 1 });
put('_invalid/performance-event/note-without-pitch.json', { version: 1, type: 'note', time_sec: 1 });
put('_invalid/performance-event/calibration-without-offset.json', { version: 1, type: 'calibration', time_sec: 1 });
put('_invalid/song-analysis/no-parts.json', { version: 1, song_id: 'x', duration_sec: 3, tempo_bpm: 100, key: { tonic: 'C', mode: 'major' }, time_signature: { numerator: 4, denominator: 4 } });
put('_invalid/feedback/bad-verdict.json', { version: 1, song_id: 'x', source: 'rules', summary: 's', tempo: { target_bpm: 100, played_bpm: 90, verdict: 'wobbly' } });
put('_invalid/mapping/missing-do.yaml', `- name: broken\n  when: audio.clap\n  how: trigger\n`);
put('_invalid/mapping/bad-how.yaml', `- name: broken\n  when: audio.clap\n  do: playback.toggle\n  how: wiggle\n`);
put('_invalid/td-message/bands-too-short.json', { version: 1, t_ms: 1, audio: { rms: 0.1, onset: false, bands: [0.1, 0.2] }, hands: {} });
put('_invalid/note-event/wrong-version.json', { version: 2, pitch: 60, onset_sec: 0, duration_sec: 1 });

console.log('fixtures written');
