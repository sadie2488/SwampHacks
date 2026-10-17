// `node bridge/relay.mjs --selftest`: starts the relay on free ports, sends one sample frame over a real WebSocket,
// listens on a real UDP socket, and checks the OSC messages that come out. Prints what it checked; returns true when all is well.
import dgram from 'node:dgram';
import { WebSocket } from 'ws';
import { decodePacket } from './osc.mjs';
import { startRelay } from './relay.mjs';

/** A frame in the td-message shape (same numbers as fixtures/td-message/frame.json). */
export const SAMPLE_FRAME = {
  version: 1,
  t_ms: 12345.6,
  mode: 'play',
  intensity: 0.6,
  audio: { rms: 0.35, onset: true, pitch_midi: 62.2, bpm: 100, beat_phase: 0.25, bands: [0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1] },
  hands: {
    left: null,
    right: { x: 0.62, y: 0.3, height: 0.7, fist: false, open_palm: true, pinch: 0.1 },
    distance: 0.4,
  },
};

/** What TouchDesigner should receive for SAMPLE_FRAME, written out by hand: [address, type, value]. */
export const SAMPLE_EXPECTED = [
  ['/audio/rms', 'f', 0.35],
  ['/audio/onset', 'i', 1],
  ['/audio/pitch', 'f', 62.2],
  ['/audio/bpm', 'f', 100],
  ['/audio/beat_phase', 'f', 0.25],
  ...[0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1].map((v, n) => [`/audio/band/${n}`, 'f', v]),
  ['/hand/left/x', 'f', 0],
  ['/hand/left/y', 'f', 0],
  ['/hand/left/height', 'f', 0],
  ['/hand/left/fist', 'i', 0],
  ['/hand/left/open_palm', 'i', 0],
  ['/hand/left/pinch', 'f', 0],
  ['/hand/left/present', 'i', 0],
  ['/hand/right/x', 'f', 0.62],
  ['/hand/right/y', 'f', 0.3],
  ['/hand/right/height', 'f', 0.7],
  ['/hand/right/fist', 'i', 0],
  ['/hand/right/open_palm', 'i', 1],
  ['/hand/right/pinch', 'f', 0.1],
  ['/hand/right/present', 'i', 1],
  ['/hands/distance', 'f', 0.4],
  ['/mode', 's', 'play'],
  ['/intensity', 'f', 0.6],
];

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

async function until(test, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (test()) return true;
    await wait(20);
  }
  return test();
}

function openClient(port) {
  return new Promise((done, fail) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    socket.received = [];
    socket.on('message', (data) => socket.received.push(data.toString()));
    socket.once('open', () => done(socket));
    socket.once('error', fail);
  });
}

/** Connect pretending to be a web page from `origin`. Resolves { socket } when let in, { status } when refused. */
function tryClient(port, origin) {
  return new Promise((done) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { Origin: origin } });
    socket.once('open', () => done({ socket }));
    socket.once('unexpected-response', (req, res) => {
      res.resume();
      done({ status: res.statusCode });
    });
    socket.once('error', (err) => done({ status: err.message }));
  });
}

export async function runSelftest(print = console.log) {
  const problems = [];
  const ok = (line) => print(`  ok: ${line}`);
  const bad = (line) => {
    problems.push(line);
    print(`  PROBLEM: ${line}`);
  };
  print('Relay self-test: starting the relay on free ports...');
  const received = [];
  const udp = dgram.createSocket('udp4');
  let relay;
  const clients = [];
  try {
    await new Promise((done, fail) => {
      udp.once('error', fail);
      udp.bind(0, '127.0.0.1', done);
    });
    udp.on('message', (msg) => received.push(...decodePacket(msg)));
    const oscPort = udp.address().port;
    relay = await startRelay({ wsPort: 0, oscHost: '127.0.0.1', oscPort, print: () => {} });
    ok(`relay is listening on WebSocket port ${relay.wsPort}; fake TouchDesigner listens for OSC on UDP port ${oscPort}`);

    const sender = await openClient(relay.wsPort);
    const listener = await openClient(relay.wsPort);
    clients.push(sender, listener);
    ok('two WebSocket clients connected (one sends, one listens, like TouchDesigner\'s WebSocket DAT)');

    sender.send('this is not json');
    sender.send(JSON.stringify({ hello: 'not a frame' }));
    const frameText = JSON.stringify(SAMPLE_FRAME);
    sender.send(frameText);

    const gotAll = await until(() => received.length >= SAMPLE_EXPECTED.length, 3000);
    if (!gotAll) bad(`expected ${SAMPLE_EXPECTED.length} OSC messages but got ${received.length} within 3 seconds. Is a firewall blocking local UDP?`);

    const byAddress = new Map(received.map((m) => [m.address, m]));
    let wrong = 0;
    for (const [address, type, expected] of SAMPLE_EXPECTED) {
      const m = byAddress.get(address);
      const arg = m && m.args[0];
      const same = arg && arg.type === type && (type === 's' ? arg.value === expected : Math.abs(arg.value - expected) < 1e-5);
      if (!same) {
        wrong++;
        bad(`${address} should be ${type === 's' ? `"${expected}"` : expected} (${type}) but arrived as ${arg ? `${arg.value} (${arg.type})` : 'nothing'}`);
      }
    }
    if (!wrong && gotAll) ok(`all ${SAMPLE_EXPECTED.length} OSC messages arrived with the right values`);

    if (await until(() => listener.received.length >= 1, 2000)) {
      if (listener.received.length === 1 && listener.received[0] === frameText) ok('the other WebSocket client got the exact same JSON, once (bad frames were not passed on)');
      else bad(`the other WebSocket client should get 1 frame but got ${listener.received.length}`);
    } else {
      bad('the other WebSocket client never received the JSON frame');
    }
    await wait(100);
    if (sender.received.length === 0) ok('the sender did not get its own frame echoed back');
    else bad('the sender got its own frame echoed back');

    const local = await tryClient(relay.wsPort, 'http://localhost:5173');
    const outside = await tryClient(relay.wsPort, 'http://evil.example');
    if (local.socket) clients.push(local.socket);
    if (outside.socket) clients.push(outside.socket);
    if (local.socket && outside.status === 403) ok('a web page on this computer can connect, a page from another website is refused');
    else bad(`expected a page on this computer to connect and another website to be refused (got ${local.socket ? 'connected' : 'refused'} and ${outside.socket ? 'connected' : `status ${outside.status}`})`);

    const stats = relay.stats();
    if (stats.ignored === 2 && stats.framesTotal === 1) ok('2 malformed messages were ignored without crashing');
    else bad(`expected 1 good frame and 2 ignored, saw ${stats.framesTotal} good and ${stats.ignored} ignored`);
  } catch (err) {
    bad(`could not run the test: ${err.message}`);
  } finally {
    for (const c of clients) c.terminate();
    if (relay) await relay.close();
    await new Promise((done) => {
      try {
        udp.close(() => done());
      } catch {
        done();
      }
    });
  }
  if (problems.length) {
    print(`Self-test FAILED (${problems.length} problem${problems.length === 1 ? '' : 's'}). See the PROBLEM lines above.`);
    return false;
  }
  print('Self-test passed: the relay works on this computer.');
  return true;
}
