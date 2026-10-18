# UPDATE for Shayaan: test ONLY Play and Create (from the main laptop, Sun ~5:15 AM)

1. Get the latest: `git checkout main && git pull`, then (if the server packages changed) `cd server && uv sync` and `cd web && npm ci`. Start: `node scripts/dev.mjs`, wait 1 minute, open http://localhost:5173 in Chrome. F12 -> Console -> level **Verbose**.
2. Click **Enter with camera + sound**. Get into Play: hold the **Y** sign for 2 s (a ring fills), or point at the Play record with your hand, close it into a fist and hold still 1 s.

## Play (bottom-left **Song** -> Use demo song, or upload an MP3; the song loops by itself in Play)
- P1. **Double clap** = play / pause. A word flashes on screen ("Play", "Pause").
- P2. **Single clap, desk taps, keyboard, talking** = nothing should happen.
- P3. **Right hand up / down** = faster / slower (tempo readout follows; a "Tempo" word flashes).
- P4. **Hold a left fist** and say **pause / play / faster / slower / higher / lower**: each word does exactly one thing. Without the fist: nothing.

## Create (hold **C** for 2 s)
- C1. Say **"start"** alone, hum a short tune (the rings swell), then **raise your left fist** to end the take: a layer appears ("Layers 1").
- C2. Say **piano**, **synth**, **drums**, **reverb**, **delay**, **next** (records another layer), **beat** (drum beat on).
- C3. **Right fist** = stop. **"let's start the drums"** said as a sentence = nothing.
- C4. Tick **Hand controls pitch** on a layer (Layers panel), move your right hand up/down = pitch; **left thumbs-up** = keep it.

## Report each FAIL
What you did, what happened, and the console lines around it (`[audio-live]` / `[speech]`). Send with `node scripts/comms-send.mjs comms/shayaan-to-lead.md - --append` (then Ctrl+Z, Enter on Windows) or tell Lalitha. Never paste keys.
