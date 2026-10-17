---
paths:
  - "contracts/**"
  - "fixtures/**"
---
# Contracts and fake data (lead only)

- Every contract is a JSON Schema with a `version` field. Changes are **additive only**. A breaking change is a new task, done only by the lead
- Notes use **concert-pitch MIDI** everywhere. Display code transposes: B♭ clarinet written = concert + 2 semitones; guitar written an octave above sounding; trombone is concert pitch in bass clef
- One shared **latency offset** field lives in `performance-event` (from clap calibration)
- Every contract has fake data in `fixtures/` that validates against it. Run `node scripts/validate-contracts.mjs` before committing
- Tests start as a plain-English list; a human approves it; then test code mirrors the list. Never write tests that grade your own work
