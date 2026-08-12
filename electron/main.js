const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const http = require('http');
const fs = require('fs');

let mainWindow = null;
let serverProcess = null;
const SERVER_PORT = process.env.PORT || 4000;

// ВАЖНО: Electron должен всегда использовать локальный сервер
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;

// Функция логирования (инициализируется внутри app.whenReady)
let logFile = null;
let logDir = null;

function setupLogging() {
  logDir = path.join(app.getPath('userData'), 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  logFile = path.join(logDir, 'main.log');

  function logToFile(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    try {
      fs.appendFileSync(logFile, logMessage);
    } catch (err) {
      // Игнорируем ошибки логирования
    }
  }

  // Перенаправляем console.log для записи в файл
  const originalConsoleLog = console.log;
  console.log = (...args) => {
    originalConsoleLog(...args);
    logToFile(args.join(' '));
  };

  const originalConsoleError = console.error;
  console.error = (...args) => {
    originalConsoleError(...args);
    logToFile('ERROR: ' + args.join(' '));
  };

  console.log('=== Nexo Electron Process Starting ===');
  console.log('Process ID:', process.pid);
  console.log('Exec Path:', process.execPath);
  console.log('App Path:', app.getAppPath());
  console.log('User Data:', app.getPath('userData'));
  console.log('Log File:', logFile);
}

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
  
  // Создаем директории для данных
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
    console.log('Created userData directory:', userDataDir);
  }
  
  const uploadsDir = path.join(userDataDir, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('Created uploads directory:', uploadsDir);
  }
  
  const tmpDir = path.join(userDataDir, 'tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
    console.log('Created tmp directory:', tmpDir);
  }

  // Определяем пути к server.js
  let serverPath, serverCwd;
  
  if (app.isPackaged) {
    // В packaged приложении
    serverPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'server.js');
    serverCwd = path.join(process.resourcesPath, 'app.asar.unpacked');
    console.log('Using packaged application paths');
  } else {
    // В разработке
    serverPath = path.join(__dirname, '..', 'server.js');
    serverCwd = path.join(__dirname, '..');
    console.log('Using development paths');
  }

  const runtime = getServerRuntime();

  console.log('Starting server with:');
  console.log('  serverPath:', serverPath);
  console.log('  serverCwd:', serverCwd);
  console.log('  runtime:', runtime.execPath);
  console.log('  userDataDir:', userDataDir);
  console.log('  PORT:', SERVER_PORT);

  // Проверяем существование server.js
  if (!fs.existsSync(serverPath)) {
    const error = `Server file not found: ${serverPath}`;
    console.error(error);
    throw new Error(error);
  }

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
      CLIENT_ORIGIN: SERVER_URL, // Используем локальный URL
      SESSION_SECRET: process.env.SESSION_SECRET || 'nexo-desktop-session',
      JWT_SECRET: process.env.JWT_SECRET || 'nexo-desktop-jwt',
      DATA_DIR: userDataDir,
      DB_PATH: path.join(userDataDir, 'app.db')
    },
    stdio: 'inherit'
  });

  serverProcess.on('error', (error) => {
    console.error('Server process error:', error);
  });

  serverProcess.on('exit', (code, signal) => {
    console.log(`Server process exited with code ${code} and signal ${signal}`);
  });
  
  console.log('Server process started with PID:', serverProcess.pid);
}

function createWindow() {
  console.log('Creating BrowserWindow...');
  
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
    title: 'Nexo',
    show: false,
    backgroundColor: '#1e1e1e'
  });

  // Добавляем обработчики ошибок загрузки
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('Page failed to load:', errorCode, errorDescription, validatedURL);
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer Console] ${level}: ${message}`);
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('Renderer process gone:', details);
  });

  console.log('Loading URL:', SERVER_URL);
  mainWindow.loadURL(SERVER_URL)
    .then(() => {
      console.log('URL loaded successfully');
    })
    .catch(err => {
      console.error('Failed to load URL:', err);
      // Показываем ошибку пользователю
      mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
        <html>
          <head><title>Nexo Error</title></head>
          <body style="background: #1e1e1e; color: white; font-family: sans-serif; padding: 20px;">
            <h1>Nexo Failed to Start</h1>
            <p>Could not load the application. Error: ${err.message}</p>
            <p>Server URL: ${SERVER_URL}</p>
            <p>Please check the console for more details.</p>
          </body>
        </html>
      `));
    });

  mainWindow.once('ready-to-show', () => {
    console.log('Window ready to show');
    mainWindow.show();
    if (process.env.NODE_ENV === 'development') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

  mainWindow.on('closed', () => {
    console.log('Window closed');
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
  // Инициализируем логирование после того, как app готов
  setupLogging();
  
  try {
    console.log('=== Nexo Electron App Starting ===');
    console.log('App path:', app.getAppPath());
    console.log('User data:', app.getPath('userData'));
    console.log('Is packaged:', app.isPackaged);
    console.log('Node version:', process.version);
    console.log('Platform:', process.platform);
    console.log('Server URL:', SERVER_URL);
    console.log('Server Port:', SERVER_PORT);
    
    // Запускаем встроенный сервер
    console.log('Starting embedded server...');
    startServer();
    
    // Ждем, пока сервер станет доступен
    console.log('Waiting for server to be ready...');
    await waitForServer();
    console.log('Server is ready!');
    
    // Создаем окно только после того, как сервер готов
    console.log('Creating main window...');
    createWindow();
    
    console.log('=== Nexo Started Successfully ===');
  } catch (error) {
    console.error('=== Nexo Failed to Start ===');
    console.error('Error:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    // Показываем ошибку пользователю
    const errorHtml = `
      <html>
        <head><title>Nexo Error</title></head>
        <body style="background: #1e1e1e; color: white; font-family: sans-serif; padding: 40px;">
          <h1 style="color: #ff6b6b;">Nexo Failed to Start</h1>
          <p><strong>Error:</strong> ${error.message}</p>
          <p><strong>Server URL:</strong> ${SERVER_URL}</p>
          <p><strong>Is Packaged:</strong> ${app.isPackaged}</p>
          <p>Please check the console logs for more details.</p>
          <p>The application will close in 10 seconds.</p>
        </body>
      </html>
    `;
    
    const errorWindow = new BrowserWindow({
      width: 600,
      height: 400,
      show: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });
    
    errorWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(errorHtml));
    
    setTimeout(() => {
      app.quit();
    }, 10000);
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
    app.setAsDefaultProtocolClient('nexo', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('nexo');
}