// @ts-check
// ─────────────────────────────────────────────────────────────
// The QR code on the snow-alerts slide, drawn once and shipped as art.
//
// The URL never changes, so there is nothing to compute on the TV: this is
// the module matrix the `qrcode` package makes for it (version 3,
// error correction Q, which survives glare and a lobby's viewing angle).
// src/lib/alertsQr.test.js regenerates it with that package and fails if a
// single module differs, so editing the URL means regenerating this file:
//   node scripts/promo/alerts-qr.mjs
// ─────────────────────────────────────────────────────────────

export const ALERTS_URL = 'https://kvbchurch.org/alerts';

/** What the slide prints under the code, for anyone who would rather type. */
export const ALERTS_SHORT = 'kvbchurch.org/alerts';

/** One string per row, '1' for a dark module. */
export const ALERTS_QR_ROWS = Object.freeze([
  '11111110010001010111101111111',
  '10000010110000001010001000001',
  '10111010010000100110101011101',
  '10111010011011010011001011101',
  '10111010010010100001001011101',
  '10000010000000001000001000001',
  '11111110101010101010101111111',
  '00000000101101011011000000000',
  '11000010101000011001111000010',
  '00110101101111110010000111001',
  '10111110111100111000010100101',
  '01110000111001100010100100000',
  '11010011011010001111011001111',
  '01000100000110110001111101111',
  '11110111111100110111110110100',
  '11110000101000101010111110010',
  '01010010001110011000000011001',
  '11010100001001110110100010001',
  '01101110111001010111001010000',
  '00001001010111011110001111101',
  '00111011100001111101111111100',
  '00000000101010110001100010111',
  '11111110001111010101101010100',
  '10000010011100100001100011100',
  '10111010010001010101111110111',
  '10111010010111011101110100010',
  '10111010001000011100110000111',
  '10000010110010101000000111100',
  '11111110100001011110100110010',
]);

/**
 * The dark modules as one SVG path in a size x size box (one unit per
 * module), merged into horizontal runs so the path stays short.
 * @returns {{ size: number, d: string }}
 */
export function alertsQrPath() {
  const size = ALERTS_QR_ROWS.length;
  let d = '';
  ALERTS_QR_ROWS.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] !== '1') continue;
      let run = 1;
      while (row[x + run] === '1') run += 1;
      d += `M${x} ${y}h${run}v1h-${run}z`;
      x += run - 1;
    }
  });
  return { size, d };
}
