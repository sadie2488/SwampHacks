"""Tests for melody.py. Audio is synthesized here, never read from files."""
import itertools
import json
import time
from pathlib import Path

import pytest

pytest.importorskip("librosa")
np = pytest.importorskip("numpy")
jsonschema = pytest.importorskip("jsonschema")

from analysis import melody

SR = 22050
ROOT = Path(__file__).resolve().parents[2]
BPM = 100
BEAT = 60.0 / BPM


def load_twinkle():
    doc = json.loads((ROOT / "fixtures" / "song-analysis" / "twinkle.json").read_text(encoding="utf-8"))
    return [(n["pitch"], n["onset_beat"], n["duration_beat"]) for n in doc["parts"][0]["notes"]]


def synth(
    notes,
    bpm=BPM,
    *,
    gap=0.03,
    vibrato_hz=0.0,
    vibrato_cents=0.0,
    detune_cents=None,
    scatter_cents=None,
    glide_sec=0.0,
    harmonics=(1.0, 0.5, 0.33, 0.25, 0.15),
    lead_in=0.0,
    tail=0.4,
    seed=1,
    attack=0.015,
    tremolo_hz=0.0,
    tremolo_depth=0.0,
    breath=0.0,
    ramps=True,
    scoop=0.0,
    scoop_sec=0.08,
):
    """A harmonic tone for each (midi, onset_beat, duration_beat), with a short attack and release.

    `detune_cents(t)` is added to every pitch (a flat or drifting player); `scatter_cents[i]` detunes
    note i; `glide_sec` slides into a note from the previous one when they touch (`gap=0`);
    `ramps=False` leaves out the attack and release between touching notes (no loudness dip);
    `scoop` makes every note start that many semitones flat and slide up into tune.
    """
    spb = 60.0 / bpm
    end = max(o + d for _, o, d in notes) * spb + lead_in + tail
    n = int(end * SR)
    t = np.arange(n) / SR
    track = np.zeros(n)
    amp = np.zeros(n)
    previous = None
    for i, (midi, onset, length) in enumerate(notes):
        a = int((onset * spb + lead_in) * SR)
        b = int(((onset + length) * spb + lead_in - gap) * SR)
        pitch = np.full(b - a, float(midi))
        if scatter_cents is not None:
            pitch += scatter_cents[i] / 100.0
        if scoop:
            g = min(int(scoop_sec * SR), b - a)
            pitch[:g] = np.linspace(midi - scoop, midi, g)
        if glide_sec and previous is not None and previous[1] == a:
            g = min(int(glide_sec * SR), b - a)
            pitch[:g] = np.linspace(previous[0], pitch[g - 1], g)
        track[a:b] = pitch
        env = np.ones(b - a)
        up, down = min(int(attack * SR), b - a), min(int(0.02 * SR), b - a)
        if ramps or i == 0:
            env[:up] = np.linspace(0, 1, up)
        if ramps or i == len(notes) - 1:
            env[-down:] = np.minimum(env[-down:], np.linspace(1, 0, down))
        amp[a:b] = env * (0.6 + 0.3 * ((i * 7) % 5) / 4)
        previous = (pitch[-1], b)
    # hold the last pitch through silences so the phase stays smooth
    held = np.maximum.accumulate(np.where(amp > 0, np.arange(n), 0))
    track = track[held]
    cents = np.zeros(n)
    if vibrato_cents:
        cents += vibrato_cents * np.sin(2 * np.pi * vibrato_hz * t)
    if detune_cents is not None:
        cents += detune_cents(t)
    freq = 440.0 * 2.0 ** ((track + cents / 100.0 - 69.0) / 12.0)
    phase = 2 * np.pi * np.cumsum(freq) / SR
    y = np.zeros(n)
    for h, a_h in enumerate(harmonics, start=1):
        y += np.where(h * freq < SR / 2, a_h * np.sin(h * phase), 0.0)
    rng = np.random.default_rng(seed)
    if tremolo_depth:
        amp = amp * (1 - tremolo_depth * (0.5 + 0.5 * np.sin(2 * np.pi * tremolo_hz * t)))
    y = y * amp * 0.3 + breath * amp * rng.normal(0, 0.3, n)
    return (y + rng.normal(0, 0.0005, n)).astype(np.float32)


