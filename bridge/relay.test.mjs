// The relay end to end: a real WebSocket server and clients, a real UDP socket playing the part of TouchDesigner.
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import { after, before, describe, test } from 'node:test';
import { WebSocket } from 'ws';
import { frameToOsc, looksLikeFrame } from './frame-osc.mjs';
import { decodePacket } from './osc.mjs';
import { DEFAULTS, isOriginAllowed, parseArgs, startRelay } from './relay.mjs';
import { SAMPLE_EXPECTED, SAMPLE_FRAME, runSelftest } from './selftest.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/td-message/${name}.json`, import.meta.url), 'utf8'));
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(test, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end && !test()) await wait(15);
  return test();
}

/** A fake TouchDesigner: collects every OSC message (and remembers the packets) arriving on a free UDP port. */
async function fakeTouchDesigner() {
  const socket = dgram.createSocket('udp4');
  const messages = [];
  const packets = [];
  socket.on('message', (buf) => {
    packets.push(buf);
    messages.push(...decodePacket(buf));
  });
  await new Promise((done) => socket.bind(0, '127.0.0.1', done));
  return {
    port: socket.address().port,
    messages,
    packets,
    value: (address) => messages.filter((m) => m.address === address).at(-1)?.args[0].value,
    close: () => new Promise((done) => socket.close(done)),
  };
}

function connect(port) {
  return new Promise((done, fail) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.received = [];
    ws.on('message', (data) => ws.received.push(data.toString()));
    ws.once('open', () => done(ws));
    ws.once('error', fail);
  });
}

describe('frame to OSC addresses', () => {
  test('the sample frame produces exactly the documented messages', () => {
    const out = frameToOsc(SAMPLE_FRAME).map(([address, v]) => [address, v.type, v.value]);
    assert.equal(out.length, 30);
    for (const [address, type, value] of SAMPLE_EXPECTED) {
      const found = out.find((o) => o[0] === address);
      assert.ok(found, `missing ${address}`);
      assert.equal(found[1], type, address);
      assert.deepEqual(found[2], value, address);
    }
  });

  test('the "no hands" fixture: absent hands are zeros with present = 0, no pitch is -1, mode and intensity are left out', () => {
    const out = new Map(frameToOsc(fixture('no-hands')).map(([address, v]) => [address, v.value]));
    assert.equal(out.get('/hand/left/present'), 0);
    assert.equal(out.get('/hand/right/present'), 0);
    assert.equal(out.get('/hand/right/x'), 0);
    assert.equal(out.get('/audio/pitch'), -1);
    assert.equal(out.get('/audio/rms'), 0);
    assert.equal(out.get('/audio/bpm'), 0);
    assert.equal(out.get('/audio/band/7'), 0);
    assert.equal(out.get('/hands/distance'), 0);
    assert.equal(out.has('/mode'), false);
    assert.equal(out.has('/intensity'), false);
  });

  test('a hand without a height gets one from y, and odd values never produce NaN', () => {
    const frame = { version: 1, audio: { rms: 'loud', onset: 'yes', pitch_midi: Number.NaN }, hands: { left: { x: 0.2, y: 0.25, fist: true }, right: null } };
    const out = new Map(frameToOsc(frame).map(([address, v]) => [address, v.value]));
    assert.equal(out.get('/hand/left/height'), 0.75);
    assert.equal(out.get('/hand/left/fist'), 1);
    assert.equal(out.get('/audio/rms'), 0);
    assert.equal(out.get('/audio/pitch'), -1);
    for (const value of out.values()) assert.ok(typeof value === 'string' || Number.isFinite(value));
  });

  test('only things shaped like a frame are accepted', () => {
    assert.equal(looksLikeFrame(SAMPLE_FRAME), true);
    assert.equal(looksLikeFrame(fixture('frame')), true);
    for (const bad of [null, 5, 'text', [], {}, { version: 2, audio: {}, hands: {} }, { version: 1, audio: {} }, { version: 1, audio: [], hands: {} }]) {
      assert.equal(looksLikeFrame(bad), false, JSON.stringify(bad));
    }
  });
});

