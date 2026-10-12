'use strict';
// Diagnostics and the error handler.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const lazy = require('./lazy');
const fs    = require('fs');
const $config = lazy('./config');
const $clubbers = lazy('./clubbers');
const $labelRender = lazy('./label-render');
const $printing = lazy('./printing');
const $http = lazy('./http');
const app = $http.app;

// ── Diagnostics ──────────────────────────────────────────────────────────────
app.get('/diagnostics', async (req, res) => {
  const results = [];

  // 1. Server running
  results.push({ test: 'Server running', passed: true, detail: `v${$config.SERVER_VERSION}, uptime ${Math.round(process.uptime())}s` });

  // 2. Printer detected
  if ($config.CUPS_BACKEND) {
    const rows = await $printing.cupsPrinterRows();
    const target = $config.PRINTER_NAME || (rows || []).find((p) => p.Default)?.Name || '(none)';
    const found = !!rows && rows.some((p) => p.Name === ($config.PRINTER_NAME || '') || (!$config.PRINTER_NAME && p.Default));
    results.push({ test: 'Printer detected', passed: found, detail: rows ? target : 'CUPS did not answer (lpstat)' });
  } else if (process.platform === 'win32') {
    try {
      const raw = (await $printing.runPowerShell(['-Command', 'Get-Printer | Select-Object Name, Default | ConvertTo-Json -Compress'], { timeout: 8000 })).trim();
      let parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) parsed = [parsed];
      const target = $config.PRINTER_NAME || parsed.find(p => p.Default)?.Name || '(none)';
      const found = parsed.some(p => p.Name === ($config.PRINTER_NAME || '') || (!$config.PRINTER_NAME && p.Default));
      results.push({ test: 'Printer detected', passed: found, detail: target });
    } catch (e) {
      results.push({ test: 'Printer detected', passed: false, detail: e.message });
    }
  } else {
    results.push({ test: 'Printer detected', passed: false, detail: 'Not on Windows' });
  }

  // 3. CSV loaded
  const csvPath = $config.CSV_FILE;
  const csvExists = fs.existsSync(csvPath);
  const csvCount = csvExists ? $clubbers.parseCSV(fs.readFileSync(csvPath, 'utf8')).length : 0;
  results.push({ test: 'CSV loaded', passed: csvExists && csvCount > 0, detail: csvExists ? `${csvCount} clubbers` : 'File not found' });

  // 4. Can render test label
  try {
    const testResult = await $labelRender.generateLabel({ firstName: 'Test', lastName: 'Child', clubName: '' });
    fs.unlink(testResult.pngPath, () => {});
    results.push({ test: 'Label rendering', passed: true, detail: `${testResult.buffer.length} bytes` });
  } catch (e) {
    results.push({ test: 'Label rendering', passed: false, detail: e.message });
  }

  res.json(results);
});

// ── Error handling middleware ─────────────────────────────────────────────────
// Registered after all routes. Malformed JSON bodies used to surface as the
// default Express HTML stack trace; return clean JSON the clients can parse.
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) {
    return res.status(400).json({ error: 'Invalid or oversized JSON body' });
  }
  console.error('[http] Unhandled route error:', err && err.message);
  if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
});
