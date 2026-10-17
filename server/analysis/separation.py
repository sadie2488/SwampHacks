"""Take the drums out of a recording before the melody is looked for.

A full song has drums and cymbals that the pitch tracker mistakes for notes. `harmonic_part` keeps the
sustained, pitched sound and suppresses the short bursts: harmonic/percussive separation on the
spectrogram (librosa's median-filter method). It is a cheap first step, not real source separation: bass,
chords and other instruments stay in.

The heavy libraries (numpy, librosa) load on the first call, so importing this module is cheap and works
without them. `SeparationError` says so in plain words when they are missing.
"""
from __future__ import annotations

librosa = np = None  # the heavy libraries are loaded on first use

MAX_SECONDS = 360.0  # same limit as the melody step
N_FFT = 2048  # about 93 ms at 22050 Hz
HOP = 512  # about 23 ms: a quarter of the window, the standard overlap for rebuilding the sound
KERNEL = 31  # median filter size, in frames (along time) and bins (along pitch)
# How much clearer a sound must be harmonic than percussive to be kept (1 = plain split). Measured on
# generated drum mixes: 1.5 gave the best notes; 2 and above started to eat the start of the notes.
MARGIN = 1.5
# Above this the bins are left out of the separation (and out of the result): the melody range ends near
# 2.1 kHz, and its first overtones sit well below this, so only hiss and cymbals live up here.
TOP_HZ = 6000.0


class SeparationError(Exception):
    """The sound could not be separated. The message is plain words."""


def _load_libraries() -> None:
    global librosa, np
    if np is not None:
        return
    try:
        import librosa as _librosa
        import numpy as _numpy
    except ImportError as err:
        raise SeparationError("The music analysis tools are not installed on this server.") from err
    librosa, np = _librosa, _numpy


def harmonic_part(y, sr: int, *, max_seconds: float = MAX_SECONDS, margin: float = MARGIN):
    """`y` with drums and other short bursts suppressed: mono float32 samples at the same rate `sr`.

    `y` is mono audio (or channels x samples). Only the first `max_seconds` are used, so the result may be
    shorter than `y`. Loudness is not matched to the input (the melody step normalizes it anyway).
    Raises `SeparationError` when the sound is empty or silent, or the libraries are missing.
    """
    _load_libraries()
    audio = np.nan_to_num(np.asarray(y, dtype=np.float32))
    if audio.ndim > 1:
        if audio.shape[0] > audio.shape[1]:
            audio = audio.T
        audio = audio.mean(axis=0)
    audio = audio[: int(max_seconds * sr)]
    if audio.size < N_FFT or float(np.max(np.abs(audio))) < 1e-4:
        raise SeparationError("The recording is too short or too quiet to separate.")

    spec = librosa.stft(audio, n_fft=N_FFT, hop_length=HOP)
    top = min(spec.shape[0], int(TOP_HZ / (sr / N_FFT)) + 1)
    kept = np.zeros_like(spec)
    kept[:top] = librosa.decompose.hpss(spec[:top], kernel_size=KERNEL, margin=margin)[0]
    return librosa.istft(kept, hop_length=HOP, length=audio.size).astype(np.float32)
