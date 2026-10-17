# ✅ Tests to approve (plain English)

The main laptop wrote these. Read them and reply **"approved"** (or tell it what to change). No code reading needed. Once approved, the test code mirrors this list exactly, and no AI gets to edit the tests that grade its own work.

"Auto" = a computer checks it every time (`node scripts/e2e.mjs` runs the browser ones). "By hand" = a person needs to try it on a real laptop (camera, mic, speakers).

## 1. The walking skeleton (due 9:30 AM)
| # | What should happen | How |
|---|---|---|
| 1 | Open the site: four tabs show (Learn, Play, Create, Command Lab) | Auto |
| 2 | Click "Use demo song": it shows 100 BPM, C major, 4/4 | Auto |
| 3 | Sheet music appears with all 42 melody notes drawn | Auto |
| 4 | Click Play: the song plays and the time counter moves | Auto |
| 5 | Click "slower": speed shows 0.9x, the song keeps playing, and time moves at 0.9 speed | Auto |
| 6 | Click "pitch up": it shows +1 and the engine really shifts | Auto |
| 7 | Click Pause: the song stops and the time holds still. Loop switches on and off | Auto |
| 8 | If the server is off, the demo still works and says "using the built-in demo" | Auto |
| 9 | Sound: slowing down does not make the song sound lower or "chipmunk" when speeding up | By hand (and the engine's pitch is measured in a unit test) |
| 10 | Uploading your own song file shows the (made-up) analysis and plays your file | By hand |

## 2. Veda's parts: commands and the Command Lab
| # | What should happen | How |
|---|---|---|
| 11 | The Lab lists every signal and every control from the catalogs | Auto |
| 12 | Moving a made-up hand slider changes the tempo through the mapping file; moving it back restores it | Auto |
| 13 | A made-up clap toggles play and pause; a second clap too fast is ignored (cooldown) | Auto |
| 14 | A voice command only works while the left fist is held ("arming") | Auto (unit test) |
| 15 | Editing `mappings.yaml` and saving changes behaviour instantly, with no reload | Auto |
| 16 | A typo (like `audio.clapp`) shows a friendly message that suggests the right name; every other rule keeps working | Auto |
| 17 | Two rules fighting over the same signal and control show a warning | Auto (unit test) |
| 18 | With a real camera: moving your hand moves its meter, a fist lights its lamp, and tracking is drawn over the video | By hand |
| 19 | With a real mic: a clap and a snap each light their own lamp; humming moves the pitch meter; saying "slower" while holding the left fist lowers the tempo | By hand |

## 3. Create mode
| # | What should happen | How |
|---|---|---|
| 20 | "Simulate humming" then recording turns the hum into a layer with several notes | Auto |
| 21 | Changing the instrument changes the sound; Add layer, Beat, and layer volume all work | By hand (by ear) |
| 22 | The loop plays all layers together and stops when asked | By hand (by ear) |

## 4. Visuals
| # | What should happen | How |
|---|---|---|
| 23 | Turning on "Send to TouchDesigner" streams about 30 frames a second to the relay | Auto |
| 24 | In TouchDesigner, the numbers move when you clap or move your hand | By hand (needs TouchDesigner) |

## 5. The safety rules
| # | What should happen | How |
|---|---|---|
| 25 | Nobody's Claude can push to `main`, skip checks, or run `rm -rf` | Auto |
| 26 | A commit or pull request that credits an AI (co-author line, "Generated with", AI as author) is rejected | Auto |
| 27 | Git never picks up a `.env` file, and Claude can't read or write it | Auto |
| 28 | A pull request that edits another lane's folders, a lead-only file, a big file, or audio/model files is rejected | Auto |
| 29 | A contract change that removes or narrows something is rejected; adding is fine | Auto |

## Not tested yet (later tasks)
Real song analysis, feedback and Gemini coaching, saving and replaying creations, login, deployment, and the final design.
