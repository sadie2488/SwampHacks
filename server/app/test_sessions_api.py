"""Tests for the saving endpoints. They run against the in-memory repository, or a stand-in connection."""
import json
import uuid
from datetime import UTC, datetime

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from . import config, repository, sessions_api, store
from .repository import MemoryRepository, NotFound, PostgresRepository
from .sessions_api import router
from .test_api import make_wav
from .testing_fakes import FakeDatabase

DEMO = config.DEMO_SONG_ID
MISSING_ID = "00000000-0000-4000-8000-000000000000"


@pytest.fixture
def memory():
    repo = MemoryRepository()
    repository.set_repository(repo)
    return repo


@pytest.fixture
def client(memory):
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("MUSIC_DATA_DIR", str(tmp_path))
    return tmp_path


def start(client, **changes):
    body = {"song_id": DEMO, "tempo_ratio": 0.8, **changes}
    return client.post("/api/sessions", json=body)


def new_session(client, **changes) -> str:
    response = start(client, **changes)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def assert_friendly_422(response, *words):
    assert response.status_code == 422, response.text
    body = response.json()
    assert isinstance(body["detail"], str) and body["detail"].startswith("Please check what was sent:")
    assert all(isinstance(e["field"], str) and isinstance(e["message"], str) for e in body["errors"])
    for word in words:
        assert word in body["detail"], (word, body["detail"])
    assert "Traceback" not in response.text and "pydantic" not in response.text.lower()


# --- songs -------------------------------------------------------------------------------------------------

def test_the_song_list_starts_with_the_demo_song(client):
    response = client.get("/api/songs")
    assert response.status_code == 200
    assert response.json() == [{
        "song_id": DEMO, "title": "Twinkle, Twinkle, Little Star", "source": "demo", "file_name": None,
        "duration_sec": 28.8,
    }]


def test_the_song_list_includes_known_uploads_newest_first_and_the_demo_only_once(client, memory):
    memory.upsert_song(DEMO, "Twinkle, Twinkle, Little Star", "demo", None, 28.8)
    memory.upsert_song("upload-aaaaaaaa", "Old", "upload", "old.wav", 10)
    memory.upsert_song("upload-bbbbbbbb", "New", "upload", "new.wav", 20)
    songs = client.get("/api/songs").json()
    assert [s["song_id"] for s in songs] == [DEMO, "upload-bbbbbbbb", "upload-aaaaaaaa"]
    assert songs[1] == {
        "song_id": "upload-bbbbbbbb", "title": "New", "source": "upload", "file_name": "new.wav", "duration_sec": 20.0
    }


def test_uploads_on_disk_that_were_never_recorded_are_found_and_remembered(client, memory, data_dir):
    saved = store.save_upload("Hum One.wav", make_wav())
    (data_dir / "analyses" / "upload-deadbeef.json").write_text("{ not json", encoding="utf-8")
    (data_dir / "analyses" / "upload-zzzzzzzz.json").write_text("{}", encoding="utf-8")
    (data_dir / "analyses" / "notes.json").write_text("{}", encoding="utf-8")
    songs = client.get("/api/songs").json()
    assert [s["song_id"] for s in songs] == [DEMO, saved["song_id"]]
    assert songs[1]["title"] == "Hum One" and songs[1]["file_name"] == "Hum One.wav"
    assert memory.get_song(saved["song_id"]) is not None
    assert client.get("/api/songs").json() == songs  # nothing doubled on the next call


def test_song_list_is_fine_with_no_data_folder_at_all(client, data_dir):
    assert [s["song_id"] for s in client.get("/api/songs").json()] == [DEMO]


# --- starting a practice run ------------------------------------------------------------------------------------

