---
paths:
  - "web/src/modules/commands/**"
  - "web/src/modules/mappings/**"
  - "web/src/modules/command-lab/**"
---
# Commands lane (reserved for Veda)

- Veda may change any design detail of this part without approval. If she needs a new signal or control from elsewhere, she asks the main laptop and it is prioritized
- The mapping file is `web/src/modules/mappings/mappings.yaml`; its format is in `docs/commands-guide.md` and `contracts/mapping`
- A typo or unknown name never breaks the app: skip the bad line and show a friendly error in the Command Lab
- Changes apply instantly (hot reload). Two commands fighting over the same signal in the same mode produce a warning
- Support `smoothing`, `cooldown_ms`, `min_confidence`, `range`, `step`, `only_while`, and the four ways: follow, trigger, toggle, nudge
- Both ways of editing must work: the YAML directly (with comments), and plain-English requests to her Claude
