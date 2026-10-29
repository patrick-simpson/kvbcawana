// AWANA GRAND PRIX promo, in the official Grand Prix sub-brand (30.0 s, silent).
// One canvas, drawn from a single time value T (seconds). Layout space is 1920x1080;
// the canvas may be smaller (SC < 1 for the low-res check).
//
// Rhythm: 120 bpm grid (beat 0.5 s, bar 2 s); hits land on beats / eighths.
//   0.00- 6.00  OPENING   grainy black; checker bars race in from both edges and lock
//                         into the AWANA bar (1.5); GRAND (2.0) and PRIX (2.5) punch in
//                         (overshoot, speck burst, camera kick); the torn edge RIPS
//                         across revealing the red (3.0); card 1 rises in (3.5 / 4.0)
//   5.70- 6.25  whip pan into the race
//   6.00- 8.75  RACE      tracking shot down the ramp: four kit cars at different speeds,
//                         the truck drafts the stock car, pulls out and passes; the
//                         Indy car closes; parallax streaks, terrain, grain
//   8.75- 9.25  whip through the torn edge (the terrain surges over the lens and back)
//   9.25-13.60  FINISH    closer; the checkered finish band comes in; speed ramps down
//                         to slow motion (10.75-12.05) for the photo finish (#1 by a nose),
//                         snaps back; the cars blast out of frame
//  13.60-14.15  whip pan into the news
//  14.00-20.50  NEWS      starburst STAMPS (14.5); sub-line rises (15.0 / 15.25);
//                         grown-up's car and the kid's truck roll in, rev on the beat,
//                         GO (18.5): the kid's truck nips ahead; cruise
//  20.50-21.15  the black terrain surges over everything and rips away diagonally
//  21.15-22.30  END CARD  logo lands (21.25), headline (21.5), dates (21.7/21.85/22.0)
//  22.30-28.45  at rest (6.15 s)
//  28.45-29.00  the lobby's sun/orange waves sweep the card away into the lobby plate
//  29.00-30.00  the lobby plate, untouched (the video's last second IS the lobby)
/* eslint-disable no-unused-vars */
const CFG = window.CFG || { fps: 30, scale: 0.5 };
const W = 1920, H = 1080, FPS = CFG.fps, SC = CFG.scale, SHUT = 0.5 / FPS;
const RED = '#F04A4B', BLACK = '#232328', GRAIN = '#17171A', INK = GP.logoSolid.dark, WHITE = '#FFFFFF', BLUE = '#75A3D6';
const RED_DEEP = '#E2393A';                 // the far speed lines: one step darker than the field
const cv = document.getElementById('c'); cv.width = W * SC; cv.height = H * SC;
const ctx = cv.getContext('2d');

// ------------------------------------------------------------------ timing --
function bez(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t) => ((ax * t + bx) * t + cx) * t, Y = (t) => ((ay * t + by) * t + cy) * t;
  return (x) => { if (x <= 0) return 0; if (x >= 1) return 1; let lo = 0, hi = 1, t = x; for (let i = 0; i < 40; i++) { t = (lo + hi) / 2; if (X(t) < x) lo = t; else hi = t; } return Y(t); };
}
const E = {
  out: bez(0.16, 1, 0.3, 1), hard: bez(0.05, 0.9, 0.1, 1), inOut: bez(0.7, 0, 0.3, 1), in: bez(0.6, 0, 0.9, 0.3),
  whip: bez(0.85, 0, 0.15, 1), soft: bez(0.4, 0, 0.2, 1),
};
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const seg = (t, a, d) => clamp((t - a) / d);
const mix = (a, b, u) => a + (b - a) * u;
// damped spring 0 -> 1: overshoots, rings once, lands EXACTLY on 1 at u = 1
function spring(u, f = 1.6, k = 5.5) {
  if (u <= 0) return 0; if (u >= 1) return 1;
  const s = 1 - Math.exp(-k * u) * Math.cos(Math.PI * 2 * f * u * 0.5 + 0) ;
  return mix(s, 1, Math.pow(u, 5));
}
// a punch: from `from` to 1, arriving hard at `at` (dur before), then ringing out by `at + ring`
function punch(t, at, from, dur = 0.16, ring = 0.38, over = 0.07) {
  if (t < at - dur) return null;
  if (t < at) return mix(from, 1, E.in(seg(t, at - dur, dur)));
  const u = seg(t, at, ring); if (u >= 1) return 1;
  return 1 - over * Math.exp(-5 * u) * Math.sin(Math.PI * 2.2 * u) * (1 - u);
}
// keyframe track [[t, v], ...] with smooth (Catmull-Rom) interpolation, clamped
function track(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  const n = keys.length; if (t >= keys[n - 1][0]) return keys[n - 1][1];
  let i = 0; while (t > keys[i + 1][0]) i++;
  const [t1, p1] = keys[i], [t2, p2] = keys[i + 1];
  const p0 = i > 0 ? keys[i - 1][1] : p1 - (p2 - p1), p3 = i + 2 < n ? keys[i + 2][1] : p2 + (p2 - p1);
  const t0 = i > 0 ? keys[i - 1][0] : t1 - (t2 - t1), t3 = i + 2 < n ? keys[i + 2][0] : t2 + (t2 - t1);
  const u = (t - t1) / (t2 - t1), dt = t2 - t1;
  const m1 = (p2 - p0) / (t2 - t0) * dt, m2 = (p3 - p1) / (t3 - t1) * dt;
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p1 + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2 + (u3 - u2) * m2;
}
// a little deterministic noise
function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

// ------------------------------------------------------------------ assets --
const IMG = {};
function loadImg(k, src) { const im = new Image(); im.src = src; IMG[k] = im; return im.decode(); }
const P2 = (d) => new Path2D(d);
const LW = GP.logoWhite, LS = GP.logoSolid;
const PATH = {
  brush: P2(GP.brush.d), star: P2(GP.star.d),
  wCheckL: P2(LW.checkL), wAwana: P2(LW.awana), wCheckR: P2(LW.checkR), wWord: P2(LW.word), wTm: P2(LW.tm),
  sSil: P2(LS.sil), sDark: P2(LS.checkL + LS.awana + LS.checkR + LS.tm), sLetters: P2(LS.letters),
};
const FILL = [[130, 262], [160, 230], [200, 218], [240, 185], [280, 164], [320, 150], [360, 130], [400, 110], [440, 90], [480, 70], [520, 75], [560, 82], [600, 104], [620, 120], [620, -3000], [130, -3000]];
// small splatter blobs inside the brush path: the catalog's own specks, for impact bursts
const SPECKS = (() => {
  const out = [];
  for (const sub of GP.brush.d.split(/(?=M)/)) {
    const nums = sub.match(/-?\d+\.?\d*/g); if (!nums || nums.length < 8) continue;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let i = 0; i + 1 < nums.length; i += 2) { const x = +nums[i], y = +nums[i + 1]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const w = x1 - x0, h = y1 - y0;
    if (w > 2.2 && w < 9 && h > 1.6 && h < 8) out.push({ p: new Path2D(sub), cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, r: Math.max(w, h) / 2 });
  }
  return out;
})();
const CK = window.CARKIT;
const CARP = {}; for (const k in CK.BODY) CARP[k] = { body: P2(CK.BODY[k]), glass: CK.GLASS[k] ? P2(CK.GLASS[k]) : null };
let GRAIN_PAT = null;
async function loadAll() {
  await Promise.all([
    loadImg('grain', 'assets/grain-tile.png'),
    loadImg('church', '../../../../shared/brand/logos/kvbc-awana-two-line-white.svg'),
    CFG.plate ? loadImg('plate', CFG.plate) : null,
  ]);
  for (const w of [600, 700, 800, 900]) await document.fonts.load(`${w} 40px Figtree`);
  GRAIN_PAT = ctx.createPattern(IMG.grain, 'repeat');
}

