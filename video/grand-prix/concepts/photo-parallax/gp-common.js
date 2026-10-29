// Shared kit for the Grand Prix concept films (combo, flat-brand).
// Everything is drawn on one canvas from a single time value, in a fixed
// 960x540 layout space scaled by SC (1 = 960x540 check, 2 = 1920x1080 final).
// capture.mjs injects window.GP (tokens, kit SVG sources, photo camera, plate).
//
// Design system (one idea, restraint):
//  - palette: the six club colours, house blue / blue deep, white, ink (the lobby
//    plate brings its own sun/orange waves at the end)
//  - type: Paytone One headlines, Londrina Solid kickers, Figtree read lines
//  - ONE hard offset everywhere: SHADOW px down-right, in the field's deep colour
//  - margins: 5% title-safe (48 px / 27 px in layout units)
/* eslint-disable no-unused-vars */
const GP = window.GP;
const TOK = GP.tokens, H = TOK.house, CL = TOK.clubs;
const CLUB_ORDER = ['puggles', 'cubbies', 'sparks', 'tnt', 'trek', 'journey'];
const W = 960, HGT = 540, FPS = GP.fps || 30, SC = GP.scale || 1;
const SHUTTER = 0.5 / FPS;            // 180-degree shutter
const SHADOW = 4;                     // the one hard offset (layout px)
const SAFE_X = 48, SAFE_Y = 27;
const BLUE = H.blue, BLUE_DEEP = H.blueDeep, INK = H.ink, SKY = H.sky;
function beginFrame(ctx) {
  if (ctx.canvas.width !== W * SC) { ctx.canvas.width = W * SC; ctx.canvas.height = HGT * SC; }
  ctx.setTransform(SC, 0, 0, SC, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}

// ---------------------------------------------------------------- timing --
function bez(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t) => ((ax * t + bx) * t + cx) * t, Y = (t) => ((ay * t + by) * t + cy) * t;
  return (x) => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let lo = 0, hi = 1, t = x;
    for (let i = 0; i < 40; i++) { t = (lo + hi) / 2; if (X(t) < x) lo = t; else hi = t; }
    return Y(t);
  };
}
const EASE = {
  wipe: bez(0.76, 0, 0.24, 1), settle: bez(0.16, 1, 0.3, 1), pop: bez(0.34, 1.56, 0.64, 1), exit: bez(0.7, 0, 0.84, 0),
  inOut: bez(0.65, 0, 0.35, 1), out: bez(0.22, 1, 0.36, 1), in: bez(0.55, 0, 0.9, 0.4),
};
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const seg = (t, a, d) => clamp((t - a) / d);
const mix = (a, b, u) => a + (b - a) * u;
// damped spring settle from 0 to 1 (overshoot then rest); exactly 1 after dur
function spring(u, over = 0.12) {
  if (u <= 0) return 0; if (u >= 1) return 1;
  const e = 1 - Math.exp(-6 * u) * Math.cos(Math.PI * 2.2 * u);
  return mix(e, 1, Math.pow(u, 6)) + 0 * over;
}
// Landing for type: rises a little and scales from 0.9 with a soft squash on
// the baseline; ends EXACTLY at rest (identity) so nothing jitters afterwards.
function landing(t, at, dur = 0.5) {
  const u = seg(t, at, dur);
  if (u >= 1) return { a: 1, sx: 1, sy: 1, dy: 0 };
  const g = EASE.out(seg(t, at, dur * 0.55));
  const k = seg(t, at + dur * 0.3, dur * 0.7);
  const sq = k > 0 && k < 1 ? 0.06 * Math.sin(Math.PI * k) * (1 - k) : 0;
  const s = mix(0.9, 1, g);
  return { a: clamp(g * 2.5), sx: s * (1 + sq * 0.6), sy: s * (1 - sq), dy: (1 - g) * 14 };
}
// leaving: a quick eased drop and fade (the lobby's copy exit)
function leaving(t, at, dur = 0.32) { const u = EASE.exit(seg(t, at, dur)); return { a: 1 - u, dy: 18 * u }; }

