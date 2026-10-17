# 🎹 What the app does, mode by mode

Ask about any part with `/explain features`.

## Learn mode
- **Upload a song** (or pick a pre-analyzed demo song)
- **Analysis**: tempo (speed in beats per minute), key, time signature
- **Isolate a part**: e.g. just the melody or just the clarinet line
- **Sheet music**: generated from the isolated part. Beginner mode shows note letters
- **Practice**: play along on a real instrument. The app listens through the mic and compares you to the song
- **Feedback**: instant rule-based tips (e.g. "you rushed bars 12–14"), then friendlier coaching written by Gemini
- **Slow down / speed up** without changing pitch, so you can practice hard parts slowly
- **Practice history** is saved so you can see progress

## Play mode
- Motion and audio control the music:
  - Tempo, pitch, volume, loop on/off, loop section
  - Example: head tilt slows down, hand height raises the tempo
- Exactly which movement does what is designed by Veda (see `docs/commands-guide.md`)

## Create mode (DJ)
- **Hum** a melody → the app turns it into notes → plays them with an instrument sound
- **Layer** beats, loops and instruments
- **Snap / clap / drum motions** can add beats (Veda decides the details)
- **Save and replay** your creation

## Visuals
- TouchDesigner visuals react to the music and to hand movement
- The app streams music and hand data to TouchDesigner

## Commands
- Start set: play, pause, slow down, raise pitch, raise tempo
- Every command also has an on-screen button, so it works even before motion/voice mapping exists

## Not built in this version (shown in the UI as "coming soon" if there's no time)
- Anything we run out of time for stays visible as a labeled, disabled feature so the full vision is clear