// --------------------------------------------------------------- layers -----
// Every layer is a full-frame canvas in device px. smear() lays a layer onto a target
// with true motion blur for a translation: N copies across the shutter, added in a
// float accumulator (8-bit would lose a 1/N add).
const POOL = [];
function layer(base) {
  let c = POOL.pop();
  if (!c) { c = document.createElement('canvas'); c.width = W * SC; c.height = H * SC; }
  const x = c.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
  x.clearRect(0, 0, c.width, c.height); x.setTransform(base ? base.getTransform() : new DOMMatrix([SC, 0, 0, SC, 0, 0]));
  return c;
}
function free(c) { POOL.push(c); }
const ACC = document.createElement('canvas'); ACC.width = W * SC; ACC.height = H * SC;
const accx = ACC.getContext('2d', { colorType: 'float16' });
const ACC2 = document.createElement('canvas'); ACC2.width = W * SC; ACC2.height = H * SC;
const acc2 = ACC2.getContext('2d', { colorType: 'float16' });
const MAXB = 34;                             // longest blur streak (layout px): motion reads, shapes stay crisp
function smear(target, src, dx, dy) {       // dx, dy: layout px travelled over the shutter
  const L0 = Math.hypot(dx, dy); if (L0 > MAXB) { dx *= MAXB / L0; dy *= MAXB / L0; }
  const n = Math.min(48, Math.ceil(Math.hypot(dx, dy) * SC * 0.9));
  target.save(); target.setTransform(1, 0, 0, 1, 0, 0);
  if (n <= 1) { target.drawImage(src, 0, 0); target.restore(); return; }
  accx.setTransform(1, 0, 0, 1, 0, 0); accx.globalCompositeOperation = 'source-over'; accx.globalAlpha = 1;
  accx.clearRect(0, 0, ACC.width, ACC.height);
  accx.globalCompositeOperation = 'lighter'; accx.globalAlpha = 1 / n;
  for (let i = 0; i < n; i++) { const f = 1 - (i + 0.5) / n; accx.drawImage(src, -dx * f * SC, -dy * f * SC); }
  target.drawImage(ACC, 0, 0); target.restore();
}
// motion blur by re-drawing a cheap subject at sub-frame times (for scale / rotation)
function multi(target, T, travel, draw, maxN = 24) {
  const span = SHUT * Math.min(1, MAXB / Math.max(1e-6, travel)); travel = Math.min(travel, MAXB);
  const n = Math.max(1, Math.min(maxN, Math.ceil(travel * SC * 0.9)));
  if (n === 1) { draw(target, T); return; }
  const M = target.getTransform();
  const L = layer(target), lx = L.getContext('2d');
  acc2.setTransform(1, 0, 0, 1, 0, 0); acc2.globalCompositeOperation = 'source-over'; acc2.globalAlpha = 1; acc2.clearRect(0, 0, ACC2.width, ACC2.height);
  for (let i = 0; i < n; i++) {
    lx.setTransform(1, 0, 0, 1, 0, 0); lx.clearRect(0, 0, L.width, L.height); lx.setTransform(M);
    draw(lx, T - span * (1 - (i + 0.5) / n));
    acc2.globalCompositeOperation = 'lighter'; acc2.globalAlpha = 1 / n; acc2.drawImage(L, 0, 0);
  }
  free(L);
  target.save(); target.setTransform(1, 0, 0, 1, 0, 0); target.drawImage(ACC2, 0, 0); target.restore();
}

// ------------------------------------------------------------- the terrain --
// A long torn edge: copies of the catalog brush laid end to end along a line, plus a
// half-plane filler on the black side; the grain sits on it in world space.
// line: {ox, oy, a (deg, screen), s, rot, fy, side: +1 black below / -1 above}
function lineFrame(L) {
  const a = L.a * Math.PI / 180, u = [Math.cos(a), Math.sin(a)];
  const nb = L.side > 0 ? [-u[1], u[0]] : [u[1], -u[0]];      // unit normal into the black
  return { u, nb };
}
// draw the black field. off: shift along the normal into the red (px); p0, p1: span along the line
function terrain(c, L, off = 0, p0 = -2600, p1 = 2600) {
  const { u, nb } = lineFrame(L);
  const ox = L.ox - nb[0] * off, oy = L.oy - nb[1] * off;
  const step = 420 * L.s;
  c.fillStyle = BLACK;
  // filler: everything deeper than 70 brush units into the black
  const D = 70 * L.s, F = 6000;
  c.beginPath();
  const P = (p, d) => [ox + u[0] * p + nb[0] * d, oy + u[1] * p + nb[1] * d];
  for (const [p, d] of [[p0 - step, D], [p1 + step, D], [p1 + step, F], [p0 - step, F]]) { const [x, y] = P(p, d); c.lineTo(x, y); }
  c.closePath(); c.fill();
  const k0 = Math.floor(p0 / step) - 1, k1 = Math.ceil(p1 / step) + 1;
  for (let k = k0; k <= k1; k++) {
    const [x, y] = P(k * step, 0);
    c.save(); c.translate(x, y); c.rotate(L.rot * Math.PI / 180); c.scale(L.s, L.s * L.fy); c.translate(-380, -300);
    c.fill(PATH.brush);
    if (L.fill) { c.beginPath(); for (const [fx, fy] of FILL) c.lineTo(fx, fy); c.closePath(); c.fill(); }
    c.restore();
  }
  // grain, in the same world space, only on the black
  c.save(); c.globalCompositeOperation = 'source-atop';
  const g = GRAIN_PAT; g.setTransform(new DOMMatrix().translate(L.gx || 0, L.gy || 0).scale(1.1));
  c.fillStyle = g; c.fillRect(-4000, -4000, 12000, 12000); c.restore();
}

