// combo (30 s): the real room, then the flat brand, ending in the lobby.
//  0.0- 7.0  the real room (2.5D photo), one long push toward the start gate;
//            card 1 on its own plate (1.0-6.0); the gate drops at 6.2
//  7.0- 8.5  the six club colours grow out of the real track's lanes in the
//            photo's perspective, open over the room as the push continues,
//            and swing level into the flat race
//  8.1-11.3  the pack, already rolling in as the lanes settle; the camera runs
//            with it, then picks up car 7 and closes in (car 7 at ~30% of width)
// 11.3-12.6  close-up: car 7, axle nails and stripe readable
// 12.6-15.0  wide finish, close and uneven; 14.9-17.0 card 2 headline
// 17.0-20.6  two-shot: car 7 and the grown-up's coupe side by side; read lines
// 20.6-30.0  the waves sweep into the lobby plate; end card (at rest ~22.4-28.45); bare plate 29-30
const ctx = document.getElementById('c').getContext('2d');
const WAVE_AT = 20.6, EXIT_AT = 28.45, TR = 7.0, RACE0 = 6.2;
const RUN = [['doorstop', 0, 2.9], ['brick', 1, 3.05], ['arrow', 2, 2.85], ['fin', 3, 3.0]];
const rAt = (T) => (tt) => (tt <= RACE0 ? 0 : Math.pow((tt - RACE0) / T, 1.7));
const bgCache = {};
function bg(f) {
  if (!bgCache[f]) { const im = new Image(); im.src = GP.bgDir + `bg_${String(f).padStart(4, '0')}.png`; bgCache[f] = im.decode().then(() => im); }
  return bgCache[f];
}
async function photo(T) {
  const n = GP.cam.cams.length, fi = Math.min(Math.round(T * FPS), n - 1);
  ctx.drawImage(await bg(fi), 0, 0, W, HGT);
}
function photoCars(T) {
  const order = RUN.map((c) => ({ c, r: rAt(c[2])(T) })).sort((a, b) => a.r - b.r);
  for (const { c } of order) trackCar(ctx, null, c[0], c[1], rAt(c[2]), T);
}
// card 1 on its own plate (clean ground over the photo): house blue plate,
// the one hard offset in blue deep, white Paytone
function plateCard(T) {
  const str = 'The Awana Grand Prix is back.', font = "36px 'Paytone One'";
  const tw = measure(ctx, str, font, -0.9), pw = tw + 52, ph = 70, x = SAFE_X, y = 492 - ph;
  const wi = EASE.out(seg(T, 1.0, 0.55)), o = leaving(T, 6.0, 0.34);
  if (wi <= 0 || o.a <= 0) return;
  ctx.save(); ctx.globalAlpha = o.a; ctx.translate(0, o.dy);
  ctx.beginPath(); ctx.rect(x - 2, y - 2, (pw + SHADOW + 4) * wi, ph + SHADOW + 4); ctx.clip();
  ctx.fillStyle = BLUE_DEEP; rrect(ctx, x + SHADOW, y + SHADOW, pw, ph, 12); ctx.fill();
  ctx.fillStyle = BLUE; rrect(ctx, x, y, pw, ph, 12); ctx.fill();
  const L = landing(T, 1.25, 0.5);
  typeLine(ctx, str, x + 26, y + 47, { font, color: '#FFFFFF', spacing: -0.9, align: 'left', L });
  ctx.restore();
}
// The transition: a fan of six bands with its apex at the gate, laid along the
// real track, that paints down the track toward camera, opens over the room as
// the push continues, then its apex runs off to infinity while it turns level:
// exactly the flat lanes at the end.
let FAN_LAST = null; const FAN_SCRATCH = document.createElement('canvas').getContext('2d');
function bandFan(ctx, T) {
  const u = T - TR;                       // 0 .. 1.5
  const cam = camAt(Math.min(T, (GP.cam.cams.length - 1) / FPS));
  const [gx, gy] = project(cam, ...trackPoint(752, 0.5), 1);
  const yc = 1180, [cx0, cy0] = project(cam, ...trackPoint(yc, 0.5), wTrack(yc));
  const [lx, ly] = project(cam, ...trackPoint(yc, 0), wTrack(yc)), [rx, ry] = project(cam, ...trackPoint(yc, 1), wTrack(yc));
  const th0 = Math.atan2(cy0 - gy, cx0 - gx), D0 = Math.hypot(cx0 - gx, cy0 - gy), W0 = Math.hypot(rx - lx, ry - ly);
  const front = EASE.inOut(seg(u, 0.0, 0.6));           // A: paint down the track
  const open = EASE.inOut(seg(u, 0.4, 0.5));            // B: open over the room
  const c = seg(u, 0.78, 0.72);                         // C: level out
  const ce = EASE.inOut(c);
  const turn = th0 + (0 - th0) * spring(c);
  const invD = mix(1 / D0, 0, ce);
  const D = invD > 1e-6 ? 1 / invD : 1e6;
  const need = (a) => 2 * (Math.abs(480 * Math.sin(a)) + Math.abs(270 * Math.cos(a))) + 80 * Math.abs(Math.sin(a));
  // while it turns, the bands are only as wide as it takes to cover the frame
  const Wt = mix(mix(W0 * 0.92, 3000, open), need(turn) * mix(1.9, 1, EASE.inOut(seg(c, 0.45, 0.55))), EASE.inOut(seg(c, 0, 0.4)));
  const C = [mix(cx0, 480, ce), mix(cy0, 270, ce)];
  const ux = Math.cos(turn), uy = Math.sin(turn), nx = -uy, ny = ux;
  const A = [C[0] - ux * D, C[1] - uy * D];
  const rNear = Math.max(0, D - 3000), rFar = mix(0, D + 3000, front);
  FAN_LAST = { turn, C, Wt, rFar: Math.min(rFar, 2500) };
  if (c > 0.25) { ctx.fillStyle = SKY; ctx.fillRect(0, 0, W, HGT); }
  const dirTo = (o) => { const px = C[0] + nx * o - A[0], py = C[1] + ny * o - A[1]; const n = Math.hypot(px, py); return [px / n, py / n]; };
  const scroll = 1800 * Math.max(0, u - 0.3);
  for (let j = 0; j < 6; j++) {
    // while it turns, the outer two bands reach out to the frame edges so no corner is ever uncovered
    const reach = 4000 * EASE.inOut(seg(c, 0, 0.3)) * (1 - EASE.inOut(seg(c, 0.8, 0.2)));
    const o0 = (j / 6 - 0.5) * Wt - (j === 0 ? reach : 0), o1 = ((j + 1) / 6 - 0.5) * Wt + (j === 5 ? reach : 0);
    const [ax0, ay0] = dirTo(o0), [ax1, ay1] = dirTo(o1);
    ctx.fillStyle = CL[CLUB_ORDER[j]].primary;
    ctx.beginPath();
    ctx.moveTo(A[0] + ax0 * rNear, A[1] + ay0 * rNear); ctx.lineTo(A[0] + ax0 * rFar, A[1] + ay0 * rFar);
    ctx.lineTo(A[0] + ax1 * rFar, A[1] + ay1 * rFar); ctx.lineTo(A[0] + ax1 * rNear, A[1] + ay1 * rNear);
    ctx.closePath(); ctx.fill();
    // centre dashes in perspective (thicker further from the apex)
    const [mx, my] = dirTo((o0 + o1) / 2);
    const per = 78, off = ((scroll % per) + per) % per;
    ctx.fillStyle = '#FFFFFF';
    for (let x = -1700 - off; x < 1700; x += per) {
      const r1 = D + x, r2 = D + x + 34 + (u > 0.3 ? 1800 * SHUTTER : 0);
      if (r2 < 0 || r1 > rFar) continue;
      const ra = Math.max(r1, 0), rb = Math.min(r2, rFar);
      const hw = (k) => 2.5 * (Wt / 540) * (k / D);
      ctx.beginPath();
      ctx.moveTo(A[0] + mx * ra + nx * hw(ra), A[1] + my * ra + ny * hw(ra)); ctx.lineTo(A[0] + mx * rb + nx * hw(rb), A[1] + my * rb + ny * hw(rb));
      ctx.lineTo(A[0] + mx * rb - nx * hw(rb), A[1] + my * rb - ny * hw(rb)); ctx.lineTo(A[0] + mx * ra - nx * hw(ra), A[1] + my * ra - ny * hw(ra));
      ctx.closePath(); ctx.fill();
    }
  }
}
// the fan with true motion blur along its swing (sub-frame samples)
function fanBlurred(T) {
  bandFan(FAN_SCRATCH, T - SHUTTER); const p = FAN_LAST;
  bandFan(FAN_SCRATCH, T); const q = FAN_LAST;
  const travel = Math.max(Math.abs(q.turn - p.turn) * 900, Math.hypot(q.C[0] - p.C[0], q.C[1] - p.C[1]), Math.abs(q.Wt - p.Wt) / 2, Math.abs(q.rFar - p.rFar) * 0.5);
  motionBlur(ctx, T, travel, (c, ts) => bandFan(c, ts), null);
}
// 8.2-11.3: the pack, already rolling in as the lanes settle; the camera runs
// with them, then picks up car 7 and closes in
const PACK = [['doorstop', 3, 8.05, 0], ['arrow', 2, 8.14, -70], ['brick', 1, 8.3, -210], ['fin', 0, 8.45, -300], ['bus', 5, 8.6, -380]];
function packCam(t) { const zp = EASE.inOut(seg(t, 9.5, 0.9)); return { s: mix(1, 2.4, zp), fx: mix(0, 75, zp), fy: mix(0, 50, zp) }; }
function sRun(ctx, T, over = false) {
  if (!over) { ctx.fillStyle = SKY; ctx.fillRect(0, 0, W, HGT); }
  RECTS_NOW = FULL_RECTS;
  const speed = 1900, scrollAt = (t) => speed * (t - 7.3);
  const cam = packCam(T);
  withCam(ctx, cam, () => {
    if (!over) drawLanes(ctx, FULL_RECTS, scrollAt(T), speed);
    for (const [key, lane, t0, rel] of PACK) {
      const st = (t) => ({ x: hermite(t, t0, t0 + 0.95, -650, rel, 1300, 0) + (key === 'arrow' ? 50 * EASE.inOut(seg(t, 9.6, 1.6)) : 0) + 4 * Math.sin(t * 2.1 + rel), s: 1.2, pitch: hop(t, t0 + 0.95, 0.03) });
      if (T > t0 - 0.05) laneCar(ctx, key, lane, st, T, scrollAt, cam.s);
    }
  });
}
window.ready = loadKit();
async function race(T) {
  if (T < 8.5) {
    if (T < TR + 1.3) await photo(T);
    if (T < TR) photoCars(T);
    if (T >= TR) { fanBlurred(T); if (T < TR + 0.75) photoCars(T); }
    if (T > 8.38) sRun(ctx, T, true);       // the cars are already rolling in as the lanes settle
    plateCard(T);
  } else if (T < 11.3) sRun(ctx, T);
  else if (T < 12.6) sCloseUp(ctx, T - 11.3);
  else if (T < 17.0) sFinish(ctx, T - 12.6, 0.9, { at: 2.3, out: 4.15 });
  else sTwoShot(ctx, T - 17.0, 1.0);
}
window.renderFrame = async (T) => {
  beginFrame(ctx);
  if (T < WAVE_AT) await race(T);
  else {
    const t = T - WAVE_AT;
    if (t < END.rise + 0.05) await race(T);
    lobbyEnd(ctx, t, EXIT_AT - WAVE_AT, () => {});
  }
};
