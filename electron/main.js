const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const http = require('http');

let mainWindow = null;
let serverProcess = null;
const SERVER_PORT = process.env.PORT || 4000;
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;

function waitForServer(maxAttempts = 60, intervalMs = 500) {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    const check = () => {
      attempts += 1;
      const req = http.get(`${SERVER_URL}/api/security/csrf-token`, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (attempts >= maxAttempts) {
          reject(new Error('Server failed to start'));
          return;
        }
        setTimeout(check, intervalMs);
      });
      req.setTimeout(1000, () => {
        req.destroy();
        if (attempts >= maxAttempts) {
          reject(new Error('Server failed to start'));
          return;
        }
        setTimeout(check, intervalMs);
      });
    };

    check();
  });
}

function getServerRuntime() {
  if (!app.isPackaged) {
    return {
      execPath: process.execPath,
      useElectronAsNode: true
    };
  }

  return {
    execPath: path.join(process.resourcesPath, 'runtime', 'node.exe'),
    useElectronAsNode: false
  };
}

function startServer() {
  const userDataDir = path.join(app.getPath('userData'), 'data');
  const serverPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'server.js')
    : path.join(__dirname, '..', 'server.js');

  const serverCwd = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked')
    : path.join(__dirname, '..');

  const runtime = getServerRuntime();

  serverProcess = fork(serverPath, [], {
    cwd: serverCwd,
    execPath: runtime.execPath,
    env: {
      ...process.env,
      ...(runtime.useElectronAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      ELECTRON_DESKTOP: '1',
      USE_MEMORY_SESSION: 'true',
      PORT: String(SERVER_PORT),
      NODE_ENV: 'production',
      CLIENT_ORIGIN: SERVER_URL,
      SESSION_SECRET: process.env.SESSION_SECRET || 'vencord-desktop-session',
      JWT_SECRET: process.env.JWT_SECRET || 'vencord-desktop-jwt',
      DATA_DIR: userDataDir,
      DB_PATH: path.join(userDataDir, 'app.db')
    },
    stdio: 'inherit'
  });

  serverProcess.on('error', (error) => {
    console.error('Server process error:', error);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
    },
    title: 'Vencord',
    show: false,
    backgroundColor: '#1e1e1e'
  });

  mainWindow.loadURL(SERVER_URL);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (process.env.NODE_ENV === 'development') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(SERVER_URL)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

app.whenReady().then(async () => {
  try {
    startServer();
    await waitForServer();
    createWindow();
  } catch (error) {
    console.error('Failed to launch Vencord:', error);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('vencord', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('vencord');
}