// ------------------------------------------------------------------- logos --
function logoWhite(c, x, y, w, parts = {}) {
  const k = w / LW.w, per = 3 * LW.checkPeriod;
  c.save(); c.translate(x, y); c.scale(k, k); c.fillStyle = WHITE;
  const P = (path, tf) => {
    if (!tf) { c.fill(path); return; }
    c.save(); c.translate(tf.px, tf.py); c.scale(tf.s, tf.s); c.translate(-tf.px, -tf.py); c.globalAlpha *= tf.a ?? 1; c.fill(path); c.restore();
  };
  // checker strips (with their runs out to the edges)
  if (parts.checks !== false) {
    const dl = (parts.dl || 0) / k, dr = (parts.dr || 0) / k;
    const nl = Math.ceil(((parts.extL || 0) / k) / per), nr = Math.ceil(((parts.extR || 0) / k) / per);
    c.save(); c.translate(dl, 0); for (let i = 0; i <= nl; i++) { c.save(); c.translate(-i * per, 0); c.fill(PATH.wCheckL); c.restore(); } c.restore();
    c.save(); c.translate(dr, 0); for (let i = 0; i <= nr; i++) { c.save(); c.translate(i * per, 0); c.fill(PATH.wCheckR); c.restore(); } c.restore();
  }
  if (parts.awana) P(PATH.wAwana, parts.awana);
  // the word, row by row (GRAND above the split, PRIX below), each with its own punch
  const SPLIT = 35.2;
  for (const [row, tf] of [['top', parts.grand], ['bot', parts.prix]]) {
    if (!tf) continue;
    c.save(); c.beginPath();
    if (row === 'top') c.rect(-50, -50, LW.w + 100, SPLIT + 50); else c.rect(-50, SPLIT, LW.w + 100, 200);
    c.clip(); P(PATH.wWord, tf); c.restore();
  }
  if (parts.tm) P(PATH.wTm, parts.tm);
  c.restore();
  return { k, h: LW.h * k };
}
function logoSolid(c, x, y, w) {
  const k = w / LS.w;
  c.save(); c.translate(x, y); c.scale(k, k);
  c.fillStyle = INK; c.fill(PATH.sSil); c.fill(PATH.sDark); c.fillStyle = WHITE; c.fill(PATH.sLetters); c.restore();
  return { k, h: LS.h * k };
}

// -------------------------------------------------------------------- type --
const TYPE = {
  head: { w: 700, ls: -0.022, lh: 0.98 }, read: { w: 600, ls: -0.008, lh: 1.22 }, caps: { w: 800, ls: -0.01, lh: 1.0 },
};
function font(c, st, size) { c.font = `${st.w} ${size}px Figtree`; c.letterSpacing = `${st.ls * size}px`; c.fontKerning = 'normal'; c.textBaseline = 'alphabetic'; }
// baseline of line i in a CSS line box starting at `top`
function baseline(c, st, size, top, i, lhOverride) {
  font(c, st, size); const m = c.measureText('Hg');
  const A = m.fontBoundingBoxAscent, D = m.fontBoundingBoxDescent, LH = (lhOverride || st.lh) * size;
  return top + i * LH + (LH - (A + D)) / 2 + A;
}
// one line of type rising out of a mask (its own line box): r = 0 hidden .. 1 at rest
function riseLine(c, runs, x, y, size, st, r, align = 'left', lh) {
  if (r <= 0) return;
  font(c, st, size);
  const LH = (lh || st.lh) * size;
  c.save();
  if (r < 1) { c.beginPath(); c.rect(x - 2000, y - size * 1.02, 6000, size * 1.32); c.clip(); }
  const dy = (1 - E.hard(r)) * size * 1.15;
  let wsum = 0; for (const [s, col, sst] of runs) { font(c, sst || st, size); wsum += c.measureText(s).width; }
  let xx = align === 'center' ? x - wsum / 2 : x;
  for (const [s, col, sst] of runs) { font(c, sst || st, size); c.fillStyle = col; c.textAlign = 'left'; c.fillText(s, xx, y + dy); xx += c.measureText(s).width; }
  c.restore();
}

// -------------------------------------------------------------------- cars --
function drawCar(c, kind, p, spin = 0, pitch = 0) {
  const P = CARP[kind];
  c.save();
  if (pitch) { c.translate(CK.REAR, CK.AX); c.rotate(-pitch); c.translate(-CK.REAR, -CK.AX); }
  c.fillStyle = p.body; c.fill(P.body);
  if (p.stripes) { c.save(); c.clip(P.body); for (const [y, h, col] of p.stripes) { c.fillStyle = col; c.fillRect(-10, y, 430, h); } c.restore(); }
  if (P.glass) { c.fillStyle = p.glass || '#1A1A1F'; c.fill(P.glass); }
  if (p.num != null) {
    const [dx, dy] = CK.DEC[kind], r = 22;
    c.fillStyle = p.numBg || WHITE; c.beginPath(); c.arc(dx, dy, r, 0, 7); c.fill();
    c.font = `900 ${r * 1.05}px Figtree`; c.letterSpacing = '-1px'; c.textAlign = 'center'; c.fillStyle = p.numFg || BLACK;
    c.fillText(String(p.num), dx, dy + r * 0.36);
  }
  c.restore();
  for (const ax of [CK.REAR, CK.FRONT]) {
    c.save(); c.translate(ax, CK.AX);
    c.fillStyle = '#111114'; c.beginPath(); c.arc(0, 0, CK.WR, 0, 7); c.fill();
    c.fillStyle = '#2B2B31'; c.beginPath(); c.arc(0, 0, CK.WR * 0.64, 0, 7); c.fill();
    const fast = Math.abs(p.spinRate || 0) > 9;
    if (fast) { c.strokeStyle = '#3A3A42'; c.lineWidth = 4; c.beginPath(); c.arc(0, 0, CK.WR * 0.42, 0, 7); c.stroke(); }
    else { c.fillStyle = '#111114'; for (let i = 0; i < 3; i++) { const q = spin + i * 2.0944; c.beginPath(); c.arc(Math.cos(q) * 12, Math.sin(q) * 12, 4.2, 0, 7); c.fill(); } }
    c.fillStyle = '#C9C9D0'; c.beginPath(); c.arc(0, 0, CK.WR * 0.16, 0, 7); c.fill();
    c.restore();
  }
}
// white streaks off a car's tail (local units): [y, len, w, x0]; k scales length (speed)
function carStreaks(c, spec, k, flutter = 0) {
  if (k <= 0.01) return;
  c.strokeStyle = WHITE; c.lineCap = 'round';
  spec.forEach(([y, len, w, x0], i) => {
    const L = len * k * (1 + flutter * 0.08 * Math.sin(i * 2.1 + flutter * 7));
    c.lineWidth = w; c.beginPath(); c.moveTo(-x0, y); c.lineTo(-x0 - L, y); c.stroke();
  });
}
const PAINT = {
  indy: { body: BLACK, stripes: [[-58, 8, WHITE]], num: 4, glass: '#111114' },
  truck: { body: BLUE, stripes: [[-50, 8, WHITE]], num: 7, glass: BLACK },
  stock: { body: WHITE, stripes: [[-58, 12, RED], [-40, 5, BLACK]], num: 8, numBg: BLACK, numFg: WHITE },
  awana: { body: WHITE, stripes: [[-60, 14, BLUE], [-40, 6, BLUE]], num: 1, numBg: BLUE, numFg: WHITE },
  kid: { body: BLUE, stripes: [[-50, 8, WHITE]], num: 3, glass: BLACK },
  sleek: { body: WHITE, stripes: [[-56, 12, RED], [-38, 5, RED]], num: 1, numBg: RED, numFg: WHITE, glass: BLACK },
};
const STREAK = [[-52, 760, 6, 34], [-84, 420, 6, 70], [-20, 520, 4, 50]];

