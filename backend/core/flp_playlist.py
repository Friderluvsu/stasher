"""Low-level FL Studio event reader and playlist (arrangement) decoder.

PyFLP 2.2 cannot read the playlist of recent projects: FL 25 writes 80-byte
playlist items (PyFLP only knows 32/60) and ``Arrangement.tracks`` raises
``KeyError(PatternID.New)``. The song timeline is therefore decoded straight
from the raw event stream and never depends on PyFLP models.
"""

import math
import re
import struct
from typing import Any, Dict, Iterator, List, Optional, Tuple

WORD, DWORD, TEXT, DATA = 64, 128, 192, 208

EVENT_TEMPO_COARSE = WORD + 2
EVENT_TEMPO_FINE = WORD + 29
EVENT_ARRANGEMENT_NEW = WORD + 35
EVENT_ARRANGEMENT_CURRENT = WORD + 36
EVENT_TEMPO = DWORD + 28
EVENT_SHORT_DWORD = DWORD + 44
EVENT_FL_VERSION = TEXT + 7
EVENT_PLAYLIST = DATA + 25

PATTERN_BASE = 20480
KNOWN_ITEM_SIZES = (80, 60, 32)
MAX_TICKS = 1 << 30
# Any positive float32 read as int32 is >= 2**23, so this also rejects float-encoded offsets.
MAX_OFFSET = 1 << 22
MAX_TRACK_RVIDX = 1024

# position, pattern_base, item_index, length, track_rvidx, group, ?, item_flags, ?, start_offset, end_offset
_ITEM_HEAD = struct.Struct("<IHHIHH2sH4s4s4s")


class FlpFormatError(ValueError):
    pass


def _data_chunk_offset(data: bytes) -> int:
    """Offset of the ``FLdt`` chunk: right after the header, else searched for."""
    if len(data) < 14 or data[:4] != b"FLhd":
        raise FlpFormatError("Not an FL Studio project")
    header_size = struct.unpack_from("<I", data, 4)[0]
    offset = 8 + header_size
    if data[offset:offset + 4] != b"FLdt":
        offset = data.find(b"FLdt", 8)
        if offset < 0:
            raise FlpFormatError("FL Studio project has no data chunk")
    return offset


def _event_spans(data: bytes) -> Iterator[Tuple[int, int, int]]:
    """Yields ``(event_id, payload_start, size)``; stops quietly at a truncated tail."""
    offset = _data_chunk_offset(data)
    if len(data) < offset + 8:
        return
    declared = struct.unpack_from("<I", data, offset + 4)[0]
    pos = offset + 8
    end = len(data) if declared <= 0 else min(len(data), pos + declared)
    version: Optional[Tuple[int, ...]] = None
    while pos < end:
        event_id = data[pos]
        pos += 1
        if event_id < WORD:
            size = 1
        elif event_id < DWORD:
            size = 2
        elif event_id < TEXT:
            size = 3 if event_id == EVENT_SHORT_DWORD and _is_short_dword(data, pos, end, version) else 4
        else:
            varint = _read_varint(data, pos, end)
            if varint is None:
                return
            size, pos = varint
        if pos + size > end:
            return
        if event_id == EVENT_FL_VERSION and version is None:
            version = parse_version(data[pos:pos + size].decode("ascii", "ignore"))
        yield event_id, pos, size
        pos += size


def iter_flp_events(data: bytes) -> Iterator[Tuple[int, bytes]]:
    """Yields ``(event_id, payload)`` pairs; stops quietly at a truncated tail."""
    for event_id, start, size in _event_spans(data):
        yield event_id, data[start:start + size]


def pad_short_dword_events(data: bytes) -> bytes:
    """Pads FL 25's 3-byte event 172 to the 4 bytes every other DWORD event has.

    PyFLP reads each event in 128..191 as exactly 4 bytes. With the 3-byte form it swallows the id of
    the text event that follows and turns the head of the stream into garbage events (the channel list
    is lost, a pseudo-pattern appears). The bytes are spliced in place: nothing else is rewritten, the
    data chunk size is raised to match, and ``data`` itself is returned when there is nothing to pad.
    """
    cuts = [start + size for event_id, start, size in _event_spans(data) if event_id == EVENT_SHORT_DWORD and size == 3]
    if not cuts:
        return data
    offset = _data_chunk_offset(data)
    declared = struct.unpack_from("<I", data, offset + 4)[0]
    if declared <= 0:
        return data
    pieces: List[bytes] = []
    last = 0
    for cut in cuts:
        pieces.append(data[last:cut])
        pieces.append(b"\x00")
        last = cut
    pieces.append(data[last:])
    padded = bytearray(b"".join(pieces))
    struct.pack_into("<I", padded, offset + 4, declared + len(cuts))
    return bytes(padded)


