// The configurator's bridge to the app: read and change the app's own
// settings, and a few one-shot actions. Sandboxed, so CommonJS; nothing else
// of Electron or Node reaches the page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lobbyApp', {
  get: () => ipcRenderer.invoke('configure:get'),
  set: (patch) => ipcRenderer.invoke('configure:set', patch),
  chooseMonitor: () => ipcRenderer.send('configure:choose-monitor'),
  reloadScreen: () => ipcRenderer.send('configure:reload-screen'),
  reloadSettings: () => ipcRenderer.send('configure:reload-settings'),
  openLog: () => ipcRenderer.send('configure:open-log'),
  cancelShutdown: () => ipcRenderer.send('configure:cancel-shutdown'),
  onState: (fn) => ipcRenderer.on('configure:state', (_e, state) => fn(state)),
});
