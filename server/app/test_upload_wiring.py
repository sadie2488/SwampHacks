"""How the upload route, the analyzer, the repository and the server start-up fit together. None of these tests need the
audio libraries: the real analysis is replaced, or switched off, where a test is about something else.
The real analysis itself is tested in test_analysis_pipeline.py."""
import json
import logging
import sys
import threading
from types import SimpleNamespace

import psycopg
import pytest
from fastapi.testclient import TestClient

from analysis import melody, separation, tempo_key

from . import analyzer, config, repository, store
from .main import app
from .repository import MemoryRepository
from .test_api import assert_valid_analysis, make_wav


@pytest.fixture
def client():
    return TestClient(app)


def upload(client, name="my song.wav"):
    return client.post("/api/songs", files={"file": (name, make_wav(), "audio/wav")})


def files_left_behind():
    return [p.name for p in config.data_dir().rglob("*") if p.is_file()]


# --- the demo song ---------------------------------------------------------------------------------------------------

def test_the_demo_song_is_still_the_fixture_unchanged(client):
    fixture = json.loads((config.FIXTURES_DIR / "song-analysis" / "twinkle.json").read_text(encoding="utf-8"))
    response = client.get("/api/songs/demo-twinkle/analysis")
    assert response.status_code == 200
    assert response.json() == fixture
    assert "warnings" not in response.json()
    assert client.get("/api/demo-songs").json() == [{"song_id": "demo-twinkle", "title": "Twinkle, Twinkle, Little Star"}]


# --- when the analysis libraries are missing ---------------------------------------------------------------------------

def check_example_analysis_with_warning(client):
    response = upload(client)
    assert response.status_code == 200
    doc = response.json()
    assert_valid_analysis(doc)
    assert doc["warnings"] == [analyzer.WARNING_UNAVAILABLE]
    assert "not available" in doc["warnings"][0] and "example" in doc["warnings"][0]
    assert doc["song_id"].startswith("upload-") and doc["source"] == {"kind": "upload", "file_name": "my song.wav"}
    assert doc["parts"], "the example tune stands in"
    assert client.get(f"/api/songs/{doc['song_id']}/analysis").json() == doc


def test_when_the_analysis_code_cannot_be_imported_the_example_comes_back_with_a_warning(client, monkeypatch):
    monkeypatch.setitem(sys.modules, "analysis.tempo_key", None)  # makes `import analysis.tempo_key` fail
    check_example_analysis_with_warning(client)


def test_when_the_audio_libraries_are_not_installed_the_example_comes_back_with_a_warning(client, monkeypatch):
    monkeypatch.setattr(tempo_key, "librosa", None)
    check_example_analysis_with_warning(client)


def test_the_demo_song_itself_never_gets_that_warning(client, monkeypatch):
    monkeypatch.setitem(sys.modules, "analysis.tempo_key", None)
    assert "warnings" not in client.get("/api/songs/demo-twinkle/analysis").json()


# --- 422 for a song that cannot be analyzed ------------------------------------------------------------------------------

def test_a_failed_analysis_is_a_422_with_its_own_message_and_leaves_nothing_behind(client, monkeypatch):
    saved = []
    monkeypatch.setattr(repository, "record_analysis", lambda analysis, repo=None: saved.append(analysis) or True)

    def fail(path):
        assert path.is_file(), "the upload is on disk while it is analyzed"
        raise analyzer.AnalysisFailed("That song has no beat. Try another one.")

    monkeypatch.setattr(store, "analyze_audio", fail)
    response = upload(client)
    assert response.status_code == 422
    assert response.json() == {"detail": "That song has no beat. Try another one."}
    assert files_left_behind() == []
    assert saved == []


def test_a_bug_in_the_analysis_is_a_500_in_plain_words_without_a_trace(client, monkeypatch):
    def fail(path):
        raise RuntimeError("secret internals")

    monkeypatch.setattr(store, "analyze_audio", fail)
    response = upload(client)
    assert response.status_code == 500
    assert response.json() == {"detail": "We could not analyze that song. Please try another file."}
    assert files_left_behind() == []


# --- saving the song in the database ---------------------------------------------------------------------------------------

def test_a_good_upload_is_recorded_once(client, fake_analysis, monkeypatch):
    calls = []
    monkeypatch.setattr(repository, "record_analysis", lambda analysis, repo=None: calls.append(analysis) or True)
    response = upload(client)
    assert response.status_code == 200
    assert calls == [response.json()]


def test_a_good_upload_lands_in_the_repository(client, fake_analysis):
    memory = MemoryRepository()
    repository.set_repository(memory)
    doc = upload(client).json()
    assert memory.get_song(doc["song_id"])["title"] == "my song"
    assert memory.get_analysis(doc["song_id"])["analysis"] == doc


