import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

// The brand kit (shared/brand/) is mirrored byte-for-byte into the Journey
// kiosk and the label printer, and read three ways here (tokens.json by
// code, tokens.css by plain CSS, theme.json by both screens). These tests
// are what keeps the three spellings of one palette from drifting apart.

const SHARED = resolve(__dirname, '../../shared');
const KIT = resolve(SHARED, 'brand');
const tokens = JSON.parse(readFileSync(resolve(KIT, 'tokens.json'), 'utf8'));
const css = readFileSync(resolve(KIT, 'tokens.css'), 'utf8');
const fontsCss = readFileSync(resolve(KIT, 'fonts.css'), 'utf8');
const theme = JSON.parse(readFileSync(resolve(SHARED, 'theme.json'), 'utf8'));
const CLUBS = ['puggles', 'cubbies', 'sparks', 'tnt', 'trek', 'journey'];

const cssVar = (name) => {
  const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
};
const camelToKebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

// ---------------------------------------------------------------------------
// Fonts. Two of the kit's three families declare a Reserved Font Name in
// their license: Paytone One (the shout, owner decision 2026-09-29, replacing
// Galindo) and Londrina Solid (the label voice). A Modified Version may not
// carry a reserved name, and the OFL FAQ counts a subset (2.6) or a format
// change (2.2) as modification, so the kit ships each of them WHOLE: the
// upstream TTF, and a WOFF2 that is only a lossless compression of that TTF
// (FAQ 2.2.1: "the original font data remains unchanged except for WOFF
// compression"). These tests are the guard on that claim; README.md
// ("Reserved Font Names and the OFL") is the why. Figtree declares no
// reserved name, so its latin WOFF2 subset is fine and is not held to this.
// ---------------------------------------------------------------------------

const FONTS = resolve(KIT, 'fonts');
const readFont = (name) => readFileSync(resolve(FONTS, name));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// The upstream TTFs (google/fonts ofl/paytoneone and ofl/londrinasolid), by
// file name. A reserved-name TTF in the kit must be exactly one of these.
const UPSTREAM_TTF = {
  'PaytoneOne-Regular.ttf': {
    sha256: '1c07073b0b578199b54c7866d55e2b631d285e8aa4bb4fbc08809d980cd49b14',
    bytes: 114648,
  },
  'LondrinaSolid-Regular.ttf': {
    sha256: 'e82b9b3ee21ccf153dcf67e5f4226a210474591a6ad31b5f17f2f14dc2524514',
    bytes: 92132,
  },
  'LondrinaSolid-Black.ttf': {
    sha256: '8c63a15e3fa34e0b362abeb903944a2bd45e71b1efa122486c0a47e295eae06f',
    bytes: 93408,
  },
};
// Each full-font WOFF2 and the TTF it must be the whole of.
const FULL_WOFF2 = {
  'paytone-one-full-400-normal.woff2': 'PaytoneOne-Regular.ttf',
  'londrina-solid-full-400-normal.woff2': 'LondrinaSolid-Regular.ttf',
  'londrina-solid-full-900-normal.woff2': 'LondrinaSolid-Black.ttf',
};
const PAYTONE_TTF = 'PaytoneOne-Regular.ttf';
const PAYTONE_WOFF2 = 'paytone-one-full-400-normal.woff2';
const LONDRINA_FACES = [
  { weight: 400, ttf: 'LondrinaSolid-Regular.ttf', woff2: 'londrina-solid-full-400-normal.woff2' },
  { weight: 900, ttf: 'LondrinaSolid-Black.ttf', woff2: 'londrina-solid-full-900-normal.woff2' },
];

// sfnt (TTF) table directory -> { tag: Buffer }
function sfntTables(buf) {
  const n = buf.readUInt16BE(4);
  const out = {};
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    const offset = buf.readUInt32BE(o + 8);
    out[buf.toString('latin1', o, o + 4)] = buf.subarray(offset, offset + buf.readUInt32BE(o + 12));
  }
  return out;
}

// The WOFF2 spec's known-table-tag list (section 4.1), by 6-bit index.
const WOFF2_KNOWN_TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];

