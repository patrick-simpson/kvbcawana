// Deterministic frame capture: node capture.js <html> <outDir> <frames> [only=frame,frame]
// Sets the scene's time by calling window.render(frame/30) and screenshots the canvas.
const path = require('path'), fs = require('fs');
const { chromium } = require('C:/Users/User/Documents/GitHub/kvbcawana/lobby/node_modules/@playwright/test');
(async () => {
  const [html, out, n, only] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', args: ['--allow-file-access-from-files'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('console', m => console.log('page:', m.text()));
  page.on('pageerror', e => console.log('pageerror:', e.message));
  await page.goto('file:///' + path.resolve(html).replace(/\\/g, '/'));
  await page.waitForFunction('window.READY === true', null, { timeout: 30000 });
  const frames = only ? only.split(',').map(Number) : [...Array(+n).keys()];
  const cv = await page.$('canvas');
  for (const f of frames) {
    await page.evaluate(t => window.render(t), f / 30);
    await cv.screenshot({ path: path.join(out, `f${String(f).padStart(4, '0')}.png`) });
  }
  await browser.close();
})();
