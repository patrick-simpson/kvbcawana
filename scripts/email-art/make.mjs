// Club email: the header picture of each look (owner 2026-11-14), drawn from the brand
// kit (shared/brand/: the club's plate colour, its catalog wave, its white mark, three
// doodles) and saved to site/tools/email/art/<name>.png, 1200 x 300 (shown 600 wide).
// The pictures are COMMITTED: an email can only show a picture that is a plain file on
// the site, and mail apps do not draw SVG. Run this by hand after the kit changes:
//
//   cd lobby && npm ci && npx playwright install chromium   (once; it has Playwright)
//   node ../scripts/email-art/make.mjs
//
// The looks themselves (colours, the rest of the email) are site/tools/email/mailhtml.js.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const KIT = path.join(ROOT, 'shared', 'brand');
const OUT = path.join(ROOT, 'site', 'tools', 'email', 'art');
const { chromium } = createRequire(path.join(process.cwd(), 'x.js'))('playwright');
const tokens = JSON.parse(fs.readFileSync(path.join(KIT, 'tokens.json'), 'utf8'));
const svg = (rel) => fs.readFileSync(path.join(KIT, rel), 'utf8').replace(/<\?xml[^>]*>/, '');

/** Each look: its file name, field, wave colour(s), doodle colour, mark and the mark's width in a 600 px header. */
const LOOKS = [
  { art: 'awana', field: tokens.house.blue, wave: tokens.house.sun, wave2: tokens.house.orange, doodle: '#FFFFFF', waveKit: 'cubbies', logo: 'kvbc-awana-two-line-white', logoW: 300 },
  ...[['puggles', 150], ['cubbies', 190], ['sparks', 178], ['tnt', 92], ['trek', 210], ['journey', 250]].map(([kit, logoW]) => {
    const c = tokens.clubs[kit];
    const same = c.plate.toLowerCase() === c.primary.toLowerCase();
    return { art: kit, field: c.plate, wave: same ? c.deep : c.primary, wave2: null, doodle: c.tint, waveKit: kit, logo: `${kit}-white`, logoW };
  }),
];

function headerHtml(look) {
  const wave = (kit, color, style) => `<div class="wave" style="color:${color};${style}">${svg(`shapes/wave-${kit}.svg`)}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; } html, body { margin: 0; }
    .h { position: relative; width: 600px; height: 150px; overflow: hidden; background: ${look.field}; }
    .wave { position: absolute; left: -6px; width: 640px; } .wave svg { display: block; width: 100%; height: auto; }
    .logo { position: absolute; left: 34px; top: 50%; translate: 0 -54%; width: ${look.logoW}px; } .logo svg { display: block; width: 100%; height: auto; }
    .d { position: absolute; color: ${look.doodle}; } .d svg { display: block; width: 100%; height: auto; overflow: visible; }
  </style></head><body><div class="h">
    ${look.wave2 ? wave('sparks', look.wave2, 'bottom:-246px;left:150px;') : ''}
    ${wave(look.waveKit, look.wave, look.wave2 ? 'bottom:-236px;left:60px;' : 'bottom:-214px;')}
    <div class="d" style="right:112px;top:20px;width:22px">${svg('doodles/sparkle-4pt.svg')}</div>
    <div class="d" style="right:66px;top:44px;width:13px">${svg('doodles/ring.svg')}</div>
    <div class="d" style="right:150px;top:54px;width:11px">${svg('doodles/dot.svg')}</div>
    <div class="logo">${svg(`logos/${look.logo}.svg`)}</div>
  </div></body></html>`;
}

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 600, height: 150 }, deviceScaleFactor: 2 });
for (const look of LOOKS) {
  await page.setContent(headerHtml(look));
  await page.screenshot({ path: path.join(OUT, `${look.art}.png`), clip: { x: 0, y: 0, width: 600, height: 150 } });
  console.log('drew', `${look.art}.png`);
}
await browser.close();