// ------------------------------------------------------------ impact specks --
// light specks flung from an impact point (layout px), t since impact
function specks(c, t, cx, cy, spread, seed, col, n = 16, scale = 2.4) {
  if (t < 0 || t > 0.6 || !SPECKS.length) return;
  const u = E.out(clamp(t / 0.55)), fade = 1 - seg(t, 0.25, 0.35);
  c.save(); c.fillStyle = col; c.globalAlpha *= fade;
  for (let i = 0; i < n; i++) {
    const a = hash(seed + i) * Math.PI * 2, d = spread * (0.45 + 0.75 * hash(seed + i * 3.7)) * u;
    const sp = SPECKS[Math.floor(hash(seed + i * 9.1) * SPECKS.length)];
    const sz = scale * (0.7 + 0.8 * hash(seed + i * 5.3)) * (1 - 0.5 * u);
    c.save(); c.translate(cx + Math.cos(a) * d * 1.5, cy + Math.sin(a) * d * 0.8); c.rotate(a); c.scale(sz, sz); c.translate(-sp.cx, -sp.cy); c.fill(sp.p); c.restore();
  }
  c.restore();
}
// camera kick: a 2-3 frame shove that settles (layout px)
function kick(T, hits) {
  let x = 0, y = 0;
  for (const [at, amp] of hits) {
    const t = T - at; if (t < 0 || t > 0.12) continue;
    const e = Math.exp(-t * 38) * Math.cos(t * 70);
    x += amp * 0.55 * e; y += amp * e;
  }
  return [x, y];
}

// =============================================================== OPENING ======
const L1 = { ox: 960, oy: 525, a: -26.8, s: 4.4, rot: 0, fy: 1, side: -1, fill: true };
const LOGO1 = { x: 120, y: 128, w: 860 };
function opening(c, T) {
  // background: red under everything; the black field covers it until the rip
  c.fillStyle = RED; c.fillRect(0, 0, W, H);
  const ripOff = (t) => {
    if (t < 3.0 - 0.22) return 2300;
    if (t < 3.0) return mix(2300, 0, E.in(seg(t, 2.78, 0.22)) );   // tears across, accelerating
    return -26 * Math.exp(-(t - 3) * 9) * Math.sin((t - 3) * 18);     // overshoot and settle
  };
  const L = layer(c), lx = L.getContext('2d');
  terrain(lx, { ...L1, gx: -T * 14, gy: -T * 6 }, ripOff(T));
  const r0 = ripOff(T), r1 = ripOff(T - SHUT), { nb } = lineFrame(L1);
  smear(c, L, -nb[0] * (r0 - r1), -nb[1] * (r0 - r1)); free(L);

  // checker strips race in from the edges and lock at 1.5
  const arrive = (t, from) => {
    const u = seg(t, 0.45, 1.05);
    if (u >= 1) { const v = t - 1.5; return v < 0.3 ? from * 0.012 * Math.exp(-v * 14) * Math.sin(v * 40) : 0; }
    return from * (1 - E.hard(u));
  };
  const drawLogo = (cc, t) => {
    const dl = arrive(t, -1500), dr = arrive(t, 1700);
    const aw = punch(t, 1.5, 1.45, 0.1, 0.35, 0.08), gr = punch(t, 2.0, 1.9, 0.14, 0.4, 0.06), pr = punch(t, 2.5, 2.1, 0.14, 0.45, 0.07);
    const LWk = LOGO1.w / LW.w;
    const tfm = (s, px, py, a0) => s == null ? null : { s, px, py, a: clamp(seg(t, a0, 0.05)) };
    logoWhite(cc, LOGO1.x, LOGO1.y, LOGO1.w, {
      dl, dr, extL: 140, extR: 1000, checks: t > 0.4,
      awana: tfm(aw, 70, 4, 1.42), grand: tfm(gr, 64, 22, 1.86), prix: tfm(pr, 66, 46, 2.36),
      tm: t >= 2.5 ? { s: 1, px: 0, py: 0, a: 1 } : null,
    });
  };
  // blur: the strips travel fast; the punches scale
  const sp = Math.abs(arrive(T, 1700) - arrive(T - SHUT, 1700));
  const sc = (at, from) => { const a = punch(T, at, from, 0.14), b = punch(T - SHUT, at, from, 0.14); return a == null || b == null ? 0 : Math.abs(a - b) * 700; };
  multi(c, T, Math.max(sp, sc(1.5, 1.45), sc(2.0, 1.9), sc(2.5, 2.1)), drawLogo, 32);
  // speck bursts on the big hits (light specks, the catalog's #DEDEDF)
  specks(c, T - 2.0, 560, 300, 300, 11, '#DEDEDF', 14, 4.2);
  specks(c, T - 2.5, 560, 420, 420, 23, '#DEDEDF', 20, 5.0);
  // card 1
  const top = 772, size = 104;
  const b0 = baseline(c, TYPE.head, size, top, 0), b1 = baseline(c, TYPE.head, size, top, 1);
  riseLine(c, [['The Awana Grand Prix', WHITE]], 760, b0, size, TYPE.head, seg(T, 3.5, 0.5));
  riseLine(c, [['is back.', WHITE]], 760, b1, size, TYPE.head, seg(T, 4.0, 0.5));
}

