"""Development tests for tempo, beats, time signature and key. All audio is generated here; none is committed.

Skipped (with a message) when the heavy audio group is not installed: `uv sync --group analysis`.
"""

import json
import time
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

pytest.importorskip("librosa", reason="audio analysis group not installed (uv sync --group analysis)")
np = pytest.importorskip("numpy")
sf = pytest.importorskip("soundfile")

from analysis import tempo_key
from analysis.tempo_key import AnalysisError, analyze_file, analyze_tempo_key, load_audio

SR = 22050
CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"


def _validator() -> Draft202012Validator:
    registry = Registry()
    for path in sorted(CONTRACTS.glob("*.schema.json")):
        schema = json.loads(path.read_text(encoding="utf-8"))
        registry = registry.with_resource(schema["$id"], Resource.from_contents(schema))
    song_schema = json.loads((CONTRACTS / "song-analysis.schema.json").read_text(encoding="utf-8"))
    return Draft202012Validator(song_schema, registry=registry)


VALIDATOR = _validator()


def assert_valid(result: dict) -> None:
    """The result plus the fields the pipeline adds must be a valid song-analysis document."""
    doc = {**result, "version": 1, "song_id": "test-song", "parts": []}
    assert [e.message for e in VALIDATOR.iter_errors(doc)] == []
    assert all(b >= 0 for b in result["beats"])
    assert all(b2 > b1 for b1, b2 in zip(result["beats"], result["beats"][1:]))
    assert all(d in result["beats"] for d in result["downbeats"])


# --- signal generators -------------------------------------------------------------------------


def clicks(times, amps, seconds, freq=1500.0):
    """Short decaying sine bursts at the given times."""
    y = np.zeros(int(seconds * SR))
    t = np.arange(int(0.03 * SR)) / SR
    burst = np.sin(2 * np.pi * freq * t) * np.exp(-t / 0.006)
    for when, amp in zip(times, amps):
        i = round(when * SR)
        n = min(len(burst), len(y) - i)
        if n > 0:
            y[i : i + n] += amp * burst[:n]
    return y


def click_track(bpm, seconds=30.0, start=0.5, accents=(1.0,)):
    times = np.arange(start, seconds - 0.1, 60.0 / bpm)
    amps = [accents[i % len(accents)] for i in range(len(times))]
    return clicks(times, amps, seconds), times


def tone(midi, seconds, harmonics=(1.0, 0.5, 0.33, 0.25)):
    """A plucked-style note: a few harmonics with a fast attack and a gentle decay."""
    n = int(seconds * SR)
    t = np.arange(n) / SR
    f0 = 440.0 * 2 ** ((midi - 69) / 12)
    wave = sum(a * np.sin(2 * np.pi * f0 * (k + 1) * t) for k, a in enumerate(harmonics))
    env = np.minimum(t / 0.01, 1.0) * np.exp(-t / max(seconds, 0.3) / 1.2)
    return 0.3 * wave * env / sum(harmonics)


def render(notes, step=0.25):
    """notes: list of (midi, beats). Renders them one after another, `step` seconds per beat."""
    parts, total = [], 0.0
    for midi, beats in notes:
        parts.append((total, tone(midi, beats * step)))
        total += beats * step
    y = np.zeros(int((total + 0.5) * SR))
    for start, wave in parts:
        i = int(start * SR)
        y[i : i + len(wave)] += wave[: len(y) - i]
    return y


def passage(tonic_midi, mode, repeats=4):
    """Arpeggios over I - IV - V - I (or i - iv - V - i), ending on a long tonic. Tonic rich, as real tunes are."""
    third = 4 if mode == "major" else 3
    chords = [(0, third), (5, 4 if mode == "major" else 3), (7, 4), (0, third)]
    notes = []
    for _ in range(repeats):
        for ci, (root, t3) in enumerate(chords):
            r = tonic_midi + root
            shape = [r, r + t3, r + 7, r + 12, r + 7, r + t3]
            notes += [(m, 1) for m in shape]
            if ci == 3:
                notes += [(tonic_midi, 4)]
    return render(notes)


def with_clicks(y, bpm):
    t = np.arange(0.2, len(y) / SR - 0.1, 60.0 / bpm)
    return y + 0.3 * clicks(t, [1.0] * len(t), len(y) / SR)[: len(y)]