def truth_of(notes, bpm=BPM, lead_in=0.0):
    """(pitch, onset_sec, onset_beat, duration_beat) for each synthesized note."""
    spb = 60.0 / bpm
    return [(p, o * spb + lead_in, o, d) for p, o, d in notes]


def score(found, truth, tol=0.05):
    """Note-level precision and recall: right pitch and onset within `tol` seconds."""
    used = set()
    hits = 0
    for pitch, onset, *_ in truth:
        for i, n in enumerate(found):
            if i not in used and n["pitch"] == pitch and abs(n["onset_sec"] - onset) <= tol:
                used.add(i)
                hits += 1
                break
    return hits / max(len(found), 1), hits / len(truth)


def beats_match(found, truth):
    """Same notes, and onsets and lengths in beats exactly on the expected grid positions."""
    return len(found) == len(truth) and all(
        n["pitch"] == p
        and n["onset_beat"] == pytest.approx(o, abs=1e-4)
        and n["duration_beat"] == pytest.approx(d, abs=1e-4)
        for n, (p, _, o, d) in zip(found, truth)
    )


def run(notes, **kw):
    bpm = kw.pop("bpm", BPM)
    beats = kw.pop("beats", None)
    grid = kw.pop("grid", "auto")
    return melody.extract_melody(synth(notes, bpm=bpm, **kw), SR, bpm, beats, grid=grid)


def report(name, found, truth):
    p, r = score(found, truth)
    print(f"[melody] {name}: precision {p:.3f} recall {r:.3f} ({len(found)} found, {len(truth)} expected)")
    return p, r


@pytest.fixture(scope="module")
def twinkle():
    return load_twinkle()


def test_twinkle_exact(twinkle):
    found = run(twinkle)
    truth = truth_of(twinkle)
    assert report("clean", found, truth) == (1.0, 1.0)
    assert beats_match(found, truth)


def test_twinkle_with_vibrato(twinkle):
    # 5 Hz vibrato swinging 50 cents either side of the note (100 cents peak to peak)
    found = run(twinkle, vibrato_hz=5.0, vibrato_cents=50.0)
    truth = truth_of(twinkle)
    assert report("vibrato 5 Hz, 50 cents", found, truth) == (1.0, 1.0)
    assert beats_match(found, truth)


def test_twinkle_30_cents_flat(twinkle):
    found = run(twinkle, detune_cents=lambda t: np.full_like(t, -30.0))
    truth = truth_of(twinkle)
    assert report("30 cents flat", found, truth) == (1.0, 1.0)
    assert beats_match(found, truth)


def test_twinkle_drifting_singer(twinkle):
    last = 47 * BEAT
    found = run(twinkle, detune_cents=lambda t: 40.0 * np.clip(t / last, 0, 1))
    truth = truth_of(twinkle)
    assert report("drift from in tune to 40 cents sharp", found, truth) == (1.0, 1.0)
    assert beats_match(found, truth)


def test_drifting_singer_with_scattered_intonation(twinkle):
    # in tune at the start, 48 cents sharp at the end, and each note up to 28 cents off on its own:
    # without following the drift, the last notes would round to the wrong semitone
    last = 47 * BEAT
    scatter = np.clip(np.random.default_rng(4).normal(0, 14, len(twinkle)), -28, 28)
    found = run(twinkle, scatter_cents=scatter, detune_cents=lambda t: 48.0 * np.clip(t / last, 0, 1))
    truth = truth_of(twinkle)
    assert report("drift to 48 cents sharp, scattered", found, truth) == (1.0, 1.0)
    assert beats_match(found, truth)