// ================================================================== RACE ======
// Five shots, cut on the beat: A close tracking on #1 (6.0), B the pack whips past the
// lens (7.5), C the wide with an overtake (8.5, torn-edge wipe), D the truck pulls out of
// the draft (9.5), E the slow-motion photo finish on the leaders' noses (10.5, wipe).
const RAD = Math.PI / 180;
const DEG2 = 14, M2 = Math.tan(DEG2 * RAD), Y2 = 560;
const U2 = [Math.cos(DEG2 * RAD), Math.sin(DEG2 * RAD)], N2 = [U2[1], -U2[0]];
const atLine = (t, d, y0 = Y2) => [t * U2[0] + d * N2[0], y0 + t * U2[1] + d * N2[1]];
const L2 = { ox: 960, oy: Y2 + M2 * 960, a: DEG2, s: 5.2, rot: DEG2 - 26.8, fy: -1, side: 1, fill: true };
const mkLine = (ox, oy, a, s) => ({ ox, oy, a, s, rot: a - 26.8, fy: -1, side: 1, fill: true });
// a point d px above the torn edge, p px along it
function lineAt(L, p, d) { const { u, nb } = lineFrame(L); return [L.ox + u[0] * p - nb[0] * d, L.oy + u[1] * p - nb[1] * d]; }
// race time: the speed ramp for the photo finish
const SPD = (T) => {
  if (T < 10.85) return 1;
  if (T < 11.1) return mix(1, 0.08, E.inOut(seg(T, 10.85, 0.25)));
  if (T < 11.8) return 0.08;
  if (T < 12.0) return mix(0.08, 1.2, E.in(seg(T, 11.8, 0.2)));
  return 1.2;
};
const WARP = (() => {
  const tab = []; let acc = 0; const dt = 1 / 1200;
  for (let T = 0; T <= 31; T += dt) { tab.push(acc); acc += SPD(T) * dt; }
  return (T) => { const f = clamp(T, 0, 31) * 1200, i = Math.floor(f); return mix(tab[i], tab[Math.min(i + 1, tab.length - 1)], f - i); };
})();
const bob = (t, k) => Math.sin(t * 23 + k * 1.7) * 2.2 + Math.sin(t * 37 + k) * 1.2;
function ground(c, L, scroll, T) {
  const sc = scroll(T), sp = scroll(T - SHUT), { u } = lineFrame(L);
  const Lt = layer(c), lx = Lt.getContext('2d');
  lx.save(); lx.translate(-u[0] * sc, -u[1] * sc); terrain(lx, L, 0, sc - 3400, sc + 3400); lx.restore();
  smear(c, Lt, -u[0] * (sc - sp), -u[1] * (sc - sp)); free(Lt);
}
function farLines(c, a, off, offP, seed = 0) {
  const Lr = layer(c), lx = Lr.getContext('2d');
  lx.strokeStyle = RED_DEEP; lx.lineCap = 'round';
  lx.save(); lx.translate(W / 2, H / 2); lx.rotate(a * RAD); lx.translate(-W / 2, -H / 2);
  for (let i = 0; i < 10; i++) {
    const per = 2800, len = 360 + 560 * hash(i * 3.1 + seed), y = -120 + i * 130 + 40 * hash(i + seed);
    const x = ((hash(i * 7.7 + seed) * per - off) % per + per) % per - 400;
    lx.lineWidth = 5 + 4 * hash(i * 2.3 + seed); lx.beginPath(); lx.moveTo(x, y); lx.lineTo(x + len, y); lx.stroke();
  }
  lx.restore();
  smear(c, Lr, -(off - offP) * Math.cos(a * RAD), -(off - offP) * Math.sin(a * RAD)); free(Lr);
}
// foreground whips: thick white strokes tearing past low over the terrain. tf: time -> clock
function fgWhips(c, T, t0, t1, a, y0, y1, tf = (t) => t) {
  const Lf = layer(c), lx = Lf.getContext('2d'); let any = false, v = 0;
  const now = tf(T), prev = tf(T - SHUT);
  for (let i = 0; i < 40; i++) {
    const ts = t0 + i * 0.25 + 0.08 * hash(i + 9), life = 0.3; if (ts > t1) break;
    const q = (now - ts) / life; if (q < 0 || q > 1) continue;
    any = true;
    const y = mix(y0, y1, hash(i * 4.4)), len = 700 + 700 * hash(i * 1.9), wdt = 10 + 12 * hash(i * 8.1), span = W + 600 + len;
    const x = W + 200 - span * q; v = span / life * (now - prev);
    lx.save(); lx.translate(W / 2, H / 2); lx.rotate(a * RAD); lx.translate(-W / 2, -H / 2);
    lx.strokeStyle = WHITE; lx.lineCap = 'round'; lx.lineWidth = wdt; lx.beginPath(); lx.moveTo(x, y); lx.lineTo(x + len, y); lx.stroke(); lx.restore();
  }
  if (any) smear(c, Lf, -v * Math.cos(a * RAD), -v * Math.sin(a * RAD));
  free(Lf);
}
// one car on its own layer, blurred along its own screen motion. f(t) -> {kind, paint, x, y, a, s, k, spin, spinRate, pitch}
function carLayer(c, T, f) {
  const A = f(T); if (!A) return; const B = f(T - SHUT) || A;
  const Lc = layer(c), lx = Lc.getContext('2d');
  lx.save(); lx.translate(A.x, A.y); lx.rotate(A.a * RAD); lx.scale(A.s, A.s);
  carStreaks(lx, A.streaks || STREAK, A.k ?? 0, T * 3);
  drawCar(lx, A.kind, { ...A.paint, spinRate: A.spinRate ?? 0 }, A.spin ?? 0, A.pitch ?? 0);
  lx.restore();
  smear(c, Lc, A.x - B.x, A.y - B.y); free(Lc);
}
const ON = (L, p, d, t, k) => lineAt(L, p, d + bob(t, k));

