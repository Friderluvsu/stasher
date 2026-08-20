import io
from typing import List, Dict, Any
import mido

def create_midi_bytes(
    notes: List[Dict[str, Any]],
    tempo: float = 140.0,
    ppq: int = 96,
    track_name: str = "Pattern"
) -> bytes:
    """
    Creates standard MIDI file bytes from a list of note events.
    Each note in `notes` has:
      - pitch: int (0-127, where 60 is Middle C)
      - pos: int (start tick)
      - duration: int (length in ticks)
      - velocity: int (0-127)
    """
    mid = mido.MidiFile(type=0, ticks_per_beat=ppq)
    track = mido.MidiTrack()
    mid.tracks.append(track)

    # Sanitize track name to ascii/latin-1 to prevent encoding errors with emojis
    safe_track_name = (
        str(track_name)
        .encode("ascii", errors="ignore")
        .decode("ascii")
        .strip() or "Pattern"
    )

    # Set Track Name
    track.append(mido.MetaMessage('track_name', name=safe_track_name, time=0))

    # Set Tempo
    bpm_tempo = mido.bpm2tempo(tempo if tempo and tempo > 0 else 140.0)
    track.append(mido.MetaMessage('set_tempo', tempo=bpm_tempo, time=0))

    if not notes:
        buffer = io.BytesIO()
        mid.save(file=buffer)
        return buffer.getvalue()

    # Convert notes to events (note_on and note_off)
    events = []
    for n in notes:
        pitch = max(0, min(127, int(n.get("pitch", 60))))
        pos = max(0, int(n.get("pos", 0)))
        duration = max(1, int(n.get("duration", 96)))
        velocity = max(1, min(127, int(n.get("velocity", 100))))

        events.append({"type": "note_on", "pos": pos, "pitch": pitch, "velocity": velocity})
        events.append({"type": "note_off", "pos": pos + duration, "pitch": pitch, "velocity": 0})

    # Sort events chronologically. For same pos, note_off comes before note_on
    events.sort(key=lambda x: (x["pos"], 0 if x["type"] == "note_off" else 1))

    current_pos = 0
    for evt in events:
        delta_ticks = evt["pos"] - current_pos
        current_pos = evt["pos"]

        if evt["type"] == "note_on":
            track.append(mido.Message('note_on', note=evt["pitch"], velocity=evt["velocity"], time=delta_ticks))
        else:
            track.append(mido.Message('note_off', note=evt["pitch"], velocity=0, time=delta_ticks))

    track.append(mido.MetaMessage('end_of_track', time=0))

    buffer = io.BytesIO()
    mid.save(file=buffer)
    return buffer.getvalue()
