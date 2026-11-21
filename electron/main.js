const { app, BrowserWindow, shell, Tray, Menu, nativeImage, ipcMain, dialog, nativeTheme, Notification } = require('electron');
const path = require('path');
const { fork, spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const crypto = require('crypto');
const { compareReleaseVersions } = require('./version');
const { parseNexoDeepLink } = require('./deeplink');

// Windows связывает иконку окна и ярлык с этим ID. Задаём до app.whenReady(),
// иначе Windows может закрепить процесс под общим значком Electron.
if (process.platform === 'win32') app.setAppUserModelId('com.nexo.app');
app.setName('Nexo');

let mainWindow = null;
let splashWindow = null;
let tray = null;
let serverProcess = null;
let serverReady = false;
let serverRestarts = 0;
let updateCheckPromise = null;
let backgroundUpdateTimer = null;
let activeUpdateController = null;
let skipUpdateRequested = false;
let pendingUpdateNotice = null;
let releaseNotesText = '';
let queuedDeepLink = null;
const MAX_SERVER_RESTARTS = 5;
let notificationCount = 0;
const SERVER_PORT = process.env.PORT || 4000;

// ВАЖНО: Electron должен всегда использовать локальный сервер
// Используем 127.0.0.1 для стабильности
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
    const logMessage = `[${timestamp}] ${message}
`;
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

    const isServerAlive = () =>
      serverProcess && !serverProcess.killed && serverProcess.exitCode === null;

    const checkServerHealth = () => {
      // Проверяем что процесс жив
      if (!isServerAlive()) {
        reject(new Error('Server process died before becoming ready'));
        return;
      }

      attempts += 1;
      // Одна проверка = одно продолжение. Раньше при таймауте срабатывали и 'timeout',
      // и 'error' (после destroy), и цикл опроса удваивался.
      let settled = false;
      const retry = (reason) => {
        if (settled) return;
        settled = true;
        if (attempts >= maxAttempts) {
          reject(new Error(`Server failed to start (${reason})`));
          return;
        }
        setTimeout(checkServerHealth, intervalMs);
      };

      const req = http.get(`${SERVER_URL}/api/security/csrf-token`, (res) => {
        res.resume();
        if (settled) return;
        settled = true;
        // Подождём секунду и убедимся, что процесс не упал сразу после открытия порта
        setTimeout(() => {
          if (!isServerAlive()) {
            reject(new Error('Server process died immediately after opening port'));
            return;
          }
          resolve();
        }, 1000);
      });
      req.on('error', () => retry('connection error'));
      req.setTimeout(1000, () => {
        req.destroy();
        retry('timeout');
      });
    };

    checkServerHealth();
  });
}

function getIconsDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'icons')
    : path.join(__dirname, 'icons');
}

function getDesktopIconPath() {
  const iconPath = path.join(getIconsDir(), 'Nexo-Desctop-ico.ico');
  if (fs.existsSync(iconPath)) {
    const ico = nativeImage.createFromPath(iconPath);
    if (!ico.isEmpty()) return iconPath;
    console.warn('Nexo ICO is unreadable; falling back to the PNG app icon:', iconPath);
  }

  const pngPath = getIconPath('Nexo-Desctop-ico', 256);
  if (fs.existsSync(pngPath)) {
    const png = nativeImage.createFromPath(pngPath);
    if (!png.isEmpty()) return pngPath;
  }
  console.error('No readable Nexo application icon was found.');
  return iconPath;
}

