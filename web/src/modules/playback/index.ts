// The playback module: plays the song with tempo (0.5x to 1.5x) and pitch (-12 to +12 semitones) changing on their own.
// Listens to: songAudio (decoded upload), analysis (demo songs get sound made from their notes), controls, command.
// Publishes: transport (immediately on any change, and about 15 times a second while playing), status.
//
//   index.ts       wires the bus to the controller            controller.ts   the transport logic (no Web Audio)
//   output.ts      Web Audio: script node + gain              stretch-engine.ts  the sound engine (pure, tested in Node)
//   render-notes.ts  demo song from note events               beats.ts        beat phase
import { bus, reportStatus, type Stop } from '@/bus';
import { PlaybackController } from './controller';
import { WebAudioOutput } from './output';
import type { PcmSource } from './stretch-engine';

let active: PlaybackController | null = null;

/** Jump to a place in the song (song seconds). For the shell to use later; there is no control for it in the catalog. */
export function seek(sec: number): void {
  active?.seek(sec);
}

function toPcm(buffer: AudioBuffer): PcmSource {
  const channels: Float32Array[] = [];
  for (let i = 0; i < Math.min(2, buffer.numberOfChannels); i++) channels.push(buffer.getChannelData(i));
  return { sampleRate: buffer.sampleRate, channels };
}

export function start(): Stop {
  const controller = new PlaybackController({
    output: new WebAudioOutput(),
    publish: (state) => bus.emit('transport', state),
    report: (state, message) => reportStatus('playback', state, message),
  });
  active = controller;
  reportStatus('playback', 'idle', 'Waiting for a song');
  bus.emit('transport', controller.state());

  const stops: Stop[] = [
    // "replay" so a song or setting that arrived before this module started is not missed
    bus.on('songAudio', (a) => controller.setSongAudio(a.songId, toPcm(a.buffer)), { replay: true }),
    bus.on('analysis', (a) => controller.setAnalysis(a), { replay: true }),
    bus.on('controls', (c) => controller.applyControls(c), { replay: true }),
    bus.on('command', (cmd) => controller.command(cmd.command)),
  ];

  return () => {
    for (const stop of stops) stop();
    controller.dispose();
    if (active === controller) active = null;
    reportStatus('playback', 'idle', 'Stopped');
  };
}
