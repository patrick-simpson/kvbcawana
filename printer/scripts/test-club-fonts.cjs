#!/usr/bin/env node
// Per-club label faces (owner decision 2026-10-12, from previews he approved):
//   Puggles, Cubbies -> Comic Neue (Bold: the first name and the bold lines;
//                       Regular: the last name and the other small lines);
//   Trek, Journey    -> Playfair Display (800 / 700 / 400, one variable font);
//   Sparks, T&T      -> unchanged: Paytone One, Londrina Solid, Figtree.
// Every line of the tag; the allergy, no-photo and other icon glyphs keep the
// emoji stack. A leader or one-off tag with a club follows that club; a label
// with none (custom, BARF tag and bag, a leader with no club) is stock.
//
// And the fail-open rules the stock faces already keep:
//   * a club face that is missing or damaged -> that club's whole label is the
//     stock label, byte for byte, and /health names the face;
//   * a word the club face cannot draw -> the stock voice, and a word neither
//     can draw -> the old Windows face (Comic Neue has no Ș, Vietnamese or
//     Cyrillic; Playfair Display no Greek).
// Font choice is read off the canvas (the font string and weight at every
// fillText), so it holds on any host; the byte compares are within one host.

'use strict';

let __suiteFinished = false;
process.on('exit', (code) => {
  if (code === 0 && !__suiteFinished) {
    console.error('✗ Test suite terminated before completing (crash swallowed?) — failing.');
    process.exitCode = 1;
  }
});

const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-club-fonts-'));
fs.writeFileSync(path.join(dataDir, 'clubbers.csv'), 'FirstName,LastName\nTestkid,Sample\n');
process.env.AWANA_DATA_DIR = dataDir;

const PS = path.join(__dirname, '..', 'print-server');
const server = require(path.join(PS, 'server.js'));
const brand = require(path.join(PS, 'brand.js'));
const leaders = require(path.join(PS, 'server', 'leaders.js'));
const { createCanvas } = require(path.join(PS, 'node_modules', '@napi-rs', 'canvas'));

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

// Every fillText's text, font string and weight, while `fn` renders.
const ctxProto = Object.getPrototypeOf(createCanvas(1, 1).getContext('2d'));
async function drawn(fn) {
  const calls = [];
  const orig = ctxProto.fillText;
  ctxProto.fillText = function record(text, ...rest) {
    calls.push({ text: String(text), font: this.font, wght: this.fontVariationSettings });
    return orig.call(this, text, ...rest);
  };
  let out;
  try { out = await fn(); } finally { ctxProto.fillText = orig; }
  if (out && out.pngPath) fs.unlink(out.pngPath, () => {});
  return { calls, buffer: out && out.buffer };
}
const label = (model) => drawn(() => server.generateLabel(model));
const callOf = (calls, text) => calls.find((c) => c.text === text);
// The kit family a call asks for first ('' when it is an old Windows face).
const familyOf = (call) => {
  const m = call && call.font.match(/px "([^"]+)"/);
  return m ? m[1] : '';
};
const face = (call) => (call ? `${familyOf(call) || call.font}${call.wght && call.wght !== 'normal' ? ' ' + call.wght : ''}` : 'not drawn');
const is = (call, family, wght) => !!call && familyOf(call) === family
  && call.wght === (wght ? `"wght" ${wght}` : 'normal');

const COMIC = { shout: ['Comic Neue Bold'], bold: ['Comic Neue Bold'], regular: ['Comic Neue'] };
const PLAYFAIR = { shout: ['Playfair Display', 800], bold: ['Playfair Display', 700], regular: ['Playfair Display', 400] };
const CLUBS = [
  ['Puggles', COMIC], ['Cubbies', COMIC], ['Trek', PLAYFAIR], ['Journey', PLAYFAIR], ['Sparks', null], ['T&T', null],
];
// Stock: [family, wght] per line of everyLine() below.
const STOCK = {
  Testkid: ['Paytone One'], Sample: ['Figtree', 500], 'Flight 3:16': ['Figtree', 600], 'Go to: Rm 4': ['Figtree', 700],
  '10th club night tonight!': ['Figtree', 500], Wednesdays: ['Figtree', 400], VISITOR: ['Londrina Solid Black'],
  'b. Mar': ['Figtree', 500], 'Turning 7 this week!': ['Figtree', 600],
};
const TIER = {
  Testkid: 'shout', Sample: 'regular', 'Flight 3:16': 'bold', 'Go to: Rm 4': 'bold', '10th club night tonight!': 'regular',
  Wednesdays: 'regular', VISITOR: 'bold', 'b. Mar': 'regular', 'Turning 7 this week!': 'regular',
};
const everyLine = (clubName) => ({
  firstName: 'Testkid', lastName: 'Sample', clubName, handbookGroup: 'Flight 3:16', nameHint: 'b. Mar',
  isVisitor: true, footerText: 'Wednesdays',
  extras: { goToLine: 'Go to: Rm 4', milestoneLine: '10th club night tonight!' },
});
// The icon row: the age words beside the cake, an allergy icon.
const iconRow = (clubName) => ({
  firstName: 'Testkid', lastName: 'Sample', clubName, isBirthday: true, birthdayAge: 7, allergyTokens: ['NUTS'],
});
const expected = (set, text) => (set ? set[TIER[text]] : STOCK[text]);

