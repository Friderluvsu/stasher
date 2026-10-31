import os
import tempfile
import unittest
from unittest.mock import patch

import inspect

from backend.api import main
from backend.core import database


class LibraryQueryTest(unittest.TestCase):
    """List paging and search, on a throwaway DB (never the vault)."""

    SOUND_NAMES = ["Hi-Hat 22.wav", "kick_01.wav", "C#m pad.wav", "Snare (dry).wav"] + [f"perc {i}.wav" for i in range(26)]

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_patch = patch.object(database, "DB_PATH", os.path.join(self.tmp.name, "lib.db"))
        self.db_patch.start()
        database.init_db()
        conn = database.get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO projects (file_path, file_name, title) VALUES ('x.flp', 'x.flp', 'x')")
        for i, name in enumerate(self.SOUND_NAMES):
            cur.execute(
                "INSERT INTO sounds (project_id, channel_index, channel_name, sample_name, sample_path, tag, file_exists, file_size) "
                "VALUES (1, ?, ?, ?, NULL, 'Other', ?, 0)",
                # Mixed file_exists: the sound list orders by it first, so paging must stay stable across both groups.
                (i, name, name, i % 3 == 0),
            )
            cur.execute(
                "INSERT INTO fts_sounds (sound_id, sample_name, channel_name, tag, project_title, file_name) VALUES (?, ?, ?, 'Other', 'x', 'x.flp')",
                (cur.lastrowid, name, name),
            )
        for i in range(25):
            cur.execute(
                "INSERT INTO patterns (project_id, pattern_index, pattern_name, channel_index, channel_name, tag, notes_json) "
                "VALUES (1, ?, ?, 0, 'Keys', 'Chords', '[]')",
                (i, f"Pattern {i}"),
            )
            cur.execute(
                "INSERT INTO fts_patterns (pattern_id, pattern_name, channel_name, tag, project_title, file_name) VALUES (?, ?, 'Keys', 'Chords', 'x', 'x.flp')",
                (cur.lastrowid, f"Pattern {i}"),
            )
        conn.commit()
        conn.close()

    def tearDown(self):
        self.db_patch.stop()
        self.tmp.cleanup()

    def _names(self, search):
        return {item["sample_name"] for item in database.query_sounds(search=search)["items"]}

    def test_search_with_punctuation_does_not_fail(self):
        # Each of these used to raise an FTS5 syntax error, which failed the whole list request.
        self.assertEqual(self._names("hi-hat"), {"Hi-Hat 22.wav"})
        self.assertEqual(self._names("C#m"), {"C#m pad.wav"})
        self.assertEqual(self._names("kick_0"), {"kick_01.wav"})
        self.assertEqual(self._names("(dry"), {"Snare (dry).wav"})
        self.assertEqual(database.query_sounds(search='"')["total"], len(self.SOUND_NAMES))
        self.assertEqual(database.query_patterns(search="pattern 1")["total"], 11)

    def test_fts_query_quotes_every_word(self):
        self.assertIsNone(database.fts_match_query("  # ! "))
        self.assertEqual(database.fts_match_query('hi-hat "x'), '"hi-hat"* """x"*')

    def test_pages_cover_every_row_once(self):
        for query, key in ((database.query_sounds, "sound"), (database.query_patterns, "pattern")):
            total = query()["total"]
            seen = []
            offset = 0
            while offset < total:
                page = query(limit=7, offset=offset)["items"]
                self.assertTrue(page, key)
                seen.extend(item["id"] for item in page)
                offset += len(page)
            self.assertEqual(len(seen), total, key)
            self.assertEqual(len(set(seen)), total, key)

    def test_list_routes_bound_paging(self):
        # starlette's TestClient needs httpx, which the local venv does not have, so the bounds are read off the routes.
        for route in (main.list_patterns, main.list_sounds):
            params = inspect.signature(route).parameters
            limit = {type(m).__name__: m for m in params["limit"].default.metadata}
            offset = {type(m).__name__: m for m in params["offset"].default.metadata}
            self.assertEqual((params["limit"].default.default, limit["Ge"].ge, limit["Le"].le), (200, 1, 5000), route.__name__)
            self.assertEqual(offset["Ge"].ge, 0, route.__name__)

if __name__ == "__main__":
    unittest.main()
