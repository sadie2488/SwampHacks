// The playback module: plays the song with tempo (0.5x to 1.5x) and pitch (-12 to +12 semitones) changing on their own.
// Listens to: songAudio (decoded upload), analysis (demo songs get sound made from their notes), controls, command,
// mode (switching to Create pauses the song, so it does not play over a hum being recorded).
// Publishes: transport (immediately on any change, and about 15 times a second while playing), status,
// songLevels (the song's loudness in 8 bands, about 30 times a second while playing; zeros when it stops).
//
//   index.ts            wires the bus to the controller       controller.ts      the transport logic (no Web Audio)
//   output.ts           Web Audio: sound path and volume      stretch-engine.ts  the sound engine (pure, tested in Node)
//   worklet-backend.ts  engine in an AudioWorklet (preferred) engine-core.ts     the engine's code (also copied into the worklet)
//   script-backend.ts   engine in a script node (fallback)    worklet-source.ts  the worklet script, built as text
//   render-notes.ts     demo song from note events            beats.ts           beat phase
//   song-levels.ts      runs the level meter while playing    levels.ts          band and level math (pure)
// If the worklet cannot be used, output.ts quietly switches to the script node and carries on from the same place.
import { bus, getStatus, isFakeMode, reportStatus, type Stop } from '@/bus';
import type { Mode } from '@/contracts';
import { PlaybackController } from './controller';
import { WebAudioOutput } from './output';
import { analyserSource, createSongLevels, fakeSource } from './song-levels';
import type { PcmSource } from './stretch-engine';

let active: PlaybackController | null = null;

/** Jump to a place in the song (song seconds), straight away: the Learn screen's drag-to-scrub calls this on every frame. */
export function seek(sec: number): void {
  active?.seek(sec);
}

function toPcm(buffer: AudioBuffer): PcmSource {
  const channels: Float32Array[] = [];
  for (let i = 0; i < Math.min(2, buffer.numberOfChannels); i++) channels.push(buffer.getChannelData(i));
  return { sampleRate: buffer.sampleRate, channels };
}

export function start(): Stop {
  const output = new WebAudioOutput();
  const controller = new PlaybackController({
    output,
    publish: (state) => bus.emit('transport', state),
    report: (state, message) => reportStatus('playback', state, message),
  });
  active = controller;
  reportStatus('playback', 'idle', 'Waiting for a song');
  bus.emit('transport', controller.state());

  const levels = createSongLevels({
    source: isFakeMode() ? fakeSource() : analyserSource(() => output.analyserNode()),
    publish: (v) => bus.emit('songLevels', v),
    now: () => performance.now(),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
    isHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
    onVisibilityChange: (fn) => {
      if (typeof document === 'undefined') return () => {};
      const doc = document;
      doc.addEventListener('visibilitychange', fn);
      return () => doc.removeEventListener('visibilitychange', fn);
    },
  });

  // The mode we saw last. The first value (the replay) only sets it: pausing is for a real switch into Create.
  let lastMode: Mode | undefined;

  const tdStatus = getStatus('touchdesigner');
  levels.setKeepAwake(tdStatus !== undefined && tdStatus.state !== 'idle');

  const stops: Stop[] = [
    // "replay" so a song or setting that arrived before this module started is not missed
    bus.on('songAudio', (a) => controller.setSongAudio(a.songId, toPcm(a.buffer)), { replay: true }),
    bus.on('analysis', (a) => controller.setAnalysis(a), { replay: true }),
    bus.on('controls', (c) => controller.applyControls(c), { replay: true }),
    bus.on('command', (cmd) => controller.command(cmd.command, cmd.value)),
    bus.on('transport', (t) => levels.setPlaying(t.playing), { replay: true }),
    // TouchDesigner streaming on (any state but idle, even while it retries the relay): keep levels going in a hidden tab
    bus.on('status', (s) => {
      if (s.module === 'touchdesigner') levels.setKeepAwake(s.state !== 'idle');
    }),
    // Create has no transport to stop the song with, and the song would bleed into the microphone.
    // The position is kept and nothing resumes by itself when the user leaves Create.
    bus.on(
      'mode',
      (mode) => {
        const switchedToCreate = lastMode !== undefined && lastMode !== mode && mode === 'create';
        lastMode = mode;
        if (switchedToCreate) controller.pause();
      },
      { replay: true },
    ),
  ];

  return () => {
    for (const stop of stops) stop();
    levels.dispose();
    controller.dispose();
    if (active === controller) active = null;
    reportStatus('playback', 'idle', 'Stopped');
  };
}