// A: low and close on #1, the terrain rushing; #8's nose creeps in behind
const LA = mkLine(960, 900, 7, 7.2);
function shotA(c, T) {
  c.fillStyle = RED; c.fillRect(0, 0, W, H);
  const scroll = (t) => 3400 * t;
  farLines(c, 7, scroll(T) * 0.3, scroll(T - SHUT) * 0.3, 1);
  ground(c, LA, scroll, T);
  carLayer(c, T, (t) => { const [x, y] = ON(LA, mix(-2300, -1450, E.soft(seg(t, 6.25, 1.25))), 300, t, 2); return { kind: 'stock', paint: PAINT.stock, x, y, a: 7, s: 1.9, k: 1, spin: -scroll(t) / 63, spinRate: 99 }; });
  carLayer(c, T, (t) => { const [x, y] = ON(LA, mix(-470, -370, E.soft(seg(t, 5.9, 1.6))), 46, t, 1); return { kind: 'awana', paint: PAINT.awana, x, y, a: 7, s: 1.9, k: 1, spin: -scroll(t) / 63, spinRate: 99 }; });
  fgWhips(c, T, 6.05, 7.4, 7, 1010, 1070);
}
// B: the pack whips past the lens, far lanes first, #8 and #1 side by side
const LB = mkLine(960, 1010, 3, 6.6);
function shotB(c, T) {
  c.fillStyle = RED; c.fillRect(0, 0, W, H);
  const scroll = (t) => 700 * t;
  farLines(c, 3, scroll(T) * 0.3, scroll(T - SHUT) * 0.3, 2);
  ground(c, LB, scroll, T);
  for (const [k, t0, s, d] of [['indy', 7.34, 1.7, 560], ['truck', 7.5, 2.0, 420], ['stock', 7.72, 2.4, 250], ['awana', 7.95, 2.8, 40]]) {
    carLayer(c, T, (t) => {
      const q = (t - t0) / 0.46; if (q < -0.05 || q > 1.05) return null;
      const xr = mix(-420 * s - 120, W + 140, q);
      const [x, y] = ON(LB, xr - 960, d, t, s * 3);
      return { kind: k, paint: PAINT[k], x, y, a: 3, s, k: 0.8, spin: -xr / (33 * s), spinRate: 99 };
    });
  }
}
// C: the wide: #1 and #8 dicing up front, the truck tucked in #8's draft, the Indy car
// coming through the field and passing the truck
function worldPt(cam, wx, wy) { return [W / 2 + cam.cx + cam.z * (wx - W / 2 - U2[0] * cam.c), H / 2 + cam.cy + cam.z * (wy - H / 2 - U2[1] * cam.c)]; }
const C_CARS = {
  indy: { rel: [[-0.3, 60], [0.4, 520], [1.0, 1000]], d: 470 },
  truck: { rel: [[-0.3, 640], [1.0, 830]], d: 190 },
  stock: { rel: [[-0.3, 1120], [1.0, 1310]], d: 190 },
  awana: { rel: [[-0.3, 1290], [1.0, 1350]], d: 40 },
};
function shotC(c, T) {
  c.fillStyle = RED; c.fillRect(0, 0, W, H);
  const camAt = (t) => ({ c: 1750 * (t - 8.5), z: mix(0.8, 0.88, E.soft(seg(t, 8.3, 1.25))), cx: -130, cy: 40 });
  const cam = camAt(T), camP = camAt(T - SHUT);
  farLines(c, 14, cam.c * 0.35, camP.c * 0.35, 3);
  {
    const Lt = layer(c), lx = Lt.getContext('2d');
    lx.save(); lx.translate(W / 2 + cam.cx, H / 2 + cam.cy); lx.scale(cam.z, cam.z); lx.translate(-W / 2 - U2[0] * cam.c, -H / 2 - U2[1] * cam.c);
    terrain(lx, L2, 0, cam.c - 4200, cam.c + 4200); lx.restore();
    const dc = (cam.c - camP.c) * cam.z; smear(c, Lt, -U2[0] * dc, -U2[1] * dc); free(Lt);
  }
  for (const k of ['indy', 'truck', 'stock', 'awana']) {
    carLayer(c, T, (t) => {
      const cm = camAt(t), C0 = C_CARS[k], rel = track(C0.rel, t - 8.5);
      const [wx, wy] = atLine(cm.c + rel, C0.d + bob(t, k.length));
      const [x, y] = worldPt(cm, wx, wy);
      return { kind: k, paint: PAINT[k], x, y, a: DEG2, s: 1.05 * cm.z, k: 1, spin: -(cm.c + rel) / 35, spinRate: 99 };
    });
  }
  fgWhips(c, T, 8.6, 9.45, 14, 1000, 1060);
}
// D: close on the truck in #8's draft; it pulls out and drives past
const LD = mkLine(960, 935, 9, 6.6);
function shotD(c, T) {
  c.fillStyle = RED; c.fillRect(0, 0, W, H);
  const scroll = (t) => 3200 * t;
  farLines(c, 9, scroll(T) * 0.3, scroll(T - SHUT) * 0.3, 4);
  ground(c, LD, scroll, T);
  const truck = (t) => {
    const out = E.inOut(seg(t, 9.7, 0.3)), surge = E.in(seg(t, 9.95, 0.62));
    const [x, y] = ON(LD, -760 + 60 * (t - 9.5) + 1500 * surge, 46 + 310 * out, t, 5);
    return { kind: 'truck', paint: PAINT.truck, x, y, a: 9, s: 1.7, k: 0.55 + 0.45 * surge, spin: -scroll(t) / 56, spinRate: 99, pitch: 0.035 * Math.sin(out * Math.PI) + 0.02 * Math.sin(clamp(surge * 2) * Math.PI) };
  };
  const stock = (t) => { const [x, y] = ON(LD, -20 + 30 * (t - 9.5), 46, t, 6); return { kind: 'stock', paint: PAINT.stock, x, y, a: 9, s: 1.7, k: 1, spin: -scroll(t) / 56, spinRate: 99 }; };
  // once the truck is out in its own lane it runs behind #8 (drawn first)
  if (T > 9.85) { carLayer(c, T, truck); carLayer(c, T, stock); } else { carLayer(c, T, stock); carLayer(c, T, truck); }
  fgWhips(c, T, 9.55, 10.6, 9, 1010, 1070);
}
// E: the photo finish, close on the two leaders' noses; slow motion through the line
const LE = mkLine(960, 995, 5, 7.4);
const PN = 520, TXE = 11.45;
function shotE(c, T) {
  c.fillStyle = RED; c.fillRect(0, 0, W, H);
  const scroll = (t) => 3400 * WARP(t);
  farLines(c, 5, scroll(T) * 0.3, scroll(T - SHUT) * 0.3, 5);
  ground(c, LE, scroll, T);
  // the finish line: a band of the logo's checkers standing across the track
  {
    const bandP = (t) => PN + 3400 * (WARP(TXE) - WARP(t));
    const p = bandP(T), pp = bandP(T - SHUT);
    if (p > -1400 && p < 1400) {
      const Lb = layer(c), bx = Lb.getContext('2d');
      const [x, y] = lineAt(LE, p, 0);
      bx.save(); bx.translate(x, y); bx.rotate(5 * RAD);
      const sq = 46;
      for (let col = 0; col < 2; col++) for (let row = 0; row < 26; row++) { bx.fillStyle = (row + col) % 2 ? BLACK : WHITE; bx.fillRect(-sq + col * sq, -row * sq - sq + 30, sq, sq); }
      bx.restore();
      const { u } = lineFrame(LE); smear(c, Lb, u[0] * (p - pp), u[1] * (p - pp)); free(Lb);
    }
  }
  const tr = (t) => WARP(t) - WARP(TXE);
  const blast = (t, d) => { const v = seg(t, 12.1 + d, 0.75); return 2800 * v * v; };
  const lead = (key, t) => key === 'awana' ? track([[-1.4, -90], [-0.5, -40], [0, 22], [0.3, 40]], tr(t)) : track([[-1.4, 60], [-0.5, 34], [0, 0], [0.3, -16]], tr(t));
  const car = (key, s, d, k) => (t) => {
    const nose = PN + lead(key, t) + blast(t, key === 'awana' ? 0 : 0.06);
    const [x, y] = ON(LE, nose - 400 * s, d, t, k);
    return { kind: key, paint: PAINT[key], x, y, a: 5, s, k: 1, spin: -scroll(t) / (33 * s), spinRate: 3400 * SPD(t) / (33 * s) };
  };
  carLayer(c, T, car('stock', 2.2, 300, 3));
  carLayer(c, T, car('awana', 2.35, 48, 4));
  fgWhips(c, T, 10.55, 12.55, 5, 1020, 1072, WARP);
}
function race(c, T) {
  if (T < 7.5) return shotA(c, T);
  if (T < 8.32) return shotB(c, T);
  if (T < 8.68) return edgeWipe(c, T, 8.32, 0.36, shotB, shotC);
  if (T < 9.5) return shotC(c, T);
  if (T < 10.3) return shotD(c, T);
  if (T < 10.66) return edgeWipe(c, T, 10.3, 0.36, shotD, shotE);
  return shotE(c, T);
}
// a torn-edge wipe: a band of the black field sweeps across; A ahead of it, B behind it
const LWIPE = { ox: 960, oy: 540, a: -26.8, s: 4.4, rot: 0, fy: 1, side: -1, fill: true };
function edgeWipe(c, T, t0, dur, A, B, band = 460) {
  const q = (t) => mix(-1250, 1250 + band, E.inOut(seg(t, t0, dur)));
  const lead = q(T), leadP = q(T - SHUT), trail = lead - band;
  const { u, nb } = lineFrame(LWIPE);
  A(c, T);
  const Lb = layer(c), bx = Lb.getContext('2d'); terrain(bx, LWIPE, lead); smear(c, Lb, -nb[0] * (lead - leadP), -nb[1] * (lead - leadP)); free(Lb);
  const Lx = layer(c), lx = Lx.getContext('2d'); B(lx, T);
  const Lm = layer(c), mx = Lm.getContext('2d'); terrain(mx, { ...LWIPE, ox: LWIPE.ox + u[0] * 640, oy: LWIPE.oy + u[1] * 640 }, trail);
  lx.save(); lx.setTransform(1, 0, 0, 1, 0, 0); lx.globalCompositeOperation = 'destination-in'; lx.drawImage(Lm, 0, 0); lx.restore();
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(Lx, 0, 0); c.restore();
  free(Lx); free(Lm);
}

