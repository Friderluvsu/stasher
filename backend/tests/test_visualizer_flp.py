import asyncio
import io
import os
import struct
import tempfile
import unittest
from unittest.mock import patch

import pyflp
from fastapi import HTTPException, UploadFile
from backend.api.main import _visualizer_patterns, parse_flp_for_visualizer
from backend.core.flp_playlist import build_song, decode_playlist, detect_item_size, iter_flp_events, pad_short_dword_events, read_song_clips, read_tempo
from backend.core.parser import _bar_count, _estimate_key, _fill_zero_lengths, _part_key, _pitch_class_weights, load_pyflp_project, parse_flp_project

TEST_FLP = os.environ.get("STASHER_TEST_FLP", "")


def _varint(value):
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        out.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(out)


def _event(event_id, payload):
    if event_id >= 192:
        return bytes([event_id]) + _varint(len(payload)) + payload
    return bytes([event_id]) + payload


def _flp(*events, ppq=96):
    body = b"".join(events)
    return b"FLhd" + struct.pack("<IhHH", 6, 0, 1, ppq) + b"FLdt" + struct.pack("<I", len(body)) + body


def _version(text):
    return _event(199, text.encode("ascii") + b"\x00")


def _item(size, position, item_index, length, track_rvidx, start=-1, end=-1):
    head = struct.pack("<IHHIHH", position, 20480, item_index, length, track_rvidx, 0) + b"\x78\x00" + struct.pack("<H", 0x40) + b"\x40\x64\x80\x80"
    offsets = struct.pack("<ii", start, end) if item_index > 20480 else struct.pack("<ff", float("nan"), float("nan"))
    tail = bytes(size - 32)
    if size == 80:
        tail = struct.pack("<I", 1) + tail[4:]
    return head + offsets + tail


def _playlist(size, max_track=499):
    return b"".join([
        _item(size, 384, 20481, 192, max_track - 2, 96, 288),   # pattern 1, track 2, starts 96 ticks into the pattern
        _item(size, 0, 20482, 384, max_track),                  # pattern 2, track 0, offsets not set (-1)
        _item(size, 0, 3, 1536, max_track - 1),                 # audio clip of channel 3: ignored
        _item(size, 768, 20483, 384, max_track - 3),            # pattern 3 has no notes: dropped by build_song
    ])


