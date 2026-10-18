# TouchDesigner brief for Lalitha's laptop (from the main laptop)

Lalitha will build the TouchDesigner visuals on her own laptop with FAKE data, then bring the `.toe` file to the main laptop for the demo. Claude on Lalitha's laptop: please walk her through this.

## 1. What TouchDesigner receives
The website sends ~30 frames a second to a small relay, which forwards them to TouchDesigner as **OSC on UDP port 7000**. On your laptop you don't need the website: the fake sender below sends the very same channels.

| Channel | Meaning |
|---|---|
| `audio/rms` | loudness 0-1 |
| `audio/onset` | 1 for one frame when a note starts (use a Trigger / Count CHOP) |
| `audio/pitch` | MIDI note (60 = middle C); -1 = no clear pitch |
| `audio/bpm` | tempo of the song |
| `audio/beat_phase` | 0-1 position inside the current beat (great for pulses) |
| `audio/band/0` .. `audio/band/7` | the song's 8 frequency bands, bass to treble, 0-1, smoothed |
| `hand/left/*`, `hand/right/*` | `x`, `y` (0 = top), `height` (1 = top), `fist` 0/1, `open_palm` 0/1, `pinch` 0-1, `present` 1 when seen |
| `hands/distance` | 0-1 |
| `mode` | text: learn / play / create (read with an **OSC In DAT**) |
| `intensity` | 0-1 |
Full guide: `touchdesigner/README.md` in the repo.

## 2. Set up on Lalitha's laptop (10 minutes)
1. Install Node.js (LTS) if `node --version` doesn't work.
2. Get the fake sender, either way:
   - After the main laptop's next push: `git checkout main && git pull`, then the file is `bridge/fake-td.mjs`.
   - Right now: save the code in section 5 as `fake-td.mjs` inside the repo's `bridge/` folder (it needs `bridge/osc.mjs` and `bridge/frame-osc.mjs`, which are already in your copy of the repo).
3. Run it: `node bridge/fake-td.mjs` (Ctrl+C to stop). Options: `--bpm 90`, `--seconds 60`, `--osc-port 7001`.
4. In TouchDesigner: add an **OSC In CHOP**, Network Port **7000**, Active **On**. The channels start moving. For `mode` add an **OSC In DAT** on the same port.
5. Build the visuals against these numbers.

## 3. Design notes (match the website)
- The website is "Overture": every mode is a record you drop into; the music makes its flower bloom. Keep TouchDesigner in that world: dark, calm, one bold idea, music-reactive.
- Mode colours (use `mode` to switch): menu pink `#ff2d8a` on `#0b0a0c`; learn teal `#1fb3bf` on `#08161a`; play orange `#ff7a00` on `#170c06`; create lilac `#c9a8ff` on `#120d1a`.
- Good drivers: `audio/band/0-1` (bass) for scale/pulse, `audio/beat_phase` for a once-per-beat bloom, `audio/onset` for sparks, `hand/right/height` and `x/y` for position, `hands/distance` for spread, `fist` for a "hold"/freeze.
- Keep it light: the demo laptop also runs the website and camera tracking. Prefer GPU TOPs, a modest resolution (e.g. 1280x720) and a capped frame rate.

## 4. Bring it to the demo laptop
- Save as one `.toe` file (use relative paths for any images; put them next to the `.toe`).
- Commit it to your branch `design/lalitha/F1-look` in `touchdesigner/` (only if it's smaller than ~10 MB; otherwise send it by USB/Drive) and tell the main laptop. Never commit other artists' images.
- On the demo laptop: the app already starts the relay (`node scripts/dev.mjs`). Open the `.toe`, then press the **sparkle button** next to the Overture logo to start sending. Same channel names, no changes needed.
- If TouchDesigner should run on a DIFFERENT laptop than the website during the demo, tell the main laptop: the relay needs `--ws-host 0.0.0.0` and the OSC host set to that laptop's address (5-minute change).

## 5. The fake sender code (bridge/fake-td.mjs)
```js
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
```