// ================================================================== NEWS ======
const Y3 = 610;
const L3 = { ox: 960, oy: Y3 + M2 * 960, a: DEG2, s: 5.2, rot: DEG2 - 26.8, fy: -1, side: 1, fill: true };
// specks flung in a direction (deg range) from a point: the rev's puff of grunge
function specksDir(c, t, cx, cy, spread, seed, col, n, scale, a0, a1) {
  if (t < 0 || t > 0.55 || !SPECKS.length) return;
  const u = E.out(clamp(t / 0.5)), fade = 1 - seg(t, 0.22, 0.33);
  c.save(); c.fillStyle = col; c.globalAlpha *= fade;
  for (let i = 0; i < n; i++) {
    const a = mix(a0, a1, hash(seed + i)) * RAD, d = spread * (0.35 + 0.8 * hash(seed + i * 3.7)) * u;
    const sp = SPECKS[Math.floor(hash(seed + i * 9.1) * SPECKS.length)];
    const sz = scale * (0.6 + 0.9 * hash(seed + i * 5.3)) * (1 - 0.45 * u);
    c.save(); c.translate(cx + Math.cos(a) * d, cy + Math.sin(a) * d - 30 * u * u); c.rotate(a); c.scale(sz, sz); c.translate(-sp.cx, -sp.cy); c.fill(sp.p); c.restore();
  }
  c.restore();
}
const GO = 18.0;
const NEWS_CARS = {
  kid: { kind: 'truck', s: 1.32, d: 330, from: -1750, t0: 14.75, t1: 15.65, nip: 300, revs: [16.5, 17.25], p0: 40 },
  sleek: { kind: 'sleek', s: 1.62, d: 44, from: -1950, t0: 14.55, t1: 15.5, nip: 0, revs: [16.0, 17.0], p0: 150 },
};
function news(c, T) {
  c.fillStyle = RED; c.fillRect(0, 0, W, H);
  // the camera tracks once they GO: the terrain starts to rush, the composition holds
  const camC = (t) => { const g = t - GO; return g <= 0 ? 0 : 2400 * (g - (1 - Math.exp(-g * 2.6)) / 2.6); };
  ground(c, L3, camC, T);
  const revK = (car, t) => { let a = 0; for (const r of car.revs) { const q = t - r; if (q > -0.1 && q < 0.5) a += q < 0 ? -0.5 * E.inOut(seg(q, -0.1, 0.1)) : Math.exp(-q * 8) * Math.cos(q * 22); } return a; };
  const goK = (t) => { const q = t - GO; return q < -0.12 ? 0 : q < 0 ? -E.inOut(seg(q, -0.12, 0.12)) : Math.exp(-q * 6) * Math.cos(q * 15); };
  const pos = (car, t) => {
    if (t < car.t1) return mix(car.from, car.p0, E.hard(seg(t, car.t0, car.t1 - car.t0)));
    return car.p0 + car.nip * spring(seg(t, GO, 0.8), 1.2, 4.5) + 16 * revK(car, t) + 30 * goK(t);
  };
  const state = (key, t) => {
    const car = NEWS_CARS[key], p = pos(car, t) + news.exitDx(t);
    const [x, y] = lineAt(L3, p, car.d + bob(t, car.s * 5) * (t > GO ? 1 : 0.35));
    const arr = t - car.t1;
    let pitch = 0.05 * revK(car, t) + 0.07 * goK(t);
    if (arr > -0.15 && arr < 0.45) pitch -= 0.03 * Math.sin(clamp((arr + 0.15) / 0.6) * Math.PI);    // nose dips as it brakes
    const rolling = t < car.t1 ? 1 : 0, reving = car.revs.some((r) => t - r > -0.05 && t - r < 0.45) || (t > GO - 0.05 && t < GO + 0.3);
    const k = t > GO ? clamp((t - GO) / 0.35) : rolling * clamp((car.t1 - t) / 0.4) * 0.8;
    const spin = -(p + camC(t)) / (33 * car.s) - (reving ? (t * 40) : 0);
    return { kind: car.kind, paint: PAINT[key], x, y, a: DEG2, s: car.s, k, spin, spinRate: (t > GO || reving || rolling) ? 99 : 0, pitch,
      streaks: key === 'kid' ? [[-52, 560, 6, 34], [-84, 320, 6, 70], [-20, 420, 4, 50]] : STREAK };
  };
  for (const key of ['kid', 'sleek']) carLayer(c, T, (t) => state(key, t));
  // the puff: grunge specks kicked back off the rear wheels on each rev, and on GO
  for (const key of ['kid', 'sleek']) {
    const car = NEWS_CARS[key], st = state(key, T);
    const rx = st.x + (CK.REAR * Math.cos(DEG2 * RAD)) * car.s, ry = st.y + (CK.REAR * Math.sin(DEG2 * RAD)) * car.s;
    for (const r of car.revs) specksDir(c, T - r, rx - 20, ry, 190 * car.s, 61 + r, BLACK, 14, 4.2 * car.s, 165, 215);
    specksDir(c, T - GO, rx - 20, ry, 320 * car.s, 97 + car.s, BLACK, 22, 4.8 * car.s, 160, 220);
  }
  // starburst stamp
  if (punch(T, 13.5, 2.7, 0.16, 0.5, 0.06) != null) {
    const drawStar = (lx, t) => {
      const s = punch(t, 13.5, 2.7, 0.16, 0.5, 0.06); if (s == null) return;
      const r = t < 13.5 ? -14 * (1 - E.in(seg(t, 13.34, 0.16))) : 4 * Math.exp(-(t - 13.5) * 7) * Math.sin((t - 13.5) * 16);
      lx.save(); lx.translate(450, 340); lx.rotate(r * RAD); lx.scale(s, s);
      lx.globalAlpha = clamp(seg(t, 13.34, 0.05));
      const k = 540 / GP.star.w; lx.save(); lx.scale(k, k); lx.translate(-GP.star.w / 2, -GP.star.h / 2); lx.fillStyle = BLACK; lx.fill(PATH.star); lx.restore();
      const size = 56, top = -86;
      for (let i = 0; i < 3; i++) { const b = baseline(lx, TYPE.caps, size, top, i); font(lx, TYPE.caps, size); lx.fillStyle = WHITE; lx.textAlign = 'center'; lx.fillText(['THIS YEAR,', 'GROWN-UPS', 'RACE TOO.'][i], 0, b); }
      lx.restore();
    };
    const sa = punch(T, 13.5, 2.7, 0.16, 0.5, 0.06), sb = punch(T - SHUT, 13.5, 2.7, 0.16, 0.5, 0.06) ?? sa;
    multi(c, T, Math.abs(sa - sb) * 500, drawStar, 32);
    specks(c, T - 13.5, 450, 340, 420, 41, BLACK, 18, 3.2);
  }
  // sub-line: two lines rising on the beat
  const size = 56, top = 846;
  riseLine(c, [['Kids race first. Then Trek, Journey', WHITE]], 120, baseline(c, TYPE.read, size, top, 0), size, TYPE.read, seg(T, 14.0, 0.5));
  riseLine(c, [['and adults race together.', WHITE]], 120, baseline(c, TYPE.read, size, top, 1), size, TYPE.read, seg(T, 14.25, 0.5));
}
news.exitDx = (T) => (T < 20.3 ? 0 : 2600 * E.in(seg(T, 20.3, 0.45)));

