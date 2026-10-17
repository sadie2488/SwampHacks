# 🕹️ Commands guide (for Veda, and anyone curious)

**Veda owns this part. She's free to change any design detail here** — signals, controls, how commands behave, the Command Lab layout. No approval needed inside her part. If she needs a new signal or control from another part of the app, she asks the main laptop and it gets prioritized.

## The idea in one line
> "When **[something the app senses]** happens in **[mode]**, do **[something to the music]**, **[this way]**."

## Three layers
1. **Signals** — everything the app can sense (list: `contracts/signal-catalog.json`)
   - **Moment** signals happen once: a clap, a fist, a spoken word
   - **Slider** signals are a number from 0 to 1 that changes continuously: hand height, head tilt, loudness
2. **Controls** — everything a command can change (list: `contracts/control-catalog.json`)
   - Play mode: play/pause, tempo, pitch, volume, loop on/off, loop section
   - Create mode: add layer, choose instrument, beat on/off, record/stop loop, layer volume, effects, visual intensity
3. **Mappings** — the rules connecting them. **This is the file Veda edits**: `web/src/modules/mappings/mappings.yaml`

## What a mapping looks like
```yaml
- name: hand height controls tempo     # any label you like
  mode: play                           # play | create | learn | any
  when: vision.hand.right.height       # a signal from the catalog
  do: playback.tempo                   # a control from the catalog
  how: follow                          # follow | trigger | toggle | nudge
  range: [0.5, 1.5]                    # how far the control can move
  smoothing: 0.3                       # 0 = jumpy, 1 = very smooth
  min_confidence: 0.6                  # how sure the app must be before acting

- name: clap toggles play/pause
  mode: play
  when: audio.clap
  do: playback.toggle
  how: trigger
  cooldown_ms: 600                     # ignore repeats for 0.6 s (stops double-fires)

- name: say "slower" only while left fist is held
  mode: play
  when: audio.keyword.slower
  only_while: vision.hand.left.fist    # optional "arming" condition
  do: playback.tempo
  how: nudge
  step: -0.1
```

## How each "how" works
- **follow**: the control follows a slider signal (hand goes up → tempo goes up)
- **trigger**: fires once per moment signal (clap → play/pause)
- **toggle**: flips something on/off (fist → loop on/off)
- **nudge**: moves a control one step (say "faster" → tempo +0.1)

## Fine-tuning knobs
- **smoothing** — steadies shaky hand tracking
- **cooldown_ms** — stops one clap counting twice
- **min_confidence** — ignores signals the app isn't sure about
- **range / step** — limits how far or how fast a control moves
- **only_while** — a command only works while another signal is active (useful so voice commands don't fire while you play)

## Safety
- A typo or unknown name never breaks the app: the bad line is skipped and the Command Lab shows a friendly error
- Changes apply instantly — no restart
- Two commands fighting over the same signal in the same mode → the Command Lab warns you

## The Command Lab (test page)
- Live camera view with tracking drawn on top
- A live meter for every signal (watch "hand height" move as you move)
- Every control with its current value
- Each command lights up when it fires

## Starter commands (to replace/extend)
pause · play · slow down · raise pitch · raise tempo

## Open questions for Veda (pinned)
- Final command list for play and create modes
- Voice commands during play mode (the instrument is loud — use an "arming" gesture?)
- Final list of tracked body parts
