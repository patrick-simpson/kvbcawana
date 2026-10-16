// The KVBC Awana reel: one timeline, every frame a pure function of time.
//
// Owner, 2026-10-16: a whole-system montage cut to "Happy Dance" (MercyMe;
// reel/README.md), about 1:30. The title (the clock ticking to 6:00, as on the
// home page) as the band comes in, then the real screens one at a time over
// the verse; a hard cut on every bar and then every screen at once over the
// first chorus; after the splice (edit.mjs) the Journey room over the build,
// the screens again over the final chorus, and the end card with the church's
// logo on the song's last hit. Words are corner
// labels only, plus the title and the end card's credit and trademark line.
//
// Real footage comes from record.mjs (/work/footage/<shot>/), the labels from
// labels.cjs (/work/labels/); everything else is drawn from the brand kit.
import { E, clamp, el, kf, lerp, prog, put, spring, squish } from './lib.js';
import { C, CLUBS, Footage, Screen, art, chip, loadKit, mark, words } from './kit.js';

// Measured off the track (reel/README.md): exactly 125 BPM, steady to 4 ms.
export const BEAT = 0.48;
const b = (n) => n * BEAT;
// Song beats 48-159 (the verse and the first chorus: film 0-112), then 320 to
// the last hit (the build and the final chorus: film 112-184), ringing out to 190.5.
export const DURATION = b(190.5);

const W = 1920, H = 1080;
const stage = document.getElementById('stage');
const scenes = [];
let pending = [];
const wait = (p) => { if (p) pending.push(p); };

/* ── Shared pieces ─────────────────────────────────────────────────── */

/** A scene: shown from `start` to `end` (global seconds), drawn by update(t). */
function scene(name, start, end, build) {
  const root = el('div', `scene scene--${name}`, stage);
  const s = { name, start, end, root };
  s.update = build(root, s);
  scenes.push(s);
  return s;
}

/** A wavy vertical edge at x; the region to its right (or left) is kept. */
function waveClip(x, { amp = 46, waves = 1.6, phase = 0.6, keep = 'right' } = {}) {
  const n = 48;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const y = -40 + ((H + 80) * i) / n;
    pts.push(`${(x + amp * Math.sin((i / n) * Math.PI * 2 * waves + phase)).toFixed(1)} ${y.toFixed(1)}`);
  }
  const far = keep === 'right' ? W + 400 : -400;
  return `path('M ${pts.join(' L ')} L ${far} ${H + 40} L ${far} -40 Z')`;
}

/** A wavy horizontal edge at y; the region below it is kept. */
function waveClipUp(y, { amp = 40, waves = 1.3, phase = 0 } = {}) {
  const n = 48;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const x = -40 + ((W + 80) * i) / n;
    pts.push(`${x.toFixed(1)} ${(y + amp * Math.sin((i / n) * Math.PI * 2 * waves + phase)).toFixed(1)}`);
  }
  return `path('M ${pts.join(' L ')} L ${W + 40} ${H + 400} L -40 ${H + 400} Z')`;
}

/**
 * The scene's entrance: an accent wave, then the scene, sweep in from the
 * right over the scene before (the catalog's colour blocking, on the beat).
 */
function sweepIn(root, accent, color, from = 'right') {
  const lead = el('div', 'layer', null);
  lead.style.background = color;
  root.prepend(lead);
  const keep = from === 'right' ? 'right' : 'left';
  const [x0, x1] = from === 'right' ? [W + 120, -160] : [-120, W + 160];
  return (t, d = 0.62) => {
    const k1 = E.wipe(prog(t, 0, d));
    const k2 = E.wipe(prog(t, 0.09, d));
    lead.style.clipPath = k1 >= 1 ? 'none' : waveClip(lerp(x0, x1, k1), { phase: 1.1, keep });
    accent.style.clipPath = k2 >= 1 ? 'none' : waveClip(lerp(x0, x1, k2), { keep });
    lead.style.visibility = k2 >= 1 ? 'hidden' : 'visible';
  };
}

/**
 * How far past full width each piece may spring, as a share of its width:
 * 15% of the room on its tighter side (the gap, plus a little of the
 * letters' own side bearings) on each of its sides, so a word gap keeps over
 * two thirds of its width even when both neighbours peak at once (measured
 * with the room unlimited: two words of a caption closed to 2 px of each
 * other and read as one). Measured once per headline: layout ignores
 * transforms, so the answer is the same on every frame.
 */
