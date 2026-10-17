"""The real analysis behind `POST /api/songs`. Audio is generated here (a click track at a known tempo with a tune on
top, written with the standard library's wave module); nothing is committed. Skipped when the audio libraries are
not installed (`uv sync --group analysis`). The pieces that need no libraries are in test_upload_wiring.py."""
import io
import logging
import wave

import pytest
from fastapi.testclient import TestClient

pytest.importorskip("librosa")
np = pytest.importorskip("numpy")

from analysis import melody, tempo_key
from analysis import test_separation as drums  # the tune with drum hits over it

from . import analyzer, config
from .main import app
from .test_api import assert_valid_analysis

SR = 22050
BPM = 120
SPB = 60.0 / BPM
LEAD = 0.5  # seconds before the first beat
# (MIDI pitch, beats): the first line of a well-known tune, in C major
TUNE = [
    (60, 1), (60, 1), (67, 1), (67, 1), (69, 1), (69, 1), (67, 2),
    (65, 1), (65, 1), (64, 1), (64, 1), (62, 1), (62, 1), (60, 2),
]  # fmt: skip


def tone(midi, seconds, harmonics=(1.0, 0.5, 0.33, 0.25, 0.15), level=0.3):
    t = np.arange(int(seconds * SR)) / SR
    freq = 440.0 * 2 ** ((midi - 69) / 12)
    wave_ = sum(a * np.sin(2 * np.pi * freq * (k + 1) * t) for k, a in enumerate(harmonics))
    edges = np.clip(np.minimum(t / 0.015, (seconds - t) / 0.02), 0, 1)
    return level * wave_ * edges / sum(harmonics)


def noise_clicks(times, seconds, amp=0.4, seed=0):
    """Short bursts of noise (a drum-like tick), so the pitch tracker never mistakes them for notes."""
    rng = np.random.default_rng(seed)
    y = np.zeros(int(seconds * SR))
    n = int(0.02 * SR)
    burst = rng.normal(0, 1, n) * np.exp(-np.arange(n) / (0.004 * SR))
    for when in times:
        i = round(when * SR)
        m = min(n, len(y) - i)
        if m > 0:
            y[i : i + m] += amp * burst[:m]
    return y


def melody_notes(bars):
    """[(pitch, onset_beat, beats)] filling `bars` bars of 4/4 with the tune over and over."""
    out, beat = [], 0.0
    while True:
        for pitch, length in TUNE:
            if beat + length > bars * 4:
                return out
            out.append((pitch, beat, length))
            beat += length


def song(bars=4, band=False):
    """Samples of a click track at 120 BPM with the tune on top. With `band`, chords, bass and drums join in."""
    notes = melody_notes(bars)
    seconds = bars * 4 * SPB + LEAD + 0.6
    y = np.zeros(int(seconds * SR))

    def add(start_sec, sound):
        i = int(start_sec * SR)
        m = min(len(sound), len(y) - i)
        if m > 0:
            y[i : i + m] += sound[:m]

    for pitch, onset, length in notes:
        add(LEAD + onset * SPB, tone(pitch, length * SPB - 0.04))
    y += noise_clicks(LEAD + np.arange(bars * 4) * SPB, seconds)
    if band:
        roots = (48, 53, 55, 48)
        chord_color = (1, 0.6, 0.4, 0.3, 0.2, 0.1)
        for bar in range(bars):
            root = roots[bar % 4]
            for beat in range(4):  # a chord struck on every beat
                for interval in (0, 4, 7):
                    add(LEAD + (bar * 4 + beat) * SPB, 0.8 * tone(root + 12 + interval, SPB * 0.95, chord_color))
            for half in range(8):  # a bass line in eighth notes
                add(LEAD + bar * 4 * SPB + half * SPB / 2, 1.2 * tone(root - 12, SPB * 0.45, (1, 0.5, 0.25)))
        y += noise_clicks(LEAD + np.arange(bars * 8) * SPB / 2, seconds, amp=0.5, seed=5)
    return y.astype(np.float32), notes


def wav_bytes(y, rate=SR, channels=1):
    pcm = (np.clip(y, -1, 1) * 32767).astype("<i2")
    if channels == 2:
        pcm = np.column_stack([pcm, pcm])
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


@pytest.fixture
def client():
    return TestClient(app)


def upload(client, data, name="my tune.wav", content_type="audio/wav"):
    return client.post("/api/songs", files={"file": (name, data, content_type)})


def files_left_behind():
    return [p.name for p in config.data_dir().rglob("*") if p.is_file()]


def tune_was_found(notes, found):
    """Every note played is among the notes found: the same pitch, starting within 60 ms."""
    return all(
        any(n["pitch"] == pitch and abs(n["onset_sec"] - (LEAD + onset * SPB)) <= 0.06 for n in found)
        for pitch, onset, _ in notes
    )


# --- a good recording ----------------------------------------------------------------------------------------------

