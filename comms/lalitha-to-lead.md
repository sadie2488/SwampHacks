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