// ---------------------------------------------------------------- assets --
const IMG = {};
function loadImg(key, src) { const im = new Image(); im.src = src; IMG[key] = im; return im.decode().catch((e) => console.log('img fail', key, e)); }
function svgImg(key, src, color) {
  const s = color ? src.replace(/currentColor/g, color) : src;
  return loadImg(key, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s));
}
async function loadKit() {
  const jobs = [];
  for (const d of ['sparkle-4pt', 'dot', 'squiggle-s', 'zigzag', 'ring']) jobs.push(svgImg(`${d}_white`, GP.svg[`doodles/${d}.svg`], '#FFFFFF'));
  if (GP.plate) jobs.push(loadImg('plate', GP.plate));
  await Promise.all(jobs);
  await Promise.all([
    document.fonts.load("40px 'Paytone One'"), document.fonts.load("900 30px 'Londrina Solid'"),
    document.fonts.load('800 20px Figtree'), document.fonts.load('600 20px Figtree'),
  ]);
}

// ------------------------------------------------------------- primitives --
function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
// text with the one hard offset; spacing in px (negative = tighter, for display Paytone)
function setFont(ctx, font, spacing = 0) { ctx.font = font; ctx.letterSpacing = `${spacing}px`; ctx.fontKerning = 'normal'; }
function measure(ctx, str, font, spacing = 0) { ctx.save(); setFont(ctx, font, spacing); const w = ctx.measureText(str).width; ctx.restore(); return w; }
function typeLine(ctx, str, x, y, { font, color = '#fff', shadow = null, spacing = 0, align = 'center', L = null, a = 1 } = {}) {
  const l = L || { a: 1, sx: 1, sy: 1, dy: 0 };
  if (l.a * a <= 0) return;
  ctx.save(); ctx.globalAlpha *= l.a * a; setFont(ctx, font, spacing); ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  ctx.translate(x, y + l.dy); if (l.sx !== 1 || l.sy !== 1) ctx.scale(l.sx, l.sy);
  if (shadow) { ctx.fillStyle = shadow; ctx.fillText(str, SHADOW, SHADOW); }
  ctx.fillStyle = color; ctx.fillText(str, 0, 0); ctx.restore();
}
function doodle(ctx, name, x, y, size, t, at, rot = 0, out = null) {
  const im = IMG[name]; if (!im || !im.width) return;
  const g = seg(t, at, 0.42); if (g <= 0) return;
  const s = EASE.pop(g); const lv = out != null ? leaving(t, out) : { a: 1, dy: 0 };
  if (lv.a <= 0) return;
  ctx.save(); ctx.globalAlpha *= lv.a; ctx.translate(x, y + lv.dy); ctx.rotate(rot * (1 - EASE.out(g)) + rot * 0.0); ctx.scale(s, s);
  const h = size * im.height / im.width; ctx.drawImage(im, -size / 2, -h / 2, size, h); ctx.restore();
}

