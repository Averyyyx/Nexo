const { Menu, app, shell, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

// Шаблон для меню приложения
function createMenu(mainWindow) {
  const isMac = process.platform === 'darwin';
  const isDev = process.env.NODE_ENV === 'development';

  const template = [
    // Меню приложения (только для macOS)
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { label: 'О приложении', role: 'about' },
        { type: 'separator' },
        { 
          label: 'Настройки',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow.webContents.send('open-settings')
        },
        { type: 'separator' },
        { label: 'Скрыть', role: 'hide' },
        { label: 'Скрыть остальные', role: 'hideOthers' },
        { label: 'Показать все', role: 'unhide' },
        { type: 'separator' },
        { 
          label: 'Выход', 
          click: () => app.quit(),
          accelerator: 'Cmd+Q'
        }
      ]
    }] : []),
    
    // Меню "Файл"
    {
      label: 'Файл',
      submenu: [
        {
          label: 'Создать сервер',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow.webContents.send('create-server')
        },
        {
          label: 'Присоединиться к серверу',
          accelerator: 'CmdOrCtrl+J',
          click: () => mainWindow.webContents.send('join-server')
        },
        { type: 'separator' },
        {
          label: 'Настройки',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow.webContents.send('open-settings')
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    
    // Меню "Правка"
    {
      label: 'Правка',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' }
      ]
    },
    
    // Меню "Вид"
    {
      label: 'Вид',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    
    // Меню "Голос и видео"
    {
      label: 'Голос и видео',
      submenu: [
        {
          label: 'Настройки микрофона',
          click: () => mainWindow.webContents.send('open-voice-settings')
        },
        {
          label: 'Настройки наушников',
          click: () => mainWindow.webContents.send('open-audio-settings')
        },
        { type: 'separator' },
        {
          label: 'Включить/выключить микрофон',
          accelerator: 'CmdOrCtrl+Shift+M',
          click: () => mainWindow.webContents.send('toggle-mute')
        },
        {
          label: 'Включить/выключить звук',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => mainWindow.webContents.send('toggle-deafen')
        },
        {
          label: 'Начать/остановить демонстрацию экрана',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow.webContents.send('toggle-screenshare')
        }
      ]
    },
    
    // Меню "Окно"
    {
      label: 'Окно',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' }
        ] : [
          { role: 'close' }
        ])
      ]
    },
    
    // Меню "Помощь"
    {
      role: 'help',
      submenu: [
        {
          label: 'Документация',
          click: async () => {
            await shell.openExternal('https://docs.vencord.com');
          }
        },
        {
          label: 'Сообщество',
          click: async () => {
            await shell.openExternal('https://community.vencord.com');
          }
        },
        {
          label: 'Сообщить об ошибке',
          click: async () => {
            await shell.openExternal('https://github.com/vencord/vencord/issues');
          }
        },
        { type: 'separator' },
        {
          label: 'Проверить обновления',
          click: async () => {
            try {
              await autoUpdater.checkForUpdatesAndNotify();
            } catch (error) {
              dialog.showErrorBox('Ошибка обновления', 'Не удалось проверить обновления. Пожалуйста, попробуйте позже.');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'О Vencord',
          click: () => {
            dialog.showMessageBox({
              title: 'О Vencord',
              message: `Vencord v${app.getVersion()}`,
              detail: 'Клиент для общения с открытым исходным кодом\n© 2023 Vencord Team',
              buttons: ['OK']
            });
          }
        }
      ]
    }
  ];

  // Добавляем отладочные пункты меню в режиме разработки
  if (isDev) {
    template.push({
      label: 'Разработка',
      submenu: [
        {
          label: 'Перезагрузить',
          accelerator: 'F5',
          click: () => mainWindow.reload()
        },
        {
          label: 'Открыть DevTools',
          accelerator: 'F12',
          click: () => mainWindow.webContents.openDevTools()
        },
        {
          label: 'Информация о приложении',
          click: () => {
            dialog.showMessageBox({
              title: 'Информация о приложении',
              message: `Версия: ${app.getVersion()}\n` +
                      `Electron: ${process.versions.electron}\n` +
                      `Node.js: ${process.versions.node}\n` +
                      `Платформа: ${process.platform} ${process.arch}`,
              buttons: ['OK']
            });
          }
        },
        {
          label: 'Показать папку с данными',
          click: () => {
            shell.openPath(app.getPath('userData'));
          }
        }
      ]
    });
  }

  return Menu.buildFromTemplate(template);
}

module.exports = { createMenu };
