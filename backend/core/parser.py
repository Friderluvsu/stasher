import os
import re
import math
import bisect
import logging
import tempfile
import warnings
from typing import List, Dict, Any, Optional, Tuple
import pyflp
import pyflp._events

# PyFLP warns once per unknown VST state marker; it is harmless and floods scan logs.
warnings.filterwarnings("ignore", message=r"VSTPluginEvent: Unknown marker", category=RuntimeWarning)

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

# Some recent FL Studio projects contain UTF-16 text events with one stray
# trailing byte. PyFLP rejects the whole project although the notes are valid.
# Normalize only these odd-length events so the rest of the file parses normally.
try:
    _original_unicode_init = pyflp._events.UnicodeEvent.__init__

    def _tolerant_unicode_init(self, event_id, data, **kwds):
        if len(data) % 2:
            data = data[:-1] if data.endswith(b"\x00") else data + b"\x00"
        _original_unicode_init(self, event_id, data, **kwds)

    pyflp._events.UnicodeEvent.__init__ = _tolerant_unicode_init
except Exception as _patch_err:
    logging.getLogger(__name__).warning(f"Could not apply PyFLP Unicode patch: {_patch_err}")

try:
    from backend.core.classifier import classify_tag
    from backend.core.midi_generator import create_midi_bytes
    from backend.core.sample_resolver import resolve_sample_path
    from backend.core.flp_playlist import build_song, pad_short_dword_events, read_song_clips, read_tempo
except Exception:
    try:
        from core.classifier import classify_tag
        from core.midi_generator import create_midi_bytes
        from core.sample_resolver import resolve_sample_path
        from core.flp_playlist import build_song, pad_short_dword_events, read_song_clips, read_tempo
    except Exception:
        from classifier import classify_tag
        from midi_generator import create_midi_bytes
        from sample_resolver import resolve_sample_path
        from flp_playlist import build_song, pad_short_dword_events, read_song_clips, read_tempo


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

def extract_flp_tempo_binary(flp_path: str, data: Optional[bytes] = None) -> Optional[float]:
    """
    Directly extracts project tempo from FL Studio binary file (.flp).
    In FL Studio project files:
    - Event 156 (0x9C, ProjectID.Tempo) is a DWORD storing (bpm * 1000) as uint32 LE.
    - Legacy Event 66 (0x42, _TempoCoarse) stores integer tempo, plus Event 93 (_TempoFine).
    The event stream is walked first (PyFLP itself loses the tempo event in FL 25 files);
    a byte scan of the file head is the fallback for streams that cannot be walked.
    """
    try:
        if data is None:
            with open(flp_path, "rb") as f:
                data = f.read()
        try:
            walked = read_tempo(data)
            if walked is not None:
                return walked
        except Exception as e:
            logger.debug(f"Event walk could not read tempo from {flp_path}: {e}")
        data = data[:4096]
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


NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
UNPITCHED_TAGS = {"Kick", "Snare", "Clap", "Open Hat", "Hi-Hat", "Rim", "Perc", "Tom", "Crash", "FX"}
NO_KEY = "—"
# Krumhansl-Kessler key profiles (major / minor), tonic first.
_MAJOR_PROFILE = (6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88)
_MINOR_PROFILE = (6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17)
_MAJOR_SCALE = (0, 2, 4, 5, 7, 9, 11)
_MINOR_SCALE = (0, 2, 3, 5, 7, 8, 10)
# Stored pitches follow FL's octave naming (raw FL key + 12; midi_generator subtracts it again),
# so a sampler one-shot triggered on FL's default C5 shows up as 72.
_FL_TRIGGER_PITCH = 72
# Larger manual pattern lengths are treated as garbage and ignored.
MAX_PATTERN_BARS = 1024


def _safe_attr(obj: Any, name: str, default: Any = None) -> Any:
    """getattr that also swallows PyFLP KeyErrors raised for events missing from the file."""
    try:
        value = getattr(obj, name)
    except Exception:
        return default
    return default if value is None else value


