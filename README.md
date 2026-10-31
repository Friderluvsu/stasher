<p><samp>F/ &nbsp; MUSIC SOFTWARE / PROJECT VAULT</samp></p>

# Stasher

[Download](https://github.com/Friderluvsu/stasher/releases/latest) · [Releases](https://github.com/Friderluvsu/stasher/releases) · [By Frider](https://github.com/Friderluvsu)

An offline FL Studio project vault, MIDI/sample extractor, and pattern organizer with DAW drag-and-drop.

**TypeScript · React · Electron · Python · FastAPI**

## Features


- **FL Studio (.flp) Project Vault & Parser**: Automatically scans and parses FL Studio project files.
- **MIDI & Pattern Extractor**: Extracts note patterns, scores, and automation data with native drag-and-drop to any DAW (FL Studio, Ableton, Logic, Studio One, etc.).
- **StashSound Sample Indexer**: Identifies and catalogs one-shots, 808s, drums, percs, and instruments.
- **Sound Kit Builder**: Export organized drum kits and sample packs directly to `.zip`.
- **Visualizer tab**: Open `.flp`, `.mid`, `.midi`, or `.kar` files, an audio file, or parts from the vault; combine parts into a loop or play an FLP's whole playlist as a song. 41 looks in two groups (MIDI-driven and audio-driven) with live thumbnails, accent, background, and intensity settings. Preview and export share one renderer. The FLP preview uses the local parser without adding the project to the vault.
- **Vertical video export**: Record a 1080×1920 or 720×1280 video at 30 or 60 fps, up to 10 minutes, optionally from the playhead. The beat's audio (MP3, WAV, M4A, OGG, or FLAC) drives the visuals and becomes the soundtrack; without it the video is silent. MP4 (H.264) when the system supports it, otherwise WebM. Recording runs in real time.
- **Fast Desktop Client**: Built with React 19, TypeScript, Tailwind CSS, Electron, and a high-performance Python FastAPI backend.

### Open-source visual references

The Canvas looks in Stasher are original implementations informed by these MIT-licensed projects:

- [MIDIScope](https://github.com/lzzmm/MIDIScope) — piano-roll effects, glow, and aurora layers.
- [MiVi](https://github.com/sunya9/mivi) — comet and falling-note presentation.
- [Piano FX](https://github.com/imlishiyuan/piano-fx) — note-contact glow and particles.

## Development

### Prerequisites
- Node.js 20+
- Python 3.10+

### Setup & Run
```bash
# Run launcher script
./start.sh

# Or run manually:
# 1. Backend
source backend/venv/bin/activate
python -m backend.api.main

# 2. Frontend / Desktop
npm install
npm run app
```

## Building releases

```bash
# Build desktop packages
npm run build:mac  # macOS DMG
npm run build:win  # Windows NSIS Installer
```

## Automated builds
GitHub Actions workflows automatically build and publish installer binaries for:
- **Windows (x64 NSIS Installer)**
- **macOS (Apple Silicon ARM64 DMG)**

Only the installers are attached to a release; no build artifacts are kept in Actions storage.
