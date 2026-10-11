// The setup wizard's whole bridge (static/setup.html): read what this
// computer is, list its printers, sign in with the passphrase, show monitor
// numbers, save, close. Sandboxed, so CommonJS; nothing else of Electron or
// Node reaches the page, and main.js answers only this window.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kvbcSetup', {
  state: () => ipcRenderer.invoke('setup:state'),
  printers: () => ipcRenderer.invoke('setup:printers'),
  signIn: (passphrase) => ipcRenderer.invoke('setup:sign-in', passphrase),
  identify: () => ipcRenderer.invoke('setup:identify'),
  finish: (choices) => ipcRenderer.invoke('setup:finish', choices),
  close: () => ipcRenderer.send('setup:close'),
});
