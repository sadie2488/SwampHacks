// The part that talks to the relay: opens the WebSocket, makes about 30 frames a second, keeps trying again when the
// relay is not there, and tells the user what is going on in plain words. All outside things (WebSocket, clock, timers,
// the bus) are passed in, so tests can use fakes.
import type { TdMessage } from '@/contracts';

export const DEFAULT_RELAY_URL = 'ws://localhost:9980';
export const FRAMES_PER_SECOND = 30;
const OPEN = 1;
const RETRY_FIRST_MS = 500;
const RETRY_MAX_MS = 5000;
const STATUS_EVERY_MS = 1000;
/** Don't queue more than this in the browser if the relay can't keep up. */
const MAX_BUFFERED_BYTES = 1_000_000;

export interface WebSocketLike {
  readyState: number;
  bufferedAmount?: number;
  onopen: ((ev: any) => void) | null;
  onclose: ((ev: any) => void) | null;
  onerror: ((ev: any) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type SenderState = 'idle' | 'starting' | 'running' | 'error';

export interface SenderDeps {
  url: string;
  createSocket: (url: string) => WebSocketLike;
  now: () => number;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  /** Makes the next frame (see createTracker). */
  makeFrame: () => TdMessage;
  /** Puts the frame on the bus ("td" topic), so the app can be tested without TouchDesigner. */
  publish: (frame: TdMessage) => void;
  report: (state: SenderState, message: string) => void;
}

/** The address the relay listens on. A page address ending in ?td=ws://host:port overrides the default. */
export function relayUrl(search: string | undefined): string {
  const wanted = new URLSearchParams(search ?? '').get('td');
  return wanted && /^wss?:\/\/[^\s/]+/.test(wanted) ? wanted : DEFAULT_RELAY_URL;
}

export function createSender(deps: SenderDeps) {
  let enabled = false;
  let socket: WebSocketLike | null = null;
  let open = false;
  let everConnected = false;
  let failedOnce = false;
  let attempt = 0;
  let made = 0;
  let sent = 0;
  let lastStatusAt = 0;
  let ticker: unknown = null;
  let retryTimer: unknown = null;

  function say(): void {
    lastStatusAt = deps.now();
    if (!enabled) return deps.report('idle', 'TouchDesigner is off.');
    if (open) return deps.report('running', `Sending to TouchDesigner (${sent} frames sent).`);
    if (!failedOnce) return deps.report('starting', 'Connecting to the TouchDesigner relay...');
    const lead = everConnected ? 'Lost the TouchDesigner relay (trying again). To restart it' : 'Relay not found: start it';
    deps.report('error', `${lead} with: node bridge/relay.mjs. The app keeps working without it (${made} frames made so far).`);
  }

  function scheduleRetry(): void {
    if (!enabled || retryTimer !== null) return;
    const wait = Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** attempt);
    attempt++;
    retryTimer = deps.setTimeout(() => {
      retryTimer = null;
      connect();
    }, wait);
  }

  function connect(): void {
    if (!enabled) return;
    let sock: WebSocketLike;
    try {
      sock = deps.createSocket(deps.url);
    } catch {
      failedOnce = true;
      scheduleRetry();
      say();
      return;
    }
    socket = sock;
    sock.onopen = () => {
      if (socket !== sock) return;
      open = true;
      everConnected = true;
      attempt = 0;
      say();
    };
    sock.onerror = () => {}; // a close event always follows
    sock.onclose = () => {
      if (socket !== sock) return;
      socket = null;
      const wasOpen = open;
      const firstFailure = !failedOnce;
      open = false;
      failedOnce = true;
      scheduleRetry();
      // say it right away when something changed; repeated failed retries just keep the message (and its count) up to date
      if (wasOpen || firstFailure) say();
    };
  }

  function tick(): void {
    const frame = deps.makeFrame();
    made++;
    deps.publish(frame);
    if (socket && open && socket.readyState === OPEN && (socket.bufferedAmount ?? 0) < MAX_BUFFERED_BYTES) {
      try {
        socket.send(JSON.stringify(frame));
        sent++;
      } catch {
        // the connection just dropped: the close event will start a retry
      }
    }
    if (deps.now() - lastStatusAt >= STATUS_EVERY_MS) say();
  }

  return {
    enable(): void {
      if (enabled) return;
      enabled = true;
      open = everConnected = failedOnce = false;
      attempt = made = sent = 0;
      say();
      connect();
      ticker = deps.setInterval(tick, Math.round(1000 / FRAMES_PER_SECOND));
    },
    disable(): void {
      if (!enabled) return;
      enabled = false;
      if (ticker !== null) deps.clearInterval(ticker);
      if (retryTimer !== null) deps.clearTimeout(retryTimer);
      ticker = retryTimer = null;
      const sock = socket;
      socket = null;
      open = false;
      if (sock) {
        sock.onopen = sock.onclose = sock.onerror = null;
        try {
          sock.close(1000, 'turned off');
        } catch {
          // already closed
        }
      }
      say();
    },
    isEnabled: () => enabled,
    stats: () => ({ made, sent, connected: open }),
  };
}
