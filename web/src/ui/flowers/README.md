# Flowers (placeholders)

Every flower in the app lives in this folder. They are **placeholders** drawn by code (`make-placeholders.mjs`,
`make-orchid.mjs`) from the Overture mockup's own flower shapes. Lalitha will replace them with hand-drawn
flowers. No outside artwork is used here.

| Files | Where they show |
|---|---|
| `chrysanthemum-a/`, `chrysanthemum-b/`, `chrysanthemum-c/` | The entrance spray |
| `bud/` | The entrance spray (small buds) |
| `orchid-stipple.svg` | The dotted flower printed on every record in the mode menu |
| `sections/<section>/` | One flower per section (placeholders by `make-sections.mjs`): menu chrysanthemum, learn forget-me-not, play bird of paradise, create sweet pea, lab iris |
| `drawn/` | Lalitha's hand-drawn section flowers (PNG). Anything here wins over `sections/` |

`index.ts` lists the entrance flowers, `sections.ts` the section flowers and their inks. `web/src/ui/overture/spray.ts`
lists where each entrance flower sits and how big it is.

## Hand-drawn section flowers (drop-in)

1. Draw on a 2048 x 2048 transparent canvas, flower centre exactly in the middle (it lines up with the record hole),
   pure black line about 14 px. Any other black area can go in a second "fill" file
2. Export PNGs named `<section>-<flower>-<state>.png`, plus optional `<section>-<flower>-<state>-fill.png`.
   Sections: `menu`, `learn`, `play`, `create`, `lab`. States: `closed`, `half`, `open`.
   Example: `learn-forgetmenot-open.png`, `learn-forgetmenot-open-fill.png`
3. Put them in `drawn/`. That is all: the app picks them up on the next build, tints the line with the section's main
   ink and the fill with its second ink (once, into a small picture, so it stays fast). A missing state keeps its
   placeholder. Keep each PNG under about 300 KB (flat black compresses well)

## The three states

Each flower folder holds three files, one per state, all drawn at the **same outer size**:

- `closed.svg`: the tight ball / bud
- `half.svg`: the outer petals open
- `open.svg`: fully open, centre showing

The app only fades between these pictures (nothing is redrawn while it animates):
- Entrance: as the pointer nears the Enter button, closed -> half -> open
- In a mode: on a strong beat (at most once per bar) the flower flicks open in about 0.12 s and settles back in about 0.6 s

## How to swap in a hand-drawn flower

1. Draw the three states in any tool. Export each as SVG (or PNG) with a **square** canvas, the flower centred and
   filling it, the same size in all three
2. Replace `closed.svg`, `half.svg` and `open.svg` in the flower's folder (keep the names), or add a new folder and
   list it in `index.ts`
3. The record orchid is one file; anything coloured `currentColor` takes the record's mode colour
4. Keep each file small (under about 100 KB) so the page stays quick: merge shapes into a few paths if you can
5. `node web/src/ui/flowers/make-placeholders.mjs` regenerates the placeholders (it overwrites them, so do not run it
   once the hand-drawn ones are in)