def test_starting_a_run_returns_its_id_and_remembers_the_song(client, memory):
    response = start(client, latency_offset_ms=42.5)
    assert response.status_code == 201
    session_id = response.json()["id"]
    assert set(response.json()) == {"id"} and uuid.UUID(session_id)
    saved = memory.get_session(session_id)
    assert (saved["song_id"], saved["tempo_ratio"], saved["latency_offset_ms"], saved["user_id"]) == (
        DEMO, 0.8, 42.5, None)
    assert memory.get_song(DEMO)["source"] == "demo"


def test_the_latency_offset_is_optional(client, memory):
    session_id = new_session(client)
    assert memory.get_session(session_id)["latency_offset_ms"] is None


def test_a_run_can_use_an_upload_that_is_only_on_disk(client, memory, data_dir):
    saved = store.save_upload("my song.wav", make_wav())
    session_id = new_session(client, song_id=saved["song_id"])
    assert memory.get_session(session_id)["song_id"] == saved["song_id"]


def test_an_unknown_song_is_a_friendly_404(client):
    for song_id in ("upload-00000000", "nope", "a.b", "x" * 100):
        response = start(client, song_id=song_id)
        assert response.status_code == 404 and "could not find that song" in response.json()["detail"]


def test_a_song_the_database_refuses_is_also_a_404(client, memory, monkeypatch):
    def refuse(*args, **kwargs):
        raise NotFound("gone")

    monkeypatch.setattr(memory, "create_session", refuse)
    assert start(client).status_code == 404


@pytest.mark.parametrize(
    ("body", "words"),
    [
        ({}, ("song_id is required", "tempo_ratio is required")),
        ({"song_id": DEMO}, ("tempo_ratio is required",)),
        ({"tempo_ratio": 1}, ("song_id is required",)),
        ({"song_id": "", "tempo_ratio": 1}, ("song_id needs at least 1",)),
        ({"song_id": "x" * 101, "tempo_ratio": 1}, ("song_id is too long (at most 100",)),
        ({"song_id": "../etc", "tempo_ratio": 1}, ("song_id has characters that are not allowed",)),
        ({"song_id": "has space", "tempo_ratio": 1}, ("song_id has characters",)),
        ({"song_id": 5, "tempo_ratio": 1}, ("song_id must be text",)),
        ({"song_id": DEMO, "tempo_ratio": 0}, ("tempo_ratio must be more than 0",)),
        ({"song_id": DEMO, "tempo_ratio": -1}, ("tempo_ratio must be more than 0",)),
        ({"song_id": DEMO, "tempo_ratio": 4.5}, ("tempo_ratio must be at most 4",)),
        ({"song_id": DEMO, "tempo_ratio": "fast"}, ("tempo_ratio must be a number",)),
        ({"song_id": DEMO, "tempo_ratio": None}, ("tempo_ratio must be a number",)),
        ({"song_id": DEMO, "tempo_ratio": 1, "latency_offset_ms": 6000}, ("latency_offset_ms must be at most 5000",)),
        ({"song_id": DEMO, "tempo_ratio": 1, "latency_offset_ms": -6000}, ("latency_offset_ms must be at least -5000",)),
    ],
)
def test_bad_input_for_a_new_run_gets_a_plain_422(client, body, words):
    assert_friendly_422(client.post("/api/sessions", json=body), *words)


def test_numbers_that_are_not_numbers_are_refused(client):
    for raw in (b'{"song_id": "demo-twinkle", "tempo_ratio": NaN}', b'{"song_id": "demo-twinkle", "tempo_ratio": Infinity}'):
        response = client.post("/api/sessions", content=raw, headers={"content-type": "application/json"})
        assert_friendly_422(response, "tempo_ratio")


def test_broken_json_and_the_wrong_kind_of_body_get_a_plain_422(client):
    broken = client.post("/api/sessions", content=b"{nope", headers={"content-type": "application/json"})
    assert_friendly_422(broken, "request was not valid JSON")
    assert_friendly_422(client.post("/api/sessions", json=["a list"]), "request")
    assert_friendly_422(client.post("/api/sessions"), "request")


