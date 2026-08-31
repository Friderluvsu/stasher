import os
import io
import json
import sqlite3
import time
import zipfile
from typing import List, Dict, Any, Optional

DEFAULT_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "stasher_data")
DB_PATH = os.environ.get("STASHER_DB_PATH", os.path.join(DEFAULT_DATA_DIR, "stasher.db"))

CANONICAL_TAGS = {
    '808': '808', 'kick': 'Kick', 'snare': 'Snare', 'clap': 'Clap',
    'hi-hat': 'Hi-Hat', 'hihat': 'Hi-Hat', 'open hat': 'Open Hat', 'openhat': 'Open Hat',
    'rim': 'Rim', 'perc': 'Perc', 'tom': 'Tom', 'crash': 'Crash',
    'bass': 'Bass', 'chords': 'Chords', 'melody': 'Melody',
    'lead': 'Lead', 'pluck': 'Pluck', 'vox': 'Vox', 'fx': 'FX', 'other': 'Other'
}

def normalize_tag(tag: Optional[str]) -> str:
    if not tag:
        return 'Other'
    t = tag.strip().lower()
    return CANONICAL_TAGS.get(t, tag.strip())

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

    # 5. Kits table (Kit Builder persistence)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS kits (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sound_ids TEXT,
        pattern_ids TEXT,
        created_at INTEGER,
        updated_at INTEGER
    )
    """)

    # 6. App Settings table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT
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
        where_clauses.append("p.tag = ? COLLATE NOCASE")
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

    # Tag statistics for patterns (normalized canonical tags)
    cursor.execute("""
    SELECT tag, COUNT(*) as count FROM patterns GROUP BY tag COLLATE NOCASE ORDER BY count DESC
    """)
    tag_counts: Dict[str, int] = {}
    for row in cursor.fetchall():
        c_tag = normalize_tag(row["tag"])
        tag_counts[c_tag] = tag_counts.get(c_tag, 0) + row["count"]

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
        where_clauses.append("s.tag = ? COLLATE NOCASE")
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

    # Tag statistics for sounds (normalized canonical tags)
    cursor.execute("""
    SELECT tag, COUNT(*) as count FROM sounds GROUP BY tag COLLATE NOCASE ORDER BY count DESC
    """)
    tag_counts: Dict[str, int] = {}
    for row in cursor.fetchall():
        c_tag = normalize_tag(row["tag"])
        tag_counts[c_tag] = tag_counts.get(c_tag, 0) + row["count"]

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

def _generate_fallback_wav_bytes(tag: str = "") -> bytes:
    """Generate minimal valid PCM WAV bytes if physical audio sample is missing."""
    import struct, math
    sample_rate = 44100
    duration = 0.4
    freq = 65.0 if tag.lower() in ["808", "bass"] else (150.0 if tag.lower() == "kick" else 350.0)
    num_samples = int(sample_rate * duration)
    data = bytearray()
    for i in range(num_samples):
        t = i / sample_rate
        val = math.sin(2 * math.pi * freq * t) * math.exp(-t * 15) * 16000
        sample = max(-32768, min(32767, int(val)))
        data.extend(struct.pack('<h', sample))
    
    header = bytearray(b'RIFF')
    header.extend(struct.pack('<I', 36 + len(data)))
    header.extend(b'WAVEfmt ')
    header.extend(struct.pack('<I', 16))
    header.extend(struct.pack('<H', 1))  # PCM
    header.extend(struct.pack('<H', 1))  # Mono
    header.extend(struct.pack('<I', sample_rate))
    header.extend(struct.pack('<I', sample_rate * 2))
    header.extend(struct.pack('<H', 2))
    header.extend(struct.pack('<H', 16))
    header.extend(b'data')
    header.extend(struct.pack('<I', len(data)))
    return bytes(header + data)

def export_sound_kit_zip(
    kit_name: str,
    sound_ids: List[int],
    pattern_ids: List[int]
) -> bytes:
    """
    Creates an organized .zip drum kit / sound pack containing the selected sounds and MIDIs.
    Folders:
      - Sounds/
        - 808s & Bass/
        - Kicks/
        - Snares & Claps/
        - Hi-Hats & Cymbals/
        - Percs & FX/
        - Instruments & Vox/
      - MIDIs/
        - Melodies & Chords/
        - Drums/
    """
    conn = get_connection()
    cursor = conn.cursor()

    safe_kit_name = "".join(c for c in kit_name if c.isalnum() or c in " _-").strip() or "StashSound_Kit"
    zip_buffer = io.BytesIO()

    # Pre-check bundled preview audio directory
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    preview_dir = os.path.join(base_dir, "public", "audio", "preview")

    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        used_paths = set()

        # 1. Add sounds (grouped into subfolders)
        if sound_ids:
            placeholders = ",".join(["?"] * len(sound_ids))
            cursor.execute(f"SELECT * FROM sounds WHERE id IN ({placeholders})", sound_ids)
            for row in cursor.fetchall():
                sound = dict(row)
                tag = sound.get("tag", "Other")
                tag_norm = normalize_tag(tag)
                
                # Determine granular subfolder
                if tag_norm == "808":
                    folder = f"{safe_kit_name}/Sounds/1. Drums & One-Shots/808s"
                elif tag_norm == "Bass":
                    folder = f"{safe_kit_name}/Sounds/1. Drums & One-Shots/Basses"
                elif tag_norm == "Kick":
                    folder = f"{safe_kit_name}/Sounds/1. Drums & One-Shots/Kicks"
                elif tag_norm == "Snare":
                    folder = f"{safe_kit_name}/Sounds/1. Drums & One-Shots/Snares"
                elif tag_norm == "Clap":
                    folder = f"{safe_kit_name}/Sounds/1. Drums & One-Shots/Claps"
                elif tag_norm == "Rim":
                    folder = f"{safe_kit_name}/Sounds/1. Drums & One-Shots/Rims"
                elif tag_norm == "Hi-Hat":
                    folder = f"{safe_kit_name}/Sounds/1. Drums & One-Shots/Hi-Hats (Closed)"
                elif tag_norm == "Open Hat":
                    folder = f"{safe_kit_name}/Sounds/1. Drums & One-Shots/Open Hats"
                elif tag_norm == "Crash":
                    folder = f"{safe_kit_name}/Sounds/1. Drums & One-Shots/Crashes & Cymbals"
                elif tag_norm == "Perc":
                    folder = f"{safe_kit_name}/Sounds/1. Drums & One-Shots/Percs"
                elif tag_norm == "Tom":
                    folder = f"{safe_kit_name}/Sounds/1. Drums & One-Shots/Toms"
                elif tag_norm == "Vox":
                    folder = f"{safe_kit_name}/Sounds/2. Vocals & Chants/Vox"
                elif tag_norm == "FX":
                    folder = f"{safe_kit_name}/Sounds/3. FX & Textures/FX"
                elif tag_norm == "Melody":
                    folder = f"{safe_kit_name}/Sounds/4. Melodic & Instruments/Melodic One-Shots"
                elif tag_norm == "Chords":
                    folder = f"{safe_kit_name}/Sounds/4. Melodic & Instruments/Chords & Keys"
                elif tag_norm == "Lead":
                    folder = f"{safe_kit_name}/Sounds/4. Melodic & Instruments/Leads & Synths"
                elif tag_norm == "Pluck":
                    folder = f"{safe_kit_name}/Sounds/4. Melodic & Instruments/Plucks & Guitars"
                else:
                    folder = f"{safe_kit_name}/Sounds/4. Melodic & Instruments/Other Sounds"

                sample_path = sound.get("sample_path")
                raw_sample_name = sound.get("sample_name") or f"sound_{sound['id']}.wav"
                if not raw_sample_name.lower().endswith(".wav") and not raw_sample_name.lower().endswith(".mp3"):
                    raw_sample_name += ".wav"

                # Prevent filename collisions inside the same subfolder
                sample_name = raw_sample_name
                counter = 1
                while f"{folder}/{sample_name}" in used_paths:
                    root_n, ext_n = os.path.splitext(raw_sample_name)
                    sample_name = f"{root_n}_{counter}{ext_n}"
                    counter += 1
                used_paths.add(f"{folder}/{sample_name}")

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

                # Check preview audio folder if physical file not on disk
                if not file_written and os.path.exists(preview_dir):
                    candidate_preview = os.path.join(preview_dir, f"{tag_norm.lower()}.wav")
                    if os.path.exists(candidate_preview):
                        try:
                            with open(candidate_preview, "rb") as pf:
                                zf.writestr(f"{folder}/{sample_name}", pf.read())
                            file_written = True
                        except Exception:
                            pass

                # Fallback to generated WAV audio so every sample is valid in the ZIP
                if not file_written:
                    wav_data = _generate_fallback_wav_bytes(tag_norm)
                    zf.writestr(f"{folder}/{sample_name}", wav_data)

        # 2. Add MIDIs (granularly subdivided into specific subfolders)
        if pattern_ids:
            placeholders = ",".join(["?"] * len(pattern_ids))
            cursor.execute(f"SELECT * FROM patterns WHERE id IN ({placeholders})", pattern_ids)
            for row in cursor.fetchall():
                pat = dict(row)
                tag = pat.get("tag", "Other")
                tag_norm = normalize_tag(tag)
                midi_bytes = pat.get("midi_bytes")
                pat_name = pat.get("pattern_name", "Pattern").replace("/", "_").replace("\\", "_")
                raw_midi_filename = f"{pat_name}_{tag_norm}.mid"

                # Categorize MIDI into dedicated subfolders
                if tag_norm == "808":
                    midi_folder = f"{safe_kit_name}/MIDIs/1. Drum MIDIs/808 Patterns"
                elif tag_norm == "Kick":
                    midi_folder = f"{safe_kit_name}/MIDIs/1. Drum MIDIs/Kick Patterns"
                elif tag_norm == "Snare":
                    midi_folder = f"{safe_kit_name}/MIDIs/1. Drum MIDIs/Snare Patterns"
                elif tag_norm == "Clap":
                    midi_folder = f"{safe_kit_name}/MIDIs/1. Drum MIDIs/Clap Patterns"
                elif tag_norm == "Rim":
                    midi_folder = f"{safe_kit_name}/MIDIs/1. Drum MIDIs/Rim Patterns"
                elif tag_norm in ["Hi-Hat", "Open Hat"]:
                    midi_folder = f"{safe_kit_name}/MIDIs/1. Drum MIDIs/Hi-Hat Rolls & Loops"
                elif tag_norm in ["Perc", "Tom", "Crash"]:
                    midi_folder = f"{safe_kit_name}/MIDIs/1. Drum MIDIs/Percussion & Toms"
                elif tag_norm == "Melody":
                    midi_folder = f"{safe_kit_name}/MIDIs/2. Melodic MIDIs/Melodies & Toplines"
                elif tag_norm == "Chords":
                    midi_folder = f"{safe_kit_name}/MIDIs/2. Melodic MIDIs/Chord Progressions"
                elif tag_norm == "Lead":
                    midi_folder = f"{safe_kit_name}/MIDIs/2. Melodic MIDIs/Leads & Synths"
                elif tag_norm == "Pluck":
                    midi_folder = f"{safe_kit_name}/MIDIs/2. Melodic MIDIs/Plucks & Arps"
                elif tag_norm == "Bass":
                    midi_folder = f"{safe_kit_name}/MIDIs/2. Melodic MIDIs/Basslines"
                else:
                    midi_folder = f"{safe_kit_name}/MIDIs/2. Melodic MIDIs/Other Melodic MIDIs"

                midi_filename = raw_midi_filename
                counter = 1
                while f"{midi_folder}/{midi_filename}" in used_paths:
                    root_n, ext_n = os.path.splitext(raw_midi_filename)
                    midi_filename = f"{root_n}_{counter}{ext_n}"
                    counter += 1
                used_paths.add(f"{midi_folder}/{midi_filename}")

                if midi_bytes:
                    zf.writestr(f"{midi_folder}/{midi_filename}", midi_bytes)

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
    norm_tag = normalize_tag(tag)
    if name and name.strip():
        cursor.execute("UPDATE sounds SET sample_name = ?, tag = ? WHERE id = ?", (name.strip(), norm_tag, sound_id))
    else:
        cursor.execute("UPDATE sounds SET tag = ? WHERE id = ?", (norm_tag, sound_id))
    try:
        if name and name.strip():
            cursor.execute("UPDATE fts_sounds SET sample_name = ?, tag = ? WHERE sound_id = ?", (name.strip(), norm_tag, sound_id))
        else:
            cursor.execute("UPDATE fts_sounds SET tag = ? WHERE sound_id = ?", (norm_tag, sound_id))
    except Exception:
        pass
    conn.commit()
    conn.close()

def update_pattern(pattern_id: int, name: str, tag: str):
    conn = get_connection()
    cursor = conn.cursor()
    norm_tag = normalize_tag(tag)
    if name and name.strip():
        cursor.execute("UPDATE patterns SET pattern_name = ?, tag = ? WHERE id = ?", (name.strip(), norm_tag, pattern_id))
    else:
        cursor.execute("UPDATE patterns SET tag = ? WHERE id = ?", (norm_tag, pattern_id))
    try:
        if name and name.strip():
            cursor.execute("UPDATE fts_patterns SET pattern_name = ?, tag = ? WHERE pattern_id = ?", (name.strip(), norm_tag, pattern_id))
        else:
            cursor.execute("UPDATE fts_patterns SET tag = ? WHERE pattern_id = ?", (norm_tag, pattern_id))
    except Exception:
        pass
    conn.commit()
    conn.close()

def delete_sounds(sound_ids: List[int]):
    if not sound_ids:
        return
    conn = get_connection()
    cursor = conn.cursor()
    placeholders = ",".join(["?"] * len(sound_ids))
    try:
        cursor.execute(f"DELETE FROM fts_sounds WHERE sound_id IN ({placeholders})", sound_ids)
    except Exception:
        pass
    cursor.execute(f"DELETE FROM sounds WHERE id IN ({placeholders})", sound_ids)
    conn.commit()
    conn.close()

def delete_patterns(pattern_ids: List[int]):
    if not pattern_ids:
        return
    conn = get_connection()
    cursor = conn.cursor()
    placeholders = ",".join(["?"] * len(pattern_ids))
    try:
        cursor.execute(f"DELETE FROM fts_patterns WHERE pattern_id IN ({placeholders})", pattern_ids)
    except Exception:
        pass
    cursor.execute(f"DELETE FROM patterns WHERE id IN ({placeholders})", pattern_ids)
    conn.commit()
    conn.close()

def update_sounds_tag(sound_ids: List[int], tag: str):
    if not sound_ids or not tag:
        return
    conn = get_connection()
    cursor = conn.cursor()
    norm_tag = normalize_tag(tag)
    placeholders = ",".join(["?"] * len(sound_ids))
    params = [norm_tag] + list(sound_ids)
    cursor.execute(f"UPDATE sounds SET tag = ? WHERE id IN ({placeholders})", params)
    try:
        cursor.execute(f"UPDATE fts_sounds SET tag = ? WHERE sound_id IN ({placeholders})", params)
    except Exception:
        pass
    conn.commit()
    conn.close()

def update_patterns_tag(pattern_ids: List[int], tag: str):
    if not pattern_ids or not tag:
        return
    conn = get_connection()
    cursor = conn.cursor()
    norm_tag = normalize_tag(tag)
    placeholders = ",".join(["?"] * len(pattern_ids))
    params = [norm_tag] + list(pattern_ids)
    cursor.execute(f"UPDATE patterns SET tag = ? WHERE id IN ({placeholders})", params)
    try:
        cursor.execute(f"UPDATE fts_patterns SET tag = ? WHERE pattern_id IN ({placeholders})", params)
    except Exception:
        pass
    conn.commit()
    conn.close()

# ─── Kit Builder Persistence (SQLite) ───────────────────

def get_all_kits_db() -> Dict[str, Any]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM kits ORDER BY created_at ASC")
    rows = cursor.fetchall()

    # Create default kit if table is empty
    if not rows:
        now = int(time.time())
        cursor.execute(
            "INSERT INTO kits (id, name, sound_ids, pattern_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            ('default', 'My_StashSound_Kit', json.dumps([]), json.dumps([]), now, now)
        )
        conn.commit()
        cursor.execute("SELECT * FROM kits ORDER BY created_at ASC")
        rows = cursor.fetchall()

    kits = []
    for r in rows:
        k_dict = dict(r)
        k_id = k_dict["id"]
        k_name = k_dict["name"]

        try:
            s_ids = json.loads(k_dict.get("sound_ids") or "[]")
        except Exception:
            s_ids = []

        try:
            p_ids = json.loads(k_dict.get("pattern_ids") or "[]")
        except Exception:
            p_ids = []

        sounds = []
        if s_ids:
            placeholders = ",".join(["?"] * len(s_ids))
            cursor.execute(f"SELECT * FROM sounds WHERE id IN ({placeholders})", s_ids)
            s_map = {row["id"]: dict(row) for row in cursor.fetchall()}
            for sid in s_ids:
                if sid in s_map:
                    sounds.append(s_map[sid])

        patterns = []
        if p_ids:
            placeholders = ",".join(["?"] * len(p_ids))
            cursor.execute(f"SELECT * FROM patterns WHERE id IN ({placeholders})", p_ids)
            p_map = {row["id"]: dict(row) for row in cursor.fetchall()}
            for pid in p_ids:
                if pid in p_map:
                    p_data = p_map[pid]
                    try:
                        p_data["notes"] = json.loads(p_data.get("notes_json") or "[]")
                    except Exception:
                        p_data["notes"] = []
                    patterns.append(p_data)

        kits.append({
            "id": k_id,
            "name": k_name,
            "sounds": sounds,
            "patterns": patterns
        })

    cursor.execute("SELECT value FROM app_settings WHERE key = 'active_kit_id'")
    sett_row = cursor.fetchone()
    active_kit_id = sett_row["value"] if sett_row else (kits[0]["id"] if kits else "default")

    conn.close()
    return {"kits": kits, "active_kit_id": active_kit_id}

def save_kit_db(kit_id: str, name: str, sound_ids: List[int], pattern_ids: List[int]) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    now = int(time.time())

    cursor.execute("SELECT id FROM kits WHERE id = ?", (kit_id,))
    exists = cursor.fetchone()
    if exists:
        cursor.execute(
            "UPDATE kits SET name = ?, sound_ids = ?, pattern_ids = ?, updated_at = ? WHERE id = ?",
            (name, json.dumps(sound_ids), json.dumps(pattern_ids), now, kit_id)
        )
    else:
        cursor.execute(
            "INSERT INTO kits (id, name, sound_ids, pattern_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (kit_id, name, json.dumps(sound_ids), json.dumps(pattern_ids), now, now)
        )
    conn.commit()
    conn.close()
    return True

def delete_kit_db(kit_id: str) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM kits WHERE id = ?", (kit_id,))
    conn.commit()
    conn.close()
    return True

def set_active_kit_id_db(kit_id: str) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO app_settings (key, value) VALUES ('active_kit_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (kit_id,)
    )
    conn.commit()
    conn.close()
    return True