// Parses a WOFF2 file and decodes it, recording which tables went through a
// real transform: anything but the null transform is not "the original font
// data unchanged".
function readWoff2(buf) {
  const head = {
    signature: buf.toString('latin1', 0, 4),
    flavor: buf.readUInt32BE(4),
    length: buf.readUInt32BE(8),
    numTables: buf.readUInt16BE(12),
    totalSfntSize: buf.readUInt32BE(16),
    totalCompressedSize: buf.readUInt32BE(20),
    metaOffset: buf.readUInt32BE(28),
    metaLength: buf.readUInt32BE(32),
    metaOrigLength: buf.readUInt32BE(36),
    privOffset: buf.readUInt32BE(40),
    privLength: buf.readUInt32BE(44),
  };
  let p = 48;
  const base128 = () => {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const c = buf[p++];
      v = v * 128 + (c & 0x7f);
      if (!(c & 0x80)) return v;
    }
    throw new Error('bad UIntBase128');
  };
  const entries = [];
  for (let i = 0; i < head.numTables; i++) {
    const flags = buf[p++];
    let tag = WOFF2_KNOWN_TAGS[flags & 0x3f];
    if ((flags & 0x3f) === 0x3f) {
      tag = buf.toString('latin1', p, p + 4);
      p += 4;
    }
    const version = flags >> 6;
    const origLength = base128();
    const nullTransform = tag === 'glyf' || tag === 'loca' ? version === 3 : version === 0;
    // transformLength is present only for a real transform; it is what the
    // stream holds for that table (the original length is the decoded size).
    const transformLength = nullTransform ? origLength : base128();
    entries.push({ tag, origLength, transformLength, nullTransform });
  }
  const stream = brotliDecompressSync(buf.subarray(p, p + head.totalCompressedSize));
  // Only a null-transformed table is the original bytes; a transformed one
  // (Figtree's glyf and loca) is skipped over and left out of `tables`.
  const tables = {};
  let at = 0;
  for (const e of entries) {
    if (e.nullTransform) tables[e.tag] = stream.subarray(at, at + e.origLength);
    at += e.transformLength;
  }
  return { head, entries, tables, streamLength: stream.length };
}

// The bytes a sfnt built from these tables occupies: 12-byte header, 16 bytes
// per directory entry, every table padded to 4.
const sfntSize = (tables) =>
  12 + 16 * Object.keys(tables).length + Object.values(tables).reduce((n, t) => n + ((t.length + 3) & ~3), 0);

// The family / full / typographic-family names in a font's name table
// (Windows and Mac platforms), given its decoded tables.
function fontNames(tables) {
  const t = tables.name;
  const count = t.readUInt16BE(2);
  const strings = t.readUInt16BE(4);
  const out = { 1: [], 4: [], 16: [] };
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 12;
    const platform = t.readUInt16BE(o);
    const id = t.readUInt16BE(o + 6);
    if (!out[id]) continue;
    const len = t.readUInt16BE(o + 8);
    const at = strings + t.readUInt16BE(o + 10);
    const raw = t.subarray(at, at + len);
    // swap16 works in place, and `raw` is a view of the font's own bytes: copy first.
    out[id].push(platform === 3 || platform === 0 ? Buffer.from(raw).swap16().toString('utf16le') : raw.toString('latin1'));
  }
  return out;
}

// Every font in the kit's fonts folder, decoded to its tables.
function kitFonts() {
  return readdirSync(FONTS)
    .filter((f) => /\.(ttf|otf|woff2?|eot)$/i.test(f))
    .map((file) => {
      const buf = readFont(file);
      const ext = file.split('.').pop().toLowerCase();
      const tables = ext === 'ttf' ? sfntTables(buf) : ext === 'woff2' ? readWoff2(buf).tables : null;
      return { file, ext, buf, tables, names: tables && tables.name ? fontNames(tables) : null };
    });
}

