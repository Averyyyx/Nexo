const { autoUpdater } = require('electron-updater');
const { dialog, app } = require('electron');
const log = require('electron-log');

// Настройка логирования
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';

// Отключаем автоматическую загрузку обновлений
autoUpdater.autoDownload = false;

// Функция для инициализации автообновления
function initAutoUpdater(mainWindow) {
  // Проверяем наличие обновлений при запуске
  autoUpdater.checkForUpdates().catch(err => {
    log.error('Ошибка при проверке обновлений:', err);
  });

  // События автообновления
  autoUpdater.on('checking-for-update', () => {
    log.info('Проверка обновлений...');
    if (mainWindow) {
      mainWindow.webContents.send('update-status', 'checking');
    }
  });

  autoUpdater.on('update-available', (info) => {
    log.info('Доступно обновление:', info.version);
    
    // Показываем диалоговое окно с предложением обновления
    dialog.showMessageBox({
      type: 'info',
      title: 'Доступно обновление',
      message: `Доступна новая версия Vencord ${info.version}. Хотите загрузить и установить её сейчас?`,
      buttons: ['Да', 'Позже'],
      defaultId: 0,
      cancelId: 1
    }).then(({ response }) => {
      if (response === 0) {
        // Пользователь нажал "Да" - начинаем загрузку обновления
        autoUpdater.downloadUpdate();
      }
    });
    
    if (mainWindow) {
      mainWindow.webContents.send('update-available', info);
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    log.info('Обновлений не найдено');
    if (mainWindow) {
      mainWindow.webContents.send('update-not-available', info);
    }
  });

  autoUpdater.on('download-progress', (progressObj) => {
    let logMessage = `Скорость загрузки: ${Math.round(progressObj.bytesPerSecond / 1024)} КБ/с`;
    logMessage += ` - ${progressObj.percent.toFixed(2)}%`;
    logMessage += ` (${Math.round(progressObj.transferred / 1024)}/${Math.round(progressObj.total / 1024)} КБ)`;
    log.info(logMessage);
    
    if (mainWindow) {
      mainWindow.webContents.send('download-progress', progressObj);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info('Обновление загружено, готово к установке');
    
    // Показываем диалоговое окно с предложением перезапустить приложение
    dialog.showMessageBox({
      type: 'info',
      title: 'Обновление загружено',
      message: 'Обновление загружено. Перезапустить приложение для установки обновления?',
      buttons: ['Перезапустить', 'Позже'],
      defaultId: 0,
      cancelId: 1
    }).then(({ response }) => {
      if (response === 0) {
        // Пользователь нажал "Перезапустить" - перезапускаем приложение
        setImmediate(() => autoUpdater.quitAndInstall());
      }
    });
    
    if (mainWindow) {
      mainWindow.webContents.send('update-downloaded', info);
    }
  });

  autoUpdater.on('error', (err) => {
    log.error('Ошибка при обновлении:', err);
    
    // Показываем сообщение об ошибке
    dialog.showErrorBox(
      'Ошибка обновления',
      'Не удалось проверить наличие обновлений. Пожалуйста, проверьте подключение к интернету и попробуйте снова.'
    );
    
    if (mainWindow) {
      mainWindow.webContents.send('update-error', err);
    }
  });
  
  // Проверка обновлений каждые 6 часов
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(err => {
      log.error('Ошибка при проверке обновлений (по расписанию):', err);
    });
  }, 6 * 60 * 60 * 1000);
}

// Функция для ручной проверки обновлений
function checkForUpdates(showDialog = false) {
  return new Promise((resolve, reject) => {
    autoUpdater.once('update-available', (info) => {
      resolve({ updateAvailable: true, info });
    });
    
    autoUpdater.once('update-not-available', (info) => {
      if (showDialog) {
        dialog.showMessageBox({
          title: 'Обновления не найдены',
          message: 'У вас установлена последняя версия Vencord.',
          buttons: ['OK']
        });
      }
      resolve({ updateAvailable: false, info });
    });
    
    autoUpdater.once('error', (err) => {
      log.error('Ошибка при проверке обновлений:', err);
      
      if (showDialog) {
        dialog.showErrorBox(
          'Ошибка обновления',
          'Не удалось проверить наличие обновлений. Пожалуйста, проверьте подключение к интернету и попробуйте снова.'
        );
      }
      
      reject(err);
    });
    
    autoUpdater.checkForUpdates().catch(reject);
  });
}

module.exports = {
  initAutoUpdater,
  checkForUpdates
};
