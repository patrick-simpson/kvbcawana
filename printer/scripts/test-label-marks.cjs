#!/usr/bin/env node
// Icon-zone precedence on the label (owner decision 2026-10-12):
//   known club (Puggles, Cubbies, Sparks, T&T, Trek, Journey) -> the brand
//     kit's official one-colour mark, even when TwoTimTwo's club image is
//     supplied (its small colour pictures print distorted and dark in 1 bit);
//   unknown club -> the supplied image;
//   kit mark missing -> the supplied image, else the letter monogram.
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
const { createCanvas } = require(path.join(__dirname, '..', 'print-server', 'node_modules', '@napi-rs', 'canvas'));

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
