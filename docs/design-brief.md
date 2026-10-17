# 🎨 Design brief: the look of the website and the TouchDesigner visuals

For whoever is doing the graphic design (Lalitha). Plain words; ask the main laptop (`/ask`) if anything is unclear.

## Where things stand
- The app works but looks plain (a functional skeleton). All features are in; the look is the missing part (task **F1**)
- Three 3D looks were mocked up as real 3D scenes with the app's real labels. Open the pictures in `docs/design-mockups/` (`A-learn.jpg`, `A-play.jpg`, and the same for B and C), or open the `.html` files in Chrome (they show the live 3D scene; add `?screen=play` to the address for the Play screen)
  - **A Firefly Marsh**: night swamp, notes are fireflies on a glowing staff over dark water
  - **B Glass Hall**: brass concert hall, gold ribbons for the staff, light shafts
  - **C Paper Reef**: layered paper cut-outs, bright and easy to read
- **Chosen: Look C (Paper Reef)**, with a calm band behind the staff so the music is easy to read. **Final pick: C1, the solid torn-paper strip** (`C1-learn.jpg`, `C1-play.jpg`; live: `c-paper-reef-calm.html?calm=strip`, add `&screen=play` for Play). C2 (tracing paper) was the other option and is not used

## What you may edit (the design lane)
- `web/src/ui/**` and `web/src/styles/**` (new folders: create them)
- `web/src/app/styles.css` (the current plain styles)
- TouchDesigner files go in `touchdesigner/**`
- Everything else belongs to someone else's lane. Need a change there (for example a new button, or putting the 3D scene on the page from `App.tsx`)? Ask the main laptop with `/ask`. It is a small change and the main laptop makes it

## Rules the design must keep
- **Every button keeps its words and its `data-testid`.** The automatic browser checks (22 of them) and screen readers depend on them. Restyle freely, but don't rename or remove
- Anything unfinished stays visible as a labeled, disabled "coming soon" control
- Keep text readable (check contrast), and give keyboard focus a visible outline
- Respect "reduce motion" (a still version of any animation)
- Keep the 3D light enough that the camera tracking (about 15 frames a second in the background) is not slowed: test with the camera on. If it struggles, simplify the scene or draw it at lower detail
- Chrome is the target browser. Camera and microphone only work on `http://localhost` or HTTPS

## What the 3D scene can react to
The app has an event bus (`web/src/bus/index.ts`, the topic table at the top says who sends what). Useful topics:
- `transport`: playing or not, the song position in seconds, tempo and pitch settings
- `analysis`: the song's notes (pitch, start, length) and tempo, key, time signature
- `pitch` and `performance`: what the microphone hears (note, loudness, when a note starts)
- `landmarks` and `signal`: hand and face positions and the numbers made from them (for example how open the hand is)
Fake data for all of these is built in: open the app at `http://localhost:5173/?fake=1`.

## Using three.js
- It is already installed in `web/` (pinned to version 0.128.0, the same one the mockups use, so your scene looks the same). In code: `import * as THREE from 'three'`
- The mockups are one file each, to copy ideas from. They are not app code
- Keep one canvas behind the controls (`position: fixed; inset: 0`, controls on top), and stop drawing when the tab is hidden

## TouchDesigner
- `touchdesigner/README.md` explains how the numbers reach TouchDesigner (a small relay program) and lists the channels
- Quick start: `node bridge/relay.mjs --log`, open the app, switch "TouchDesigner" on (in the "What's on the stand?" card), then in TouchDesigner add an OSC In CHOP on port `7000`
- You can make visuals that match the website look (same colors and mood), so the two feel like one product

## Getting set up on your own computer
1. Open PowerShell in a folder you own (not `C:\Windows\System32`), then `cd $HOME`
2. `git clone https://github.com/sadie2488/SwampHacks.git` then `cd SwampHacks`
3. Open Claude Code there and type `/start` (it checks what is installed and walks you through)
4. Then `/checkin`, and choose **F1** (the look). Your branch will be named `design/<your name>/F1-look`
5. Before sending anything to the main laptop, run `node scripts/check.mjs` (all must say PASS)
