# Design principles for Overture

Short notes from design research, and how each one applies to Overture. Overture is an audiovisual experience: what you see should move with what you hear. The colors in `color-scheme.md` are fixed unless Lalitha changes them.

## Principles of design

| Principle | What it means | In Overture |
|---|---|---|
| Contrast | Things that differ (light and dark, big and small, still and moving) stand out | The thing you should look at is the highest-contrast thing on screen: the chosen record's name, the Enter button |
| Hierarchy | Order things by importance so they are read in sequence | 1. Title or record name  2. The record or flowers  3. Small labels and grooves. Grooves are deliberately quieter than the record name |
| Emphasis / focal point | One element breaks the pattern, so the eye lands there first | Only the chosen record keeps its colour; the others go grey and rest. If everything is loud, nothing is |
| Movement / leading lines | Lines, repetition and motion pull the eye along a path | The flower stems lead from the blooms toward the title. The blooms open toward the Enter button, so the cursor is "rewarded" for moving there |
| Balance | Visual weight spread so the page feels stable (it doesn't have to be symmetrical) | Heavy flower cluster on the right, title and button on the left |
| Rhythm / repetition | Repeated elements with a beat | Grooves, type marks, dots. On the beat, things pulse together |
| Unity | Everything feels like one product | One set of fonts and one color pair per screen. Dots, type marks and grain show up everywhere |
| White space | Empty space isolates and frames | Keep the dark area around the title empty, so the title stays the first thing seen |

## Elements of design

Line, shape, color, value (light or dark), texture, space and type. Value contrast (light against dark) pulls the eye more reliably than hue (which color). A pale element on near-black always wins.

## Where eyes go (eye-tracking findings)

- **Contrast, position, isolation and white space** pull attention more than size alone. A huge but low-contrast element can be ignored. Treat the stronger "small contrast always beats big" claims as rules of thumb, not proven fact
- **People look top-left first** on desktop, and top first on phones. The title sits on the left
- **First impressions form in under 0.2 seconds**, and the eye settles on the most important area within about 2–3 seconds. The entrance has to read instantly
- **Motion grabs attention**, but people learn to ignore constant decorative motion, as they do with web banners. Keep strong motion for things that matter. Background motion stays slow (the record spin, the flower sway)

## Audiovisual design (sound and image together)

- **Synchresis** (Michel Chion): when a sound and a visual change happen at the same moment, the brain fuses them into one event. It's automatic, which makes it powerful
- **Sync points:** pick key moments (beat, note start, clap) where picture and sound lock together hard, such as a pulse, a ripple or the ink layers slipping
- **Avoid "mickey-mousing":** don't make every visual react to every sound. Let most motion drift freely, and meet the music at the sync points
- **Added value:** visuals can make sound feel bigger, faster or softer. Big beats get big, short visual hits. Quiet passages get slow drift

## Decisions (Lalitha)

- **Different flowers on purpose:** each screen can use its own flower (chrysanthemums on the entrance, orchids on the record labels). The menu screen's shared look (records, colors, type) is what ties them together
- **Name:** Overture
- **Motion controls are off for now:** hand and head are drawn but control nothing while the design is being finalised
- **The flowers are placeholders:** they are drawn by code for now. Once the design is final and the work moves on to motion, Lalitha will hand-draw every flower and they will replace the coded ones

## Restraint (our self-critique, and what we changed)

The most premium-feeling sites are restrained: one object, one colour story, one font pair, a quiet background. Our first menu had strong ideas but all of them were switched on at once. Fixes applied (the "quiet menu" pass):

1. **Background steps back on the menu:** the camera goes dark, soft-focus and almost colourless there. It comes back clear inside a mode, where seeing yourself matters
2. **Fewer competing things:** no micro-text grid, particles, cursor smoke or scanlines on the menu. Tools are small and faint
3. **One colour at a time:** only the chosen record shows its colour. Menu type is a crisp off-white `#f2eee6`
4. **Three fonts total:** a big serif (Instrument Serif) for big words, one sans (Archivo) for labels, the script (Mea Culpa) only for the Overture logo
5. **The hero object reads as physical:** the chosen record is flatter, bigger and casts a soft shadow
6. **One margin (28 px)** for every menu element
7. **Motion only where it means something:** only the chosen record turns; words slide in on change; everything else is still

## Words around the object

- **Giant words wrapped around the chosen record:** one line behind it, one in front, so record and words weave together in depth
- **Extreme size contrast:** giant title lines, one medium headline, everything else tiny. Almost nothing mid-sized
- **A quiet frame:** small corner text, one thin rule across the page
- **Animation:** title lines slide in on change, staggered. No counters or numbers

## Placement rules we use for words around a record

- **Anchor to the subject, not the screen:** lines are measured from the chosen record's centre
- **A small, deliberate offset:** each line sits about 1/8 of the record's width off its centre, enough to read as intentional asymmetry while the pair still feels centred
- **Optical centre:** the eye reads the true middle as slightly low, so the pair is centred about 6% of the record's height above its middle (top line over the upper third, bottom line across the lower third)
- **Alternate sides** record to record so moving through them zig-zags; each line enters from the side it leans towards

## Corners: one job each

- Top-left = **information** (what the chosen mode is). Bottom-left = **the one instruction**. Bottom-right = **control** (pills). Top-right = **tools**
- Two groups in opposite corners balance each other across the central record (diagonal balance). Stacking everything in one corner tips the composition
- **Filler must be decoration, never more instructions:** e.g. the tiny music staff above the pills (no words, no numbers)

## Type choices (and how we picked them)

- **Script:** Mea Culpa (picked after comparing 28 free scripts side by side; Ballet as backup). Many free-font sites offer fonts for personal use only: check the licence before using any font on the public site
- **Big words:** Instrument Serif (tall, high contrast)
- **Labels and record letters:** Archivo
- Tried and parked: Cinzel Decorative (tall swashy capitals), Grenze Gotisch (spiky calligraphy ring), Bodoni Moda

## Records: the final style

Frosted, semi-transparent vinyl in the mode colour; huge stacked letters cut out of the frost so the record itself (colour, grooves, dotted flower) shows through unfiltered; gray instead of white; no glow; see-through hole. Earlier record experiments (wireframe, grunge paper label, clear vinyl, flower print, shatter, ripples) are kept switched off in the mockup.

## Checklist before changing a screen

1. What should the eye land on first? Is it the highest-contrast thing?
2. Is anything else competing (another glow, another bright color, fast motion)?
3. Does the motion lead toward the action (the button, the chosen record)?
4. Are the strong visual hits tied to sound moments, and not constant?
5. Do decorative details (grooves, grain, small labels) stay quieter than the content?

## Sources

- Uxcel: [Optical center](https://app.uxcel.com/courses/design-composition/dc--lesson-030/optical-center-7764)
- The Paper Mill Store: [Designing using visual center](https://blog.thepapermillstore.com/designing-using-visual-center/)

- Kittl: [12 principles of design](https://kittl.com/blogs/the-12-principles-of-design/)
- Made Good Designs: [The principles of design explained](https://madegooddesigns.com/design-principles/)
- The Next Web: [Eye tracking can improve webpage design](https://thenextweb.com/news/eyetracking-can-improve-webpage-design)
- Quicksprout: [Eye tracking studies](https://www.quicksprout.com/eye-tracking-studies/)
- Missouri S&T: [First impressions form quickly on the web](https://news.mst.edu/?p=4057)
- Sonicfield: [Synchresis](https://sonicfield.org/wiki/synchresis), [Point of synchronization](https://sonicfield.org/wiki/point-of-synchronization)
- Animation Studies: [Synchronization and synchresis: avoiding mickey-mousing](https://blog.animationstudies.org/synchronization-and-synchresis-avoiding-mickey-mousing-in-sound-design/)
- Chrysanthemum blooming: USPTO plant patent descriptions, for example [PP25879](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/PP25879)
