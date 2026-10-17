"""Tests for the parts of melody.py that need no audio libraries (these also run in CI)."""
import json
import subprocess
import sys
from pathlib import Path

import jsonschema
import pytest

from analysis import melody

ROOT = Path(__file__).resolve().parents[2]
SERVER = ROOT / "server"


def notes_of(pitches):
    return [{"pitch": p, "onset_sec": i * 0.5, "duration_sec": 0.4} for i, p in enumerate(pitches)]


def test_hint_for_a_beginner_tune_is_clarinet():
    twinkle = json.loads((ROOT / "fixtures" / "song-analysis" / "twinkle.json").read_text(encoding="utf-8"))
    assert melody.transposition_hint(twinkle["parts"][0]["notes"]) == "clarinet"


def test_hint_follows_the_range():
    assert melody.transposition_hint(notes_of([40, 43, 47, 52, 55])) == "trombone"  # low: trombone beginner
    assert melody.transposition_hint(notes_of([55, 60, 67, 72, 79])) == "clarinet"
    assert melody.transposition_hint(notes_of([41, 50, 64, 80])) == "guitar"  # too low/high for the others
    assert melody.transposition_hint(notes_of([62, 90])) == "clarinet"  # only its full range reaches 90


def test_hint_is_none_when_nothing_fits_or_nothing_is_there():
    assert melody.transposition_hint([]) is None
    assert melody.transposition_hint(notes_of([30, 60])) is None  # below every range
    assert melody.transposition_hint(notes_of([45, 100])) is None  # above every range


def test_melody_to_part_shape_and_tagging():
    notes = [
        {"id": "a", "pitch": 60, "onset_sec": 0.0, "duration_sec": 0.5, "part": "old"},
        {"pitch": 62, "onset_sec": 0.5, "duration_sec": 0.5},
    ]
    part = melody.melody_to_part(notes, part_id="hum", name="My hum")
    assert part["id"] == "hum" and part["name"] == "My hum" and part["kind"] == "melody"
    assert [n["part"] for n in part["notes"]] == ["hum", "hum"]
    assert [n["id"] for n in part["notes"]] == ["a", "m2"]
    assert part["instrument"] == "clarinet"
    assert notes[0]["part"] == "old" and "id" not in notes[1]  # the input is left alone


def test_melody_to_part_keeps_an_explicit_instrument_and_allows_no_hint():
    assert melody.melody_to_part(notes_of([60]), instrument="guitar")["instrument"] == "guitar"
    part = melody.melody_to_part(notes_of([30, 100]))
    assert "instrument" not in part
    assert melody.melody_to_part([])["notes"] == []


def test_part_fits_the_song_analysis_contract():
    schema = json.loads((ROOT / "contracts" / "song-analysis.schema.json").read_text(encoding="utf-8"))
    note_schema = json.loads((ROOT / "contracts" / "note-event.schema.json").read_text(encoding="utf-8"))
    part_schema = json.loads(
        json.dumps({**schema["properties"]["parts"]["items"], "$defs": note_schema["$defs"]}).replace(
            "note-event.schema.json#/$defs/Note", "#/$defs/Note"
        )
    )
    jsonschema.validate(melody.melody_to_part(notes_of([60, 62, 64])), part_schema)


def test_without_the_audio_libraries_the_module_still_loads_and_explains():
    code = (
        "import sys\n"
        "for name in ('numpy', 'scipy', 'librosa'):\n"
        "    sys.modules[name] = None\n"
        "from analysis import melody\n"
        "print(melody.transposition_hint([{'pitch': 60}]))\n"
        "try:\n"
        "    melody.extract_melody([0.1] * 30000, 22050, 100)\n"
        "except melody.AnalysisError as err:\n"
        "    print(err)\n"
    )
    done = subprocess.run(
        [sys.executable, "-c", code], cwd=SERVER, capture_output=True, text=True, check=True
    )
    message = "The music analysis tools are not installed on this server."
    assert done.stdout.splitlines() == ["clarinet", message]


def test_bad_tempo_or_grid_is_rejected_before_any_work():
    with pytest.raises(ValueError):
        melody.extract_melody([0.0], 22050, 0)
    with pytest.raises(ValueError):
        melody.extract_melody([0.0], 22050, 100, grid="nope")
