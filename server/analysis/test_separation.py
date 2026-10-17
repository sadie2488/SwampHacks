"""Tests for separation.py. Audio is synthesized here, never read from files.

The mixes are a clear melody (the Twinkle fixture, built by the melody tests) with loud drum hits and a
quiet sustained chord on top. The numbers printed by `report` are what the tests were written against.
"""
import sys
import time

import pytest

pytest.importorskip("librosa")
np = pytest.importorskip("numpy")

from analysis import melody, separation

from .test_melody import BPM, SR, load_twinkle, score, synth, truth_of

NOTES = load_twinkle()
TRUTH = truth_of(NOTES)
BEAT_SEC = 60.0 / BPM


def drum_hits(length: int, *, loudness: float, every: float = 1.0, seed: int = 3):
    """A kick and a snare (noise burst) in turn, one hit every `every` beats, `loudness` times the melody's level."""
    rng = np.random.default_rng(seed)
    out = np.zeros(length)
    size = int(0.12 * SR)
    k = np.arange(size)
    kick = np.sin(2 * np.pi * (60 * np.exp(-k / (0.03 * SR)) + 40) * k / SR) * np.exp(-k / (0.04 * SR))
    snare = rng.normal(0, 1, size) * np.exp(-k / (0.02 * SR))
    hit, beat = 0, 0.0
    while beat * BEAT_SEC * SR + size < length:
        start = int(beat * BEAT_SEC * SR)
        out[start : start + size] += loudness * (snare if hit % 2 else 0.8 * snare + 0.5 * kick)
        hit, beat = hit + 1, beat + every
    return out


def chord(length: int, *, loudness: float):
    """A sustained C major triad low down, the way a pad or a guitar strum sits under a tune."""
    t = np.arange(length) / SR
    out = np.zeros(length)
    for midi in (48, 52, 55):
        freq = 440.0 * 2 ** ((midi - 69) / 12)
        out += sum(a * np.sin(2 * np.pi * freq * (h + 1) * t) for h, a in enumerate((1.0, 0.5, 0.3)))
    return loudness * out / 3


def drum_mix(*, drums: float = 1.0, every: float = 1.0, chord_level: float = 0.05):
    """The Twinkle melody with drum hits and a quiet chord on top (float32 samples at SR)."""
    tune = synth(NOTES, tail=0.5)
    mix = tune + drum_hits(len(tune), loudness=drums, every=every) + chord(len(tune), loudness=chord_level)
    return mix.astype(np.float32)


def report(name, found):
    p, r = score(found, TRUTH)
    print(f"[separation] {name}: precision {p:.2f} recall {r:.2f} ({len(found)} found, {len(TRUTH)} expected)")
    return p, r


# --- what it does to a mix --------------------------------------------------------------------------------------------


@pytest.mark.parametrize("every", [1.0, 0.5, 0.25], ids=["a hit every beat", "eighth notes", "sixteenth notes"])
def test_removing_the_drums_gives_back_the_notes_the_drums_were_hiding(every):
    mix = drum_mix(every=every)
    raw_p, raw_r = report(f"raw mix, hits every {every} beat", melody.extract_melody(mix, SR, BPM))
    quiet = separation.harmonic_part(mix, SR)
    p, r = report(f"drums out, hits every {every} beat", melody.extract_melody(quiet, SR, BPM))
    assert p >= 0.85 and r >= 0.9
    assert p >= raw_p + 0.15, "clearly fewer made-up notes than with the drums left in"
    assert r >= raw_r


def test_a_lone_melody_comes_through_unharmed():
    tune = synth(NOTES, tail=0.5)
    p, r = report("lone melody, drums out", melody.extract_melody(separation.harmonic_part(tune, SR), SR, BPM))
    assert p >= 0.95 and r >= 0.95


def test_a_chord_louder_than_the_tune_is_not_something_it_can_fix():
    """Honest limit: it removes drums, not other instruments. Nothing is claimed about the notes here, only
    that it still hands back usable sound of the same length."""
    mix = drum_mix(chord_level=0.15)
    quiet = separation.harmonic_part(mix, SR)
    assert quiet.shape == mix.shape and np.max(np.abs(quiet)) > 0.01
    report("loud chord, drums out", melody.extract_melody(quiet, SR, BPM))


def rms(x):
    return float(np.sqrt(np.mean(np.square(x))))


def test_drums_alone_are_almost_all_taken_out_and_a_tune_alone_is_almost_all_kept():
    drums = drum_hits(20 * SR, loudness=1.0).astype(np.float32)
    tune = synth(NOTES, tail=0.5)
    left_of_drums = rms(separation.harmonic_part(drums, SR)) / rms(drums)
    left_of_tune = rms(separation.harmonic_part(tune, SR)) / rms(tune)
    print(f"[separation] sound left: drums alone {left_of_drums:.4f}, tune alone {left_of_tune:.3f}")
    assert left_of_drums < 0.05
    assert left_of_tune > 0.9


# --- shape of the result ------------------------------------------------------------------------------------------------


def test_the_result_is_mono_float32_samples_as_long_as_the_input():
    mix = drum_mix()
    quiet = separation.harmonic_part(mix, SR)
    assert quiet.dtype == np.float32 and quiet.ndim == 1 and len(quiet) == len(mix)
    assert np.all(np.isfinite(quiet))


def test_channels_are_mixed_down_in_either_layout():
    mix = drum_mix()
    flat = separation.harmonic_part(mix, SR)
    wide = separation.harmonic_part(np.stack([mix, mix]), SR)  # channels x samples
    tall = separation.harmonic_part(np.stack([mix, mix], axis=1), SR)  # samples x channels
    assert wide.shape == tall.shape == flat.shape
    assert np.allclose(wide, flat, atol=1e-4) and np.allclose(tall, flat, atol=1e-4)


def test_only_the_first_max_seconds_are_used():
    mix = drum_mix()
    assert len(separation.harmonic_part(mix, SR, max_seconds=5.0)) == 5 * SR


def test_the_input_is_left_alone():
    mix = drum_mix()
    before = mix.copy()
    separation.harmonic_part(mix, SR)
    assert np.array_equal(mix, before)


def test_not_a_number_samples_are_treated_as_silence_instead_of_breaking_it():
    mix = drum_mix()
    mix[1000:1010] = np.nan
    assert np.all(np.isfinite(separation.harmonic_part(mix, SR)))


@pytest.mark.parametrize("samples", [np.zeros(SR * 3), np.zeros(0), np.ones(100)], ids=["silence", "empty", "tiny"])
def test_nothing_to_separate_says_so_in_plain_words(samples):
    with pytest.raises(separation.SeparationError, match="too short or too quiet"):
        separation.harmonic_part(samples, SR)


def test_without_the_libraries_it_says_so(monkeypatch):
    monkeypatch.setattr(separation, "np", None)  # as if they had not been loaded yet...
    monkeypatch.setitem(sys.modules, "librosa", None)  # ...and cannot be
    with pytest.raises(separation.SeparationError, match="not installed"):
        separation.harmonic_part(np.ones(SR), SR)


# --- speed --------------------------------------------------------------------------------------------------------------


def test_a_three_minute_song_takes_a_few_seconds():
    mix = drum_mix(every=0.5)
    song = np.tile(mix, 180 * SR // len(mix) + 1)[: 180 * SR]
    start = time.perf_counter()
    quiet = separation.harmonic_part(song, SR)
    elapsed = time.perf_counter() - start
    print(f"[separation] 3-minute song took {elapsed:.1f} s")
    assert len(quiet) == len(song)
    assert elapsed < 30