class PlaylistDecodingTest(unittest.TestCase):
    def assert_song(self, song):
        self.assertEqual(song["ticks"], 576)
        self.assertEqual(song["clips"], [
            {"pattern_index": 1, "position": 0, "length": 384, "offset": 0, "track": 0},
            {"pattern_index": 0, "position": 384, "length": 192, "offset": 96, "track": 2},
        ])

    def test_each_item_size(self):
        for size, version in ((32, "20.8.4.2576"), (60, "21.0.3.3517"), (80, "25.2.5.5055")):
            with self.subTest(size=size):
                payload = _playlist(size)
                self.assertEqual(detect_item_size(payload), size)
                data = _flp(_version(version), _event(99, struct.pack("<H", 0)), _event(241, "A\x00".encode("utf-16-le")), _event(233, payload), _event(100, struct.pack("<H", 0)))
                clips = read_song_clips(data)
                self.assertEqual(len(clips), 3)
                self.assert_song(build_song(clips, {1: 0, 2: 1}))

    def test_ambiguous_payload_lengths(self):
        five_small = b"".join(_item(32, index * 96, 20481, 96, 499) for index in range(5))
        two_large = b"".join(_item(80, index * 96, 20481, 96, 499) for index in range(2))
        eight_mid = b"".join(_item(60, index * 96, 20481, 96, 499) for index in range(8))
        self.assertEqual(detect_item_size(five_small), 32)   # 160 bytes: also a multiple of 80
        self.assertEqual(detect_item_size(two_large), 80)    # 160 bytes: also a multiple of 32
        self.assertEqual(detect_item_size(eight_mid), 60)    # 480 bytes: also a multiple of 32 and 80
        self.assertEqual(len(decode_playlist(five_small)), 5)

    def test_implausible_offsets_fall_back_to_zero(self):
        float_encoded = struct.unpack("<i", struct.pack("<f", 0.5))[0]
        items = decode_playlist(_item(32, 0, 20481, 96, 499, float_encoded, -1) + _item(32, 96, 20481, 96, 499, -7, -1))
        self.assertEqual([item["offset"] for item in items], [0, 0])

    def test_unknown_future_item_size(self):
        payload = b"".join(_item(96, index * 96, 20481, 96, 499) for index in range(3))
        self.assertEqual(detect_item_size(payload), 96)
        self.assertEqual([item["position"] for item in decode_playlist(payload)], [0, 96, 192])

    def test_old_projects_use_198_track_slots(self):
        data = _flp(_version("12.3.0.0"), _event(233, _playlist(32, max_track=198)))
        self.assert_song(build_song(read_song_clips(data), {1: 0, 2: 1}))

    def test_selected_arrangement_wins(self):
        first = _item(80, 0, 20481, 384, 499)
        second = _item(80, 1536, 20482, 768, 498)
        data = _flp(
            _version("25.2.5.5055"),
            _event(99, struct.pack("<H", 0)), _event(233, first),
            _event(99, struct.pack("<H", 1)), _event(233, second),
            _event(100, struct.pack("<H", 1)),
        )
        song = build_song(read_song_clips(data), {1: 1, 2: 2})
        self.assertEqual(song["clips"], [{"pattern_index": 2, "position": 1536, "length": 768, "offset": 0, "track": 1}])
        self.assertEqual(song["ticks"], 2304)

    def test_broken_playlists_never_raise(self):
        garbage = bytes(range(256)) * 3
        self.assertEqual(read_song_clips(_flp(_version("25.2.5.5055"), _event(99, b"\x00\x00"), _event(233, garbage))), [])
        self.assertEqual(read_song_clips(_flp(_version("25.2.5.5055"))), [])
        truncated = _flp(_version("25.2.5.5055"), _event(233, _playlist(80)))[:-50]
        self.assertEqual(read_song_clips(truncated), [])
        self.assertIsNone(build_song([], {1: 0}))
        with self.assertRaises(ValueError):
            list(iter_flp_events(b"RIFF0000"))

    def test_fl25_short_event_keeps_stream_aligned(self):
        text = "FL Studio 25\x00".encode("utf-16-le")
        data = _flp(_version("25.2.5.5055"), _event(28, b"\x01"), b"\xac\x01\x01\x00", _event(192, text), _event(156, struct.pack("<I", 164000)))
        self.assertEqual(read_tempo(data), 164.0)
        regular = _flp(_version("25.2.5.5055"), _event(172, struct.pack("<I", 5)), _event(156, struct.pack("<I", 140500)))
        self.assertEqual(read_tempo(regular), 140.5)
        legacy = _flp(_version("3.0.0"), _event(66, struct.pack("<H", 128)), _event(93, struct.pack("<H", 250)))
        self.assertEqual(read_tempo(legacy), 128.25)


def _note(pos, length, key, rack_channel=0, velocity=100):
    return struct.pack("<IHHIHHBBBBBBBB", pos, 0, rack_channel, length, key, 0, 120, 0, 0, 0, 64, velocity, 128, 128)


def _fl25_project(pattern_length=None, short_dword=True):
    """Smallest project PyFLP can read channels from, laid out like FL 25: a 3-byte event 172, then a UTF-16 text event."""
    pattern = [_event(65, struct.pack("<H", 1))]
    if pattern_length is not None:
        pattern.append(_event(164, struct.pack("<I", pattern_length)))
    pattern.append(_event(224, _note(0, 96, 61) + _note(96, 96, 64)))
    return _flp(
        _version("25.2.5.5055"),
        _event(28, b"\x01"),
        b"\xac\x01\x01\x00" if short_dword else b"\xac\x01\x01\x00\x00",
        _event(192, b"F\x00L\x00" * 13 + b"\x00\x00"),
        _event(156, struct.pack("<I", 164000)),
        _event(231, "Unsorted\x00".encode("utf-16-le")),
        _event(64, struct.pack("<H", 0)),
        _event(21, b"\x00"),
        _event(145, struct.pack("<i", 0)),
        _event(203, "Kick\x00".encode("utf-16-le")),
        *pattern,
    )


