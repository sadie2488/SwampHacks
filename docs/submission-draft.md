# Overture: submission draft (edit freely)

## Inspiration
Learning an instrument usually means staring at sheet music and a metronome. We wanted music software you play like an instrument: your hands and your voice conduct the song, the screen answers with sound and light, and nothing gets in the way.

## What it does
Overture is a music website you use with your camera and microphone. You enter through a blooming flower, pick a "record", and drop into one of three modes:
- **Learn:** upload any song (MP3). In about 10 to 20 seconds Overture finds its key, tempo and time signature, separates the melody, bass and chords, and writes sheet music. Play along on a real instrument: it listens, measures whether you rushed or dragged, and gives feedback bar by bar, with friendly coaching.
- **Play:** conduct the song with your body. Raise your right hand to speed it up, double clap to play or pause, make a fist with your left hand and say "slower", "higher" and more.
- **Create:** hum a melody. Overture turns it into notes, loops it, and lets you layer instruments ("piano", "synth", "drums"), effects ("reverb") and a beat, all by voice and hand.

Navigation is hands-first too: point with your hand, close it into a fist and hold to choose; hold an ASL letter (L, Y, C, W) for two seconds to jump between modes. The live camera is the background, and the screen reacts to the music's frequency bands. The same data streams to TouchDesigner for large-scale visuals.

## How we built it
- **Website:** React + Vite, Web Audio and Tone.js (tempo changes without pitch change, pitch shifting), MediaPipe hand and face tracking in a background worker, our own gesture and ASL fingerspelling classifier on the hand landmarks, Chrome speech recognition with sound-alike matching, OpenSheetMusicDisplay for the sheet, and a three.js shader for the camera background.
- **Server:** Python (FastAPI), librosa (tempo, beats, key), Spotify's basic-pitch (polyphonic transcription, via ONNX) to split melody, bass and chords, run in parallel worker processes.
- **Gemini** turns measured practice facts into short coaching. **Tiger Data** (Postgres + TimescaleDB) stores songs, practice runs and saved tracks. **Auth0** login is optional.
- **TouchDesigner** receives hands, beat and frequency bands over OSC through a small relay.
- **How we worked:** one shared repo with contracts, a command file anyone can edit, and over 1,600 automated tests, including an integration test for every voice and hand command and a browser test of the whole app.
- **AI tools:** we used AI coding assistants (Claude) heavily for implementation, under our direction: we set the design, the commands and the priorities, reviewed and tested every change on real devices, and made the calls. *(Team: keep or edit this line to match the track rules.)*

## Challenges we ran into
- Telling a clap from a desk tap or the song's own drums: we moved play/pause to a double clap and made detection stricter while music plays.
- Speech recognition hearing "paws" for "pause": we check Chrome's alternative guesses, accept sound-alikes, and fire only one command per phrase.
- Full-band songs: a single-melody tracker gave almost nothing on rock songs; polyphonic transcription plus part splitting fixed it, and correcting key detection (it kept picking the dominant) mattered as much.
- Keeping animation smooth on slow laptops: everything animates with transforms, effects are pre-rendered, and quality drops automatically when frames slow down.

## Accomplishments we're proud of
- On four real band songs, key and tempo are right on all four, with separate melody, bass and chord parts in 11 to 15 seconds.
- A fully hands-and-voice interface that still works without a camera.
- Every command has an automated test that proves it changes the app.

## What we learned
Focus beats features: one bold idea per screen, and a clear signal when the app understood you.

## What's next
Hand-drawn flowers for every section, more instruments to separate, a mobile layout, and multiplayer jam sessions.

## Built with
React, Vite, TypeScript, Web Audio, Tone.js, MediaPipe, OpenSheetMusicDisplay, three.js, Python, FastAPI, librosa, basic-pitch, ONNX Runtime, Gemini, Tiger Data (TimescaleDB), Auth0, TouchDesigner
