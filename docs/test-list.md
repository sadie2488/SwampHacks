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
| 13 | A made-up **double** clap toggles play and pause; a single clap does nothing (so a desk tap or a drum in the song cannot start the music); a second double clap too fast is ignored (cooldown) | Auto |
| 14 | A voice command only works while the left fist is held ("arming") | Auto (unit test) |
| 15 | Editing `mappings.yaml` and saving changes behaviour instantly, with no reload | Auto |
| 16 | A typo (like `audio.clapp`) shows a friendly message that suggests the right name; every other rule keeps working | Auto |
| 17 | Two rules fighting over the same signal and control show a warning | Auto (unit test) |
| 18 | With a real camera: moving your hand moves its meter, a fist lights its lamp, and tracking is drawn over the video | By hand |
| 19 | With a real mic: a clap, a double clap and a snap each light their own lamp; talking, typing, tapping the desk and the song playing through speakers light none of them; humming moves the pitch meter; saying "slower" while holding the left fist lowers the tempo | By hand |

## 3. Create mode
| # | What should happen | How |
|---|---|---|
| 20 | "Simulate humming" then recording turns the hum into a layer with several notes | Auto |
| 21 | Changing the instrument changes the sound; Add layer, Beat, and layer volume all work | By hand (by ear) |
| 22 | The loop plays all layers together and stops when asked | By hand (by ear) |

## 4. Visuals
| # | What should happen | How |
|---|---|---|
| 23 | Switching "TouchDesigner" on streams about 30 frames a second to the relay | Auto |
| 24 | In TouchDesigner, the numbers move when you clap or move your hand | By hand (needs TouchDesigner) |

## 5. The safety rules
| # | What should happen | How |
|---|---|---|
| 25 | Nobody's Claude can push to `main`, skip checks, or run `rm -rf` | Auto |
| 26 | A commit or pull request that credits an AI (co-author line, "Generated with", AI as author) is rejected | Auto |
| 27 | Git never picks up a `.env` file, and Claude can't read or write it | Auto |
| 28 | A pull request that edits another lane's folders, a lead-only file, a big file, or audio/model files is rejected | Auto |
| 29 | A contract change that removes or narrows something is rejected; adding is fine | Auto |

## 6. Practice, feedback and progress
| # | What should happen | How |
|---|---|---|
| 30 | You can always see yourself: turning the camera on shows your mirrored picture under the buttons on every tab, with dots on your hands. If hand tracking can't load, the picture stays and a plain message says why | Auto (real Chrome with a test camera) |
| 31 | Calibrate: clap along to 6 clicks and the app measures the delay between your clap and what it hears (about 120 ms in the test) | Auto (made-up player); By hand (real mic and headphones) |
| 32 | Practice: playing 10% too slowly gets "dragging", about 90 BPM against 100, with at most 3 issues and something that went well first | Auto |
| 33 | The coaching text arrives in plain words (Gemini, or built-in tips if Gemini or the server is away) and never invents mistakes | Auto (server tests); By hand (read a real one) |
| 34 | "Loop bars 1-2 at 80% speed" sets up the slow loop with one click | Auto |
| 35 | Every practice run is saved and "Your practice so far" shows the runs and whether you are getting steadier | Auto |

## 7. Saving, login and real analysis
| # | What should happen | How |
|---|---|---|
| 36 | Create: a saved track is still there after reloading the page, and loading it brings back its layers | Auto |
| 37 | Login with Auth0 appears only when it is set up. Without it the app looks and works exactly the same | Auto (login hidden); By hand (real login) |
| 38 | Upload a real song (MP3, WAV, FLAC or OGG): it shows its real tempo and key; a single-instrument recording also gets real sheet music; a full band mix shows a warning that the notes may be wrong | By hand (needs a few real songs) |
| 39 | Songs, practice runs and tracks are stored in Tiger Data when it is connected, and in memory (lost on restart) when it is not | Auto (memory); By hand (real database) |
| 40 | A song with loud drums: the app takes the drums out and reads the melody again. A melody with drum hits on every beat gives (nearly) the right notes; a song it still can't read keeps the "may be wrong" warning; plain noise or drums alone still give "no music found" | Auto (made-up drum mixes); By hand (real songs) |

## Not tested yet (later tasks)
Separating every instrument of a song (only the drums are taken out so far), a trained model of our own, deployment, and the final design.
