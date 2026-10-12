// Helpers for test-brand-kit.cjs: the print server's generated copy of the brand
// kit (print-server/public/brand/, made by ../../scripts/family-assets.mjs from
// the canonical lobby/shared/brand/) and the canonical kit it must equal.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const MIRROR_DIR = path.join(REPO, 'print-server', 'public', 'brand');
const KIT_DIR = path.join(REPO, '..', 'lobby', 'shared', 'brand');

// Every regular file under `dir`, as [{ file, sha256 }] with forward-slash
// relative paths, sorted. Symlinks are listed (and so fail the check) rather
// than followed: the installer copies files, and a link would ship as nothing.
function hashTree(dir) {
  const out = [];
  const walk = (abs, rel) => {
    for (const name of fs.readdirSync(abs).sort()) {
      const a = path.join(abs, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = fs.lstatSync(a);
      if (st.isDirectory()) walk(a, r);
      else if (st.isFile()) out.push({ file: r, sha256: crypto.createHash('sha256').update(fs.readFileSync(a)).digest('hex') });
      else out.push({ file: r, sha256: 'not-a-regular-file' });
    }
  };
  walk(dir, '');
  return out.sort((x, y) => (x.file < y.file ? -1 : x.file > y.file ? 1 : 0));
}

// The kit's text files (SVG, CSS, JSON, Markdown, the licence texts) are LF
// only. A CR in one means a line-ending conversion got to it: Git for Windows'
// default (core.autocrlf=true) checks text out as CRLF, and the installer is
// built on a Windows runner. Any file under `dir` that is not a font or an
// image and holds a '\r' is listed here, and the test refuses them.
// (lobby/.gitattributes keeps these types LF on checkout and normalises them
// on commit.)
const BINARY_EXTENSIONS = new Set(['.ttf', '.otf', '.woff', '.woff2', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf']);
function filesWithCarriageReturns(dir) {
  const out = [];
  const walk = (abs, rel) => {
    for (const name of fs.readdirSync(abs).sort()) {
      const a = path.join(abs, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = fs.lstatSync(a);
      if (st.isDirectory()) walk(a, r);
      else if (st.isFile() && !BINARY_EXTENSIONS.has(path.extname(name).toLowerCase())
        && fs.readFileSync(a).includes(0x0D)) out.push(r);
    }
  };
  walk(dir, '');
  return out;
}

module.exports = { REPO, MIRROR_DIR, KIT_DIR, hashTree, filesWithCarriageReturns };
