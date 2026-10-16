// The check-in page's HTML (awana.kvbchurch.org/checkin and /checkin/ym), made
// from its one source: the print app's phone page
// (printer/print-server/public/phone.html), whose touch-core block (search,
// households, tile fit) is tested by printer/scripts/test-checkin-search.cjs. The page reads the
// brand kit under /checkin/brand/ and imports the modules site/build.mjs serves
// beside it (CHECKIN_MODULES). site/build.mjs and the lobby's check-in e2e both
// use these functions, so the test drives exactly the page the site serves.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
export const PHONE_PAGE = path.join(ROOT, 'printer', 'print-server', 'public', 'phone.html');
const MARK = '<script>\n// ── Search, households, families and tile fit';

/** What the page imports at /checkin/<name>, and the one file each is served from. */
export const CHECKIN_MODULES = Object.freeze({
  'desk-transport.js': path.join(HERE, 'desk-transport.js'),
  'cloud-crypto.js': path.join(ROOT, 'shared', 'cloud-crypto.js'),
  'clubs.js': path.join(ROOT, 'shared', 'clubs.js'),
});

/**
 * @param {string} [phoneHtml] the phone page's source (default: the repo's)
 * @returns {{ index: string, ym: string }} /checkin/index.html and /checkin/ym/index.html
 */
export function buildCheckinPages(phoneHtml = readFileSync(PHONE_PAGE, 'utf8')) {
  const index = phoneHtml.replaceAll('"/brand/', '"/checkin/brand/');
  if (index === phoneHtml || index.includes('"/brand/') || !index.includes(MARK)) {
    throw new Error('site/checkin: phone.html no longer has the shape /checkin expects');
  }
  for (const name of Object.keys(CHECKIN_MODULES)) {
    if (!index.includes(`import('/checkin/${name}')`)) throw new Error(`site/checkin: the page no longer imports /checkin/${name}`);
  }
  if (/AWANA_RELAY|\/v1\/relay/.test(index)) throw new Error('site/checkin: the page still relays to the laptop');
  // The youth leaders' page (7.10.0): Trek and Journey only, check-in only.
  const ym = index.replace(MARK, `<script>window.AWANA_ONLY_CLUBS = ['trek', 'journey']; window.AWANA_SIMPLE = true;</script>\n${MARK}`);
  return { index, ym };
}
