// The Cast windows' one bridge (11.0.0, owner 2026-11-09): Cast lives on its own site,
// https://cast.kvbchurch.org, and the lobby's sign-in does not cross origins, so the TV
// page (site/cast/screen/screen.js) and the Cast desk (site/cast/desk/desk.js, the
// back-of-house window, cast-desk.js) ask the app for this computer's own sign-in with
// window.awanaCastHost.session(). Exposed on Cast's own origin only; the main process
// checks the caller again (display.js castSession, screens.js castHostAllowed: the TV
// window only on /screen/, the desk window only on /desk/) and answers nothing to any
// other window, frame or page. Sandboxed, so CommonJS.
const { contextBridge, ipcRenderer } = require('electron');

if (window.location.origin === 'https://cast.kvbchurch.org') {
  contextBridge.exposeInMainWorld('awanaCastHost', {
    session: () => ipcRenderer.invoke('cast:session'),
    // A JPEG data URL snapshot of the Cast TV (the desk window only), or null.
    preview: () => ipcRenderer.invoke('cast:preview'),
    // 'mica' when the desk window has the Mica material, else ''.
    material: (process.argv.find((a) => a.startsWith('--awana-cast-material=')) || '').slice('--awana-cast-material='.length) === 'mica' ? 'mica' : '',
  });
}
