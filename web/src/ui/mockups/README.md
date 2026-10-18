# Overture design mockup

`overture-mockup.html` is Lalitha's working design for the look and motion of Overture. It is a single self-contained page: a design to port from, **not app code**. Everything in it can be changed from one `CONFIG` block at the top of the script.

Design rules, research and decisions: `web/src/styles/design-principles.md`. Colours and type: `web/src/styles/color-scheme.md`.

## How to open it

- Serve the folder on localhost (camera and mic need `localhost` or HTTPS), for example `npx serve web/src/ui/mockups` or `python -m http.server`, then open `overture-mockup.html` in Chrome
- Press **Enter with camera + sound** and allow the camera and mic
- **A** (or the Arrange pill) = drag to move anything, scroll to resize, Shift + scroll to rotate, click + Delete to hide (Ctrl+Z undo)
- **T** (or the Tweak pill) = live sliders. "Copy values" copies them; Reset restores the file's defaults
- Arrange/Tweak changes are saved only in that browser (localStorage). The file's defaults are Lalitha's current arrangement

## The screens

### 1. Entrance
- Dark screen, "Overture" in the script font (Mea Culpa), one button: **Enter with camera + sound**
- A spray of **chrysanthemums** drawn as type marks (dense runs of dashes, `+` crosses, small boxes; cream with blue-ish faint marks, magenta centres), each flower solid in its middle and breaking into marks at its own edges
- **Blooming:** far from the Enter button the flowers are tight closed balls; as the cursor approaches the button the outer petals open first into thin rays, then the centres show. **Size stays constant**
- Flowers are **placeholders**: Lalitha will hand-draw every flower once the design is final (see decisions)
- Specimen label top right ("Fig. 01 · Chrysanthemum")

### 2. Record menu (select a mode)
- **Background:** the live camera, pushed back on this screen (dark, soft focus, nearly colourless: `CONFIG.menuLook`). It eases back to the normal look inside a mode
- **Carousel:** four records on a rising diagonal; scroll / arrow keys / pills to move; the chosen one is flatter (faces you), bigger, casts a soft shadow and slowly turns. The others rest, grey and dimmed
- **Record style (all four the same):** frosted, semi-transparent vinyl in the mode colour; the name in huge stacked letters (LEA/RN, PL/AY, CRE/ATE, COMMAND/LAB) **cut out of the frosted filter**, so the record's own colour, grooves and dotted flower show through the letters unfiltered; gray instead of white details (gray mist, gray grooves); dark centre label; see-through hole
- **Words around the record:** two giant serif lines per mode (e.g. "LEARN / BY EAR"). The first line sits just above the record and tucks **behind** it; the second runs **in front** across its lower part. Lines sit a small step off the record's centre (about 1/8 of its width) and **alternate sides** record to record (1: top-left/bottom-right, 2: mirrored ...). Each line slides in from the side it leans towards, leading letters first
- **Corners, one job each:** top-left = information (mode label + one-liner); bottom-left = the single instruction ("FOUR WAYS IN. PICK ONE."); bottom-right = control (mode pills) with a tiny decorative music staff above; top-right = tools (faint Arrange/Tweak)
- **Click transition:** a ripple runs through the camera picture from the record, the record turns to face you and rushes at the screen (slow start, very fast finish); the mode page is visible only **through the record's hole** until the hole fills the screen

### 3. Mode screens (Learn, Play, Create, Command Lab)
- Normal camera look (clear reflection with a light print texture, tinted with the mode colour)
- Title in the big serif, wireframe placeholders for each mode's content
- **Guide indicator:** the hand is drawn as **dots** (joint dots + small dots along each bone) in the mode colour; the head as the traced face outline with an eye line ending at the outline. A pill says what is being followed
- **Motion controls are OFF** (`CONFIG.motionControls:false`): hand/head lines are only visual for now; they don't move or pick anything

## What to port into the real app

| Mockup part | Where it belongs | Notes |
|---|---|---|
| Colours, type | `web/src/styles/` | See `color-scheme.md`. Fonts: Instrument Serif, Archivo, Mea Culpa (all Google Fonts, free for commercial use) |
| Camera background shader | three.js (0.128, already in the app) | Uniforms are listed in the shader; reads the same camera stream |
| Record carousel + transition | design lane UI over the app shell | Keep every `data-testid` and control (lead's rule). Mode pills must map to the existing mode tabs |
| Hand/head drawing | reads `landmarks` / `signals` from the bus | The mockup runs its own MediaPipe (tasks-vision 1.1.1, same models as the app) only to preview; the real app should draw from the vision module's data, not run a second tracker |
| Reactive values | `songLevels`, `transport`, `analysis` bus topics | The mockup fakes a beat; swap in `songLevels.level` / bands |

Not in this folder on purpose:
- No outside images are committed. The switched-off flower-print record option has an empty image slot for Lalitha's own drawing
- Older experiments (hand-orbit menu, font test pages) stayed on Lalitha's laptop

## Switched-off options still in the file (easy to turn back on)
`compareOriginal` (first wireframe record), `flowerDisc` (flower print record), `clearDisc` (frosted clear vinyl with arched / blurred titles), `shatter` (record breaks apart when selected), per-record ripple, Learn calligraphy ring, `nameStyle` variants (`display`, `rings`, `arc`, `sans`, `serif`, `script`, `block`). The x-ray orchid, record label stipple orchid and original halftone flowers are all code-drawn placeholders.