class ShortDwordEventTest(unittest.TestCase):
    def test_padding_adds_one_byte_per_event_and_fixes_the_chunk_size(self):
        data = _fl25_project()
        padded = pad_short_dword_events(data)
        self.assertEqual(len(padded), len(data) + 1)
        self.assertEqual(struct.unpack_from("<I", padded, 18)[0], len(padded) - 22)
        before = list(iter_flp_events(data))
        after = list(iter_flp_events(padded))
        self.assertEqual([event_id for event_id, _ in before], [event_id for event_id, _ in after])
        self.assertEqual([len(payload) for event_id, payload in after if event_id == 172], [4])
        self.assertEqual(next(payload for event_id, payload in after if event_id == 172), b"\x01\x01\x00\x00")
        self.assertEqual([payload for event_id, payload in before if event_id != 172], [payload for event_id, payload in after if event_id != 172])
        self.assertEqual(pad_short_dword_events(padded), padded, "padding twice must not change anything")

    def test_other_streams_are_returned_unchanged(self):
        regular = _fl25_project(short_dword=False)
        self.assertIs(pad_short_dword_events(regular), regular)
        legacy = _flp(_version("3.0.0"), _event(66, struct.pack("<H", 128)))
        self.assertIs(pad_short_dword_events(legacy), legacy)
        with self.assertRaises(ValueError):
            pad_short_dword_events(b"RIFF0000WAVE")

    def test_truncated_tail_is_kept(self):
        data = _fl25_project()[:-5]
        padded = pad_short_dword_events(data)
        self.assertEqual(len(padded), len(data) + 1)
        self.assertEqual(padded[-5:], data[-5:])

    def test_pyflp_reads_the_channel_list(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "fl25.flp")
            with open(path, "wb") as handle:
                handle.write(_fl25_project())
            project = load_pyflp_project(path, _fl25_project())
            self.assertEqual([channel.display_name or channel.name for channel in project.channels], ["Kick"])

    def test_parse_keeps_channels_and_plain_pattern_numbers(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "fl25.flp")
            raw = _fl25_project()
            with open(path, "wb") as handle:
                handle.write(raw)
            with patch("backend.core.parser.pyflp.parse", wraps=pyflp.parse) as parse:
                data = parse_flp_project(path, include_song=True, resolve_samples=False)
            self.assertEqual(data["tempo"], 164.0)
            self.assertEqual(data["channel_count"], 1)
            self.assertEqual(data["channels"][0]["name"], "Kick")
            self.assertEqual(data["pattern_count"], 1)
            self.assertEqual([(part["pattern_index"], part["channel_name"]) for part in data["patterns"]], [(0, "Kick")])
            self.assertEqual(data["file_size"], len(raw), "file_size is the size of the user's file, not of the padded copy")
            parsed = parse.call_args.args[0]
            self.assertNotEqual(parsed, path, "PyFLP must read a padded copy")
            self.assertFalse(os.path.exists(parsed), "the padded copy must be removed")
            with open(path, "rb") as handle:
                self.assertEqual(handle.read(), raw, "the user's file must stay untouched")

    def test_regular_project_is_parsed_in_place(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "regular.flp")
            with open(path, "wb") as handle:
                handle.write(_fl25_project(short_dword=False))
            with patch("backend.core.parser.pyflp.parse", wraps=pyflp.parse) as parse:
                data = parse_flp_project(path, resolve_samples=False)
            self.assertEqual(parse.call_args.args[0], path)
            self.assertEqual(data["channel_count"], 1)
            self.assertEqual(data["tempo"], 164.0)


class PatternLengthTest(unittest.TestCase):
    def parse(self, **kwargs):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "project.flp")
            with open(path, "wb") as handle:
                handle.write(_fl25_project(**kwargs))
            return parse_flp_project(path, resolve_samples=False)

    def test_manual_length_becomes_loop_ticks(self):
        part = self.parse(pattern_length=1536)["patterns"][0]
        self.assertEqual(part["loop_ticks"], 1536)
        self.assertEqual(part["bars"], 1, "bars still describe the notes only")
        self.assertEqual(_visualizer_patterns({"patterns": [part]})[0]["loop_ticks"], 1536)

    def test_auto_length_has_no_loop_ticks(self):
        for length in (None, 0):
            with self.subTest(length=length):
                part = self.parse(pattern_length=length)["patterns"][0]
                self.assertNotIn("loop_ticks", part)
                self.assertNotIn("loop_ticks", _visualizer_patterns({"patterns": [part]})[0])

    def test_absurd_length_is_ignored(self):
        self.assertNotIn("loop_ticks", self.parse(pattern_length=0xFFFFFFF0)["patterns"][0])


