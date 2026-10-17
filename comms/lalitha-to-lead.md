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