// The Reserved Font Names an OFL declares. They are in the copyright block
// above "This Font Software is licensed", after "Reserved Font Name(s)"; the
// license body below repeats the words in its definitions, so it is not
// searched. Names are usually quoted ("Londrina Solid", "Paytone" and "Paytone
// One"), but not always (Lilita One's reads: with Reserved Font Name Lilita).
function reservedNamesIn(text) {
  const end = text.indexOf('This Font Software is licensed');
  const head = text.slice(0, end > 0 ? end : 600);
  const after = head.match(/Reserved Font Names?\s+([\s\S]*)/i)?.[1];
  if (after === undefined) return [];
  const quoted = [...after.matchAll(/["\u201C\u201D]([^"\u201C\u201D]+)["\u201C\u201D]/g)].map((m) => m[1]);
  if (quoted.length) return quoted;
  return after.split(/\s*(?:,|\band\b)\s*/).map((n) => n.replace(/[.\s]+$/, '').trim()).filter(Boolean);
}
// The Reserved Font Names each OFL-*.txt in the kit declares, by file.
function reservedFontNames() {
  const byLicense = {};
  for (const f of readdirSync(FONTS).filter((n) => /^OFL-.*\.txt$/.test(n))) {
    byLicense[f] = reservedNamesIn(readFont(f).toString('utf8'));
  }
  return byLicense;
}
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * The whole-font proof (OFL FAQ 2.2.1) for one WOFF2 against its TTF: the
 * file is the TTF's own tables, Brotli-compressed with the null transform,
 * and the only differences are the ones the WOFF2 spec requires of an
 * encoder (head flags bit 11 and checkSumAdjustment; an empty DSIG removed).
 */
function expectWholeFont(woffName, ttfName) {
  const woff = readFont(woffName);
  const ttf = readFont(ttfName);
  const w = readWoff2(woff);
  const orig = sfntTables(ttf);

  expect(w.head.signature, woffName).toBe('wOF2');
  expect(w.head.flavor, woffName).toBe(0x00010000); // TrueType outlines
  expect(w.head.length, woffName).toBe(woff.length);
  // No WOFF-specific metadata block and no private data: nothing to lose or alter.
  expect([w.head.metaOffset, w.head.metaLength, w.head.metaOrigLength], woffName).toEqual([0, 0, 0]);
  expect([w.head.privOffset, w.head.privLength], woffName).toEqual([0, 0]);
  // Every table travels through the null transform: glyf and loca are NOT
  // re-encoded (the default transform rewrites them, so they would no
  // longer be the original data).
  expect(w.entries.filter((e) => !e.nullTransform).map((e) => e.tag), woffName).toEqual([]);
  expect(w.streamLength, woffName).toBe(w.entries.reduce((n, e) => n + e.origLength, 0));

  // The WOFF2 spec (section 5) obliges an encoder to remove DSIG, which any
  // container change invalidates. That is only "nothing lost" while the TTF's
  // is the empty stub (version 1, no signatures, flags 0).
  if (orig.DSIG) {
    expect(orig.DSIG.toString('hex'), `${ttfName} DSIG is an empty stub, not a real signature`).toBe('0000000100000000');
  }
  // All other tables present (no subsetting, no dropped smart-font tables)...
  expect(Object.keys(w.tables).sort(), woffName).toEqual(Object.keys(orig).filter((t) => t !== 'DSIG').sort());
  // ...and the decoded font is exactly the size the TTF is without that stub.
  expect(w.head.totalSfntSize, woffName).toBe(sfntSize(w.tables));
  expect(w.head.totalSfntSize, woffName).toBe(ttf.length - (orig.DSIG ? 16 + ((orig.DSIG.length + 3) & ~3) : 0));
  // ...every one byte-identical to the TTF's...
  for (const tag of Object.keys(w.tables).filter((t) => t !== 'head')) {
    expect(w.tables[tag].equals(orig[tag]), `${woffName} ${tag}`).toBe(true);
  }
  // ...except head, which may differ in exactly the two places the WOFF2
  // spec makes an encoder change: bit 11 of flags, and checkSumAdjustment.
  const a = Buffer.from(orig.head);
  const b = Buffer.from(w.tables.head);
  expect(b.length, `${woffName} head`).toBe(a.length);
  expect(b.readUInt16BE(16) & 0x0800, `${woffName} head.flags bit 11 is set by a WOFF2 encoder`).toBe(0x0800);
  b.writeUInt16BE(b.readUInt16BE(16) & ~0x0800, 16);
  b.fill(0, 8, 12);
  a.writeUInt16BE(a.readUInt16BE(16) & ~0x0800, 16);
  a.fill(0, 8, 12);
  expect(b.equals(a), `${woffName} head, apart from flags bit 11 and checkSumAdjustment`).toBe(true);
}

describe('shared/brand fonts', () => {
  it('the three voices are the same in tokens.json, tokens.css and fonts.css', () => {
    expect(tokens.fonts).toEqual({ display: 'Paytone One', label: 'Londrina Solid', body: 'Figtree' });
    for (const [voice, family] of Object.entries(tokens.fonts)) {
      // The first family of each --brand-font-* stack is the token's family.
      expect(cssVar(`brand-font-${voice}`)?.split(',')[0].trim(), voice).toBe(`'${family}'`);
      expect(fontsCss, voice).toContain(`font-family: '${family}';`);
    }
  });

  it('every stack ends in a generic family, so a missing font never falls to the browser default serif', () => {
    for (const voice of ['display', 'label', 'body']) {
      expect(cssVar(`brand-font-${voice}`), voice).toMatch(/,\s*(sans-serif|system-ui)$/);
    }
  });

  it('Galindo is gone from the kit: no files, no @font-face, no token', () => {
    expect(readdirSync(FONTS).filter((f) => /galindo/i.test(f))).toEqual([]);
    expect(fontsCss).not.toMatch(/galindo/i);
    expect(css).not.toMatch(/galindo/i);
    expect(JSON.stringify(tokens)).not.toMatch(/galindo/i);
  });

  it('every reserved-name TTF is the upstream file, byte for byte', () => {
    for (const [file, want] of Object.entries(UPSTREAM_TTF)) {
      const ttf = readFont(file);
      expect(ttf.length, file).toBe(want.bytes);
      expect(sha256(ttf), file).toBe(want.sha256);
    }
  });

  it('OFL-PaytoneOne.txt is the OFL 1.1 with its Reserved Font Names', () => {
    const ofl = readFont('OFL-PaytoneOne.txt').toString('utf8');
    expect(ofl).toContain('Copyright 2011 The Paytone Project Authors');
    expect(ofl).toContain('Reserved Font Names "Paytone" and "Paytone One"');
    expect(ofl).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(ofl).toContain('No Modified Version of the Font Software may use the Reserved Font');
  });

  it('OFL-LondrinaSolid.txt is the OFL 1.1 with its Reserved Font Name', () => {
    const ofl = readFont('OFL-LondrinaSolid.txt').toString('utf8');
    expect(ofl).toContain('Copyright 2011 The Londrina Solid Authors');
    expect(ofl).toContain('with Reserved Font Name "Londrina Solid');
    expect(ofl).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(ofl).toContain('No Modified Version of the Font Software may use the Reserved Font');
  });

  it('fonts.css serves Paytone One from the two full-font files, WOFF2 first, TTF as the fallback', () => {
    const block = fontsCss.match(/@font-face\s*\{[^}]*font-family:\s*'Paytone One'[^}]*\}/)?.[0];
    expect(block).toBeDefined();
    const urls = [...block.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]);
    expect(urls).toEqual([`fonts/${PAYTONE_WOFF2}`, `fonts/${PAYTONE_TTF}`]);
    expect(block).toMatch(/font-weight:\s*400;/);
    // One @font-face for the family: a second (a subset) would be a Modified Version.
    expect(fontsCss.match(/font-family:\s*'Paytone One'/g)).toHaveLength(1);
  });

  it('fonts.css serves Londrina Solid 400 and 900 from the full-font files, WOFF2 first, TTF as the fallback', () => {
    const blocks = [...fontsCss.matchAll(/@font-face\s*\{[^}]*font-family:\s*'Londrina Solid'[^}]*\}/g)].map((m) => m[0]);
    // Exactly one @font-face per weight: a second (a subset by unicode-range) would be a Modified Version.
    expect(blocks).toHaveLength(LONDRINA_FACES.length);
    LONDRINA_FACES.forEach(({ weight, ttf, woff2 }, i) => {
      const urls = [...blocks[i].matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]);
      expect(urls, `${weight}`).toEqual([`fonts/${woff2}`, `fonts/${ttf}`]);
      expect(blocks[i], `${weight}`).toMatch(new RegExp(`font-weight:\\s*${weight};`));
      expect(blocks[i], `${weight}`).not.toMatch(/unicode-range/);
    });
  });

  it('the Paytone One WOFF2 is the whole TTF, losslessly compressed (OFL FAQ 2.2.1)', () => {
    expectWholeFont(PAYTONE_WOFF2, PAYTONE_TTF);
  });

  it('the Londrina Solid WOFF2s (400 and 900) are the whole TTFs, losslessly compressed (OFL FAQ 2.2.1)', () => {
    for (const { woff2, ttf } of LONDRINA_FACES) expectWholeFont(woff2, ttf);
  });

  it('reads a license\'s Reserved Font Names whether or not they are quoted', () => {
    const tail = '\n\nThis Font Software is licensed under the SIL Open Font License, Version 1.1.\nReserved Font Name is defined below.';
    expect(reservedNamesIn('Copyright 2011 The X Authors (https://x.example), with Reserved Font Name "Londrina Solid\u201D' + tail)).toEqual(['Londrina Solid']);
    expect(reservedNamesIn('Copyright 2011 The Paytone Project Authors (https://x.example),\nwith Reserved Font Names "Paytone" and "Paytone One".' + tail)).toEqual(['Paytone', 'Paytone One']);
    // Lilita One\'s real header: no quotes at all.
    expect(reservedNamesIn('Copyright (c) 2011 Juan Montoreano (juan@remolacha.biz), \nwith Reserved Font Name Lilita' + tail)).toEqual(['Lilita']);
    // Figtree\'s: none declared (the words only appear in the license body).
    expect(reservedNamesIn('Copyright 2022 The Figtree Project Authors (https://x.example)' + tail)).toEqual([]);
  });

  it('every WOFF2 the kit ships for a reserved-name face is one of the whole-font files, and none other exists', () => {
    // The Reserved Font Names are read from the kit's own licenses, so a
    // license that gains one (or a new family) is held to the same rule.
    const reserved = reservedFontNames();
    expect(reserved['OFL-PaytoneOne.txt']).toEqual(['Paytone', 'Paytone One']);
    expect(reserved['OFL-LondrinaSolid.txt']).toEqual(['Londrina Solid']);
    expect(reserved['OFL-Figtree.txt']).toEqual([]);
    const names = Object.values(reserved).flat().map((n) => n.toLowerCase());

    const fonts = kitFonts();
    // Every font in the kit is a container this test can open and prove.
    expect(fonts.filter((f) => !f.tables).map((f) => f.file)).toEqual([]);
    expect(fonts.filter((f) => f.ext === 'ttf' || f.ext === 'woff2').length).toBeGreaterThan(0);

    const reservedFonts = fonts.filter((f) => {
      const all = [...f.names[1], ...f.names[4], ...f.names[16]].map((n) => n.toLowerCase());
      // Both the name table and the file name: a subset that lost its name table
      // (or one renamed only in the file) must not slip through.
      return all.some((n) => names.some((r) => n.startsWith(r))) || names.some((r) => slug(f.file).startsWith(slug(r)));
    });
    expect(reservedFonts.map((f) => f.file).sort()).toEqual([...Object.keys(UPSTREAM_TTF), ...Object.keys(FULL_WOFF2)].sort());
    for (const f of reservedFonts) {
      if (f.ext === 'ttf') {
        expect(sha256(f.buf), `${f.file} is not the upstream TTF`).toBe(UPSTREAM_TTF[f.file]?.sha256);
      } else {
        // Named as a full font, and proved to be one (no "-latin-", no subset).
        expect(f.file, 'a reserved-name WOFF2 must be a *-full-* file').toMatch(/^[a-z0-9-]+-full-\d+-normal\.woff2$/);
        expect(FULL_WOFF2[f.file], `${f.file} has no whole-font TTF to be proved against`).toBeDefined();
        expectWholeFont(f.file, FULL_WOFF2[f.file]);
      }
    }
  });

  it('no @fontsource package of a reserved-name face is a dependency or is imported by either page', () => {
    // A reserved-name face reaches the screens only through the kit's files. The
    // @fontsource (and Google) copies are latin subsets, i.e. Modified Versions.
    const names = Object.values(reservedFontNames()).flat().map(slug);
    expect([...names].sort()).toEqual(['londrina-solid', 'paytone', 'paytone-one']);
    const banned = (pkg) => names.some((n) => pkg.replace(/^@fontsource(-variable)?\//, '').startsWith(n));

    const pkg = JSON.parse(readFileSync(resolve(SHARED, '../package.json'), 'utf8'));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((d) => d.startsWith('@fontsource'));
    expect(deps.length).toBeGreaterThan(0); // the other faces still come from @fontsource
    expect(deps.filter(banned)).toEqual([]);

    const walk = (dir) =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(resolve(dir, e.name)) : [resolve(dir, e.name)],
      );
    const source = walk(resolve(SHARED, '../src')).filter((f) => /\.(jsx?|css|html)$/.test(f) && !/\.test\.jsx?$/.test(f));
    expect(source.length).toBeGreaterThan(50);
    for (const f of source) {
      const text = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      const used = [...text.matchAll(/(?:from\s+|import\s+|@import\s+(?:url\()?)["'](@fontsource(?:-variable)?\/[a-z0-9-]+)/g)].map((m) => m[1]);
      expect(used.filter(banned), f).toEqual([]);
    }
  });

  it('every font file in the kit is one fonts.css serves', () => {
    const served = new Set([...fontsCss.matchAll(/url\('fonts\/([^']+)'\)/g)].map((m) => m[1]));
    const onDisk = readdirSync(FONTS).filter((f) => /\.(ttf|otf|woff2?)$/i.test(f));
    expect([...served].sort()).toEqual(onDisk.sort());
  });
});

describe('shared/brand kit', () => {
  it('tokens.css carries every club color in tokens.json', () => {
    for (const id of CLUBS) {
      const c = tokens.clubs[id];
      expect(cssVar(`brand-${id}`)?.toUpperCase(), id).toBe(c.primary.toUpperCase());
      expect(cssVar(`brand-${id}-deep`)?.toUpperCase(), `${id} deep`).toBe(c.deep.toUpperCase());
      expect(cssVar(`brand-${id}-tint`)?.toUpperCase(), `${id} tint`).toBe(c.tint.toUpperCase());
    }
  });

  it('tokens.css carries every house color in tokens.json', () => {
    for (const [k, v] of Object.entries(tokens.house)) {
      if (k === 'chip' || k === 'chipOpacity') continue;
      expect(cssVar(`brand-${camelToKebab(k)}`)?.toUpperCase(), k).toBe(v.toUpperCase());
    }
  });

  it('tokens.css carries the motion table in tokens.json', () => {
    expect(cssVar('brand-beat')).toBe(`${tokens.motion.beatMs}ms`);
    for (const [k, ms] of Object.entries(tokens.motion.durationsMs)) {
      expect(cssVar(`brand-dur-${k}`), k).toBe(`${ms}ms`);
    }
    for (const [k, pts] of Object.entries(tokens.motion.curves)) {
      expect(cssVar(`brand-ease-${k}`), k).toBe(`cubic-bezier(${pts.join(', ')})`);
    }
  });

  it('theme.json uses the kit colors for every club', () => {
    for (const id of CLUBS) {
      const c = theme.clubs[id];
      expect(c, id).toBeDefined();
      expect(c.color.toUpperCase(), id).toBe(tokens.clubs[id].primary.toUpperCase());
      expect(c.deep.toUpperCase(), `${id} deep`).toBe(tokens.clubs[id].deep.toUpperCase());
      expect(c.tint.toUpperCase(), `${id} tint`).toBe(tokens.clubs[id].tint.toUpperCase());
    }
  });

  it('Puggles is blue, by the owner\'s decision, not its catalog page orange', () => {
    expect(tokens.clubs.puggles.primary).toBe('#1DB6D9');
  });

  it('ships white, color and one-color marks for every club, plus the Awana Clubs mark', () => {
    for (const id of CLUBS) {
      for (const v of ['white', 'color', 'black']) {
        expect(existsSync(resolve(KIT, 'logos', `${id}-${v}.svg`)), `${id}-${v}`).toBe(true);
      }
      expect(existsSync(resolve(KIT, 'shapes', `wave-${id}.svg`)), `wave-${id}`).toBe(true);
    }
    expect(existsSync(resolve(KIT, 'logos', 'awana-clubs-white.svg'))).toBe(true);
    expect(existsSync(resolve(KIT, 'logos', 'awana-clubs-black.svg'))).toBe(true);
  });

  it('every file fonts.css points at exists, with its license', () => {
    const urls = [...fontsCss.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(existsSync(resolve(KIT, u)), u).toBe(true);
    const files = readdirSync(resolve(KIT, 'fonts'));
    for (const lic of ['OFL-PaytoneOne.txt', 'OFL-LondrinaSolid.txt', 'OFL-Figtree.txt']) {
      expect(files, lic).toContain(lic);
    }
  });

  it('every SVG in the kit is a plain vector file with no script or external reference', () => {
    for (const dir of ['logos', 'shapes', 'doodles']) {
      for (const f of readdirSync(resolve(KIT, dir))) {
        const svg = readFileSync(resolve(KIT, dir, f), 'utf8');
        expect(svg, f).toMatch(/<svg[\s>]/);
        expect(svg, f).not.toMatch(/<script|on[a-z]+="|href="(?!#|data:)/i);
      }
    }
  });
});
