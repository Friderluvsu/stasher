import unittest
import os
import mido
import io
from backend.core.classifier import classify_tag
from backend.core.midi_generator import create_midi_bytes
from backend.core.database import init_db, save_project, query_patterns, get_pattern_midi

class TestStasherPipeline(unittest.TestCase):
    def setUp(self):
        init_db()

    def test_classifier_rules(self):
        self.assertEqual(classify_tag("Spinz 808", None), "808")
        self.assertEqual(classify_tag("Rack Kick", None), "Kick")
        self.assertEqual(classify_tag("Wheezy HiHat 01", None), "Hi-Hat")
        self.assertEqual(classify_tag("BWB Snare", None), "Snare")
        self.assertEqual(classify_tag("Clap", None), "Clap")
        self.assertEqual(classify_tag("LA Custom Piano", None), "Chords")
        self.assertEqual(classify_tag("Guitar Lead", None), "Lead")

    def test_classifier_note_heuristics(self):
        # High repetitive notes -> Hi-Hat
        hat_notes = [{"pitch": 60, "pos": i * 24, "duration": 12, "velocity": 100} for i in range(16)]
        self.assertEqual(classify_tag("Track 1", None, hat_notes), "Hi-Hat")

        # Low pitched long notes -> 808
        bass_notes = [{"pitch": 30, "pos": 0, "duration": 384, "velocity": 120}]
        self.assertEqual(classify_tag("Track 2", None, bass_notes), "808")

        # Polyphonic chords -> Chords
        chord_notes = [
            {"pitch": 60, "pos": 0, "duration": 384, "velocity": 90},
            {"pitch": 64, "pos": 0, "duration": 384, "velocity": 90},
            {"pitch": 67, "pos": 0, "duration": 384, "velocity": 90},
        ]
        self.assertEqual(classify_tag("Track 3", None, chord_notes), "Chords")

    def test_midi_generation(self):
        notes = [
            {"pitch": 60, "pos": 0, "duration": 96, "velocity": 100},
            {"pitch": 64, "pos": 96, "duration": 96, "velocity": 110},
        ]
        midi_bytes = create_midi_bytes(notes, tempo=140.0, track_name="Test Track")
        self.assertTrue(len(midi_bytes) > 0)
        self.assertTrue(midi_bytes.startswith(b"MThd"))

        # Verify parsing back with mido
        mid = mido.MidiFile(file=io.BytesIO(midi_bytes))
        self.assertEqual(len(mid.tracks), 1)

    def test_database_and_fts_search(self):
        test_project = {
            "file_path": "/Test/Projects/Test_Trap_Project.flp",
            "file_name": "Test_Trap_Project.flp",
            "title": "Test Trap Project",
            "tempo": 150.0,
            "ppq": 96,
            "channel_count": 2,
            "pattern_count": 2,
            "file_size": 1024,
            "patterns": [
                {
                    "pattern_index": 0,
                    "pattern_name": "Spinz 808 Heavy",
                    "channel_index": 0,
                    "channel_name": "Spinz 808",
                    "sample_path": "/Test/808.wav",
                    "tag": "808",
                    "bars": 4,
                    "key": "C",
                    "note_count": 8,
                    "tempo": 150.0,
                    "ppq": 96,
                    "notes": [{"pitch": 36, "pos": 0, "duration": 192, "velocity": 127}],
                    "midi_bytes": create_midi_bytes([{"pitch": 36, "pos": 0, "duration": 192, "velocity": 127}], tempo=150.0)
                }
            ]
        }

        project_id = save_project(test_project)
        self.assertTrue(project_id > 0)

        # Query by tag
        res_tag = query_patterns(tag="808")
        self.assertTrue(any(p["pattern_name"] == "Spinz 808 Heavy" for p in res_tag["items"]))

        # Query by FTS5 full text search
        res_search = query_patterns(search="Spinz")
        self.assertTrue(any(p["pattern_name"] == "Spinz 808 Heavy" for p in res_search["items"]))

        # Check MIDI retrieval
        pat_id = res_search["items"][0]["id"]
        midi_data = get_pattern_midi(pat_id)
        self.assertIsNotNone(midi_data)
        self.assertTrue(midi_data.startswith(b"MThd"))

if __name__ == "__main__":
    unittest.main()
