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

// ─── Native Drag-to-DAW ────────────────────────────────
ipcMain.on('ondragstart', (event, { type = 'midi', id, patternId, fileName, base64Data, samplePath }) => {
  ensureTempDir();
  const itemId = id || patternId;
  const isSound = type === 'sound';
  const ext = isSound ? '.wav' : '.mid';
  const safeName = (fileName || `stash_${itemId}${ext}`).replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = path.join(TEMP_DRAG_DIR, safeName);

  const iconPath = path.join(__dirname, '..', 'icons', 'midi_icon.png');
  let icon = nativeImage.createEmpty();
  if (fs.existsSync(iconPath)) {
    try {
      icon = nativeImage.createFromPath(iconPath);
    } catch {}
  }

  // 1. Instant Synchronous Drag for MIDI from base64 memory buffer
  if (base64Data) {
    try {
      fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
      event.sender.startDrag({ file: filePath, icon });
      return;
    } catch (err) {
      console.error('Error writing base64 drag file:', err);
    }
  }

  // 2. Instant Synchronous Drag for audio sample if file is on local disk
  if (samplePath && fs.existsSync(samplePath) && fs.statSync(samplePath).isFile()) {
    try {
      event.sender.startDrag({ file: samplePath, icon });
      return;
    } catch (err) {
      console.error('Error starting direct sample drag:', err);
    }
  }

  // 3. Fallback: stream from local API
  const endpoint = isSound
    ? `http://127.0.0.1:8765/api/sounds/${itemId}/audio`
    : `http://127.0.0.1:8765/api/patterns/${itemId}/midi`;

  const file = fs.createWriteStream(filePath);
  http.get(endpoint, (response) => {
    if (response.statusCode === 200) {
      response.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          try {
            event.sender.startDrag({ file: filePath, icon });
          } catch (err) {
            console.error('startDrag error:', err);
          }
        });
      });
    } else {
      file.close();
    }
  }).on('error', (err) => console.error('Drag audio/MIDI error:', err));
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