def test_sharp_singer_with_scattered_intonation(twinkle):
    # 38 cents sharp on average and each note about 15 cents off on its own (at most 32): rounding
    # without removing the sharpness would get several of these notes wrong
    scatter = 38 + np.clip(np.random.default_rng(9).normal(0, 15, len(twinkle)), -32, 32)
    assert (scatter > 53).sum() >= 5
    found = run(twinkle, scatter_cents=scatter)
    truth = truth_of(twinkle)
    assert report("38 cents sharp, scattered", found, truth) == (1.0, 1.0)
    assert beats_match(found, truth)


def test_singer_scooping_into_every_note(twinkle):
    scatter = np.clip(np.random.default_rng(5).normal(0, 12, len(twinkle)), -25, 25) - 20  # a bit flat
    found = run(twinkle, scoop=2.0, scoop_sec=0.09, scatter_cents=scatter, vibrato_hz=5.5, vibrato_cents=30.0)
    truth = truth_of(twinkle)
    assert report("scoops, flat, scattered, vibrato", found, truth) == (1.0, 1.0)
    assert beats_match(found, truth)


def test_gaps_and_repeated_notes():
    phrase = [
        (64, 0, 0.5), (64, 0.5, 0.5), (64, 1, 1),  # E struck three times
        (67, 3, 1),  # after a full beat of rest
        (67, 4, 0.5), (65, 4.5, 0.5), (65, 5.0, 0.5),  # G, F, F
        (60, 6.0, 2),  # after half a beat of rest
        (60, 8.5, 0.5), (60, 9, 0.5), (62, 9.5, 0.5), (64, 10, 2),  # C C D E after half a beat of rest
    ]
    found = run(phrase)
    truth = truth_of(phrase)
    assert report("gaps and repeated notes", found, truth) == (1.0, 1.0)
    assert beats_match(found, truth)
    for a, b in itertools.pairwise(found):
        assert a["onset_beat"] + a["duration_beat"] <= b["onset_beat"] + 1e-9
        assert a["onset_sec"] + a["duration_sec"] <= b["onset_sec"] + 1e-9


def test_glide_between_two_notes():
    phrase = [(60, 0, 2), (64, 2, 2), (60, 4, 2)]
    for glide in (0.06, 0.12, 0.25):
        found = run(phrase, gap=0.0, glide_sec=glide)
        assert [n["pitch"] for n in found] == [60, 64, 60]  # no passing notes
        assert [n["onset_beat"] for n in found] == [0, 2, 4]
    report("glide", found, truth_of(phrase))


def test_legato_scale_without_loudness_dips():
    scale = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60]
    for unit in (0.5, 0.25):  # eighths and sixteenths at 100 BPM, no breaks between notes
        phrase = [(p, i * unit, unit) for i, p in enumerate(scale)]
        found = run(phrase, gap=0.0, ramps=False)
        truth = truth_of(phrase)
        assert report(f"legato scale, {unit} beat notes", found, truth) == (1.0, 1.0)
        assert beats_match(found, truth)


def test_held_notes_with_wide_vibrato_stay_whole():
    phrase = [(60, 0, 4), (64, 4, 4), (62, 8, 4), (65, 12, 4)]
    for hz, cents in ((4.5, 70.0), (5.5, 50.0), (7.0, 50.0)):
        found = run(phrase, vibrato_hz=hz, vibrato_cents=cents)
        assert [n["pitch"] for n in found] == [60, 64, 62, 65]


def test_tremolo_breath_and_slow_attack(twinkle):
    truth = truth_of(twinkle)
    for name, kw in (
        ("tremolo 5 Hz", {"tremolo_hz": 5.0, "tremolo_depth": 0.6}),
        ("breath noise", {"breath": 0.3}),
        ("slow attack", {"attack": 0.08}),
    ):
        found = run(twinkle, **kw)
        assert report(name, found, truth) == (1.0, 1.0)


