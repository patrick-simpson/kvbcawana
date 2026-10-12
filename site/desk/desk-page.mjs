// Builds the desk page's HTML: site/desk/index.html with the touch check-in's own
// touch-core block (search, households, family grouping) put where the template
// says /* TOUCH_CORE */. The block is read from the print app's phone page, which
// printer/scripts/sync-touch-core.cjs keeps equal to chrome-extension/touch.js
// (test-touch-search.cjs pins that), so the desk, the phone page and the laptop's
// touch screen find and group families exactly alike. site/build.mjs and the
// lobby's desk e2e both use this one function.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const BEGIN = '  // touch-core:begin';
const END = '  // touch-core:end';
export const TOUCH_CORE_PLACEHOLDER = '/* TOUCH_CORE */';
export const PHONE_PAGE = path.join(ROOT, 'printer', 'print-server', 'public', 'phone.html');

/** The touch-core block of a page's source, markers included. @param {string} src */
export function touchCore(src) {
  const a = src.indexOf(BEGIN);
  const b = src.indexOf(END);
  if (a < 0 || b < a) throw new Error('site/desk: the touch-core markers are not in the phone page');
  return src.slice(a, b + END.length);
}

/** @param {string} [phoneHtml] the phone page's source (default: the repo's) @param {string} [template] */
export function buildDeskPage(phoneHtml = readFileSync(PHONE_PAGE, 'utf8'), template = readFileSync(path.join(HERE, 'index.html'), 'utf8')) {
  if (!template.includes(TOUCH_CORE_PLACEHOLDER)) throw new Error('site/desk/index.html lost its touch-core placeholder');
  const page = template.replace(TOUCH_CORE_PLACEHOLDER, () => touchCore(phoneHtml));
  for (const fn of ['function norm(', 'function searchPeople(', 'function groupFamilies(']) {
    if (!page.includes(fn)) throw new Error(`site/desk: the touch core no longer has ${fn})`);
  }
  return page;
}