def test_a_click_track_with_a_tune_is_analyzed_for_real(client):
    y, notes = song(bars=8)
    response = upload(client, wav_bytes(y))
    assert response.status_code == 200
    doc = response.json()
    assert_valid_analysis(doc)

    assert abs(doc["tempo_bpm"] - BPM) / BPM < 0.02
    assert doc["tempo_confidence"] > 0.7
    assert doc["duration_sec"] == pytest.approx(len(y) / SR, abs=0.05)
    assert (doc["key"]["tonic"], doc["key"]["mode"]) in {("C", "major"), ("A", "minor")}
    assert doc["time_signature"] == {"numerator": 4, "denominator": 4}
    assert len(doc["beats"]) >= 0.9 * 32 and set(doc["downbeats"]) <= set(doc["beats"])
    assert "warnings" not in doc and "sections" not in doc

    assert len(doc["parts"]) == 1
    part = doc["parts"][0]
    assert (part["id"], part["kind"]) == ("melody", "melody")
    assert tune_was_found(notes, part["notes"])
    assert len(part["notes"]) <= len(notes) + 1
    assert part.get("instrument") == melody.transposition_hint(part["notes"])  # only set when a range fits

    # the upload and the analysis were saved, and the song can be fetched again
    assert doc["song_id"].startswith("upload-") and doc["title"] == "my tune"
    assert len(list((config.data_dir() / "uploads").glob(doc["song_id"] + ".wav"))) == 1
    assert client.get(f"/api/songs/{doc['song_id']}/analysis").json() == doc


def test_a_44khz_stereo_file_is_read_too(client):
    y, notes = song(bars=4)
    response = upload(client, wav_bytes(np.repeat(y, 2), rate=44100, channels=2))
    assert response.status_code == 200
    doc = response.json()
    assert_valid_analysis(doc)
    assert abs(doc["tempo_bpm"] - BPM) / BPM < 0.02
    assert tune_was_found(notes, doc["parts"][0]["notes"])


# --- recordings that cannot be analyzed: 422, a plain sentence, nothing left on disk ---------------------------------

@pytest.mark.parametrize(
    ("what", "samples", "message"),
    [
        ("silence", np.zeros(SR * 3, dtype=np.float32), "This recording is silent, so there is nothing to analyze."),
        ("a very quiet hiss", np.random.default_rng(2).normal(0, 1e-5, SR * 3).astype(np.float32),
         "This recording is silent, so there is nothing to analyze."),
        ("a one second clip", song(bars=1)[0][:SR], "This recording is too short to analyze. Try one that is a few seconds long."),
        ("noise", np.random.default_rng(1).normal(0, 0.1, SR * 4).astype(np.float32), analyzer.ERROR_NO_MUSIC),
    ],
)  # fmt: skip
def test_recordings_with_nothing_to_analyze_get_a_friendly_422(client, what, samples, message):
    response = upload(client, wav_bytes(samples))
    assert response.status_code == 422, what
    assert response.json() == {"detail": message}
    assert files_left_behind() == []


def test_a_file_that_is_not_really_audio_gets_a_friendly_422(client):
    response = upload(client, b"this is not a sound file at all", name="broken.wav")
    assert response.status_code == 422
    assert response.json() == {"detail": "I couldn't read that audio file. Try a WAV, MP3, FLAC or OGG file."}
    assert files_left_behind() == []


def test_an_m4a_that_cannot_be_read_without_ffmpeg_says_which_tool_is_missing(client, monkeypatch):
    monkeypatch.setattr(analyzer.shutil, "which", lambda name: None)
    for name in ("song.m4a", "SONG.AAC"):
        response = upload(client, b"\x00\x00\x00\x18ftypM4A not really audio", name=name, content_type="audio/mp4")
        assert response.status_code == 422, name
        assert response.json() == {
            "detail": "That file type needs a tool this computer doesn't have. Please upload an MP3, WAV, FLAC or OGG file."
        }
    assert files_left_behind() == []


def test_a_broken_m4a_with_ffmpeg_installed_gets_the_ordinary_unreadable_message(client, monkeypatch):
    monkeypatch.setattr(analyzer.shutil, "which", lambda name: "/usr/bin/ffmpeg")
    response = upload(client, b"\x00\x00\x00\x18ftypM4A not really audio", name="song.m4a", content_type="audio/mp4")
    assert response.status_code == 422
    assert "couldn't read that audio file" in response.json()["detail"]
    assert files_left_behind() == []


# --- when only the melody step has a problem -----------------------------------------------------------------------

@pytest.mark.parametrize("error", [melody.AnalysisError("no melody here"), RuntimeError("a bug in the melody step")])
def test_when_the_melody_cannot_be_found_the_tempo_and_key_are_still_returned(client, monkeypatch, error):
    def fail(*args, **kwargs):
        raise error

    monkeypatch.setattr(melody, "extract_melody", fail)
    y, _ = song(bars=4)
    response = upload(client, wav_bytes(y))
    assert response.status_code == 200
    doc = response.json()
    assert_valid_analysis(doc)
    assert doc["parts"] == []
    assert doc["warnings"] == [
        "I couldn't find a single melody line in this song, so there is no sheet music, but the tempo and key are real."
    ]
    assert abs(doc["tempo_bpm"] - BPM) / BPM < 0.02 and doc["beats"] and doc["key"]["tonic"]
    assert client.get(f"/api/songs/{doc['song_id']}/analysis").json() == doc