const ROOM = new WeakMap();
function sideRoom(parts) {
  if (ROOM.has(parts)) return ROOM.get(parts);
  const box = parts.map((p) => ({ x: p.offsetLeft, y: p.offsetTop, w: p.offsetWidth, em: parseFloat(getComputedStyle(p).fontSize) || 0 }));
  if (box.every((b) => b.w === 0)) return null; // not laid out yet
  const room = box.map((b, i) => {
    const prev = box[i - 1], next = box[i + 1];
    const left = prev && prev.y === b.y ? b.x - (prev.x + prev.w) : Infinity;
    const right = next && next.y === b.y ? next.x - (b.x + b.w) : Infinity;
    const gap = Math.max(0, Math.min(left, right, b.w));
    return b.w > 0 ? (2 * 0.15 * (gap + 0.04 * b.em)) / b.w : 1;
  });
  ROOM.set(parts, room);
  return room;
}

/** The overshoot v (past 1) eased into a ceiling c: untouched up to c/2. */
const ceil = (v, c) => (v <= c / 2 ? v : c / 2 + (c / 2) * Math.tanh((v - c / 2) / (c / 2)));

/**
 * Words landing one by one: drop in, spring past full size, settle. The
 * spring stretches each word tall freely, but wide only as far as the room
 * beside it, so neighbours never run together mid-bounce.
 */
function land(parts, t, t0, { gap = 0.07, drop = 60, from = 0.55, speed = 1.15, fade = 0.1 } = {}) {
  const room = sideRoom(parts);
  parts.forEach((p, i) => {
    const ti = t0 + i * gap;
    if (t < ti) { put(p, { o: 0 }); return; }
    const s = lerp(from, 1, spring(t, ti, speed));
    const [sx, sy] = squish(t, ti + 0.16, 0.1, 1.1);
    const wide = s * sx - 1;
    put(p, { y: (1 - E.settle(prog(t, ti, 0.42))) * drop, sx: 1 + (room && wide > 0 ? ceil(wide, room[i]) : wide), sy: s * sy, o: prog(t, ti, fade) });
  });
}

/** Lift away (the kit's exit), one after another. */
function leave(parts, t, t0, { gap = 0.035, rise = 70, d = 0.3 } = {}) {
  parts.forEach((p, i) => {
    const k = E.exit(prog(t, t0 + i * gap, d));
    if (k <= 0) return;
    const cur = p.style.transform || '';
    p.style.transform = `translateY(${(-rise * k).toFixed(1)}px) ${cur}`;
    p.style.opacity = String(1 - k);
  });
}

/**
 * Captions, one at a time: each lands on its time and lifts away just before
 * the next one lands.
 */
function captions(parent, list, { left = 470, top = 64, size = 74, shadow = 'rgba(0,0,0,0.25)' } = {}) {
  const caps = list.map(([, text]) => {
    const c = shout(parent, text, { size, shadow });
    c.box.style.left = `${left}px`;
    c.box.style.top = `${top}px`;
    return c;
  });
  return (t) => list.forEach(([t0], i) => {
    const t1 = i + 1 < list.length ? list[i + 1][0] : 1e9;
    const parts = caps[i].parts;
    if (t < t0 || t > t1) { parts.forEach((q) => put(q, { o: 0 })); return; }
    land(parts, t, t0 + 0.04, { gap: 0.045, drop: 30 });
    if (t > t1 - 0.34) leave(parts, t, t1 - 0.34, { gap: 0.015, rise: 40, d: 0.2 });
  });
}

/** Pop (the kit's pop curve) from 0 to full. */
const pop = (t, t0, d = 0.46) => (t < t0 ? 0 : E.pop(prog(t, t0, d)));

