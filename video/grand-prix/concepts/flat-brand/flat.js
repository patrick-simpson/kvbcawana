// The flat race world shared by flat-brand and combo (needs gp-common.js).
// Six club-colour lanes on the sky field. The camera is operated: wide only
// for the launch and the finish, otherwise 2-4 lanes with a hero car at
// 20-30% of the frame. Type always sits on clean sky that the lanes open up.
/* eslint-disable no-unused-vars */
const LANE = 90;
const FULL_RECTS = CLUB_ORDER.map((c, i) => ({ y: (i - 3) * LANE, h: LANE }));
let RECTS_NOW = FULL_RECTS;
// the lanes slide apart (full thickness) by D: three up, three down
const apart = (D) => FULL_RECTS.map((r, i) => ({ y: r.y + (i < 3 ? -D : D), h: r.h }));
// camera: world point (fx, fy) at the frame centre, at scale s (and angle a)
function withCam(ctx, cam, fn) {
  ctx.save(); ctx.translate(W / 2, HGT / 2); if (cam.a) ctx.rotate(cam.a); ctx.scale(cam.s, cam.s); ctx.translate(-cam.fx, -cam.fy); fn(); ctx.restore();
}
// bands + centre dashes. scroll = how far the camera has travelled along the
// ground; speed (px/s) stretches the dashes over the shutter (their blur).
function drawLanes(ctx, rects, scroll, speed) {
  rects.forEach((r, i) => {
    const x0 = -4000, x1 = 4000;
    ctx.fillStyle = CL[CLUB_ORDER[i]].primary; ctx.fillRect(x0, r.y, x1 - x0, r.h + 0.4);
    const per = 78, dash = 34 + Math.abs(speed) * SHUTTER, th = 5;
    const off = ((scroll % per) + per) % per;
    ctx.fillStyle = '#FFFFFF';
    for (let x = -4000 - off; x < 4000; x += per) ctx.fillRect(x, r.y + r.h / 2 - th / 2, dash, th);
  });
}
// a car in lane i. st(t) -> {x (rear, relative to the camera's ground position), s, pitch}
function laneCar(ctx, key, lane, st, t, scrollAt, viewScale = 1, shutter = SHUTTER) {
  const rect = RECTS_NOW[lane];
  const at = (tt) => { const q = st(tt); const R = WHEEL_R * q.s; return { ...q, spin: (q.x + scrollAt(tt)) / R, y: rect.y + rect.h / 2 + 22 * q.s }; };
  const a = at(t), b = at(t - shutter);
  const travel = Math.max(Math.abs(a.x - b.x), Math.abs(a.spin - b.spin) * 3.3 * a.s) * viewScale;
  const vel = (a.x - b.x) / shutter;
  speedLines(ctx, a.x, a.y - 2 * a.s, a.s, vel);
  const sh = CL[CLUB_ORDER[lane]].deep;
  motionBlur(ctx, t, travel, (c, tt) => { const q = at(tt); drawCar(c, key, q.x, q.y, q.s, sh, q.spin, q.pitch || 0); },
    [[Math.min(a.x, b.x) - 12, a.y - 52 * a.s], [Math.max(a.x, b.x) + 112 * a.s, a.y + 12 * a.s], [Math.min(a.x, b.x) - 12, a.y + 12 * a.s], [Math.max(a.x, b.x) + 112 * a.s, a.y - 52 * a.s]], shutter);
}
// a Hermite move from (x0, v0) at t0 to (x1, v1) at t1, linear outside
function hermite(t, t0, t1, x0, x1, v0, v1) {
  const T = t1 - t0, u = clamp((t - t0) / T);
  if (t < t0) return x0 + v0 * (t - t0); if (t > t1) return x1 + v1 * (t - t1);
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * x0 + (u3 - 2 * u2 + u) * T * v0 + (-2 * u3 + 3 * u2) * x1 + (u3 - u2) * T * v1;
}
// a nose-up that settles with a little follow-through (launch, excitement)
function hop(t, t0, amp = 0.07) { const d = t - t0; if (d <= 0 || d > 1.2) return 0; return amp * Math.exp(-4.5 * d) * Math.sin(Math.min(Math.PI * 3, d * 11)); }

