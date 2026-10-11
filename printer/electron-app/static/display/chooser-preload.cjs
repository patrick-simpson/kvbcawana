// The monitor chooser's only bridge: which card was clicked. Sandboxed, so
// CommonJS; it exposes two calls and nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chooser', {
  choose: () => ipcRenderer.send('chooser:choose'),
  cancel: () => ipcRenderer.send('chooser:cancel'),
});