def test_a_database_that_is_down_does_not_fail_the_upload(client, fake_analysis, monkeypatch, caplog):
    class Down(MemoryRepository):
        def upsert_song(self, *args, **kwargs):
            raise psycopg.OperationalError('connection to server at "db.example.invalid" (10.0.0.1), port 5432 failed')

    repository.set_repository(Down())
    caplog.set_level(logging.WARNING)
    response = upload(client)
    assert response.status_code == 200
    assert_valid_analysis(response.json())
    assert "Could not remember the song analysis" in caplog.text
    assert "db.example.invalid" not in caplog.text  # addresses are hidden in the log


def test_even_a_surprise_inside_the_saving_step_does_not_fail_the_upload(client, fake_analysis, monkeypatch, caplog):
    def explode(analysis, repo=None):
        raise RuntimeError("something odd at postgresql://who:pw@db.example.invalid/music")

    monkeypatch.setattr(repository, "record_analysis", explode)
    caplog.set_level(logging.WARNING)
    response = upload(client)
    assert response.status_code == 200
    assert response.json()["song_id"].startswith("upload-")
    assert "Could not remember the uploaded song" in caplog.text
    assert "db.example.invalid" not in caplog.text


# --- warm-up -------------------------------------------------------------------------------------------------------------------

def warm_up_threads():
    return [t for t in threading.enumerate() if t.name == "analysis-warm-up"]


def test_the_server_starts_the_warm_up_in_the_background_and_does_not_wait_for_it(monkeypatch):
    release, started = threading.Event(), threading.Event()

    def slow_warm_up():
        started.set()
        release.wait(30)

    monkeypatch.setattr(analyzer, "warm_up", slow_warm_up)
    try:
        with TestClient(app) as client:  # start-up has finished while the warm-up is still busy
            assert started.wait(5)
            (thread,) = warm_up_threads()
            assert thread.is_alive() and thread.daemon
            assert client.get("/api/health").json() == {"status": "ok"}
    finally:
        release.set()
    thread.join(5)
    assert not thread.is_alive()


def test_the_warm_up_never_raises(monkeypatch):
    def broken():
        raise RuntimeError("the libraries are broken")

    monkeypatch.setattr(analyzer, "_engine", broken)
    assert analyzer.warm_up() is False
    monkeypatch.setattr(analyzer, "_engine", lambda: None)
    assert analyzer.warm_up() is False


def test_a_warm_up_whose_steps_fail_still_returns_quietly(monkeypatch):
    np = pytest.importorskip("numpy")

    def fail(*args, **kwargs):
        raise RuntimeError("no")

    fake_tempo_key = SimpleNamespace(np=np, SAMPLE_RATE=22050, analyze_tempo_key=fail)
    fake_melody = SimpleNamespace(extract_melody=fail)
    monkeypatch.setattr(analyzer, "_engine", lambda: (fake_tempo_key, fake_melody))
    assert analyzer.warm_up() is False


def test_starting_the_warm_up_does_not_raise_even_when_no_thread_can_be_made(monkeypatch):
    def refuse(*args, **kwargs):
        raise RuntimeError("can't start new thread")

    monkeypatch.setattr(analyzer.threading, "Thread", refuse)
    assert analyzer.start_warm_up() is None


# --- the "many instruments" check ----------------------------------------------------------------------------------------------

def note(onset, confidence, length=0.4, pitch=60):
    return {"pitch": pitch, "onset_sec": onset, "duration_sec": length, "confidence": confidence}


def tune(count, confidence, gap=0.5):
    return [note(i * gap, confidence) for i in range(count)]


def test_notes_the_tracker_is_sure_about_are_not_a_full_mix():
    assert analyzer.looks_like_full_mix(tune(20, 0.85)) is False
    assert analyzer.looks_like_full_mix(tune(20, 0.65)) is False  # a lone melody with drums over it


def test_notes_the_tracker_is_unsure_about_look_like_a_full_mix():
    assert analyzer.looks_like_full_mix(tune(20, 0.38)) is True
    assert analyzer.looks_like_full_mix(tune(20, 0.49)) is True
    assert analyzer.looks_like_full_mix(tune(20, 0.5)) is False


def test_a_very_high_note_rate_looks_like_a_full_mix():
    busy = [note(i * 0.1, 0.9, length=0.09) for i in range(40)]  # ten notes a second
    assert analyzer.looks_like_full_mix(busy) is True
    brisk = [note(i * 0.125, 0.9, length=0.12) for i in range(40)]  # eight a second: fast, but a person can play it
    assert analyzer.looks_like_full_mix(brisk) is False


def test_long_notes_count_for_more_than_short_ones():
    mixed = [note(0, 0.9, length=6.0), *[note(6 + i * 0.3, 0.1, length=0.1) for i in range(10)]]
    assert analyzer.looks_like_full_mix(mixed) is False


def test_too_few_notes_to_judge_gives_no_warning():
    assert analyzer.looks_like_full_mix([]) is False
    assert analyzer.looks_like_full_mix(tune(3, 0.1)) is False


