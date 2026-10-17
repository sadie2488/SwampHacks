// A tiny OSC 1.0 encoder and decoder (just what the relay needs): int32, float32 and string values, messages and bundles.
// OSC rules in short: every piece is padded with zero bytes to a multiple of 4; numbers are big-endian; a message is
// the address, then a "type tag" string like ",ifs", then the values.

/** Tag a value as a 32-bit integer / 32-bit float / string. Plain JS values are tagged for you: number -> float, boolean -> int, string -> string. */
export const i = (value) => ({ type: 'i', value });
export const f = (value) => ({ type: 'f', value });
export const s = (value) => ({ type: 's', value });

const pad4 = (n) => (4 - (n % 4)) % 4;

function oscString(text) {
  const bytes = Buffer.from(String(text), 'utf8');
  // always at least one zero byte at the end, then pad to a multiple of 4
  return Buffer.concat([bytes, Buffer.alloc(1 + pad4(bytes.length + 1))]);
}

function tagged(arg) {
  if (arg !== null && typeof arg === 'object' && 'type' in arg) return arg;
  if (typeof arg === 'boolean') return i(arg ? 1 : 0);
  if (typeof arg === 'string') return s(arg);
  if (typeof arg === 'number') return f(arg);
  throw new TypeError(`OSC can't send a value of type ${typeof arg}`);
}

function oscArg({ type, value }) {
  const b = Buffer.alloc(4);
  if (type === 'i') {
    const n = Math.trunc(Number(value));
    b.writeInt32BE(Number.isFinite(n) ? Math.max(-2147483648, Math.min(2147483647, n)) : 0);
    return b;
  }
  if (type === 'f') {
    b.writeFloatBE(Number(value));
    return b;
  }
  if (type === 's') return oscString(value);
  throw new TypeError(`unknown OSC type "${type}"`);
}

/** One OSC message. `args` is a list of values (see the helpers above). Booleans are sent as ints (1 or 0). */
export function encodeMessage(address, args = []) {
  if (typeof address !== 'string' || !address.startsWith('/')) throw new TypeError('an OSC address must start with "/"');
  const list = args.map(tagged);
  return Buffer.concat([oscString(address), oscString(',' + list.map((a) => a.type).join('')), ...list.map(oscArg)]);
}

/** A bundle that holds several messages (each given as an already-encoded Buffer) and means "right now". */
export function encodeBundle(encodedMessages) {
  const timetagNow = Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]);
  const parts = [oscString('#bundle'), timetagNow];
  for (const m of encodedMessages) {
    const size = Buffer.alloc(4);
    size.writeInt32BE(m.length);
    parts.push(size, m);
  }
  return Buffer.concat(parts);
}

function readString(buf, at) {
  let end = at;
  while (end < buf.length && buf[end] !== 0) end++;
  if (end >= buf.length) throw new Error('OSC string is not terminated');
  const text = buf.toString('utf8', at, end);
  const used = end - at + 1; // the text plus its closing zero byte
  return [text, at + used + pad4(used)];
}

/** Read one message back into { address, args: [{ type, value }] }. Used by the self-test and the tests. */
export function decodeMessage(buf) {
  const [address, afterAddress] = readString(buf, 0);
  const [tags, afterTags] = readString(buf, afterAddress);
  if (!tags.startsWith(',')) throw new Error('OSC type tags must start with ","');
  const args = [];
  let at = afterTags;
  for (const type of tags.slice(1)) {
    if (type === 'i') {
      args.push({ type, value: buf.readInt32BE(at) });
      at += 4;
    } else if (type === 'f') {
      args.push({ type, value: buf.readFloatBE(at) });
      at += 4;
    } else if (type === 's') {
      const [value, next] = readString(buf, at);
      args.push({ type, value });
      at = next;
    } else {
      throw new Error(`OSC type "${type}" is not supported here`);
    }
  }
  return { address, args };
}

/** Read a UDP packet that is either one message or a bundle of them (bundles may nest). Returns a flat list of messages. */
export function decodePacket(buf) {
  if (buf.toString('latin1', 0, 8) !== '#bundle\0') return [decodeMessage(buf)];
  const out = [];
  let at = 16; // 8 bytes of "#bundle" + 8 bytes of timetag
  while (at < buf.length) {
    const size = buf.readInt32BE(at);
    at += 4;
    out.push(...decodePacket(buf.subarray(at, at + size)));
    at += size;
  }
  return out;
}