def test_many_problems_are_summarised_with_a_count(client):
    response = client.post("/api/sessions", json={"song_id": "", "tempo_ratio": 0, "latency_offset_ms": "x", "extra": 1})
    assert response.status_code == 422 and len(response.json()["errors"]) == 3
    many = client.post("/api/sessions/x/samples", json={"samples": [{"metric": "", "value": "a"} for _ in range(3)]})
    assert "(and 3 more)" in many.json()["detail"]


# --- measurements -------------------------------------------------------------------------------------------------

def test_samples_are_saved_in_order(client, memory):
    session_id = new_session(client)
    response = client.post(f"/api/sessions/{session_id}/samples", json={"samples": [
        {"metric": "played_bpm", "value": 78.5, "song_time_sec": 2.0},
        {"metric": "pitch_cents_off", "value": -14},
    ]})
    assert response.status_code == 200 and response.json() == {"added": 2}
    stored = memory.list_samples(session_id)
    assert [(s["metric"], s["value"], s["song_time_sec"]) for s in stored] == [
        ("played_bpm", 78.5, 2.0), ("pitch_cents_off", -14.0, None)]


def test_a_plain_list_of_samples_is_accepted_too(client, memory):
    session_id = new_session(client)
    response = client.post(f"/api/sessions/{session_id}/samples", json=[{"metric": "m", "value": 1}])
    assert response.json() == {"added": 1} and len(memory.list_samples(session_id)) == 1


def test_an_empty_batch_is_fine(client):
    session_id = new_session(client)
    assert client.post(f"/api/sessions/{session_id}/samples", json={"samples": []}).json() == {"added": 0}


def test_at_most_500_samples_per_call(client, memory):
    session_id = new_session(client)
    path = f"/api/sessions/{session_id}/samples"
    sample = {"metric": "played_bpm", "value": 80, "song_time_sec": 1.5}
    assert client.post(path, json={"samples": [sample] * 500}).json() == {"added": 500}
    too_many = client.post(path, json={"samples": [sample] * 501})
    assert_friendly_422(too_many, "samples has too many items (at most 500)")
    assert len(memory.list_samples(session_id)) == 500  # the refused batch saved nothing
    assert_friendly_422(client.post(path, json=[sample] * 501), "at most 500")


@pytest.mark.parametrize(
    ("sample", "words"),
    [
        ({"value": 1}, ("samples.0.metric is required",)),
        ({"metric": "", "value": 1}, ("samples.0.metric has characters",)),
        ({"metric": "bad metric!", "value": 1}, ("samples.0.metric has characters",)),
        ({"metric": "m" * 65, "value": 1}, ("samples.0.metric",)),
        ({"metric": "m"}, ("samples.0.value is required",)),
        ({"metric": "m", "value": "loud"}, ("samples.0.value must be a number",)),
        ({"metric": "m", "value": 1e12}, ("samples.0.value must be at most",)),
        ({"metric": "m", "value": 1, "song_time_sec": -1}, ("samples.0.song_time_sec must be at least 0",)),
        ({"metric": "m", "value": 1, "song_time_sec": 90000}, ("samples.0.song_time_sec must be at most 86400",)),
    ],
)
def test_bad_samples_are_refused_with_the_item_named(client, sample, words):
    session_id = new_session(client)
    assert_friendly_422(client.post(f"/api/sessions/{session_id}/samples", json={"samples": [sample]}), *words)


def test_a_bad_sample_deep_in_the_batch_names_its_position(client, memory):
    session_id = new_session(client)
    batch = [{"metric": "m", "value": 1}] * 3 + [{"metric": "m", "value": "x"}]
    assert_friendly_422(client.post(f"/api/sessions/{session_id}/samples", json={"samples": batch}), "samples.3.value")
    assert memory.list_samples(session_id) == []