// Файлы иконок лежат с суффиксом размера (Nexo-Desctop-ico-256.png), поэтому ищем
// нужный размер, затем имя без суффикса и ближайшие размеры.
function getIconPath(iconName, size = 256) {
  const dir = getIconsDir();
  const candidates = [
    `${iconName}-${size}.png`,
    `${iconName}.png`,
    `${iconName}-256.png`,
    `${iconName}-128.png`,
    `${iconName}-64.png`,
    `${iconName}-48.png`,
    `${iconName}-32.png`,
    `${iconName}-16.png`
  ];
  for (const file of candidates) {
    const candidate = path.join(dir, file);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return path.join(dir, `${iconName}-${size}.png`);
}

function ensureDesktopShortcut() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const shortcutPath = path.join(app.getPath('desktop'), 'Nexo.lnk');
  try {
    const shortcutAction = fs.existsSync(shortcutPath) ? 'update' : 'create';
    const created = shell.writeShortcutLink(shortcutPath, shortcutAction, {
      target: process.execPath,
      args: [],
      cwd: path.dirname(process.execPath),
      description: 'Nexo — рабочее пространство для общения и совместной работы',
      icon: getDesktopIconPath(),
      iconIndex: 0
    });
    if (created) console.log('Desktop shortcut created:', shortcutPath);
    else console.warn('Windows did not create the Nexo desktop shortcut.');
  } catch (error) {
    console.warn('Could not create Nexo desktop shortcut:', error.message);
  }
}

function getTrayIconPath(count = notificationCount) {
  const fileName = count > 0
    ? `nexo-ico-mini-${Math.min(9, count)}ping-32.png`
    : 'nexo-ico-mini-32.png';
  return path.join(getIconsDir(), fileName);
}

function createTrayImage(count = notificationCount) {
  const iconPath = getTrayIconPath(count);
  if (fs.existsSync(iconPath)) return nativeImage.createFromPath(iconPath);
  return nativeImage.createEmpty();
}

function createTaskbarOverlay(count) {
  if (!count) return null;
  const overlayPath = path.join(getIconsDir(), `nexo-taskbar-badge-${Math.min(9, count)}.png`);
  if (!fs.existsSync(overlayPath)) return null;
  return nativeImage.createFromPath(overlayPath);
}
// Тестовый аккаунт разработчика (dev@nexo.local с премиум-подпиской).
// Включён при запуске из исходников (`npm start` / `electron:dev`). В установленной сборке
// включается переменной NEXO_DEV_ACCOUNT=1 или пустым файлом dev-account.enabled в папке
// пользовательских данных (Windows: %APPDATA%\Nexo). NEXO_DEV_ACCOUNT=0 выключает всегда.
function isDevAccountEnabled() {
  const flag = process.env.NEXO_DEV_ACCOUNT;
  if (flag === 'false' || flag === '0') return false;
  if (flag === 'true' || flag === '1') return true;
  return !app.isPackaged || fs.existsSync(path.join(app.getPath('userData'), 'dev-account.enabled'));
}

// Секреты десктопного сервера генерируются один раз и хранятся в userData,
// а не зашиты в код (иначе любой мог бы подделать сессию/JWT).
function getOrCreateSecrets() {
  const secretsFile = path.join(app.getPath('userData'), 'secrets.json');
  let secrets = {};
  try {
    secrets = JSON.parse(fs.readFileSync(secretsFile, 'utf8'));
  } catch {
    secrets = {};
  }

  let changed = false;
  for (const key of ['SESSION_SECRET', 'JWT_SECRET']) {
    if (typeof secrets[key] !== 'string' || secrets[key].length < 32) {
      secrets[key] = crypto.randomBytes(48).toString('hex');
      changed = true;
    }
  }

  if (changed) {
    fs.mkdirSync(path.dirname(secretsFile), { recursive: true });
    fs.writeFileSync(secretsFile, JSON.stringify(secrets), { mode: 0o600 });
  }
  return secrets;
}

function createTray() {
  console.log('Creating system tray...');
  
  // Отдельный компактный знак для системного трея: он намеренно не совпадает с desktop-иконкой.
  tray = new Tray(createTrayImage(notificationCount));
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Nexo',
      icon: nativeImage.createFromPath(getIconPath('Nexo-Desctop-ico', 16)),
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Проверить обновления',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        }
        checkForUpdates({ interactive: true });
      }
    },
    {
      label: 'О программе',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Выход',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
  
  tray.setToolTip('Nexo');
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
  
  console.log('System tray created');
}

