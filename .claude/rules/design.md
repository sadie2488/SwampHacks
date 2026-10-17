---
paths:
  - "web/src/ui/**"
  - "web/src/styles/**"
  - "web/src/app/styles.css"
---
# Design lane: it must not look AI-generated

Wait for the human's design inspiration (screenshots, colors, fonts, sites they like) before choosing a look. Then apply it. Avoid the "template" tells:
- No uniform grids of identical cards
- No centered hero with a gradient blob behind it
- No default system fonts as the whole personality; pick and load real fonts that fit the inspiration
- No safe gray-on-white with one blue button
- No stock marketing copy ("Get Started", "Learn more", "Unlock the power of ...")
- Make real decisions about spacing, scale, and contrast, and keep text readable (check contrast)
- Every control keeps its `data-testid` and its label: the lead's browser tests and screen readers depend on them
- Anything unfinished stays visible as a labeled, disabled "coming soon" control
