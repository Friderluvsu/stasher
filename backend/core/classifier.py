import os
import re
from typing import List, Dict, Any, Optional

# Pre-compiled regex patterns for instrument & sound categorization
# Drums (Kick, Snare, Clap, Hi-Hat, etc.) come first so "808 Snare" or "TR-808 Clap" is classified as Snare/Clap
TAG_RULES = [
    ("Kick", re.compile(r"\b(kick|kck|bd|bassdrum|kickdrum|кик|бочка)\b", re.I)),
    ("Snare", re.compile(r"\b(snare|snr|sd|снейр|рабочий)\b", re.I)),
    ("Clap", re.compile(r"\b(clap|clp|snap|клеп|клап|хлопок)\b", re.I)),
    ("Open Hat", re.compile(r"\b(openhat|open-hat|open\s*hat|open_hat|oh|ophat|открытый\s*хэт)\b", re.I)),
    ("Hi-Hat", re.compile(r"\b(hihat|hi-hat|hi\s*hat|hi_hat|hh|hat|closedhat|cl_hat|hats|хэт|хэты)\b", re.I)),
    ("Rim", re.compile(r"\b(rim|rimshot|cross-stick|sidestick|рим|римшот)\b", re.I)),
    ("Perc", re.compile(r"\b(perc|percussion|conga|bongo|shaker|tamb|tambourine|cowbell|перк|перкуссия|шейкер)\b", re.I)),
    ("Tom", re.compile(r"\b(tom|toms|floor-tom|rack-tom|roto|том)\b", re.I)),
    ("Crash", re.compile(r"\b(crash|cymbal|ride|splash|china|крэш|райд)\b", re.I)),
    ("808", re.compile(r"\b(808|808s|sub|subbass|sub-bass|dist808|spinz|wheezy808|reese|саб)\b", re.I)),
    ("Bass", re.compile(r"\b(bass|synthbass|slapbass|electricbass|acid|fretless|бас)\b", re.I)),
    ("Chords", re.compile(r"\b(chord|chords|pad|pads|keys|piano|rhodes|organ|strum|аккорды|пэд|клавиши|пианино|keyscape)\b", re.I)),
    ("Lead", re.compile(r"\b(lead|synthlead|mono|hook|solo|лид|соло)\b", re.I)),
    ("Pluck", re.compile(r"\b(pluck|plk|pizz|harp|koto|marimba|kalimba|плак|арфа)\b", re.I)),
    ("Melody", re.compile(r"\b(melody|mldy|riff|arp|arpeggio|flute|violin|brass|trumpet|guitar|bell|synth|strings|sax|sylenth|nexus|serum|diva|vital|kontakt|omnisphere|xpand|spire|massive|electra|purity|sytrus|flex|3x\s*osc|loop|loops|sample|stem|мелодия|скрипка|флейта|гитара|брасс|колокольчик)\b", re.I)),
    ("Vox", re.compile(r"\b(vox|vocal|chant|choir|acapella|voice|voice\s*tag|tag|tags|вокал|голос|хор|чант|войс)\b", re.I)),
    ("FX", re.compile(r"\b(fx|riser|downlifter|sweep|impact|transition|transitions|noise|zap|laser|sidechain|enveloper|эффект|райзер|транзишн)\b", re.I)),
]

KNOWN_SYNTH_NAMES = re.compile(r"\b(nexus|serum|diva|vital|kontakt|keyscape|omnisphere|sylenth1?|xpand!?2?|spire|massive|electra|purity|sytrus|flex|3x\s*osc|dune|zenology|analog\s*lab)\b", re.I)

def normalize_for_matching(text: str) -> str:
    if not text:
        return ""
    # Replace path separators, underscores, dots, hyphens, brackets with spaces
    return re.sub(r"[/\\_\.\-\[\]\(\)\+!@#$%^&*]+", " ", text)

def classify_text(text: str) -> Optional[str]:
    """Matches text against the rule library in priority order with normalized word delimiters."""
    if not text:
        return None
    normalized = normalize_for_matching(text)
    for tag, pattern in TAG_RULES:
        if pattern.search(normalized):
            return tag
    return None

try:
    from backend.core.audio_analyzer import classify_audio_waveform, detect_root_note
except Exception:
    try:
        from core.audio_analyzer import classify_audio_waveform, detect_root_note
    except Exception:
        try:
            from audio_analyzer import classify_audio_waveform, detect_root_note
        except Exception:
            classify_audio_waveform = None
            detect_root_note = None

def is_generic_name(name: Optional[str]) -> bool:
    """Checks if a channel or sample name is generic/uninformative."""
    if not name:
        return True
    clean = name.strip()
    return bool(re.match(r"^(channel\s*\d+|sampler|audio\s*clip|sample[_\s\-]*\d*|rec[_\s\-]*\d*|track\s*\d+|sound[_\s\-]*\d*|audio[_\s\-]*\d*|pattern\s*\d*)$", clean, re.I))

