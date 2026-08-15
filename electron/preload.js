const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexoAPI', {
  // Управление уведомлениями
  setNotificationCount: (count) => ipcRenderer.send('set-notification-count', count),
  
  // Управление окном
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  maximizeWindow: () => ipcRenderer.send('maximize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  
  // Системная информация
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // Слушатели событий
  onNotificationUpdate: (callback) => ipcRenderer.on('notification-updated', callback),
  
  // Удаление слушателей
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});