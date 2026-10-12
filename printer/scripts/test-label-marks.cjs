#!/usr/bin/env node
// Icon-zone precedence on the label (owner decision 2026-10-12):
//   known club (Puggles, Cubbies, Sparks, T&T, Trek, Journey) -> the brand
//     kit's official one-colour mark, even when TwoTimTwo's club image is
//     supplied (its small colour pictures print distorted and dark in 1 bit);
//   unknown club -> the supplied image;
//   kit mark missing -> the supplied image, else the letter monogram;
//   orientation (owner 2026-10-12): the mark prints SIDEWAYS (brand.MARK_ROTATE)
//     for Puggles, Cubbies, Sparks, Trek, Journey, upright for T&T; image and
//     monogram fallbacks always upright.
// Rendering is byte-deterministic, so "which art was drawn" is a byte compare
// against the same label rendered with only that art available.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-marks-'));
fs.writeFileSync(path.join(dataDir, 'clubbers.csv'),
  'FirstName,LastName,Birthdate,Allergies,HandbookGroup,MedRelease\nTestkid,Sample,2018-03-15,,Cubbies A,y\n');
process.env.AWANA_DATA_DIR = dataDir;

const server = require(path.join(__dirname, '..', 'print-server', 'server.js'));
const brand = require(path.join(__dirname, '..', 'print-server', 'brand.js'));
const { createCanvas, loadImage } = require(path.join(__dirname, '..', 'print-server', 'node_modules', '@napi-rs', 'canvas'));

let passed = 0;
const failures = [];
const check = (name, cond) => { if (cond) passed++; else { failures.push(name); console.error('  x ' + name); } };

// A big solid picture: unmistakable if drawn, large enough to pass the "too
// small for the icon zone" rule.
const picture = (() => {
  const c = createCanvas(400, 400);
  const x = c.getContext('2d');
  x.fillStyle = '#c0102a'; x.fillRect(40, 40, 320, 320);
  x.fillStyle = '#ffffff'; x.fillRect(160, 160, 80, 80);
  return c.toBuffer('image/png');
})();

const KIT_DIR = brand.DEFAULT_BRAND_DIR;
const noMarksKit = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-marks-kit-'));
fs.cpSync(path.join(KIT_DIR, 'fonts'), path.join(noMarksKit, 'fonts'), { recursive: true });

const render = async (clubName, clubImageBuffer, more = {}) =>
  (await server.generateLabel({ firstName: 'Testkid', lastName: 'Sample', clubName, clubImageBuffer, ...more })).buffer;
// Ink bounding box inside the icon panel (left 340 px, clear of the wave line).
const inkBox = async (buf) => {
  const img = await loadImage(buf);
  const c = createCanvas(340, img.height), x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, 340, img.height).data;
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let py = 0; py < img.height; py++) for (let px = 0; px < 340; px++) {
    const i = (py * 340 + px) * 4;
    if (d[i] < 80 && d[i + 1] < 80 && d[i + 2] < 80) { if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; }
  }
  return { w: x1 - x0 + 1, h: y1 - y0 + 1 };
};
const wideSolid = (() => {
  const c = createCanvas(400, 200);
  const x = c.getContext('2d');
  x.fillStyle = '#000000'; x.fillRect(0, 0, 400, 200);
  return c.toBuffer('image/png');
})();
const same = (a, b) => Buffer.compare(a, b) === 0;

(async () => {
  for (const club of ['Puggles', 'Cubbies', 'Sparks', 'T&T', 'Trek', 'Journey']) {
    const withPic = await render(club, picture);
    const without = await render(club);
    check(`${club}: a supplied TwoTimTwo image is ignored, the kit mark is drawn`, same(withPic, without));
    brand.loadBrandKit(noMarksKit);
    const pictureOnly = await render(club, picture);
    const monogram = await render(club);
    brand.loadBrandKit(KIT_DIR);
    check(`${club}: kit mark missing -> the supplied image is drawn`, !same(pictureOnly, withPic) && !same(pictureOnly, monogram));
    check(`${club}: kit mark missing, no image -> the monogram, not the mark`, !same(monogram, without));
  }

  for (const club of ['Puggles', 'Cubbies', 'Sparks', 'Trek', 'Journey']) {
    const b = await inkBox(await render(club));
    check(`${club}: mark is sideways, taller than wide (${b.w}x${b.h})`, b.h > b.w);
    check(`${club}: sideways mark fills the panel height (${b.h}px)`, b.h >= 200);
  }
  const tnt = await inkBox(await render('T&T'));
  check(`T&T: mark stays upright, wider than tall (${tnt.w}x${tnt.h})`, tnt.w >= tnt.h);
  check('MARK_ROTATE is a per-club table: T&T off, the other five on',
    !brand.MARK_ROTATE['t&t'] && ['puggle', 'cubbie', 'spark', 'trek', 'journey'].every((k) => brand.MARK_ROTATE[k] === true));
  brand.loadBrandKit(noMarksKit);
  const fbWide = await inkBox(await render('Puggles', wideSolid));
  const fbUnknown = await inkBox(await render('Rookies', wideSolid));
  brand.loadBrandKit(KIT_DIR);
  check(`fallback supplied image stays upright for a rotating club (${fbWide.w}x${fbWide.h})`, fbWide.w > fbWide.h);
  check(`unknown club image stays upright (${fbUnknown.w}x${fbUnknown.h})`, fbUnknown.w > fbUnknown.h);

  const unknownPic = await render('Rookies', picture);
  const unknownNone = await render('Rookies');
  check('unknown club + image: the image is drawn', !same(unknownPic, unknownNone));
  check('unknown club + image is not a known club\'s kit-mark label', !same(unknownPic, await render('Puggles', picture)));

  const inv = { isVisitor: true, extras: { inverted: true } };
  check('inverted label: a known club still takes the kit mark over the image',
    same(await render('Sparks', picture, inv), await render('Sparks', undefined, inv)));

  console.log(`${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