def classify_tag(
    channel_name: str,
    sample_name: Optional[str] = None,
    notes: Optional[List[Dict[str, Any]]] = None,
    pattern_name: Optional[str] = None,
    sample_file_path: Optional[str] = None
) -> str:
    """
    Determines category tag (808, Kick, Snare, Hi-Hat, Melody, Chords, etc.)
    using multi-layered analysis:
    1. Text rules on channel/sample/folder names.
    2. Generator plugin and note heuristics (polyphony, pitch range, rhythm).
    3. Real DSP waveform analysis when names are generic or ambiguous.
    """
    ch_clean = (channel_name or "").strip()
    sample_clean = (sample_name or "").strip()
    pat_clean = (pattern_name or "").strip()

    # 1. Primary: check channel name, sample filename, and full folder path
    tag_ch = classify_text(ch_clean)
    if tag_ch:
        return tag_ch

    tag_sample = classify_text(sample_clean)
    if tag_sample:
        return tag_sample

    # 2. Secondary: check pattern name (excluding generic "Pattern 1", "Pattern 2")
    if pat_clean and not re.match(r"^Pattern\s*\d+$", pat_clean, re.I):
        tag_pat = classify_text(pat_clean)
        if tag_pat:
            return tag_pat

    # 3. Check if generator/channel is a known synth plugin
    if KNOWN_SYNTH_NAMES.search(normalize_for_matching(f"{ch_clean} {pat_clean}")):
        if notes and len(notes) > 0:
            positions = [n.get("pos", 0) for n in notes]
            pos_counts: Dict[int, int] = {}
            for p in positions:
                pos_counts[p] = pos_counts.get(p, 0) + 1
            max_polyphony = max(pos_counts.values()) if pos_counts else 1
            if max_polyphony >= 3:
                return "Chords"
            pitches = [n.get("pitch", 60) for n in notes]
            if sum(pitches) / len(pitches) < 45:
                return "Bass"
        return "Melody"

    # 4. DSP Audio Waveform Analysis (if physical file exists on disk)
    if sample_file_path and classify_audio_waveform and os.path.exists(sample_file_path):
        try:
            dsp_res = classify_audio_waveform(sample_file_path)
            if dsp_res and dsp_res.get("tag") and dsp_res["tag"] != "Other" and dsp_res.get("confidence", 0) >= 0.75:
                return dsp_res["tag"]
        except Exception:
            pass

    # 5. Heuristics based on note properties
    if notes and len(notes) > 0:
        pitches = [n.get("pitch", 60) for n in notes]
        durations = [n.get("duration", 96) for n in notes]
        positions = [n.get("pos", 0) for n in notes]
        num_notes = len(notes)

        # Check for polyphony (chords)
        pos_counts: Dict[int, int] = {}
        for p in positions:
            pos_counts[p] = pos_counts.get(p, 0) + 1
        max_polyphony = max(pos_counts.values()) if pos_counts else 1

        avg_pitch = sum(pitches) / num_notes
        min_pitch = min(pitches)
        max_pitch = max(pitches)
        pitch_spread = max_pitch - min_pitch

        # Polyphonic with moderate duration -> Chords
        if max_polyphony >= 3:
            return "Chords"

        # High pitch with many repetitive notes (rapid hits) -> Hi-Hat
        if num_notes >= 8 and pitch_spread <= 5 and avg_pitch >= 55:
            return "Hi-Hat"

        # Low pitch range (C1-C3: MIDI 24-48)
        if avg_pitch < 50:
            avg_dur = sum(durations) / num_notes
            if avg_dur > 192 or pitch_spread > 0:
                return "808"
            return "Kick"

        # Melodic movement vs bass
        if max_polyphony <= 2 and pitch_spread >= 5:
            return "Melody"
            
        if avg_pitch < 50:
            return "Bass"
            
        if max_polyphony >= 2:
            return "Chords"
            
        return "Melody"

    # 6. Fallback DSP check if not done previously
    if sample_file_path and classify_audio_waveform and os.path.exists(sample_file_path):
        try:
            dsp_res = classify_audio_waveform(sample_file_path)
            if dsp_res and dsp_res.get("tag") and dsp_res["tag"] != "Other":
                return dsp_res["tag"]
        except Exception:
            pass

    return "Other"


def analyze_sample(
    sample_file_path: Optional[str],
    channel_name: str = "",
    sample_name: Optional[str] = None,
    notes: Optional[List[Dict[str, Any]]] = None,
    pattern_name: Optional[str] = None
) -> Dict[str, Any]:
    """
    Performs comprehensive sample analysis, returning:
    {
        "tag": str,
        "root_note": Optional[str],  # e.g. "F1", "C1"
        "confidence": float,
        "is_dsp": bool
    }
    """
    # 1. First obtain tag
    tag = classify_tag(
        channel_name=channel_name,
        sample_name=sample_name,
        notes=notes,
        pattern_name=pattern_name,
        sample_file_path=sample_file_path
    )

    root_note = None
    confidence = 0.90
    is_dsp = False

    # 2. If physical file exists, analyze for root note and DSP validation
    if sample_file_path and os.path.exists(sample_file_path) and classify_audio_waveform:
        try:
            dsp_res = classify_audio_waveform(sample_file_path)
            if dsp_res:
                if dsp_res.get("root_note"):
                    root_note = dsp_res["root_note"]
                
                if tag in ["Other", "Unknown"] and dsp_res.get("tag") and dsp_res["tag"] != "Other":
                    tag = dsp_res["tag"]
                    confidence = dsp_res.get("confidence", 0.85)
                    is_dsp = True
        except Exception:
            pass

    return {
        "tag": tag,
        "root_note": root_note,
        "confidence": confidence,
        "is_dsp": is_dsp
    }