def test_low_and_high_register():
    low = [(40, 0, 1), (43, 1, 1), (45, 2, 1), (47, 3, 1), (48, 4, 1), (47, 5, 1), (45, 6, 1), (40, 7, 2)]
    high = [(84, 0, 1), (88, 1, 1), (91, 2, 1), (93, 3, 1), (91, 4, 1), (88, 5, 1), (84, 6, 2)]
    weak_fundamental = (0.15, 1.0, 0.8, 0.5, 0.3)
    for name, phrase, kw in (
        ("low register", low, {}),
        ("low register, weak fundamental and breath", low, {"harmonics": weak_fundamental, "breath": 0.3}),
        ("high register", high, {}),
        ("high register, odd harmonics only", high, {"harmonics": (1.0, 0.0, 0.5, 0.0, 0.3)}),
    ):
        found = run(phrase, **kw)
        truth = truth_of(phrase)
        assert report(name, found, truth) == (1.0, 1.0)


def test_octave_fix_one_note_up_and_two_notes_down():
    def line(pitches):
        return [{"start": i * 0.6, "end": i * 0.6 + 0.5, "pitch": p} for i, p in enumerate(pitches)]

    assert [n["pitch"] for n in melody._fix_octaves(line([60, 72, 62, 64]))] == [60, 60, 62, 64]
    assert [n["pitch"] for n in melody._fix_octaves(line([60, 48, 50, 62]))] == [60, 60, 62, 62]
    # a real octave leap up that stays there is left alone
    assert [n["pitch"] for n in melody._fix_octaves(line([60, 72, 72, 74]))] == [60, 72, 72, 74]


def test_octave_errors_from_the_tracker_are_fixed(monkeypatch, twinkle):
    """Make the pitch tracker slip by an octave and check the whole pipeline puts it right."""
    notes = twinkle[:12]
    real_track = melody._track
    seconds = melody.HOP / SR

    def slipping_tracker(audio):
        midi, prob, env = real_track(audio)
        midi = midi.copy()
        midi[: int(0.2 / seconds)] -= 12  # the very start of the first note an octave too low
        midi[int(1.8 / seconds) : int(2.37 / seconds)] += 12  # a whole note an octave too high
        midi[int(3.0 / seconds) : int(3.23 / seconds)] -= 12  # the start of a note an octave too low
        midi[int(4.8 / seconds) : int(5.97 / seconds)] -= 12  # two notes in a row an octave too low
        return midi, prob, env

    monkeypatch.setattr(melody, "_track", slipping_tracker)
    found = melody.extract_melody(synth(notes), SR, BPM)
    assert [n["pitch"] for n in found] == [p for p, *_ in notes]


def test_triplet_grid_is_chosen_for_triplets():
    third = 1.0 / 3.0
    pitches = [60, 62, 64, 65, 67, 65, 64, 62, 60, 62, 64, 65]
    phrase = [(p, i * third, third) for i, p in enumerate(pitches)]  # three notes to every beat
    found = run(phrase, gap=0.02)
    assert [n["pitch"] for n in found] == pitches
    expected = [i * third for i in range(len(pitches))]
    assert [n["onset_beat"] for n in found] == pytest.approx(expected, abs=1e-4)
    forced = run(phrase, gap=0.02, grid="sixteenth")
    assert all(abs(n["onset_beat"] * 4 - round(n["onset_beat"] * 4)) < 1e-6 for n in forced)


def test_beats_give_the_grid_origin(twinkle):
    lead_in = 0.5
    beats = [lead_in + k * BEAT for k in range(48)]
    y = synth(twinkle, lead_in=lead_in)
    found = melody.extract_melody(y, SR, BPM, beats)
    truth = truth_of(twinkle, lead_in=lead_in)
    assert score(found, truth) == (1.0, 1.0)
    assert beats_match(found, truth)
    assert beats_match(melody.extract_melody(y, SR, BPM), truth)  # without beats, the first note is beat 0


