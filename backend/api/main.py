import os
import glob
import shutil
import tempfile
import logging
from typing import List, Optional
from contextlib import asynccontextmanager
from fastapi import FastAPI, BackgroundTasks, Query, HTTPException, Response, UploadFile, File
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import sys

current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(os.path.dirname(current_dir))
if project_root not in sys.path:
    sys.path.insert(0, project_root)
backend_dir = os.path.dirname(current_dir)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

try:
    from backend.core.database import (
        init_db, save_project, query_patterns, query_sounds, get_pattern_midi,
        get_sound_by_id, export_sound_kit_zip, get_projects, delete_project,
        delete_sounds, delete_patterns, update_sounds_tag, update_patterns_tag,
        update_sound, update_pattern, get_all_kits_db, save_kit_db, delete_kit_db,
        set_active_kit_id_db
    )
    from backend.core.parser import parse_flp_project
    from backend.core.midi_generator import create_midi_bytes
except Exception:
    try:
        from core.database import (
            init_db, save_project, query_patterns, query_sounds, get_pattern_midi,
            get_sound_by_id, export_sound_kit_zip, get_projects, delete_project,
            delete_sounds, delete_patterns, update_sounds_tag, update_patterns_tag,
            update_sound, update_pattern, get_all_kits_db, save_kit_db, delete_kit_db,
            set_active_kit_id_db
        )
        from core.parser import parse_flp_project
        from core.midi_generator import create_midi_bytes
    except Exception as err:
        logging.error(f"Import error in backend main: {err}")
        raise


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("stasher_api")

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    logger.info("Stasher SQLite Database initialized.")
    yield

