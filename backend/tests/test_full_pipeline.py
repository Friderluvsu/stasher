import unittest
import os
import mido
import io
from backend.core.classifier import classify_tag
from backend.core.midi_generator import create_midi_bytes
from backend.core.database import init_db, save_project, query_patterns, query_sounds, get_pattern_midi
from backend.core.sample_resolver import resolve_sample_path

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
        
        # Russian and VST synths
        self.assertEqual(classify_tag("Кик плотный", None), "Kick")
        self.assertEqual(classify_tag("Снейр 808", None), "Snare")
        self.assertEqual(classify_tag("Хэты ролл", None), "Hi-Hat")
        self.assertEqual(classify_tag("Nexus #6", None), "Melody")
        self.assertEqual(classify_tag("Serum Lead", None), "Lead")
        self.assertEqual(classify_tag("Keyscape Grand", None), "Chords")
        self.assertEqual(classify_tag("Xpand!2 #2", None), "Melody")

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

    def test_sample_resolver(self):
        # Resolving a known sample from the user library
        res = resolve_sample_path("D:\\FLProjects\\Сборник сэмплов\\! Frider Beats !\\Drums\\1.808\\4CS - 808 WHEAZZY_2.wav")
        if res:
            self.assertTrue(os.path.exists(res))
            self.assertTrue(res.endswith(".wav"))

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
            "channels": [
                {"index": 0, "name": "4CS - 808 WHEAZZY_2", "sample_path": "D:\\FLProjects\\Drums\\1.808\\4CS - 808 WHEAZZY_2.wav", "generator": "Sampler"},
                {"index": 1, "name": "Nexus #6", "sample_path": None, "generator": "Nexus"}
            ],
            "patterns": [
                {
                    "pattern_index": 0,
                    "pattern_name": "Spinz 808 Heavy",
                    "channel_index": 0,
                    "channel_name": "4CS - 808 WHEAZZY_2",
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

        # Query sounds
        res_sounds = query_sounds(tag="808")
        self.assertTrue(len(res_sounds["items"]) > 0)

        # Query by FTS5 full text search
        res_search = query_patterns(search="Spinz")
        self.assertTrue(any(p["pattern_name"] == "Spinz 808 Heavy" for p in res_search["items"]))

        # Check MIDI retrieval
        pat_id = res_search["items"][0]["id"]
        midi_data = get_pattern_midi(pat_id)
        self.assertIsNotNone(midi_data)
        self.assertTrue(midi_data.startswith(b"MThd"))

    def test_batch_operations(self):
        from backend.core.database import delete_sounds, delete_patterns, update_sounds_tag, update_patterns_tag
        
        test_project = {
            "file_path": "/Test/Projects/Batch_Test_Project.flp",
            "file_name": "Batch_Test_Project.flp",
            "title": "Batch Test",
            "tempo": 140.0,
            "ppq": 96,
            "channel_count": 3,
            "pattern_count": 2,
            "file_size": 2048,
            "channels": [
                {"index": 0, "name": "Batch Sample 1", "sample_path": "/path/s1.wav", "generator": "Sampler"},
                {"index": 1, "name": "Batch Sample 2", "sample_path": "/path/s2.wav", "generator": "Sampler"},
            ],
            "patterns": [
                {
                    "pattern_index": 0,
                    "pattern_name": "Pattern A",
                    "channel_index": 0,
                    "channel_name": "Batch Sample 1",
                    "tag": "Kick",
                    "bars": 2,
                    "key": "C",
                    "note_count": 4,
                    "tempo": 140.0,
                    "ppq": 96,
                    "notes": [],
                    "midi_bytes": create_midi_bytes([])
                },
                {
                    "pattern_index": 1,
                    "pattern_name": "Pattern B",
                    "channel_index": 1,
                    "channel_name": "Batch Sample 2",
                    "tag": "Snare",
                    "bars": 2,
                    "key": "C",
                    "note_count": 4,
                    "tempo": 140.0,
                    "ppq": 96,
                    "notes": [],
                    "midi_bytes": create_midi_bytes([])
                }
            ]
        }
        project_id = save_project(test_project)
        pats = query_patterns(project_id=project_id)["items"]
        snds = query_sounds(project_id=project_id)["items"]
        
        pat_ids = [p["id"] for p in pats]
        snd_ids = [s["id"] for s in snds]
        
        # Test batch tag update
        update_patterns_tag(pat_ids, "808")
        update_sounds_tag(snd_ids, "808")
        
        updated_pats = query_patterns(project_id=project_id)["items"]
        for p in updated_pats:
            self.assertEqual(p["tag"], "808")
            
        updated_snds = query_sounds(project_id=project_id)["items"]
        for s in updated_snds:
            self.assertEqual(s["tag"], "808")
            
        # Test batch delete
        delete_patterns(pat_ids)
        delete_sounds(snd_ids)
        
        after_pats = query_patterns(project_id=project_id)["items"]
        after_snds = query_sounds(project_id=project_id)["items"]
        self.assertEqual(len(after_pats), 0)
        self.assertEqual(len(after_snds), 0)

if __name__ == "__main__":
    unittest.main()
