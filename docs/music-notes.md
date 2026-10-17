# Music notes (lead reference)

Short theory and measurement facts behind the app. Each section ends with what it means for our code.

## 1. Rhythm and meter
- **BPM** = beats per minute; one beat = `60 / BPM` s (120 BPM = 0.5 s).
- **Time signature**: top number = how many, bottom = which note value counts (4/4 = four quarters per bar).
- **Simple meter**: beat splits in 2 (2/4, 3/4, 4/4). **Compound meter**: beat splits in 3; top number is a multiple of 3; divide by 3 for beats per bar. 6/8 = 2 dotted-quarter beats, "felt in 2". 3/4 is simple triple (https://viva.pressbooks.pub/openmusictheory/chapter/compound-meters-and-time-signatures/).
- **Note values** (quarter-note beats): whole 4, half 2, quarter 1, eighth 0.5, sixteenth 0.25. **Dot** adds half; **tie** joins two notes; **triplet** = 3 in the time of 2.
- **Syncopation**: accents off the beat. **Swing**: eighths played long-short, about 2:1 (varies by tempo and player).
- → for our app: store times in seconds and in beats (`beat = (t - downbeat) * BPM / 60`). Beat trackers often report double or half tempo, and 6/8 often reads as 3/4. Let the user tap or fix BPM and meter. Add a swing flag so swung eighths don't quantize to dotted rhythms.

## 2. Pitch
- 12 semitones = 1 octave = 2× frequency. **Scientific pitch**: C4 = middle C; the octave number changes at C (B3 sits just below C4).
- **MIDI**: A4 = 69 = 440 Hz, C4 = 60. `midi = 69 + 12*log2(f/440)`.
- **Cents**: 100 cents = 1 semitone; `1200*log2(f/f_ref)`. The smallest pitch difference people hear is about 5–6 cents (https://en.wikipedia.org/wiki/Cent_(music)).
- **Enharmonics**: F# = Gb. MIDI can't tell them apart; the key decides the spelling.
- Practice tolerance (our choice): advanced players are in tune within ±10 cents. Beginners are flagged only past ±25 and told "a bit sharp/flat" past ±40. Untrained singers average about 19 cents error (https://webspace.eecs.qmul.ac.uk/s.e.dixon/pub/2014/MauchFrielerDixon_IntonationInUnaccompaniedSinging.pdf).
- → for our app: `performance-event` keeps float MIDI (cents = `(x - round(x))*100`); `note-event` keeps integer MIDI. Judge pitch with the median over the note, not the attack (players scoop into notes).

## 3. Keys and scales
- Major: W W H W W W H. Natural minor: W H W W H W W.
- Sharps go F C G D A E B; flats go B E A D G C F. On the **circle of fifths**, each step adds one sharp or flat; neighbours share 6 of 7 notes.
- **Relative** keys share a key signature (C major / A minor; the minor tonic is 3 semitones lower). **Parallel** keys share a tonic (C major / C minor).
- Spelling: sharp keys use sharps, flat keys use flats (F major has Bb, never A#).
- **Krumhansl-Schmuckler**: make a duration-weighted 12-bin pitch-class histogram. Correlate it with major and minor profiles rotated to all 24 keys and pick the best. Common mistakes are the dominant (a fifth up), the relative key, and the parallel key. music21 notes that KS leans toward the dominant. It also offers AardenEssen, BellmanBudge, and TemperleyKostkaPayne, and lists runner-up keys in `alternateInterpretations` (https://www.music21.org/music21docs/moduleReference/moduleAnalysisDiscrete.html). mir_eval gives partial credit: fifth 0.5, relative 0.3, parallel 0.2 (https://mir-eval.readthedocs.io/latest/api/key.html).
- → for our app: show the top key and its correlation. If the runner-up is close, show a toggle to switch to it. Set the music21 key before MusicXML export so accidentals are spelled right.

## 4. Notation essentials for rendering
- **Clefs**: treble for clarinet, bass for trombone. Guitar uses treble with an "8" below, meaning it sounds an octave lower (https://en.wikipedia.org/wiki/Clef).
- **Ledger lines**: beginners struggle past about 3, so use an octave shift or change clef instead.
- **Beaming** shows the beat: 4/4 beams per beat or half bar; 6/8 beams in 3s.
- **Quantizing**: snap onsets and durations to a grid (1/16, or 1/8-triplet for swing). Pitfalls: too fine gives 32nd-note mush, too coarse loses syncopation; a wrong BPM or downbeat shifts every note; notes over barlines need ties; tiny gaps become rest clutter.
- → for our app: quantize in beats; pick straight vs triplet grid per song by smaller total snap error. Merge or drop notes under 1/16; fill tiny gaps. music21 `makeNotation()` adds ties and beams. Beginner mode puts letters on noteheads.

## 5. Transposing instruments
- **Bb clarinet** sounds a major 2nd lower than written: `written = concert + 2`. Written range E3–C7, sounding D3–Bb6 (https://en.wikipedia.org/wiki/Clarinet). Beginners: written E3 up to about C6.
- **Tenor trombone** is non-transposing (concert pitch), in bass clef (tenor clef for high parts). Range E2 to about F5 (conservatively D5); pedal Bb1 (https://en.wikipedia.org/wiki/Trombone). Beginners: about E2–F4.
- **Guitar** is written an octave above sounding: `written = concert + 12`. Open strings E2 A2 D3 G3 B3 E4 (https://en.wikipedia.org/wiki/Guitar). Sounding top is about B5 at fret 19.
- → for our app: this matches our rule (concert MIDI stored, transpose only for display). If a part goes outside a beginner range, shift the whole part by octaves, never single notes. Emit a MusicXML `<transpose>` element or a clef octave change so OSMD draws the part correctly.

## 6. Practice pedagogy and feedback
- Practise slowly first, with a metronome. Once a passage is clean, go up 2–5 BPM (teacher rule of thumb).
- Chunking: loop 1–4 bars, then join the chunks.
- Feedback: one specific point. Lead with something done well, then one fix ("Bars 3–4 steady; you rushed bar 5"). No walls of scores.
- Beginner timing errors: rushing eighths, dragging on hard fingerings, cutting long notes short, late entries after rests, clipped dotted notes, lost pulse on ties and syncopation.
- Beginners: one tip, green/yellow/red per bar, loose tolerances. Advanced: per-note ms offsets, rushing/dragging trend, cents.
- → for our app: rules compute the facts (e.g. "bar 5 averages 60 ms early"). Gemini only phrases them into 1–2 kind sentences and must not invent errors. Offer the action "loop this bar at 80%".

## 7. Measurement
- **Onsets**: librosa `onset_detect`. Soft clarinet and trombone attacks are harder to catch than guitar plucks. **Beats**: librosa `beat_track`; expect double or half tempo and phase errors.
- **Tolerance**: mir_eval counts an onset as matched within 50 ms (`window=0.05`; https://mir-eval.readthedocs.io/latest/api/onset.html).
- **Perception**: listeners detect timing shifts of about 10 ms on short tones, and about 5% of the length on longer ones (https://auditory.org/asamtgs/asa93dnv/4pPP/4pPP2.html). People tapping with a metronome land tens of ms early (https://link.springer.com/10.1007/s00426-018-1043-2).
- **Live latency**: players don't notice under about 10 ms; about 20 ms feels bad (https://www.highfidelity.com/blog/how-much-latency-can-live-musicians-tolerate-da8e2ebe587a). A browser round trip is often tens of ms; Bluetooth adds far more.
- **Pitch tracking**: for one note at a time, use pYIN (recommended range C2–C7; https://librosa.org/doc/main/generated/librosa.pyin.html). For chords, use basic-pitch: it is polyphonic, works best on one instrument, and downmixes to mono at 22050 Hz (https://github.com/spotify/basic-pitch).
- → for our app: subtract the shared latency offset from every onset. Grade ±50 ms on time, 50–100 ms a bit early/late, beyond that off. Report mean signed offset (rushing/dragging) apart from spread (steadiness). Wired headphones. pYIN live; basic-pitch only on uploaded, separated stems.

## 8. Humming to notes
- Hum range is about 1–1.5 octaves: roughly G2–D4 for low voices, G3–D5 for high (our estimate).
- Vibrato is about 5–8 Hz, up to ±100 cents for soloists (https://en.wikipedia.org/wiki/Vibrato). Glides blur note edges. Trackers make ±12 octave errors on breathy or low hums.
- Untrained singers drift a median of about 11 cents per song (mostly upward), and their intervals are off by about 26 cents (Mauch et al., above).
- → for our app: median-filter f0 (50–100 ms); a note needs ~100 ms of stable pitch; fix octave jumps against neighbours; subtract a running tuning offset, round, snap to the key's scale (chromatic option), then map to instrument samples.

## 9. Time-stretch and pitch-shift
- Phase-vocoder stretching sounds "phasey" and smears drum hits (https://en.wikipedia.org/wiki/Audio_time_stretching_and_pitch_scaling); librosa points to RubberBand for higher quality (https://librosa.org/doc/main/generated/librosa.effects.time_stretch.html). Pitch-shifting voices moves formants ("chipmunk") unless formants are preserved.
- Practice range: 50–100% speed in 5–10% steps; artifacts grow fast below 50%. Shift pitch in whole semitones (±12).
- → for our app: browser `playbackRate` + `preservesPitch`, or a SoundTouch/RubberBand worklet; pre-render 50/75/100% for the demo. When slowed, scale expected onsets (`t / rate`), never the user's. A +n semitone shift adds n to expected MIDI and the shown key.
