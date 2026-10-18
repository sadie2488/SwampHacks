Lalitha is starting the full website look (task F1) on her own laptop and will give inspiration websites for me to mock up.

What she is doing
- Redesigning the whole look as a 3D reactive graphics site (award-level art direction, not generic), starting from Paper Reef C1
- Branch: design/lalitha/F1-look
- Folders: web/src/ui/**, web/src/styles/**, web/src/app/styles.css, touchdesigner/**, docs/design-mockups/ (new mockup files)

Please send or do, in this order
1. Push the ~23 unpushed commits (Paper Reef C1 backdrop and layout) so I start from the real look, not the old skeleton
2. Tell me if the design lane may also edit web/src/app/*.tsx for layout and wording, or if you will make those changes on request
3. Anything design-related: fonts, image or texture assets, 3D libraries beyond three.js 0.128.0 (for example post-processing, GSAP, shader helpers), and any installs the lane needs. Package files are lead-only, so please add what is needed and say which versions
4. The current list of data-testid values that must not change, and the 22 browser checks to keep passing
5. Any new bus topics that would help reactive visuals (for example per-band audio levels, which are always 0 now)

I will keep to the avoid list for now: audio-live, mappings, contracts.

---
*2026-10-17 23:36 UTC*

Update from Lalitha (follow-up to my earlier message)

- She needs to be able to replace EVERYTHING in the look: the 3D backdrop scene, all styles, fonts, colors, panel shapes, layout and motion. Paper Reef C1 is not a fixed starting point; the whole look may be swapped. Please log this change in docs/decisions.md (it replaces the Sat 3:15 PM look decision)
- This means the design lane needs write access to the layout and wording files in web/src/app/*.tsx too, not only the styles. The button words and data-testid values stay unchanged so the 22 browser checks keep passing. If you prefer to keep app/*.tsx yours, say so, and tell me how to request layout changes quickly
- Right now she is designing with mockups (inspiration sites, then live 3D mockup pages). Later she will work on the code directly for more advanced graphics. Please make sure her branch design/lalitha/F1-look can push, and that she can run the app and the checks on her laptop
- Same asks as before: push the unpushed commits first, design installs and libraries, the test-id list, and any new live-data topics

---
*2026-10-18 00:40 UTC*

New feature idea from Lalitha: sign-language hand signs to move around the app

Please share this with Veda: it overlaps her command design (play + create) and the vision lane.

The idea
- Each mode has a sign-language letter. Example: hold the ASL letter M to open the menu
- While the sign is held, a ring draws itself clockwise around the hand, starting empty. When the ring closes, that mode opens. Letting go early cancels it (the ring fades back)
- The same sign + ring exits again (hold M to leave, like entering)
- In the menu, the hand works like a pointer: drag through the visuals and select items, similar to how Just Dance / Kinect menus work (hover over an item, a ring fills, it is chosen)

Timing
- Lalitha suggested 4 seconds, "or whatever is optimal". My suggestion: about 2 seconds. Kinect-style hover buttons use about 1.5 to 2 s; 4 s feels slow, especially when exiting. Make it one setting so it can be tuned

Notes for whoever builds it
- Hand landmarks already come from MediaPipe (hand_landmarker, tasks-vision 1.1.1). Static letters like M can be detected from finger positions (rules) or a small classifier on the 21 landmarks; no new model download needed for a first version
- Watch out for look-alike letters: M, N, S, A, E and T are all fist shapes that differ only in where the thumb sits. Require the sign to stay steady (high confidence) for the whole hold, so it doesn't trigger by accident while playing an instrument
- Letters per mode are not chosen yet (Veda / Lalitha to decide). Every sign still needs an on-screen button too (existing rule)
- Design side (Lalitha, design lane): the ring, the hand skeleton line in the mode color, and the "Following your hand" pill are already in her mockup. She can supply the ring's look

Lalitha's mockup status, for your info
- Entrance: x-ray moth orchid that breaks into halftone dots at the edges
- Records menu, clear camera background with a light print texture, skeleton guide line, per-mode colors (documented in web/src/styles/color-scheme.md on branch design/lalitha/F1-look, not pushed yet)
- Everything can be dragged and resized in an Arrange mode while she designs

---
*2026-10-18 00:56 UTC*

App name decided: **Overture**

- Lalitha has chosen the name Overture for the website/app (replaces the placeholder 'Hear Yourself' in her mockup)
- Please log it in docs/decisions.md and tell the team (Sadie, Shayaan, Veda)
- Places that may need it later: page title, header, README, the GoDaddy domain (check if overture-style domains are free), Auth0 app name
- Design lane will use it on the entrance screen in the script font

---
*2026-10-18 03:30 UTC*

## Handoff from Lalitha's laptop: Overture design (mockup + all design research)

Lalitha is moving the design work over to you. Everything is on GitHub on her branch:
**`design/lalitha/F1-look`** (commit 883dad2, 4 files, all inside the design lane, checked with branch-scope.mjs).

### What's in it
- `web/src/ui/mockups/overture-mockup.html`: the full working mockup (one self-contained page, everything editable from a `CONFIG` block). Her current arrangement is baked in as the defaults
- `web/src/ui/mockups/README.md`: how to open it, what each screen does, what to port into the real app, what's switched off
- `web/src/styles/design-principles.md`: all design research and decisions (principles of design, eye-tracking, audiovisual sync points / synchresis, optical centre, Grail analysis, the "restraint" self-critique and fixes, corner jobs, type choices, record style, reference board)
- `web/src/styles/color-scheme.md`: colours, per-mode inks, readability table, type

### Decisions to log (docs/decisions.md)
- Name: **Overture** (sent earlier)
- Learn colour changed to bright teal `#1fb3bf` (from vinyl reference); menu type is paper white `#f2eee6`
- Fonts: Instrument Serif (big words, titles), Archivo (labels), Mea Culpa (script, Overture logo only). All Google Fonts, free for commercial use. The app currently links Bricolage Grotesque + DM Mono: these would need adding/swapping in `web/index.html` (lead-owned)
- Entrance: chrysanthemums drawn as type marks, bloom (closed to open, constant size) as the cursor nears Enter
- Menu: record carousel; all records share one style (frosted mode-colour vinyl, giant stacked letters cut out of the frost); Grail-style giant words around the chosen record (one behind, one in front, alternating sides); quiet menu look (camera dark + soft focus); one job per corner; no counters/numbers
- Click: ripple + record rushes forward, mode shown through the hole
- Hand guide drawn as dots, head as outline; **motion controls OFF** for now (visual only)
- All flowers are placeholders: **Lalitha will hand-draw them** once the design is final

### Notes / asks
- The mockup is a design reference, not app code. When porting: keep every data-testid and control; draw hand/head from the vision module's bus data instead of running a second MediaPipe; drive motion from `songLevels` / `transport`
- Reference images (other artists' work) were deliberately NOT committed
- No PR opened (no GitHub CLI here). Her branch is ready if you want to open one or pull it locally
- The sign-language mode-switch idea from earlier is still open (hold a sign, ring fills, ~2 s)
