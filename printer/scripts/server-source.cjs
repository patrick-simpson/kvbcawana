'use strict';
// The print server's source as one string: server.js plus every module under
// print-server/server/ (server.js was split into them; the suites that pin a
// route, a constant or a wiring detail by reading the source read it all).
// Modules come in load order, which is the order server.js requires them.
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'print-server');

// A module reaches another's names as `$module.name` (server/ modules). The
// suites pin code by its shape (`pruneEventBuffer();`, `isNewKid = ...`), which
// must not depend on which file a name lives in, so the namespaces are removed:
// the result reads as the single file it was before the split.
function serverSource() {
  const main = fs.readFileSync(path.join(dir, 'server.js'), 'utf8');
  const order = [...main.matchAll(/require\('\.\/server\/([\w-]+)'\)/g)].map((m) => m[1]);
  const names = order.map((n) => '$' + n.replace(/-(\w)/g, (_, c) => c.toUpperCase()));
  const ns = new RegExp('(?:' + names.map((n) => n.replace(/\$/g, '\\$')).join('|') + ')\\.', 'g');
  return [main, ...order.map((n) => fs.readFileSync(path.join(dir, 'server', n + '.js'), 'utf8'))]
    .join('\n').replace(ns, '');
}

module.exports = serverSource;