def _read_varint(data: bytes, pos: int, end: int) -> Optional[Tuple[int, int]]:
    value = shift = 0
    while pos < end and shift <= 28:
        byte = data[pos]
        pos += 1
        value |= (byte & 0x7F) << shift
        shift += 7
        if not byte & 0x80:
            return value, pos
    return None


def _is_short_dword(data: bytes, pos: int, end: int, version: Optional[Tuple[int, ...]] = None) -> bool:
    # FL 25 writes event 172 with only 3 payload bytes. Reading 4 swallows the id of the
    # event that follows and desynchronises the stream (PyFLP then misses the tempo event).
    # FL 26 also writes a second 172 followed by a byte event, so for FL 25+ every 172 is
    # short; without a version, take 3 bytes when a well-formed UTF-16 text event follows.
    if version and version[0] >= 25:
        return pos + 3 <= end
    if pos + 4 >= end or data[pos + 3] < TEXT or data[pos + 3] >= DATA:
        return False
    varint = _read_varint(data, pos + 4, end)
    if varint is None:
        return False
    size, start = varint
    text = data[start:start + size]
    return size >= 2 and len(text) == size and not size % 2 and text.endswith(b"\x00\x00")


def read_tempo(data: bytes) -> Optional[float]:
    """Project tempo: ``ProjectID.Tempo`` (BPM * 1000) or the legacy coarse/fine pair."""
    coarse = fine = None
    for event_id, payload in iter_flp_events(data):
        if event_id == EVENT_TEMPO:
            value = struct.unpack("<I", payload)[0]
            if 10000 <= value <= 522000:
                return round(value / 1000.0, 3)
        elif event_id == EVENT_TEMPO_COARSE:
            value = struct.unpack("<H", payload)[0]
            if 10 <= value <= 999:
                coarse = float(value)
        elif event_id == EVENT_TEMPO_FINE:
            value = struct.unpack("<H", payload)[0]
            if value <= 999:
                fine = value / 1000.0
    if coarse is not None:
        return round(coarse + (fine or 0.0), 3)
    return None


def parse_version(text: str) -> Optional[Tuple[int, ...]]:
    parts = re.findall(r"\d+", text or "")
    return tuple(int(part) for part in parts[:4]) if parts else None


def _valid_item(payload: bytes, offset: int) -> bool:
    position, base, _index, length, track_rvidx = struct.unpack_from("<IHHIH", payload, offset)
    return base == PATTERN_BASE and 0 < length < MAX_TICKS and position < MAX_TICKS and track_rvidx <= MAX_TRACK_RVIDX


def detect_item_size(payload: bytes) -> Optional[int]:
    """Picks the playlist item stride whose items validate best (32: FL 12-20, 60: FL 21-24, 80: FL 25+)."""
    if not payload:
        return None
    best: Optional[Tuple[Tuple[float, bool, int], int]] = None
    candidates = list(KNOWN_ITEM_SIZES) + [size for size in range(36, 257, 4) if size not in KNOWN_ITEM_SIZES]
    for priority, size in enumerate(candidates):
        if len(payload) < size or len(payload) % size:
            continue
        count = len(payload) // size
        score = sum(_valid_item(payload, index * size) for index in range(count)) / count
        known = size in KNOWN_ITEM_SIZES
        if score < (0.5 if known else 0.95):
            continue
        rank = (score, known, -priority)
        if best is None or rank > best[0]:
            best = (rank, size)
    return best[1] if best else None


