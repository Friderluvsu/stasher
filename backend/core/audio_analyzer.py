import os
import math
import struct
import wave
import logging
from typing import Optional, Dict, Any, Tuple, List

logger = logging.getLogger(__name__)

# Note mapping constants for Pitch / Root Note detection
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

def hz_to_midi_note(freq_hz: float) -> Tuple[str, int, int]:
    """
    Converts frequency in Hz to (note_name_with_octave, midi_number, cents_offset).
    Example: 55.0 Hz -> ('A1', 33, 0)
    """
    if freq_hz <= 0:
        return ("Unknown", 0, 0)
    
    midi_num_float = 69.0 + 12.0 * math.log2(freq_hz / 440.0)
    midi_num_round = int(round(midi_num_float))
    cents_offset = int(round((midi_num_float - midi_num_round) * 100))
    
    note_idx = midi_num_round % 12
    octave = (midi_num_round // 12) - 1
    note_name = f"{NOTE_NAMES[note_idx]}{octave}"
    
    return (note_name, midi_num_round, cents_offset)


def load_audio_segment(
    file_path: str,
    max_duration_sec: float = 0.6,
    target_sr: int = 44100
) -> Optional[Tuple[List[float], int, float]]:
    """
    Fast loader for audio files. Reads up to `max_duration_sec` of raw PCM audio.
    Supports 16-bit, 24-bit, and 32-bit (PCM and float) WAV files.
    Returns: (mono_samples_normalized_float, sample_rate, total_duration_seconds) or None on failure.
    """
    if not file_path or not os.path.exists(file_path) or not os.path.isfile(file_path):
        return None

    try:
        # 1. Try standard Python `wave` module
        with wave.open(file_path, "rb") as wf:
            nchannels = wf.getnchannels()
            sampwidth = wf.getsampwidth()
            framerate = wf.getframerate()
            nframes = wf.getnframes()

            if framerate <= 0 or nframes <= 0:
                return None

            total_duration = nframes / float(framerate)
            frames_to_read = min(nframes, int(framerate * max_duration_sec))
            raw_bytes = wf.readframes(frames_to_read)

            samples: List[float] = []

            if sampwidth == 2:  # 16-bit PCM
                count = len(raw_bytes) // 2
                fmt = f"<{count}h"
                int_samples = struct.unpack(fmt, raw_bytes)
                if nchannels == 1:
                    samples = [s / 32768.0 for s in int_samples]
                else:
                    # Convert stereo/multichannel to mono by averaging
                    samples = [
                        sum(int_samples[i * nchannels : (i + 1) * nchannels]) / (nchannels * 32768.0)
                        for i in range(len(int_samples) // nchannels)
                    ]

            elif sampwidth == 3:  # 24-bit PCM
                num_samples = len(raw_bytes) // 3
                raw_int_samples = []
                for i in range(num_samples):
                    b = raw_bytes[i * 3 : (i + 1) * 3]
                    # Sign-extend 24-bit to 32-bit int
                    val = int.from_bytes(b, byteorder="little", signed=True)
                    raw_int_samples.append(val / 8388608.0)

                if nchannels == 1:
                    samples = raw_int_samples
                else:
                    samples = [
                        sum(raw_int_samples[i * nchannels : (i + 1) * nchannels]) / nchannels
                        for i in range(len(raw_int_samples) // nchannels)
                    ]

            elif sampwidth == 4:  # 32-bit int or float
                try:
                    count = len(raw_bytes) // 4
                    fmt = f"<{count}f"
                    float_samples = struct.unpack(fmt, raw_bytes)
                    if nchannels == 1:
                        samples = list(float_samples)
                    else:
                        samples = [
                            sum(float_samples[i * nchannels : (i + 1) * nchannels]) / nchannels
                            for i in range(len(float_samples) // nchannels)
                        ]
                except Exception:
                    count = len(raw_bytes) // 4
                    fmt = f"<{count}i"
                    int_samples = struct.unpack(fmt, raw_bytes)
                    if nchannels == 1:
                        samples = [s / 2147483648.0 for s in int_samples]
                    else:
                        samples = [
                            sum(int_samples[i * nchannels : (i + 1) * nchannels]) / (nchannels * 2147483648.0)
                            for i in range(len(int_samples) // nchannels)
                        ]
            else:
                return None

            if not samples:
                return None

            return (samples, framerate, total_duration)

    except Exception as e:
        logger.debug(f"Direct wave read error for {file_path}: {e}")

    # 2. Fallback: Parse RIFF WAV headers manually for non-standard WAV chunks
    try:
        with open(file_path, "rb") as f:
            header = f.read(12)
            if len(header) >= 12 and header[:4] == b"RIFF" and header[8:12] == b"WAVE":
                # Basic RIFF parser
                framerate = 44100
                nchannels = 2
                sampwidth = 2
                while True:
                    chunk_header = f.read(8)
                    if len(chunk_header) < 8:
                        break
                    chunk_id, chunk_size = struct.unpack("<4sI", chunk_header)
                    if chunk_id == b"fmt ":
                        fmt_data = f.read(chunk_size)
                        audio_format, nchannels, framerate, _, _, bits_per_sample = struct.unpack("<HHIIHH", fmt_data[:16])
                        sampwidth = bits_per_sample // 8
                    elif chunk_id == b"data":
                        max_bytes = min(chunk_size, int(framerate * nchannels * sampwidth * max_duration_sec))
                        raw_bytes = f.read(max_bytes)
                        if sampwidth == 2:
                            count = len(raw_bytes) // 2
                            int_samples = struct.unpack(f"<{count}h", raw_bytes)
                            samples = [
                                sum(int_samples[i * nchannels : (i + 1) * nchannels]) / (nchannels * 32768.0)
                                for i in range(len(int_samples) // nchannels)
                            ]
                            return (samples, framerate, chunk_size / float(framerate * nchannels * sampwidth))
                        break
                    else:
                        f.seek(chunk_size, 1)
    except Exception as e:
        logger.debug(f"Manual RIFF parse error for {file_path}: {e}")

    return None


def extract_temporal_features(samples: List[float], sample_rate: int) -> Dict[str, float]:
    """
    Extracts time-domain envelope descriptors:
    - attack_time_ms: time to reach peak absolute amplitude
    - decay_time_ms: time for envelope to drop below 10% (-20dB) of peak amplitude
    - multi_peak_count_30ms: number of micro-attack transient peaks in the first 30ms (Clap detection)
    - rms: root mean square energy
    - peak: peak amplitude
    - zcr: zero crossing rate
    """
    if not samples:
        return {
            "attack_time_ms": 0.0,
            "decay_time_ms": 0.0,
            "multi_peak_count_30ms": 0.0,
            "rms": 0.0,
            "peak": 0.0,
            "zcr": 0.0
        }

    abs_samples = [abs(s) for s in samples]
    peak_val = max(abs_samples)
    if peak_val < 1e-5:
        return {
            "attack_time_ms": 0.0,
            "decay_time_ms": 0.0,
            "multi_peak_count_30ms": 0.0,
            "rms": 0.0,
            "peak": 0.0,
            "zcr": 0.0
        }

    peak_idx = abs_samples.index(peak_val)
    attack_time_ms = (peak_idx / float(sample_rate)) * 1000.0

    # Smooth envelope using moving RMS window (5ms window)
    window_len = max(1, int(sample_rate * 0.005))
    num_windows = len(samples) // window_len
    envelope = []
    for w in range(num_windows):
        win_samples = samples[w * window_len : (w + 1) * window_len]
        win_rms = math.sqrt(sum(s * s for s in win_samples) / float(window_len))
        envelope.append(win_rms)

    env_peak = max(envelope) if envelope else 1e-5
    env_peak_idx = envelope.index(env_peak) if envelope else 0

    # Decay time to -20dB (10% of peak RMS)
    decay_thresh = env_peak * 0.10
    decay_win_idx = len(envelope)
    for i in range(env_peak_idx, len(envelope)):
        if envelope[i] < decay_thresh:
            decay_win_idx = i
            break

    decay_time_ms = ((decay_win_idx - env_peak_idx) * window_len / float(sample_rate)) * 1000.0

    # Multi-peak count in the first 35ms (Transient bursts for Clap detection)
    samples_35ms = int(sample_rate * 0.035)
    env_35ms_win = max(1, int(sample_rate * 0.002))  # 2ms resolution
    sub_env = []
    for w in range(min(len(samples), samples_35ms) // env_35ms_win):
        win_samples = samples[w * env_35ms_win : (w + 1) * env_35ms_win]
        sub_env.append(math.sqrt(sum(s * s for s in win_samples) / float(env_35ms_win)))

    # Count local peaks with valleys
    multi_peaks = 0
    sub_peak_max = max(sub_env) if sub_env else 0.0
    thresh_sub = sub_peak_max * 0.30
    for i in range(1, len(sub_env) - 1):
        if sub_env[i] > thresh_sub and sub_env[i] > sub_env[i - 1] and sub_env[i] > sub_env[i + 1]:
            multi_peaks += 1

    # Zero Crossing Rate (ZCR)
    zero_crossings = 0
    for i in range(1, len(samples)):
        if (samples[i] >= 0 and samples[i - 1] < 0) or (samples[i] < 0 and samples[i - 1] >= 0):
            zero_crossings += 1
    zcr = zero_crossings / float(len(samples))

    total_rms = math.sqrt(sum(s * s for s in samples) / float(len(samples)))

    return {
        "attack_time_ms": attack_time_ms,
        "decay_time_ms": decay_time_ms,
        "multi_peak_count_30ms": float(multi_peaks),
        "rms": total_rms,
        "peak": peak_val,
        "zcr": zcr
    }


def extract_spectral_features(samples: List[float], sample_rate: int) -> Dict[str, float]:
    """
    Computes FFT spectral characteristics:
    - spectral_centroid: Center of mass of frequency spectrum (Hz)
    - sub_energy_ratio: Energy in 20-90 Hz
    - bass_energy_ratio: Energy in 90-250 Hz
    - mid_energy_ratio: Energy in 250-3500 Hz
    - high_energy_ratio: Energy in 3500-20000 Hz
    - pitch_drop_ratio: Ratio between initial attack frequency and settled frequency
    """
    n = len(samples)
    if n < 64:
        return {
            "spectral_centroid": 1000.0,
            "sub_energy_ratio": 0.0,
            "bass_energy_ratio": 0.0,
            "mid_energy_ratio": 0.0,
            "high_energy_ratio": 0.0,
            "pitch_drop_ratio": 1.0,
            "dominant_freq": 0.0
        }

    try:
        import numpy as np
        arr = np.array(samples, dtype=np.float32)
        # Apply Hanning window
        window = np.hanning(len(arr))
        windowed = arr * window
        
        # FFT
        fft_complex = np.fft.rfft(windowed)
        magnitude = np.abs(fft_complex)
        power = magnitude ** 2
        freqs = np.fft.rfftfreq(len(arr), d=1.0 / sample_rate)

        total_power = float(np.sum(power))
        if total_power < 1e-9:
            return {
                "spectral_centroid": 1000.0,
                "sub_energy_ratio": 0.0,
                "bass_energy_ratio": 0.0,
                "mid_energy_ratio": 0.0,
                "high_energy_ratio": 0.0,
                "pitch_drop_ratio": 1.0,
                "dominant_freq": 0.0
            }

        # Spectral Centroid
        centroid = float(np.sum(freqs * magnitude) / (np.sum(magnitude) + 1e-9))

        # Band energy ratios
        sub_mask = (freqs >= 20) & (freqs < 90)
        bass_mask = (freqs >= 90) & (freqs < 250)
        mid_mask = (freqs >= 250) & (freqs < 3500)
        high_mask = (freqs >= 3500) & (freqs <= 20000)

        sub_energy = float(np.sum(power[sub_mask])) / total_power
        bass_energy = float(np.sum(power[bass_mask])) / total_power
        mid_energy = float(np.sum(power[mid_mask])) / total_power
        high_energy = float(np.sum(power[high_mask])) / total_power

        # Dominant frequency
        dominant_idx = int(np.argmax(magnitude))
        dominant_freq = float(freqs[dominant_idx])

        # Pitch drop detection (Kick drum detection: 150Hz -> 50Hz drop)
        samples_25ms = int(sample_rate * 0.025)
        samples_70ms = int(sample_rate * 0.070)
        
        pitch_drop_ratio = 1.0
        if len(arr) >= samples_70ms and samples_25ms >= 128:
            seg1 = arr[:samples_25ms]
            seg2 = arr[samples_25ms:samples_70ms]
            
            fft1 = np.abs(np.fft.rfft(seg1 * np.hanning(len(seg1))))
            freqs1 = np.fft.rfftfreq(len(seg1), d=1.0 / sample_rate)
            mask1 = (freqs1 >= 35) & (freqs1 <= 350)
            if np.any(mask1):
                idx1 = np.argmax(fft1 * mask1)
                f1 = freqs1[idx1]
            else:
                f1 = dominant_freq

            fft2 = np.abs(np.fft.rfft(seg2 * np.hanning(len(seg2))))
            freqs2 = np.fft.rfftfreq(len(seg2), d=1.0 / sample_rate)
            mask2 = (freqs2 >= 30) & (freqs2 <= 250)
            if np.any(mask2):
                idx2 = np.argmax(fft2 * mask2)
                f2 = freqs2[idx2]
            else:
                f2 = dominant_freq

            if f2 > 10.0:
                pitch_drop_ratio = float(f1 / f2)

        return {
            "spectral_centroid": centroid,
            "sub_energy_ratio": sub_energy,
            "bass_energy_ratio": bass_energy,
            "mid_energy_ratio": mid_energy,
            "high_energy_ratio": high_energy,
            "pitch_drop_ratio": pitch_drop_ratio,
            "dominant_freq": dominant_freq
        }

    except ImportError:
        return {
            "spectral_centroid": 1000.0,
            "sub_energy_ratio": 0.25,
            "bass_energy_ratio": 0.25,
            "mid_energy_ratio": 0.25,
            "high_energy_ratio": 0.25,
            "pitch_drop_ratio": 1.0,
            "dominant_freq": 100.0
        }


def detect_root_note(
    samples: List[float],
    sample_rate: int,
    min_freq: float = 25.0,
    max_freq: float = 450.0
) -> Optional[Dict[str, Any]]:
    """
    Detects the fundamental frequency (f0) and musical root note for 808s, Sub Basses, and tonal sounds.
    Uses Autocorrelation combined with parabolic interpolation on the sustained segment of the audio.
    Returns: {"root_note": "F1", "frequency_hz": 43.65, "midi_pitch": 29, "cents": 0, "confidence": 0.95}
    """
    if not samples or len(samples) < 512:
        return None

    try:
        import numpy as np
        arr = np.array(samples, dtype=np.float32)

        # Focus on the sustained segment (skip initial click/attack transients e.g. first 20ms)
        skip_samples = int(sample_rate * 0.020)
        sustained = arr[skip_samples:] if len(arr) > skip_samples + 1024 else arr

        n = len(sustained)
        if n < 512:
            sustained = arr
            n = len(sustained)

        # Normalized autocorrelation via FFT
        f_size = 1 << (2 * n - 1).bit_length()
        fft_s = np.fft.rfft(sustained, n=f_size)
        corr = np.fft.irfft(fft_s * np.conj(fft_s))[:n]

        if corr[0] <= 1e-9:
            return None
        corr = corr / corr[0]

        # Search lag range corresponding to min_freq and max_freq
        min_lag = int(sample_rate / max_freq)
        max_lag = int(sample_rate / min_freq)
        max_lag = min(max_lag, n - 2)

        if min_lag >= max_lag or max_lag >= len(corr) - 1:
            return None

        search_slice = corr[min_lag:max_lag]
        if len(search_slice) == 0:
            return None

        peak_sub_idx = int(np.argmax(search_slice))
        peak_idx = min_lag + peak_sub_idx
        peak_corr = float(corr[peak_idx])

        # If autocorrelation peak is moderate or low, try FFT low peak fallback
        if peak_corr < 0.25:
            windowed = sustained * np.hanning(len(sustained))
            fft_mag = np.abs(np.fft.rfft(windowed))
            freqs = np.fft.rfftfreq(len(sustained), d=1.0 / sample_rate)
            mask = (freqs >= min_freq) & (freqs <= max_freq)
            if not np.any(mask):
                return None
            best_idx = np.argmax(fft_mag * mask)
            best_freq = float(freqs[best_idx])
            note_name, midi_num, cents = hz_to_midi_note(best_freq)
            return {
                "root_note": note_name,
                "frequency_hz": round(best_freq, 2),
                "midi_pitch": midi_num,
                "cents": cents,
                "confidence": 0.60
            }

        # Parabolic interpolation for fine frequency accuracy
        alpha = float(corr[peak_idx - 1])
        beta = float(corr[peak_idx])
        gamma = float(corr[peak_idx + 1])
        delta = 0.5 * (alpha - gamma) / (alpha - 2.0 * beta + gamma + 1e-9)
        true_lag = peak_idx + delta

        freq = sample_rate / true_lag
        note_name, midi_num, cents = hz_to_midi_note(freq)

        return {
            "root_note": note_name,
            "frequency_hz": round(freq, 2),
            "midi_pitch": midi_num,
            "cents": cents,
            "confidence": round(min(1.0, peak_corr * 1.1), 2)
        }

    except Exception as e:
        logger.debug(f"Root note detection error: {e}")
        return None


def classify_audio_waveform(
    file_path: str,
    raw_sample_data: Optional[Tuple[List[float], int, float]] = None
) -> Dict[str, Any]:
    """
    Performs full DSP acoustic feature extraction and deterministic drum/instrument classification.
    Returns:
    {
        "tag": "Kick" | "808" | "Snare" | "Clap" | "Hi-Hat" | "Open Hat" | "Rim" | "Perc" | "Bass" | "Melody",
        "root_note": Optional[str], # e.g. "F1", "C#1"
        "confidence": float,
        "metrics": dict
    }
    """
    audio_data = raw_sample_data or load_audio_segment(file_path, max_duration_sec=0.6)
    if not audio_data:
        return {
            "tag": "Other",
            "root_note": None,
            "confidence": 0.0,
            "metrics": {}
        }

    samples, sample_rate, total_duration = audio_data
    temporal = extract_temporal_features(samples, sample_rate)
    spectral = extract_spectral_features(samples, sample_rate)

    centroid = spectral["spectral_centroid"]
    sub_ratio = spectral["sub_energy_ratio"]
    bass_ratio = spectral["bass_energy_ratio"]
    mid_ratio = spectral["mid_energy_ratio"]
    high_ratio = spectral["high_energy_ratio"]
    pitch_drop = spectral["pitch_drop_ratio"]
    decay_ms = temporal["decay_time_ms"]
    multi_peaks = temporal["multi_peak_count_30ms"]
    zcr = temporal["zcr"]
    attack_ms = temporal["attack_time_ms"]

    detected_note = None
    root_note_info = None

    # Run root note detection if there is noticeable low-end / sub content
    if sub_ratio + bass_ratio > 0.30 or centroid < 800:
        root_note_info = detect_root_note(samples, sample_rate)
        if root_note_info:
            detected_note = root_note_info["root_note"]

    # ─── DECISION TREE CLASSIFIER ───
    classified_tag = "Other"
    confidence = 0.80

    # 1. Sub-Bass & 808 vs Kick
    if (sub_ratio + bass_ratio > 0.45) or (centroid < 450 and sub_ratio > 0.25):
        # Kick: sharp pitch drop (> 1.35), shorter decay (< 400ms), sub/bass concentrated
        if pitch_drop >= 1.35 or (decay_ms < 320 and total_duration < 0.6):
            classified_tag = "Kick"
            confidence = 0.92
        else:
            # 808 / Sub Bass: sustained low sine tone, long decay (> 400ms), steady pitch
            classified_tag = "808"
            confidence = 0.95

    # 2. Clap: Multiple micro-attacks in first 35ms + prominent mid energy (1-3.5 kHz)
    elif multi_peaks >= 2 and (mid_ratio > 0.30 or (centroid < 5500 and mid_ratio > 0.20)):
        classified_tag = "Clap"
        confidence = 0.92

    # 3. High Frequency Cymbals: Hi-Hat vs Open Hat vs Crash (single hit, negligible low-end)
    elif (centroid > 4200 or high_ratio > 0.45 or zcr > 0.22) and (sub_ratio + bass_ratio < 0.12):
        if decay_ms < 140 and total_duration < 0.25:
            classified_tag = "Hi-Hat"
            confidence = 0.95
        elif decay_ms >= 140 or total_duration >= 0.25:
            classified_tag = "Open Hat" if decay_ms < 600 else "Crash"
            confidence = 0.90

    # 4. Snare: Mid-range punch (180-300Hz) / body + snappy noise tail, single transient impulse
    elif (mid_ratio > 0.30 or bass_ratio > 0.10 or (centroid >= 800 and centroid <= 5000)) and (sub_ratio < 0.30):
        if attack_ms < 25 and decay_ms < 450:
            classified_tag = "Snare"
            confidence = 0.90
        elif decay_ms < 100 and centroid > 800:
            classified_tag = "Rim"
            confidence = 0.85
        else:
            classified_tag = "Perc"
            confidence = 0.80

    # 5. Rim / Perc: High resonance, fast decay
    elif centroid >= 500 and centroid < 2500 and decay_ms < 130:
        classified_tag = "Rim" if attack_ms < 10 else "Perc"
        confidence = 0.85

    # 6. Bass / Synth / Tonal
    elif sub_ratio + bass_ratio > 0.30 and detected_note:
        classified_tag = "Bass"
        confidence = 0.85

    # 7. Melody / Instrumental Loops
    elif total_duration > 1.2 or (centroid > 400 and decay_ms > 500):
        classified_tag = "Melody"
        confidence = 0.75

    return {
        "tag": classified_tag,
        "root_note": detected_note,
        "confidence": confidence,
        "metrics": {
            "centroid_hz": round(centroid, 1),
            "decay_ms": round(decay_ms, 1),
            "multi_peaks": int(multi_peaks),
            "zcr": round(zcr, 3),
            "sub_ratio": round(sub_ratio, 2),
            "pitch_drop": round(pitch_drop, 2),
            "root_note_detail": root_note_info
        }
    }
