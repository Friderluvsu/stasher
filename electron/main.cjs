const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

let mainWindow = null;
let pythonProcess = null;

const TEMP_DRAG_DIR = path.join(app.getPath('temp'), 'stasher_drag_cache');

function ensureTempDir() {
  if (!fs.existsSync(TEMP_DRAG_DIR)) fs.mkdirSync(TEMP_DRAG_DIR, { recursive: true });
}

// ─── Python Backend ────────────────────────────────────
function startPythonBackend() {
  const isDev = !app.isPackaged;
  const projectRoot = path.join(__dirname, '..');
  const userDataDir = app.getPath('userData');
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }
  const dbPath = path.join(userDataDir, 'stasher.db');

  let command;
  let args = [];
  let cwd = projectRoot;

  if (isDev) {
    const venvPython = path.join(projectRoot, 'backend', 'venv', 'bin', 'python3');
    command = fs.existsSync(venvPython) ? venvPython : 'python3';
    args = ['-m', 'backend.api.main'];
    cwd = projectRoot;
  } else {
    const isWin = process.platform === 'win32';
    const binaryName = isWin ? 'stasher-backend.exe' : 'stasher-backend';
    
    // Priority locations in packaged app
    const candidates = [
      path.join(process.resourcesPath, 'backend', binaryName),
      path.join(process.resourcesPath, binaryName),
      path.join(projectRoot, 'backend-bin', binaryName),
      path.join(__dirname, '..', 'backend-bin', binaryName)
    ];

    const foundPath = candidates.find((p) => fs.existsSync(p));

    if (foundPath) {
      command = foundPath;
      args = [];
      cwd = process.resourcesPath;
    } else {
      console.warn('[Stasher] Bundled backend binary not found, falling back to python');
      command = isWin ? 'python' : 'python3';
      args = ['-m', 'backend.api.main'];
      cwd = projectRoot;
    }
  }

  console.log('[Stasher] Starting backend:', command, args.join(' '));

  pythonProcess = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      PYTHONPATH: projectRoot,
      STASHER_DB_PATH: dbPath,
      PYTHONUNBUFFERED: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  pythonProcess.stdout.on('data', (d) => process.stdout.write(`[api] ${d}`));
  pythonProcess.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));
  pythonProcess.on('close', (code) => console.log(`[api] exited code=${code}`));
}

function stopPythonBackend() {
  if (pythonProcess) {
    try {
      pythonProcess.kill('SIGTERM');
      setTimeout(() => {
        try {
          if (pythonProcess) pythonProcess.kill('SIGKILL');
        } catch {}
      }, 500);
    } catch {}
    pythonProcess = null;
  }
}

function waitForBackend(retries = 40) {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const check = () => {
      http.get('http://127.0.0.1:8765/api/health', (res) => {
        if (res.statusCode === 200) resolve();
        else retry();
      }).on('error', retry);
    };
    const retry = () => {
      if (++attempt > retries) return reject(new Error('Backend did not start'));
      setTimeout(check, 250);
    };
    check();
  });
}

// ─── Window ────────────────────────────────────────────
function createWindow() {
  const isDev = !app.isPackaged;

  const windowOptions = {
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    transparent: process.platform === 'darwin',
    backgroundColor: process.platform === 'darwin' ? '#00000000' : '#0e1017',
    trafficLightPosition: { x: 16, y: 16 },
    show: false,
    icon: path.join(__dirname, '..', 'icons', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      sandbox: false
    }
  };

  if (process.platform === 'darwin') {
    windowOptions.vibrancy = 'under-window';
    windowOptions.visualEffectState = 'active';
  }

  mainWindow = new BrowserWindow(windowOptions);

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Fully quit application and terminate all backend processes on close
  mainWindow.on('closed', () => {
    mainWindow = null;
    stopPythonBackend();
    app.quit();
  });

  const distPath = path.join(__dirname, '..', 'dist', 'index.html');
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else if (fs.existsSync(distPath)) {
    mainWindow.loadFile(distPath);
  } else {
    mainWindow.loadURL('http://localhost:5173');
  }
}

// Helper to create a valid minimal PCM WAV synchronously if sample is offline/missing
function createFallbackWav(filePath) {
  const sampleRate = 44100;
  const numChannels = 1;
  const bitsPerSample = 16;
  const numSamples = Math.floor(sampleRate * 0.4);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const val = Math.sin(2 * Math.PI * 150 * t) * Math.exp(-t * 15) * 16000;
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.floor(val))), 44 + i * 2);
  }

  fs.writeFileSync(filePath, buffer);
}