/** A cluster of three doodles (the catalog never uses a dense field). */
function cluster(parent, x, y, items, color = '#fff') {
  return items.map(([name, dx, dy, size, rot = 0, stroke]) => {
    const d = art(name, parent, { color, cls: 'abs', width: size, stroke });
    d.dataset.x = String(x + dx);
    d.dataset.y = String(y + dy);
    d.dataset.r = String(rot);
    return d;
  });
}
function drawCluster(ds, t, t0, { drift = 6 } = {}) {
  ds.forEach((d, i) => {
    const s = pop(t, t0 + i * 0.06, 0.5);
    const x = Number(d.dataset.x) + Math.sin(t * 1.3 + i * 1.7) * drift;
    const y = Number(d.dataset.y) + Math.cos(t * 1.1 + i * 2.1) * drift;
    put(d, { x, y, s, r: Number(d.dataset.r) + Math.sin(t * 0.9 + i) * 6, o: s > 0 ? 1 : 0 });
  });
}

/**
 * A hand-drawn arrow (the catalog's doodle line, round caps) from `a` to `b`,
 * bowed a little; draw(k) draws k of it, the head last.
 */
function arrow(parent, a, b2, color, bow = 0.22) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'abs');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.style.width = `${W}px`;
  svg.style.height = `${H}px`;
  svg.style.overflow = 'visible';
  const [x1, y1] = a, [x2, y2] = b2;
  const mx = (x1 + x2) / 2 - (y2 - y1) * bow, my = (y1 + y2) / 2 + (x2 - x1) * bow;
  const ang = Math.atan2(y2 - my, x2 - mx);
  const hx = (d, s) => x2 - 26 * Math.cos(ang + s * d);
  const hy = (d, s) => y2 - 26 * Math.sin(ang + s * d);
  svg.innerHTML = `<path d="M${x1},${y1} Q${mx},${my} ${x2},${y2}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" pathLength="1"/>
    <path d="M${hx(0.55, 1)},${hy(0.55, 1)} L${x2},${y2} L${hx(0.55, -1)},${hy(0.55, -1)}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" pathLength="1"/>`;
  parent.appendChild(svg);
  const [line, head] = svg.querySelectorAll('path');
  return {
    draw(k, o = 1) {
      svg.style.opacity = String(o);
      svg.style.visibility = k > 0 && o > 0 ? 'visible' : 'hidden';
      const kl = clamp(k / 0.8), kh = clamp((k - 0.75) / 0.25);
      line.style.strokeDasharray = `${kl} 1`;
      head.style.strokeDasharray = `${kh} 1`;
    },
  };
}

/** A corner tab (the catalog's section label), top-left. */
function cornerTab(parent, shape, color, lines, { width = 430, text = '#fff', size = 58 } = {}) {
  const box = el('div', 'abs', parent);
  const svg = art(shape, box, { color, width });
  svg.style.position = 'absolute';
  svg.style.left = '0';
  svg.style.top = '0';
  const label = el('div', 'label', box, lines.join('<br>'));
  Object.assign(label.style, { position: 'absolute', left: '58px', top: '40px', fontSize: `${size}px`, color: text, lineHeight: '0.98', whiteSpace: 'nowrap' });
  return box;
}
function drawTab(box, t, t0) {
  const k = E.settle(prog(t, t0, 0.55));
  put(box, { x: lerp(-480, 0, k), y: lerp(-260, 0, k), o: t >= t0 ? 1 : 0 });
}

function shout(parent, text, { size, color = '#fff', shadow, letters = false, cls = '' } = {}) {
  const w = words(parent, text, { cls: `shout abs ${cls}`, letters });
  w.box.style.fontSize = `${size}px`;
  w.box.style.color = color;
  if (shadow) w.box.style.textShadow = `0 ${Math.round(size * 0.075)}px 0 ${shadow}`;
  return w;
}

function textBox(parent, cls, html, style) {
  const e = el('div', `abs ${cls}`, parent, html);
  Object.assign(e.style, style);
  return e;
}

/** A footage plate: rounded face, the outline printed out of register. */
function plate(parent, footage, { w, h, outline = '#fff', face = '#000' }) {
  const box = el('div', 'plate', parent);
  box.style.width = `${w}px`;
  box.style.height = `${h}px`;
  const ol = el('div', 'plate__outline', box);
  ol.style.color = outline;
  const f = el('div', 'plate__face', box);
  f.style.background = face;
  const screen = footage ? new Screen(f, footage) : null;
  return { box, outline: ol, face: f, screen };
}

/* ── The footage ───────────────────────────────────────────────────── */