class NoteHelpersTest(unittest.TestCase):
    def test_bars_round_up(self):
        self.assertEqual(_bar_count(384, 96), 1)
        self.assertEqual(_bar_count(390, 96), 1)     # a short release tail does not open a new bar
        self.assertEqual(_bar_count(4705, 96), 13)   # used to be round(12.25) = 12, cutting the part
        self.assertEqual(_bar_count(1, 96), 1)

    def test_zero_length_steps_get_a_sixteenth(self):
        notes = [{"pitch": 72, "pos": pos, "duration": 1, "velocity": 100} for pos in (0, 0, 6, 96)]
        _fill_zero_lengths(notes, [0, 0, 0, 0], 96)
        self.assertEqual([note["duration"] for note in notes], [6, 6, 24, 24])
        played = [{"pitch": 72, "pos": 0, "duration": 300, "velocity": 100}]
        _fill_zero_lengths(played, [300], 96)
        self.assertEqual(played[0]["duration"], 300)

    def test_keys(self):
        chord = [{"pitch": pitch, "pos": bar * 384, "duration": 384, "velocity": 90} for bar, chord in enumerate(((61, 64, 68), (57, 61, 64), (66, 69, 73), (68, 71, 75))) for pitch in chord]
        weights = _pitch_class_weights(chord, "Chords", 96)
        self.assertEqual(_part_key(weights, _estimate_key(weights)), "C#m")
        bass = [{"pitch": pitch, "pos": index * 192, "duration": 192, "velocity": 120} for index, pitch in enumerate((37, 37, 44, 37))]
        self.assertEqual(_part_key(_pitch_class_weights(bass, "808", 96), (1, True)), "C#m")
        self.assertEqual(_part_key(_pitch_class_weights(bass, "808", 96), None), "C#")
        self.assertIsNone(_pitch_class_weights(chord, "Hi-Hat", 96))
        self.assertIsNone(_pitch_class_weights([{"pitch": 72, "pos": 0, "duration": 24, "velocity": 100}], "Vox", 96))
        self.assertEqual(_part_key(None, (1, True)), "—")


class VisualizerFlpTest(unittest.TestCase):
    def project(self, **extra):
        project = {
            "title": "Demo",
            "tempo": 128,
            "ppq": 96,
            "patterns": [{
                "pattern_index": 0,
                "pattern_name": "Intro",
                "channel_index": 1,
                "channel_name": "Lead",
                "tag": "Lead",
                "bars": 1,
                "key": "C",
                "note_count": 1,
                "notes": [{"pitch": 60, "pos": 0, "duration": 96, "velocity": 100}],
                "midi_bytes": b"private binary data",
                "sample_path": "/private/sample.wav",
            }],
        }
        project.update(extra)
        return project

    def call(self, project, content=b"FLhdtest", filename="demo.flp"):
        uploaded = UploadFile(filename=filename, file=io.BytesIO(content))
        with patch("backend.api.main.parse_flp_project", return_value=project) as parse, patch("backend.api.main.save_project") as save:
            try:
                return asyncio.run(parse_flp_for_visualizer(uploaded)), parse
            finally:
                save.assert_not_called()

    def test_parse_returns_only_note_data_without_saving(self):
        result, parse = self.call(self.project())
        self.assertEqual(result["title"], "Demo")
        self.assertEqual(result["patterns"][0]["notes"][0]["pitch"], 60)
        self.assertEqual(result["patterns"][0]["key_root"], "C")
        self.assertNotIn("midi_bytes", result["patterns"][0])
        self.assertNotIn("sample_path", result["patterns"][0])
        self.assertIsNone(result["song"])
        parse.assert_called_once()
        path = parse.call_args.args[0]
        self.assertTrue(parse.call_args.kwargs["include_song"])
        self.assertEqual(parse.call_args.kwargs["display_name"], "demo.flp")
        self.assertFalse(parse.call_args.kwargs["resolve_samples"], "previews must not walk the sample folders")
        self.assertFalse(os.path.exists(path), "the uploaded copy must be removed")

    def test_song_keeps_only_clips_of_returned_parts(self):
        song = {"ticks": 9999, "clips": [
            {"pattern_index": 0, "position": 768, "length": 384, "offset": None, "track": 1},
            {"pattern_index": 0, "position": 0, "length": 384, "offset": 96, "track": 0},
            {"pattern_index": 7, "position": 1536, "length": 384, "offset": 0, "track": 2},
            {"pattern_index": 0, "position": 2000, "length": 0, "offset": 0, "track": 0},
        ]}
        result, _ = self.call(self.project(song=song))
        self.assertEqual(result["song"], {"ticks": 1152, "clips": [
            {"pattern_index": 0, "position": 0, "length": 384, "offset": 96, "track": 0},
            {"pattern_index": 0, "position": 768, "length": 384, "offset": 0, "track": 1},
        ]})
        result, _ = self.call(self.project(song={"ticks": 10, "clips": [{"pattern_index": 3, "position": 0, "length": 10}]}))
        self.assertIsNone(result["song"])

    def test_rejects_non_flp(self):
        uploaded = UploadFile(filename="demo.mp3", file=io.BytesIO(b"audio"))
        with self.assertRaises(HTTPException) as error:
            asyncio.run(parse_flp_for_visualizer(uploaded))
        self.assertEqual(error.exception.status_code, 415)

    def test_readable_errors(self):
        cases = (
            (dict(content=b"RIFF....WAVE"), None, 422),
            (dict(content=b""), None, 422),
            (dict(), None, 422),
            (dict(), {"title": "Empty", "patterns": [{"pattern_index": 0, "notes": []}]}, 422),
        )
        for kwargs, project, status in cases:
            with self.subTest(kwargs=kwargs, project=project):
                with self.assertRaises(HTTPException) as error:
                    self.call(project, **kwargs)
                self.assertEqual(error.exception.status_code, status)
                self.assertTrue(error.exception.detail.endswith("."))

    def test_too_large(self):
        with patch("backend.api.main.VISUALIZER_MAX_UPLOAD", 4), self.assertRaises(HTTPException) as error:
            self.call(self.project(), content=b"FLhd" + bytes(64))
        self.assertEqual(error.exception.status_code, 413)