def worst_beat_error(beats, true_times):
    true_times = np.asarray(true_times)
    return max(float(np.min(np.abs(true_times - b))) for b in beats)


# --- tempo and beats ---------------------------------------------------------------------------


@pytest.mark.parametrize("bpm", [90, 100, 120, 140])
def test_click_track_tempo_and_beats(bpm):
    y, true = click_track(bpm)
    result = analyze_tempo_key(y, SR)
    assert_valid(result)
    assert abs(result["tempo_bpm"] - bpm) / bpm < 0.02
    assert worst_beat_error(result["beats"], true) < 0.04
    assert len(result["beats"]) >= 0.9 * len(true)  # nearly every click was found
    assert result["tempo_confidence"] > 0.7
    assert result["duration_sec"] == pytest.approx(30.0, abs=0.01)


def test_slow_click_track_stays_slow():
    y, true = click_track(60)
    result = analyze_tempo_key(y, SR)
    assert_valid(result)
    assert abs(result["tempo_bpm"] - 60) < 1.2
    assert worst_beat_error(result["beats"], true) < 0.04


def offbeat_track(offbeat_amp, bpm=60.0):
    """Beats at `bpm` with a click halfway between every pair."""
    beats = np.arange(0.5, 29.5, 60.0 / bpm)
    times = np.concatenate([beats, beats + 30.0 / bpm])
    amps = [1.0] * len(beats) + [offbeat_amp] * len(beats)
    return clicks(times, amps, 30.0), beats


def test_slow_pulse_with_clearly_weaker_offbeats_is_not_doubled():
    """60 BPM with off-beat clicks at 40 percent of the loudness: the music is 60, not 120.

    Our rule: off-beats under about 45 percent of the strength of the beats (measured in loudness
    change, so a click at 0.4 amplitude counts as 0.37) are decoration, so the slow pulse wins even
    though the beat tracker alone prefers 120. Off-beats at 50 percent or more are treated as real
    beats and give 120; see the next test. In between, the tracker's own choice stands.
    """
    y, beats = offbeat_track(0.4)
    result = analyze_tempo_key(y, SR)
    assert_valid(result)
    assert abs(result["tempo_bpm"] - 60) / 60 < 0.02
    assert worst_beat_error(result["beats"], beats) < 0.04


def test_ordinary_four_four_accents_are_not_mistaken_for_half_time():
    """Strong, weak, medium, weak at 120 BPM stays 120: only evenly strong beats can make a slower pulse."""
    y, _ = click_track(120, accents=(1.0, 0.3, 0.6, 0.3))
    result = analyze_tempo_key(y, SR)
    assert abs(result["tempo_bpm"] - 120) / 120 < 0.02
    assert result["time_signature"] == {"numerator": 4, "denominator": 4}


def test_equally_loud_offbeats_are_a_120_pulse():
    y, _ = offbeat_track(1.0)
    result = analyze_tempo_key(y, SR)
    assert abs(result["tempo_bpm"] - 120) / 120 < 0.02


@pytest.mark.parametrize("bpm,expected", [(170, 85), (200, 100)])
def test_too_fast_tempo_is_halved(bpm, expected):
    y, true = click_track(bpm)
    result = analyze_tempo_key(y, SR)
    assert abs(result["tempo_bpm"] - expected) / expected < 0.02
    assert worst_beat_error(result["beats"], true) < 0.04  # the kept beats are still on clicks
    assert tempo_key.TEMPO_LOW <= result["tempo_bpm"] <= tempo_key.TEMPO_HIGH


def test_sustained_chords_without_drums_do_not_report_a_bar_as_the_tempo():
    """Only the chord changes (every 2.4 s) make onsets. The tracker finds 25 BPM; we report a beat-sized
    tempo instead, with a confidence that says it is a guess."""
    y = np.zeros(30 * SR)
    for i, root in enumerate([60, 65, 67, 60] * 3):
        start = int(i * 2.4 * SR)
        chord = sum(tone(root + step, 2.4) for step in (0, 4, 7))
        y[start : start + len(chord)] += chord[: len(y) - start]
    result = analyze_tempo_key(y, SR)
    assert_valid(result)
    assert 45 <= result["tempo_bpm"] <= tempo_key.TEMPO_HIGH
    assert result["tempo_confidence"] < 0.7


