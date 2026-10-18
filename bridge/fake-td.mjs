// Sends made-up music and hand numbers straight to TouchDesigner over OSC, with no website and no relay.
// Use it to build or test a TouchDesigner file on any laptop: same channels as the real app (touchdesigner/README.md).
// Run:  node bridge/fake-td.mjs            (OSC to 127.0.0.1:7000, 30 frames a second, until Ctrl+C)
//       node bridge/fake-td.mjs --osc-port 7001 --bpm 90 --seconds 60
import dgram from 'node:dgram';
import { frameToOsc } from './frame-osc.mjs';
import { encodeMessage } from './osc.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] !== undefined ? args[at + 1] : fallback;
};
if (args.includes('--help')) {
  console.log('node bridge/fake-td.mjs [--osc-host 127.0.0.1] [--osc-port 7000] [--bpm 120] [--fps 30] [--seconds 0 (= until Ctrl+C)]');
  process.exit(0);
}
const host = opt('osc-host', '127.0.0.1');
const port = Number(opt('osc-port', 7000));
const bpm = Number(opt('bpm', 120));
const fps = Number(opt('fps', 30));
const seconds = Number(opt('seconds', 0));
const MODES = ['learn', 'play', 'create'];
const MELODY = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62]; // a C major run, one note per beat

const socket = dgram.createSocket('udp4');
const start = Date.now();
let lastBeat = -1;
let sent = 0;

function frameAt(t) {
  const beats = (t * bpm) / 60;
  const beat = Math.floor(beats);
  const phase = beats - beat;
  const onset = beat !== lastBeat;
  lastBeat = beat;
  const kick = Math.exp(-phase * 6); // a hit on every beat that fades out
  const bands = [0, 1, 2, 3, 4, 5, 6, 7].map((b) => {
    const wobble = 0.5 + 0.5 * Math.sin(t * (0.7 + b * 0.37) + b);
    const weight = b < 2 ? 0.75 * kick + 0.15 : 0.25 + 0.35 * wobble * (1 - b / 10);
    return Math.min(1, Math.max(0, weight));
  });
  const circle = (r, speed, offset) => ({ x: 0.5 + r * Math.cos(t * speed + offset), y: 0.5 + r * Math.sin(t * speed + offset) });
  const right = circle(0.25, 0.8, 0);
  const left = circle(0.2, 0.6, Math.PI);
  const leftSeen = Math.sin(t * 0.3) > -0.6; // the left hand leaves now and then, like a real person
  return {
    version: 1,
    audio: { rms: 0.25 + 0.5 * kick, onset, pitch_midi: MELODY[beat % MELODY.length], bpm, beat_phase: phase, bands },
    hands: {
      right: { ...right, height: 1 - right.y, fist: Math.sin(t * 0.5) > 0.8, open_palm: Math.sin(t * 0.5) < -0.5, pinch: 0.5 + 0.5 * Math.sin(t * 1.3) },
      left: leftSeen ? { ...left, height: 1 - left.y, fist: false, open_palm: true, pinch: 0 } : null,
      distance: leftSeen ? Math.hypot(right.x - left.x, right.y - left.y) : 0,
    },
    mode: MODES[Math.floor(t / 20) % MODES.length], // changes every 20 s
    intensity: 0.5 + 0.5 * Math.sin(t * 0.1),
  };
}

const timer = setInterval(() => {
  const t = (Date.now() - start) / 1000;
  if (seconds > 0 && t >= seconds) return stop();
  for (const [address, value] of frameToOsc(frameAt(t))) socket.send(encodeMessage(address, [value]), port, host);
  sent++;
}, 1000 / fps);

const status = setInterval(() => console.log(`fake-td: ${sent} frames sent to ${host}:${port} (${bpm} bpm)`), 3000);
function stop() {
  clearInterval(timer);
  clearInterval(status);
  socket.close();
  console.log(`fake-td: stopped after ${sent} frames`);
  process.exit(0);
}
process.on('SIGINT', stop);
console.log(`fake-td: sending made-up music + hands to TouchDesigner at ${host}:${port}. Press Ctrl+C to stop.`);