def test_samples_for_a_run_that_does_not_exist_are_a_404(client):
    sample = {"samples": [{"metric": "m", "value": 1}]}
    for session_id in (MISSING_ID, "not-a-uuid", "x" * 200):
        response = client.post(f"/api/sessions/{session_id}/samples", json=sample)
        assert response.status_code == 404 and "could not find that practice run" in response.json()["detail"]


def test_samples_can_still_arrive_after_the_run_ended(client, memory):
    session_id = new_session(client)
    client.post(f"/api/sessions/{session_id}/end", json={})
    assert client.post(f"/api/sessions/{session_id}/samples", json=[{"metric": "m", "value": 1}]).status_code == 200


# --- ending a run ---------------------------------------------------------------------------------------------------

def test_ending_a_run_stores_the_summary(client, memory):
    session_id = new_session(client)
    response = client.post(f"/api/sessions/{session_id}/end", json={"summary": {"avg_bpm": 79.2, "notes": [1, 2]}})
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == session_id and body["summary"] == {"avg_bpm": 79.2, "notes": [1, 2]}
    assert body["ended_at"] and "user_id" not in body
    assert memory.get_session(session_id)["summary"] == {"avg_bpm": 79.2, "notes": [1, 2]}


def test_the_summary_can_also_be_sent_on_its_own_or_not_at_all(client, memory):
    session_id = new_session(client)
    assert client.post(f"/api/sessions/{session_id}/end", json={"avg_bpm": 80}).json()["summary"] == {"avg_bpm": 80}
    assert client.post(f"/api/sessions/{session_id}/end").json()["summary"] is None
    assert client.post(f"/api/sessions/{session_id}/end", json={}).json()["summary"] is None
    assert client.post(f"/api/sessions/{session_id}/end", json={"summary": None}).json()["summary"] is None


def test_ending_twice_keeps_the_first_end_time(client):
    session_id = new_session(client)
    first = client.post(f"/api/sessions/{session_id}/end", json={"summary": {"a": 1}}).json()
    second = client.post(f"/api/sessions/{session_id}/end", json={"summary": {"a": 2}}).json()
    assert second["ended_at"] == first["ended_at"] and second["summary"] == {"a": 2}


def test_ending_a_run_that_does_not_exist_is_a_404(client):
    for session_id in (MISSING_ID, "nope"):
        assert client.post(f"/api/sessions/{session_id}/end", json={}).status_code == 404


def test_a_summary_that_is_too_big_or_not_plain_json_is_refused(client):
    session_id = new_session(client)
    path = f"/api/sessions/{session_id}/end"
    assert client.post(path, json={"summary": {"x": "y" * 70_000}}).status_code == 422
    assert_friendly_422(client.post(path, json={"summary": {"x": "y" * 70_000}}), "The summary is too big (at most 64 KB)")
    nan = client.post(path, content=b'{"summary": {"x": NaN}}', headers={"content-type": "application/json"})
    assert_friendly_422(nan, "plain JSON")
    nul = client.post(path, json={"summary": {"x": "a\u0000b"}})
    assert_friendly_422(nul, "null character")
    assert_friendly_422(client.post(path, json=["not", "an", "object"]), "request")


# --- listing runs -----------------------------------------------------------------------------------------------------

def test_runs_are_listed_newest_first(client, memory):
    ids = [new_session(client, tempo_ratio=0.5 + i / 10) for i in range(3)]
    listed = client.get("/api/sessions").json()
    assert [s["id"] for s in listed] == ids[::-1]
    assert set(listed[0]) == {"id", "song_id", "started_at", "ended_at", "tempo_ratio", "latency_offset_ms", "summary"}


def test_runs_can_be_filtered_by_song(client, memory):
    memory.upsert_song("upload-aaaaaaaa", "Other", "upload", None, 5)
    mine = new_session(client)
    other = new_session(client, song_id="upload-aaaaaaaa")
    assert [s["id"] for s in client.get("/api/sessions", params={"song_id": DEMO}).json()] == [mine]
    assert [s["id"] for s in client.get("/api/sessions", params={"song_id": "upload-aaaaaaaa"}).json()] == [other]
    assert client.get("/api/sessions", params={"song_id": "unknown"}).json() == []