const F = {};
for (const name of ['lobby-open', 'lobby-run', 'lobby-milestone', 'lobby-pickup', 'projector-countdown',
  'projector-game', 'journey', 'phone', 'settings']) F[name] = new Footage(name);

/* ── The night, cut to the music (owner, 2026-10-16) ──────────────────
   A whole-system montage on "Happy Dance"'s beat: one title, then the real
   screens one at a time, every screen at once on the chorus, and the end
   card on the song's last hit. Words are corner labels only. */

/** The corner label that names a screen: the kit's small ink plate. */
function cornerLabel(parent, text) {
  const e = textBox(parent, 'label', text, {
    fontSize: '46px', color: '#fff', background: C.ink, padding: '12px 22px 14px', borderRadius: '16px',
    left: '64px', top: '56px', whiteSpace: 'nowrap', boxShadow: '7px 7px 0 rgba(0,0,0,0.28)', letterSpacing: '0.06em',
  });
  return (t) => {
    const k = E.settle(prog(t, 0.08, 0.42));
    put(e, { x: lerp(-60, 0, k), o: prog(t, 0.08, 0.15) });
  };
}

/** A phone body around a portrait clip (the check-in page is made for phones). */
function phoneBody(parent, footage, { h = 900 } = {}) {
  const w = Math.round(h * (390 / 844)) + 32;
  const box = el('div', 'phone', parent);
  box.style.width = `${w}px`;
  box.style.height = `${h + 32}px`;
  const scr = el('div', 'phone__screen', box);
  scr.style.background = '#000';
  const screen = new Screen(scr, footage);
  screen.img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
  return { box, screen, w, h: h + 32 };
}

/**
 * One screen: a flat field in a kit colour, the footage on the catalog's
 * plate, its corner label. `sweep` wipes it in on the beat (the verse); a
 * hard cut (the chorus) pops the plate instead.
 */
function shot(root, { clip, at, label, field, accent, sweep = true, from = 'right', portrait = false, ratio = 16 / 9 }) {
  const body = el('div', 'layer', root);
  body.style.background = field;
  const enter = sweep ? sweepIn(root, body, accent, from) : () => {};
  const drawLabel = cornerLabel(body, label);
  let box, screen, bw, bh;
  if (portrait) {
    const p = phoneBody(body, F[clip], { h: 900 });
    ({ box, screen } = p); bw = p.w; bh = p.h;
  } else {
    bw = ratio > 1.7 ? 1500 : 1380; bh = Math.round(bw / ratio);
    const p = plate(body, F[clip], { w: bw, h: bh, outline: '#fff' });
    box = p.box; screen = p.screen;
  }
  const x = (W - bw) / 2 + (portrait ? 0 : 30);
  const y = (H - bh) / 2 + (portrait ? 0 : 36);
  return (t) => {
    enter(t);
    if (sweep) put(box, { x, y: lerp(H + 60, y, E.settle(prog(t, 0.1, 0.7))) });
    else { const s = lerp(0.9, 1, E.pop(prog(t, 0, 0.36))); put(box, { x, y, s }); }
    wait(screen.set(at(t)));
    drawLabel(t);
  };
}

/** The labels the print server drew (labels.cjs), coming out of the printer on the beat. */
function printing(root, { files, field, accent, sweep = true }) {
  const body = el('div', 'layer', root);
  body.style.background = field;
  const enter = sweep ? sweepIn(root, body, accent) : () => {};
  const drawLabel = cornerLabel(body, 'Label printer');
  const printer = el('div', 'abs', body);
  printer.style.cssText = 'width:900px;height:200px;border-radius:40px 40px 52px 52px;background:#2b2a31;box-shadow:22px 22px 0 rgba(0,0,0,0.3)';
  const lid = el('div', 'abs', printer);
  lid.style.cssText = 'width:900px;height:60px;border-radius:40px 40px 0 0;background:#3a3942';
  const slot = el('div', 'abs', printer);
  slot.style.cssText = 'left:60px;top:22px;width:780px;height:16px;border-radius:8px;background:#0b0b0e';
  const led = el('div', 'abs', printer);
  led.style.cssText = 'left:830px;top:140px;width:26px;height:26px;border-radius:50%;background:#58BD79';
  const window_ = el('div', 'abs', body); // the paper's way out: clipped at the slot
  window_.style.cssText = 'left:540px;top:120px;width:840px;height:560px;overflow:hidden';
  const labels = files.map((n) => {
    const img = el('img', 'abs', window_);
    img.src = `/work/labels/${n}.png`;
    img.style.cssText = 'width:780px;height:390px;left:30px;top:0;background:#fff;border-radius:14px 14px 0 0;box-shadow:0 0 0 2px rgba(0,0,0,0.08)';
    return img;
  });
  return (t) => {
    enter(t);
    put(printer, { x: 510, y: 680 });
    labels.forEach((img, i) => {
      const t0 = 0.25 + i * b(2);
      const k = E.settle(prog(t, t0, b(1.6)));
      // Each new label pushes the last one up and off the top.
      const next = labels[i + 1] ? E.settle(prog(t, 0.25 + (i + 1) * b(2), b(1.6))) : 0;
      put(img, { y: lerp(560, 150, k) - next * 520, o: t >= t0 ? 1 : 0 });
    });
    drawLabel(t);
  };
}

