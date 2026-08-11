const { ipcMain, BrowserWindow, dialog, shell, app, systemPreferences } = require('electron');
const Store = require('electron-store');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

// Инициализация хранилища
const store = new Store({
  name: 'vencord-settings',
  defaults: {
    windowBounds: { width: 1280, height: 800 },
    theme: 'system',
    autoStart: false,
    minimizeToTray: true,
    startMinimized: false,
    hardwareAcceleration: true,
    disableGPU: false,
    proxy: {
      enabled: false,
      host: '',
      port: '',
      username: '',
      password: ''
    },
    shortcuts: {
      toggleMute: 'CommandOrControl+Shift+M',
      toggleDeafen: 'CommandOrControl+Shift+D',
      pushToTalk: 'V'
    },
    audio: {
      inputDevice: 'default',
      outputDevice: 'default',
      inputVolume: 100,
      outputVolume: 100,
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true
    },
    video: {
      device: 'default',
      resolution: '1280x720',
      frameRate: 30,
      mirror: false
    },
    notifications: {
      enabled: true,
      sound: true,
      flash: false,
      preview: true
    },
    privacy: {
      blockThirdPartyTrackers: true,
      blockThirdPartyCookies: true,
      sendDoNotTrack: true,
      hardwareAcceleration: true
    },
    developer: {
      devTools: false,
      devToolsOnStartup: false,
      verboseLogging: false
    }
  }
});

// Регистрация обработчиков IPC
function setupIpcHandlers() {
  // Управление окном
  ipcMain.handle('window-minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.minimize();
  });

  ipcMain.handle('window-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
  });

  ipcMain.handle('window-close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.close();
  });

  ipcMain.handle('window-is-maximized', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win ? win.isMaximized() : false;
  });

  // Хранилище
  ipcMain.handle('store-get', (event, key, defaultValue) => {
    return store.get(key, defaultValue);
  });

  ipcMain.handle('store-set', (event, key, value) => {
    store.set(key, value);
    return true;
  });

  // Управление приложением
  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  // Уведомления
  ipcMain.on('show-notification', (event, { title, body }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;

    const notification = {
      title: title || 'Vencord',
      body,
      silent: true
    };

    // Показываем уведомление
    if (process.platform === 'darwin') {
      // На macOS используем встроенные уведомления
      new Notification(notification).show();
    } else {
      // На других платформах используем диалоговое окно
      dialog.showMessageBox(win, {
        type: 'info',
        title: notification.title,
        message: notification.body,
        buttons: ['OK']
      });
    }
  });

  // Открытие внешних ссылок
  ipcMain.on('open-external', (event, url) => {
    if (typeof url === 'string' && url.startsWith('http')) {
      shell.openExternal(url).catch(console.error);
    }
  });

  // Диалоговые окна
  ipcMain.handle('show-open-dialog', async (event, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return dialog.showOpenDialog(win, options);
  });

  ipcMain.handle('show-save-dialog', async (event, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return dialog.showSaveDialog(win, options);
  });

  // Системная информация
  ipcMain.handle('get-system-info', () => {
    return {
      platform: process.platform,
      arch: process.arch,
      version: app.getVersion(),
      chrome: process.versions.chrome,
      electron: process.versions.electron,
      node: process.versions.node,
      v8: process.versions.v8,
      memory: process.getProcessMemoryInfo(),
      cpu: process.getCPUUsage(),
      systemVersion: process.getSystemVersion(),
      systemMemory: process.getSystemMemoryInfo(),
      locale: app.getLocale(),
      locales: app.getPreferredSystemLanguages(),
      isPackaged: app.isPackaged,
      appPath: app.getAppPath(),
      userData: app.getPath('userData'),
      temp: app.getPath('temp'),
      desktop: app.getPath('desktop'),
      documents: app.getPath('documents'),
      downloads: app.getPath('downloads'),
      music: app.getPath('music'),
      pictures: app.getPath('pictures'),
      videos: app.getPath('videos'),
      logs: app.getPath('logs'),
      crashDumps: app.getPath('crashDumps'),
      module: app.getAppPath(),
      resources: process.resourcesPath,
      exe: process.execPath,
      defaultApp: process.defaultApp,
      sandboxed: process.sandboxed,
      mas: process.mas,
      windowsStore: process.windowsStore,
      type: process.type,
      versions: process.versions,
      env: process.env,
      pid: process.pid,
      ppid: process.ppid,
      title: process.title,
      argv: process.argv,
      execArgv: process.execArgv,
      debugPort: process.debugPort,
      features: process.features,
      config: process.config,
      release: process.release,
      _startMark: process._startMark
    };
  });

  // Управление питанием
  ipcMain.on('prevent-sleep', () => {
    if (!powerSaveBlocker.isStarted(powerSaveBlockerId)) {
      powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    }
  });

  ipcMain.on('allow-sleep', () => {
    if (powerSaveBlocker.isStarted(powerSaveBlockerId)) {
      powerSaveBlocker.stop(powerSaveBlockerId);
    }
  });

  // Отладка
  ipcMain.on('open-dev-tools', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      win.webContents.openDevTools({ mode: 'detach' });
    }
  });

  // Обработка ошибок рендерера
  ipcMain.on('renderer-error', (event, error) => {
    log.error('Renderer error:', error);
    // Можно отправить отчет об ошибке на сервер
    // или показать пользовательское сообщение об ошибке
  });

  // Консольные сообщения из рендерера
  ipcMain.on('console', (event, { method, args }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && store.get('developer.verboseLogging', false)) {
      console[method](`[RENDERER]`, ...args);
    }
  });

  // Глобальные горячие клавиши
  ipcMain.handle('register-global-shortcut', async (event, accelerator) => {
    try {
      globalShortcut.register(accelerator, () => {
        event.sender.send('global-shortcut-pressed', accelerator);
      });
      return true;
    } catch (error) {
      console.error('Failed to register global shortcut:', error);
      return false;
    }
  });

  ipcMain.handle('unregister-global-shortcut', async (event, accelerator) => {
    try {
      globalShortcut.unregister(accelerator);
      return true;
    } catch (error) {
      console.error('Failed to unregister global shortcut:', error);
      return false;
    }
  });

  // Меню приложения
  ipcMain.on('show-app-menu', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      const menu = Menu.getApplicationMenu();
      if (menu) {
        menu.popup({ window: win });
      }
    }
  });

  // Обновления приложения
  ipcMain.handle('check-for-updates', async () => {
    if (process.env.NODE_ENV === 'development') {
      return { status: 'error', message: 'Cannot check for updates in development' };
    }

    try {
      const result = await autoUpdater.checkForUpdatesAndNotify();
      return { status: 'success', updateInfo: result.updateInfo };
    } catch (error) {
      return { status: 'error', message: error.message };
    }
  });

  ipcMain.handle('download-update', async () => {
    try {
      await autoUpdater.downloadUpdate();
      return { status: 'success' };
    } catch (error) {
      return { status: 'error', message: error.message };
    }
  });

  ipcMain.handle('install-update', async () => {
    try {
      autoUpdater.quitAndInstall();
      return { status: 'success' };
    } catch (error) {
      return { status: 'error', message: error.message };
    }
  });

  // События автообновления
  autoUpdater.on('update-available', (info) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      win.webContents.send('update-available', info);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      win.webContents.send('update-downloaded', info);
    }
  });

  autoUpdater.on('error', (error) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      win.webContents.send('update-error', { message: error.message });
    }
  });
}

module.exports = { setupIpcHandlers };
