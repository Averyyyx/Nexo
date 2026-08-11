const { app, powerMonitor, powerSaveBlocker, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const path = require('path');

// Инициализация фоновых задач
function initBackgroundTasks(mainWindow) {
  // Отслеживание состояния питания
  powerMonitor.on('suspend', () => {
    log.info('Система переходит в спящий режим');
    if (mainWindow) {
      mainWindow.webContents.send('system-suspend');
    }
  });

  powerMonitor.on('resume', () => {
    log.info('Система возобновила работу');
    if (mainWindow) {
      mainWindow.webContents.send('system-resume');
      // Проверяем обновления при возобновлении работы
      autoUpdater.checkForUpdates().catch(err => {
        log.error('Ошибка при проверке обновлений после возобновления:', err);
      });
    }
  });

  powerMonitor.on('on-ac', () => {
    log.info('Питание от сети');
    if (mainWindow) {
      mainWindow.webContents.send('power-status', { isOnBattery: false });
    }
  });

  powerMonitor.on('on-battery', () => {
    log.info('Питание от батареи');
    if (mainWindow) {
      mainWindow.webContents.send('power-status', { isOnBattery: true });
    }
  });

  // Отслеживание состояния сети
  const updateOnlineStatus = () => {
    const isOnline = require('electron').net.isOnline();
    log.info(`Статус подключения к интернету: ${isOnline ? 'онлайн' : 'оффлайн'}`);
    
    if (mainWindow) {
      mainWindow.webContents.send('online-status-changed', isOnline);
      
      if (isOnline) {
        // При восстановлении соединения проверяем обновления
        autoUpdater.checkForUpdates().catch(err => {
          log.error('Ошибка при проверке обновлений при восстановлении соединения:', err);
        });
      }
    }
  };

  // Проверяем статус сети при запуске
  updateOnlineStatus();
  
  // Подписываемся на изменения состояния сети
  require('electron').app.on('browser-window-created', (_, window) => {
    window.webContents.on('did-finish-load', () => {
      updateOnlineStatus();
    });
  });

  // Мониторинг использования ресурсов
  setInterval(() => {
    if (!mainWindow) return;
    
    const { cpuUsage, getHeapStatistics } = process;
    const memoryUsage = process.memoryUsage();
    const heapStats = getHeapStatistics();
    
    const stats = {
      cpu: cpuUsage(),
      memory: {
        rss: memoryUsage.rss,
        heapTotal: memoryUsage.heapTotal,
        heapUsed: memoryUsage.heapUsed,
        external: memoryUsage.external,
        arrayBuffers: memoryUsage.arrayBuffers,
        heapStats: {
          totalHeapSize: heapStats.total_heap_size,
          usedHeapSize: heapStats.used_heap_size,
          heapSizeLimit: heapStats.heap_size_limit,
          totalAvailableSize: heapStats.total_available_size,
          totalPhysicalSize: heapStats.total_physical_size,
          totalGlobalHandlesSize: heapStats.total_global_handles_size,
          usedGlobalHandlesSize: heapStats.used_global_handles_size,
          mallocedMemory: heapStats.malloced_memory,
          peakMallocedMemory: heapStats.peak_malloced_memory
        }
      },
      uptime: process.uptime(),
      platform: process.platform,
      arch: process.arch,
      version: process.versions,
      isPackaged: app.isPackaged,
      isDev: !app.isPackaged,
      isMainFrame: mainWindow.webContents.isMainFrame
    };
    
    mainWindow.webContents.send('resource-usage', stats);
  }, 10000); // Каждые 10 секунд

  // Автоматическое обновление статуса "Не беспокоить"
  let dndTimeout;
  
  const updateDNDStatus = () => {
    const now = new Date();
    const hours = now.getHours();
    const isNight = hours < 8 || hours >= 23; // С 23:00 до 8:00 - ночь
    
    if (isNight) {
      mainWindow.webContents.send('set-dnd', { 
        enabled: true, 
        reason: 'Ночное время',
        until: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8, 0, 0)
      });
    } else if (dndTimeout) {
      clearTimeout(dndTimeout);
      dndTimeout = null;
      mainWindow.webContents.send('set-dnd', { enabled: false });
    }
    
    // Устанавливаем таймер на следующую проверку
    const nextCheck = isNight 
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8, 0, 0) - now
      : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 0, 0) - now;
    
    dndTimeout = setTimeout(updateDNDStatus, nextCheck);
  };
  
  // Запускаем проверку статуса "Не беспокоить"
  updateDNDStatus();
  
  // Очистка временных файлов
  const cleanupTempFiles = () => {
    const tempDir = app.getPath('temp');
    const vencordTempDir = path.join(tempDir, 'vencord-cache');
    
    const fs = require('fs');
    const path = require('path');
    
    const deleteFolderRecursive = (folderPath) => {
      if (fs.existsSync(folderPath)) {
        fs.readdirSync(folderPath).forEach((file) => {
          const curPath = path.join(folderPath, file);
          if (fs.lstatSync(curPath).isDirectory()) {
            deleteFolderRecursive(curPath);
          } else {
            try {
              fs.unlinkSync(curPath);
            } catch (err) {
              log.error(`Ошибка при удалении файла ${curPath}:`, err);
            }
          }
        });
        
        try {
          fs.rmdirSync(folderPath);
        } catch (err) {
          log.error(`Ошибка при удалении папки ${folderPath}:`, err);
        }
      }
    };
    
    // Удаляем временные файлы старше 7 дней
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 дней в миллисекундах
    
    if (fs.existsSync(vencordTempDir)) {
      fs.readdirSync(vencordTempDir).forEach((file) => {
        const filePath = path.join(vencordTempDir, file);
        const stat = fs.statSync(filePath);
        
        if (Date.now() - stat.mtimeMs > maxAge) {
          if (stat.isDirectory()) {
            deleteFolderRecursive(filePath);
          } else {
            try {
              fs.unlinkSync(filePath);
            } catch (err) {
              log.error(`Ошибка при удалении временного файла ${filePath}:`, err);
            }
          }
        }
      });
    }
  };
  
  // Очищаем временные файлы при запуске и затем каждые 24 часа
  cleanupTempFiles();
  setInterval(cleanupTempFiles, 24 * 60 * 60 * 1000);
  
  // Обработка глубоких ссылок (vencord://)
  app.on('open-url', (event, url) => {
    event.preventDefault();
    log.info('Получена глубокая ссылка:', url);
    
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      
      mainWindow.show();
      mainWindow.focus();
      
      // Отправляем URL в рендерер для обработки
      mainWindow.webContents.send('deep-link', url);
    }
  });
  
  // Обработка второго экземпляра приложения
  const gotTheLock = app.requestSingleInstanceLock();
  
  if (!gotTheLock) {
    log.info('Другой экземпляр приложения уже запущен, завершаем...');
    app.quit();
    return;
  }
  
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    log.info('Попытка запуска второго экземпляра приложения');
    
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      
      mainWindow.show();
      mainWindow.focus();
      
      // Обработка аргументов командной строки (например, deep links)
      if (process.platform === 'win32' && process.argv.length >= 2) {
        const url = process.argv[1];
        if (url && url.startsWith('vencord://')) {
          mainWindow.webContents.send('deep-link', url);
        }
      }
    }
  });
  
  // Обработка закрытия приложения
  app.on('before-quit', (event) => {
    log.info('Завершение работы приложения...');
    
    // Отправляем уведомление в рендерер о завершении работы
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app-will-quit');
    }
  });
  
  // Мониторинг состояния окна
  mainWindow.on('minimize', (event) => {
    log.info('Окно свернуто');
    // Можно добавить логику для сворачивания в трей
  });
  
  mainWindow.on('restore', () => {
    log.info('Окно восстановлено');
  });
  
  mainWindow.on('focus', () => {
    log.info('Окно получило фокус');
    mainWindow.webContents.send('window-focus', true);
  });
  
  mainWindow.on('blur', () => {
    log.info('Окно потеряло фокус');
    mainWindow.webContents.send('window-focus', false);
  });
}

module.exports = {
  initBackgroundTasks
};