/** Every screen at once: tiles pop in on the beat, each one running. */
function everything(root, tiles) {
  const body = el('div', 'layer', root);
  body.style.background = '#17151c';
  const tw = 560, th = 315, gx = 56, gy = 70;
  const left = (W - (3 * tw + 2 * gx)) / 2, top = 170;
  const items = tiles.map(({ clip, at, label }, i) => {
    const p = plate(body, F[clip], { w: tw, h: th, outline: [C.puggles, C.sparks, C.tnt, C.trek, C.journey, C.sun][i % 6] });
    const tag = textBox(body, 'label', label, { fontSize: '30px', color: '#fff', whiteSpace: 'nowrap', letterSpacing: '0.06em' });
    return { ...p, tag, at, x: left + (i % 3) * (tw + gx), y: top + Math.floor(i / 3) * (th + gy) };
  });
  const head = textBox(body, 'label', 'One club night · every screen', { fontSize: '44px', color: C.sun, left: '0', width: `${W}px`, top: '70px', textAlign: 'center', letterSpacing: '0.08em' });
  return (t) => {
    put(head, { o: prog(t, 0.1, 0.3) });
    items.forEach((it, i) => {
      const t0 = b(i * 2);
      const s = t < t0 ? 0 : lerp(0.6, 1, spring(t, t0, 1.3));
      put(it.box, { x: it.x, y: it.y, s, o: t >= t0 ? 1 : 0 });
      put(it.tag, { x: it.x + 6, y: it.y + th + 22, o: prog(t, t0 + 0.2, 0.2) });
      if (t >= t0) wait(it.screen.set(it.at(t - t0)));
    });
  };
}

/* The opening: the clock is the title (as on the home page), 5:59 to 6:00. */
function opener(root) { // 8 beats: the band comes in on its first frame
  const body = el('div', 'layer', root);
  body.style.background = C.sky;
  const kicker = textBox(body, 'label', 'Wednesday night · Kennebec Valley Baptist Church', { fontSize: '50px', color: C.blueDeep, left: '150px', top: '250px', letterSpacing: '0.06em', whiteSpace: 'nowrap' });
  const clock = textBox(body, 'shout', '5:59', { fontSize: '380px', color: '#fff', left: '138px', top: '330px', textShadow: '18px 18px 0 #1f3566', letterSpacing: '-0.01em' });
  const pm = textBox(body, 'label', 'PM', { fontSize: '88px', color: '#1f3566', left: '1010px', top: '560px' });
  const head = shout(body, 'One club night.', { size: 120, color: '#1f3566' });
  head.box.style.left = '150px';
  head.box.style.top = '760px';
  const deco = cluster(body, 0, 0, [['sparkle-4pt', 1560, 300, 70], ['ring', 1680, 420, 34], ['loop', 1500, 520, 140, 0, 3]], '#fff');
  return (t) => {
    // The band comes in on the first frame: everything is up at once, the
    // title lands on beat 2, the clock turns 6:00 on beat 4.
    put(kicker, { o: prog(t, 0, 0.12), y: lerp(16, 0, E.settle(prog(t, 0, 0.4))) });
    const tick = t >= b(4);
    clock.textContent = tick ? '6:00' : '5:59';
    const s = tick ? lerp(1.08, 1, E.settle(prog(t, b(4), 0.4))) : lerp(0.92, 1, E.settle(prog(t, 0, 0.5)));
    put(clock, { s, o: prog(t, 0, 0.12) });
    put(pm, { o: prog(t, b(0.5), 0.2) });
    land(head.parts, t, b(2), { gap: 0.06, drop: 40, from: 0.4, speed: 1.25 });
    drawCluster(deco, t, b(5));
  };
}

