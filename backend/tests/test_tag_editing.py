import os
import tempfile
import unittest
from unittest.mock import patch

from starlette.routing import Match

from backend.api.main import app
from backend.core import database


def _route_for(method: str, path: str) -> str:
    scope = {"type": "http", "path": path, "method": method, "root_path": ""}
    for route in app.router.routes:
        match, _ = route.matches(scope)
        if match == Match.FULL:
            return route.path
    return ""


class TagRoutingTest(unittest.TestCase):
    """Batch routes share a prefix with the single-item routes; they used to be swallowed by them (422)."""

    def test_batch_tag_routes_are_reachable(self):
        self.assertEqual(_route_for("PATCH", "/api/sounds/batch-tag"), "/api/sounds/batch-tag")
        self.assertEqual(_route_for("PATCH", "/api/patterns/batch-tag"), "/api/patterns/batch-tag")

    def test_single_item_routes_still_match_ids(self):
        self.assertEqual(_route_for("PATCH", "/api/sounds/7"), "/api/sounds/{sound_id:int}")
        self.assertEqual(_route_for("PATCH", "/api/patterns/7"), "/api/patterns/{pattern_id:int}")


class TagStorageTest(unittest.TestCase):
    """Writes go to a throwaway DB, never the vault."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_patch = patch.object(database, "DB_PATH", os.path.join(self.tmp.name, "tags.db"))
        self.db_patch.start()
        database.init_db()
        conn = database.get_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO projects (file_path, file_name, title) VALUES ('x.flp', 'x.flp', 'x')")
        cur.execute(
            "INSERT INTO sounds (project_id, channel_index, channel_name, sample_name, sample_path, tag, file_exists, file_size) "
            "VALUES (1, 0, 'Channel 3', 'kick_01.wav', NULL, 'Other', 0, 0)"
        )
        cur.execute(
            "INSERT INTO fts_sounds (sound_id, sample_name, channel_name, tag, project_title, file_name) "
            "VALUES (1, 'kick_01.wav', 'Channel 3', 'Other', 'x', 'x.flp')"
        )
        conn.commit()
        conn.close()

    def tearDown(self):
        self.db_patch.stop()
        self.tmp.cleanup()

    def _sound(self):
        conn = database.get_connection()
        row = dict(conn.execute("SELECT channel_name, sample_name, tag FROM sounds WHERE id = 1").fetchone())
        conn.close()
        return row

    def test_rename_sets_title_and_keeps_extension(self):
        database.update_sound(1, "Hard Kick", "kick")
        self.assertEqual(self._sound(), {"channel_name": "Hard Kick", "sample_name": "Hard Kick.wav", "tag": "Kick"})

    def test_rename_with_extension_is_not_doubled(self):
        database.update_sound(1, "Hard Kick.wav", "Kick")
        self.assertEqual(self._sound()["sample_name"], "Hard Kick.wav")
        self.assertEqual(self._sound()["channel_name"], "Hard Kick")

    def test_batch_tag_is_normalised(self):
        database.update_sounds_tag([1], "open hat")
        self.assertEqual(self._sound()["tag"], "Open Hat")


if __name__ == "__main__":
    unittest.main()