// ------------------------------------------------------------ motion blur --
// Camera-like motion blur: the subject is drawn at N sub-frame times across
// the shutter, each copy rendered normally into a scratch canvas and ADDED at
// weight 1/N into an accumulator, then laid on the frame once. N is chosen so
// copies are never more than ~1 device px apart: a continuous smear, no ghosts.
const BLUR = { tmp: document.createElement('canvas'), acc: document.createElement('canvas') };
function motionBlur(ctx, t, travelPx, drawAt, box, shutter = SHUTTER) {
  const N = Math.max(1, Math.min(64, Math.ceil(travelPx * SC)));
  if (N === 1) { drawAt(ctx, t); return; }
  // device-space box
  const M = ctx.getTransform();
  let x0 = 0, y0 = 0, x1 = ctx.canvas.width, y1 = ctx.canvas.height;
  if (box) {
    const pts = box.map(([x, y]) => [M.a * x + M.c * y + M.e, M.b * x + M.d * y + M.f]);
    x0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[0])) - 12)); x1 = Math.min(ctx.canvas.width, Math.ceil(Math.max(...pts.map((p) => p[0])) + 12));
    y0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[1])) - 12)); y1 = Math.min(ctx.canvas.height, Math.ceil(Math.max(...pts.map((p) => p[1])) + 12));
    if (x1 <= x0 || y1 <= y0) return;
  }
  const w = x1 - x0, h = y1 - y0;
  for (const c of [BLUR.tmp, BLUR.acc]) { if (c.width < w) c.width = w; if (c.height < h) c.height = h; }
  const tc = BLUR.tmp.getContext('2d'), ac = BLUR.acc.getContext('2d', { colorType: 'float16' });   // float accumulator: 8-bit loses most of a 1/N add
  ac.setTransform(1, 0, 0, 1, 0, 0); ac.clearRect(0, 0, w, h);
  for (let i = 0; i < N; i++) {
    const ts = t - shutter * (1 - (i + 0.5) / N);
    tc.setTransform(1, 0, 0, 1, 0, 0); tc.clearRect(0, 0, w, h);
    tc.setTransform(M.a, M.b, M.c, M.d, M.e - x0, M.f - y0);
    tc.globalAlpha = 1; tc.globalCompositeOperation = 'source-over';
    drawAt(tc, ts);
    ac.globalCompositeOperation = 'lighter'; ac.globalAlpha = 1 / N;
    ac.drawImage(BLUR.tmp, 0, 0, w, h, 0, 0, w, h);
  }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(BLUR.acc, 0, 0, w, h, x0, y0, w, h); ctx.restore();
}