// ---------------------------------------------------------------- type --
// headlines: Paytone, white, the one blue offset; sizes from one scale
const HEAD = 62;
function headline(ctx, str, y, t, at, outAt, size = HEAD) {
  const L = landing(t, at, 0.55), o = outAt != null ? leaving(t, outAt) : { a: 1, dy: 0 };
  typeLine(ctx, str, W / 2, y, { font: `${size}px 'Paytone One'`, color: '#FFFFFF', shadow: BLUE, spacing: -0.025 * size, L: { ...L, dy: L.dy + o.dy }, a: o.a });
}
function readLine(ctx, str, y, t, at, outAt, size = 27) {
  const L = landing(t, at, 0.5), o = outAt != null ? leaving(t, outAt) : { a: 1, dy: 0 };
  typeLine(ctx, str, W / 2, y, { font: `800 ${size}px Figtree`, color: INK, L: { ...L, sx: 1, sy: 1, dy: L.dy + o.dy }, a: o.a });
}
// two headline lines optically centred in the open field (a hair above centre)
const LINE1 = 247, LINE2 = 321;

// --------------------------------------------------------------- the race --
// Ground kinematics for the flat-brand launch: cars at the gate (rear at GATE_X),
// anticipation, the pin drops at DROP, each launches with its own acceleration.
const GATE_X = -446, DROP = 7.8;
const FIELD = [ // key, lane, launch delay, accel, cruise bias (px/s)
  ['doorstop', 3, 0.02, 2350, 0], ['brick', 1, 0.07, 2150, -140], ['arrow', 2, 0.0, 2300, 40],
  ['bus', 5, 0.12, 1900, -260], ['fin', 0, 0.05, 2200, -200],
];
function groundX(t, j) {
  const [, , dl, a, bias] = FIELD[j];
  const t0 = DROP + 0.03 + dl, tin = 6.15 + j * 0.06;
  if (t < tin + 0.75) return hermite(t, tin, tin + 0.75, GATE_X - 900, GATE_X, 1400, 0);
  if (t < t0 - 0.18) return GATE_X;
  if (t < t0) return GATE_X - 3.5 * Math.sin(Math.PI * (t - (t0 - 0.18)) / 0.18);   // anticipation
  const d = t - t0, tc = 1.1;
  if (d < tc) return GATE_X + 0.5 * a * d * d;
  return GATE_X + 0.5 * a * tc * tc + (a * tc + bias) * (d - tc) - bias * 0.5 * Math.min(d - tc, 0.6) * 0 ;
}
const heroX = (t) => groundX(t, 0);
// the camera: still for the launch, then it picks up the hero and closes in
function launchCam(t) {
  const w = EASE.inOut(seg(t, 7.95, 0.75)), zp = EASE.inOut(seg(t, 8.1, 0.95));
  const Xc = mix(0, heroX(t), w);
  return { Xc, s: mix(1, 2.4, zp), fx: mix(0, 75, zp), fy: mix(0, 50, zp) };
}

