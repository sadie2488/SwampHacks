# ⭐ Things only humans can do

These show up in everyone's ⭐ box until done. Tell the main laptop when you finish one (`/handback` or `/ask`).

| Status | Task | Urgency |
|---|---|---|
| ☐ | Sponsor accounts + keys (Vultr first) | 🔴 |
| ☐ | Record test clips | 🔴 |
| ☐ | Sadie: Gmail app password for the email relay | 🔴 |
| ☐ | Approve the first tests | 🟠 |
| ☐ | Design inspiration | 🟠 |
| ☐ | TouchDesigner visuals | 🟡 |
| ☐ | Pick the demo song + instrument | 🟡 |

---

## 🔑 Sponsor accounts (`/explain accounts`)
**Golden rule: never paste a key into chat, email, or any file in this repo.** Keys go only into the private `.env` file on the machine that needs them — type them in yourself.

- **Vultr** (hosting + storage): sign up at vultr.com (check the hackathon for a credit code). Create **Object Storage** (for datasets and models) and note its access keys
- **Tiger Data** (database): sign up at the Tiger Data console, create a service, copy its connection string
- **Gemini** (coaching text): get an API key from Google AI Studio
- **GoDaddy** (domain): claim/register the domain via the hackathon's GoDaddy offer
- **Auth0** (login, added last): create a tenant and a "Single Page Application"; we'll add callback URLs later

## 🎥 Test clips (`/explain clips`)
Short clips let the app test camera and mic features automatically, without someone standing in front of a camera.
- Each clip ~5–10 seconds, laptop webcam or phone is fine
- **Privacy**: hands-only framing where possible. Clips are stored in Vultr storage, **not** in this public repo
- Name files like `vision_fist_01.mp4`, `audio_clap_01.wav`

**Camera clips**
- Open palm · fist · one hand raised · pinch (thumb + index) · both hands moving apart/together
- Head tilt left · head tilt right · nod (face visible is OK for these)
- Drum-hit motion (hitting an invisible drum)
- 10 s of "nothing happening" (hands still) — important for testing false triggers

**Audio clips** (quiet room if possible, plus one noisy version of each)
- Spoken words: "play", "pause", "slower", "faster", "higher", "lower" (each ~3 times)
- Snap · clap · 10 s of humming a simple tune
- 20–30 s of the demo instrument playing along with a metronome (once the demo song is picked)
- 10 s of room silence

## ✅ Approving tests (`/explain approve`)
- The main laptop writes what each feature should do as a short plain-English list
- Read it and reply "approved" or suggest changes. No code reading needed

## 🎨 Design inspiration
- Screenshots, mood boards, colors, fonts, websites or art you like — anything visual
- Drop them in the team chat or email; the main laptop will collect them

## 🌈 TouchDesigner visuals
- Built by hand in TouchDesigner. The app will stream music and hand data to it (task C3)

## 🎼 Demo song + instrument
- Pick a public-domain or self-recorded song and the instrument for the demo (clarinet or trombone recommended for pitch feedback)
