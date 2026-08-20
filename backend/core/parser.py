import os
import re
import logging
from typing import List, Dict, Any, Optional
import pyflp
import pyflp._events

# ─── Python 3.12+ Enum Compatibility Patch for PyFLP ───
try:
    _orig_event_call = pyflp._events._EventEnumMeta.__call__
    def _patched_event_call(cls, value=None, names=None, *args, **kwargs):
        if names is None and value is not None and not isinstance(value, str):
            return cls._missing_(value)
        return _orig_event_call(cls, value, names, *args, **kwargs)
    pyflp._events._EventEnumMeta.__call__ = _patched_event_call
except Exception as patch_err:
    logging.getLogger(__name__).warning(f"Could not apply PyFLP Enum patch: {patch_err}")

try:
    from backend.core.classifier import classify_tag
    from backend.core.midi_generator import create_midi_bytes
except Exception:
    try:
        from core.classifier import classify_tag
        from core.midi_generator import create_midi_bytes
    except Exception:
        from classifier import classify_tag
        from midi_generator import create_midi_bytes


logger = logging.getLogger(__name__)

def note_name_to_midi(val: Any) -> int:
    """Converts note names (e.g. 'G4', 'C#5', 'Eb3') or integers/enums to standard MIDI pitch (0-127)."""
    if val is None:
        return 60
    if isinstance(val, int):
        return max(0, min(127, val))
    if isinstance(val, float):
        return max(0, min(127, int(val)))
    if hasattr(val, "value") and isinstance(val.value, (int, str)):
        return note_name_to_midi(val.value)
    
    s = str(val).strip()
    try:
        return max(0, min(127, int(s)))
    except ValueError:
        pass

    match = re.match(r"^([A-Ga-g])([#b]?)(-?\d+)$", s)
    if match:
        note, accidental, octave = match.groups()
        note_offsets = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
        pitch = note_offsets.get(note.upper(), 0)
        if accidental == "#":
            pitch += 1
        elif accidental == "b":
            pitch -= 1
        oct_val = int(octave)
        # FL Studio / MIDI: C4 is 60 -> (oct_val + 1) * 12 + pitch
        midi_num = (oct_val + 1) * 12 + pitch
        return max(0, min(127, midi_num))

    return 60

def safe_int(val: Any, default: int = 0) -> int:
    """Safely converts any value to int."""
    if val is None:
        return default
    if isinstance(val, int):
        return val
    if isinstance(val, float):
        return int(val)
    if hasattr(val, "value"):
        return safe_int(val.value, default)
    try:
        return int(str(val).strip())
    except (ValueError, TypeError):
        return default