def test_at_most_50_runs_come_back(client):
    ids = [new_session(client) for _ in range(55)]
    listed = client.get("/api/sessions").json()
    assert [s["id"] for s in listed] == ids[::-1][:50]
    assert len(client.get("/api/sessions", params={"limit": 5}).json()) == 5


def test_the_limit_must_make_sense(client):
    for limit in (0, 51, -1, "many"):
        assert client.get("/api/sessions", params={"limit": limit}).status_code == 422
    assert_friendly_422(client.get("/api/sessions", params={"limit": 51}), "limit must be at most 50")
    assert client.get("/api/sessions", params={"song_id": "x" * 101}).status_code == 422


# --- feedback ---------------------------------------------------------------------------------------------------------------

FEEDBACK = {"version": 1, "song_id": DEMO, "source": "rules", "summary": "Steady tempo."}


def test_feedback_is_saved_for_a_run(client, memory):
    session_id = new_session(client)
    response = client.post("/api/feedback-items", json={"session_id": session_id, "source": "rules", "feedback": FEEDBACK})
    assert response.status_code == 201 and uuid.UUID(response.json()["id"]) and set(response.json()) == {"id"}
    stored = memory.list_feedback(session_id)
    assert [(f["source"], f["feedback"]) for f in stored] == [("rules", FEEDBACK)]


def test_the_source_can_come_from_inside_the_feedback(client, memory):
    session_id = new_session(client)
    client.post("/api/feedback-items", json={"session_id": session_id, "feedback": {**FEEDBACK, "source": "gemini"}})
    assert memory.list_feedback(session_id)[0]["source"] == "gemini"


@pytest.mark.parametrize(
    ("changes", "words"),
    [
        ({"session_id": None}, ("session_id",)),
        ({"session_id": ""}, ("session_id needs at least 1",)),
        ({"feedback": None}, ("feedback must be an object",)),
        ({"feedback": "text"}, ("feedback must be an object",)),
        ({"source": "robot"}, ("source must be 'rules', 'gemini' or 'canned'",)),
        ({"source": None, "feedback": {"summary": "no source anywhere"}}, ("source must be rules, gemini or canned",)),
        ({"feedback": {"x": "y" * 140_000}}, ("The feedback is too big (at most 128 KB)",)),
    ],
)
def test_bad_feedback_gets_a_plain_422(client, changes, words):
    session_id = new_session(client)
    body = {"session_id": session_id, "source": "rules", "feedback": FEEDBACK, **changes}
    assert_friendly_422(client.post("/api/feedback-items", json=body), *words)


def test_feedback_for_a_missing_run_is_a_404(client):
    for session_id in (MISSING_ID, "nope"):
        response = client.post(
            "/api/feedback-items", json={"session_id": session_id, "source": "rules", "feedback": FEEDBACK}
        )
        assert response.status_code == 404


# --- creations --------------------------------------------------------------------------------------------------------------

LAYERS = [{"id": "l1", "instrument": "pluck", "notes": [{"pitch": 60, "start_sec": 0, "duration_sec": 0.5}]}, {"id": "l2"}]


def make_creation(client, **changes):
    return client.post("/api/creations", json={"name": "My tune", "tempo_bpm": 96, "layers": LAYERS, **changes})


def test_a_creation_is_saved_listed_and_opened(client, memory):
    created = make_creation(client)
    assert created.status_code == 201
    summary = created.json()
    assert set(summary) == {"id", "name", "tempo_bpm", "created_at", "layer_count"}
    assert (summary["name"], summary["tempo_bpm"], summary["layer_count"]) == ("My tune", 96.0, 2)

    listed = client.get("/api/creations").json()
    assert listed == [summary]  # no notes in the list

    opened = client.get(f"/api/creations/{summary['id']}")
    assert opened.status_code == 200
    assert opened.json() == {
        "id": summary["id"], "name": "My tune", "tempo_bpm": 96.0, "layers": LAYERS, "created_at": summary["created_at"]
    }


