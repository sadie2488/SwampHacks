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
| `audio/band/0` to `audio/band/7` | Eight frequency bands, low to high, 0 to 1. **Always 0 for now: nothing measures them yet** |
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

No relay running? The app still works. It keeps making frames, shows "Relay not found: start it with: node bridge/relay.mjs", and connects by itself as soon as you start the relay.

## Notes for whoever changes this

- The address list is in `bridge/frame-osc.mjs`; keep this page in step with it.
- The relay sends one OSC message per value (works with every receiver). `--bundle` sends one bundle per frame instead.
- The relay only listens on this laptop unless you add `--ws-host 0.0.0.0`.