/* The end card: the church's logo lands on the song's last hit. */
function endCard(root) {
  const body = el('div', 'layer', root);
  body.style.background = '#17151c';
  const enter = sweepIn(root, body, C.journey);
  const logo = mark('kvbc-awana-full', body, { width: 1160, tone: 'white', cls: 'abs' });
  const url = textBox(body, 'shout', 'awana.kvbchurch.org', { fontSize: '70px', color: C.sun, left: '0', width: `${W}px`, top: '700px', textAlign: 'center', textTransform: 'none' });
  const legal = textBox(body, 'read', 'Awana® and club marks are trademarks of Awana Clubs International, used here by a member church. Not affiliated with or endorsed by Awana.<br>Music: “Happy Dance” by MercyMe. Every name on screen is made up.', {
    fontSize: '24px', color: 'rgba(255,255,255,0.78)', left: '260px', top: '900px', width: '1400px', textAlign: 'center', lineHeight: '1.5',
  });
  const stripe = el('div', 'abs', body);
  stripe.style.cssText = `top:${H - 22}px;width:${W}px;height:22px;display:flex`;
  for (const club of CLUBS) el('div', null, stripe).style.cssText = `flex:1;background:${C[club]}`;
  const hit = b(8); // song beat 392, the last hit
  return (t) => {
    enter(t);
    const k = t < hit ? 0 : lerp(1.25, 1, E.settle(prog(t, hit, 0.5)));
    put(logo, { x: (W - 1160) / 2, y: 300, s: k, o: t >= hit ? 1 : 0 });
    put(url, { o: prog(t, hit + b(1), 0.3), y: lerp(20, 0, E.settle(prog(t, hit + b(1), 0.5))) });
    put(legal, { o: prog(t, b(1), 0.4) });
    put(stripe, { y: lerp(30, 0, E.settle(prog(t, b(0.5), 0.6))) });
  };
}

/* ── The timeline (film beats; BEAT = one beat of the song) ───────── */

