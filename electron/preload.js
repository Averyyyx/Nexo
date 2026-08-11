const { contextBridge, ipcRenderer } = require('electron');

// Предоставляем безопасные API для рендерер-процесса
contextBridge.exposeInMainWorld('electronAPI', {
  // Получение информации о платформе
  getPlatform: () => process.platform,
  
  // Управление окном
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  unmaximize: () => ipcRenderer.send('window-unmaximize'),
  close: () => ipcRenderer.send('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  
  // Настройки приложения
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // Уведомления
  showNotification: (title, body) => {
    ipcRenderer.send('show-notification', { title, body });
  },
  
  // Обработка глубоких ссылок
  onDeepLink: (callback) => {
    ipcRenderer.on('handle-protocol-url', (_, url) => callback(url));
  },
  
  // Системные функции
  openExternal: (url) => ipcRenderer.send('open-external', url),
  
  // Сохранение и загрузка данных
  getStoreValue: (key, defaultValue) => 
    ipcRenderer.invoke('store-get', key, defaultValue),
  setStoreValue: (key, value) => 
    ipcRenderer.invoke('store-set', key, value),
  
  // Управление медиа
  getMediaSources: () => ipcRenderer.invoke('get-media-sources'),
  
  // Обновления приложения
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateAvailable: (callback) => {
    ipcRenderer.on('update-available', (_, info) => callback(info));
  },
  onUpdateDownloaded: (callback) => {
    ipcRenderer.on('update-downloaded', (_, info) => callback(info));
  },
  
  // Глобальные горячие клавиши
  registerGlobalShortcut: (accelerator) => 
    ipcRenderer.invoke('register-global-shortcut', accelerator),
  unregisterGlobalShortcut: (accelerator) => 
    ipcRenderer.invoke('unregister-global-shortcut', accelerator),
  
  // Меню приложения
  showAppMenu: () => ipcRenderer.send('show-app-menu'),
  
  // Доступ к файловой системе (ограниченный)
  showOpenDialog: (options) => 
    ipcRenderer.invoke('show-open-dialog', options),
  showSaveDialog: (options) => 
    ipcRenderer.invoke('show-save-dialog', options),
  
  // Системная информация
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  
  // Управление питанием
  preventSleep: () => ipcRenderer.send('prevent-sleep'),
  allowSleep: () => ipcRenderer.send('allow-sleep'),
  
  // Отладка
  openDevTools: () => ipcRenderer.send('open-dev-tools')
});

// Обработка ошибок
window.addEventListener('error', (error) => {
  ipcRenderer.send('renderer-error', {
    message: error.message,
    source: error.filename,
    lineno: error.lineno,
    colno: error.colno,
    stack: error.error?.stack
  });
});

// Перехват консольных сообщений для отправки в основной процесс
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info,
  debug: console.debug
};

['log', 'error', 'warn', 'info', 'debug'].forEach((method) => {
  console[method] = (...args) => {
    originalConsole[method](...args);
    ipcRenderer.send('console', { method, args: args.map(arg => 
      typeof arg === 'object' && arg !== null ? 
      (arg.stack ? `${arg.message}\n${arg.stack}` : JSON.stringify(arg)) : 
      String(arg)
    )});
  };
});