// IPC handlers (will be registered inside app.whenReady)
function setupIPCHandlers() {
  ipcMain.on('set-notification-count', (event, count) => {
    setNotificationCount(count);
    // Отправляем уведомление обратно в renderer
    if (mainWindow) {
      mainWindow.webContents.send('notification-updated', count);
    }
  });

  ipcMain.on('minimize-window', () => {
    if (mainWindow) {
      mainWindow.minimize();
    }
  });

  ipcMain.on('maximize-window', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });

  ipcMain.on('close-window', () => {
    if (mainWindow) {
      mainWindow.close();
    }
  });

  ipcMain.handle('show-system-notification', (_event, payload = {}) => {
    if (!Notification.isSupported()) return false;
    const title = String(payload.title || 'Nexo').slice(0, 100);
    const body = String(payload.body || '').slice(0, 240);
    const notification = new Notification({ title, body, icon: getDesktopIconPath(), silent: true });
    if (typeof payload.deepLink === 'string' && payload.deepLink.startsWith('nexo://')) {
      notification.on('click', () => dispatchDeepLink(payload.deepLink));
    }
    notification.show();
    return true;
  });

  ipcMain.handle('get-app-version', () => app.getVersion());
  ipcMain.handle('check-for-updates', () => checkForUpdates({ interactive: true }));
  ipcMain.handle('get-update-preferences', () => getUpdatePreferences());
  ipcMain.on('set-update-preferences', (_event, value) => { setUpdatePreferences(value); });
  ipcMain.handle('open-logs', async () => { await shell.openPath(path.join(app.getPath('userData'), 'logs')); return true; });
  ipcMain.on('skip-update', () => { skipUpdateRequested = true; activeUpdateController?.abort(); });
  ipcMain.on('set-window-theme', (_event, theme) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors);
    mainWindow.setTitleBarOverlay({
      color: dark ? '#262624' : '#FAF9F5',
      symbolColor: dark ? '#ECE9E3' : '#262624',
      height: 34
    });
  });
}

function updateTrayIcon() {
  if (!tray) return;
  tray.setImage(createTrayImage(notificationCount));
  tray.setToolTip(notificationCount > 0 ? `Nexo · ${notificationCount} уведомлений` : 'Nexo');
}

function setNotificationCount(count) {
  const safeCount = Number.isFinite(Number(count)) ? Math.max(0, Math.floor(Number(count))) : 0;
  notificationCount = Math.min(safeCount, 9);

  // Системный трей показывает отдельную мини-иконку со счётчиком.
  updateTrayIcon();

  // Значок приложения остаётся фирменным; число выводится отдельным Windows taskbar overlay.
  if (mainWindow && !mainWindow.isDestroyed() && process.platform === 'win32') {
    mainWindow.setOverlayIcon(createTaskbarOverlay(notificationCount), notificationCount > 0 ? `${notificationCount} непрочитанных уведомлений` : '');
  }
}

function dispatchDeepLink(rawUrl) {
  const payload = parseNexoDeepLink(rawUrl);
  if (!payload) return false;
  try {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.getURL().startsWith(SERVER_URL)) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('deep-link', payload);
    } else queuedDeepLink = payload;
    return true;
  } catch (error) {
    console.warn('Failed to dispatch Nexo deep link:', error.message);
    return false;
  }
}

