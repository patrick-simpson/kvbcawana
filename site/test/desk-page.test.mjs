// The desk page's source (site/desk/): the touch core it injects is the
// touch check-in's own, what it links exists, and nothing leaves the site.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildDeskPage, touchCore } from '../desk/desk-page.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');

describe('the desk page', () => {
  const page = buildDeskPage();

  it('injects exactly the touch check-in\'s touch-core block (the laptop\'s touch.js is the source)', () => {
    const fromTouch = touchCore(read('printer', 'chrome-extension', 'touch.js'));
    assert.ok(page.includes(fromTouch), 'the desk page\'s search, households and grouping differ from touch.js');
    assert.ok(!page.includes('/* TOUCH_CORE */'));
  });

  it('every file it links or imports exists, and every import is one build.mjs ships', () => {
    for (const m of page.matchAll(/(?:href|src)="(\/lobby\/shared\/[^"]+)"/g)) {
      assert.ok(existsSync(path.join(ROOT, m[1].replace('/lobby/', 'lobby/'))), `${m[1]} is not in the lobby's shared/`);
    }
    assert.match(page, /<script type="module" src="\.\/desk\.js">/);
    const js = read('site', 'desk', 'desk.js');
    const imports = [...js.matchAll(/from '(\.\/[^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(imports.sort(), ['./cloud-crypto.js', './desk-transport.js']);
    const build = read('site', 'build.mjs');
    assert.match(build, /cloud-crypto\.js/);
    assert.match(build, /'desk\.js', 'desk-transport\.js'/);
    assert.match(read('site', 'desk', 'desk-transport.js'), /^(?![\s\S]*\bimport\b[^\n]*from)/, 'the transport takes the crypto module from its caller');
  });

  it('draws with the brand kit\'s faces and nothing from another host', () => {
    assert.match(page, /\/lobby\/shared\/brand\/fonts\.css/);
    assert.match(page, /Paytone One/);
    assert.match(page, /Londrina Solid/);
    assert.match(page, /Figtree/);
    const external = [...page.matchAll(/(?:href|src)="(https?:)?\/\/[^"]+"/g)];
    assert.deepEqual(external, []);
    assert.ok(!/fonts\.googleapis|@import|@font-face/.test(page));
    assert.ok(!/Galindo|Lilita/.test(page));
  });

  it('uses only the touch-core globals the block defines', () => {
    const js = read('site', 'desk', 'desk.js');
    for (const g of ['norm', 'searchPeople', 'groupFamilies']) assert.ok(page.includes(`function ${g}(`), `${g} is not in the block`);
    assert.match(js, /\/\* global norm, searchPeople, groupFamilies \*\//);
  });

  it('never stores the passphrase and names no medical field', () => {
    const js = read('site', 'desk', 'desk.js') + read('site', 'desk', 'desk-transport.js');
    assert.ok(!/localStorage\.setItem\([^)]*pass/i.test(js));
    assert.ok(!/allerg|medical/i.test(js));
  });
});