# --- time signature ----------------------------------------------------------------------------


def test_three_four_with_accented_first_beats():
    y, true = click_track(100, accents=(1.0, 0.4, 0.4))
    result = analyze_tempo_key(y, SR)
    assert_valid(result)
    assert result["time_signature"] == {"numerator": 3, "denominator": 4}
    gaps = np.diff(result["downbeats"])
    assert np.allclose(gaps, 3 * 0.6, atol=0.04)
    accented = true[0::3]  # the downbeats must sit on the loud clicks
    assert worst_beat_error(result["downbeats"], accented) < 0.04


def test_four_four_with_accented_first_beats():
    y, true = click_track(100, accents=(1.0, 0.4, 0.6, 0.4))
    result = analyze_tempo_key(y, SR)
    assert result["time_signature"] == {"numerator": 4, "denominator": 4}
    assert np.allclose(np.diff(result["downbeats"]), 4 * 0.6, atol=0.04)
    assert worst_beat_error(result["downbeats"], true[0::4]) < 0.04


def test_plain_clicks_default_to_four_four():
    y, _ = click_track(110)
    assert analyze_tempo_key(y, SR)["time_signature"] == {"numerator": 4, "denominator": 4}


def test_six_eight_needs_a_clear_three_way_split():
    """Dotted-quarter pulses (100 per minute) each split into three clicks: report 6/8.

    Limit: 6/8 is only recognised when the beat tracker settles on the dotted-quarter pulse. At other
    pulse speeds it often locks onto the eighth notes instead and the piece reads as 3/4.
    """
    pulse = 60.0 / 100
    times, amps = [], []
    for k in range(40):
        for j in range(3):
            times.append(0.5 + k * pulse + j * pulse / 3)
            amps.append((1.0 if k % 2 == 0 else 0.7) if j == 0 else 0.5)
    y = clicks(times, amps, 0.5 + 40 * pulse)
    result = analyze_tempo_key(y, SR)
    assert_valid(result)
    assert result["time_signature"] == {"numerator": 6, "denominator": 8}


def test_straight_eighths_are_not_six_eight():
    beat = 0.5
    times, amps = [], []
    for k in range(60):
        times += [0.5 + k * beat, 0.5 + k * beat + beat / 2]
        amps += [1.0 if k % 4 == 0 else 0.7, 0.5]
    y = clicks(times, amps, 0.5 + 60 * beat)
    assert analyze_tempo_key(y, SR)["time_signature"]["denominator"] == 4


# --- key ---------------------------------------------------------------------------------------


KEY_CASES = [
    (60, "major", "C"),
    (69, "minor", "A"),
    (65, "major", "F"),
    (70, "major", "Bb"),
    (62, "major", "D"),
    (64, "minor", "E"),
    (63, "major", "Eb"),
    (66, "minor", "F#"),
]


@pytest.mark.parametrize("tonic_midi,mode,name", KEY_CASES)
def test_key_of_synthetic_passage(tonic_midi, mode, name):
    result = analyze_tempo_key(passage(tonic_midi, mode), SR)
    assert_valid(result)
    key = result["key"]
    assert (key["tonic"], key["mode"]) == (name, mode)
    assert 0.0 <= key["confidence"] <= 1.0
    assert {"tonic", "mode", "correlation"} <= set(key["runner_up"])
    assert (key["runner_up"]["tonic"], key["runner_up"]["mode"]) != (key["tonic"], key["mode"])


def test_flat_keys_are_spelled_with_flats():
    for tonic_midi, expected in [(65, "F"), (70, "Bb"), (63, "Eb"), (68, "Ab")]:
        assert analyze_tempo_key(passage(tonic_midi, "major"), SR)["key"]["tonic"] == expected


def test_clicks_have_no_key_so_confidence_is_low():
    y, _ = click_track(120)
    assert analyze_tempo_key(y, SR)["key"]["confidence"] < 0.5


def test_noise_and_drums_have_no_key():
    rng = np.random.default_rng(3)
    y, _ = click_track(100)
    noisy = y + 0.05 * rng.standard_normal(len(y))
    assert analyze_tempo_key(noisy, SR)["key"]["confidence"] < 0.15