# --- the second try without drums -----------------------------------------------------------------------------------------------
# A flagged melody is looked for again on the sound with the drums taken out, and kept only if clearly better. The melody step
# and the drum removal are pretend here: the first answers with the notes the test hands it, so only the choice is tested.
# The real audio is in test_separation.py and test_analysis_pipeline.py.

def melody_step(monkeypatch, first, second=None, *, separation_error=None, second_error=None):
    """Run the analyzer's melody step. Returns (the notes of the part, the warnings, whether each call got the quieter sound)."""
    quieter = object()
    calls = []

    def harmonic_part(y, sr):
        if separation_error:
            raise separation_error
        return quieter

    def extract_melody(y, sr, tempo_bpm, beats):
        calls.append(y is quieter)
        if y is not quieter:
            return first
        if second_error:
            raise second_error
        return second

    fake = SimpleNamespace(
        AnalysisError=melody.AnalysisError, extract_melody=extract_melody, melody_to_part=lambda notes: {"notes": notes}
    )
    monkeypatch.setattr(separation, "harmonic_part", harmonic_part)
    parts, warnings = analyzer._melody_part(fake, "the song", 22050, {"tempo_bpm": 100.0, "beats": [0.0]})
    return parts[0]["notes"], warnings, calls


def test_a_full_mix_that_comes_out_clean_without_the_drums_uses_the_clean_notes_and_drops_the_warning(monkeypatch, caplog):
    caplog.set_level(logging.INFO)
    first, second = tune(20, 0.3), tune(20, 0.85)
    notes, warnings, calls = melody_step(monkeypatch, first, second)
    assert notes is second and warnings == []
    assert calls == [False, True]
    assert "second try without drums" in caplog.text and "used" in caplog.text


def test_too_many_notes_a_second_is_fixed_the_same_way(monkeypatch):
    busy = [note(i * 0.1, 0.9, length=0.09) for i in range(40)]  # drum hits read as ten notes a second
    second = tune(20, 0.9)
    notes, warnings, _ = melody_step(monkeypatch, busy, second)
    assert notes is second and warnings == []


def test_notes_that_are_better_but_still_unsure_are_used_and_the_warning_stays(monkeypatch):
    first, second = tune(20, 0.2), tune(15, 0.35, gap=0.6)
    notes, warnings, _ = melody_step(monkeypatch, first, second)
    assert notes is second and warnings == [analyzer.WARNING_FULL_MIX]


def test_notes_only_just_past_the_line_are_used_but_the_warning_stays(monkeypatch):
    first, second = tune(20, 0.3), tune(20, 0.55)
    notes, warnings, _ = melody_step(monkeypatch, first, second)
    assert notes is second and warnings == [analyzer.WARNING_FULL_MIX]
    assert analyzer.looks_like_full_mix(second) is False  # not a full mix by the usual check, but not clear enough to say so


@pytest.mark.parametrize(
    "second",
    [
        tune(20, 0.35),  # a little more sure, not clearly
        tune(20, 0.2),  # less sure than before
        tune(5, 0.9),  # sure, but most of the melody is gone
        tune(3, 0.9),  # too few notes to judge
        [],
    ],
    ids=["barely better", "worse", "most of the melody lost", "too few notes", "nothing"],
)
def test_a_second_try_that_is_not_clearly_better_changes_nothing(monkeypatch, second):
    first = tune(20, 0.3)
    notes, warnings, calls = melody_step(monkeypatch, first, second)
    assert notes is first and warnings == [analyzer.WARNING_FULL_MIX]
    assert calls == [False, True]


@pytest.mark.parametrize(
    "trouble",
    [
        {"separation_error": RuntimeError("out of memory")},
        {"separation_error": ImportError("no librosa")},
        {"second_error": melody.AnalysisError("no melody in the quiet sound")},
        {"second_error": RuntimeError("a bug")},
    ],
    ids=["separation fails", "separation missing", "no melody the second time", "bug the second time"],
)
def test_any_trouble_in_the_second_try_keeps_the_first_result(monkeypatch, caplog, trouble):
    caplog.set_level(logging.INFO)
    first = tune(20, 0.3)
    notes, warnings, _ = melody_step(monkeypatch, first, tune(20, 0.9), **trouble)
    assert notes is first and warnings == [analyzer.WARNING_FULL_MIX]
    assert "second try without drums" in caplog.text and "the first result stays" in caplog.text


def test_a_melody_that_does_not_look_like_a_full_mix_is_not_tried_again(monkeypatch):
    first = tune(20, 0.85)
    notes, warnings, calls = melody_step(monkeypatch, first, tune(20, 0.3), separation_error=AssertionError("must not run"))
    assert notes is first and warnings == [] and calls == [False]


def test_the_second_try_is_only_ever_logged_never_shown_as_a_warning(monkeypatch):
    _, warnings, _ = melody_step(monkeypatch, tune(20, 0.3), tune(20, 0.85))
    assert warnings == []
    _, warnings, _ = melody_step(monkeypatch, tune(20, 0.3), tune(20, 0.35))
    assert warnings == [analyzer.WARNING_FULL_MIX]
