import os
import math
import random
import tempfile
import struct
import wave
from backend.core.audio_analyzer import (
    load_audio_segment,
    extract_temporal_features,
    extract_spectral_features,
    detect_root_note,
    classify_audio_waveform,
    hz_to_midi_note
)

def create_synthetic_wav(
    samples: list,
    sample_rate: int = 44100,
    sampwidth: int = 2
) -> str:
    """Helper to write synthetic audio samples to a temporary WAV file."""
    fd, path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(sampwidth)
        wf.setframerate(sample_rate)
        
        if sampwidth == 2:
            int_samples = [int(max(-1.0, min(1.0, s)) * 32767.0) for s in samples]
            raw_bytes = struct.pack(f"<{len(int_samples)}h", *int_samples)
        elif sampwidth == 4:
            float_samples = [float(s) for s in samples]
            raw_bytes = struct.pack(f"<{len(float_samples)}f", *float_samples)
        else:
            raise ValueError("Unsupported test sampwidth")
            
        wf.writeframes(raw_bytes)
        
    return path

def test_hz_to_midi_note():
    # 440 Hz -> A4
    note, midi_num, cents = hz_to_midi_note(440.0)
    assert note == "A4"
    assert midi_num == 69
    assert abs(cents) <= 1

    # 55 Hz -> A1
    note, midi_num, cents = hz_to_midi_note(55.0)
    assert note == "A1"
    assert midi_num == 33

    # 43.65 Hz -> F1 (approx 43.65 Hz)
    note, midi_num, cents = hz_to_midi_note(43.65)
    assert note == "F1"
    assert midi_num == 29

    # 32.7 Hz -> C1
    note, midi_num, cents = hz_to_midi_note(32.7)
    assert note == "C1"
    assert midi_num == 24

def test_808_classification_and_root_note():
    sr = 44100
    duration = 0.8  # 800ms
    freq = 43.65  # F1 note
    num_samples = int(sr * duration)
    
    # Generate 808: steady sine wave with exponential decay
    samples = []
    for i in range(num_samples):
        t = i / sr
        env = math.exp(-2.5 * t)  # decay over ~800ms
        s = math.sin(2.0 * math.pi * freq * t) * env
        samples.append(s)
        
    wav_path = create_synthetic_wav(samples, sr)
    try:
        res = classify_audio_waveform(wav_path)
        assert res["tag"] in ["808", "Bass"], f"Expected 808/Bass but got {res['tag']}"
        assert res["root_note"] == "F1", f"Expected root note F1 but got {res['root_note']}"
        assert res["confidence"] >= 0.8
    finally:
        if os.path.exists(wav_path):
            os.remove(wav_path)

def test_kick_classification():
    sr = 44100
    duration = 0.25  # 250ms
    num_samples = int(sr * duration)
    
    # Generate Kick: pitch sweep from 180 Hz down to 45 Hz with fast decay
    samples = []
    phase = 0.0
    for i in range(num_samples):
        t = i / sr
        # Pitch drops rapidly from 180 to 45 Hz in first 40ms
        inst_freq = 45.0 + 135.0 * math.exp(-80.0 * t)
        phase += 2.0 * math.pi * inst_freq / sr
        env = math.exp(-15.0 * t)  # fast decay ~200ms
        samples.append(math.sin(phase) * env)
        
    wav_path = create_synthetic_wav(samples, sr)
    try:
        res = classify_audio_waveform(wav_path)
        assert res["tag"] == "Kick", f"Expected Kick but got {res['tag']}"
        assert res["confidence"] >= 0.85
    finally:
        if os.path.exists(wav_path):
            os.remove(wav_path)

def test_hihat_classification():
    sr = 44100
    duration = 0.08  # 80ms
    num_samples = int(sr * duration)
    
    # Generate Hi-Hat: high frequency noise with short decay
    random.seed(42)
    samples = []
    for i in range(num_samples):
        t = i / sr
        env = math.exp(-40.0 * t)  # ultra fast decay ~60ms
        noise = (random.random() * 2.0 - 1.0)
        samples.append(noise * env)
        
    wav_path = create_synthetic_wav(samples, sr)
    try:
        res = classify_audio_waveform(wav_path)
        assert res["tag"] == "Hi-Hat", f"Expected Hi-Hat but got {res['tag']}"
    finally:
        if os.path.exists(wav_path):
            os.remove(wav_path)

