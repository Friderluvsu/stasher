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
- **Fast Desktop Client**: Built with React 19, TypeScript, Tailwind CSS, Electron, and a high-performance Python FastAPI backend.

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
npm run build:mac  # macOS DMG & Zip
npm run build:win  # Windows NSIS Installer
```

## Automated builds
GitHub Actions workflows automatically build and publish installer binaries for:
- **Windows (x64 NSIS Installer)**
- **macOS (Apple Silicon ARM64 & Intel x64 DMGs)**