// ------------------------------------------------------------------- cars --
// Pinewood derby cars, side view, nose to the right. Units: the block is 100
// long (7 in), wheels r 8.4 (1.18 in) on axles at 18 and 81 (4.4 in base),
// ground at y = 0. Each car has its own silhouette and personality.
const WHEEL_R = 8.4, AXLES = [18, 81];
const CARS = {
  doorstop: { // the classic wedge: red, white stripe, #7
    body: CL.sparks.primary, trim: '#FFFFFF', num: '7', numAt: [40, -15],
    shape: [[0, -5], [0, -27], [5, -28.5], [100, -9.5], [100, -5]], stripe: [-17, -12.5],
  },
  brick: { // the slab: Puggles cyan, chunky, ink stripe, #3
    body: CL.puggles.primary, trim: INK, num: '3', numAt: [50, -15.5],
    shape: [[0, -5], [0, -22], [3, -25], [92, -25], [100, -18], [100, -5]], stripe: [-10, -7.5],
  },
  arrow: { // the low racer with a rear wing: white with blue stripes, #12
    body: '#FFFFFF', trim: CL.cubbies.primary, num: '12', numAt: [44, -11.5],
    shape: [[0, -5], [0, -15], [30, -17], [86, -12], [100, -7], [100, -5]], stripe: [-9.5, -7.5],
    wing: [[2, -16], [6, -16], [5, -27], [-2, -27], [-3, -30], [20, -30], [20, -27], [9, -27]],
  },
  bus: { // the tall box: T&T green with cream windows, #5
    body: CL.tnt.primary, trim: '#FFFFFF', num: '5', numAt: [24, -16],
    shape: [[2, -5], [2, -38], [6, -42], [94, -42], [98, -38], [98, -5]], stripe: [-12, -9],
    windows: [[40, -36, 14, 12], [58, -36, 14, 12], [76, -36, 14, 12]],
  },
  coupe: { // the grown-up's car: sleek, low, ink with a white pinstripe and a bubble, #1
    body: INK, trim: '#FFFFFF', num: '1', numAt: [30, -12], numDark: true,
    shape: [[0, -6], [0, -16], [20, -19], [38, -21], [50, -27], [64, -27], [74, -20], [100, -9], [100, -6]], stripe: [-11, -10],
    bubble: [[50, -26], [56, -32], [62, -32], [66, -26]],
  },
  fin: { // the shark: Trek teal with a tall tail fin, #9
    body: CL.trek.primary, trim: '#FFFFFF', num: '9', numAt: [46, -13],
    shape: [[0, -5], [0, -38], [8, -38], [16, -20], [100, -9], [100, -5]], stripe: [-13, -10],
  },
};
const CAR_LIST = ['doorstop', 'brick', 'arrow', 'bus', 'coupe', 'fin'];
// a hand-painted stripe edge: a tiny, fixed wobble
function wobble(x, seed) { return Math.sin(x * 0.21 + seed) * 0.45 + Math.sin(x * 0.53 + seed * 2.1) * 0.25; }
// draw a car with its rear-bottom at (0,0) in current transform; s scale,
// spin = wheel angle, pitch = nose-up rotation (rad) about the rear axle
function drawCar(ctx, key, x, y, s, shadowCol, spin = 0, pitch = 0) {
  const c = CARS[key];
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  if (pitch) { ctx.translate(AXLES[0], -WHEEL_R); ctx.rotate(-pitch); ctx.translate(-AXLES[0], WHEEL_R); }
  const path = (pts) => { ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.closePath(); };
  const sh = SHADOW / s;
  // the one hard offset shadow (body, wing and wheels together)
  ctx.save(); ctx.translate(sh, sh); ctx.fillStyle = shadowCol;
  path(c.shape); ctx.fill(); if (c.wing) { path(c.wing); ctx.fill(); }
  for (const ax of AXLES) { ctx.beginPath(); ctx.arc(ax, -WHEEL_R, WHEEL_R, 0, 7); ctx.fill(); }
  ctx.restore();
  ctx.lineJoin = 'round'; ctx.lineWidth = 2.2 / Math.max(0.6, s) * 1.0; ctx.strokeStyle = INK;
  if (c.wing) { ctx.fillStyle = c.trim; path(c.wing); ctx.fill(); ctx.stroke(); }
  ctx.fillStyle = c.body; path(c.shape); ctx.fill();
  // hand-painted stripe, clipped to the body, with a slightly uneven edge
  ctx.save(); path(c.shape); ctx.clip();
  ctx.fillStyle = c.trim; ctx.beginPath();
  const [ya, yb] = c.stripe;
  for (let xx = -2; xx <= 102; xx += 2) ctx.lineTo(xx, ya + wobble(xx, 1.3));
  for (let xx = 102; xx >= -2; xx -= 2) ctx.lineTo(xx, yb + wobble(xx, 4.1) * 0.8);
  ctx.closePath(); ctx.fill();
  if (c.windows) { ctx.fillStyle = H.cream; for (const [wx, wy, ww, wh] of c.windows) { rrect(ctx, wx, wy, ww, wh, 2); ctx.fill(); } }
  ctx.restore();
  path(c.shape); ctx.stroke();
  if (c.bubble) { ctx.fillStyle = CL.cubbies.tint; path(c.bubble); ctx.fill(); ctx.stroke(); }
  // number decal
  const [nx, ny] = c.numAt;
  ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(nx, ny, 6.4, 0, 7); ctx.fill();
  ctx.lineWidth = 1.2; ctx.stroke();
  ctx.fillStyle = INK; setFont(ctx, `${c.num.length > 1 ? 7.4 : 8.6}px 'Paytone One'`, 0); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(c.num, nx, ny + 3.1);
  // wheels: tyre, rim, three lightening holes that turn, the axle nail head
  for (const ax of AXLES) {
    const cy = -WHEEL_R;
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(ax, cy, WHEEL_R, 0, 7); ctx.fill();
    ctx.fillStyle = '#D9DCE0'; ctx.beginPath(); ctx.arc(ax, cy, 5.6, 0, 7); ctx.fill();
    ctx.fillStyle = '#9AA0A8';
    for (let k = 0; k < 3; k++) { const q = spin + k * 2.0944; ctx.beginPath(); ctx.arc(ax + Math.cos(q) * 3.3, cy + Math.sin(q) * 3.3, 1.15, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#F4F5F6'; ctx.beginPath(); ctx.arc(ax, cy, 1.5, 0, 7); ctx.fill();
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(ax, cy, 0.55, 0, 7); ctx.fill();
  }
  ctx.restore();
}
// speed lines attached to a moving car: two tapered white strokes off the tail,
// as long as the car is fast, gone when it slows
function speedLines(ctx, x, y, s, speed) {
  const k = clamp((Math.abs(speed) - 500) / 1800);
  if (k <= 0) return;
  ctx.save(); ctx.fillStyle = '#FFFFFF'; ctx.globalAlpha = 0.85 * k;
  for (const [hy, len] of [[-20, 70], [-11, 46]]) {
    const L = len * k * s, yy = y + hy * s, th = 2.4 * s;
    ctx.beginPath(); ctx.moveTo(x - 6 * s, yy - th / 2); ctx.lineTo(x - 6 * s - L, yy); ctx.lineTo(x - 6 * s, yy + th / 2); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

// ------------------------------------------------------- the real track --
const TRACK_L = [[831, 746], [790, 820], [752, 900], [720, 950], [690, 1000], [660, 1050], [628, 1100], [594, 1150], [555, 1200], [510, 1250], [462, 1300], [406, 1350], [345, 1400], [280, 1450], [205, 1506], [120, 1560], [0, 1640]];
const TRACK_R = [[908, 746], [872, 820], [838, 900], [814, 950], [794, 1000], [778, 1050], [764, 1100], [734, 1150], [700, 1200], [672, 1250], [642, 1300], [604, 1350], [562, 1400], [510, 1450], [446, 1506], [390, 1560], [300, 1640]];
function interp(arr, y) {
  for (let i = 0; i < arr.length - 1; i++) {
    const [x0, y0] = arr[i], [x1, y1] = arr[i + 1];
    if (y <= y1 || i === arr.length - 2) { const u = (y - y0) / (y1 - y0); return x0 + (x1 - x0) * u; }
  }
}
function interp1(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  for (let i = 0; i < xs.length - 1; i++) if (x <= xs[i + 1] || i === xs.length - 2) return ys[i] + (ys[i + 1] - ys[i]) * (x - xs[i]) / (xs[i + 1] - xs[i]);
}
function wTrack(y) { const T = GP.cam.TW; return interp1(T.map((p) => p[0]), T.map((p) => p[1]), y); }
function yForW(w) { const T = GP.cam.TW; return interp1(T.map((p) => p[1]), T.map((p) => p[0]), w); }
// point on the track's top surface: across f in [0,1] (left to right)
function trackPoint(y, f) {
  const L = interp(TRACK_L, y), R = interp(TRACK_R, y);
  const top = 1 - 0.14 * clamp((y - 1050) / 450);        // the right edge includes the side face lower down
  return [L + (R - L) * f * top, y];
}
function lanePoint(y, lane) { const [x] = trackPoint(y, (lane + 0.5) / 4); const L = interp(TRACK_L, y), R = interp(TRACK_R, y); return [x, y, (R - L) * (1 - 0.14 * clamp((y - 1050) / 450)) / 4]; }
function project(cam, x, y, w) {
  const [Cx, Cy] = GP.cam.C, m = 1 / (1 - cam.d * w);
  const qx = Cx + (x - Cx) * m + cam.pan[0] * w, qy = Cy + (y - Cy) * m + cam.pan[1] * w;
  const k = 0.48 * cam.Z;
  return [(qx - cam.F[0]) * k + W / 2, (qy - cam.F[1]) * k + HGT / 2, k * m];
}
function camAt(T) {
  const cams = GP.cam.cams; const f = T * FPS; const i = clamp(Math.floor(f), 0, cams.length - 1), j = Math.min(i + 1, cams.length - 1), u = clamp(f - i);
  const a = cams[i], b = cams[j];
  return { F: [mix(a.F[0], b.F[0], u), mix(a.F[1], b.F[1], u)], Z: mix(a.Z, b.Z, u), d: mix(a.d, b.d, u), pan: [mix(a.pan[0], b.pan[0], u), mix(a.pan[1], b.pan[1], u)] };
}
function yForR(r) { const wmax = 2.6; const w = 1 / (1 - r * (1 - 1 / wmax)); return r <= 1 ? yForW(w) : 1506 + (r - 1) * 900; }
// top view of a car on the photo track (small in frame): body, stripe, wheels
function carTop(ctx, key, cx, cy, fx, fy, width, len) {
  const c = CARS[key]; const ax = -fy, ay = fx;
  const P = (u, v) => [cx + ax * u * width + fx * v * len, cy + ay * u * width + fy * v * len];
  const poly = (pts) => { ctx.beginPath(); pts.forEach(([u, v], i) => { const [x, y] = P(u, v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); };
  const body = [[-0.5, 0], [0.5, 0], [0.5, 0.8], [0.32, 1], [-0.32, 1], [-0.5, 0.8]];
  ctx.fillStyle = INK;
  for (const v of [0.18, 0.81]) for (const u of [-1, 1]) { poly([[u * 0.5, v - 0.08], [u * 0.64, v - 0.08], [u * 0.64, v + 0.08], [u * 0.5, v + 0.08]]); ctx.fill(); }
  ctx.fillStyle = c.body; poly(body); ctx.fill();
  ctx.fillStyle = c.trim; poly([[-0.1, 0.03], [0.1, 0.03], [0.1, 0.95], [-0.1, 0.95]]); ctx.fill();
  ctx.lineWidth = Math.max(0.6, width * 0.06); ctx.strokeStyle = INK; ctx.lineJoin = 'round'; poly(body); ctx.stroke();
}
function trackCar(ctx, cam0, key, lane, rAt, t) {
  const drawAt = (c, tt) => {
    const cam = camAt(tt);
    const y = yForR(rAt(tt)); const [px, py, lw] = lanePoint(y, lane); const [px2, py2] = lanePoint(y + 6, lane);
    const [sx, sy, k] = project(cam, px, py, wTrack(y)); const [sx2, sy2] = project(cam, px2, py2, wTrack(y + 6));
    let fx = sx2 - sx, fy = sy2 - sy; const n = Math.hypot(fx, fy) || 1; fx /= n; fy /= n;
    const width = lw * k * 0.72;
    carTop(c, key, sx, sy - width * 0.2, fx, fy, width, width * 2.6);
  };
  // travel over the shutter, for the sample count
  const p0 = project(camAt(t), ...lanePoint(yForR(rAt(t)), lane).slice(0, 2), 1), p1 = project(camAt(t - SHUTTER), ...lanePoint(yForR(rAt(t - SHUTTER)), lane).slice(0, 2), 1);
  motionBlur(ctx, t, Math.hypot(p0[0] - p1[0], p0[1] - p1[1]), drawAt, null);
}

// -------------------------------------------- the lobby plate end sequence --
// t = seconds since the waves start to rise. The lobby's sun/orange waves rise
// from the bottom and sweep the race away; behind them the plate is already
// there; they settle back exactly into the plate's own waves. Then the words
// land in the lobby's slide style, hold, and leave; the bare plate remains.
const WAVE = GP.wave;
function waveWall(ctx, lift) {
  // lift: layout px the waves are raised above their rest position
  const draw = (prof, col, extra) => {
    ctx.beginPath(); ctx.moveTo(-10, prof[0][1] / 2 - lift);
    for (const [x, y] of prof) ctx.lineTo(x / 2, y / 2 - lift);
    ctx.lineTo(W + 10, prof[prof.length - 1][1] / 2 - lift);
    ctx.lineTo(W + 10, HGT + 700); ctx.lineTo(-10, HGT + 700); ctx.closePath();
    ctx.fillStyle = `rgb(${col.join(',')})`; ctx.fill();
  };
  draw(WAVE.yellow, WAVE.ycol); draw(WAVE.orange, WAVE.ocol);
}
// The sweep: a band of the lobby's own waves (sun crest, orange body, a wavy
// trailing edge) rises from where the plate's waves rest, up and off the top.
// Above it the race; inside it the waves; behind its trailing edge the plate,
// already there. Its trailing edge never stops on a flat colour frame: the band
// is about half the frame tall and keeps moving.
const END = { sweep: 1.05, words: 0.95 };
function wavePath(ctx, prof, lift, closeDown) {
  ctx.moveTo(-20, prof[0][1] / 2 - lift);
  for (const [x, y] of prof) ctx.lineTo(x / 2, y / 2 - lift);
  ctx.lineTo(W + 20, prof[prof.length - 1][1] / 2 - lift);
  if (closeDown) { ctx.lineTo(W + 20, HGT + 2000); ctx.lineTo(-20, HGT + 2000); } else { ctx.lineTo(W + 20, -2000); ctx.lineTo(-20, -2000); }
  ctx.closePath();
}
function lobbyEnd(ctx, t, exitAt, drawRace) {
  const u = seg(t, 0, END.sweep);
  if (u >= 1) { ctx.drawImage(IMG.plate, 0, 0, W, HGT); endWords(ctx, t - END.words, exitAt - END.words); return; }
  // the crest travels from its resting line to well above the frame; ease in-out
  const lead = 1000 * EASE.inOut(u);             // crest lift (layout px)
  const tail = Math.max(0, lead - 300);          // trailing edge lift
  drawRace();
  // plate behind the trailing edge
  ctx.save(); ctx.beginPath(); wavePath(ctx, WAVE.orange, tail, true); ctx.clip();
  ctx.drawImage(IMG.plate, 0, 0, W, HGT); ctx.restore();
  // the band: sun crest then orange body, between the crest and the trailing edge
  ctx.save(); ctx.beginPath(); wavePath(ctx, WAVE.orange, tail, false); ctx.clip();
  ctx.beginPath(); wavePath(ctx, WAVE.yellow, lead, true); ctx.fillStyle = `rgb(${WAVE.ycol.join(',')})`; ctx.fill();
  ctx.beginPath(); wavePath(ctx, WAVE.orange, lead, true); ctx.fillStyle = `rgb(${WAVE.ocol.join(',')})`; ctx.fill();
  ctx.restore();
  endWords(ctx, t - END.words, exitAt - END.words);
}
function endWords(ctx, t, exitT) {
  if (t < 0) return;
  const out = (i) => leaving(t, exitT + i * 0.05, 0.34);
  const kick = landing(t, 0.0, 0.5), ti = landing(t, 0.12, 0.6);
  const lines = [
    [['Register by Sunday, Feb 28', '']],
    [['Build day:', ' Saturday, March 6 · 2:00 pm']],
    [['Race day:', ' Saturday, March 20 · 2:00 pm']],
  ];
  const k0 = out(0), k1 = out(1), k2 = out(2);
  typeLine(ctx, 'Kids, Trek, Journey & Adults', W / 2, 196, { font: "900 28px 'Londrina Solid'", color: BLUE_DEEP, spacing: 0.6, L: { ...kick, dy: kick.dy + k0.dy }, a: k0.a });
  typeLine(ctx, 'AWANA GRAND PRIX', W / 2, 282, { font: "80px 'Paytone One'", color: '#FFFFFF', shadow: BLUE, spacing: 0, L: { ...ti, dy: ti.dy + k1.dy }, a: k1.a });
  lines.forEach((ln, i) => {
    const L = landing(t, 0.3 + i * 0.08, 0.5), o = k2;
    const [[b, r]] = ln;
    const fb = '800 28px Figtree', fr = '600 28px Figtree';
    const wb = measure(ctx, b, fb), wr = measure(ctx, r, fr);
    const x0 = Math.round((W - (wb + wr)) / 2 * 2) / 2, y = 344 + i * 38;
    ctx.save(); ctx.globalAlpha = L.a * o.a; ctx.translate(0, L.dy + o.dy); ctx.fillStyle = INK; ctx.textAlign = 'left';
    setFont(ctx, fb); ctx.fillText(b, x0, y); setFont(ctx, fr); ctx.fillText(r, x0 + wb, y); ctx.restore();
  });
}