def test_clap_classification():
    sr = 44100
    duration = 0.25  # 250ms
    num_samples = int(sr * duration)
    
    # Generate realistic Clap: 3 micro-transient bursts spaced 8ms apart + resonant 1.5kHz body
    random.seed(42)
    raw_noise = [random.random() * 2.0 - 1.0 for _ in range(num_samples)]
    
    # Bandpass filter around ~1.8 kHz (typical clap body)
    samples = [0.0] * num_samples
    burst_delays = [0, int(0.008 * sr), int(0.016 * sr)]
    
    for burst in burst_delays:
        for j in range(int(0.012 * sr)):
            idx = burst + j
            if idx < num_samples:
                t = j / sr
                env = math.exp(-150.0 * t)
                # Resonant band around 1800 Hz
                tone = math.sin(2.0 * math.pi * 1800.0 * t) * 0.6 + raw_noise[idx] * 0.4
                samples[idx] += tone * env

    wav_path = create_synthetic_wav(samples, sr)
    try:
        res = classify_audio_waveform(wav_path)
        assert res["tag"] in ["Clap", "Snare"], f"Expected Clap/Snare but got {res['tag']}"
    finally:
        if os.path.exists(wav_path):
            os.remove(wav_path)
                
def test_snare_classification():
    sr = 44100
    duration = 0.25  # 250ms
    num_samples = int(sr * duration)
    
    # Generate Snare: 200 Hz body tone + white noise snappy tail (single transient)
    random.seed(42)
    samples = []
    for i in range(num_samples):
        t = i / sr
        body_env = math.exp(-35.0 * t)
        noise_env = math.exp(-18.0 * t)
        body = math.sin(2.0 * math.pi * 200.0 * t) * body_env * 0.7
        noise = (random.random() * 2.0 - 1.0) * noise_env * 0.5
        samples.append(body + noise)
        
    wav_path = create_synthetic_wav(samples, sr)
    try:
        res = classify_audio_waveform(wav_path)
        assert res["tag"] in ["Snare", "Rim"], f"Expected Snare/Rim but got {res['tag']}"
    finally:
        if os.path.exists(wav_path):
            os.remove(wav_path)

def test_open_hat_classification():
    sr = 44100
    duration = 0.45  # 450ms long sustained cymbal
    num_samples = int(sr * duration)
    
    random.seed(42)
    samples = []
    for i in range(num_samples):
        t = i / sr
        env = math.exp(-6.0 * t)  # slow decay > 300ms
        noise = (random.random() * 2.0 - 1.0)
        samples.append(noise * env)
        
    wav_path = create_synthetic_wav(samples, sr)
    try:
        res = classify_audio_waveform(wav_path)
        assert res["tag"] in ["Open Hat", "Crash"], f"Expected Open Hat/Crash but got {res['tag']}"
    finally:
        if os.path.exists(wav_path):
            os.remove(wav_path)

def test_various_808_root_notes():
    sr = 44100
    test_cases = [
        (32.70, "C1"),
        (38.89, "D#1"),
        (49.00, "G1"),
        (65.41, "C2"),
    ]
    for freq, expected_note in test_cases:
        duration = 0.6
        num_samples = int(sr * duration)
        samples = [math.sin(2.0 * math.pi * freq * (i / sr)) * math.exp(-2.0 * (i / sr)) for i in range(num_samples)]
        wav_path = create_synthetic_wav(samples, sr)
        try:
            res = classify_audio_waveform(wav_path)
            assert res["root_note"] == expected_note, f"For freq {freq}Hz, expected {expected_note} but got {res['root_note']}"
        finally:
            if os.path.exists(wav_path):
                os.remove(wav_path)
