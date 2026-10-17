#!/usr/bin/env node
// The TouchDesigner relay. Browsers can't send UDP/OSC, so the web page sends JSON frames over a WebSocket to this
// small program, which runs on the same laptop and does two things with every frame:
//   1. forwards the numbers to TouchDesigner as OSC messages over UDP (default 127.0.0.1:7000)
//   2. re-sends the JSON text to every OTHER connected WebSocket client (so TouchDesigner's WebSocket DAT can listen too)
// Run:  node bridge/relay.mjs --log        Test it:  node bridge/relay.mjs --selftest        Help:  --help
import dgram from 'node:dgram';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { frameToOsc, looksLikeFrame } from './frame-osc.mjs';
import { encodeBundle, encodeMessage } from './osc.mjs';

export const DEFAULTS = { wsPort: 9980, wsHost: '127.0.0.1', oscHost: '127.0.0.1', oscPort: 7000 };
const MAX_FRAME_BYTES = 256 * 1024;
const SLOW_CLIENT_BYTES = 1024 * 1024;
const THIS_COMPUTER_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;
const ORIGIN_SHAPE = /^[a-z][a-z0-9+.-]*:\/\/[^\s/?#@]+\/?$/i;

/** Make an origin comparable: trimmed, lower case, no trailing slash. */
export function normalizeOrigin(origin) {
  return String(origin).trim().toLowerCase().replace(/\/+$/, '');
}

/**
 * Should a web page with this Origin header be allowed to connect? No Origin header at all means a program that is not a
 * browser (TouchDesigner's WebSocket DAT, a script): allowed. Otherwise only pages served from this computer, plus any
 * origins added with --allow-origin. A web page can't change its own Origin header, so this keeps other sites out.
 */
export function isOriginAllowed(origin, allowOrigins = []) {
  if (origin === undefined) return true;
  if (typeof origin !== 'string') return false;
  if (THIS_COMPUTER_ORIGIN.test(origin)) return true;
  return allowOrigins.map(normalizeOrigin).includes(normalizeOrigin(origin));
}

/**
 * Start the relay. Resolves with { wsPort, stats(), close() }. Rejects with an Error whose message is plain words
 * (for example when the port is already in use).
 * Options: wsPort (0 = pick any free port), wsHost, oscHost, oscPort, bundle (one OSC bundle per frame instead of
 * one message per value), allowOrigins (extra web page origins that may connect, such as "http://192.168.1.5:5173"),
 * log (print a status line every few seconds), logEveryMs, print (where messages go).
 */
export async function startRelay(options = {}) {
  const o = { ...DEFAULTS, bundle: false, log: false, logEveryMs: 3000, allowOrigins: [], print: (line) => console.log(line), ...options };
  const stats = { framesTotal: 0, ignored: 0, oscPackets: 0, oscErrors: 0, clients: 0, refused: 0 };

  // Say it once per page address, so a page that keeps retrying can't flood the screen.
  const toldAbout = new Set();
  function refuse(origin) {
    stats.refused++;
    const shown = String(origin).replace(/[^\x20-\x7e]/g, '?').slice(0, 100);
    if (toldAbout.has(shown) || toldAbout.size >= 50) return;
    toldAbout.add(shown);
    o.print(`Refused a connection from ${shown}: only pages on this computer may connect. Use --allow-origin to allow it.`);
  }

  const wss = new WebSocketServer({
    port: o.wsPort,
    host: o.wsHost,
    maxPayload: MAX_FRAME_BYTES,
    verifyClient: ({ req }, accept) => {
      // Browsers send "origin"; the old hybi-8 handshake called it "sec-websocket-origin". Check both so neither slips through.
      const origin = req.headers.origin;
      const oldStyle = req.headers['sec-websocket-origin'];
      if (!isOriginAllowed(origin, o.allowOrigins)) refuse(origin);
      else if (!isOriginAllowed(oldStyle, o.allowOrigins)) refuse(oldStyle);
      else return accept(true);
      accept(false, 403, 'Forbidden: only pages on this computer may connect');
    },
  });
  await new Promise((done, fail) => {
    wss.once('listening', done);
    wss.once('error', (err) => fail(new Error(friendlyListenError(err, o.wsPort))));
  });
  wss.on('error', (err) => o.print(`The relay's WebSocket server had a problem: ${err.message}`));
  const wsPort = wss.address().port;

  const udp = dgram.createSocket('udp4');
  let warnedOsc = false;
  const oscProblem = (err) => {
    stats.oscErrors++;
    if (warnedOsc) return;
    warnedOsc = true;
    o.print(`Could not send to TouchDesigner at ${o.oscHost}:${o.oscPort} (${err.message}). The relay keeps running and will keep trying.`);
  };
  udp.on('error', oscProblem);

  const sendPacket = (buf) => {
    stats.oscPackets++;
    try {
      udp.send(buf, o.oscPort, o.oscHost, (err) => err && oscProblem(err));
    } catch (err) {
      oscProblem(err);
    }
  };

  function forwardToTouchDesigner(frame) {
    const messages = frameToOsc(frame).map(([address, value]) => encodeMessage(address, [value]));
    if (o.bundle) sendPacket(encodeBundle(messages));
    else for (const m of messages) sendPacket(m);
  }

  function broadcast(text, from) {
    for (const client of wss.clients) {
      if (client === from || client.readyState !== client.OPEN) continue;
      if (client.bufferedAmount > SLOW_CLIENT_BYTES) continue; // a stuck listener must not slow everyone else down
      client.send(text);
    }
  }

  wss.on('connection', (socket) => {
    stats.clients = wss.clients.size;
    socket.on('error', () => {});
    socket.on('close', () => {
      stats.clients = wss.clients.size;
    });
    socket.on('message', (data, isBinary) => {
      if (isBinary) return void stats.ignored++;
      const text = data.toString();
      let frame;
      try {
        frame = JSON.parse(text);
      } catch {
        return void stats.ignored++;
      }
      if (!looksLikeFrame(frame)) return void stats.ignored++;
      stats.framesTotal++;
      try {
        forwardToTouchDesigner(frame);
        broadcast(text, socket);
      } catch (err) {
        stats.ignored++;
        o.print(`Skipped one frame: ${err.message}`);
      }
    });
  });

  let logTimer = null;
  if (o.log) {
    let last = { ...stats, at: Date.now() };
    logTimer = setInterval(() => {
      const secs = Math.max(0.001, (Date.now() - last.at) / 1000);
      const fps = Math.round((stats.framesTotal - last.framesTotal) / secs);
      const pps = Math.round((stats.oscPackets - last.oscPackets) / secs);
      const who = stats.clients === 0 ? 'nobody connected yet' : `${stats.clients} connected`;
      const extra = (stats.ignored ? `, ${stats.ignored} bad frames ignored` : '') + (stats.refused ? `, ${stats.refused} connections refused` : '');
      o.print(`${fps} frames/s in | ${who} | OSC to ${o.oscHost}:${o.oscPort} at ${pps} packets/s${extra}`);
      last = { ...stats, at: Date.now() };
    }, o.logEveryMs);
  }

  return {
    wsPort,
    stats: () => ({ ...stats }),
    async close() {
      if (logTimer) clearInterval(logTimer);
      for (const client of wss.clients) client.terminate();
      await new Promise((done) => wss.close(() => done()));
      await new Promise((done) => udp.close(() => done()));
    },
  };
}

function friendlyListenError(err, port) {
  if (err.code === 'EADDRINUSE') {
    return [
      `Port ${port} is already in use, so the relay can't start there.`,
      `  - If the relay is already running in another window, you don't need a second one.`,
      `  - Otherwise use a different port:  node bridge/relay.mjs --ws-port ${Number(port) + 1}`,
      `    (and open the web page with  ?td=ws://localhost:${Number(port) + 1}  at the end of its address)`,
    ].join('\n');
  }
  if (err.code === 'EACCES') return `The computer won't let the relay use port ${port} (${err.message}). Try a bigger port number, such as 9980, with --ws-port.`;
  return `The relay couldn't start (${err.message}).`;
}

const HELP = `TouchDesigner relay: passes the app's frames on to TouchDesigner.

  node bridge/relay.mjs [options]

Options:
  --ws-port <n>     Port the web page connects to (default ${DEFAULTS.wsPort})
  --ws-host <host>  Address to listen on (default ${DEFAULTS.wsHost}, this laptop only; use 0.0.0.0 to allow other computers)
  --allow-origin <origin>
                    Let one more web page connect, for example http://192.168.1.5:5173 (can be repeated).
                    Without this, only web pages on this computer (localhost, 127.0.0.1) and programs that
                    are not web pages (like TouchDesigner) can connect, so other websites can't read your data.
  --osc-host <h>    Where TouchDesigner is listening for OSC (default ${DEFAULTS.oscHost})
  --osc-port <n>    OSC port in TouchDesigner (default ${DEFAULTS.oscPort})
  --bundle          Send one OSC bundle per frame instead of one message per value
  --log             Print a short status line every few seconds
  --selftest        Check that everything works on this computer, then exit
  --help            Show this text
`;

/** Read command-line flags. Throws an Error with a plain-words message when something is wrong. */
export function parseArgs(argv) {
  const out = { ...DEFAULTS, bundle: false, log: false, selftest: false, help: false, allowOrigins: [] };
  const withValue = { '--ws-port': 'wsPort', '--ws-host': 'wsHost', '--osc-host': 'oscHost', '--osc-port': 'oscPort' };
  const flags = { '--bundle': 'bundle', '--log': 'log', '--selftest': 'selftest', '--help': 'help', '-h': 'help' };
  for (let n = 0; n < argv.length; n++) {
    const [name, inline] = argv[n].split(/=(.*)/s, 2);
    if (flags[name]) {
      out[flags[name]] = true;
    } else if (name === '--allow-origin') {
      const raw = (inline ?? argv[++n] ?? '').trim();
      if (!ORIGIN_SHAPE.test(raw)) throw new Error(`--allow-origin needs a web page address such as http://192.168.1.5:5173 (you gave "${raw}")`);
      out.allowOrigins.push(normalizeOrigin(raw));
    } else if (withValue[name]) {
      const raw = inline ?? argv[++n];
      if (raw === undefined || raw === '') throw new Error(`${name} needs a value, for example ${name} ${name.includes('port') ? '9981' : '127.0.0.1'}`);
      if (name.endsWith('port')) {
        const port = Number(raw);
        if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`${name} must be a whole number from 0 to 65535 (you gave "${raw}")`);
        out[withValue[name]] = port;
      } else {
        out[withValue[name]] = raw;
      }
    } else {
      throw new Error(`I don't know the option "${argv[n]}". Run  node bridge/relay.mjs --help  to see the options.`);
    }
  }
  return out;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  if (args.help) return void console.log(HELP);
  if (args.selftest) {
    const { runSelftest } = await import('./selftest.mjs');
    process.exit((await runSelftest()) ? 0 : 1);
  }
  let relay;
  try {
    relay = await startRelay(args);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  console.log(`TouchDesigner relay is running.`);
  console.log(`  The web page connects to  ws://localhost:${relay.wsPort}   (TouchDesigner's WebSocket DAT can connect there too)`);
  console.log(`  OSC for TouchDesigner goes to  ${args.oscHost}:${args.oscPort}   (OSC In CHOP, same port)`);
  console.log(`  Only web pages on this computer may connect${args.allowOrigins.length ? `, plus: ${args.allowOrigins.join(', ')}` : ' (add --allow-origin <address> to let one more in)'}.`);
  if (!['127.0.0.1', 'localhost', '::1'].includes(args.wsHost)) console.log(`  Careful: the relay is listening on ${args.wsHost}, so other computers on your network may be able to reach it.`);
  console.log(`  Press Ctrl+C to stop.${args.log ? '' : '  Add --log to see a status line every few seconds.'}`);
  const stop = async () => {
    await relay.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

const thisFile = fileURLToPath(import.meta.url);
const entry = process.argv[1] ? resolve(process.argv[1]) : '';
const isMain = (() => {
  try {
    return realpathSync(entry) === realpathSync(thisFile);
  } catch {
    return false;
  }
})();
if (isMain) main();
