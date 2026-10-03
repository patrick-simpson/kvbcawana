chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PRINT_LABEL') {
    fetch('http://localhost:3456/print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: message.payload.name,
        clubName: message.payload.clubName,
        clubImageData: message.payload.clubImageData
      }),
      // We don't use AbortSignal.timeout directly because it might not be supported in older Chrome backgrounds,
      // instead we rely on standard fetch or use a manual timeout.
    })
    .then(response => {
      sendResponse({ success: response.ok });
    })
    .catch(err => {
      console.error('[Awana Background] Print server unreachable:', err);
      sendResponse({ success: false, error: err.message });
    });
    return true; // Required to keep the message channel open for async fetch
  }
  // A new version is on disk (the app rewrote this folder when it updated):
  // re-read it now instead of waiting for someone to restart Chrome (7.4.1).
  // The page that asked reloads itself a moment later to get the new scripts.
  if (message.type === 'AWANA_RELOAD_SELF') {
    sendResponse({ ok: true });
    setTimeout(() => chrome.runtime.reload(), 100);
    return false;
  }
});
