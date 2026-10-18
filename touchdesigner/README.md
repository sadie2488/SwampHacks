# TouchDesigner: getting the music and hand numbers

The web app sends about 30 small "frames" a second: how loud the music is, whether a note just started, where your hands are, and so on. Browsers can't talk to TouchDesigner directly, so a tiny program called the **relay** runs on the same laptop and passes the numbers on.

```
web page  --WebSocket-->  relay (node bridge/relay.mjs)  --OSC over UDP-->  TouchDesigner
```

You can receive the numbers in TouchDesigner two ways. Pick one (the OSC way is easiest).

## Start the relay

First time only: `cd bridge` then `npm install`. Then, from the main project folder:

```
node bridge/relay.mjs --log
```

It prints where it is listening and a status line every few seconds (frames per second, who is connected). To check it works on this laptop without TouchDesigner: `node bridge/relay.mjs --selftest`.

If it says a port is already in use, the relay is probably already running in another window. Otherwise use `--ws-port 9981` and add `?td=ws://localhost:9981` to the web page's address.

### Who may connect

The relay only listens on this laptop, and it only lets in web pages that are open on this laptop (addresses starting `http://localhost`, `http://127.0.0.1` or `http://[::1]`) and programs that are not web pages, such as TouchDesigner's WebSocket DAT. A page from any other website is refused, so a stray browser tab can't read your hand and sound data or send fake data. When that happens the relay prints a line like `Refused a connection from http://evil.example: ...`.

To let one more page in on purpose (for example the app opened from a phone at `http://192.168.1.5:5173`), start the relay with `--allow-origin http://192.168.1.5:5173` (you can repeat it).

The web page works the same way in the other direction: a `?td=` address is only used when it points at this computer (`ws://localhost:9981`, `ws://127.0.0.1:9981` or `ws://[::1]:9981`). Anything else is ignored, the status line says so, and the page uses `ws://localhost:9980`. To send to another computer on purpose, add `&td_remote=1` to the page's address.

## Way 1: OSC In CHOP (easiest)

1. Add an **OSC In CHOP**.
2. Set **Network Port** to `7000` and turn **Active** on.
3. The channels appear with the names below (the address without the first slash, for example `audio/rms`).

TouchDesigner on another computer? Start the relay with `--osc-host <that computer's address>`.

## Way 2: WebSocket DAT

1. Add a **WebSocket DAT**, set **Network Address** to `localhost` and **Network Port** to `9980`, turn **Active** on. It connects as a client.
2. Each message is one frame as JSON text. In the DAT's callbacks, `onReceiveText(dat, rowIndex, message)` receives it:

```python
import json
frame = json.loads(message)
rms = frame['audio']['rms']
right = frame['hands']['right']     # None when the hand is not visible
```

The frame format is described in `contracts/td-message.schema.json`.

## The channels

| Channel | What it is |
|---|---|
| `audio/rms` | Loudness, 0 to 1 |
| `audio/onset` | 1 for one frame when a note starts, then back to 0 (use a Trigger or Count CHOP) |
| `audio/pitch` | Pitch as a MIDI note (60 = middle C, can have decimals). **-1 means no clear pitch** |
| `audio/bpm` | Tempo of the song playing, beats per minute (0 if nothing is loaded) |
| `audio/beat_phase` | Where we are inside the current beat, 0 to 1 |
| `audio/band/0` to `audio/band/7` | Eight frequency bands of the song playing, low to high, 0 to 1 (20-60, 60-150, 150-400, 400-1k, 1k-2.5k, 2.5k-6k, 6k-12k, 12k-20k Hz). About 30 updates a second while playing, smoothed; 0 when paused |
| `hand/left/...` and `hand/right/...` | Per hand: `x` (0 = left edge), `y` (0 = top), `height` (1 = top), `fist` (0 or 1), `open_palm` (0 or 1), `pinch` (0 to 1), `present` (1 when the hand is seen) |
| `hands/distance` | How far apart the two hands are, 0 to 1 |
| `mode` | Text: `learn`, `play` or `create`. A CHOP only holds numbers, so read it with an **OSC In DAT** (same port) or from the WebSocket DAT's JSON. Only sent when known |
| `intensity` | The visual intensity slider, 0 to 1 |

A hand that has not been seen for half a second is "gone": `present` is 0 and its numbers are 0, so the visuals don't freeze on the last position.

## Quickstart: see the numbers move (5 steps)

1. Install Node.js if needed, then run `cd bridge` and `npm install` once.
2. Start the relay: `node bridge/relay.mjs --log`.
3. In TouchDesigner add an **OSC In CHOP** with Network Port `7000` and Active on.
4. Open the web app (add `?fake=1` to the address to use pretend camera and microphone data, no hardware needed) and turn on TouchDesigner in the app.
5. Watch the relay's status line show frames per second, and the channels in the OSC In CHOP wiggle. Raise a hand or play a song and `hand/right/height`, `audio/rms` and `audio/beat_phase` change.

## No website at all: the fake sender (build visuals on any laptop)

`node bridge/fake-td.mjs` sends made-up music and hand numbers straight to TouchDesigner (port 7000), on the same channels as the real app: a 120 bpm beat (bass bands kick on every beat), a melody in `audio/pitch`, hands drawing circles, a fist now and then, the left hand leaving and coming back, and `mode` changing every 20 s. It needs only Node.js (no `npm install`, no relay, no server). Options: `--bpm 90`, `--osc-port 7001`, `--seconds 60`. Build the TouchDesigner file against it, then copy the `.toe` to the demo laptop: the real app sends the very same channel names.

No relay running? The app still works. It keeps making frames, shows "Relay not found: start it with: node bridge/relay.mjs", and connects by itself as soon as you start the relay.

## Notes for whoever changes this

- The address list is in `bridge/frame-osc.mjs`; keep this page in step with it.
- The relay sends one OSC message per value (works with every receiver). `--bundle` sends one bundle per frame instead.
- The relay only listens on this laptop (`127.0.0.1`) unless you add `--ws-host 0.0.0.0`. The web-page check (`--allow-origin`) applies either way.
