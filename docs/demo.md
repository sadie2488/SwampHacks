# 🎤 The demo (2–3 minutes)

Ask about any part with `/explain demo`.

## Flow
1. **Learn**: upload a song (judges may pick it)
2. **Analysis**: tempo, key, time signature, sheet music appear
3. **Tempo practice with motion**: play along; tilt head to slow down a hard part
4. **Feedback**: what you did well, what to fix
5. **Play**: control the music with one movement
6. **Create**: judges hum → we build a cool beat around it
7. **Visuals**: TouchDesigner reacts throughout
8. **Fin**

## Rules for demo day
- The demo path must pass **5 runs out of 5** before we submit
- Speakers for everything except the practice segment (headphones or metronome there, so the song doesn't leak into the mic)

## Before the demo
- Start the app (`node scripts/dev.mjs`) at least **1 minute early**: the server warms up its analysis workers, and the first upload right after a start is slower
- Upload times on the main laptop: a 3-minute song about 11 s, a 5-minute song about 19 s. A 6-minute song may take about 23 s
- Ask judges for **MP3** (or OGG/FLAC): uploads are capped at 50 MB, so a 5-minute WAV is refused

## Fallbacks (to be finalized — pinned)
- Judges' song takes too long (>~20 s) → switch to a pre-analyzed song
- Wi-Fi drops → local demo mode with cached analysis and canned coaching
- Motion command not working → on-screen buttons
- Gemini slow → rule-based feedback shows instantly; coaching fills in later
