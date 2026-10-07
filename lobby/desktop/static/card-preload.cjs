// The shutdown card's only bridge: its Cancel, and word that the PC is going
// down now. Sandboxed, so CommonJS.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('card', {
  cancel: () => ipcRenderer.send('card:cancel'),
  onShuttingDown: (fn) => ipcRenderer.on('card:shutting-down', () => fn()),
});
