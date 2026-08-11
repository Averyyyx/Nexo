const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');

let tray = null;

function createTray(mainWindow) {
  // Создаем иконку для трея
  const iconPath = path.join(__dirname, '../public/icons/tray.png');
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  
  // Создаем экземпляр Tray
  tray = new Tray(trayIcon);
  
  // Всплывающая подсказка
  tray.setToolTip('Vencord');
  
  // Контекстное меню для иконки в трее
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Открыть Vencord',
      click: () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) {
            mainWindow.restore();
          }
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Включить/выключить микрофон',
      accelerator: 'CmdOrCtrl+Shift+M',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.send('toggle-mute');
        }
      }
    },
    {
      label: 'Включить/выключить звук',
      accelerator: 'CmdOrCtrl+Shift+D',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.send('toggle-deafen');
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Выход',
      click: () => {
        app.quit();
      }
    }
  ]);
  
  // Устанавливаем контекстное меню
  tray.setContextMenu(contextMenu);
  
  // Обработчик клика по иконке в трее
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      } else if (!mainWindow.isVisible()) {
        mainWindow.show();
      } else {
        mainWindow.focus();
      }
    }
  });
  
  // Обработчик двойного клика
  tray.on('double-click', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      } else if (!mainWindow.isVisible()) {
        mainWindow.show();
      } else {
        mainWindow.focus();
      }
    }
  });
  
  return tray;
}

// Функция для обновления состояния иконки в трее
function updateTrayIcon(hasUnread, mentionCount) {
  if (!tray) return;
  
  const iconName = hasUnread 
    ? 'tray-unread.png' 
    : 'tray.png';
  
  const iconPath = path.join(__dirname, `../public/icons/${iconName}`);
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  
  tray.setImage(trayIcon);
  
  if (mentionCount > 0) {
    tray.setToolTip(`Vencord (${mentionCount} новых упоминаний)`);
  } else if (hasUnread) {
    tray.setToolTip('Vencord (новые сообщения)');
  } else {
    tray.setToolTip('Vencord');
  }
}

module.exports = {
  createTray,
  updateTrayIcon,
  getTray: () => tray
};