// Opening for flat-brand (0 - 9.6): lanes build, slide apart for card 1, close
// with the cars already rolling in, the gate, anticipation, launch, the camera
// picks up car 7 and closes in.
function sOpenFlat(ctx, T) {
  ctx.fillStyle = SKY; ctx.fillRect(0, 0, W, HGT);
  const D = 210 * EASE.inOut(seg(T, 1.25, 0.75)) * (1 - EASE.inOut(seg(T, 6.15, 0.75)));
  RECTS_NOW = apart(D);
  const cam = launchCam(T);
  const scrollAt = (t) => launchCam(t).Xc;
  const camT = { s: cam.s, fx: cam.fx, fy: cam.fy };
  // the build: each lane wipes in from the left, staggered
  if (T < 1.3) {
    withCam(ctx, camT, () => {
      CLUB_ORDER.forEach((c, i) => {
        const r = RECTS_NOW[i], k = EASE.wipe(seg(T, 0.1 + i * 0.09, 0.62)); if (k <= 0) return;
        ctx.fillStyle = CL[c].primary; ctx.fillRect(-500, r.y, 1000 * k, r.h + 0.4);
        ctx.save(); ctx.beginPath(); ctx.rect(-500, r.y, 1000 * k, r.h); ctx.clip();
        ctx.fillStyle = '#FFFFFF'; for (let x = -500; x < 500; x += 78) ctx.fillRect(x, r.y + r.h / 2 - 2.5, 34, 5); ctx.restore();
      });
    });
  } else {
    const speed = (launchCam(T).Xc - launchCam(T - SHUTTER).Xc) / SHUTTER;
    withCam(ctx, camT, () => {
      drawLanes(ctx, RECTS_NOW, cam.Xc, speed);
      // the gate: an ink bar with a white pin per lane; it drops in, then drops away on the beat
      if (T > 6.45 && T < DROP + 0.5) {
        const gin = 1 - EASE.out(seg(T, 6.45, 0.4)), g = EASE.in(seg(T, DROP, 0.22));
        ctx.save(); ctx.translate(-312 - cam.Xc, -270 - gin * 560);
        ctx.translate(0, 540); ctx.rotate(g * 0.9); ctx.translate(0, -540); ctx.globalAlpha = 1 - seg(T, DROP + 0.12, 0.14);
        ctx.fillStyle = BLUE_DEEP; ctx.fillRect(-6 + SHADOW, SHADOW, 12, 540);
        ctx.fillStyle = INK; ctx.fillRect(-6, 0, 12, 540);
        for (let i = 0; i < 6; i++) { ctx.fillStyle = '#FFFFFF'; rrect(ctx, -9, i * LANE + 30, 18, 30, 4); ctx.fill(); }
        ctx.restore();
      }
      if (T > 6.1) {
        FIELD.forEach(([key, lane, dl], j) => {
          const st = (t) => ({ x: groundX(t, j) - launchCam(t).Xc, s: 1.2, pitch: hop(t, DROP + 0.03 + dl, 0.06) });
          laneCar(ctx, key, lane, st, T, scrollAt, cam.s);
        });
      }
    });
  }
  headline(ctx, 'The Awana Grand Prix', LINE1, T, 2.0, 5.85);
  headline(ctx, 'is back.', LINE2, T, 2.5, 5.91);
}

// The close-up: one car, big enough to see the axle nails and the hand-painted
// stripe; the camera runs with it.
function sCloseUp(ctx, u, key = 'doorstop', lane = 3) {
  ctx.fillStyle = SKY; ctx.fillRect(0, 0, W, HGT);
  RECTS_NOW = FULL_RECTS;
  const speed = 2500, scrollAt = (t) => speed * t;
  const cam = { s: 4.2, fx: 62 + 4 * Math.sin(u * 1.7), fy: 44 };
  withCam(ctx, cam, () => {
    drawLanes(ctx, FULL_RECTS, scrollAt(u), speed);
    const st = (t) => ({ x: 6 * Math.sin(t * 2.3), s: 1, pitch: 0.006 * Math.sin(t * 17) });
    laneCar(ctx, key, lane, st, u, scrollAt, cam.s);
  });
}

// Whip-by: three lanes, the camera holds, cars whip across (a lighter shutter
// so each stays readable mid-whip).
function sWhip(ctx, u) {
  ctx.fillStyle = SKY; ctx.fillRect(0, 0, W, HGT);
  RECTS_NOW = FULL_RECTS;
  const cam = { s: 2.0, fx: 0, fy: -20, a: -0.1 };
  withCam(ctx, cam, () => {
    drawLanes(ctx, FULL_RECTS, 0, 0);
    const runs = [['arrow', 2, 0.1], ['doorstop', 3, 0.3], ['brick', 1, 0.78]];
    for (const [key, lane, t0] of runs) {
      const st = (t) => ({ x: -420 + 1500 * (t - t0), s: 1.0, pitch: 0 });
      if (u > t0 - 0.05 && u < t0 + 0.65) laneCar(ctx, key, lane, st, u, () => 0, cam.s, SHUTTER * 0.4);
    }
  });
}