def test_notes_before_the_first_beat_keep_beats_positive(twinkle):
    beats = [BEAT + k * BEAT for k in range(48)]  # the first beat the tracker found is the second note
    found = melody.extract_melody(synth(twinkle), SR, BPM, beats)
    assert min(n["onset_beat"] for n in found) >= 0
    assert [n["onset_beat"] for n in found[:3]] == [0, 1, 2]  # the origin moved back one whole beat


def test_silence_and_noise_do_not_crash():
    rng = np.random.default_rng(3)
    for y in (np.zeros(SR * 3, dtype=np.float32), rng.normal(0, 0.1, SR * 4).astype(np.float32)):
        try:
            found = melody.extract_melody(y, SR, BPM)
        except melody.AnalysisError as err:
            assert "melody" in str(err) or "silent" in str(err)
        else:
            assert found == []


def test_too_short_audio_is_a_plain_error():
    with pytest.raises(melody.AnalysisError, match="too short"):
        melody.extract_melody(np.zeros(100, dtype=np.float32), SR, BPM)


def test_other_sample_rate_and_stereo(twinkle):
    import librosa

    notes = twinkle[:12]
    y = synth(notes)
    stereo = librosa.resample(np.stack([y, y * 0.5]), orig_sr=SR, target_sr=44100)
    for audio in (stereo, stereo.T):  # channels first or last
        found = melody.extract_melody(audio, 44100, BPM)
        assert score(found, truth_of(notes)) == (1.0, 1.0)


def test_only_the_first_part_of_a_long_file_is_used(twinkle):
    found = melody.extract_melody(synth(twinkle), SR, BPM, max_seconds=10.0)
    assert 10 <= len(found) <= 17
    assert found[-1]["onset_sec"] < 10.0


def test_every_note_fits_the_contract(twinkle):
    schema = json.loads((ROOT / "contracts" / "note-event.schema.json").read_text(encoding="utf-8"))
    note_schema = {**schema["$defs"]["Note"], "$defs": schema["$defs"]}
    found = run(twinkle, vibrato_hz=5.0, vibrato_cents=30.0)
    assert found
    for n in found:
        jsonschema.validate(n, note_schema)
        assert type(n["pitch"]) is int
        assert all(type(n[k]) is float for k in ("onset_sec", "duration_sec", "onset_beat", "duration_beat"))
    # the part entry fits the song-analysis contract too
    full = json.loads((ROOT / "contracts" / "song-analysis.schema.json").read_text(encoding="utf-8"))
    part_schema = json.loads(
        json.dumps({**full["properties"]["parts"]["items"], "$defs": schema["$defs"]}).replace(
            "note-event.schema.json#/$defs/Note", "#/$defs/Note"
        )
    )
    part = melody.melody_to_part(found)
    jsonschema.validate(part, part_schema)
    json.dumps(part)  # plain Python types only


def test_three_minute_recording_is_fast(twinkle):
    phrase = []
    for rep in range(6):  # six times the 29 s tune plus a few notes: about 3 minutes
        phrase += [(p, o + rep * 48, d) for p, o, d in twinkle]
    phrase += [(p, o + 6 * 48, d) for p, o, d in twinkle[:10]]
    y = synth(phrase, vibrato_hz=5.5, vibrato_cents=35.0)
    assert len(y) / SR > 175
    start = time.perf_counter()
    found = melody.extract_melody(y, SR, BPM)
    elapsed = time.perf_counter() - start
    p, r = report("3-minute recording with vibrato", found, truth_of(phrase))
    print(f"[melody] 3-minute recording took {elapsed:.1f} s")
    assert elapsed < 60
    assert p > 0.98 and r > 0.98