def test_creations_are_listed_newest_first_and_capped(client):
    ids = [make_creation(client, name=f"Tune {i}").json()["id"] for i in range(52)]
    assert [c["id"] for c in client.get("/api/creations").json()] == ids[::-1][:50]
    assert len(client.get("/api/creations", params={"limit": 3}).json()) == 3
    assert client.get("/api/creations", params={"limit": 51}).status_code == 422


def test_a_name_is_trimmed(client):
    assert make_creation(client, name="  Padded  ").json()["name"] == "Padded"


def test_a_creation_that_is_not_there_is_a_404(client):
    for creation_id in (MISSING_ID, "nope"):
        response = client.get(f"/api/creations/{creation_id}")
        assert response.status_code == 404 and response.json() == {"detail": sessions_api.NO_CREATION}


@pytest.mark.parametrize(
    ("changes", "words"),
    [
        ({"name": ""}, ("name needs at least 1",)),
        ({"name": "   "}, ("name needs at least 1",)),
        ({"name": "n" * 121}, ("name is too long (at most 120",)),
        ({"name": "line\nbreak"}, ("name cannot contain control characters",)),
        ({"name": None}, ("name must be text",)),
        ({"tempo_bpm": 0}, ("tempo_bpm must be more than 0",)),
        ({"tempo_bpm": 1001}, ("tempo_bpm must be at most 1000",)),
        ({"tempo_bpm": "quick"}, ("tempo_bpm must be a number",)),
        ({"layers": "none"}, ("layers must be a list",)),
        ({"layers": None}, ("layers must be a list",)),
        ({"layers": ["not an object"]}, ("layers.0 must be an object",)),
        ({"layers": [{}] * 65}, ("layers has too many items (at most 64)",)),
        ({"layers": [{"notes": "x" * 1_600_000}]}, ("The layers is too big (at most 1536 KB)",)),
        ({"layers": [{"a": "x\u0000y"}]}, ("null character",)),
    ],
)
def test_bad_creations_get_a_plain_422(client, changes, words):
    assert_friendly_422(make_creation(client, **changes), *words)
    assert client.get("/api/creations").json() == []


def test_missing_fields_are_all_named(client):
    assert_friendly_422(client.post("/api/creations", json={}), "name is required", "tempo_bpm is required", "layers is required")


def test_a_request_over_2_mb_is_refused_outright(client):
    huge = json.dumps({"name": "x", "tempo_bpm": 90, "layers": [{"blob": "y" * (2 * 1024 * 1024)}]})
    response = client.post("/api/creations", content=huge, headers={"content-type": "application/json"})
    assert response.status_code == 413 and "too big" in response.json()["detail"]
    lying = client.post("/api/creations", content=b"{}", headers={"content-type": "application/json", "content-length": str(10**9)})
    assert lying.status_code == 413


# --- the database is down ---------------------------------------------------------------------------------------------------------

def down_client():
    error = psycopg.OperationalError("connection to server failed")
    repository.set_repository(PostgresRepository("placeholder-address", connect=FakeDatabase(error=error)))
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


DOWN_CALLS = {
    "songs": lambda c: c.get("/api/songs"),
    "start": lambda c: start(c),
    "samples": lambda c: c.post(f"/api/sessions/{MISSING_ID}/samples", json=[{"metric": "m", "value": 1}]),
    "end": lambda c: c.post(f"/api/sessions/{MISSING_ID}/end", json={}),
    "sessions": lambda c: c.get("/api/sessions"),
    "feedback": lambda c: c.post(
        "/api/feedback-items", json={"session_id": MISSING_ID, "source": "rules", "feedback": FEEDBACK}),
    "creations": lambda c: c.get("/api/creations"),
    "create-creation": lambda c: make_creation(c),
    "creation": lambda c: c.get(f"/api/creations/{MISSING_ID}"),
}