// The finish, wide: a close, uneven finish; the cars brake past the line and
// stop; then (card 2, first beat) the lanes slide apart and the headline lands.
function sFinish(ctx, u, first, card) {
  ctx.fillStyle = SKY; ctx.fillRect(0, 0, W, HGT);
  const D = card ? 210 * EASE.inOut(seg(u, card.at, 0.75)) : 0;
  RECTS_NOW = apart(D);
  const LINE = 200, v = 1250;
  const field = [['doorstop', 3, 0], ['arrow', 2, 0.03], ['brick', 1, 0.24], ['fin', 0, 0.43], ['bus', 5, 0.8]];
  withCam(ctx, { s: 1, fx: 0, fy: 0 }, () => {
    drawLanes(ctx, RECTS_NOW, 0, 0);
    // the checker line, in two halves riding with the lanes
    for (let r = 0; r < 60; r++) for (let k = 0; k < 2; k++) {
      const y = -270 + r * 9, off = y < 0 ? -D : D;
      ctx.fillStyle = (r + k) % 2 ? '#FFFFFF' : INK; ctx.fillRect(LINE + k * 9, y + off, 9, 9);
    }
    for (const [key, lane, d] of field) {
      const tc = first + d, stop = LINE + 110 - d * 80;
      const st = (t) => {
        const xr = t < tc ? LINE - 125 + v * (t - tc) : hermite(t, tc, tc + 0.9, LINE - 125, stop, v, 0);
        const brake = t > tc ? 0.035 * Math.sin(Math.PI * clamp((t - tc) / 0.9)) : 0;
        return { x: xr, s: 1.25, pitch: -brake };
      };
      laneCar(ctx, key, lane, st, u, () => 0);
    }
  });
  if (card) {
    headline(ctx, 'This year,', LINE1, u, card.at + 0.5, card.out);
    headline(ctx, 'grown-ups race too.', LINE2, u, card.at + 0.95, card.out + 0.06);
  }
}

// Card 2, second beat: the two-shot. Car 7 and the grown-up's coupe, side by
// side and large; the coupe rolls up from behind, settles alongside, and 7 does
// a little hop. The read lines sit on the sky beneath the lanes.
function sTwoShot(ctx, u, readAt) {
  ctx.fillStyle = SKY; ctx.fillRect(0, 0, W, HGT);
  RECTS_NOW = FULL_RECTS;
  const speed = 1400, scrollAt = (t) => speed * t;
  const s = 2.3, cam = { s, fx: 0, fy: 90 + 270 / s - 0 };   // lane 4's top on the frame's top edge
  withCam(ctx, { s, fx: 0, fy: 90 + (HGT / 2) / s }, () => {
    drawLanes(ctx, FULL_RECTS, scrollAt(u), speed);
    const kid = (t) => ({ x: -152 + 5 * Math.sin(t * 1.9), s: 1.12, pitch: hop(t, 1.55, 0.13) + 0.004 * Math.sin(t * 15) });
    const coupe = (t) => ({ x: hermite(t, 0.25, 1.45, -560, -118, 520, 0) + (t > 1.45 ? 4 * Math.sin((t - 1.45) * 1.6) : 0), s: 1.12, pitch: 0.003 * Math.sin(t * 13 + 1) });
    laneCar(ctx, 'doorstop', 4, kid, u, scrollAt, s);
    laneCar(ctx, 'coupe', 5, coupe, u, scrollAt, s);
  });
  readLine(ctx, 'Kids race first.', 456, u, readAt, null);
  readLine(ctx, 'Then Trek, Journey and adults race together.', 494, u, readAt + 0.15, null);
}
