// The OSC encoder, checked byte for byte against messages worked out by hand from the OSC 1.0 rules
// (zero-padded to a multiple of 4, big-endian numbers, ",ifs" type tags).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeMessage, decodePacket, encodeBundle, encodeMessage, f, i, s } from './osc.mjs';

const hex = (buf) => buf.toString('hex');
const bytes = (text) => Buffer.from(text.replace(/\s+/g, ''), 'hex');

test('a float message: /audio/rms 0.5', () => {
  // "/audio/rms" is 10 letters + 1 zero = 11, padded to 12; ",f" + zero padded to 4; 0.5 as float32 = 3f000000
  assert.equal(hex(encodeMessage('/audio/rms', [f(0.5)])), hex(bytes('2f617564696f2f726d73 0000  2c660000  3f000000')));
});

test('an int message: /audio/onset 1', () => {
  // "/audio/onset" is 12 letters + 1 zero = 13, padded to 16
  assert.equal(hex(encodeMessage('/audio/onset', [i(1)])), hex(bytes('2f617564696f2f6f6e736574 00000000  2c690000  00000001')));
});

test('a string message: /mode "play"', () => {
  // "/mode" 5+1 -> 8; ",s" -> 4; "play" 4+1 -> 8
  assert.equal(hex(encodeMessage('/mode', [s('play')])), hex(bytes('2f6d6f6465 000000  2c730000  706c6179 00000000')));
});

test('the example from the OSC spec: /oscillator/4/frequency 440.0', () => {
  // the address is 23 letters, so its closing zero already makes 24: no extra padding
  assert.equal(hex(encodeMessage('/oscillator/4/frequency', [f(440)])), hex(bytes('2f6f7363696c6c61746f722f342f6672657175656e6379 00  2c660000  43dc0000')));
});

test('a message with several values: ints can be negative, strings are padded', () => {
  // "/x" -> 2f78 0000; ",ifs" + zero = 5 -> 8; -2 = fffffffe; 1.0 = 3f800000; "a" -> 61 000000
  assert.equal(hex(encodeMessage('/x', [i(-2), f(1), s('a')])), hex(bytes('2f780000  2c696673 00000000  fffffffe  3f800000  61000000')));
});

test('float32 rounding: 0.1 is 3dcccccd', () => {
  assert.equal(hex(encodeMessage('/v', [f(0.1)]).subarray(8)), '3dcccccd');
});

test('a message with no values still has a type tag string', () => {
  assert.equal(hex(encodeMessage('/hi')), hex(bytes('2f686900  2c000000')));
});

test('padding at the edges: 3, 4 and 5 letter addresses', () => {
  assert.equal(encodeMessage('/ab', []).length, 4 + 4); // "/ab" + zero = 4
  assert.equal(encodeMessage('/abc', []).length, 8 + 4); // "/abc" + zero = 5 -> 8
  assert.equal(encodeMessage('/abcd', []).length, 8 + 4); // 6 -> 8
  assert.equal(encodeMessage('/abcde', []).length, 8 + 4); // 7 -> 8
  assert.equal(encodeMessage('/abcdef', []).length, 8 + 4); // 8 -> 8
});

test('booleans become ints, and plain numbers and strings are tagged for you', () => {
  assert.equal(hex(encodeMessage('/b', [true])), hex(bytes('2f620000  2c690000  00000001')));
  assert.equal(hex(encodeMessage('/b', [false])), hex(bytes('2f620000  2c690000  00000000')));
  assert.equal(hex(encodeMessage('/b', [0.5])), hex(encodeMessage('/b', [f(0.5)])));
  assert.equal(hex(encodeMessage('/b', ['a'])), hex(encodeMessage('/b', [s('a')])));
});

test('text outside plain ASCII is sent as UTF-8 and padded by bytes', () => {
  // "é" is c3 a9 (2 bytes) + zero = 3 -> 4
  assert.equal(hex(encodeMessage('/s', [s('é')])), hex(bytes('2f730000  2c730000  c3a90000')));
});

test('ints outside the 32-bit range are clamped and non-numbers become 0, not a crash', () => {
  assert.equal(hex(encodeMessage('/n', [i(3e10)]).subarray(8)), '7fffffff');
  assert.equal(hex(encodeMessage('/n', [i(-3e10)]).subarray(8)), '80000000');
  assert.equal(hex(encodeMessage('/n', [i(Number.NaN)]).subarray(8)), '00000000');
});

test('bad input is refused with a clear message', () => {
  assert.throws(() => encodeMessage('nope', []), /must start with "\/"/);
  assert.throws(() => encodeMessage('/x', [{ type: 'q', value: 1 }]), /unknown OSC type/);
  assert.throws(() => encodeMessage('/x', [undefined]), /can't send/);
});

test('a bundle: "#bundle", the "now" time tag, then each message with its size', () => {
  const hi = encodeMessage('/hi'); // 8 bytes
  const bundle = encodeBundle([hi, encodeMessage('/b', [true])]);
  assert.equal(hex(bundle), hex(bytes('2362756e646c6500  0000000000000001  00000008 2f686900 2c000000  0000000c 2f620000 2c690000 00000001')));
});

test('decoding gives back what was encoded', () => {
  const msg = decodeMessage(encodeMessage('/hand/right/x', [f(0.5), i(-7), s('hello there')]));
  assert.deepEqual(msg, {
    address: '/hand/right/x',
    args: [
      { type: 'f', value: 0.5 },
      { type: 'i', value: -7 },
      { type: 's', value: 'hello there' },
    ],
  });
});

test('decodePacket reads a lone message, a bundle, and a bundle inside a bundle', () => {
  const one = encodeMessage('/a', [i(1)]);
  const two = encodeMessage('/b', [i(2)]);
  const three = encodeMessage('/c', [i(3)]);
  assert.deepEqual(decodePacket(one).map((m) => m.address), ['/a']);
  assert.deepEqual(decodePacket(encodeBundle([one, two])).map((m) => m.address), ['/a', '/b']);
  assert.deepEqual(decodePacket(encodeBundle([encodeBundle([one, two]), three])).map((m) => m.address), ['/a', '/b', '/c']);
});

test('decoding refuses things that are not OSC', () => {
  assert.throws(() => decodeMessage(Buffer.from('hello')), /not terminated|type tags/);
  assert.throws(() => decodeMessage(bytes('2f780000 6e6f7000')), /type tags must start/);
});
