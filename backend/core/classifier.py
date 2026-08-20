import re
from typing import List, Dict, Any, Optional

# Pre-compiled regex patterns for channel / sample name detection
TAG_RULES = [
    ("808", re.compile(r"\b(808|sub|subbass|sub-bass|dist808|spinz|wheezy808|reese)\b", re.I)),
    ("Kick", re.compile(r"\b(kick|kck|bd|bassdrum|kickdrum)\b", re.I)),
    ("Snare", re.compile(r"\b(snare|snr|sd)\b", re.I)),
    ("Clap", re.compile(r"\b(clap|clp|snap)\b", re.I)),
    ("Open Hat", re.compile(r"\b(openhat|open-hat|open\s*hat|open_hat|oh|ophat)\b", re.I)),
    ("Hi-Hat", re.compile(r"\b(hihat|hi-hat|hi\s*hat|hi_hat|hh|hat|closedhat|cl_hat|hats)\b", re.I)),
    ("Rim", re.compile(r"\b(rim|rimshot|cross-stick|sidestick)\b", re.I)),
    ("Perc", re.compile(r"\b(perc|percussion|conga|bongo|shaker|tamb|tambourine|cowbell)\b", re.I)),
    ("Tom", re.compile(r"\b(tom|toms|floor-tom|rack-tom|roto)\b", re.I)),
    ("Crash", re.compile(r"\b(crash|cymbal|ride|splash|china)\b", re.I)),
    ("Bass", re.compile(r"\b(bass|synthbass|slapbass|electricbass|acid)\b", re.I)),
    ("Chords", re.compile(r"\b(chord|chords|pad|pads|keys|piano|rhodes|organ|strum)\b", re.I)),
    ("Lead", re.compile(r"\b(lead|synthlead|mono|hook|solo)\b", re.I)),
    ("Pluck", re.compile(r"\b(pluck|plk|pizz|harp|koto|marimba|kalimba)\b", re.I)),
    ("Melody", re.compile(r"\b(melody|mldy|riff|arp|arpeggio|flute|violin|brass|trumpet|guitar|bell|synth)\b", re.I)),
    ("Vox", re.compile(r"\b(vox|vocal|chant|choir|acapella|voice)\b", re.I)),
    ("FX", re.compile(r"\b(fx|riser|downlifter|sweep|impact|transition|noise|zap|laser)\b", re.I)),
]

def classify_tag(
    channel_name: str,
    sample_name: Optional[str] = None,
    notes: Optional[List[Dict[str, Any]]] = None,
    pattern_name: Optional[str] = None
) -> str:
    """
    Determines category tag (808, Kick, Snare, Hi-Hat, etc.)
    using channel/sample names and pattern note heuristics.
    """
    text_to_check = f"{pattern_name or ''} {channel_name or ''} {sample_name or ''}".strip()
    
    # 1. Match against known regex keywords
    for tag, pattern in TAG_RULES:
        if pattern.search(text_to_check):
            return tag

    # 2. Heuristics based on note properties
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

        # If it's a sampler channel (has sample_name), we can guess drums
        if sample_name:
            # Low pitch range (C1-C3: MIDI 24-48)
            if avg_pitch < 50:
                avg_dur = sum(durations) / num_notes
                if avg_dur > 192 or pitch_spread > 0:
                    return "808"
                return "Kick"

            # High pitch with many repetitive notes (rapid hits) -> Hi-Hat
            if num_notes >= 8 and pitch_spread <= 5 and avg_pitch >= 55:
                return "Hi-Hat"

        # If it's a VST or didn't match drum heuristics, classify by melodic movement
        if max_polyphony <= 2 and pitch_spread >= 5:
            return "Melody"
            
        if avg_pitch < 50:
            return "Bass"
            
        if max_polyphony >= 2:
            return "Chords"
            
        return "Melody"

    return "Other"
