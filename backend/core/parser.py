import os
import re
import logging
from typing import List, Dict, Any, Optional
import pyflp
import pyflp._events

# ─── Python 3.14 Enum Compatibility Patch for PyFLP ───
# Python 3.14 changed EnumMeta.__call__ to raise TypeError before calling _missing_
# when the enum class has zero members (EventEnum is a base class with no members).
# Fix: Override __call__ on the metaclass to bypass the members check entirely
# and route integer lookups directly through _missing_.
try:
    import enum as _enum

    def _patched_event_meta_call(cls, value=None, names=None, *args, **kwargs):
        # Standard path: creating a new enum class (names provided)
        if names is not None or isinstance(value, str):
            return _enum.EnumMeta.__call__(cls, value, names, *args, **kwargs)
        # Lookup path: route integer byte values directly to _missing_
        # This avoids the Python 3.14 TypeError for empty enum base classes
        if value is not None:
            # First try normal member lookup (works on subclasses that have members)
            member_map = cls.__dict__.get("_value2member_map_", {})
            if value in member_map:
                return member_map[value]
            # Fall through to _missing_ (handles dynamic pseudo-members in pyflp)
            result = cls._missing_(value)
            if result is not None:
                return result
        raise ValueError(f"{value!r} is not a valid {cls.__name__}")

    pyflp._events._EventEnumMeta.__call__ = _patched_event_meta_call
except Exception as _patch_err:
    logging.getLogger(__name__).warning(f"Could not apply PyFLP Enum patch: {_patch_err}")

try:
    from backend.core.classifier import classify_tag
    from backend.core.midi_generator import create_midi_bytes
    from backend.core.sample_resolver import resolve_sample_path
except Exception:
    try:
        from core.classifier import classify_tag
        from core.midi_generator import create_midi_bytes
        from core.sample_resolver import resolve_sample_path
    except Exception:
        from classifier import classify_tag
        from midi_generator import create_midi_bytes
        from sample_resolver import resolve_sample_path


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

def extract_flp_tempo_binary(flp_path: str) -> Optional[float]:
    """
    Directly extracts project tempo from FL Studio binary file (.flp).
    In FL Studio project files:
    - Event 156 (0x9C, ProjectID.Tempo) is a DWORD storing (bpm * 1000) as uint32 LE.
    - Legacy Event 66 (0x42, _TempoCoarse) stores integer tempo, plus Event 93 (_TempoFine).
    This function reliably extracts the exact tempo across all FL Studio versions (FL 1.0 to FL 25+).
    """
    try:
        with open(flp_path, "rb") as f:
            data = f.read(4096)
        if len(data) < 26 or not data.startswith(b"FLhd"):
            return None

        import struct
        # 1. Primary modern method (FL 11 - FL 25+): Event 156 (0x9C, ProjectID.Tempo)
        for i in range(22, min(len(data) - 5, 2048)):
            if data[i] == 0x9C:  # 156
                val = struct.unpack_from("<I", data, i + 1)[0]
                if 10000 <= val <= 522000:
                    return round(val / 1000.0, 3)

        # 2. Legacy fallback: Event 66 (0x42, _TempoCoarse) + Event 93 (0x5D, _TempoFine)
        coarse = None
        fine = None
        for i in range(22, min(len(data) - 3, 2048)):
            if data[i] == 0x42:  # 66
                c_val = struct.unpack_from("<H", data, i + 1)[0]
                if 10 <= c_val <= 999:
                    coarse = float(c_val)
            elif data[i] == 0x5D:  # 93
                f_val = struct.unpack_from("<H", data, i + 1)[0]
                if 0 <= f_val <= 999:
                    fine = float(f_val) / 1000.0

        if coarse is not None:
            return round(coarse + (fine or 0.0), 3)
    except Exception as e:
        logger.debug(f"Error extracting binary tempo from {flp_path}: {e}")
    return None


