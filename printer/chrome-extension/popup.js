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
// Settings live on the one settings page (8.3.0); the dashboard on this computer
// is the fallback for a night with no internet.
document.getElementById('settings-btn').addEventListener('click', () => chrome.tabs.create({ url: 'https://awana.kvbchurch.org/settings' }));
document.getElementById('dashboard-btn').addEventListener('click', () => chrome.tabs.create({ url: 'http://localhost:3456/' }));
// Check status immediately when popup opens
checkServer();
