// The flat 2D cards for the Grand Prix promo, laid out in HTML with the
// brand kit's own fonts and colours, screenshotted by Chrome as 1920x1080
// PNGs (transparent where nothing is drawn). grand_prix.py runs this for you;
// by hand:  node cards.mjs [outDir]
//
// The words are final (owner, 2026-10-29). Do not add any others.
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const { chromium } = require(path.join(REPO, 'lobby', 'node_modules', '@playwright', 'test'));
const BRAND = path.join(REPO, 'shared', 'brand');
const OUT = path.resolve(process.argv[2] || path.join(HERE, 'output', 'cards'));
fs.mkdirSync(OUT, { recursive: true });

const tok = JSON.parse(fs.readFileSync(path.join(BRAND, 'tokens.json'), 'utf8'));
const H = tok.house;
const url = (p) => pathToFileURL(path.join(BRAND, p)).href;
const svgInner = (p) => fs.readFileSync(path.join(BRAND, p), 'utf8');

const BASE = `
@font-face { font-family: 'Paytone One'; src: url('${url('fonts/PaytoneOne-Regular.ttf')}'); }
@font-face { font-family: 'Londrina Solid'; font-weight: 900; src: url('${url('fonts/LondrinaSolid-Black.ttf')}'); }
@font-face { font-family: 'Figtree'; font-weight: 300 900; src: url('${url('fonts/Figtree-Variable.ttf')}'); }
html, body { margin: 0; width: 1920px; height: 1080px; background: transparent; overflow: hidden; }
* { box-sizing: border-box; }
.plate { position: absolute; left: 128px; color: #fff; }
.shout { font-family: 'Paytone One'; font-size: 76px; line-height: 1.1; letter-spacing: 0.005em;
         background: ${H.blue}; padding: 26px 46px 30px; box-shadow: 10px 10px 0 ${H.ink}; border-radius: 18px; }
.read  { font-family: 'Figtree'; font-weight: 700; font-size: 42px; line-height: 1.2; color: ${H.ink};
         background: #fff; padding: 20px 36px 22px; box-shadow: 8px 8px 0 ${H.ink}; border-radius: 14px; }
`;

const cards = {
  // beat 1: lower third
  card1: `<div class="plate shout" style="bottom:120px">The Awana Grand Prix is back.</div>`,
  // beat 2: headline, then (a separate layer, a beat later) the read line under it
  card2a: `<div class="plate shout" style="bottom:214px">This year, grown-ups race too.</div>`,
  card2b: `<div class="plate read" style="bottom:110px;left:158px">Kids race first. Then Trek, Journey and adults race together.</div>`,
  // end card, background layer: the lobby's sky field with the kit's waves
  end_bg: `
    <div style="position:absolute;inset:0;background:${H.sky}"></div>
    <div style="position:absolute;left:-40px;right:-40px;bottom:-6px;height:330px;color:${H.cloud}">
      ${svgInner('shapes/wave-cubbies.svg').replace('<svg ', '<svg preserveAspectRatio="none" style="width:100%;height:100%;transform:scaleX(-1)" ')}
    </div>
    <div style="position:absolute;left:-40px;right:-40px;bottom:-6px;height:210px;color:${H.blue}">
      ${svgInner('shapes/wave-trek.svg').replace('<svg ', '<svg preserveAspectRatio="none" style="width:100%;height:100%" ')}
    </div>`,
  // end card, words + logo (transparent)
  end_text: `
    <style>
      .col { position:absolute; left:0; right:0; top:92px; display:flex; flex-direction:column; align-items:center; }
      .logo { width:470px; height:auto; color:${H.ink}; margin-bottom:46px; }
      .title { font-family:'Paytone One'; font-size:150px; line-height:1; color:${H.ink};
               text-shadow: 8px 8px 0 #fff; margin:0 0 34px; letter-spacing:0.01em; }
      .chip { font-family:'Londrina Solid'; font-weight:900; font-size:62px; line-height:1; color:#fff;
              background:${H.hot}; padding:14px 38px 16px; border-radius:16px; box-shadow:8px 8px 0 ${H.ink};
              margin-bottom:52px; letter-spacing:0.01em; }
      .dates { font-family:'Figtree'; font-size:50px; line-height:1.36; color:${H.ink}; text-align:center; font-weight:600; }
      .dates b { font-weight:800; }
    </style>
    <div class="col">
      <img class="logo" src="${url('logos/kvbc-awana-two-line-ink.svg')}">
      <div class="title">AWANA GRAND PRIX</div>
      <div class="chip">Kids, Trek, Journey &amp; Adults</div>
      <div class="dates">
        <div><b>Register by Sunday, Feb 28</b></div>
        <div><b>Build day:</b> Saturday, March 6 · 2:00 pm</div>
        <div><b>Race day:</b> Saturday, March 20 · 2:00 pm</div>
      </div>
    </div>`,
};

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
for (const [name, body] of Object.entries(cards)) {
  // a real file:// page, so the brand kit's file:// fonts and logo may load
  const html = path.join(OUT, `_${name}.html`);
  fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>${BASE}</style><body>${body}</body>`);
  await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), omitBackground: true });
  fs.rmSync(html);
  console.log('card', name);
}
await browser.close();
