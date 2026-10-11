// Regenerates the module matrix in src/lib/alertsQr.js from its ALERTS_URL.
// Run after changing the URL:  node scripts/promo/alerts-qr.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import QRCode from 'qrcode';

const FILE = new URL('../../src/lib/alertsQr.js', import.meta.url);
const src = readFileSync(FILE, 'utf8');
const url = /export const ALERTS_URL = '([^']+)'/.exec(src)?.[1];
if (!url) throw new Error('alerts-qr: no ALERTS_URL in src/lib/alertsQr.js');

const { modules, version } = QRCode.create(url, { errorCorrectionLevel: 'Q' });
const rows = [];
for (let y = 0; y < modules.size; y += 1) {
  let row = '';
  for (let x = 0; x < modules.size; x += 1) row += modules.get(x, y) ? '1' : '0';
  rows.push(`  '${row}',`);
}
const next = src
  .replace(/export const ALERTS_QR_ROWS = Object\.freeze\(\[[\s\S]*?\]\);/, `export const ALERTS_QR_ROWS = Object.freeze([\n${rows.join('\n')}\n]);`)
  .replace(/\(version \d+,/, `(version ${version},`);
writeFileSync(FILE, next);
console.log(`alerts-qr: ${url} -> version ${version}, ${modules.size}x${modules.size}`);
