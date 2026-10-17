# Glossary (plain words)

Ask about any word with `/explain glossary` or `/explain <word>`.

- **Beat**: The steady pulse you'd tap your foot to.
- **BPM (tempo)**: How fast the beat goes, in beats per minute. 60 BPM is one beat each second.
- **Bar (measure)**: A small box of beats on sheet music. Songs repeat this grouping over and over.
- **Time signature**: The two numbers at the start of the music, like 4/4. The top one says how many beats are in each bar.
- **Note**: One musical sound with a pitch and a length.
- **Pitch**: How high or low a sound is.
- **Semitone**: The smallest step between two notes, like moving one key on a piano.
- **Octave**: The same note name, but higher or lower. Twelve semitones make one octave.
- **Cents**: A tiny slice of a semitone (100 cents = 1 semitone). We use it to say how out of tune a note is.
- **Key**: The "home" note and the set of notes a song mostly uses, like C major.
- **Sharp / flat**: A sharp (#) raises a note one step; a flat (b) lowers it one step.
- **Clef**: The symbol at the start of the music that tells you which line is which note. Clarinet uses treble clef and trombone uses bass clef.
- **Concert pitch**: The real sound that comes out. We save every note this way.
- **Transposing instrument**: An instrument whose sheet music shows different notes than what you hear. Clarinet music is written 2 steps higher than it sounds, and guitar music one octave higher.
- **MIDI number**: A number for each note, so the computer can do math with it. Middle C is 60.
- **Onset**: The exact moment a note starts. We compare your onsets to the song's to check your timing.
- **Latency**: The small delay between playing and the computer hearing you. A quick clap test measures it, and the app subtracts it.
- **Quantize**: Snapping notes to the nearest neat spot on the beat, so the sheet music is easy to read.

## Words from the app itself
- **Signal**: Something the app senses (a clap, your hand height). Listed in `contracts/signal-catalog.json`. *Moment* signals happen once; *slider* signals change continuously between 0 and 1.
- **Control**: Something a command can change (tempo, pitch, volume). Listed in `contracts/control-catalog.json`.
- **Mapping**: A rule that connects a signal to a control. They live in `web/src/modules/mappings/mappings.yaml`.
- **Contract**: The agreed shape of data passed between parts of the app, so the parts fit together.
- **Fixture**: Made-up sample data that follows a contract, so you can build before the real part exists.
- **Lane**: One person's or task's own set of folders. Everyone stays in their lane.