@pytest.mark.parametrize("name", sorted(DOWN_CALLS))
def test_a_database_outage_is_a_friendly_503(name):
    response = DOWN_CALLS[name](down_client())
    assert response.status_code == 503
    assert response.json() == {"detail": sessions_api.UNAVAILABLE}
    assert "Traceback" not in response.text and "psycopg" not in response.text


def test_the_outage_check_covers_every_endpoint():
    assert len(router.routes) == len(DOWN_CALLS) == 9


def test_input_problems_are_reported_even_when_the_database_is_down():
    client = down_client()
    assert client.post("/api/sessions", json={}).status_code == 422
    assert make_creation(client, name="").status_code == 422


def test_an_unexpected_bug_is_a_plain_500_and_is_logged_without_details(client, memory, monkeypatch, caplog):
    def explode(*args, **kwargs):
        raise RuntimeError("secret-looking-marker")

    monkeypatch.setattr(memory, "list_sessions", explode)
    response = client.get("/api/sessions")
    assert response.status_code == 500
    assert response.json() == {"detail": sessions_api.SOMETHING_WRONG}
    assert "Unexpected RuntimeError" in caplog.text and "Traceback" not in caplog.text


def test_missing_things_still_come_back_as_404_not_500(client):
    assert client.get(f"/api/creations/{MISSING_ID}").status_code == 404


# --- a real database path, through a stand-in connection ------------------------------------------------------------------

def test_starting_a_run_against_a_database_saves_the_demo_song_first(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "placeholder-address")
    when = datetime(2026, 10, 17, 12, 0, tzinfo=UTC)
    run_id = uuid.uuid4()
    song_row = (DEMO, "Twinkle, Twinkle, Little Star", "demo", None, 28.8, when)
    session_row = (run_id, None, DEMO, when, None, 0.8, None, None)
    database = FakeDatabase(
        [[]],                       # is the song known? no
        [[song_row]],               # save the song
        [[], [(uuid.uuid4(), DEMO, 1, {}, when)]],  # save its analysis (replace, then insert)
        [[session_row]],            # start the run
    )
    monkeypatch.setattr(psycopg, "connect", database)
    app = FastAPI()
    app.include_router(router)
    response = TestClient(app).post("/api/sessions", json={"song_id": DEMO, "tempo_ratio": 0.8})
    assert response.status_code == 201 and response.json() == {"id": str(run_id)}
    assert [sql.split(" (")[0].split(" WHERE")[0] for sql, _ in database.statements] == [
        "SELECT id, title, source, file_name, duration_sec, created_at FROM songs",
        "INSERT INTO songs",
        "DELETE FROM analyses",
        "INSERT INTO analyses",
        "INSERT INTO practice_sessions",
    ]
    assert isinstance(repository.get_repository(), PostgresRepository)


# --- wiring ---------------------------------------------------------------------------------------------------------------

def test_the_routes_are_part_of_the_server_and_the_upload_still_works(memory, data_dir):
    from .main import app

    client = TestClient(app)
    assert client.get("/api/songs").status_code == 200
    assert client.get("/api/health").json() == {"status": "ok"}
    upload = client.post("/api/songs", files={"file": ("hum.wav", make_wav(), "audio/wav")})
    assert upload.status_code == 200 and upload.json()["song_id"].startswith("upload-")
    listed = client.get("/api/songs").json()
    assert [s["song_id"] for s in listed] == [DEMO, upload.json()["song_id"]]
    assert start(client).status_code == 201
    paths = client.get("/openapi.json").json()["paths"]
    for path in ("/api/sessions", "/api/sessions/{session_id}/samples", "/api/sessions/{session_id}/end",
                 "/api/feedback-items", "/api/creations", "/api/creations/{creation_id}", "/api/songs"):
        assert path in paths