function updatePreferencesPath() { return path.join(app.getPath('userData'), 'update-preferences.json'); }
function getUpdatePreferences() {
  try { return { autoDownload: JSON.parse(fs.readFileSync(updatePreferencesPath(), 'utf8')).autoDownload !== false }; }
  catch { return { autoDownload: true }; }
}
function setUpdatePreferences(value = {}) {
  const preferences = { autoDownload: value.autoDownload !== false };
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(updatePreferencesPath(), JSON.stringify(preferences, null, 2), 'utf8');
  return preferences;
}
function sendUpdateStatus(status, message, version, percent, releaseNotes) {
  const payload = { status, message, ...(version ? { version } : {}), ...(Number.isFinite(percent) ? { percent: Math.max(0, Math.min(100, percent)) } : {}), ...(releaseNotes ? { releaseNotes } : {}) };
  if (status === 'available' || status === 'downloaded') pendingUpdateNotice = payload;
  if (status === 'up-to-date') pendingUpdateNotice = null;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-status', payload);
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.webContents.send('update-status', payload);
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function readExpectedSha256(release, asset) {
  if (typeof asset.digest === 'string' && /^sha256:[a-f0-9]{64}$/i.test(asset.digest)) return asset.digest.slice(7).toLowerCase();
  const checksum = (release.assets || []).find((item) => item.name === `${asset.name}.sha256`);
  if (!checksum?.browser_download_url) return null;
  const response = await fetch(checksum.browser_download_url, { headers: { 'User-Agent': 'Nexo-Desktop-App' }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) return null;
  const match = (await response.text()).trim().match(/\b([a-f0-9]{64})\b/i);
  return match ? match[1].toLowerCase() : null;
}
async function downloadAndVerifyUpdate(asset, expectedHash, version) {
  const updatesDirectory = path.join(app.getPath('userData'), 'updates');
  fs.mkdirSync(updatesDirectory, { recursive: true });
  const safeVersion = version.replace(/[^a-zA-Z0-9.-]/g, '_');
  const installerPath = path.join(updatesDirectory, `Nexo-${safeVersion}-Setup.exe`);
  try {
    const stat = await fs.promises.stat(installerPath);
    if (stat.isFile() && stat.size === asset.size && stat.size > 1024) {
      const hash = crypto.createHash('sha256');
      for await (const chunk of fs.createReadStream(installerPath)) hash.update(chunk);
      if (hash.digest('hex') === expectedHash) {
        sendUpdateStatus('downloaded', `Установщик Nexo ${version} уже загружен и проверен.`, version, 100);
        return installerPath;
      }
    }
  } catch {}
  try { await fs.promises.unlink(installerPath); } catch {}
  if (skipUpdateRequested) {
    sendUpdateStatus('skipped', 'Запуск продолжается без обновления.', version);
    return null;
  }
  activeUpdateController = new AbortController();
  const response = await fetch(asset.browser_download_url, {
    headers: { 'User-Agent': 'Nexo-Desktop-App' },
    signal: AbortSignal.any([activeUpdateController.signal, AbortSignal.timeout(20 * 60 * 1000)])
  });
  if (!response.ok || !response.body) throw new Error(`Не удалось скачать обновление (HTTP ${response.status}).`);
  const total = Number(response.headers.get('content-length')) || Number(asset.size) || 0;
  let received = 0, lastPercent = -1;
  const hash = crypto.createHash('sha256');
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length; hash.update(chunk);
      const percent = total ? Math.floor(received / total * 100) : 0;
      if (percent !== lastPercent) { lastPercent = percent; sendUpdateStatus('downloading', `Скачиваем обновление… ${percent}%`, version, percent); }
      callback(null, chunk);
    }
  });
  try {
    await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(installerPath, { flags: 'w' }));
    const actualHash = hash.digest('hex');
    const stat = await fs.promises.stat(installerPath);
    if (stat.size < 1024 || (asset.size && stat.size !== asset.size)) throw new Error('Размер скачанного установщика не совпадает с опубликованным.');
    if (actualHash !== expectedHash) throw new Error('Контрольная сумма установщика не совпала. Файл удалён из соображений безопасности.');
    sendUpdateStatus('downloaded', `Обновление ${version} скачано и проверено.`, version, 100);
    return installerPath;
  } catch (error) {
    await fs.promises.unlink(installerPath).catch(() => {});
    if (skipUpdateRequested || error.name === 'AbortError') { sendUpdateStatus('skipped', 'Запуск продолжается без обновления.', version); return null; }
    throw error;
  } finally { activeUpdateController = null; }
}
async function installUpdate(installerPath, version, { silent = false } = {}) {
  if (silent) {
    sendUpdateStatus('installing', `Устанавливаем Nexo ${version}…`, version);
    const child = spawn(installerPath, ['/S', '--updated'], { detached: true, stdio: 'ignore', windowsHide: true });
    return new Promise((resolve) => {
      child.once('spawn', () => { app.isQuitting = true; app.quit(); resolve({ status: 'installing', version, message: 'Установка обновления запущена.' }); });
      child.once('error', (error) => {
        console.warn('Silent update install failed:', error.message);
        sendUpdateStatus('install-fallback', 'Тихая установка не удалась. Откроется обычный установщик.', version);
        const fallback = spawn(installerPath, [], { detached: true, stdio: 'ignore', windowsHide: false });
        fallback.once('spawn', () => { app.isQuitting = true; app.quit(); resolve({ status: 'installing', version, message: 'Открылся обычный установщик.' }); });
        fallback.once('error', () => resolve({ status: 'error', message: 'Не удалось запустить установщик. Попробуйте установить его вручную.' }));
      });
    });
  }
  const choice = await dialog.showMessageBox(mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined, {
    type: 'info', title: 'Обновление Nexo', message: `Доступна новая версия Nexo ${version}`,
    detail: 'Обновление скачано и проверено. Nexo закроется на время установки.',
    buttons: ['Установить сейчас', 'Позже'], defaultId: 0, cancelId: 1, noLink: true
  });
  if (choice.response !== 0) return { status: 'downloaded', version, message: `Обновление ${version} готово к установке. Можно вернуться к нему позже.` };
  return installUpdate(installerPath, version, { silent: true });
}
async function checkForUpdates({ interactive = true, startup = false } = {}) {
  if (!app.isPackaged) { sendUpdateStatus('development', 'Режим разработки — проверка обновлений пропущена.'); return { status: 'unavailable', message: 'Режим разработки — обновления не проверяются.' }; }
  if (updateCheckPromise) return updateCheckPromise;
  if (startup) skipUpdateRequested = false;
  updateCheckPromise = (async () => {
    sendUpdateStatus('checking', 'Проверяем обновления…');
    try {
      const response = await fetch('https://api.github.com/repos/Averyyyx/Nexo/releases?per_page=30', {
        headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'Nexo-Desktop-App' }, signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) throw new Error(response.status === 404 ? 'Не удалось найти публичные Alpha-релизы Nexo.' : `Сервис обновлений временно недоступен (HTTP ${response.status}).`);
      const releases = await response.json();
      const latest = releases.filter((item) => !item.draft && item.prerelease)
        .sort((left, right) => compareReleaseVersions(right.tag_name, left.tag_name))[0];
      if (!latest) {
        const message = 'У вас последняя доступная Alpha-версия.';
        sendUpdateStatus('up-to-date', message, app.getVersion());
        if (startup) await sleep(400);
        return { status: 'up-to-date', message };
      }
      const current = app.getVersion().replace(/^v/, '');
      const version = String(latest.tag_name || '').replace(/^v/, '');
      if (!version || compareReleaseVersions(version, current) <= 0) {
        const message = 'У вас последняя версия Nexo.';
        sendUpdateStatus('up-to-date', message, current);
        if (startup) await sleep(400);
        return { status: 'up-to-date', version: current, message };
      }
      const asset = (latest.assets || []).find((item) => /\.exe$/i.test(item.name || '') && /setup/i.test(item.name || ''));
      if (!asset?.browser_download_url || !asset.size) throw new Error(`В релизе ${version} нет установщика Windows.`);
      releaseNotesText = String(latest.body || '').replace(/<[^>]+>/g, '').trim().slice(0, 12000);
      sendUpdateStatus('available', `Найдена версия ${version}.`, version, undefined, releaseNotesText);
      const preferences = getUpdatePreferences();
      if (!preferences.autoDownload && (!interactive || startup)) return { status: 'available', version, message: `Доступна версия ${version}. Автоматическая загрузка выключена.`, releaseNotes: releaseNotesText };
      if (startup && skipUpdateRequested) {
        sendUpdateStatus('skipped', 'Запуск продолжается без обновления.', version);
        return { status: 'skipped', version, message: 'Обновление пропущено.' };
      }
      const expectedHash = await readExpectedSha256(latest, asset);
      if (!expectedHash) throw new Error('У релиза отсутствует SHA-256. Установщик не будет запущен.');
      if (startup && skipUpdateRequested) {
        sendUpdateStatus('skipped', 'Запуск продолжается без обновления.', version);
        return { status: 'skipped', version, message: 'Обновление пропущено.' };
      }
      const installerPath = await downloadAndVerifyUpdate(asset, expectedHash, version);
      if (!installerPath) return { status: 'skipped', version, message: 'Запуск продолжается без обновления.' };
      if (startup) return installUpdate(installerPath, version, { silent: true });
      if (interactive) return installUpdate(installerPath, version, { silent: false });
      return { status: 'downloaded', version, message: `Обновление ${version} скачано и проверено.`, releaseNotes: releaseNotesText };
    } catch (error) {
      const message = error.name === 'TimeoutError' || error.name === 'AbortError'
        ? 'Не удалось проверить обновления по тайм-ауту. Запуск Nexo продолжается.'
        : (error.message || 'Не удалось проверить или скачать обновление.');
      console.warn('Update check failed:', error);
      sendUpdateStatus('error', message);
      if (startup) await sleep(1000);
      return { status: 'error', message };
    }
  })();
  try { return await updateCheckPromise; } finally { updateCheckPromise = null; }
}