app = FastAPI(title="Stasher API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["null", "http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ScanRequest(BaseModel):
    paths: List[str]
    recursive: bool = True

class KitExportRequest(BaseModel):
    kit_name: str = "My_StashSound_Kit"
    sound_ids: List[int] = Field(default_factory=list)
    pattern_ids: List[int] = Field(default_factory=list)

class SaveKitRequest(BaseModel):
    id: str
    name: str
    sound_ids: List[int] = Field(default_factory=list)
    pattern_ids: List[int] = Field(default_factory=list)

class SetActiveKitRequest(BaseModel):
    active_kit_id: str

scan_progress = {
    "is_scanning": False,
    "current_file": "",
    "scanned": 0,
    "total": 0,
    "successful": 0
}

def do_scan_task(paths: List[str], recursive: bool):
    global scan_progress
    scan_progress["is_scanning"] = True
    scan_progress["successful"] = 0
    flp_files = []

    for raw_path in paths:
        if not raw_path:
            continue
        p = os.path.expanduser(os.path.abspath(raw_path.strip()))
        if os.path.isfile(p):
            if p.lower().endswith(".flp"):
                flp_files.append(p)
        elif os.path.isdir(p):
            pattern = os.path.join(p, "**", "*.flp") if recursive else os.path.join(p, "*.flp")
            found = glob.glob(pattern, recursive=recursive)
            flp_files.extend(found)
            # Check uppercase .FLP
            pattern_upper = os.path.join(p, "**", "*.FLP") if recursive else os.path.join(p, "*.FLP")
            found_upper = glob.glob(pattern_upper, recursive=recursive)
            flp_files.extend(found_upper)

    flp_files = sorted(list(set(flp_files)))
    scan_progress["total"] = len(flp_files)
    scan_progress["scanned"] = 0

    successful = 0
    total_patterns = 0

    for flp in flp_files:
        scan_progress["current_file"] = os.path.basename(flp)
        try:
            data = parse_flp_project(flp)
            if data and (data.get("patterns") or data.get("channels")):
                save_project(data)
                successful += 1
                total_patterns += len(data.get("patterns", []))
        except Exception as e:
            logger.error(f"Failed to process {flp}: {e}")
        
        scan_progress["scanned"] += 1
        scan_progress["successful"] = successful

    scan_progress["is_scanning"] = False
    scan_progress["current_file"] = ""
    logger.info(f"Scan complete: {successful}/{len(flp_files)} projects processed, {total_patterns} patterns indexed.")

@app.post("/api/scan")
def start_scan(request: ScanRequest, background_tasks: BackgroundTasks):
    if scan_progress["is_scanning"]:
        return {"status": "already_scanning", "progress": scan_progress}
    
    background_tasks.add_task(do_scan_task, request.paths, request.recursive)
    return {"status": "scan_started", "paths": request.paths}

@app.post("/api/upload-and-scan")
async def upload_and_scan(files: List[UploadFile] = File(...)):
    """Handles direct Drag & Drop file uploads from UI/Browser."""
    temp_dir = tempfile.mkdtemp(prefix="stasher_upload_")
    saved_paths = []
    max_upload_size = 256 * 1024 * 1024

    try:
        for f in files:
            if not f.filename or not f.filename.lower().endswith(".flp"):
                continue

            safe_name = os.path.basename(f.filename.replace("\\", "/"))
            file_path = os.path.join(temp_dir, safe_name)
            written = 0
            with open(file_path, "wb") as buffer:
                while chunk := f.file.read(1024 * 1024):
                    written += len(chunk)
                    if written > max_upload_size:
                        raise HTTPException(status_code=413, detail="FLP file is too large")
                    buffer.write(chunk)
            saved_paths.append((file_path, safe_name))

        successful = 0
        total_patterns = 0
        for flp, safe_name in saved_paths:
            try:
                data = parse_flp_project(flp)
                if data and (data.get("patterns") or data.get("channels")):
                    # The temporary upload is removed below; keep a stable logical source.
                    data["file_path"] = f"upload://{safe_name}"
                    save_project(data)
                    successful += 1
                    total_patterns += len(data.get("patterns", []))
            except Exception as e:
                logger.error(f"Error parsing uploaded file {flp}: {e}")

        return {
            "status": "success",
            "processed": len(saved_paths),
            "successful": successful,
            "total_patterns": total_patterns
        }
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
        for f in files:
            await f.close()

@app.get("/api/scan/progress")
def get_scan_progress():
    return scan_progress

# ─── MIDI Patterns Endpoints ───────────────────────────
@app.get("/api/patterns")
def list_patterns(
    search: Optional[str] = None,
    tag: Optional[str] = None,
    min_bpm: Optional[float] = None,
    max_bpm: Optional[float] = None,
    project_id: Optional[int] = None,
    limit: int = 200,
    offset: int = 0
):
    return query_patterns(
        search=search,
        tag=tag,
        min_bpm=min_bpm,
        max_bpm=max_bpm,
        project_id=project_id,
        limit=limit,
        offset=offset
    )

@app.get("/api/patterns/{pattern_id}/midi")
def download_pattern_midi(pattern_id: int):
    midi_bytes = get_pattern_midi(pattern_id)
    if not midi_bytes:
        raise HTTPException(status_code=404, detail="MIDI pattern not found")
    
    return Response(
        content=midi_bytes,
        media_type="audio/midi",
        headers={
            "Content-Disposition": f'attachment; filename="pattern_{pattern_id}.mid"'
        }
    )

# ─── Sounds (StashSound) Endpoints ─────────────────────
@app.get("/api/sounds")
def list_sounds(
    search: Optional[str] = None,
    tag: Optional[str] = None,
    project_id: Optional[int] = None,
    limit: int = 200,
    offset: int = 0
):
    return query_sounds(
        search=search,
        tag=tag,
        project_id=project_id,
        limit=limit,
        offset=offset
    )

@app.get("/api/sounds/{sound_id}/audio")
def get_sound_audio(sound_id: int):
    sound = get_sound_by_id(sound_id)
    if not sound:
        raise HTTPException(status_code=404, detail="Sound not found")

    sample_path = sound.get("sample_path")
    if sample_path:
        clean_p = os.path.expanduser(sample_path)
        if os.path.exists(clean_p) and os.path.isfile(clean_p):
            # Stream actual audio file
            media_type = "audio/wav" if clean_p.lower().endswith(".wav") else "audio/mpeg"
            return FileResponse(clean_p, media_type=media_type)

    # If physical sample not found on disk, return 404 so Web Audio engine plays synth fallback
    raise HTTPException(status_code=404, detail="Sample audio file not found on disk")

# ─── Sound Kit Builder Endpoints ──────────────────────
@app.get("/api/kits")
def get_kits():
    return get_all_kits_db()

@app.post("/api/kits")
def save_kit(request: SaveKitRequest):
    save_kit_db(
        kit_id=request.id,
        name=request.name,
        sound_ids=request.sound_ids,
        pattern_ids=request.pattern_ids
    )
    return {"status": "saved", "id": request.id}

@app.delete("/api/kits/{kit_id}")
def remove_kit(kit_id: str):
    delete_kit_db(kit_id)
    return {"status": "deleted", "id": kit_id}

@app.post("/api/kits/active")
def set_active_kit(request: SetActiveKitRequest):
    set_active_kit_id_db(request.active_kit_id)
    return {"status": "active_set", "active_kit_id": request.active_kit_id}

@app.post("/api/kits/export")
def export_kit(request: KitExportRequest):
    zip_bytes = export_sound_kit_zip(
        kit_name=request.kit_name,
        sound_ids=request.sound_ids,
        pattern_ids=request.pattern_ids
    )
    safe_name = request.kit_name.replace(" ", "_")
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}.zip"'
        }
    )

# ─── Projects Endpoints ────────────────────────────────
@app.get("/api/projects")
def list_projects():
    return get_projects()

@app.delete("/api/projects/{project_id}")
def remove_project(project_id: int):
    delete_project(project_id)
    return {"status": "deleted", "id": project_id}

