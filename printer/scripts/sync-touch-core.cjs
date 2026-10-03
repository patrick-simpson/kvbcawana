#!/usr/bin/env node
// Copies touch.js's pure half (search, households, families, tile fit) into the
// phone page, between the same touch-core markers, so the phone and the laptop
// find, group and size families exactly alike. Run after editing that block;
// test-touch-search.cjs fails if the two differ.
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const BEGIN = '  // touch-core:begin';
const END = '  // touch-core:end';
function block(src) {
  const a = src.indexOf(BEGIN), b = src.indexOf(END);
  if (a < 0 || b < a) throw new Error('touch-core markers not found');
  return src.slice(a, b + END.length);
}
const touch = fs.readFileSync(path.join(root, 'chrome-extension', 'touch.js'), 'utf8');
const phonePath = path.join(root, 'print-server', 'public', 'phone.html');
const phone = fs.readFileSync(phonePath, 'utf8');
const next = phone.replace(block(phone), block(touch));
if (next !== phone) { fs.writeFileSync(phonePath, next); console.log('phone.html: touch core updated'); }
else console.log('phone.html: touch core already current');
module.exports = { block };
