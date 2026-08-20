#!/usr/bin/env bash

# Stasher Launcher Script (Desktop App)
echo "========================================="
echo "   STASHER — Desktop FLP & MIDI Vault   "
echo "========================================="

# 1. Activate Python Backend
if [ ! -d "backend/venv" ]; then
    echo "[!] Creating Python virtual environment..."
    python3 -m venv backend/venv
    source backend/venv/bin/activate
    pip install -r backend/requirements.txt
else
    source backend/venv/bin/activate
fi

# 2. Build Frontend for Desktop App
echo "[+] Building frontend assets..."
npx vite build

# 3. Launch Native Electron Desktop Application
echo "[+] Launching Stasher Desktop Application..."
npx electron .

echo "[*] Stasher Desktop App closed."