describe('the running relay', () => {
  let td;
  let relay;
  let sender;
  let listener;
  before(async () => {
    td = await fakeTouchDesigner();
    relay = await startRelay({ wsPort: 0, oscPort: td.port, print: () => {} });
    sender = await connect(relay.wsPort);
    listener = await connect(relay.wsPort);
  });
  after(async () => {
    sender.terminate();
    listener.terminate();
    await relay.close();
    await td.close();
  });

  test('forwards a frame to TouchDesigner as OSC with the right values', async () => {
    const frame = fixture('frame');
    sender.send(JSON.stringify(frame));
    assert.ok(await until(() => td.value('/intensity') !== undefined), 'no OSC arrived');
    assert.ok(await until(() => td.messages.length >= 30));
    const near = (address, expected) => assert.ok(Math.abs(td.value(address) - expected) < 1e-5, `${address} was ${td.value(address)}, expected ${expected}`);
    near('/audio/rms', 0.35);
    assert.equal(td.value('/audio/onset'), 1);
    near('/audio/pitch', 62.2);
    near('/audio/bpm', 100);
    near('/audio/beat_phase', 0.25);
    near('/audio/band/0', 0.8);
    near('/audio/band/7', 0.1);
    near('/hand/right/x', 0.62);
    near('/hand/right/y', 0.3);
    near('/hand/right/height', 0.7);
    assert.equal(td.value('/hand/right/fist'), 0);
    assert.equal(td.value('/hand/right/open_palm'), 1);
    near('/hand/right/pinch', 0.1);
    assert.equal(td.value('/hand/right/present'), 1);
    assert.equal(td.value('/hand/left/present'), 0);
    near('/hands/distance', 0.4);
    assert.equal(td.value('/mode'), 'play');
    near('/intensity', 0.6);
  });

  test('sends one UDP packet per value by default', () => {
    assert.ok(td.packets.length >= 30);
    assert.ok(td.packets.every((p) => decodePacket(p).length === 1));
  });

  test('passes the same JSON text on to the other clients, not back to the sender', async () => {
    assert.ok(await until(() => listener.received.length >= 1));
    assert.equal(listener.received[0], JSON.stringify(fixture('frame')));
    assert.equal(sender.received.length, 0);
  });

  test('ignores junk without crashing and keeps relaying afterwards', async () => {
    const before = relay.stats();
    sender.send('not json at all');
    sender.send('[1,2,3]');
    sender.send('{"version":1}');
    sender.send(Buffer.from([1, 2, 3, 4]), { binary: true });
    sender.send('"just a string"');
    assert.ok(await until(() => relay.stats().ignored >= before.ignored + 5));
    assert.equal(relay.stats().framesTotal, before.framesTotal);
    const heard = td.messages.length;
    sender.send(JSON.stringify({ ...fixture('frame'), audio: { ...fixture('frame').audio, rms: 0.9 } }));
    assert.ok(await until(() => td.messages.length > heard));
    assert.ok(await until(() => Math.abs(td.value('/audio/rms') - 0.9) < 1e-5));
  });

  test('a client that leaves does not stop the others', async () => {
    const third = await connect(relay.wsPort);
    third.close();
    assert.ok(await until(() => relay.stats().clients === 2));
    const heard = listener.received.length;
    sender.send(JSON.stringify(fixture('no-hands')));
    assert.ok(await until(() => listener.received.length > heard));
  });
});

/** Try to connect with a given Origin header (undefined = send none). Resolves { ws } when accepted, { status } when refused. */
function tryConnect(port, origin) {
  return new Promise((done) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, origin === undefined ? {} : { headers: { Origin: origin } });
    ws.received = [];
    ws.on('message', (data) => ws.received.push(data.toString()));
    ws.once('open', () => done({ ws }));
    ws.once('unexpected-response', (req, res) => {
      res.resume();
      done({ status: res.statusCode });
    });
    ws.once('error', () => {});
  });
}

