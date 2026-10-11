import { describe, it, expect } from 'vitest';
import QRCode from 'qrcode';
import { ALERTS_QR_ROWS, ALERTS_SHORT, ALERTS_URL, alertsQrPath } from './alertsQr.js';

// The snow-alerts slide ships its QR code as fixed art. A parent who scans it
// must land on the church's notification sign-up, so the art is regenerated
// here from the URL and compared module by module.
describe('the snow-alerts QR code', () => {
  it('points at the church’s alerts sign-up, and prints the same address', () => {
    expect(ALERTS_URL).toBe('https://kvbchurch.org/alerts');
    expect(ALERTS_URL.endsWith(ALERTS_SHORT)).toBe(true);
  });

  it('is exactly the code the qrcode package makes for that URL', () => {
    const { modules } = QRCode.create(ALERTS_URL, { errorCorrectionLevel: 'Q' });
    expect(ALERTS_QR_ROWS).toHaveLength(modules.size);
    for (let y = 0; y < modules.size; y += 1) {
      let row = '';
      for (let x = 0; x < modules.size; x += 1) row += modules.get(x, y) ? '1' : '0';
      expect(ALERTS_QR_ROWS[y], `row ${y}`).toBe(row);
    }
  });

  it('draws every dark module and nothing else', () => {
    const { size, d } = alertsQrPath();
    expect(size).toBe(ALERTS_QR_ROWS.length);
    // Each run is "Mx yhNv1h-Nz": add up the runs and compare with the matrix.
    let painted = 0;
    for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
      const [, x, y, w] = m.map(Number);
      expect(ALERTS_QR_ROWS[y].slice(x, x + w)).toBe('1'.repeat(w));
      painted += w;
    }
    const dark = ALERTS_QR_ROWS.join('').split('').filter((c) => c === '1').length;
    expect(painted).toBe(dark);
  });

  it('keeps its three finder patterns, so a phone can find it', () => {
    const finder = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111'];
    const n = ALERTS_QR_ROWS.length;
    finder.forEach((row, i) => {
      expect(ALERTS_QR_ROWS[i].slice(0, 7)).toBe(row);
      expect(ALERTS_QR_ROWS[i].slice(n - 7)).toBe(row);
      expect(ALERTS_QR_ROWS[n - 7 + i].slice(0, 7)).toBe(row);
    });
  });
});
