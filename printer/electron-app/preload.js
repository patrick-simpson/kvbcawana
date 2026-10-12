const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('awana', {
  getPrinters:        ()       => ipcRenderer.invoke('get-printers'),
  getConfig:          ()       => ipcRenderer.invoke('get-config'),
  saveConfig:         (config) => ipcRenderer.invoke('save-config', config),
  openCheckinPage:    (url)    => ipcRenderer.invoke('open-checkin-page', url),
  getServerState:     ()       => ipcRenderer.invoke('get-server-state'),
  openSettings:       ()       => ipcRenderer.invoke('open-settings'),
  installUpdate:      ()       => ipcRenderer.invoke('install-update'),
  startServer:        ()       => ipcRenderer.invoke('start-server'),
  checkForUpdates:    ()       => ipcRenderer.invoke('check-for-updates')
});
