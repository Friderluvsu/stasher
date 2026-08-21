import os
import io
import json
import sqlite3
import time
import zipfile
from typing import List, Dict, Any, Optional

DEFAULT_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "stasher_data")
DB_PATH = os.environ.get("STASHER_DB_PATH", os.path.join(DEFAULT_DATA_DIR, "stasher.db"))

def get_connection() -> sqlite3.Connection:
    try:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    except Exception:
        pass
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_connection()
    cursor = conn.cursor()

    # 1. Projects table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT UNIQUE,
        file_name TEXT,
        title TEXT,
        tempo REAL,
        ppq INTEGER,
        channel_count INTEGER,
        pattern_count INTEGER,
        file_size INTEGER,
        indexed_at INTEGER
    )
    """)

    # 2. Patterns table (MIDI patterns)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER,
        pattern_index INTEGER,
        pattern_name TEXT,
        channel_index INTEGER,
        channel_name TEXT,
        sample_path TEXT,
        tag TEXT,
        bars INTEGER,
        key_root TEXT,
        note_count INTEGER,
        tempo REAL,
        ppq INTEGER,
        notes_json TEXT,
        midi_bytes BLOB,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
    """)

    # 3. Sounds table (Audio samples / One-shots / Drums)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sounds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER,
        channel_index INTEGER,
        channel_name TEXT,
        sample_name TEXT,
        sample_path TEXT,
        tag TEXT,
        file_exists INTEGER,
        file_size INTEGER,
        root_note TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
    """)

    # Safe migration for existing databases
    try:
        cursor.execute("ALTER TABLE sounds ADD COLUMN root_note TEXT")
    except Exception:
        pass

    # 4. Stacks table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS stacks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        tempo REAL,
        items_json TEXT,
        created_at INTEGER
    )
    """)

    # Indexes
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_patterns_tag ON patterns(tag)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_patterns_project ON patterns(project_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sounds_tag ON sounds(tag)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sounds_project ON sounds(project_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_projects_tempo ON projects(tempo)")

    # Full-Text Search (FTS5) for MIDI Patterns
    cursor.execute("""
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_patterns USING fts5(
        pattern_id UNINDEXED,
        pattern_name,
        channel_name,
        tag,
        project_title,
        file_name
    )
    """)

    # Full-Text Search (FTS5) for Sounds (StashSound)
    cursor.execute("""
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_sounds USING fts5(
        sound_id UNINDEXED,
        sample_name,
        channel_name,
        tag,
        project_title,
        file_name
    )
    """)

    conn.commit()
    conn.close()

def save_project(project_data: Dict[str, Any]) -> int:
    conn = get_connection()
    cursor = conn.cursor()

    now = int(time.time())

    # Insert or update project
    cursor.execute("""
    INSERT INTO projects (file_path, file_name, title, tempo, ppq, channel_count, pattern_count, file_size, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(file_path) DO UPDATE SET
        file_name=excluded.file_name,
        title=excluded.title,
        tempo=excluded.tempo,
        ppq=excluded.ppq,
        channel_count=excluded.channel_count,
        pattern_count=excluded.pattern_count,
        file_size=excluded.file_size,
        indexed_at=excluded.indexed_at
    RETURNING id
    """, (
        project_data["file_path"],
        project_data["file_name"],
        project_data["title"],
        project_data["tempo"],
        project_data["ppq"],
        project_data["channel_count"],
        project_data["pattern_count"],
        project_data["file_size"],
        now
    ))
    
    project_id = cursor.fetchone()["id"]

    # Clear old patterns and sounds for this project
    cursor.execute("DELETE FROM fts_patterns WHERE pattern_id IN (SELECT id FROM patterns WHERE project_id = ?)", (project_id,))
    cursor.execute("DELETE FROM patterns WHERE project_id = ?", (project_id,))
    cursor.execute("DELETE FROM fts_sounds WHERE sound_id IN (SELECT id FROM sounds WHERE project_id = ?)", (project_id,))
    cursor.execute("DELETE FROM sounds WHERE project_id = ?", (project_id,))

    # Insert patterns
    for pat in project_data.get("patterns", []):
        cursor.execute("""
        INSERT INTO patterns (
            project_id, pattern_index, pattern_name, channel_index, channel_name,
            sample_path, tag, bars, key_root, note_count, tempo, ppq, notes_json, midi_bytes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id
        """, (
            project_id,
            pat.get("pattern_index", 0),
            pat.get("pattern_name", "Pattern"),
            pat.get("channel_index", 0),
            pat.get("channel_name", "Channel"),
            pat.get("sample_path"),
            pat.get("tag", "Other"),
            pat.get("bars", 1),
            pat.get("key", "C"),
            pat.get("note_count", 0),
            pat.get("tempo", 140.0),
            pat.get("ppq", 96),
            json.dumps(pat.get("notes", [])),
            pat.get("midi_bytes")
        ))
        
        pat_id = cursor.fetchone()["id"]

        cursor.execute("""
        INSERT INTO fts_patterns (pattern_id, pattern_name, channel_name, tag, project_title, file_name)
        VALUES (?, ?, ?, ?, ?, ?)
        """, (
            pat_id,
            pat.get("pattern_name", ""),
            pat.get("channel_name", ""),
            pat.get("tag", ""),
            project_data.get("title", ""),
            project_data.get("file_name", "")
        ))

    # Insert sounds (extracted channel samples)
    try:
        from backend.core.classifier import classify_tag, analyze_sample
        from backend.core.sample_resolver import resolve_sample_path
    except Exception:
        try:
            from core.classifier import classify_tag, analyze_sample
            from core.sample_resolver import resolve_sample_path
        except Exception:
            from classifier import classify_tag, analyze_sample
            from sample_resolver import resolve_sample_path

    for ch in project_data.get("channels", []):
        raw_path = ch.get("raw_sample_path") or ch.get("sample_path")
        sample_path = ch.get("sample_path")
        ch_name = ch.get("name", "Channel")
        generator = ch.get("generator", "Sampler")
        
        # If it's a VST synth without an audio file, don't pollute the drum/sound vault
        if not raw_path and not sample_path and generator not in ["Sampler", "AudioClip", "Fruity Slicer", "Slicex"]:
            continue

        if raw_path or sample_path:
            resolved = resolve_sample_path(sample_path or raw_path, project_data.get("file_path"))
            if resolved:
                sample_path = resolved

        # Clean display sample name (filename without full directory path)
        if sample_path:
            sample_name = os.path.basename(sample_path.replace("\\", "/"))
        elif raw_path:
            sample_name = os.path.basename(raw_path.replace("\\", "/"))
        else:
            sample_name = ch_name

        # Perform comprehensive DSP & text analysis
        analysis = analyze_sample(
            sample_file_path=sample_path,
            channel_name=ch_name,
            sample_name=raw_path or sample_path
        )
        tag = analysis.get("tag", "Other")
        root_note = analysis.get("root_note")

        # If offline/unscanned 808/Bass, derive root note from the channel's pattern notes
        if not root_note and tag in ["808", "Bass"]:
            for pat in project_data.get("patterns", []):
                if pat.get("channel_index") == ch.get("index"):
                    notes = pat.get("notes", [])
                    if notes:
                        pitches = [n.get("pitch", 60) for n in notes]
                        min_p = min(pitches)
                        note_names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
                        octave = (min_p // 12) - 1
                        root_note = f"{note_names[min_p % 12]}{octave}"
                        break
        
        file_exists = 0
        file_size = 0
        if sample_path:
            clean_p = os.path.expanduser(sample_path)
            if os.path.exists(clean_p) and os.path.isfile(clean_p):
                file_exists = 1
                try:
                    file_size = os.path.getsize(clean_p)
                except Exception:
                    file_size = 0

        cursor.execute("""
        INSERT INTO sounds (
            project_id, channel_index, channel_name, sample_name, sample_path, tag, file_exists, file_size, root_note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id
        """, (
            project_id,
            ch.get("index", 0),
            ch_name,
            sample_name,
            sample_path,
            tag,
            file_exists,
            file_size,
            root_note
        ))

        sound_id = cursor.fetchone()["id"]

        cursor.execute("""
        INSERT INTO fts_sounds (sound_id, sample_name, channel_name, tag, project_title, file_name)
        VALUES (?, ?, ?, ?, ?, ?)
        """, (
            sound_id,
            sample_name,
            ch_name,
            tag,
            project_data.get("title", ""),
            project_data.get("file_name", "")
        ))

    conn.commit()
    conn.close()
    return project_id

def query_patterns(
    search: Optional[str] = None,
    tag: Optional[str] = None,
    min_bpm: Optional[float] = None,
    max_bpm: Optional[float] = None,
    project_id: Optional[int] = None,
    limit: int = 200,
    offset: int = 0
) -> Dict[str, Any]:
    conn = get_connection()
    cursor = conn.cursor()

    params: List[Any] = []
    where_clauses: List[str] = []

    if search and search.strip():
        where_clauses.append("p.id IN (SELECT pattern_id FROM fts_patterns WHERE fts_patterns MATCH ?)")
        params.append(f"{search.strip()}*")

    if tag and tag != "All":
        where_clauses.append("p.tag = ?")
        params.append(tag)

    if min_bpm is not None:
        where_clauses.append("p.tempo >= ?")
        params.append(min_bpm)

    if max_bpm is not None:
        where_clauses.append("p.tempo <= ?")
        params.append(max_bpm)

    if project_id is not None:
        where_clauses.append("p.project_id = ?")
        params.append(project_id)

    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    # Count total
    count_sql = f"SELECT COUNT(*) as total FROM patterns p {where_sql}"
    cursor.execute(count_sql, params)
    total = cursor.fetchone()["total"]

    # Select patterns
    select_sql = f"""
    SELECT 
        p.id, p.project_id, p.pattern_index, p.pattern_name,
        p.channel_index, p.channel_name, p.sample_path,
        p.tag, p.bars, p.key_root, p.note_count, p.tempo, p.ppq,
        p.notes_json,
        pr.title as project_title, pr.file_name as project_file_name, pr.file_path as project_file_path
    FROM patterns p
    JOIN projects pr ON p.project_id = pr.id
    {where_sql}
    ORDER BY p.id DESC
    LIMIT ? OFFSET ?
    """
    cursor.execute(select_sql, params + [limit, offset])
    
    items = []
    for row in cursor.fetchall():
        item = dict(row)
        if item.get("notes_json"):
            try:
                item["notes"] = json.loads(item["notes_json"])
            except Exception:
                item["notes"] = []
            del item["notes_json"]
        items.append(item)

    # Tag statistics for patterns
    cursor.execute("""
    SELECT tag, COUNT(*) as count FROM patterns GROUP BY tag ORDER BY count DESC
    """)
    tag_counts = {row["tag"]: row["count"] for row in cursor.fetchall()}

    conn.close()
    return {
        "total": total,
        "items": items,
        "tag_counts": tag_counts
    }

def query_sounds(
    search: Optional[str] = None,
    tag: Optional[str] = None,
    project_id: Optional[int] = None,
    limit: int = 200,
    offset: int = 0
) -> Dict[str, Any]:
    conn = get_connection()
    cursor = conn.cursor()

    params: List[Any] = []
    where_clauses: List[str] = []

    if search and search.strip():
        where_clauses.append("s.id IN (SELECT sound_id FROM fts_sounds WHERE fts_sounds MATCH ?)")
        params.append(f"{search.strip()}*")

    if tag and tag != "All":
        where_clauses.append("s.tag = ?")
        params.append(tag)

    if project_id is not None:
        where_clauses.append("s.project_id = ?")
        params.append(project_id)

    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    # Count total
    count_sql = f"SELECT COUNT(*) as total FROM sounds s {where_sql}"
    cursor.execute(count_sql, params)
    total = cursor.fetchone()["total"]

    # Select sounds
    select_sql = f"""
    SELECT 
        s.id, s.project_id, s.channel_index, s.channel_name,
        s.sample_name, s.sample_path, s.tag, s.file_exists, s.file_size, s.root_note,
        pr.title as project_title, pr.file_name as project_file_name, pr.tempo as project_tempo
    FROM sounds s
    JOIN projects pr ON s.project_id = pr.id
    {where_sql}
    ORDER BY s.file_exists DESC, s.id DESC
    LIMIT ? OFFSET ?
    """
    cursor.execute(select_sql, params + [limit, offset])
    items = [dict(row) for row in cursor.fetchall()]

    # Tag statistics for sounds
    cursor.execute("""
    SELECT tag, COUNT(*) as count FROM sounds GROUP BY tag ORDER BY count DESC
    """)
    tag_counts = {row["tag"]: row["count"] for row in cursor.fetchall()}

    conn.close()
    return {
        "total": total,
        "items": items,
        "tag_counts": tag_counts
    }

def get_pattern_midi(pattern_id: int) -> Optional[bytes]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT midi_bytes FROM patterns WHERE id = ?", (pattern_id,))
    row = cursor.fetchone()
    conn.close()
    return row["midi_bytes"] if row else None

def get_sound_by_id(sound_id: int) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT s.*, pr.title as project_title, pr.tempo as project_tempo
    FROM sounds s
    JOIN projects pr ON s.project_id = pr.id
    WHERE s.id = ?
    """, (sound_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def export_sound_kit_zip(
    kit_name: str,
    sound_ids: List[int],
    pattern_ids: List[int]
) -> bytes:
    """
    Creates an organized .zip drum kit / sound pack containing the selected sounds and MIDIs.
    Folders:
      - 808s/
      - Kicks/
      - Snares & Claps/
      - Hi-Hats/
      - Percs & FX/
      - MIDIs/
    """
    conn = get_connection()
    cursor = conn.cursor()

    safe_kit_name = "".join(c for c in kit_name if c.isalnum() or c in " _-").strip() or "StashSound_Kit"
    zip_buffer = io.BytesIO()

    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        # 1. Add sounds
        if sound_ids:
            placeholders = ",".join(["?"] * len(sound_ids))
            cursor.execute(f"SELECT * FROM sounds WHERE id IN ({placeholders})", sound_ids)
            for row in cursor.fetchall():
                sound = dict(row)
                tag = sound.get("tag", "Other")
                
                # Determine folder
                if tag in ["808", "Bass"]:
                    folder = f"{safe_kit_name}/808s & Bass"
                elif tag == "Kick":
                    folder = f"{safe_kit_name}/Kicks"
                elif tag in ["Snare", "Clap", "Rim"]:
                    folder = f"{safe_kit_name}/Snares & Claps"
                elif tag in ["Hi-Hat", "Open Hat"]:
                    folder = f"{safe_kit_name}/Hi-Hats"
                elif tag in ["Perc", "Vox", "FX"]:
                    folder = f"{safe_kit_name}/Percs & FX"
                else:
                    folder = f"{safe_kit_name}/Instruments"

                sample_path = sound.get("sample_path")
                sample_name = sound.get("sample_name") or f"sound_{sound['id']}.wav"
                if not sample_name.lower().endswith(".wav") and not sample_name.lower().endswith(".mp3"):
                    sample_name += ".wav"

                file_written = False
                if sample_path:
                    clean_p = os.path.expanduser(sample_path)
                    if os.path.exists(clean_p) and os.path.isfile(clean_p):
                        try:
                            with open(clean_p, "rb") as sf:
                                zf.writestr(f"{folder}/{sample_name}", sf.read())
                            file_written = True
                        except Exception:
                            pass

                # If sample file not on disk, generate a dummy sample marker text
                if not file_written:
                    info_text = f"Sample: {sample_name}\nTag: {tag}\nChannel: {sound.get('channel_name')}\nOriginal Path: {sample_path}"
                    zf.writestr(f"{folder}/{sample_name}.txt", info_text.encode("utf-8"))

        # 2. Add MIDIs
        if pattern_ids:
            placeholders = ",".join(["?"] * len(pattern_ids))
            cursor.execute(f"SELECT * FROM patterns WHERE id IN ({placeholders})", pattern_ids)
            for row in cursor.fetchall():
                pat = dict(row)
                tag = pat.get("tag", "Other")
                midi_bytes = pat.get("midi_bytes")
                pat_name = pat.get("pattern_name", "Pattern").replace("/", "_")
                midi_filename = f"{pat_name}_{tag}.mid"
                if midi_bytes:
                    zf.writestr(f"{safe_kit_name}/MIDIs/{midi_filename}", midi_bytes)

    conn.close()
    return zip_buffer.getvalue()

def get_projects() -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM projects ORDER BY indexed_at DESC")
    projects = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return projects

def delete_project(project_id: int):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM fts_patterns WHERE pattern_id IN (SELECT id FROM patterns WHERE project_id = ?)", (project_id,))
    cursor.execute("DELETE FROM patterns WHERE project_id = ?", (project_id,))
    cursor.execute("DELETE FROM fts_sounds WHERE sound_id IN (SELECT id FROM sounds WHERE project_id = ?)", (project_id,))
    cursor.execute("DELETE FROM sounds WHERE project_id = ?", (project_id,))
    cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    conn.commit()
    conn.close()

def update_sound(sound_id: int, name: str, tag: str):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE sounds SET sample_name = ?, tag = ? WHERE id = ?", (name, tag, sound_id))
    cursor.execute("UPDATE fts_sounds SET sample_name = ?, tag = ? WHERE sound_id = ?", (name, tag, sound_id))
    conn.commit()

def update_pattern(pattern_id: int, name: str, tag: str):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE patterns SET pattern_name = ?, tag = ? WHERE id = ?", (name, tag, pattern_id))
    cursor.execute("UPDATE fts_patterns SET pattern_name = ?, tag = ? WHERE pattern_id = ?", (name, tag, pattern_id))
    conn.commit()
