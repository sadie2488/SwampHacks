// Test helper: lists everything wrong with a frame compared to contracts/td-message.schema.json (empty list = valid).
// A hand-written copy of the schema's rules, for the web tests. The relay tests check frames against the real JSON Schema.
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const inRange = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

export function shapeProblems(frame: unknown): string[] {
  const out: string[] = [];
  if (!isObject(frame)) return ['frame is not an object'];
  if (frame.version !== 1) out.push('version must be 1');
  if (!inRange(frame.t_ms, 0, Infinity)) out.push('t_ms must be a number >= 0');
  if (frame.mode !== undefined && !['learn', 'play', 'create'].includes(frame.mode as string)) out.push('mode must be learn, play or create');
  if (frame.intensity !== undefined && !inRange(frame.intensity, 0, 1)) out.push('intensity must be 0 to 1');
  const audio = frame.audio;
  if (!isObject(audio)) out.push('audio is missing');
  else {
    if (!inRange(audio.rms, 0, 1)) out.push('audio.rms must be 0 to 1');
    if (typeof audio.onset !== 'boolean') out.push('audio.onset must be true or false');
    if (audio.pitch_midi !== undefined && audio.pitch_midi !== null && typeof audio.pitch_midi !== 'number') out.push('audio.pitch_midi must be a number or null');
    if (audio.bpm !== undefined && !inRange(audio.bpm, 0, Infinity)) out.push('audio.bpm must be >= 0');
    if (audio.beat_phase !== undefined && !inRange(audio.beat_phase, 0, 1)) out.push('audio.beat_phase must be 0 to 1');
    if (audio.bands !== undefined && !(Array.isArray(audio.bands) && audio.bands.length === 8 && audio.bands.every((b) => inRange(b, 0, 1)))) out.push('audio.bands must be 8 numbers from 0 to 1');
  }
  const hands = frame.hands;
  if (!isObject(hands)) out.push('hands is missing');
  else {
    for (const side of ['left', 'right'] as const) {
      const h = hands[side];
      if (h === undefined || h === null) continue;
      if (!isObject(h)) {
        out.push(`hands.${side} must be null or an object`);
        continue;
      }
      if (!inRange(h.x, 0, 1)) out.push(`hands.${side}.x must be 0 to 1`);
      if (!inRange(h.y, 0, 1)) out.push(`hands.${side}.y must be 0 to 1`);
      if (h.height !== undefined && !inRange(h.height, 0, 1)) out.push(`hands.${side}.height must be 0 to 1`);
      if (h.fist !== undefined && typeof h.fist !== 'boolean') out.push(`hands.${side}.fist must be true or false`);
      if (h.open_palm !== undefined && typeof h.open_palm !== 'boolean') out.push(`hands.${side}.open_palm must be true or false`);
      if (h.pinch !== undefined && !inRange(h.pinch, 0, 1)) out.push(`hands.${side}.pinch must be 0 to 1`);
    }
    if (hands.distance !== undefined && !inRange(hands.distance, 0, 1)) out.push('hands.distance must be 0 to 1');
  }
  return out;
}