describe('which web pages may connect', () => {
  test('the rule: no Origin, or a page on this computer; anything else only when added', () => {
    for (const ok of [undefined, 'http://localhost', 'http://localhost:5173', 'https://localhost:8443', 'http://127.0.0.1:3000', 'http://[::1]:5173', 'HTTP://LOCALHOST:5173']) {
      assert.equal(isOriginAllowed(ok), true, String(ok));
    }
    const refused = ['http://evil.example', 'https://evil.example:5173', 'http://localhost.evil.example', 'http://127.0.0.1.evil.example', 'http://localhost@evil.example', 'http://localhost:5173/path', 'http://127.0.0.2:3000', 'ftp://localhost', 'null', '', 'file://', ['http://localhost'], 42];
    for (const no of refused) assert.equal(isOriginAllowed(no), false, JSON.stringify(no));
    assert.equal(isOriginAllowed('http://192.168.1.5:5173', ['http://192.168.1.5:5173']), true);
    assert.equal(isOriginAllowed('http://192.168.1.5:5173', ['http://192.168.1.5:3000']), false);
    assert.equal(isOriginAllowed('http://evil.example', ['http://192.168.1.5:5173']), false);
  });

  test('real connections: no Origin and local pages get in, other sites get HTTP 403', async () => {
    const lines = [];
    const relay = await startRelay({ wsPort: 0, print: (l) => lines.push(l) });
    const open = [];
    for (const origin of [undefined, 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://[::1]:5173']) {
      const got = await tryConnect(relay.wsPort, origin);
      assert.ok(got.ws, `${origin} should be accepted`);
      open.push(got.ws);
    }
    for (const origin of ['http://evil.example', 'https://evil.example:5173', 'null', 'http://localhost.evil.example']) {
      const got = await tryConnect(relay.wsPort, origin);
      assert.equal(got.status, 403, `${origin} should be refused`);
    }
    assert.equal(relay.stats().clients, 4);
    assert.equal(relay.stats().refused, 4);
    const line = 'Refused a connection from http://evil.example: only pages on this computer may connect. Use --allow-origin to allow it.';
    assert.ok(lines.includes(line), lines.join('\n'));
    for (const ws of open) ws.terminate();
    await relay.close();
  });

  test('a refused page can not read the stream or inject frames', async () => {
    const td = await fakeTouchDesigner();
    const relay = await startRelay({ wsPort: 0, oscPort: td.port, print: () => {} });
    const good = await connect(relay.wsPort);
    const listener = await connect(relay.wsPort);
    assert.equal((await tryConnect(relay.wsPort, 'http://evil.example')).status, 403);
    good.send(JSON.stringify(SAMPLE_FRAME));
    assert.ok(await until(() => listener.received.length === 1));
    assert.equal(relay.stats().clients, 2);
    good.terminate();
    listener.terminate();
    await relay.close();
    await td.close();
  });

  test('a page that keeps retrying is mentioned once, but every refusal is counted', async () => {
    const lines = [];
    const relay = await startRelay({ wsPort: 0, print: (l) => lines.push(l) });
    for (let n = 0; n < 3; n++) assert.equal((await tryConnect(relay.wsPort, 'http://evil.example')).status, 403);
    assert.equal((await tryConnect(relay.wsPort, 'http://other.example')).status, 403);
    assert.equal(lines.filter((l) => /^Refused a connection from/.test(l)).length, 2);
    assert.equal(relay.stats().refused, 4);
    await relay.close();
  });

  test('--allow-origin lets one more page in (and only that page)', async () => {
    const relay = await startRelay({ wsPort: 0, allowOrigins: ['http://192.168.1.5:5173'], print: () => {} });
    const allowed = await tryConnect(relay.wsPort, 'http://192.168.1.5:5173');
    assert.ok(allowed.ws, 'the added page should be accepted');
    assert.equal((await tryConnect(relay.wsPort, 'http://192.168.1.5:3000')).status, 403);
    assert.equal((await tryConnect(relay.wsPort, 'http://evil.example')).status, 403);
    const local = await tryConnect(relay.wsPort, 'http://localhost:5173');
    const none = await tryConnect(relay.wsPort);
    assert.ok(local.ws, 'this computer still works');
    assert.ok(none.ws, 'no Origin still works');
    for (const ws of [allowed.ws, local.ws, none.ws]) ws.terminate();
    await relay.close();
  });

  test('without --allow-origin the same outside page is refused', async () => {
    const relay = await startRelay({ wsPort: 0, print: () => {} });
    assert.equal((await tryConnect(relay.wsPort, 'http://192.168.1.5:5173')).status, 403);
    await relay.close();
  });

  test('by default other computers on the network can not reach it', async (t) => {
    const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
    if (!lan) return t.skip('this computer has no network address to try');
    const relay = await startRelay({ wsPort: 0, print: () => {} });
    const outcome = await new Promise((done) => {
      const probe = net.createConnection({ port: relay.wsPort, host: lan.address });
      probe.once('connect', () => {
        probe.destroy();
        done('connected');
      });
      probe.once('error', (err) => done(err.code));
    });
    assert.equal(outcome, 'ECONNREFUSED');
    await relay.close();
  });
});

describe('options', () => {
  test('--bundle sends one packet that holds the whole frame', async () => {
    const td = await fakeTouchDesigner();
    const relay = await startRelay({ wsPort: 0, oscPort: td.port, bundle: true, print: () => {} });
    const ws = await connect(relay.wsPort);
    ws.send(JSON.stringify(SAMPLE_FRAME));
    assert.ok(await until(() => td.messages.length >= 30));
    await wait(50);
    assert.equal(td.packets.length, 1);
    assert.equal(td.messages.length, 30);
    ws.terminate();
    await relay.close();
    await td.close();
  });

  test('--log prints a short status line with frames per second, clients and where OSC goes', async () => {
    const lines = [];
    const td = await fakeTouchDesigner();
    const relay = await startRelay({ wsPort: 0, oscPort: td.port, log: true, logEveryMs: 100, print: (l) => lines.push(l) });
    const ws = await connect(relay.wsPort);
    ws.send(JSON.stringify(SAMPLE_FRAME));
    assert.ok(await until(() => lines.some((l) => /1 connected/.test(l))));
    const line = lines.find((l) => /1 connected/.test(l));
    assert.match(line, /frames\/s in/);
    assert.match(line, new RegExp(`OSC to 127\\.0\\.0\\.1:${td.port}`));
    ws.terminate();
    await relay.close();
    await td.close();
  });

  test('sending to a port nobody listens on does not crash the relay', async () => {
    const lines = [];
    const relay = await startRelay({ wsPort: 0, oscHost: '127.0.0.1', oscPort: 9, print: (l) => lines.push(l) });
    const ws = await connect(relay.wsPort);
    const other = await connect(relay.wsPort);
    ws.send(JSON.stringify(SAMPLE_FRAME));
    assert.ok(await until(() => other.received.length === 1));
    ws.terminate();
    other.terminate();
    await relay.close();
  });

  test('a port that is already taken gives a message in plain words', async () => {
    const blocker = net.createServer();
    await new Promise((done) => blocker.listen(0, '127.0.0.1', done));
    const { port } = blocker.address();
    await assert.rejects(startRelay({ wsPort: port, print: () => {} }), (err) => {
      assert.match(err.message, new RegExp(`Port ${port} is already in use`));
      assert.match(err.message, /--ws-port/);
      assert.match(err.message, /\?td=ws:\/\/localhost:/);
      return true;
    });
    await new Promise((done) => blocker.close(done));
  });
});

describe('command line flags', () => {
  test('defaults', () => {
    assert.deepEqual(parseArgs([]), { ...DEFAULTS, bundle: false, log: false, selftest: false, help: false, allowOrigins: [] });
  });
  test('all the flags, with a space or an equals sign', () => {
    const a = parseArgs(['--ws-port', '9981', '--osc-host', '192.168.1.5', '--osc-port=7001', '--log', '--bundle']);
    assert.equal(a.wsPort, 9981);
    assert.equal(a.oscHost, '192.168.1.5');
    assert.equal(a.oscPort, 7001);
    assert.equal(a.log, true);
    assert.equal(a.bundle, true);
    assert.equal(parseArgs(['--selftest']).selftest, true);
    assert.equal(parseArgs(['--help']).help, true);
  });
  test('mistakes get a plain explanation', () => {
    assert.throws(() => parseArgs(['--ws-port', 'abc']), /whole number from 0 to 65535/);
    assert.throws(() => parseArgs(['--osc-port', '70000']), /whole number from 0 to 65535/);
    assert.throws(() => parseArgs(['--ws-port']), /needs a value/);
    assert.throws(() => parseArgs(['--wsport', '1']), /don't know the option "--wsport".*--help/);
  });
  test('--allow-origin can be repeated, is tidied up, and must look like a web page address', () => {
    const a = parseArgs(['--allow-origin', 'http://192.168.1.5:5173/', '--allow-origin=HTTPS://Demo.Example', '--log']);
    assert.deepEqual(a.allowOrigins, ['http://192.168.1.5:5173', 'https://demo.example']);
    assert.equal(a.log, true);
    assert.throws(() => parseArgs(['--allow-origin']), /--allow-origin needs a web page address/);
    assert.throws(() => parseArgs(['--allow-origin', '*']), /--allow-origin needs a web page address/);
    assert.throws(() => parseArgs(['--allow-origin', 'evil.example']), /--allow-origin needs a web page address/);
  });
  test('the relay listens on this laptop only by default, and --ws-host can change that', () => {
    assert.equal(DEFAULTS.wsHost, '127.0.0.1');
    assert.equal(parseArgs(['--ws-host', '0.0.0.0']).wsHost, '0.0.0.0');
  });
});

describe('self-test', () => {
  test('passes on this computer', async () => {
    const lines = [];
    assert.equal(await runSelftest((l) => lines.push(l)), true, lines.join('\n'));
    assert.match(lines.at(-1), /Self-test passed/);
  });
});
