---
paths:
  - "web/**"
---
# Website (React + Vite)

- Modules under `web/src/modules/<name>/` talk to each other only through the shapes in `contracts/`. Never import another module's internals
- Camera tracking (MediaPipe) runs in a background worker at about 15 fps so the page stays responsive
- Camera and mic need HTTPS (localhost is fine). Assume Chrome
- Notes are concert-pitch MIDI; transpose only when displaying
- Every command also has an on-screen button, so the app works before motion or voice mappings exist
- Anything unfinished stays visible as a labeled, disabled "coming soon" control
- Keep the walking skeleton working: upload, fake analysis, sheet, play/pause/tempo/pitch, command system, TouchDesigner message