@unittest.skipUnless(TEST_FLP and os.path.isfile(TEST_FLP), "set STASHER_TEST_FLP to a real .flp to run")
class RealProjectTest(unittest.TestCase):
    def test_endpoint_returns_consistent_song(self):
        with open(TEST_FLP, "rb") as handle:
            uploaded = UploadFile(filename=os.path.basename(TEST_FLP), file=io.BytesIO(handle.read()))
        result = asyncio.run(parse_flp_for_visualizer(uploaded))
        self.assertGreater(result["tempo"], 0)
        self.assertTrue(result["patterns"])
        indexes = {pattern["pattern_index"] for pattern in result["patterns"]}
        for pattern in result["patterns"]:
            self.assertTrue(pattern["notes"])
            self.assertTrue(all(note["duration"] >= 1 for note in pattern["notes"]))
            self.assertGreaterEqual(pattern["bars"] * pattern["ppq"] * 4, max(note["pos"] + note["duration"] for note in pattern["notes"]) - pattern["ppq"] // 8)
        song = result["song"]
        if song is None:
            return
        positions = [(clip["position"], clip["track"]) for clip in song["clips"]]
        self.assertEqual(positions, sorted(positions))
        for clip in song["clips"]:
            self.assertIn(clip["pattern_index"], indexes)
            self.assertGreater(clip["length"], 0)
            self.assertGreaterEqual(clip["offset"], 0)
            self.assertGreaterEqual(clip["track"], 0)
        self.assertEqual(song["ticks"], max(clip["position"] + clip["length"] for clip in song["clips"]))

    def test_vault_shape_and_pattern_numbers(self):
        with open(TEST_FLP, "rb") as handle:
            raw = handle.read()
        data = parse_flp_project(TEST_FLP, resolve_samples=False)
        self.assertNotIn("song", data)
        iids = {}
        for index, pattern in enumerate(load_pyflp_project(TEST_FLP, raw).patterns):
            try:
                iids[index] = pattern.iid
            except KeyError:
                pass
        for pattern in data["patterns"]:
            self.assertIn(pattern["pattern_index"], iids)
            name = pattern["pattern_name"].split(" • ")[0]
            if name.startswith("Pattern "):
                self.assertEqual(name, f"Pattern {iids[pattern['pattern_index']]}")
        song = parse_flp_project(TEST_FLP, include_song=True, resolve_samples=False)["song"]
        if song:
            clips = read_song_clips(raw)
            mapped = {(clip["position"], clip["length"], clip["track"]) for clip in clips}
            self.assertTrue(all((clip["position"], clip["length"], clip["track"]) in mapped for clip in song["clips"]))
            for clip in clips:
                index = next((i for i, iid in iids.items() if iid == clip["pattern_iid"]), None)
                if index is not None and any(pattern["pattern_index"] == index for pattern in data["patterns"]):
                    self.assertIn({"pattern_index": index, "position": clip["position"], "length": clip["length"], "offset": clip["offset"], "track": clip["track"]}, song["clips"])


if __name__ == "__main__":
    unittest.main()