def test_many_instruments_at_once_still_gives_the_melody_but_with_a_warning(client):
    y, _ = song(bars=8, band=True)
    response = upload(client, wav_bytes(y))
    assert response.status_code == 200
    doc = response.json()
    assert_valid_analysis(doc)
    assert doc["parts"], "the melody is still returned"
    assert doc["warnings"] == [
        (
            "This song has many instruments playing at once, so the notes may not be right. "
            "For the best sheet music, use a recording of one instrument playing alone."
        )
    ]
    assert abs(doc["tempo_bpm"] - BPM) / BPM < 0.02


def test_a_tune_buried_in_drum_hits_gets_its_notes_back_and_no_warning(client, caplog):
    caplog.set_level(logging.INFO)
    mix = drums.drum_mix(every=0.25)  # loud drum hits on every sixteenth, a quiet chord underneath
    first = melody.extract_melody(mix, SR, drums.BPM)
    assert analyzer.looks_like_full_mix(first), "with the drums left in this would have been called a full mix"
    p, r = drums.score(first, drums.TRUTH)

    response = upload(client, wav_bytes(mix))
    assert response.status_code == 200
    doc = response.json()
    assert_valid_analysis(doc)
    assert "warnings" not in doc
    found = doc["parts"][0]["notes"]
    p2, r2 = drums.score(found, drums.TRUTH)
    print(f"[analyzer] drums left in: precision {p:.2f} recall {r:.2f}; upload (drums taken out): precision {p2:.2f} recall {r2:.2f}")
    assert p2 >= 0.9 and r2 >= 0.9 and p2 > p + 0.3
    assert "second try without drums" in caplog.text


def test_a_tune_hidden_by_very_loud_drums_is_found_once_the_drums_are_out(client, caplog):
    caplog.set_level(logging.INFO)
    mix = drums.drum_mix(every=0.25, drums=2.0)  # drum hits twice as loud as the tune, on every sixteenth
    with pytest.raises(melody.AnalysisError):
        melody.extract_melody(mix, SR, drums.BPM)  # with the drums left in there is no melody to be found

    response = upload(client, wav_bytes(mix))
    assert response.status_code == 200
    doc = response.json()
    assert_valid_analysis(doc)
    assert doc["parts"], "the melody comes back instead of 'no melody'"
    found = doc["parts"][0]["notes"]
    p, r = drums.score(found, drums.TRUTH)
    print(f"[analyzer] very loud drums: no melody before; now {len(found)} notes, precision {p:.2f} recall {r:.2f}")
    assert r >= 0.9 and p >= 0.5
    assert (analyzer.WARNING_FULL_MIX in doc.get("warnings", [])) == analyzer.looks_like_full_mix(found)
    assert analyzer.WARNING_NO_MELODY not in doc.get("warnings", [])
    assert "Second try without drums for a song with no melody" in caplog.text


@pytest.mark.parametrize(
    "what",
    ["white noise", "pulsing noise", "random clicks", "drums alone on every beat", "drums alone on every sixteenth"],
)
def test_noise_and_drums_alone_never_become_a_melody(client, what):
    rng = np.random.default_rng(0)
    length = 20 * SR
    noise = rng.normal(0, 0.3, length)
    clicks = np.zeros(length)
    clicks[rng.integers(0, length, 400)] = rng.normal(0, 1, 400)
    samples = {
        "white noise": noise,
        "pulsing noise": noise * (0.5 + 0.5 * np.sin(2 * np.pi * 2 * np.arange(length) / SR)),
        "random clicks": clicks,
        "drums alone on every beat": drums.drum_hits(length, loudness=1.0),
        "drums alone on every sixteenth": drums.drum_hits(length, loudness=1.0, every=0.25),
    }[what]
    response = upload(client, wav_bytes(samples.astype(np.float32)))
    if response.status_code == 422:  # nothing that sounds like music: turned down, as before
        assert response.json() == {"detail": analyzer.ERROR_NO_MUSIC}
        assert files_left_behind() == []
    else:  # a steady beat but no melody: the tempo is kept, with no sheet music
        assert response.status_code == 200
        doc = response.json()
        assert doc["parts"] == [] and doc["warnings"] == [analyzer.WARNING_NO_MELODY]


def test_a_long_song_says_that_only_the_first_part_was_analyzed(client, monkeypatch):
    monkeypatch.setattr(tempo_key, "MAX_SECONDS", 6)  # stands in for the real six minutes
    y, _ = song(bars=6)  # 12.6 seconds
    doc = upload(client, wav_bytes(y)).json()
    assert_valid_analysis(doc)
    assert doc["warnings"] == [analyzer.WARNING_TOO_LONG]
    assert doc["duration_sec"] == pytest.approx(len(y) / SR, abs=0.05)  # the whole song, not just what was analyzed


# --- warm-up ---------------------------------------------------------------------------------------------------------

def test_the_warm_up_runs_both_steps_on_generated_sound():
    assert analyzer.warm_up() is True
