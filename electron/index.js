// Точка входа для Electron приложения
const { app, BrowserWindow, ipcMain, session, globalShortcut, powerSaveBlocker } = require('electron');
const path = require('path');
const url = require('url');
const log = require('electron-log');
const { setupIpcHandlers } = require('./ipc-handlers');
const { createMenu } = require('./menu');
const { createTray, updateTrayIcon } = require('./tray');
const { initAutoUpdater, checkForUpdates } = require('./updater');
const { initBackgroundTasks } = require('./background-tasks');

// Настройка логирования
log.transports.file.level = 'info';
log.info('Запуск приложения Vencord');

// Глобальные переменные
let mainWindow = null;
let tray = null;
let powerSaveBlockerId = null;

// Обработка ошибок
process.on('uncaughtException', (error) => {
  log.error('Необработанная ошибка:', error);
});

// Инициализация приложения
function createWindow() {
  log.info('Создание главного окна');
  
  // Создаем окно браузера
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    show: false, // Не показываем окно сразу
    title: 'Vencord',
    icon: path.join(__dirname, '../public/icon.ico'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: true,
      preload: path.join(__dirname, 'preload.js'),
      devTools: process.env.NODE_ENV === 'development'
    },
    backgroundColor: '#1e1e1e',
    titleBarStyle: 'hidden',
    frame: false,
    titleBarOverlay: {
      color: '#2f3136',
      symbolColor: '#dcddde',
      height: 30
    }
  });

  // Загружаем приложение
  const startUrl = process.env.ELECTRON_START_URL || url.format({
    pathname: path.join(__dirname, '../build/index.html'),
    protocol: 'file:',
    slashes: true
  });

  mainWindow.loadURL(startUrl);

  // Показываем окно, когда загрузка завершена
  mainWindow.once('ready-to-show', () => {
    log.info('Окно готово к отображению');
    mainWindow.show();
    
    // В режиме разработки открываем DevTools
    if (process.env.NODE_ENV === 'development') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
    
    // Проверяем обновления при запуске
    if (process.env.NODE_ENV !== 'development') {
      checkForUpdates().catch(err => {
        log.error('Ошибка при проверке обновлений:', err);
      });
    }
  });

  // Обработка закрытия окна
  mainWindow.on('closed', () => {
    log.info('Главное окно закрыто');
    mainWindow = null;
  });

  // Обработка навигации
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Разрешаем навигацию только по нашим доменам
    if (!url.startsWith('http://localhost') && !url.startsWith('https://your-production-domain.com')) {
      event.preventDefault();
      require('electron').shell.openExternal(url);
    }
  });

  // Обработка новых окон (например, ссылок с target="_blank")
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    require('electron').shell.openExternal(url);
    return { action: 'deny' }; // Предотвращаем открытие нового окна
  });

  // Инициализируем меню приложения
  const menu = createMenu(mainWindow);
  Menu.setApplicationMenu(menu);

  // Инициализируем иконку в трее
  tray = createTray(mainWindow);

  // Инициализируем обработчики IPC
  setupIpcHandlers();

  // Инициализируем автообновление
  if (process.env.NODE_ENV !== 'development') {
    initAutoUpdater(mainWindow);
  }

  // Инициализируем фоновые задачи
  initBackgroundTasks(mainWindow);

  // Блокировка перехода в спящий режим при активном голосовом канале
  ipcMain.on('voice-activity', (_, isActive) => {
    if (isActive && powerSaveBlockerId === null) {
      powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
      log.info('Блокировка спящего режима активирована');
    } else if (!isActive && powerSaveBlockerId !== null) {
      powerSaveBlocker.stop(powerSaveBlockerId);
      powerSaveBlockerId = null;
      log.info('Блокировка спящего режима деактивирована');
    }
  });

  // Глобальные горячие клавиши
  globalShortcut.register('CommandOrControl+Shift+I', () => {
    if (mainWindow) {
      mainWindow.webContents.toggleDevTools();
    }
  });

  // Обработка ошибок рендерера
  mainWindow.webContents.on('crashed', () => {
    log.error('Рендерер упал');
    dialog.showErrorBox(
      'Произошла ошибка',
      'К сожалению, приложение столкнулось с ошибкой и должно быть перезапущено.'
    );
    app.relaunch();
    app.exit(1);
  });

  // Обработка завершения работы
  app.on('will-quit', () => {
    // Отписываемся от всех глобальных горячих клавиш
    globalShortcut.unregisterAll();
    
    // Останавливаем блокировщик спящего режима, если активен
    if (powerSaveBlockerId !== null) {
      powerSaveBlocker.stop(powerSaveBlockerId);
    }
    
    log.info('Приложение завершает работу');
  });
}

// Инициализация приложения
app.whenReady().then(() => {
  log.info('Приложение готово');
  
  // Настройка сессии
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // Добавляем заголовки безопасности
    const responseHeaders = {
      ...details.responseHeaders,
      'Content-Security-Policy': ["default-src 'self' 'unsafe-inline' 'unsafe-eval' data: https: wss:;"],
      'X-Content-Type-Options': ['nosniff'],
      'X-Frame-Options': ['SAMEORIGIN'],
      'X-XSS-Protection': ['1; mode=block'],
      'Referrer-Policy': ['strict-origin-when-cross-origin'],
      'Permissions-Policy': ['camera=(), microphone=(), geolocation=()']
    };
    
    callback({ responseHeaders });
  });
  
  // Создаем главное окно
  createWindow();
  
  // Для macOS: создаем окно при активации приложения, если его нет
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Выход из приложения, когда все окна закрыты (кроме на macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Обработка ошибок при запуске
app.on('render-process-gone', (event, webContents, details) => {
  log.error('Render process gone:', details);
});

app.on('child-process-gone', (event, details) => {
  log.error('Child process gone:', details);
});

// Экспортируем mainWindow для использования в других модулях
module.exports = { mainWindow, app };
