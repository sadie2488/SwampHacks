# Testing brief for Shayaan (from the main laptop)

The demo is in a few hours. Your job: **try every demo command on your own laptop with your real camera and mic, and report what works and what doesn't.** Claude on Shayaan's laptop: walk him through this.

## 1. Get it running (about 15 minutes the first time)
1. In the SwampHacks folder: `git checkout main` then `git pull`
2. First time only: run `/start` (guided setup) or check with `setup/setup-check.ps1` (Windows) / `setup/setup-check.sh` (Mac/Linux). Then `npm ci` inside `web/` and `bridge/`, and `uv sync` inside `server/` (downloads the audio tools, a few hundred MB)
3. Start it: `node scripts/dev.mjs`. Wait about 1 minute (the server warms up). Open **http://localhost:5173** in **Chrome**
4. Press **F12**, open **Console**, set the level dropdown to **Verbose** (the mic and speech write what they hear there)

## 2. Test list (do each one, note PASS / FAIL / what happened)
**Entrance and menu**
- A. Click **Enter with camera + sound**, allow camera and mic. You see yourself in the background, like a mirror
- B. On the record menu: arrow keys turn the records. Then **open your hand, then close it into a fist**: the chosen record opens
- C. Click **Overture** (top left): back to the menu

**Switching modes with signs** (hold each for 2 seconds; a ring fills, then the mode changes)
- D. **L** = Learn, **Y** = Play, **C** = Create, **W** = Command Lab
- E. Let go after 1 second: nothing should happen

**Learn**
- F. Bottom-left **Song** -> **Use demo song**. Then upload a real MP3 (a 3-4 minute song with several instruments). It should show key + tempo within about 20 s, and **Sheet** shows the notes; the **Part** menu has Melody / Bass / Chords
- G. Bottom-left **Player** -> play. The notes glide past the line on screen

**Play** (load a song first)
- H. **Double clap** = play / pause. A **single** clap, desk taps and talking must do NOTHING
- I. Raise / lower your **right hand** = faster / slower (watch the tempo readout)
- J. **Hold a left fist** and say **"pause"**, **"play"**, **"faster"**, **"slower"**, **"higher"**, **"lower"**. Without the fist, the words must do nothing

**Create**
- K. Say **"start"** (just the word), hum a short tune, then **raise your left fist** to end the take: a layer appears
- L. Say **"piano"**, **"synth"**, **"drums"**; **"reverb"**, **"delay"**; **"next"** (records another layer); **"beat"** (drum beat on)
- M. **Right fist** = stop. Saying "let's start the drums" in a sentence must do nothing

**Other**
- N. **Guide** button (top right): instructions overlay. **Hands** button: what your hands say
- O. The page never scrolls; everything fits your screen

## 3. Report back
For every FAIL: what you did, what happened, and the console lines around it (lines starting with `[audio-live]` or `[speech]`). Send it to the main laptop:
`node scripts/comms-send.mjs comms/shayaan-to-lead.md - --append` (type or paste, then Ctrl+Z and Enter on Windows / Ctrl+D on Mac), or send it to Lalitha.
Never paste keys or passwords.