def decode_playlist(payload: bytes, max_track: int = 499) -> List[Dict[str, Any]]:
    """Decodes every playlist item. Pattern clips get ``pattern_iid`` (FL's 1-based pattern number)."""
    size = detect_item_size(payload)
    if size is None:
        return []
    items: List[Dict[str, Any]] = []
    for offset in range(0, len(payload) - size + 1, size):
        position, base, item_index, length, track_rvidx, group, _u1, flags, _u2, start_raw, end_raw = _ITEM_HEAD.unpack_from(payload, offset)
        if base != PATTERN_BASE or not 0 < length < MAX_TICKS or position >= MAX_TICKS:
            continue
        item: Dict[str, Any] = {
            "position": position,
            "length": length,
            "track": max(0, max_track - track_rvidx),
            "track_rvidx": track_rvidx,
            "group": group,
            "flags": flags,
        }
        if item_index > base:
            # Pattern clips store their offsets as int32 ticks, -1 meaning "not set".
            start = struct.unpack("<i", start_raw)[0]
            item["kind"] = "pattern"
            item["pattern_iid"] = item_index - base
            item["offset"] = start if 0 <= start < MAX_OFFSET else 0
        else:
            # Audio / automation clips store float offsets (NaN when not set).
            start = struct.unpack("<f", start_raw)[0]
            item["kind"] = "channel"
            item["channel_iid"] = item_index
            item["offset"] = start if math.isfinite(start) and start >= 0 else 0.0
        items.append(item)
    return items


def read_arrangements(data: bytes) -> Tuple[List[Dict[str, Any]], Optional[int], Optional[Tuple[int, ...]]]:
    """Groups playlist payloads by arrangement. Projects older than FL 12.9 have one implicit arrangement."""
    arrangements: List[Dict[str, Any]] = []
    current: Optional[int] = None
    version: Optional[Tuple[int, ...]] = None
    for event_id, payload in iter_flp_events(data):
        if event_id == EVENT_FL_VERSION and version is None:
            version = parse_version(payload.split(b"\x00", 1)[0].decode("ascii", "ignore"))
        elif event_id == EVENT_ARRANGEMENT_NEW:
            arrangements.append({"iid": struct.unpack("<H", payload)[0], "playlist": b""})
        elif event_id == EVENT_PLAYLIST:
            if not arrangements:
                arrangements.append({"iid": 0, "playlist": b""})
            arrangements[-1]["playlist"] += payload
        elif event_id == EVENT_ARRANGEMENT_CURRENT:
            current = struct.unpack("<H", payload)[0]
    return arrangements, current, version


def read_song_clips(data: bytes) -> List[Dict[str, Any]]:
    """Pattern clips of the arrangement FL plays and renders (the selected one), else the first one with clips."""
    arrangements, current, version = read_arrangements(data)
    if not arrangements:
        return []

    def pattern_clips(arrangement: Dict[str, Any]) -> List[Dict[str, Any]]:
        try:
            items = decode_playlist(arrangement["playlist"])
        except Exception:
            return []
        # Track indexes are stored reversed: 499 - track since FL 12.9.1 (500 tracks), 198 - track before.
        if version is not None:
            max_track = 499 if version >= (12, 9, 1) else 198
        else:
            max_track = 499 if any(item["track_rvidx"] > 198 for item in items) else 198
        for item in items:
            item["track"] = max(0, max_track - item["track_rvidx"])
        return [item for item in items if item["kind"] == "pattern"]

    order = list(range(len(arrangements)))
    if current is not None:
        # ArrangementsID.Current is the list position; FL also numbers arrangements from 0 in ArrangementID.New.
        chosen = next((index for index, arrangement in enumerate(arrangements) if arrangement["iid"] == current), None)
        if chosen is None and current < len(arrangements):
            chosen = current
        if chosen is not None:
            order.remove(chosen)
            order.insert(0, chosen)
    for index in order:
        clips = pattern_clips(arrangements[index])
        if clips:
            return clips
    return []


def build_song(clips: List[Dict[str, Any]], pattern_indexes: Dict[int, int]) -> Optional[Dict[str, Any]]:
    """Maps FL pattern numbers to parser ``pattern_index`` values; drops clips of unknown patterns."""
    song_clips = [
        {
            "pattern_index": pattern_indexes[clip["pattern_iid"]],
            "position": int(clip["position"]),
            "length": int(clip["length"]),
            "offset": int(clip.get("offset") or 0),
            "track": int(clip.get("track") or 0),
        }
        for clip in clips
        if clip.get("pattern_iid") in pattern_indexes and clip.get("length", 0) > 0
    ]
    if not song_clips:
        return None
    song_clips.sort(key=lambda clip: (clip["position"], clip["track"], clip["pattern_index"]))
    return {"ticks": max(clip["position"] + clip["length"] for clip in song_clips), "clips": song_clips}