@app.get("/api/preview-samples/{sample_name}")
def get_preview_sample(sample_name: str, response: Response):
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    clean_name = sample_name if sample_name.endswith(".wav") else f"{sample_name}.wav"
    
    possible_paths = []

    # 1. PyInstaller onefile temp extract directory
    if hasattr(sys, "_MEIPASS"):
        possible_paths.extend([
            os.path.join(sys._MEIPASS, "public", "audio", "preview", clean_name),
            os.path.join(sys._MEIPASS, "audio", "preview", clean_name),
            os.path.join(sys._MEIPASS, clean_name),
        ])

    # 2. Current working directory (e.g. process.resourcesPath in Electron packaged app or project root in dev)
    cwd = os.getcwd()
    possible_paths.extend([
        os.path.join(cwd, "audio", "preview", clean_name),
        os.path.join(cwd, "public", "audio", "preview", clean_name),
        os.path.join(cwd, "dist", "audio", "preview", clean_name),
    ])

    # 3. Relative to the running executable or script
    exec_dir = os.path.dirname(os.path.abspath(sys.executable if getattr(sys, 'frozen', False) else __file__))
    possible_paths.extend([
        os.path.join(exec_dir, "audio", "preview", clean_name),
        os.path.join(exec_dir, "..", "audio", "preview", clean_name),
        os.path.join(exec_dir, "..", "public", "audio", "preview", clean_name),
        os.path.join(exec_dir, "..", "dist", "audio", "preview", clean_name),
        os.path.join(exec_dir, "..", "..", "public", "audio", "preview", clean_name),
        os.path.join(exec_dir, "..", "..", "dist", "audio", "preview", clean_name),
    ])

    # 4. Project root in dev mode
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    possible_paths.extend([
        os.path.join(base_dir, "public", "audio", "preview", clean_name),
        os.path.join(base_dir, "resources", "audio", "preview", clean_name),
        os.path.join(base_dir, "dist", "audio", "preview", clean_name),
    ])

    for p in possible_paths:
        if p and os.path.exists(p) and os.path.isfile(p):
            return FileResponse(p, media_type="audio/wav", headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
    raise HTTPException(status_code=404, detail=f"Preview sample {sample_name} not found")



@app.post("/api/demo-seed")
def seed_demo_data():
    """Demo seed disabled by user request."""
    return {"status": "disabled", "projects_count": 0}

@app.get("/api/health")
def health():
    return {"status": "ok", "app": "Stasher", "version": "1.0.0"}

class UpdateItemRequest(BaseModel):
    name: str
    tag: str

class BatchDeleteRequest(BaseModel):
    ids: List[int]

class BatchTagRequest(BaseModel):
    ids: List[int]
    tag: str

@app.patch("/api/sounds/{sound_id}")
def update_sound_endpoint(sound_id: int, req: UpdateItemRequest):
    try:
        update_sound(sound_id, req.name, req.tag)
        return {"success": True}
    except Exception as e:
        logger.error(f"Error updating sound {sound_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.patch("/api/patterns/{pattern_id}")
def update_pattern_endpoint(pattern_id: int, req: UpdateItemRequest):
    try:
        update_pattern(pattern_id, req.name, req.tag)
        return {"success": True}
    except Exception as e:
        logger.error(f"Error updating pattern {pattern_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/sounds/batch")
def batch_delete_sounds_endpoint(req: BatchDeleteRequest):
    try:
        delete_sounds(req.ids)
        return {"success": True, "count": len(req.ids)}
    except Exception as e:
        logger.error(f"Error in batch delete sounds: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/patterns/batch")
def batch_delete_patterns_endpoint(req: BatchDeleteRequest):
    try:
        delete_patterns(req.ids)
        return {"success": True, "count": len(req.ids)}
    except Exception as e:
        logger.error(f"Error in batch delete patterns: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.patch("/api/sounds/batch-tag")
def batch_tag_sounds_endpoint(req: BatchTagRequest):
    try:
        update_sounds_tag(req.ids, req.tag)
        return {"success": True, "count": len(req.ids), "tag": req.tag}
    except Exception as e:
        logger.error(f"Error in batch tag sounds: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.patch("/api/patterns/batch-tag")
def batch_tag_patterns_endpoint(req: BatchTagRequest):
    try:
        update_patterns_tag(req.ids, req.tag)
        return {"success": True, "count": len(req.ids), "tag": req.tag}
    except Exception as e:
        logger.error(f"Error in batch tag patterns: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import multiprocessing
    multiprocessing.freeze_support()
    import uvicorn
    print("[Stasher Backend] Starting server on 127.0.0.1:8765...", flush=True)
    config = uvicorn.Config(app, host="127.0.0.1", port=8765, log_level="info", loop="asyncio")
    server = uvicorn.Server(config)
    server.run()