function getServerRuntime() {
  // И в разработке, и в упакованной сборке сервер запускается самим Electron как Node.
  // Нативные модули (better-sqlite3) собираются под ABI Electron (postinstall:
  // electron-builder install-app-deps), поэтому отдельный node.exe с другим ABI
  // использовать нельзя: он не загрузит better_sqlite3.node.
  return {
    execPath: process.execPath,
    useElectronAsNode: true
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

  const secrets = getOrCreateSecrets();

  // stdout/stderr сервера берём через pipe, чтобы они попадали в main.log
  // (при stdio: 'inherit' потоков нет, и логи сервера терялись).
  const child = fork(serverPath, [], {
    cwd: serverCwd,
    execPath: runtime.execPath,
    env: {
      ...process.env,
      ...(runtime.useElectronAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      ELECTRON_DESKTOP: '1',
      USE_MEMORY_SESSION: 'true',
      PORT: String(SERVER_PORT),
      HOST: '127.0.0.1',
      NODE_ENV: 'production',
      CLIENT_ORIGIN: SERVER_URL, // Используем локальный URL
      SESSION_SECRET: process.env.SESSION_SECRET || secrets.SESSION_SECRET,
      JWT_SECRET: process.env.JWT_SECRET || secrets.JWT_SECRET,
      DATA_DIR: userDataDir,
      DB_PATH: path.join(userDataDir, 'app.db'),
      NEXO_DEV_ACCOUNT: isDevAccountEnabled() ? 'true' : 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  serverProcess = child;

  child.on('error', (error) => {
    console.error('Server process error:', error);
  });

  child.on('exit', (code, signal) => {
    console.log(`Server process exited with code ${code} and signal ${signal}`);
    if (serverProcess === child) {
      serverProcess = null;
    }

    // Сервер упал уже после успешного запуска — поднимаем его снова (с ограничением),
    // чтобы чаты не оставались мёртвыми до перезапуска приложения.
    const crashed = code !== 0 && signal !== 'SIGTERM';
    if (crashed && serverReady && !app.isQuitting) {
      console.error('Server crashed! Exit code:', code);
      if (serverRestarts < MAX_SERVER_RESTARTS) {
        serverRestarts += 1;
        const delay = 1000 * serverRestarts;
        console.log(`Restarting server in ${delay} ms (attempt ${serverRestarts}/${MAX_SERVER_RESTARTS})`);
        setTimeout(() => {
          if (!app.isQuitting) {
            try {
              startServer();
            } catch (error) {
              console.error('Failed to restart server:', error);
            }
          }
        }, delay);
      } else {
        console.error('Server restart limit reached; giving up.');
      }
    }
  });

  // Логируем stdout и stderr от сервера
  child.stdout?.on('data', (data) => {
    console.log('[Server stdout]', data.toString());
  });

  child.stderr?.on('data', (data) => {
    console.error('[Server stderr]', data.toString());
  });

  console.log('Server process started with PID:', child.pid);
}

function createSplashWindow() {
  console.log('Creating splash window...');
  const splashIconPath = getDesktopIconPath();

  splashWindow = new BrowserWindow({
    width: 480,
    height: 570,
    resizable: false,
    frame: false,
    alwaysOnTop: true,
    transparent: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'splash-preload.js')
    },
    show: false,
    backgroundColor: '#262624',
    icon: splashIconPath
  });

  if (process.platform === 'win32') {
    const splashIcon = nativeImage.createFromPath(splashIconPath);
    if (!splashIcon.isEmpty()) splashWindow.setIcon(splashIcon);
    else console.warn('Nexo splash icon could not be loaded:', splashIconPath);
  }

  const splashPath = path.join(__dirname, 'splash.html');
  console.log('Loading splash from:', splashPath);
  
  splashWindow.loadFile(splashPath);
  
  splashWindow.once('ready-to-show', () => {
    console.log('Splash window ready to show');
    splashWindow.center();
    splashWindow.show();
    
    // Отправляем версию приложения
    const version = app.getVersion();
    splashWindow.webContents.send('app-version', version);
  });

  splashWindow.on('closed', () => {
    console.log('Splash window closed');
    splashWindow = null;
  });
}

function createWindow() {
  console.log('Creating main window...');
  
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#262624', symbolColor: '#ECE9E3', height: 34 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js')
    },
    title: 'Nexo',
    show: false,
    backgroundColor: '#0D0A1A',
    icon: getDesktopIconPath()
  });

  if (process.platform === 'win32') {
    const desktopIcon = nativeImage.createFromPath(getDesktopIconPath());
    if (!desktopIcon.isEmpty()) mainWindow.setIcon(desktopIcon);
  }

  // Добавляем обработчики ошибок загрузки
  mainWindow.webContents.on('did-finish-load', () => { if (pendingUpdateNotice) mainWindow.webContents.send('update-status', pendingUpdateNotice); });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('Page failed to load:', errorCode, errorDescription, validatedURL);
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer Console] ${level}: ${message}`);
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('Renderer process gone:', details);
  });

  // Сервер уже поднят (см. app.whenReady), поэтому грузим приложение напрямую.
  // Раньше сначала открывалась welcome.html из file://: её скрипт использовал require('electron')
  // при nodeIntegration=false и падал, а fetch к серверу из file:// блокировался CORS,
  // так что окно навсегда зависало на экране «Подключение к серверу…».
  console.log('Loading URL:', SERVER_URL);
  mainWindow.loadURL(SERVER_URL)
    .then(() => {
      console.log('URL loaded successfully');
    })
    .catch((loadErr) => {
      console.error('Failed to load URL:', loadErr);
      const safeMessage = String(loadErr.message || loadErr)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
        <html>
          <head><title>Nexo Error</title></head>
          <body style="background: #1e1e1e; color: white; font-family: sans-serif; padding: 20px;">
            <h1>Nexo Failed to Start</h1>
            <p>Could not load the application. Error: ${safeMessage}</p>
            <p>Server URL: ${SERVER_URL}</p>
            <p>Please check the log file in the Nexo user data folder for more details.</p>
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
    console.log('Main window closed');
    mainWindow = null;
  });
  
  // При закрытии окна - скрываем в трей, а не закрываем приложение
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      console.log('Window hidden to tray');
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'nexo:') dispatchDeepLink(url);
      else if (parsed.protocol === 'http:' || parsed.protocol === 'https:') void shell.openExternal(url);
    } catch { /* malformed URLs are denied */ }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(SERVER_URL)) return;
    event.preventDefault();
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'nexo:') dispatchDeepLink(url);
      else if (parsed.protocol === 'http:' || parsed.protocol === 'https:') void shell.openExternal(url);
    } catch { /* malformed URLs are denied */ }
  });
}

// Только один экземпляр: второй запуск иначе упёрся бы в занятый порт сервера (EADDRINUSE)
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    const deepLink = commandLine.find((argument) => argument.startsWith('nexo://'));
    if (deepLink) dispatchDeepLink(deepLink);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  app.on('open-url', (event, url) => { event.preventDefault(); dispatchDeepLink(url); });
}

// Инициализация приложения Electron
app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) {
    return;
  }

  // Регистрируем nexo:// для ссылок на сообщения.
  try { app.setAsDefaultProtocolClient('nexo'); } catch (error) { console.warn('Не удалось зарегистрировать nexo://:', error.message); }

  const startupDeepLink = process.argv.find((argument) => argument.startsWith('nexo://'));
  if (startupDeepLink) dispatchDeepLink(startupDeepLink);

  // Инициализируем логирование после того, как app готов
  setupLogging();
  ensureDesktopShortcut();
  
  // Регистрируем IPC handlers
  setupIPCHandlers();
  
  try {
    console.log('=== Nexo Electron App Starting ===');
    console.log('App path:', app.getAppPath());
    console.log('User data:', app.getPath('userData'));
    console.log('Is packaged:', app.isPackaged);
    console.log('Node version:', process.version);
    console.log('Platform:', process.platform);
    console.log('Server URL:', SERVER_URL);
    console.log('Server Port:', SERVER_PORT);
    
    // Сначала создаем splash screen
    createSplashWindow();
    
    // Запускаем встроенный сервер
    console.log('Starting embedded server...');
    if (splashWindow) {
      splashWindow.webContents.send('loading-status', 'Запуск сервера...');
    }
    startServer();

    // Проверка релиза начинается на splash до создания основного окна.
    const startupUpdateTask = checkForUpdates({ interactive: false, startup: true });
    
    // Ждем, пока сервер станет доступен
    console.log('Waiting for server to be ready...');
    if (splashWindow) {
      splashWindow.webContents.send('loading-status', 'Ожидание сервера...');
    }
    await waitForServer();
    serverReady = true;
    console.log('Server is ready!');
    const startupUpdateResult = await startupUpdateTask;
    if (startupUpdateResult?.status === 'installing' || app.isQuitting) return;
    
    // Создаем system tray
    createTray();
    
    // Создаем главное окно только после того, как сервер готов
    console.log('Creating main window...');
    if (splashWindow) {
      splashWindow.webContents.send('loading-status', 'Загрузка интерфейса...');
    }
    createWindow();
    
    // Когда главное окно готово, закрываем splash screen
    // Окно показывает/открывает DevTools обработчик в createWindow; здесь только закрываем splash
    mainWindow.once('ready-to-show', () => {
      console.log('Main window ready, closing splash...');
      if (splashWindow) splashWindow.close();
      if (!backgroundUpdateTimer && app.isPackaged) {
        backgroundUpdateTimer = setInterval(() => { void checkForUpdates({ interactive: false, startup: false }); }, 6 * 60 * 60 * 1000);
        backgroundUpdateTimer.unref?.();
      }
    });
    
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
          <p><strong>Error:</strong> ${String(error.message).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
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
  // Не закрываем приложение когда все окна закрыты - оно работает в фоне
  console.log('All windows closed, keeping app running in background');
});

app.on('before-quit', () => {
  // Без этого флага обработчик 'close' окна отменяет закрытие (прячет в трей),
  // и приложение не завершается при выходе из меню, перезагрузке или выключении системы.
  app.isQuitting = true;
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