// ============================================================== END CARD ======
const L4 = { ox: 1560, oy: 1620 - 0.505 * 1560 - 90, a: -26.8, s: 4.4, rot: 180, fy: 1, side: 1, fill: true };
function endCard(c, T) {
  c.fillStyle = RED; c.fillRect(0, 0, W, H);
  { const Lt = layer(c), lx = Lt.getContext('2d'); terrain(lx, L4, 0); smear(c, Lt, 0, 0); free(Lt); }
  const LSk = 560 / LS.w, lgH = LS.h * LSk;
  if (punch(T, 21.25, 1.35, 0.14, 0.4, 0.05) != null) {
    const drawL = (lx, t) => {
      const s = punch(t, 21.25, 1.35, 0.14, 0.4, 0.05); if (s == null) return;
      lx.save(); lx.globalAlpha = clamp(seg(t, 21.11, 0.05)); lx.translate(400, 96 + lgH / 2); lx.scale(s, s); lx.translate(-400, -(96 + lgH / 2));
      logoSolid(lx, 120, 96, 560); lx.restore();
    };
    const a = punch(T, 21.25, 1.35, 0.14, 0.4, 0.05), b = punch(T - SHUT, 21.25, 1.35, 0.14, 0.4, 0.05) ?? a;
    multi(c, T, Math.abs(a - b) * 400, drawL, 24);
  }
  const hTop = 96 + lgH + 92;
  riseLine(c, [['Kids, Trek, Journey & Adults', WHITE]], 120, baseline(c, TYPE.head, 96, hTop, 0), 96, TYPE.head, seg(T, 21.5, 0.45));
  const dTop = hTop + 96 + 84, LHd = 1.4;
  const rows = [
    [['Register by', BLACK], [' Sunday, Feb 28', WHITE]],
    [['Build day:', BLACK], [' Saturday, March 6 · 2:00 pm', WHITE]],
    [['Race day:', BLACK], [' Saturday, March 20 · 2:00 pm', WHITE]],
  ];
  rows.forEach((r, i) => riseLine(c, r, 120, baseline(c, TYPE.read, 58, dTop, i, LHd), 58, TYPE.read, seg(T, 21.7 + i * 0.15, 0.42), 'left', LHd));
  // the church's logo lands on 22.0
  const cs = punch(T, 22.0, 1.25, 0.12, 0.35, 0.04);
  if (cs != null && IMG.church.width) {
    const w = 360, h = w * IMG.church.height / IMG.church.width, cx = W - 120 - w / 2, cy = H - 96 - h / 2;
    c.save(); c.globalAlpha = clamp(seg(T, 21.88, 0.06)); c.translate(cx, cy); c.scale(cs, cs); c.drawImage(IMG.church, -w / 2, -h / 2, w, h); c.restore();
  }
}

// ======================================================= hand-back to lobby ====
const WAVE = CFG.wave;
function wavePath(c, prof, lift, down) {
  c.moveTo(-20, prof[0][1] - lift);
  for (const [x, y] of prof) c.lineTo(x, y - lift);
  c.lineTo(W + 20, prof[prof.length - 1][1] - lift);
  if (down) { c.lineTo(W + 20, H + 4000); c.lineTo(-20, H + 4000); } else { c.lineTo(W + 20, -4000); c.lineTo(-20, -4000); }
  c.closePath();
}
const SWEEP_AT = 28.45, SWEEP = 0.55;
function handBack(c, T, under) {
  const u = seg(T, SWEEP_AT, SWEEP);
  if (u >= 1) { c.drawImage(IMG.plate, 0, 0, W, H); return; }
  const lead = 1900 * E.inOut(u), tail = Math.max(0, lead - 300);
  under(c);
  c.save(); c.beginPath(); wavePath(c, WAVE.orange, tail, true); c.clip(); c.drawImage(IMG.plate, 0, 0, W, H); c.restore();
  c.save(); c.beginPath(); wavePath(c, WAVE.orange, tail, false); c.clip();
  c.beginPath(); wavePath(c, WAVE.yellow, lead, true); c.fillStyle = `rgb(${WAVE.ycol.join(',')})`; c.fill();
  c.beginPath(); wavePath(c, WAVE.orange, lead, true); c.fillStyle = `rgb(${WAVE.ocol.join(',')})`; c.fill();
  c.restore();
}

// ================================================================= frame ======
// whip pan between two scenes: a continuous camera slide of one frame width
function whip(c, T, a, b, t0, dur, A, B) {
  const p = (t) => W * E.whip(seg(t, t0, dur));
  const x = p(T), v = x - p(T - SHUT);
  const F = layer(c), fx = F.getContext('2d');
  if (x < W) { fx.save(); fx.translate(-x, 0); A(fx, T); fx.restore(); }
  if (x > 0) { fx.save(); fx.translate(W - x, 0); fx.save(); fx.beginPath(); fx.rect(0, 0, W, H); fx.clip(); B(fx, T); fx.restore(); fx.restore(); }
  smear(c, F, -v, 0); free(F);
}
function scene(c, T) {
  if (T < 5.7) return opening(c, T);
  if (T < 6.25) return whip(c, T, 0, 0, 5.7, 0.55, opening, race);
  if (T < 12.6) return race(c, T);
  if (T < 13.15) return whip(c, T, 0, 0, 12.6, 0.55, race, news);
  if (T < 20.55) return news(c, T);
  if (T < 20.93) return edgeWipe(c, T, 20.55, 0.38, news, endCard, 520);
  return endCard(c, T);
}
window.renderFrame = async (T) => {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
  const [kx, ky] = kick(T, [[2.5, 9], [3.0, 6], [12.0, 5], [13.5, 10], [18.0, 8], [21.25, 5]]);
  ctx.setTransform(SC, 0, 0, SC, 0, 0);
  if (kx === 0 && ky === 0) { if (T >= SWEEP_AT) handBack(ctx, T, (c) => scene(c, T)); else scene(ctx, T); return; }
  const F = layer(ctx), fx = F.getContext('2d'); scene(fx, T);
  const z = 1 + (Math.abs(kx) + Math.abs(ky)) / 500;   // a hair of zoom so the shove never shows an edge
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.translate(cv.width / 2 + kx * SC, cv.height / 2 + ky * SC); ctx.scale(z, z); ctx.drawImage(F, -cv.width / 2, -cv.height / 2); free(F);
};
window.ready = loadAll();