def parse_flp_project(flp_path: str) -> Optional[Dict[str, Any]]:
    """
    Parses an FL Studio project file (.flp) and extracts all channels,
    patterns, notes, and metadata.
    """
    flp_path = os.path.expanduser(os.path.abspath(flp_path))
    if not os.path.exists(flp_path):
        logger.error(f"File not found: {flp_path}")
        return None

    filename = os.path.basename(flp_path)
    project_title = os.path.splitext(filename)[0]

    try:
        project = pyflp.parse(flp_path)
    except Exception as e:
        logger.warning(f"PyFLP parsing error for {flp_path}: {e}")
        return None

    # 1. Project Tempo & PPQ
    tempo = 140.0
    ppq = 96
    try:
        if hasattr(project, "tempo"):
            t = getattr(project, "tempo")
            if t is not None:
                tempo = float(t)
        elif hasattr(project, "misc") and hasattr(project.misc, "tempo"):
            tempo = float(project.misc.tempo or 140.0)

        if hasattr(project, "ppq"):
            p = getattr(project, "ppq")
            if p is not None:
                ppq = int(p)
        elif hasattr(project, "misc") and hasattr(project.misc, "ppq"):
            ppq = int(project.misc.ppq or 96)

        if hasattr(project, "title") and project.title:
            project_title = str(project.title)
    except Exception as e:
        logger.debug(f"Metadata extract warning: {e}")

    # 2. Extract Channels
    # Use integer IDs and object id() as dict keys to avoid unhashable model errors
    channels_map: Dict[Any, Dict[str, Any]] = {}
    channels_list: List[Dict[str, Any]] = []
    
    try:
        raw_channels = list(getattr(project, "channels", []))
        for idx, ch in enumerate(raw_channels):
            ch_name = (
                getattr(ch, "display_name", None) or
                getattr(ch, "name", None) or
                f"Channel {idx + 1}"
            )
            
            sample_path = None
            for attr in ["sample", "sample_path", "filename", "filepath"]:
                if hasattr(ch, attr):
                    val = getattr(ch, attr)
                    if val and isinstance(val, (str, os.PathLike)):
                        sample_path = str(val)
                        break

            generator = getattr(ch, "internal_name", None) or getattr(ch, "generator_name", None) or "Sampler"

            ch_data = {
                "index": idx,
                "name": str(ch_name),
                "sample_path": sample_path,
                "generator": str(generator)
            }
            
            channels_map[idx] = ch_data
            channels_map[id(ch)] = ch_data
            if hasattr(ch, "iid"):
                channels_map[getattr(ch, "iid")] = ch_data

            channels_list.append(ch_data)
    except Exception as e:
        logger.warning(f"Error parsing channels in {filename}: {e}")

    # 3. Extract Patterns and Notes
    extracted_patterns: List[Dict[str, Any]] = []
    
    try:
        raw_patterns = list(getattr(project, "patterns", []))
        for p_idx, pat in enumerate(raw_patterns):
            pat_name = getattr(pat, "name", None) or f"Pattern {p_idx + 1}"
            raw_notes = list(getattr(pat, "notes", []))
            
            # Group notes by channel index
            channel_notes: Dict[int, List[Dict[str, Any]]] = {}
            
            for n in raw_notes:
                # Key / Pitch (handles 'G4', 'C#5', 60, enums, Note objects)
                pitch_val = getattr(n, "key", None)
                if pitch_val is None:
                    pitch_val = getattr(n, "pitch", 60)
                pitch = note_name_to_midi(pitch_val)

                # Position
                pos_val = getattr(n, "position", None)
                if pos_val is None:
                    pos_val = getattr(n, "pos", 0)
                pos = safe_int(pos_val, 0)

                # Duration / Length
                dur_val = getattr(n, "length", None)
                if dur_val is None:
                    dur_val = getattr(n, "duration", 96)
                duration = max(1, safe_int(dur_val, 96))

                # Velocity
                vel_val = getattr(n, "velocity", None)
                if vel_val is None:
                    vel_val = getattr(n, "vol", 100)
                if isinstance(vel_val, float) and vel_val <= 1.0:
                    velocity = int(vel_val * 127)
                else:
                    velocity = safe_int(vel_val, 100)
                velocity = max(1, min(127, velocity))

                # Resolve channel index safely
                ch_idx = 0
                rc = getattr(n, "rack_channel", None)
                if rc is not None:
                    info = channels_map.get(id(rc)) or channels_map.get(getattr(rc, "iid", None))
                    if info:
                        ch_idx = info["index"]
                    elif hasattr(rc, "index"):
                        ch_idx = safe_int(rc.index, 0)
                elif hasattr(n, "channel") and n.channel is not None:
                    c = n.channel
                    if isinstance(c, int):
                        ch_idx = c
                    else:
                        info = channels_map.get(id(c)) or channels_map.get(getattr(c, "iid", None))
                        ch_idx = info["index"] if info else 0

                if ch_idx not in channel_notes:
                    channel_notes[ch_idx] = []

                channel_notes[ch_idx].append({
                    "pitch": pitch,
                    "pos": pos,
                    "duration": duration,
                    "velocity": velocity
                })

            # Create an entry for each channel containing notes in this pattern
            for ch_idx, notes_list in channel_notes.items():
                if not notes_list:
                    continue

                ch_info = channels_map.get(ch_idx, {
                    "name": f"Channel {ch_idx + 1}",
                    "sample_path": None,
                    "generator": "Unknown"
                })

                ch_name = ch_info["name"]
                sample_name = os.path.basename(ch_info["sample_path"]) if ch_info.get("sample_path") else None
                tag = classify_tag(ch_name, sample_name, notes_list, pat_name)

                # Duration in bars
                max_tick = max((item["pos"] + item["duration"]) for item in notes_list)
                bars = max(1, round(max_tick / (ppq * 4)))

                # Key root note name
                pitches = [item["pitch"] for item in notes_list]
                root_pitch = min(pitches) if pitches else 60
                note_names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
                root_note_name = note_names[root_pitch % 12]

                # Generate standard MIDI bytes
                midi_bytes = create_midi_bytes(
                    notes=notes_list,
                    tempo=tempo,
                    ppq=ppq,
                    track_name=f"{pat_name} - {ch_name}"
                )

                extracted_patterns.append({
                    "pattern_index": p_idx,
                    "pattern_name": pat_name,
                    "channel_index": ch_idx,
                    "channel_name": ch_name,
                    "sample_path": ch_info.get("sample_path"),
                    "tag": tag,
                    "bars": bars,
                    "key": root_note_name,
                    "note_count": len(notes_list),
                    "notes": notes_list,
                    "midi_bytes": midi_bytes,
                    "tempo": tempo,
                    "ppq": ppq
                })

    except Exception as e:
        logger.warning(f"Error parsing patterns in {filename}: {e}")

    return {
        "file_path": flp_path,
        "file_name": filename,
        "title": project_title,
        "tempo": tempo,
        "ppq": ppq,
        "channel_count": len(channels_list),
        "pattern_count": len(extracted_patterns),
        "channels": channels_list,
        "patterns": extracted_patterns,
        "file_size": os.path.getsize(flp_path) if os.path.exists(flp_path) else 0
    }