// ─── Native Drag-to-DAW (100% Synchronous) ─────────────
ipcMain.on('ondragstart', (event, { type = 'midi', id, patternId, fileName, base64Data, samplePath, tag = '' }) => {
  ensureTempDir();
  const itemId = id || patternId;
  const isSound = type === 'sound';
  const ext = isSound ? '.wav' : '.mid';
  const safeName = (fileName || `stash_${itemId}${ext}`).replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = path.join(TEMP_DRAG_DIR, safeName);

  // Load a valid non-empty drag icon for macOS / Windows
  let icon = nativeImage.createEmpty();
  const candidateIconPaths = [
    path.join(__dirname, '..', 'icons', 'midi_icon.png'),
    path.join(__dirname, '..', 'icons', 'icon.png'),
    path.join(process.resourcesPath, 'icons', 'midi_icon.png'),
    path.join(process.resourcesPath, 'icons', 'icon.png'),
  ];
  for (const ic of candidateIconPaths) {
    if (fs.existsSync(ic)) {
      try {
        const loaded = nativeImage.createFromPath(ic);
        if (!loaded.isEmpty()) {
          icon = loaded.resize({ width: 32, height: 32 });
          break;
        }
      } catch {}
    }
  }

  // Fallback 16x16 valid PNG buffer if icon was empty to prevent Cocoa crash
  if (icon.isEmpty()) {
    try {
      icon = nativeImage.createFromBuffer(
        Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAcSURBVDhPY/wPBAwUACYGhgFgwKjBoAYYNRhoAABK4QYBgv7qWQAAAABJRU5ErkJggg==', 'base64')
      );
    } catch {}
  }

  let finalDragFile = filePath;

  if (isSound) {
    // 1. If physical sample file exists on disk, use it directly
    if (samplePath && fs.existsSync(samplePath) && fs.statSync(samplePath).isFile()) {
      finalDragFile = samplePath;
    } else {
      // 2. Try to find matched preview WAV sample in app resources / public folder
      const tagLower = (tag || '').toLowerCase();
      const previewMap = {
        '808': '808.wav',
        'bass': '808.wav',
        'kick': 'kick.wav',
        'snare': 'snare.wav',
        'clap': 'clap.wav',
        'hi-hat': 'hihat.wav',
        'open hat': 'openhat.wav',
        'rim': 'rim.wav',
        'perc': 'perc.wav',
        'vox': 'vox.wav',
        'fx': 'fx.wav',
        'piano': 'piano.wav',
        'chords': 'piano.wav',
        'melody': 'piano.wav',
      };
      const candidatePreviewName = previewMap[tagLower] || `${tagLower}.wav`;

      const candidateDirs = [
        path.join(__dirname, '..', 'public', 'audio', 'preview'),
        path.join(__dirname, '..', 'dist', 'audio', 'preview'),
        path.join(process.resourcesPath, 'audio', 'preview'),
        path.join(process.resourcesPath, 'public', 'audio', 'preview'),
      ];

      let foundPreview = null;
      for (const d of candidateDirs) {
        const p1 = path.join(d, candidatePreviewName);
        if (fs.existsSync(p1) && fs.statSync(p1).isFile()) {
          foundPreview = p1;
          break;
        }
        if (fileName) {
          const p2 = path.join(d, fileName);
          if (fs.existsSync(p2) && fs.statSync(p2).isFile()) {
            foundPreview = p2;
            break;
          }
        }
      }

      if (foundPreview) {
        try {
          fs.copyFileSync(foundPreview, filePath);
          finalDragFile = filePath;
        } catch {
          finalDragFile = foundPreview;
        }
      } else {
        // 3. Generate fallback WAV synchronously
        try {
          createFallbackWav(filePath);
          finalDragFile = filePath;
        } catch (e) {
          console.error('Error generating fallback WAV for drag:', e);
        }
      }
    }
  } else {
    // MIDI pattern drag: write synchronously from base64 buffer
    if (base64Data) {
      try {
        fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
        finalDragFile = filePath;
      } catch (err) {
        console.error('Error writing base64 drag file:', err);
      }
    }
  }

  // Synchronously start drag session on OS level (FL Studio / Ableton / Finder)
  try {
    if (fs.existsSync(finalDragFile)) {
      event.sender.startDrag({ file: finalDragFile, icon });
    } else {
      console.warn('[Stasher] Drag file does not exist on disk:', finalDragFile);
    }
  } catch (err) {
    console.error('[Stasher] Electron startDrag failed:', err);
  }
});

// ─── App lifecycle ─────────────────────────────────────
app.whenReady().then(async () => {
  ensureTempDir();
  startPythonBackend();

  try {
    await waitForBackend();
    console.log('[Stasher] Backend is ready');
  } catch {
    console.warn('[Stasher] Backend did not respond in time, launching window anyway');
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  stopPythonBackend();
});

app.on('will-quit', () => {
  stopPythonBackend();
});

app.on('window-all-closed', () => {
  stopPythonBackend();
  app.quit();
});