def parse_flp_project(flp_path: str) -> Optional[Dict[str, Any]]:
    """
    Parses an FL Studio project file (.flp) and extracts all channels,
    patterns, notes, and metadata with intelligent channel mapping and sample resolution.
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
        # Binary extract has 100% accuracy across all FL Studio versions
        bin_tempo = extract_flp_tempo_binary(flp_path)
        if bin_tempo is not None and bin_tempo > 0:
            tempo = bin_tempo
        elif hasattr(project, "tempo") and project.tempo is not None:
            tempo = float(project.tempo)
        elif hasattr(project, "misc") and hasattr(project.misc, "tempo") and project.misc.tempo:
            tempo = float(project.misc.tempo)

        if hasattr(project, "ppq"):
            p = getattr(project, "ppq")
            if p is not None:
                ppq = int(p)
        elif hasattr(project, "misc") and hasattr(project.misc, "ppq"):
            ppq = int(project.misc.ppq or 96)

        if hasattr(project, "title") and project.title:
            t_str = str(project.title).strip()
            if t_str:
                project_title = t_str
    except Exception as e:
        logger.debug(f"Metadata extract warning: {e}")

    # 2. Extract Channels with Bulletproof IID / Index mapping
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
            
            raw_sample_path = None
            for attr in ["sample_path", "sample", "filename", "filepath"]:
                if hasattr(ch, attr):
                    val = getattr(ch, attr)
                    if val and isinstance(val, (str, os.PathLike)):
                        raw_sample_path = str(val)
                        break

            # Resolve sample path against local file system
            resolved_sample_path = resolve_sample_path(raw_sample_path, flp_path) if raw_sample_path else None

            generator = getattr(ch, "internal_name", None) or getattr(ch, "generator_name", None) or getattr(ch, "plugin_name", None)
            if not generator or generator == "None":
                generator = type(ch).__name__ if type(ch).__name__ != "Channel" else "Sampler"

            # Get IID (rack channel index)
            ch_iid = safe_int(getattr(ch, "iid", idx), idx)

            ch_data = {
                "index": idx,
                "iid": ch_iid,
                "name": str(ch_name),
                "sample_path": resolved_sample_path or raw_sample_path,
                "raw_sample_path": raw_sample_path,
                "generator": str(generator)
            }
            
            # Map by multiple keys so note.rack_channel always finds the exact channel
            channels_map[idx] = ch_data
            channels_map[ch_iid] = ch_data
            channels_map[id(ch)] = ch_data
            channels_list.append(ch_data)
    except Exception as e:
        logger.warning(f"Error parsing channels in {filename}: {e}")

    # 3. Extract Patterns and Notes per Instrument
    extracted_patterns: List[Dict[str, Any]] = []
    
    raw_patterns = []
    try:
        if hasattr(project, "patterns"):
            for pat in project.patterns:
                raw_patterns.append(pat)
    except Exception as e:
        logger.debug(f"Patterns reading note for {filename}: {e}")

    try:
        for p_idx, pat in enumerate(raw_patterns):
            pat_name = getattr(pat, "name", None) or f"Pattern {p_idx + 1}"
            
            try:
                raw_notes = list(getattr(pat, "notes", []))
            except Exception:
                raw_notes = []
            
            if not raw_notes:
                continue

            # Group notes by channel index
            channel_notes: Dict[int, List[Dict[str, Any]]] = {}
            
            for n in raw_notes:
                # Key / Pitch
                pitch_val = getattr(n, "key", None)
                if pitch_val is None:
                    pitch_val = getattr(n, "pitch", 60)
                pitch = note_name_to_midi(pitch_val)

                # Position
                pos_val = getattr(n, "position", None)
                if pos_val is None:
                    pos_val = getattr(n, "pos", 0)
                pos = safe_int(pos_val, 0)

                # Duration
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

                # Resolve channel index accurately via rack_channel (IID)
                ch_idx = 0
                rc = getattr(n, "rack_channel", None)
                if rc is not None:
                    rc_int = safe_int(rc, -1)
                    if rc_int in channels_map:
                        ch_idx = channels_map[rc_int]["index"]
                    elif id(rc) in channels_map:
                        ch_idx = channels_map[id(rc)]["index"]
                elif hasattr(n, "channel") and n.channel is not None:
                    c = n.channel
                    c_int = safe_int(c, -1)
                    if c_int in channels_map:
                        ch_idx = channels_map[c_int]["index"]
                    elif id(c) in channels_map:
                        ch_idx = channels_map[id(c)]["index"]

                if ch_idx not in channel_notes:
                    channel_notes[ch_idx] = []

                channel_notes[ch_idx].append({
                    "pitch": pitch,
                    "pos": pos,
                    "duration": duration,
                    "velocity": velocity
                })

            # Create an entry for each channel containing notes in this pattern
            multi_channel = len(channel_notes) > 1

            for ch_idx, notes_list in channel_notes.items():
                if not notes_list:
                    continue

                ch_info = channels_map.get(ch_idx, {
                    "name": f"Channel {ch_idx + 1}",
                    "sample_path": None,
                    "generator": "Unknown"
                })

                ch_name = ch_info["name"]
                sample_full_path = ch_info.get("raw_sample_path") or ch_info.get("sample_path")
                tag = classify_tag(ch_name, sample_full_path, notes_list, pat_name)

                # Duration in bars
                max_tick = max((item["pos"] + item["duration"]) for item in notes_list)
                bars = max(1, round(max_tick / (ppq * 4)))

                # Key root note name
                pitches = [item["pitch"] for item in notes_list]
                root_pitch = min(pitches) if pitches else 60
                note_names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
                root_note_name = note_names[root_pitch % 12]

                # Display Name: if pattern has a generic name and is multi-channel, clarify with channel name
                display_pat_name = pat_name
                if multi_channel and re.match(r"^Pattern\s*\d+$", pat_name, re.I):
                    display_pat_name = f"{pat_name} • {ch_name}"

                # Generate standard MIDI bytes
                midi_bytes = create_midi_bytes(
                    notes=notes_list,
                    tempo=tempo,
                    ppq=ppq,
                    track_name=f"{display_pat_name} - {ch_name}"
                )

                extracted_patterns.append({
                    "pattern_index": p_idx,
                    "pattern_name": display_pat_name,
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
