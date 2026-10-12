function checkServer() {
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  
  text.textContent = 'Connecting...';
  dot.className = 'dot';

  fetch('http://localhost:3456/health')
    .then(response => {
      if (response.ok) {
        dot.className = 'dot online';
        text.textContent = 'Server Online';
      } else {
        throw new Error();
      }
    })
    .catch(() => {
      dot.className = 'dot offline';
      text.textContent = 'Server Offline';
    });
}

document.getElementById('check-btn').addEventListener('click', checkServer);
// Every setting and tool lives on the one settings page.
document.getElementById('settings-btn').addEventListener('click', () => chrome.tabs.create({ url: 'https://awana.kvbchurch.org/settings' }));
// Check status immediately when popup opens
checkServer();
