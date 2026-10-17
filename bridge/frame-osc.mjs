// Turns one td-message frame (see contracts/td-message.schema.json) into the list of OSC messages TouchDesigner receives.
// The address layout here is the one documented in touchdesigner/README.md: change both together.
import { f, i, s } from './osc.mjs';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** True when the parsed JSON has the basic shape of a td-message frame. Anything else is ignored by the relay. */
export function looksLikeFrame(frame) {
  return isObject(frame) && frame.version === 1 && isObject(frame.audio) && isObject(frame.hands);
}

function handMessages(side, hand) {
  const base = `/hand/${side}`;
  if (!isObject(hand)) {
    // Hand not visible: send zeros (so numbers don't freeze at their last value) and present = 0.
    return [
      [`${base}/x`, f(0)],
      [`${base}/y`, f(0)],
      [`${base}/height`, f(0)],
      [`${base}/fist`, i(0)],
      [`${base}/open_palm`, i(0)],
      [`${base}/pinch`, f(0)],
      [`${base}/present`, i(0)],
    ];
  }
  const y = num(hand.y);
  return [
    [`${base}/x`, f(num(hand.x))],
    [`${base}/y`, f(y)],
    [`${base}/height`, f(num(hand.height, 1 - y))],
    [`${base}/fist`, i(hand.fist ? 1 : 0)],
    [`${base}/open_palm`, i(hand.open_palm ? 1 : 0)],
    [`${base}/pinch`, f(num(hand.pinch))],
    [`${base}/present`, i(1)],
  ];
}

/**
 * The OSC messages for one frame, as [address, value] pairs where the value is already tagged (f / i / s).
 * Missing numbers become 0. No pitch is sent as -1. /mode and /intensity are only sent when the frame has them.
 */
export function frameToOsc(frame) {
  const audio = frame.audio;
  const hands = frame.hands;
  const bands = Array.isArray(audio.bands) ? audio.bands : [];
  const out = [
    ['/audio/rms', f(num(audio.rms))],
    ['/audio/onset', i(audio.onset ? 1 : 0)],
    ['/audio/pitch', f(typeof audio.pitch_midi === 'number' && Number.isFinite(audio.pitch_midi) ? audio.pitch_midi : -1)],
    ['/audio/bpm', f(num(audio.bpm))],
    ['/audio/beat_phase', f(num(audio.beat_phase))],
  ];
  for (let b = 0; b < 8; b++) out.push([`/audio/band/${b}`, f(num(bands[b]))]);
  out.push(...handMessages('left', hands.left), ...handMessages('right', hands.right));
  out.push(['/hands/distance', f(num(hands.distance))]);
  if (typeof frame.mode === 'string') out.push(['/mode', s(frame.mode)]);
  if (typeof frame.intensity === 'number' && Number.isFinite(frame.intensity)) out.push(['/intensity', f(frame.intensity)]);
  return out;
}
