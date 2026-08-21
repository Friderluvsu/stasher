import os
import time
import logging
from typing import Optional, Dict, Set

logger = logging.getLogger(__name__)

# Global in-memory cache for fast O(1) sample lookups
_SAMPLE_INDEX: Dict[str, str] = {}
_INDEXED_ROOTS: Set[str] = set()
_LAST_INDEX_TIME: float = 0.0

AUDIO_EXTENSIONS = {".wav", ".mp3", ".aif", ".aiff", ".flac", ".ogg"}

DEFAULT_SEARCH_ROOTS = [
    os.path.expanduser("~/Documents/frider"),
    os.path.expanduser("~/Documents"),
    os.path.expanduser("~/Music"),
    os.path.expanduser("~/Downloads"),
    os.path.expanduser("~/Library/CloudStorage"),
    os.path.expanduser("~/Desktop"),
]

def build_sample_index(extra_roots: Optional[list] = None, force_rebuild: bool = False):
    """
    Builds a lightning-fast filename-to-path index of local audio samples.
    """
    global _SAMPLE_INDEX, _INDEXED_ROOTS, _LAST_INDEX_TIME

    now = time.time()
    if not force_rebuild and _SAMPLE_INDEX and (now - _LAST_INDEX_TIME < 300):
        # Cache valid for 5 minutes
        return

    roots = list(DEFAULT_SEARCH_ROOTS)
    if extra_roots:
        roots.extend(extra_roots)

    indexed_count = 0
    t0 = time.time()

    for root in roots:
        if not root:
            continue
        exp_root = os.path.expanduser(root)
        if not os.path.exists(exp_root) or not os.path.isdir(exp_root):
            continue

        try:
            for dirpath, _, filenames in os.walk(exp_root, followlinks=False):
                # Skip heavy system / node_modules / git dirs
                if any(skip in dirpath for skip in [".git", "node_modules", ".venv", "venv", "Library/Caches", ".Trash"]):
                    continue

                for f in filenames:
                    ext = os.path.splitext(f)[1].lower()
                    if ext in AUDIO_EXTENSIONS:
                        f_lower = f.lower()
                        # Prefer shorter paths or primary directories if duplicates
                        if f_lower not in _SAMPLE_INDEX:
                            _SAMPLE_INDEX[f_lower] = os.path.join(dirpath, f)
                            indexed_count += 1
        except Exception as e:
            logger.debug(f"Error scanning directory {exp_root}: {e}")

    _LAST_INDEX_TIME = time.time()
    logger.info(f"Sample indexer: cataloged {len(_SAMPLE_INDEX)} audio files in {time.time() - t0:.2f}s")


def resolve_sample_path(raw_path: Optional[str], flp_path: Optional[str] = None) -> Optional[str]:
    """
    Resolves an FL Studio sample path to an actual existing file on the local machine.
    Handles:
    - Native existing paths (Mac/POSIX)
    - Windows absolute paths (e.g. D:\\FLProjects\\... or C:\\...)
    - Relative paths (next to .flp project)
    - Relocated drum kits / sample packs by matching filename in indexed roots.
    """
    if not raw_path:
        return None

    # 1. Direct check if path exists as-is
    expanded = os.path.expanduser(raw_path)
    if os.path.exists(expanded) and os.path.isfile(expanded):
        return expanded

    # 2. Check next to the .flp project
    if flp_path:
        flp_dir = os.path.dirname(os.path.abspath(flp_path))
        raw_clean = raw_path.replace("\\", "/").lstrip("/")
        if ":" in raw_clean:
            raw_clean = raw_clean.split(":", 1)[1].lstrip("/")

        cand = os.path.join(flp_dir, raw_clean)
        if os.path.exists(cand) and os.path.isfile(cand):
            return cand

        # Check in project subfolders
        fname = os.path.basename(raw_clean)
        for sub in ["", "Samples", "Audio", "Rendered", "Recorded", "Drums"]:
            cand = os.path.join(flp_dir, sub, fname)
            if os.path.exists(cand) and os.path.isfile(cand):
                return cand

    # 3. Lookup by clean basename in the indexed sample catalog
    clean_path = raw_path.replace("\\", "/")
    filename = os.path.basename(clean_path).lower()

    if not _SAMPLE_INDEX:
        build_sample_index()

    resolved = _SAMPLE_INDEX.get(filename)
    if resolved and os.path.exists(resolved) and os.path.isfile(resolved):
        return resolved

    # 4. If not found, try without number suffixes (e.g. "sound_2.wav" -> "sound.wav")
    if "_" in filename or " (" in filename:
        import re
        simplified = re.sub(r"(_\d+|\s*\(\d+\))\.", ".", filename)
        resolved_simp = _SAMPLE_INDEX.get(simplified)
        if resolved_simp and os.path.exists(resolved_simp) and os.path.isfile(resolved_simp):
            return resolved_simp

    return None