const OVERLAP = 0.75; // a swept scene stays up under the next one's sweep
const T = (n) => b(n);
export const POSTER_AT = T(186.5); // the end card, settled
function build() {
  const S = (name, from, to, fn, sweepNext = true) => scene(name, T(from), T(to) + (sweepNext ? OVERLAP : 0), fn);
  // The verse (song beats 48-95): the title as the band comes in, then one screen at a time.
  S('opener', 0, 8, opener);
  S('lobby-open', 8, 16, (r) => shot(r, { clip: 'lobby-open', at: (t) => 2.6 + t, label: 'Lobby TV', field: C.sun, accent: C.orange }));
  S('phone', 16, 24, (r) => shot(r, { clip: 'phone', at: (t) => 0.9 + t, label: 'Check-in · any phone', field: C.cubbies, accent: C.blueDeep, portrait: true, from: 'left' }));
  S('labels', 24, 30, (r) => printing(r, { files: ['1-maya', '2-noah', '3-ella'], field: C.cream, accent: C.hot }));
  S('lobby-run', 30, 40, (r) => shot(r, { clip: 'lobby-run', at: (t) => 0.3 + t, label: 'Lobby TV', field: C.sparks, accent: C.sparksDeep, from: 'left' }));
  // The countdown runs out (clip 11 s) a beat and a half before the chorus.
  S('countdown', 40, 48, (r) => shot(r, { clip: 'projector-countdown', at: (t) => 8.4 + t, label: 'Projector wall', field: '#000', accent: C.sun }), false);
  // The first chorus (song beats 96-159): a hard cut on every bar, then every screen at once.
  const CHORUS = [
    ['journey', (t) => 1.4 + t * 0.7, 'Journey room', C.journeyInk],
    ['lobby-milestone', (t) => t, 'Lobby TV', C.tnt],
    ['projector-game', (t) => 1 + t, 'Game time', '#000'],
    ['lobby-run', (t) => 8 + t, 'Lobby TV', C.puggles],
    ['settings', (t) => 2 + t, 'Settings · any device', C.cream],
    ['lobby-pickup', (t) => 0.5 + t, 'Pickup board', C.orange],
    [null, null, 'Label printer', C.sun],
    ['phone', (t) => 2.6 + t, 'Check-in · any phone', C.cubbies],
  ];
  CHORUS.forEach(([clip, at, label, field], i) => {
    const from = 48 + i * 4;
    if (!clip) S(`chorus-${i}`, from, from + 4, (r) => printing(r, { files: ['4-leo', '5-sophia', '6-owen'], field, accent: field, sweep: false }), false);
    else S(`chorus-${i}`, from, from + 4, (r) => shot(r, { clip, at, label, field, accent: field, sweep: false, portrait: clip === 'phone', ratio: clip === 'settings' ? 1.6 : 16 / 9 }), false);
  });
  S('everything', 80, 112, (r) => everything(r, [
    { clip: 'lobby-run', at: (t) => 0.5 + t, label: 'Lobby TV' },
    { clip: 'projector-game', at: (t) => 1 + t, label: 'Projector' },
    { clip: 'journey', at: (t) => 1.6 + t * 0.4, label: 'Journey room' },
    { clip: 'lobby-milestone', at: (t) => t, label: 'Lobby TV' },
    { clip: 'lobby-pickup', at: (t) => 0.4 + t, label: 'Pickup board' },
    { clip: 'settings', at: (t) => 1.5 + t * 0.6, label: 'Settings' },
  ]), false);
  // The build (song beats 320-335, after the splice): the Journey room, a breath.
  S('journey', 112, 128, (r) => shot(r, { clip: 'journey', at: (t) => 0.6 + t * 0.7, label: 'Journey room', field: C.journeyInk, accent: C.journey }));
  // The final chorus (song beats 336-391): the screens again, swept in on every other bar.
  S('pickup', 128, 136, (r) => shot(r, { clip: 'lobby-pickup', at: (t) => 2.6 + t, label: 'Pickup board', field: C.orange, accent: C.hot, from: 'left' }));
  S('settings', 136, 144, (r) => shot(r, { clip: 'settings', at: (t) => 1.5 + t, label: 'Settings · any device', field: C.tnt, accent: C.tntDeep, ratio: 1.6 }));
  S('lobby-run-2', 144, 152, (r) => shot(r, { clip: 'lobby-run', at: (t) => 4 + t, label: 'Lobby TV', field: C.trek, accent: C.trekDeep, from: 'left' }));
  S('game', 152, 160, (r) => shot(r, { clip: 'projector-game', at: (t) => 0.5 + t, label: 'Game time', field: '#000', accent: C.tnt }));
  S('labels-2', 160, 168, (r) => printing(r, { files: ['4-leo', '5-sophia', '6-owen'], field: C.cream, accent: C.sparks }));
  S('phone-2', 168, 176, (r) => shot(r, { clip: 'phone', at: (t) => 0.9 + t, label: 'Check-in · any phone', field: C.cubbies, accent: C.blueDeep, portrait: true, from: 'left' }));
  // The end card: the logo lands on the song's last hit (song beat 392 = film beat 184).
  scene('end', T(176), DURATION + 1, endCard);
}

/* ── Seeking ─────────────────────────────────────────────────────── */

async function seek(time) {
  pending = [];
  for (const s of scenes) {
    const on = time >= s.start && time < s.end;
    s.root.style.display = on ? 'block' : 'none';
    if (on) s.update(time - s.start, time);
  }
  await Promise.all(pending);
}

window.film = {
  duration: DURATION,
  beat: BEAT,
  ready: (async () => {
    await document.fonts.ready;
    await Promise.all(['400 100px "Paytone One"', '400 100px "Londrina Solid"', '500 100px "Figtree"', '600 100px "Figtree"'].map((f) => document.fonts.load(f)));
    await loadKit();
    await Promise.all(Object.values(F).map((f) => f.load()));
    build();
    await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
    return true;
  })(),
  seek,
};
