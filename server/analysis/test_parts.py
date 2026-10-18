"""Splitting a band's notes into melody, bass and chords (`parts.py`), on hand-made note lists (no audio needed)."""
import pytest

from analysis import parts

BPM = 120.0
SPB = 60.0 / BPM


def note(pitch, start, beats, amp=0.6):
    return {"pitch": pitch, "start": start, "end": start + beats * SPB - 0.02, "amp": amp}


def band(bars=8, *, melody=True, bass=True, chords=True):
    """A tune on every beat over a held chord each bar and a bass note every two beats, starting at 0.5 s."""
    tune = [72, 74, 76, 79, 77, 76, 74, 72]
    harmony = [(60, 64, 67), (57, 60, 64), (53, 57, 60), (55, 59, 62)]
    roots = [36, 33, 29, 31]
    notes = []
    for b in range(bars * 4):
        t = 0.5 + b * SPB
        bar, beat = divmod(b, 4)
        if melody:
            notes.append(note(tune[b % len(tune)], t, 1, 0.7))
        if bass and beat in (0, 2):
            notes.append(note(roots[bar % 4], t, 2, 0.65))
        if chords and beat == 0:
            notes += [note(p, t, 4, 0.5) for p in harmony[bar % 4]]
    return sorted(notes, key=lambda n: n["start"])


def split(notes, seconds=0.5 + 32 * SPB):
    return parts.split_parts(notes, BPM, [0.5 + i * SPB for i in range(64)], analyzed_sec=seconds)


def test_a_full_band_gives_melody_bass_and_chords():
    found, omitted = split(band())
    assert omitted == {}
    assert list(found) == ["melody", "bass", "harmony"]
    assert [found[k]["name"] for k in found] == ["Melody", "Bass", "Chords"]
    tune = found["melody"]["notes"]
    assert len(tune) == 32 and {n["pitch"] for n in tune} == {72, 74, 76, 77, 79}
    assert [n["onset_beat"] for n in tune[:3]] == [0.0, 1.0, 2.0]
    low = found["bass"]["notes"]
    assert len(low) == 16 and all(n["duration_beat"] == 2.0 for n in low)
    held = found["harmony"]["notes"]
    assert len(held) == 24 and {n["onset_beat"] for n in held} == {4.0 * i for i in range(8)}
    assert all(n["duration_beat"] == 4.0 for n in held)
    for kind, part in found.items():
        assert all(n["part"] == kind for n in part["notes"])
        assert len({n["id"] for n in part["notes"]}) == len(part["notes"])


def test_overtones_are_not_notes():
    notes = band(bars=4)
    ghosts = [note(n["pitch"] + 12, n["start"] + 0.01, 1, 0.4) for n in notes if n["pitch"] >= 72]
    found, _ = split(sorted(notes + ghosts, key=lambda n: n["start"]))
    assert max(n["pitch"] for n in found["melody"]["notes"]) == 79
    assert all(n["pitch"] < 72 for n in found["harmony"]["notes"])


def test_a_loud_low_octave_over_the_bass_is_an_overtone_too():
    notes = [note(29, 0.5 + 2 * i * SPB, 2, 0.4) for i in range(8)]
    notes += [note(41, 0.5 + 2 * i * SPB - 0.1, 2, 0.7) for i in range(8)]  # louder, and heard a little sooner
    assert {n["pitch"] for n in parts.drop_ghosts(notes)} == {29}


def test_a_solo_tune_gives_only_the_melody():
    found, omitted = split(band(bass=False, chords=False))
    assert list(found) == ["melody"]
    assert set(omitted) == {"bass", "harmony"}


def test_a_few_stray_notes_are_left_out():
    notes = band(bass=False) + [note(31, 3.0, 1), note(33, 9.0, 1)]
    found, omitted = split(notes)
    assert "bass" not in found and omitted["bass"].startswith("only 2 notes")
    assert "harmony" in found


def test_a_part_must_cover_enough_of_the_song():
    found, omitted = split(band(bars=8), seconds=200.0)  # 16 s of music in a 200 s recording
    assert found == {} and set(omitted) == {"melody", "bass", "harmony"}


def test_parts_are_shifted_to_one_beat_zero():
    a = {"notes": [{"onset_sec": 1.0, "onset_beat": 0.0}, {"onset_sec": 1.5, "onset_beat": 1.0}]}
    b = {"notes": [{"onset_sec": 0.5, "onset_beat": 0.0}, {"onset_sec": 1.0, "onset_beat": 1.0}]}
    parts.align_parts([a, b], BPM)
    assert [n["onset_beat"] for n in a["notes"]] == [1.0, 2.0]
    assert [n["onset_beat"] for n in b["notes"]] == [0.0, 1.0]


def test_bad_tempo_is_refused():
    with pytest.raises(ValueError):
        parts.split_parts([], 0, None)
