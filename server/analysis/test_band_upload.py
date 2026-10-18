"""A whole band through the real analysis: melody, bass and chords come back as parts; a solo stays one melody.

The songs are generated here (nothing is committed). Skipped without the audio libraries or basic-pitch.
"""
import logging
import time

import pytest

np = pytest.importorskip("numpy")
sf = pytest.importorskip("soundfile")
pytest.importorskip("librosa")
pytest.importorskip("basic_pitch")
pytest.importorskip("onnxruntime")

from analysis import polyphonic
from app import analyzer

SR = 22050
BPM = 100.0
SPB = 60.0 / BPM
PROGRESSION = [(60, 64, 67), (57, 60, 64), (53, 57, 60), (55, 59, 62)]  # C Am F G
ROOTS = [36, 33, 29, 31]
TUNE = [72, 74, 76, 79, 77, 76, 74, 72, 69, 71, 72, 74, 76, 74, 72, 71]


def tone(midi, seconds, harmonics=(1.0, 0.5, 0.3, 0.15), decay=1.5):
    t = np.arange(int(seconds * SR)) / SR
    freq = 440.0 * 2 ** ((midi - 69) / 12)
    y = sum(a * np.sin(2 * np.pi * freq * (k + 1) * t) for k, a in enumerate(harmonics))
    env = np.minimum(1.0, t / 0.01) * np.exp(-t / decay)
    env[-int(0.03 * SR) :] *= np.linspace(1, 0, int(0.03 * SR))
    return y * env


def make_song(seconds, *, band=True, seed=0):
    """A tune on every beat; with `band`, a chord each bar, a bass note every two beats and a drum kit."""
    rng = np.random.default_rng(seed)
    y = np.zeros(int(seconds * SR))

    def add(start, sig):
        i = int(start * SR)
        j = min(len(y), i + len(sig))
        if i < j:
            y[i:j] += sig[: j - i]

    kick_t = np.arange(int(0.12 * SR)) / SR
    kick = np.sin(2 * np.pi * (50 + 80 * np.exp(-kick_t * 30)) * kick_t) * np.exp(-kick_t * 20)
    for b in range(int((seconds - 1) / SPB)):
        t0 = 0.5 + b * SPB
        bar, beat = divmod(b, 4)
        add(t0, 0.25 * tone(TUNE[b % len(TUNE)], SPB - 0.04, (1.0, 0.4, 0.2, 0.1), 0.8))
        if not band:
            continue
        if beat == 0:
            for p in PROGRESSION[bar % 4]:
                add(t0, 0.12 * tone(p, 4 * SPB - 0.05, decay=3.0))
        if beat in (0, 2):
            add(t0, 0.35 * tone(ROOTS[bar % 4], 2 * SPB - 0.05, (1.0, 0.6, 0.2), 2.0))
            add(t0, 0.5 * kick)
        else:
            add(t0, 0.25 * rng.normal(0, 1, len(kick_t)) * np.exp(-kick_t * 25))
    return 0.9 * y / np.abs(y).max()


def analyze(tmp_path, y, name="song.wav"):
    path = tmp_path / name
    sf.write(path, y.astype(np.float32), SR)
    started = time.monotonic()
    doc = analyzer.analyze_audio(path)
    return doc, time.monotonic() - started


def kinds(doc):
    return [(p["kind"], p["name"]) for p in doc["parts"]]


def test_a_full_band_gives_melody_bass_and_chords(tmp_path):
    doc, seconds = analyze(tmp_path, make_song(30))
    print(f"[band] 30 s mix: {seconds:.1f} s, " + ", ".join(f"{p['name']} {len(p['notes'])}" for p in doc["parts"]))
    assert kinds(doc) == [("melody", "Melody"), ("bass", "Bass"), ("harmony", "Chords")]
    tune, low, held = (p["notes"] for p in doc["parts"])
    assert sum(n["pitch"] in TUNE for n in tune) >= 0.9 * len(tune) and len(tune) >= 40
    assert {n["pitch"] for n in low} <= set(ROOTS) and len(low) >= 18
    assert len({n["onset_beat"] for n in held}) >= 8
    assert doc["warnings"] == [analyzer.WARNING_FULL_MIX]
    for part in doc["parts"]:
        for n in part["notes"]:
            assert n["part"] == part["id"] and n["duration_sec"] > 0 and n["onset_beat"] >= 0


def test_a_solo_tune_still_gives_one_clean_melody(tmp_path):
    doc, _ = analyze(tmp_path, make_song(20, band=False))
    assert kinds(doc) == [("melody", "Melody")]
    assert "warnings" not in doc
    assert {n["pitch"] for n in doc["parts"][0]["notes"]} <= set(TUNE)


def test_a_failing_band_step_keeps_the_melody(tmp_path, monkeypatch, caplog):
    def broken(*args, **kwargs):
        raise RuntimeError("model went missing")

    monkeypatch.setattr(polyphonic, "transcribe", broken)
    doc, _ = analyze(tmp_path, make_song(20))
    assert kinds(doc) == [("melody", "Melody")]
    assert doc["warnings"] == [analyzer.WARNING_FULL_MIX, analyzer.WARNING_PARTS_FAILED]


def test_a_three_minute_band_song_reports_its_time(tmp_path, caplog):
    caplog.set_level(logging.INFO)
    analyzer.warm_up()  # as the server does at start
    doc, seconds = analyze(tmp_path, make_song(180))
    print(f"[band] 3 min mix: {seconds:.1f} s, " + ", ".join(f"{p['name']} {len(p['notes'])}" for p in doc["parts"]))
    assert [k for k, _ in kinds(doc)] == ["melody", "bass", "harmony"]
    assert seconds < 120  # the target is 20 to 30 s on a laptop; this only catches something badly wrong