def test_spelling_tables_use_only_contract_names():
    enum = json.loads((CONTRACTS / "song-analysis.schema.json").read_text(encoding="utf-8"))
    allowed = set(enum["properties"]["key"]["properties"]["tonic"]["enum"])
    assert set(tempo_key.MAJOR_NAMES) <= allowed
    assert set(tempo_key.MINOR_NAMES) <= allowed


# --- bad input ---------------------------------------------------------------------------------


def test_silence_is_a_plain_error():
    with pytest.raises(AnalysisError, match="silent"):
        analyze_tempo_key(np.zeros(SR * 10), SR)


def test_very_quiet_noise_counts_as_silence():
    rng = np.random.default_rng(1)
    with pytest.raises(AnalysisError):
        analyze_tempo_key(1e-6 * rng.standard_normal(SR * 10), SR)


@pytest.mark.parametrize("seconds", [0.0, 0.05, 0.5, 1.5])
def test_very_short_audio_is_a_plain_error(seconds):
    y, _ = click_track(120, seconds=max(seconds, 0.1))
    with pytest.raises(AnalysisError, match="too short"):
        analyze_tempo_key(y[: int(seconds * SR)], SR)


def test_white_noise_does_not_crash_and_is_not_trusted():
    rng = np.random.default_rng(2)
    try:
        result = analyze_tempo_key(0.2 * rng.standard_normal(SR * 12), SR)
    except AnalysisError as exc:
        assert str(exc)
        return
    assert_valid(result)
    assert result["tempo_confidence"] < 0.5
    assert result["key"]["confidence"] < 0.5


def test_odd_input_does_not_crash():
    y, _ = click_track(120, seconds=8)
    y[100:140] = np.nan
    assert_valid(analyze_tempo_key(y, SR))
    stereo = np.stack([y, y])  # channels first
    assert_valid(analyze_tempo_key(stereo, SR))


def test_unreadable_files_give_a_plain_error(tmp_path):
    junk = tmp_path / "junk.wav"
    junk.write_bytes(b"this is not audio" * 10)
    with pytest.raises(AnalysisError, match="couldn't read"):
        load_audio(junk)
    with pytest.raises(AnalysisError, match="couldn't read"):
        analyze_file(tmp_path / "missing.mp3")


# --- files, long input, speed ------------------------------------------------------------------


@pytest.mark.parametrize("extension", ["wav", "flac", "ogg", "mp3"])
def test_analyze_file_reads_common_formats(tmp_path, extension):
    if extension.upper() not in sf.available_formats():
        pytest.skip(f"this libsndfile cannot write {extension}")
    y, true = click_track(100, seconds=20)
    path = tmp_path / f"clicks.{extension}"
    sf.write(path, y, SR)
    result = analyze_file(path)
    assert_valid(result)
    assert abs(result["tempo_bpm"] - 100) < 2
    assert worst_beat_error(result["beats"], true) < 0.04


def test_other_sample_rates_and_stereo_files_work(tmp_path):
    y, true = click_track(100, seconds=20)
    wide = np.stack([y, y], axis=1)
    sf.write(tmp_path / "wide.wav", np.repeat(wide, 2, axis=0), 2 * SR)  # 44.1 kHz stereo
    result = analyze_file(tmp_path / "wide.wav")
    assert abs(result["tempo_bpm"] - 100) < 2
    assert worst_beat_error(result["beats"], true) < 0.04
    assert analyze_tempo_key(np.repeat(y, 2), 2 * SR)["duration_sec"] == pytest.approx(20.0, abs=0.01)


def test_analysis_is_capped_at_six_minutes(monkeypatch):
    monkeypatch.setattr(tempo_key, "MAX_SECONDS", 12)
    y, _ = click_track(120, seconds=20)
    result = analyze_tempo_key(y, SR)
    assert result["duration_sec"] == pytest.approx(12.0, abs=0.01)
    assert max(result["beats"]) <= 12.0


def test_three_minute_track_is_fast(capsys):
    y = with_clicks(passage(60, "major", repeats=20), 120)
    y = np.tile(y, int(np.ceil(180 * SR / len(y))))[: 180 * SR]
    started = time.perf_counter()
    result = analyze_tempo_key(y, SR)
    elapsed = time.perf_counter() - started
    with capsys.disabled():
        print(f"\n3-minute analysis took {elapsed:.1f} s")
    assert_valid(result)
    assert elapsed < 30