def _bar_count(ticks: int, ppq: int) -> int:
    """Whole 4/4 bars covering ``ticks``; a tail shorter than a 32nd note does not open a new bar."""
    bar = max(1, ppq * 4)
    return max(1, math.ceil(max(0, ticks - max(1, ppq // 8)) / bar))


def _fill_zero_lengths(notes: List[Dict[str, Any]], raw_lengths: List[int], ppq: int) -> None:
    """Step-sequencer notes are stored with length 0: give them a 16th, cut at the next hit of the same key."""
    step = max(1, ppq // 4)
    starts: Dict[int, List[int]] = {}
    for note in notes:
        starts.setdefault(note["pitch"], []).append(note["pos"])
    for positions in starts.values():
        positions.sort()
    for note, raw_length in zip(notes, raw_lengths):
        if raw_length > 0:
            continue
        positions = starts[note["pitch"]]
        following = bisect.bisect_right(positions, note["pos"])
        gap = positions[following] - note["pos"] if following < len(positions) else step
        note["duration"] = max(1, min(step, gap))


def _pitch_class_weights(notes: List[Dict[str, Any]], tag: str, ppq: int) -> Optional[List[float]]:
    if tag in UNPITCHED_TAGS or not notes:
        return None
    if all(note["pitch"] == _FL_TRIGGER_PITCH for note in notes):
        return None
    weights = [0.0] * 12
    for note in notes:
        length = min(max(note["duration"], ppq / 4), ppq * 2)
        weights[note["pitch"] % 12] += length * (0.5 + note["velocity"] / 254)
    return weights


def _correlation(xs: List[float], ys: Tuple[float, ...]) -> float:
    mean_x, mean_y = sum(xs) / len(xs), sum(ys) / len(ys)
    cov = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    var_x = sum((x - mean_x) ** 2 for x in xs)
    var_y = sum((y - mean_y) ** 2 for y in ys)
    return cov / math.sqrt(var_x * var_y) if var_x > 0 and var_y > 0 else -1.0


def _estimate_key(weights: Optional[List[float]]) -> Optional[Tuple[int, bool]]:
    if not weights or sum(1 for weight in weights if weight > 0) < 3:
        return None
    best: Optional[Tuple[float, int, bool]] = None
    for tonic in range(12):
        rotated = [weights[(tonic + step) % 12] for step in range(12)]
        for minor, profile in ((False, _MAJOR_PROFILE), (True, _MINOR_PROFILE)):
            score = _correlation(rotated, profile)
            if best is None or score > best[0]:
                best = (score, tonic, minor)
    return (best[1], best[2]) if best else None


def _key_name(key: Tuple[int, bool]) -> str:
    return NOTE_NAMES[key[0]] + ("m" if key[1] else "")


def _scale_fit(weights: List[float], key: Tuple[int, bool]) -> float:
    scale = {(key[0] + step) % 12 for step in (_MINOR_SCALE if key[1] else _MAJOR_SCALE)}
    total = sum(weights)
    return sum(weight for pc, weight in enumerate(weights) if pc in scale) / total if total else 0.0


def _part_key(weights: Optional[List[float]], project_key: Optional[Tuple[int, bool]]) -> str:
    """Song key when the part fits its scale (bass lines and riffs rarely show the whole scale), else its own."""
    if not weights:
        return NO_KEY
    if project_key and _scale_fit(weights, project_key) >= 0.6:
        return _key_name(project_key)
    own = _estimate_key(weights)
    if own:
        return _key_name(own)
    return NOTE_NAMES[max(range(12), key=lambda pc: weights[pc])]


def _read_bytes(path: str) -> Optional[bytes]:
    try:
        with open(path, "rb") as handle:
            return handle.read()
    except OSError as e:
        logger.debug(f"Could not read {path}: {e}")
        return None


def load_pyflp_project(flp_path: str, raw_data: Optional[bytes] = None) -> Any:
    """``pyflp.parse`` that survives FL 25's 3-byte event 172 (see ``pad_short_dword_events``).

    PyFLP only reads from a path, so a padded copy goes to a temporary file that is removed right
    after parsing (the parsed project holds everything in memory). The user's file is never touched.
    """
    padded = None
    if raw_data:
        try:
            padded = pad_short_dword_events(raw_data)
        except Exception as e:
            logger.debug(f"Could not normalise the event stream of {flp_path}: {e}")
    if not padded or padded is raw_data:
        return pyflp.parse(flp_path)
    with tempfile.TemporaryDirectory(prefix="stasher_flp_") as temp_dir:
        path = os.path.join(temp_dir, "project.flp")
        with open(path, "wb") as handle:
            handle.write(padded)
        return pyflp.parse(path)


def extract_song_timeline(data: Optional[bytes], pattern_indexes: Dict[int, int]) -> Optional[Dict[str, Any]]:
    """Playlist pattern clips as ``{"ticks", "clips"}``; never raises (None when there is no readable arrangement)."""
    if not data or not pattern_indexes:
        return None
    try:
        return build_song(read_song_clips(data), pattern_indexes)
    except Exception as e:
        logger.debug(f"Playlist decoding failed: {e}")
        return None


def parse_flp_project(
    flp_path: str,
    include_song: bool = False,
    display_name: Optional[str] = None,
    resolve_samples: bool = True,
) -> Optional[Dict[str, Any]]:
    """
    Parses an FL Studio project file (.flp) and extracts all channels,
    patterns, notes, and metadata with intelligent channel mapping and sample resolution.

    ``include_song`` adds a ``song`` key with the playlist timeline (see ``extract_song_timeline``).
    ``display_name`` replaces the on-disk file name (uploads are stored under a temporary name).
    ``resolve_samples=False`` skips the sample search (it may walk whole home folders) for previews.
    """
    flp_path = os.path.expanduser(os.path.abspath(flp_path))
    if not os.path.exists(flp_path):
        logger.error(f"File not found: {flp_path}")
        return None

    filename = display_name or os.path.basename(flp_path)
    project_title = os.path.splitext(filename)[0]

    raw_data = _read_bytes(flp_path)

    try:
        project = load_pyflp_project(flp_path, raw_data)
    except Exception as e:
        logger.warning(f"PyFLP parsing error for {flp_path}: {e}")
        return None

    # 1. Project Tempo & PPQ
    tempo = 140.0
    ppq = 96
    try:
        # The raw event stream is exact across FL versions (PyFLP loses the tempo event in FL 25 files)
        bin_tempo = extract_flp_tempo_binary(flp_path, raw_data) if raw_data else None
        if bin_tempo is not None and bin_tempo > 0:
            tempo = bin_tempo
        elif _safe_attr(project, "tempo"):
            tempo = float(project.tempo)
        elif _safe_attr(_safe_attr(project, "misc"), "tempo"):
            tempo = float(project.misc.tempo)

        p = _safe_attr(project, "ppq")
        if p:
            ppq = int(p)
        elif _safe_attr(_safe_attr(project, "misc"), "ppq"):
            ppq = int(project.misc.ppq or 96)

        t_str = str(_safe_attr(project, "title", "") or "").strip()
        if t_str:
            project_title = t_str
    except Exception as e:
        logger.debug(f"Metadata extract warning: {e}")

    # 2. Extract Channels. Notes reference channels by IID (rack_channel), which differs from the
    # list position once channels were deleted, so both lookups are kept apart.
    channels_by_iid: Dict[int, Dict[str, Any]] = {}
    channels_by_index: Dict[int, Dict[str, Any]] = {}
    channels_list: List[Dict[str, Any]] = []

    try:
        raw_channels = list(getattr(project, "channels", []))
    except Exception as e:
        raw_channels = []
        logger.warning(f"Error parsing channels in {filename}: {e}")

    for idx, ch in enumerate(raw_channels):
        try:
            ch_name = _safe_attr(ch, "display_name") or _safe_attr(ch, "name") or f"Channel {idx + 1}"

            raw_sample_path = None
            for attr in ["sample_path", "sample", "filename", "filepath"]:
                val = _safe_attr(ch, attr)
                if val and isinstance(val, (str, os.PathLike)):
                    raw_sample_path = str(val)
                    break

            # Resolve sample path against local file system
            resolved_sample_path = resolve_sample_path(raw_sample_path, flp_path) if raw_sample_path and resolve_samples else None

            generator = _safe_attr(ch, "internal_name") or _safe_attr(ch, "generator_name") or _safe_attr(ch, "plugin_name")
            if not generator or generator == "None":
                generator = type(ch).__name__ if type(ch).__name__ != "Channel" else "Sampler"

            ch_iid = safe_int(_safe_attr(ch, "iid", idx), idx)

            ch_data = {
                "index": idx,
                "iid": ch_iid,
                "name": str(ch_name),
                "sample_path": resolved_sample_path or raw_sample_path,
                "raw_sample_path": raw_sample_path,
                "generator": str(generator)
            }
            channels_by_iid.setdefault(ch_iid, ch_data)
            channels_by_index[idx] = ch_data
            channels_list.append(ch_data)
        except Exception as e:
            logger.debug(f"Skipping unreadable channel {idx} in {filename}: {e}")

    def resolve_channel(note: Any) -> Tuple[int, Optional[Dict[str, Any]]]:
        ref = _safe_attr(note, "rack_channel")
        if ref is None:
            ref = _safe_attr(note, "channel")
        if ref is None:
            return 0, channels_by_index.get(0)
        ref_int = safe_int(ref, -1)
        info = channels_by_iid.get(ref_int)
        if info is None and ref_int < 0:
            info = next((item for item in channels_list if item["iid"] == safe_int(_safe_attr(ref, "iid"), -1)), None)
        if info is not None:
            return info["index"], info
        return max(0, ref_int), None

    # 3. Extract Patterns and Notes per Instrument
    extracted_patterns: List[Dict[str, Any]] = []
    # FL pattern number (PatternID.New, 1-based, what playlist clips reference) -> pattern_index.
    # pattern_index is the PyFLP enumeration position; it is not guaranteed to be iid - 1 (pattern
    # events written before the first PatternID.New would show up as a pseudo-pattern), so the
    # playlist is mapped through the iid instead of assuming that.
    pattern_iids: Dict[int, int] = {}

    raw_patterns = []
    try:
        if hasattr(project, "patterns"):
            for pat in project.patterns:
                raw_patterns.append(pat)
    except Exception as e:
        logger.debug(f"Patterns reading note for {filename}: {e}")

    for p_idx, pat in enumerate(raw_patterns):
        try:
            pat_iid = safe_int(_safe_attr(pat, "iid", -1), -1)
            if pat_iid > 0:
                pattern_iids.setdefault(pat_iid, p_idx)
            # FL names unnamed patterns after their number ("Pattern 4"), not their position
            pat_name = str(_safe_attr(pat, "name") or f"Pattern {pat_iid if pat_iid > 0 else p_idx + 1}")
            # A manually set pattern length (PatternID.Length, read as ticks; 0 or missing in Auto mode)
            # is the period clips repeat at, even when it is longer than the notes.
            loop_ticks = max(0, safe_int(_safe_attr(pat, "length"), 0))
            if loop_ticks > ppq * 4 * MAX_PATTERN_BARS:
                loop_ticks = 0

            try:
                raw_notes = list(getattr(pat, "notes", []))
            except Exception:
                raw_notes = []
            
            if not raw_notes:
                continue

            # Group notes by channel index
            channel_notes: Dict[int, List[Tuple[Dict[str, Any], int]]] = {}
            channel_info: Dict[int, Optional[Dict[str, Any]]] = {}
            
            for n in raw_notes:
                # Key / Pitch
                pitch_val = _safe_attr(n, "key")
                if pitch_val is None:
                    pitch_val = _safe_attr(n, "pitch", 60)
                pitch = note_name_to_midi(pitch_val)

                # Position
                pos_val = _safe_attr(n, "position")
                if pos_val is None:
                    pos_val = _safe_attr(n, "pos", 0)
                pos = max(0, safe_int(pos_val, 0))

                # Duration (step sequencer notes are stored with length 0, fixed below)
                dur_val = _safe_attr(n, "length")
                if dur_val is None:
                    dur_val = _safe_attr(n, "duration", 96)
                raw_length = safe_int(dur_val, 96)

                # Velocity
                vel_val = _safe_attr(n, "velocity")
                if vel_val is None:
                    vel_val = _safe_attr(n, "vol", 100)
                if isinstance(vel_val, float) and vel_val <= 1.0:
                    velocity = int(vel_val * 127)
                else:
                    velocity = safe_int(vel_val, 100)
                velocity = max(1, min(127, velocity))

                ch_idx, info = resolve_channel(n)
                channel_info.setdefault(ch_idx, info)
                channel_notes.setdefault(ch_idx, []).append(({
                    "pitch": pitch,
                    "pos": pos,
                    "duration": max(1, raw_length),
                    "velocity": velocity
                }, raw_length))

            # Create an entry for each channel containing notes in this pattern
            multi_channel = len(channel_notes) > 1
            generic_pattern_name = bool(re.match(r"^Pattern\s*\d+$", pat_name, re.I))

            for ch_idx, entries in channel_notes.items():
                if not entries:
                    continue
                entries.sort(key=lambda entry: (entry[0]["pos"], entry[0]["pitch"]))
                notes_list = [entry[0] for entry in entries]
                _fill_zero_lengths(notes_list, [entry[1] for entry in entries], ppq)

                ch_info = channel_info.get(ch_idx) or {
                    # Channel missing from the rack: a named single-instrument pattern usually carries its name
                    "name": pat_name if not multi_channel and not generic_pattern_name else f"Channel {ch_idx + 1}",
                    "sample_path": None,
                    "generator": "Unknown"
                }

                ch_name = ch_info["name"]
                sample_full_path = ch_info.get("raw_sample_path") or ch_info.get("sample_path")
                tag = classify_tag(ch_name, sample_full_path, notes_list, pat_name)

                # Duration in bars (rounded up: rounding down cut the tail of the part)
                max_tick = max((item["pos"] + item["duration"]) for item in notes_list)
                bars = _bar_count(max_tick, ppq)

                # Display Name: if pattern has a generic name and is multi-channel, clarify with channel name
                display_pat_name = pat_name
                if multi_channel and generic_pattern_name:
                    display_pat_name = f"{pat_name} • {ch_name}"

                # Generate standard MIDI bytes
                midi_bytes = create_midi_bytes(
                    notes=notes_list,
                    tempo=tempo,
                    ppq=ppq,
                    track_name=f"{display_pat_name} - {ch_name}"
                )

                extracted = {
                    "pattern_index": p_idx,
                    "pattern_name": display_pat_name,
                    "channel_index": ch_idx,
                    "channel_name": ch_name,
                    "sample_path": ch_info.get("sample_path"),
                    "tag": tag,
                    "bars": bars,
                    "key": NO_KEY,
                    "note_count": len(notes_list),
                    "notes": notes_list,
                    "midi_bytes": midi_bytes,
                    "tempo": tempo,
                    "ppq": ppq
                }
                if loop_ticks > 0:
                    extracted["loop_ticks"] = loop_ticks
                extracted_patterns.append(extracted)

        except Exception as e:
            logger.warning(f"Error parsing pattern {p_idx + 1} in {filename}: {e}")

    # 4. Keys: estimate the song key from every pitched part, then label each part with it when the
    # part fits that scale (the lowest note, used before, named chord inversions and bass slides instead)
    try:
        part_weights = [_pitch_class_weights(item["notes"], item["tag"], ppq) for item in extracted_patterns]
        totals = [0.0] * 12
        for weights in part_weights:
            if weights:
                totals = [total + weight for total, weight in zip(totals, weights)]
        project_key = _estimate_key(totals)
        for item, weights in zip(extracted_patterns, part_weights):
            item["key"] = _part_key(weights, project_key)
    except Exception as e:
        logger.debug(f"Key detection failed for {filename}: {e}")

    result = {
        "file_path": flp_path,
        "file_name": filename,
        "title": project_title,
        "tempo": tempo,
        "ppq": ppq,
        "channel_count": len(channels_list),
        "pattern_count": len(extracted_patterns),
        "channels": channels_list,
        "patterns": extracted_patterns,
        "file_size": len(raw_data) if raw_data is not None else (os.path.getsize(flp_path) if os.path.exists(flp_path) else 0)
    }
    if include_song:
        result["song"] = extract_song_timeline(raw_data, pattern_iids)
    return result
