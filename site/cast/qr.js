// The Cast QR code: the presenter page with the code in its fragment, drawn on a canvas.
// ONE copy for the TV (screen/screen.js, white on black) and the lobby computer's desk
// (desk/desk.js, dark on light). qrcode-generator 1.4.4 from cdnjs, checked by its
// fingerprint (subresource integrity, owner 2026-11-09: refuse an altered copy if the
// CDN were ever tampered with; cdnjs's own published sha512; change them together).
// A test may hand one in (window.castQr).

const QR_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
const QR_LIB_SRI = 'sha512-ZDSPMa/JM1D+7kdg2x3BsruQ6T/JpJo3jWDWkCZsP+5yVyp1KfESqLI+7RqB5k24F7p2cV7i2YHh/890y6P6Sw==';

let qrLib = null;
/** The library, loaded once. @returns {Promise<any>} */
export function qrcodeLib() {
  if (window.castQr) return Promise.resolve(window.castQr);
  if (!qrLib) {
    qrLib = new Promise((ok, no) => {
      const sc = document.createElement('script');
      sc.src = QR_LIB;
      sc.integrity = QR_LIB_SRI;
      sc.crossOrigin = 'anonymous';
      sc.onload = () => (typeof window.qrcode === 'function' ? ok(window.qrcode) : no(new Error('qr')));
      sc.onerror = () => { qrLib = null; no(new Error('qr')); };
      document.head.append(sc);
    });
  }
  return qrLib;
}

/**
 * Draws `text` as a QR code on `canvas` (a quiet zone of two modules, sharp pixels).
 * Throws when the library cannot load (the caller hides the box).
 * @param {HTMLCanvasElement} canvas @param {string} text @param {{ dark: string, light: string, size?: number }} colors
 */
export async function drawQrCode(canvas, text, { dark, light, size = 512 }) {
  const qrcode = await qrcodeLib();
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  const quiet = 2;
  const px = Math.max(4, Math.floor(size / (n + quiet * 2)));
  canvas.width = canvas.height = px * (n + quiet * 2);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = dark;
  for (let r = 0; r < n; r += 1) for (let col = 0; col < n; col += 1) if (q.isDark(r, col)) ctx.fillRect((col + quiet) * px, (r + quiet) * px, px, px);
}