// Kits with a club face taken away, the ways installs break.
const SHIPPED = brand.DEFAULT_BRAND_DIR;
const kitWithout = (name, change) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `awana-club-fonts-${name}-`));
  fs.cpSync(SHIPPED, d, { recursive: true });
  change(path.join(d, 'fonts'));
  return d;
};
const KITS = {
  noComicBold: kitWithout('no-comic-bold', (f) => fs.rmSync(path.join(f, 'ComicNeue-Bold.ttf'))),
  damagedPlayfair: kitWithout('damaged-playfair', (f) => {
    const p = path.join(f, 'PlayfairDisplay-Variable.ttf');
    const buf = fs.readFileSync(p);
    fs.writeFileSync(p, buf.subarray(0, Math.floor(buf.length * 0.6)));
  }),
  noClubFaces: kitWithout('no-club-faces', (f) => {
    for (const file of ['ComicNeue-Regular.ttf', 'ComicNeue-Bold.ttf', 'PlayfairDisplay-Variable.ttf']) fs.rmSync(path.join(f, file));
  }),
};

async function main() {
  console.log('club faces: every line of each club\'s label, at its weight');
  for (const [club, set] of CLUBS) {
    const { calls } = await label(everyLine(club));
    calls.push(...(await label(iconRow(club))).calls);
    for (const text of Object.keys(STOCK)) {
      const [family, wght] = expected(set, text);
      check(`${club}: "${text}" is ${family}${wght ? ' ' + wght : ''}`, is(callOf(calls, text), family, wght), face(callOf(calls, text)));
    }
    // The icons stay the emoji stack's, never a kit face (no weight leaks in).
    const icons = calls.filter((c) => /🥜|🍰|📷/u.test(c.text));
    check(`${club}: the allergy and birthday icons are emoji, as before`,
      icons.length >= 2 && icons.every((c) => /Emoji/.test(c.font) && c.wght === 'normal'), JSON.stringify(icons));
  }
  {
    // With its mark gone the club line and monogram come back, in the club face.
    const noMarks = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-club-fonts-no-marks-'));
    fs.cpSync(path.join(SHIPPED, 'fonts'), path.join(noMarks, 'fonts'), { recursive: true });
    brand.loadBrandKit(noMarks);
    try {
      for (const [club, letter, family, wght] of [['Puggles', 'P', 'Comic Neue Bold'], ['Trek', 'TR', 'Playfair Display', 800]]) {
        const { calls } = await label({ firstName: 'Testkid', lastName: 'Sample', clubName: club });
        check(`${club} without its mark: the monogram is ${family}`, is(callOf(calls, letter), family, wght), face(callOf(calls, letter)));
        check(`${club} without its mark: the club line is the club face's bold`,
          calls.some((c) => c.text === club && familyOf(c) === family && (family !== 'Playfair Display' || c.wght === '"wght" 700')),
          JSON.stringify(calls.filter((c) => c.text === club)));
      }
    } finally {
      brand.loadBrandKit(SHIPPED);
      fs.rmSync(noMarks, { recursive: true, force: true });
    }
  }

  console.log('club faces: other labels follow the club they carry, else stock');
  {
    const lead = await drawn(() => leaders.renderLeaderLabel({ firstName: 'Pat', lastName: 'Sample', clubName: 'Trek' }));
    check('a Trek leader tag: the name is Playfair Display 800', is(callOf(lead.calls, 'Pat'), 'Playfair Display', 800), face(callOf(lead.calls, 'Pat')));
    check('...its LEADER pill Playfair Display 700', is(callOf(lead.calls, 'LEADER'), 'Playfair Display', 700), face(callOf(lead.calls, 'LEADER')));
    check('...its "Trek Leader" line Playfair Display 700', is(callOf(lead.calls, 'Trek Leader'), 'Playfair Display', 700), face(callOf(lead.calls, 'Trek Leader')));
    const lone = await drawn(() => leaders.renderLeaderLabel({ firstName: 'Pat', lastName: 'Sample', clubName: '' }));
    check('a leader tag with no club is stock (Paytone One)', is(callOf(lone.calls, 'Pat'), 'Paytone One'), face(callOf(lone.calls, 'Pat')));
    const one = await drawn(() => leaders.renderOneOffLabel('Wren', 'Cubbies'));
    check('a Cubbies one-off tag: the name is Comic Neue Bold', is(callOf(one.calls, 'Wren'), 'Comic Neue Bold'), face(callOf(one.calls, 'Wren')));
    const custom = await label({ customText: 'VOLUNTEER' });
    check('a custom label is stock (Paytone One)', is(callOf(custom.calls, 'VOLUNTEER'), 'Paytone One'), face(callOf(custom.calls, 'VOLUNTEER')));
    const barf = await drawn(() => server.generateBarfTag({ firstName: 'Mila', clubName: 'Puggles' }));
    const barfFaces = barf.calls.map(familyOf);
    check('a BARF tag keeps its own art, in the stock faces (no club face)',
      barf.calls.length > 0 && !barfFaces.some((f) => /Comic|Playfair/.test(f)), JSON.stringify(barf.calls.map(face)));
  }

  console.log('club faces: a missing or damaged face sends that club back to the stock label');
  {
    const plain = (club) => ({ firstName: 'Testkid', lastName: 'Sample', clubName: club, handbookGroup: 'Flight 3:16', isVisitor: true });
    const shipped = {};
    for (const club of ['Puggles', 'Trek', 'Sparks']) shipped[club] = (await label(plain(club))).buffer;
    brand.loadBrandKit(KITS.noClubFaces);
    const stock = {};
    for (const club of ['Puggles', 'Trek', 'Sparks']) stock[club] = (await label(plain(club))).buffer;
    check('the club faces really change Puggles and Trek labels', Buffer.compare(shipped.Puggles, stock.Puggles) !== 0
      && Buffer.compare(shipped.Trek, stock.Trek) !== 0);
    check('...and never a Sparks label', Buffer.compare(shipped.Sparks, stock.Sparks) === 0);

    let st = brand.loadBrandKit(KITS.noComicBold);
    check('Comic Neue Bold missing: reported failed as "file missing"',
      st.fonts.failed.includes('Comic Neue Bold') && st.fonts.reasons['Comic Neue Bold'] === 'file missing', JSON.stringify(st.fonts));
    check('...Comic Neue Regular still loads, and every stock face', ['Comic Neue', 'Paytone One', 'Figtree', 'Playfair Display'].every((f) => st.fonts.loaded.includes(f)));
    const w = brand.warnings().find((x) => x.type === 'brandFonts');
    check('.../health warns, naming it', !!w && w.message.includes('Comic Neue Bold (file missing)'), JSON.stringify(brand.warnings()));
    const p = await label(everyLine('Puggles'));
    p.calls.push(...(await label(iconRow('Puggles'))).calls);
    check('...a Puggles label is set wholly in the stock voices (never half Comic Neue)',
      Object.keys(STOCK).every((t) => is(callOf(p.calls, t), ...STOCK[t])), JSON.stringify(p.calls.map(face)));
    check('...byte for byte the stock Puggles label', Buffer.compare((await label(plain('Puggles'))).buffer, stock.Puggles) === 0);
    check('...while Trek keeps Playfair Display', Buffer.compare((await label(plain('Trek'))).buffer, shipped.Trek) === 0);

    st = brand.loadBrandKit(KITS.damagedPlayfair);
    check('Playfair Display damaged: reported failed as a damaged font file',
      st.fonts.failed.includes('Playfair Display') && st.fonts.reasons['Playfair Display'] === 'damaged font file', JSON.stringify(st.fonts));
    const t = await label(everyLine('Journey'));
    t.calls.push(...(await label(iconRow('Journey'))).calls);
    check('...a Journey label is set wholly in the stock voices',
      Object.keys(STOCK).every((x) => is(callOf(t.calls, x), ...STOCK[x])), JSON.stringify(t.calls.map(face)));
    check('...byte for byte the stock Trek label', Buffer.compare((await label(plain('Trek'))).buffer, stock.Trek) === 0);
    check('...while Puggles keeps Comic Neue', Buffer.compare((await label(plain('Puggles'))).buffer, shipped.Puggles) === 0);
    brand.loadBrandKit(SHIPPED);
    check('back on the shipped kit, all seven faces load', brand.status().fonts.loaded.length === 7 && brand.status().fonts.failed.length === 0,
      JSON.stringify(brand.status().fonts));
  }

  console.log('club faces: a letter the face lacks falls back, word by word, voice by voice');
  {
    const first = async (club, firstName, lastName = 'Sample') => {
      const { calls } = await label({ firstName, lastName, clubName: club });
      return { name: callOf(calls, firstName), last: callOf(calls, lastName) };
    };
    // Comic Neue has no Ș, ễ or Cyrillic.
    let r = await first('Puggles', 'Ștefan');
    check('Puggles "Ștefan": Comic Neue lacks Ș, so the name is the stock shout (Paytone One)', is(r.name, 'Paytone One'), face(r.name));
    check('...and the last name after it stays Comic Neue', is(r.last, 'Comic Neue'), face(r.last));
    r = await first('Puggles', 'Дима');
    check('Puggles "Дима": neither Comic Neue nor Paytone One draws it, so the old Comic Sans face, bold',
      !!r.name && familyOf(r.name) === '' && /^bold [0-9.]+px 'Comic Sans MS'/.test(r.name.font), r.name && r.name.font);
    r = await first('Cubbies', 'Thảo', 'Nguyễn');
    check('Cubbies "Thảo Nguyễn": the first name in Paytone One, the last name (no ễ in Comic Neue or Figtree) in the old face',
      is(r.name, 'Paytone One') && !!r.last && familyOf(r.last) === '', `${face(r.name)} / ${face(r.last)}`);
    // Playfair Display draws Cyrillic and Vietnamese, but no Greek.
    r = await first('Trek', 'Дима', 'Nguyễn');
    check('Trek "Дима Nguyễn": Playfair Display draws both (better than the stock faces did)',
      is(r.name, 'Playfair Display', 800) && is(r.last, 'Playfair Display', 400), `${face(r.name)} / ${face(r.last)}`);
    r = await first('Journey', 'Γιώργος');
    check('Journey "Γιώργος": no Greek in Playfair Display or Paytone One, so the old Palatino face, bold',
      !!r.name && /^bold [0-9.]+px 'Palatino Linotype'/.test(r.name.font), r.name && r.name.font);
    // A small line splits at words: the word the club face lacks goes to the
    // stock voice, the rest stays in the club face.
    const line = 'Hi Ștefan, Room 4';
    const { calls } = await label({ firstName: 'Testkid', lastName: 'Sample', clubName: 'Puggles', extras: { milestoneLine: line } });
    const pieces = calls.filter((c) => line.includes(c.text) && c.text.trim());
    check('a Puggles small line: "Ștefan" alone in Figtree, its neighbours in Comic Neue',
      pieces.map((c) => c.text).join('') === line
      && pieces.every((c) => (c.text.includes('Ș') ? familyOf(c) === 'Figtree' : familyOf(c) === 'Comic Neue')),
      JSON.stringify(pieces.map((c) => [c.text, face(c)])));
    const runs = brand.splitRuns(['Comic Neue', 'Figtree'], 'Hi Ștefan Дима');
    check('splitRuns over a list names the first face that draws each word, null for none',
      JSON.stringify(runs.map((x) => [x.text, x.family])) === JSON.stringify([['Hi ', 'Comic Neue'], ['Ștefan', 'Figtree'], [' ', 'Comic Neue'], ['Дима', null]]),
      JSON.stringify(runs));
  }

  for (const d of [...Object.values(KITS), dataDir]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

main().then(() => {
  console.log('');
  console.log(`${passed} passed, ${failed} failed`);
  __suiteFinished = true;
  process.exit(failed > 0 ? 1 : 0);
}).catch((err) => {
  console.error('\nharness error:', err);
  process.exit(1);
});
