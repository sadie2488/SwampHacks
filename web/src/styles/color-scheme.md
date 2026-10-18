# Color scheme

The look: bright inks on near-black, laid over the player's own camera picture. Each mode has its own pair of inks, so you can tell where you are at a glance. One cream color is used for all text.

Source of truth for the mockup: the `CONFIG` block in `mockup-v2.html`. When this moves into the app, these become CSS variables in `web/src/styles/`.

## Base colors (every screen)

| Name | Hex | Used for |
|---|---|---|
| Night | `#0b0a0c` | Page background, panel fills (at 50–85% opacity), the "paper" the inks sit on |
| Cream | `#f4e4a1` | All text, outlines, wireframes, pill buttons |
| Paper white | `#f2eee6` | Menu type (big words, corner text, pills): crisper than cream, reads more premium |
| Teal | `#5fe1d6` | Field lines around the selected record (the only cool color, kept for motion lines) |

## Ink pairs (one per screen)

`a` is the main ink: the skeleton guide line, the glow around the chosen record (outer edge only, the centre stays clear), the record's hole ring, the active note, the halftone dots. `b` is the second ink: the offset print layer and the highlight particles.

| Screen | Ink a | Ink b | Feel |
|---|---|---|---|
| Start / loading | Hot pink `#ff2d8a` | Cream `#f4e4a1` | The flower poster |
| Learn | Bright teal `#1fb3bf` | Coral red `#ff4a3d` | Focused, studious (brightened from the coloured-vinyl teal `#2b8a94`) |
| Play | Orange `#ff7a00` | Hot pink `#ff2d8a` | Energetic, stage light |
| Create | Lavender `#c9a8ff` | Bubblegum `#ff4fa3` | Soft, playful |
| Command Lab | Cobalt `#2f5bff` | Amber `#ff9a1f` | Technical, testing |

Moving between screens blends the inks smoothly (about half a second) instead of switching at once.

## Camera background

Musicians watch themselves while they play, so the camera stays clear. The print texture only sits lightly on top.

| Setting | Value | Meaning |
|---|---|---|
| effect | 0.25 | 0 = plain camera, 1 = full halftone print |
| camColor | 0.6 | How much natural color the camera keeps |
| tint | 0.3 | How strongly the current ink pair washes over the camera |
| dim | 0.8 | Camera brightness, lowered so text stays readable |
| vignette | 1.2 | Darker edges so corner labels stay readable |
| dotSize | 4 px | Size of the print dots |
| misregister | 1 px | Offset between the two inks (grows with the beat and the cursor) |
| grain | 0.04 | Film grain |

## Guide line (what the app is following)

- A thin line in ink `a` traces whatever is guiding the app: the hand skeleton on the mode menu, the head outline and a tilt line in Play and Lab
- Width 1.5 px with a soft glow of the same color, so it reads on any camera picture
- A pill label at the top in the same color: "Following your hand". If the hand or head is not seen, the pill turns cream and says "Show your hand"

## Readability rules

Contrast against Night (`#0b0a0c`), by WCAG ratio:

| Color | Ratio | OK for |
|---|---|---|
| Cream | about 15.6 | Any text |
| Teal, Lavender, Amber | about 9–12.5 | Any text |
| Orange, Bubblegum, Coral, Hot pink | about 5.6–7.6 | Any text |
| Bright teal | about 7.6 | Any text |
| Cobalt | about 3.8 | Large text (24 px+) and lines only, never small labels |

- Small text is always Cream
- On the camera picture, text sits on a dimmed area (vignette, or a panel at 50%+ Night) so contrast holds even when the room is bright
- Never put Cobalt text on top of the halftone dots

## Type (goes with the colors)

- Script: Mea Culpa (Google Fonts, free for commercial use; Ballet as backup), only for the Overture logo
- Big words and mode titles: Instrument Serif, uppercase
- Labels and buttons: Archivo, condensed (62–100% width), heavy, uppercase, letter-spaced
- Numbers and big readouts: Instrument Serif
