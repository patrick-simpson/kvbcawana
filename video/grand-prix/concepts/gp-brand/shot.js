// node shot.js <html-file> <out.png> <w> <h> [scale]  -- deterministic still capture in Chrome
const { chromium } = require('C:/Users/User/Documents/GitHub/kvbcawana/lobby/node_modules/@playwright/test');
const path = require('path');
(async () => {
  const [file, out, w, h, sc] = process.argv.slice(2);
  const b = await chromium.launch({ channel: 'chrome' });
  const pg = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +(sc || 1) });
  await pg.goto(require('url').pathToFileURL(path.resolve(file)).href + (process.argv[7] || ''));
  await pg.evaluate(() => document.fonts.ready);
  await pg.waitForFunction(() => window.READY !== false, null, { timeout: 60000 });
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: out, omitBackground: true });
  await b.close();
})();
