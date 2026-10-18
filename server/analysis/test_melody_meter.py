"""Note beats are quarter notes in every meter (contract note-event: 1 beat = one quarter note)."""
import pytest

from analysis import melody

np = pytest.importorskip("numpy")
melody._load_libraries()


def notes_at(starts, length):
    return [{"start": s, "end": s + length, "pitch": 60 + i, "db": -10.0, "conf": 0.9} for i, s in enumerate(starts)]


def grid(rows):
    return [(r["onset_beat"], r["duration_beat"]) for r in rows]


def test_quarters_per_beat():
    assert melody.quarters_per_beat({"numerator": 4, "denominator": 4}) == 1.0
    assert melody.quarters_per_beat({"numerator": 3, "denominator": 4}) == 1.0
    assert melody.quarters_per_beat({"numerator": 6, "denominator": 8}) == 1.5
    assert melody.quarters_per_beat({"numerator": 9, "denominator": 8}) == 1.5
    assert melody.quarters_per_beat({"numerator": 12, "denominator": 8}) == 1.5
    assert melody.quarters_per_beat({"numerator": 3, "denominator": 8}) == 0.5  # simple: the beat is an eighth
    assert melody.quarters_per_beat(None) == 1.0


@pytest.mark.parametrize("signature", [None, {"numerator": 4, "denominator": 4}, {"numerator": 3, "denominator": 4}])
def test_simple_meters_count_quarter_notes_unchanged(signature):
    # 120 BPM: a beat (a quarter) is 0.5 s. Four quarters from the first beat at 1.0 s.
    beats = [1.0, 1.5, 2.0, 2.5]
    per_beat = melody.quarters_per_beat(signature)
    found = melody._quantize(notes_at([1.0, 1.5, 2.0, 2.5], 0.45), 120.0, beats, "auto", "melody", per_beat)
    assert grid(found) == [(0.0, 1.0), (1.0, 1.0), (2.0, 1.0), (3.0, 1.0)]


def test_six_eight_counts_dotted_quarter_beats_as_one_and_a_half_quarters():
    # 6/8 at 60 BPM: the beat is a dotted quarter of 1 s, so an eighth note is 1/3 s.
    beats = [0.0, 1.0, 2.0, 3.0]
    eighths = [i / 3 for i in range(6)]
    found = melody._quantize(notes_at(eighths, 0.3), 60.0, beats, "auto", "melody", 1.5)
    # each eighth is half a quarter note; one 6/8 bar is 3 quarters
    assert grid(found) == [(i * 0.5, 0.5) for i in range(6)]
    dotted = melody._quantize(notes_at([0.0, 1.0, 2.0], 0.95), 60.0, beats, "auto", "melody", 1.5)
    assert grid(dotted) == [(0.0, 1.5), (1.5, 1.5), (3.0, 1.5)]


def test_six_eight_pickup_moves_the_origin_back_one_whole_beat():
    # A note one eighth before the first beat: the origin moves back one dotted quarter (1.5 quarters).
    found = melody._quantize(notes_at([2 / 3, 1.0], 0.3), 60.0, [1.0, 2.0], "auto", "melody", 1.5)
    assert grid(found) == [(1.0, 0.5), (1.5, 0.5)]
