// The KVBC Awana reel: one timeline, every frame a pure function of time.
//
// Story: the problem (a club night, a crowd of names, what each name carries)
// → the promise → the night, one screen at a time, each doing its one
// delightful thing → the payoff. Cut to the soundtrack's beat (BEAT, measured
// off the track: reel/README.md); the music's own structure lands the drops:
// the lift at beat 24 (the title), the melody at beat 88 (6:00 on the
// projector), the final phrase at beat 120 (the payoff).
//
// Real footage comes from record.mjs (/work/footage/<shot>/), the labels from
// labels.cjs (/work/labels/); everything else is drawn from the brand kit.
import { E, clamp, el, kf, lerp, prog, put, spring, squish } from './lib.js';
import { C, CLUBS, Footage, Screen, art, chip, loadKit, mark, words } from './kit.js';

export const BEAT = 60 / 120.2533;
const b = (n) => n * BEAT;
export const DURATION = b(152) + 2.2;

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

/* ── 1. Cold open: a club night, a crowd of names, what each carries ─ */

function coldOpen(root) {
  root.style.background = 'linear-gradient(180deg, #FDB515 0%, #F99D1C 46%, #F47A20 100%)';
  const deco = cluster(root, 0, 0, [
    ['sparkle-4pt-x', 96, 860, 40], ['dot', 196, 950, 14], ['sparkle-4pt', 1800, 940, 46],
  ]);
  const near = cluster(root, 0, 0, [['loop', 1500, 420, 110, -10, 3], ['sparkle-4pt', 1700, 440, 50], ['dot', 1790, 520, 16]]);

  // Part 1: the doors open. The time sits on the right as the lobby's own
  // corner chip does; the words on the left.
  const day = chip(root, 'WEDNESDAY', '5:45 PM', { size: 112, plate: 'rgba(158,53,18,0.55)' });
  const kicker = textBox(root, 'label', 'Club night at Kennebec Valley Baptist', { fontSize: '58px', color: '#fff', left: '150px', top: '416px', letterSpacing: '0.05em', whiteSpace: 'nowrap' });
  const doors = shout(root, 'The doors\nare open.', { size: 220, shadow: '#C2560C' });
  doors.box.style.left = '136px';
  doors.box.style.top = '500px';

  // Part 2: here they come — a crowd of first names.
  const come = shout(root, 'Here they come!', { size: 150, shadow: '#C2560C' });
  come.box.style.left = '0';
  come.box.style.width = `${W}px`;
  come.box.style.textAlign = 'center';
  come.box.style.top = '96px';
  const NAMES = [
    ['Maya', 'sparks', 250, 380, -6], ['Noah', 'tnt', 700, 330, 4], ['Ella', 'puggles', 1150, 360, -3],
    ['Leo', 'cubbies', 1560, 340, 6], ['Sophia', 'trek', 420, 560, 3], ['Owen', 'sparks', 880, 540, -5],
    ['Ava', 'puggles', 1300, 560, 4], ['Ezra', 'cubbies', 1690, 590, -4], ['Ruby', 'cubbies', 180, 760, 5],
    ['Ivy', 'sparks', 560, 790, -4], ['Lucy', 'tnt', 950, 760, 3], ['Eli', 'tnt', 1320, 800, -6],
    ['Nora', 'tnt', 1640, 820, 4], ['Jude', 'sparks', 330, 960, -3], ['Mia', 'puggles', 780, 960, 6],
    ['Caleb', 'trek', 1200, 965, -2],
  ];
  const tags = NAMES.map(([name, club, x, y, r]) => {
    const tag = el('div', 'tag shout', root, name);
    tag.style.background = C[club];
    tag.style.fontSize = '74px';
    tag.style.boxShadow = `0 9px 0 ${C[`${club}Deep`]}`;
    tag.dataset.x = String(x);
    tag.dataset.y = String(y);
    tag.dataset.r = String(r);
    return tag;
  });

  // Part 3: what every name comes with.
  const every = shout(root, 'Every name comes with', { size: 96, shadow: '#C2560C' });
  every.box.style.left = '120px';
  every.box.style.top = '92px';
  const BANDS = [
    ['A birthday this week.', 'sparks'], ['A peanut allergy.', 'tnt'], ['A first night.', 'puggles'], ['A ride home at 7:45.', 'journey'],
  ];
  const bands = BANDS.map(([text, club], i) => {
    const band = el('div', 'band shout', root, text);
    band.style.top = `${232 + i * 196}px`;
    band.style.height = '172px';
    band.style.background = C[club];
    band.style.fontSize = '112px';
    band.style.paddingLeft = '200px';
    band.style.textShadow = `0 8px 0 ${C[`${club}Deep`]}`;
    return band;
  });

  // The six club waves rise over everything (the stinger into the title).
  const waves = CLUBS.map((club, i) => {
    const box = el('div', 'abs', root);
    box.style.width = '2400px';
    box.style.height = '2900px';
    box.style.left = '-240px';
    const svg = art(`wave-${club}`, box, { color: i === 5 ? C.blue : C[club], width: 2400 });
    svg.style.display = 'block';
    const fill = el('div', null, box);
    fill.style.cssText = `width:2400px;height:1700px;margin-top:-4px;background:${i === 5 ? C.blue : C[club]}`;
    return box;
  });

  return (t) => {
    drawCluster(deco, t, 0.15);

    // Part 1 (beats 0-7.5)
    const dk = pop(t, b(0.5));
    put(day, { x: 1090, y: 110 + Math.sin(t * 1.6) * 6, s: dk, r: -3 * dk, o: dk > 0 ? 1 : 0 });
    const kk = E.settle(prog(t, b(1), 0.5));
    put(kicker, { x: lerp(-60, 0, kk), o: prog(t, b(1), 0.2) });
    land(doors.parts, t, b(2), { gap: b(0.5), drop: 80 });
    drawCluster(near, t, b(1.2));
    if (t > b(7.1)) {
      leave([day, kicker, ...doors.parts, ...near], t, b(7.1), { gap: 0.025, d: 0.24 });
    }

    // Part 2 (beats 7.75-15.5)
    land(come.parts, t, b(7.75), { gap: b(0.25), drop: 70 });
    tags.forEach((tag, i) => {
      // On the music: eighth notes, then sixteenths as the crowd builds.
      const t0 = b(i < 8 ? 8.5 + i * 0.5 : 12.5 + (i - 8) * 0.25);
      const k = pop(t, t0, 0.5);
      const bob = Math.sin((t - t0) * 2.4 + i) * 6;
      put(tag, { x: Number(tag.dataset.x) - 90, y: Number(tag.dataset.y) - 60 + bob, s: k, r: Number(tag.dataset.r) * k, o: k > 0 ? 1 : 0 });
    });
    if (t > b(15.4)) {
      leave([...come.parts, ...tags], t, b(15.4), { gap: 0.012, rise: 90, d: 0.26 });
    }
    if (t < b(7.75)) { come.parts.forEach((p) => put(p, { o: 0 })); tags.forEach((g) => put(g, { o: 0 })); }

    // Part 3 (beats 16-22)
    land(every.parts, t, b(16), { gap: b(0.2) });
    bands.forEach((band, i) => {
      const t0 = b(17 + i);
      const k = E.wipe(prog(t, t0, 0.36));
      const from = i % 2 ? W + 100 : -W - 100;
      put(band, { x: lerp(from, 0, k), r: -1.6, o: t >= t0 ? 1 : 0 });
    });
    if (t < b(16)) { every.parts.forEach((p) => put(p, { o: 0 })); }

    // The stinger (beats 22-24): the six club waves, the house blue last,
    // which is the title's field when the lift lands on beat 24.
    waves.forEach((w, i) => {
      const t0 = b(22) + i * 0.085;
      const k = E.wipe(prog(t, t0, 0.56));
      put(w, { y: lerp(H + 40, -1500, k), o: t >= t0 ? 1 : 0 });
    });
  };
}

/* ── 2. The promise ──────────────────────────────────────────────── */

function title(root) {
  root.style.background = C.blue;
  const clouds = [[-160, 520, 980, 0.5], [1100, -160, 1100, 0.42]].map(([x, y, w, o]) => {
    const c = art('tip-blob', root, { color: '#fff', cls: 'abs', width: w });
    c.style.opacity = String(o * 0.35);
    c.dataset.x = String(x);
    c.dataset.y = String(y);
    return c;
  });
  const tab = cornerTab(root, 'tab-b-sparks', C.orange, ['KVBC', 'Awana'], { width: 470, size: 64 });
  const kicker = textBox(root, 'label', 'The screens of a club night', { fontSize: '60px', color: C.sun, left: '160px', top: '296px', letterSpacing: '0.06em' });
  const head = shout(root, 'Every child,\ngreeted by name.', { size: 176, shadow: C.blueDeep, letters: true });
  head.box.style.left = '150px';
  head.box.style.top = '380px';
  const deco = cluster(root, 0, 0, [['sparkle-4pt', 1720, 300, 64], ['squiggle-s', 1640, 390, 110, 0, 3], ['dot', 1800, 470, 18]]);
  // The catalog's club strip (p.93): every club's mark on one band.
  const strip = el('div', 'abs', root);
  strip.style.cssText = `width:${W}px;height:170px;background:${C.orange};display:flex;align-items:center;justify-content:space-around;padding:0 90px`;
  const marks = CLUBS.map((club) => {
    const m = mark(club, strip, { height: club === 'tnt' ? 96 : club === 'journey' || club === 'trek' ? 44 : 78 });
    return m;
  });
  return (t) => {
    clouds.forEach((c, i) => put(c, { x: Number(c.dataset.x) + Math.sin(t * 0.35 + i) * 30, y: Number(c.dataset.y), o: 0.35 }));
    drawTab(tab, t, 0.18);
    put(kicker, { x: lerp(-40, 0, E.settle(prog(t, 0.35, 0.5))), o: prog(t, 0.35, 0.2) });
    land(head.parts, t, 0.12, { gap: 0.032, drop: 40, from: 0.3, speed: 1.3 });
    drawCluster(deco, t, b(3));
    const sk = E.settle(prog(t, b(4), 0.6));
    put(strip, { y: lerp(H + 10, H - 170, sk) });
    marks.forEach((m, i) => {
      const k = pop(t, b(4) + 0.18 + i * 0.07, 0.5);
      put(m, { s: k, o: k > 0 ? 1 : 0 });
    });
  };
}

/* ── 3. At the door: the label prints itself ─────────────────────── */

function door(root) {
  const body = el('div', 'layer', root);
  body.style.background = '#FFFFFF';
  const enter = sweepIn(root, body, C.orange);
  const blob = art('wave-cubbies', body, { color: C.cream, cls: 'abs', width: 2200 });
  put(blob, { x: -140, y: 560 });
  const tab = cornerTab(body, 'tab-a-cubbies', C.orange, ['At the', 'door'], { width: 430, size: 60 });
  const head = shout(body, 'The label\nprints itself.', { size: 112, color: '#F7941D' });
  head.box.style.left = '120px';
  head.box.style.top = '300px';
  const sub = textBox(body, 'label', 'Check a child in. That’s the whole job.', { fontSize: '50px', color: C.hot, left: '124px', top: '566px' });
  const copy = textBox(body, 'read', 'A 4×2 name label prints the moment a child is checked in on TwoTimTwo, with the allergy, the birthday and the photo wishes a leader needs to see.', {
    fontSize: '34px', color: C.ink, left: '124px', top: '646px', width: '700px',
  });
  const btn = el('div', 'button-kit label', body, 'Check in');
  Object.assign(btn.style, { background: C.tnt, fontSize: '50px', boxShadow: `0 8px 0 ${C.tntDeep}` });
  const cursor = el('div', 'cursor', body, `<svg viewBox="0 0 46 60" width="46" height="60"><path d="M4 2 L4 50 L16 39 L24 57 L32 53 L24 36 L41 36 Z" fill="#fff" stroke="${C.ink}" stroke-width="4" stroke-linejoin="round"/></svg>`);

  // The printer: a flat drawing, its slot along the front.
  const P = { x: 1090, y: 120, w: 760, h: 290 };
  const SLOT = { x: P.x + 50, y: P.y + P.h - 44, w: P.w - 100 };
  const printer = el('div', 'printer', body, `
    <div style="position:absolute;left:0;top:0;width:${P.w}px;height:${P.h}px;border-radius:46px 46px 30px 30px;background:#2F3640;box-shadow:0 14px 0 #1D2228"></div>
    <div style="position:absolute;left:40px;top:34px;width:${P.w - 80}px;height:124px;border-radius:28px;background:#3D4652"></div>
    <div style="position:absolute;left:66px;top:62px;width:170px;height:22px;border-radius:11px;background:#5A6470"></div>
    <div style="position:absolute;left:66px;top:100px;width:110px;height:16px;border-radius:8px;background:#4C5662"></div>
    <div class="p-light" style="position:absolute;right:70px;top:60px;width:30px;height:30px;border-radius:50%;background:${C.tnt}"></div>
    <div style="position:absolute;left:40px;top:${P.h - 56}px;width:${P.w - 80}px;height:24px;border-radius:12px;background:#14181D"></div>`);
  printer.style.width = `${P.w}px`;
  printer.style.height = `${P.h}px`;
  put(printer, { x: P.x, y: P.y });
  const light = printer.querySelector('.p-light');
  // Labels come out of the slot: a window under it clips what is still inside.
  const out = el('div', 'abs', body);
  out.style.cssText = `left:${SLOT.x}px;top:${SLOT.y}px;width:${SLOT.w}px;height:700px;overflow:hidden`;
  const LABELS = ['1-maya', '2-noah', '3-ella'].map((n) => {
    const img = el('img', 'label-img', out);
    img.src = `/work/labels/${n}.png`;
    return img;
  });
  const LX = SLOT.x + (SLOT.w - 600) / 2;  // a printed label's left edge on screen
  const LY = SLOT.y + 26;                   // and its top, once it is out
  // Printed labels pile up beside the text, bottom left of the printer.
  const stack = LABELS.map((img) => {
    const s = el('img', 'label-img', body);
    s.src = img.src;
    return s;
  });
  // Callouts: Londrina labels with a drawn arrow to the thing on the label
  // (positions in the label's own 600x300 drawing, from generateLabel()).
  const callouts = [
    { text: 'Birthday this week', tx: 1120, ty: 770, at: [262, 252], color: C.sparks, from: [1310, 762] },
    { text: 'Peanut allergy', tx: 1530, ty: 840, at: [545, 262], color: C.tntDeep, from: [1690, 832] },
    { text: 'No photos', tx: 1440, ty: 790, at: [532, 258], color: C.ink, from: [1640, 784] },
  ].map((c) => {
    const e = textBox(body, 'callout label', c.text, { fontSize: '48px', color: c.color, whiteSpace: 'nowrap' });
    const a = arrow(body, c.from, [LX + c.at[0], LY + c.at[1] + 22], c.color);
    return { ...c, e, a };
  });

  return (t) => {
    enter(t);
    drawTab(tab, t, 0.25);
    land(head.parts, t, 0.3, { gap: b(0.25), drop: 50 });
    put(sub, { x: lerp(-40, 0, E.settle(prog(t, b(2), 0.5))), o: prog(t, b(2), 0.2) });
    put(copy, { y: lerp(30, 0, E.settle(prog(t, b(2.5), 0.5))), o: prog(t, b(2.5), 0.3) });
    // The press: the button pops in, the pointer comes and clicks.
    const bk = pop(t, b(1.5));
    const press = t > b(2.9) && t < b(3.2) ? 0.92 : 1;
    put(btn, { x: 124, y: 880, s: bk * press, o: bk > 0 ? 1 : 0 });
    const ck = E.settle(prog(t, b(2.1), 0.6));
    put(cursor, { x: lerp(520, 330, ck), y: lerp(1040, 912, ck), s: t > b(2.9) && t < b(3.2) ? 0.9 : 1, o: prog(t, b(2.1), 0.15) });
    // The printer arrives, its light blinks while printing.
    const pk = E.settle(prog(t, 0.2, 0.7));
    put(printer, { x: P.x, y: lerp(P.y - 400, P.y, pk), o: prog(t, 0.2, 0.2) });
    const printing = (t > b(3) && t < b(5)) || (t > b(7.5) && t < b(9.5)) || (t > b(10.3) && t < b(11.6));
    light.style.background = printing && Math.floor(t * 8) % 2 ? C.sun : C.tnt;
    // Each label: feed out of the slot (in steps, as a thermal printer
    // does), then lift onto the stack.
    const feeds = [[b(3), b(7.2)], [b(7.5), b(10.2)], [b(10.4), 99]];
    LABELS.forEach((img, i) => {
      const [t0, t1] = feeds[i];
      const lin = prog(t, t0, b(2));
      const k = E.out(lin) + Math.sin(lin * Math.PI * 9) * 0.008 * (1 - lin);
      put(img, { x: (SLOT.w - 600) / 2, y: lerp(-300, 26, k), o: t >= t0 && t < t1 ? 1 : 0 });
      const s = stack[i];
      const lk = E.settle(prog(t, t1, 0.6));
      // Visible box (half size) top-left at (vx, vy); put() scales about the centre.
      const vx = 900 + i * 38, vy = 790 + i * 20;
      put(s, {
        x: lerp(LX, vx - 150, lk), y: lerp(LY, vy - 75, lk) - Math.sin(lk * Math.PI) * 60,
        r: lerp(0, -10 + i * 7, lk), s: lerp(1, 0.5, lk), o: t >= t1 ? 1 : 0,
      });
    });
    // Callouts on the label that is out.
    const show = [[b(5), b(7.1)], [b(5.4), b(7.1)], [b(9.6), b(10.3)]];
    callouts.forEach((c, i) => {
      const [t0, t1] = show[i];
      const k = pop(t, t0, 0.45);
      const gone = E.exit(prog(t, t1 - 0.22, 0.22));
      const o = k > 0 && gone < 1 ? 1 - gone : 0;
      put(c.e, { x: c.tx, y: c.ty, s: k, o });
      c.a.draw(prog(t, t0 + 0.08, 0.35), o);
    });
  };
}

/* ── 4. On any phone ─────────────────────────────────────────────── */

function phone(root) {
  const body = el('div', 'layer', root);
  body.style.background = C.sky;
  const enter = sweepIn(root, body, C.blue, 'left');
  const cloud = art('tip-blob', body, { color: C.cloud, cls: 'abs', width: 1300 });
  put(cloud, { x: -300, y: 520 });
  const tab = cornerTab(body, 'tab-a-puggles', C.blue, ['On any', 'phone'], { width: 430, size: 60 });
  const head = shout(body, 'Check in\nfrom any phone.', { size: 104, shadow: C.blueDeep });
  head.box.style.left = '120px';
  head.box.style.top = '300px';
  const copy = textBox(body, 'read', 'awana.kvbchurch.org/checkin, signed in with the church passphrase. Search a name, tap, done: the label prints at the door.', {
    fontSize: '36px', color: C.ink, left: '124px', top: '540px', width: '820px',
  });
  const deco = cluster(body, 0, 0, [['sparkle-4pt', 980, 230, 52], ['dot', 1050, 300, 15], ['zigzag', 960, 820, 60, 0, 3]]);
  const PH = { w: 440, h: 965 };
  const ph = el('div', 'phone', body);
  ph.style.width = `${PH.w}px`;
  ph.style.height = `${PH.h}px`;
  const scr = el('div', 'phone__screen', ph);
  const bar = el('div', 'phone__bar', scr, '<span>6:02</span><span class="phone__icons"><i></i><i></i><b></b></span>');
  const view = el('div', 'phone__view', scr);
  el('div', 'phone__hole', ph);
  const screen = new Screen(view, F.phone);
  const tap = el('div', 'tap', view);
  const MAP = (lt) => 0.95 + lt * 1.12; // reel time → phone footage time
  return (t) => {
    enter(t);
    drawTab(tab, t, 0.25);
    land(head.parts, t, 0.3, { gap: b(0.25), drop: 50 });
    put(copy, { y: lerp(30, 0, E.settle(prog(t, b(2), 0.5))), o: prog(t, b(2), 0.3) });
    drawCluster(deco, t, b(2));
    const pk = E.settle(prog(t, 0.15, 0.8));
    put(ph, { x: 1330, y: lerp(H + 40, 58, pk), r: lerp(8, -3, pk) });
    const ft = MAP(t);
    wait(screen.set(ft));
    // A finger's tap where the recording tapped.
    const sc = (PH.w - 32) / F.phone.meta.viewport.width;
    let shown = false;
    for (const tp of F.phone.meta.taps || []) {
      const dt = ft - tp.t;
      if (dt > -0.12 && dt < 0.45) {
        const k = clamp((dt + 0.12) / 0.57);
        put(tap, { x: tp.x * sc, y: tp.y * sc, s: lerp(0.5, 1.3, E.out(k)), o: 1 - k * k });
        shown = true;
      }
    }
    if (!shown) put(tap, { o: 0 });
  };
}

/* ── 5. In the lobby ────────────────────────────────────────────── */

function lobby(root) {
  const body = el('div', 'layer', root);
  body.style.background = C.sparks;
  const enter = sweepIn(root, body, C.sun);
  // The field behind the TV changes to the club on screen (colour blocking).
  const fields = ['sparks', 'tnt', 'puggles', 'cubbies', 'trek', 'blue'].map((club) => {
    const f = el('div', 'layer', body);
    f.style.background = C[club];
    f.dataset.club = club;
    return f;
  });
  const decoA = cluster(body, 0, 0, [['sparkle-4pt', 120, 940, 50], ['dot', 210, 1010, 16], ['squiggle-wave', 1800, 860, 60, 0, 3]]);
  const tab = cornerTab(body, 'tab-b-sparks', C.orange, ['In the', 'lobby'], { width: 430, size: 60 });
  const PW = 1500, PHh = 844;
  const p = plate(body, null, { w: PW, h: PHh, outline: '#fff' });
  const screens = {
    open: new Screen(p.face, F['lobby-open']),
    run: new Screen(p.face, F['lobby-run']),
    milestone: new Screen(p.face, F['lobby-milestone']),
  };
  // Captions, on the beat, each with the moment it names.
  const drawCaps = captions(body, [
    [0.0, 'The lobby TV says hello'],
    [b(5), 'Every child, by first name'],
    [b(7.5), 'The first one in gets a shout-out'],
    [b(10), 'A birthday gets a sticker'],
    [b(15), 'A first night says New!'],
    [b(20), 'The room celebrates together'],
  ]);
  // Which footage, from when (scene seconds → clip seconds), and the field
  // colour behind it: always the club on screen.
  const CUTS = [
    { from: 0, clip: 'open', at: (lt) => 1.6 + lt, field: 'sparks' },
    { from: b(10), clip: 'run', at: (lt) => 1.1 + (lt - b(10)), field: 'tnt' },
    { from: b(15), clip: 'run', at: (lt) => 4.75 + (lt - b(15)), field: 'puggles' },
    { from: b(20), clip: 'milestone', at: (lt) => 0.45 + (lt - b(20)), field: 'blue' },
  ];
  return (t) => {
    enter(t);
    drawTab(tab, t, 0.25);
    drawCluster(decoA, t, b(1));
    let cut = CUTS[0];
    for (const c of CUTS) if (t >= c.from) cut = c;
    fields.forEach((f) => { f.style.visibility = f.dataset.club === cut.field ? 'visible' : 'hidden'; });
    // The plate rises in, then holds; a small push on each cut.
    const k = E.settle(prog(t, 0.1, 0.8));
    const push = cut.from > 0 ? 1 + 0.035 * (1 - E.out(prog(t, cut.from, 0.45))) : 1;
    put(p.box, { x: (W - PW) / 2 + 30, y: lerp(H + 60, 196, k), s: push });
    for (const [key, sc] of Object.entries(screens)) {
      const on = key === cut.clip;
      sc.img.style.visibility = on ? 'visible' : 'hidden';
      if (on) wait(sc.set(cut.at(t)));
    }
    drawCaps(t);
  };
}

/* ── 6. On the big screen ───────────────────────────────────────── */

function bigScreen(root) {
  const body = el('div', 'layer', root);
  body.style.background = C.journeyInk;
  const enter = sweepIn(root, body, C.hot, 'left');
  const tab = cornerTab(body, 'tab-c-trek', C.hot, ['On the', 'big screen'], { width: 470, size: 56 });
  const PW = 1500, PHh = 844;
  const p = plate(body, null, { w: PW, h: PHh, outline: C.sun });
  const cd = new Screen(p.face, F['projector-countdown']);
  const game = new Screen(p.face, F['projector-game']);
  const drawCaps = captions(body, [[0, 'Counting down to 6:00'], [b(8), 'Right on time'], [b(14), 'Game time, with a timer']], { left: 520 });
  // The countdown clip reaches 0:00 at 8.55 s: land it on beat 88, eight
  // beats in. Game time's TWO MINUTES turns at 5.5 s of its clip.
  const ZERO = 8.55;
  return (t) => {
    enter(t);
    drawTab(tab, t, 0.25);
    const k = E.settle(prog(t, 0.1, 0.8));
    const onGame = t >= b(14);
    put(p.box, { x: (W - PW) / 2 + 30, y: lerp(H + 60, 196, k), s: onGame ? 1 + 0.035 * (1 - E.out(prog(t, b(14), 0.45))) : 1 });
    cd.img.style.visibility = onGame ? 'hidden' : 'visible';
    game.img.style.visibility = onGame ? 'visible' : 'hidden';
    if (onGame) wait(game.set(3.4 + (t - b(14))));
    else wait(cd.set(ZERO - b(8) + t));
    drawCaps(t);
  };
}

/* ── 7. Journey, pickup, settings: three quick ones ─────────────── */

function framed(root, { color, accent, tab: [shape, lines, tabColor], clip, at, caption, outline = '#fff', browser = false, zoom = null, from = 'right' }) {
  const body = el('div', 'layer', root);
  body.style.background = color;
  const enter = sweepIn(root, body, accent, from);
  const tab = cornerTab(body, shape, tabColor, lines, { width: 470, size: 56 });
  const drawCap = captions(body, [[0.3, caption]], { left: 520, shadow: 'rgba(0,0,0,0.28)' });
  let screen, box;
  if (browser) {
    box = el('div', 'browser', body);
    box.style.width = '1440px';
    box.style.height = '964px';
    box.innerHTML = `<div class="browser__bar"><span class="browser__dot" style="background:#F04A4B"></span><span class="browser__dot" style="background:#FCB614"></span><span class="browser__dot" style="background:#58BD79"></span><span class="browser__url">awana.kvbchurch.org/settings</span></div><div class="browser__view"></div>`;
    screen = new Screen(box.querySelector('.browser__view'), F[clip]);
  } else {
    const p = plate(body, F[clip], { w: 1500, h: 844, outline });
    box = p.box;
    screen = p.screen;
  }
  if (zoom) screen.img.style.willChange = 'transform';
  return (t) => {
    enter(t);
    drawTab(tab, t, 0.25);
    const k = E.settle(prog(t, 0.1, 0.8));
    if (zoom) { screen.img.style.transformOrigin = `${kf(t, zoom.ox).toFixed(2)}% ${zoom.oy}%`; screen.img.style.transform = `scale(${kf(t, zoom.scale).toFixed(4)})`; }
    if (browser) put(box, { x: (W - 1440) / 2 + 30, y: lerp(H + 60, 186, k) });
    else put(box, { x: (W - 1500) / 2 + 30, y: lerp(H + 60, 196, k) });
    wait(screen.set(at(t)));
    drawCap(t);
  };
}

/* ── 8. The payoff ───────────────────────────────────────────────── */

function oneApp(root) {
  const body = el('div', 'layer', root);
  body.style.background = C.cream;
  const enter = sweepIn(root, body, C.blue, 'left');
  const tab = cornerTab(body, 'tab-a-cubbies', C.blue, ['One app'], { width: 400, size: 64 });
  const head = shout(body, 'KVBC Awana\nfor Windows.', { size: 124, color: C.blue });
  head.box.style.left = '120px';
  head.box.style.top = '290px';
  const copy = textBox(body, 'read', 'One app for every computer at club: it prints the labels, runs a screen, or both. It updates itself.', { fontSize: '40px', color: C.ink, left: '124px', top: '584px', width: '800px' });
  const roles = [['This computer', 'Prints labels', C.sparks], ['This computer', 'Runs a screen', C.tnt], ['Or', 'Both', C.hot]].map(([l, v, c]) => chip(body, l.toUpperCase(), v.toUpperCase(), { size: 68, plate: c }));
  const deco = cluster(body, 0, 0, [['sparkle-4pt', 1800, 96, 56, 0], ['dot', 1870, 170, 16], ['coil-spring', 1690, 880, 90, 0, 3]], C.blue);
  return (t) => {
    enter(t);
    drawTab(tab, t, 0.2);
    land(head.parts, t, 0.25, { gap: b(0.25) });
    put(copy, { y: lerp(30, 0, E.settle(prog(t, b(1.5), 0.5))), o: prog(t, b(1.5), 0.3) });
    roles.forEach((r, i) => {
      const k = pop(t, b(2 + i * 1.5), 0.5);
      put(r, { x: 1130 + i * 60, y: 210 + i * 225, s: k, r: (i - 1) * 2, o: k > 0 ? 1 : 0 });
    });
    drawCluster(deco, t, b(1));
  };
}

function montage(root) {
  root.style.background = C.ink;
  const CUTS = [
    ['lobby-open', 6.2, 'sparks'], ['lobby-run', 1.7, 'tnt'], ['phone', 5.3, 'cubbies'], ['lobby-run', 5.45, 'puggles'],
    ['projector-countdown', 9.0, 'hot'], ['lobby-milestone', 4.4, 'blue'], ['projector-game', 6.2, 'tnt'], ['lobby-pickup', 2.6, 'orange'],
  ];
  const cells = CUTS.map(([clip, at, club]) => {
    const layer = el('div', 'layer', root);
    layer.style.background = C[club];
    const isPhone = clip === 'phone';
    const w = isPhone ? 440 : 1560, h = isPhone ? 952 : 878;
    const p = plate(layer, F[clip], { w, h, outline: '#fff' });
    put(p.box, { x: (W - w) / 2, y: (H - h) / 2 });
    return { layer, p, at, w, h };
  });
  return (t) => {
    const i = clamp(Math.floor(t / BEAT), 0, cells.length - 1);
    cells.forEach((c, j) => {
      c.layer.style.visibility = j === i ? 'visible' : 'hidden';
      if (j !== i) return;
      const lt = t - j * BEAT;
      const s = lerp(1.07, 1, E.out(prog(lt, 0, BEAT)));
      put(c.p.box, { x: (W - c.w) / 2, y: (H - c.h) / 2, s });
      wait(c.p.screen.set(c.at + lt));
    });
  };
}

function closer(root) {
  const body = el('div', 'layer', root);
  body.style.background = C.blue;
  const enter = sweepIn(root, body, C.sun);
  // The six clubs' waves, layered along the foot like the catalog's openers.
  const waves = ['journey', 'trek', 'tnt', 'sparks', 'cubbies', 'puggles'].map((club, i) => {
    const w = art(`wave-${club}`, body, { color: C[club], cls: 'abs', width: 2400, height: 520, preserve: 'none' });
    w.dataset.i = String(i);
    return w;
  });
  const tab = cornerTab(body, 'tab-b-sparks', C.orange, ['KVBC', 'Awana'], { width: 470, size: 64 });
  const head = shout(body, 'Every child,\ngreeted by name.', { size: 168, shadow: C.blueDeep, letters: true });
  head.box.style.left = '150px';
  head.box.style.top = '270px';
  const url = chip(body, 'SEE IT ALL AT', 'AWANA.KVBCHURCH.ORG', { size: 70, plate: C.hot });
  const credit = textBox(body, 'read', 'Free. Made at Kennebec Valley Baptist Church.', { fontSize: '38px', color: '#fff', left: '156px', top: '826px', fontWeight: '600' });
  const deco = cluster(body, 0, 0, [['sparkle-4pt', 1680, 230, 64], ['loop', 1560, 300, 120, 0, 3], ['dot', 1790, 380, 18]]);
  return (t) => {
    enter(t);
    drawTab(tab, t, 0.2);
    land(head.parts, t, 0.3, { gap: 0.03, drop: 40, from: 0.3, speed: 1.3 });
    const uk = pop(t, b(3), 0.5);
    put(url, { x: 150, y: 630, s: uk, o: uk > 0 ? 1 : 0 });
    put(credit, { y: lerp(20, 0, E.settle(prog(t, b(4), 0.5))), o: prog(t, b(4), 0.3) });
    drawCluster(deco, t, b(2));
    waves.forEach((w, i) => {
      const k = E.settle(prog(t, b(1) + i * 0.08, 0.9));
      const flip = i % 2 ? -1 : 1;
      put(w, { x: -240 + Math.sin(t * 0.55 + i) * 26, y: lerp(H + 40, 770 + i * 40, k), sx: flip });
    });
  };
}

function legal(root) {
  const body = el('div', 'layer', root);
  body.style.background = '#FFFFFF';
  const enter = sweepIn(root, body, C.blue);
  const line = textBox(body, 'read', 'Awana® and club marks are trademarks of Awana Clubs International, used here by a member church. Not affiliated with or endorsed by Awana.', {
    fontSize: '30px', color: '#3D4450', left: '360px', top: '470px', width: '1200px', textAlign: 'center', lineHeight: '1.45', fontWeight: '500',
  });
  const small = textBox(body, 'label', 'KVBC Awana · awana.kvbchurch.org', { fontSize: '40px', color: C.blue, left: '0', width: `${W}px`, top: '640px', textAlign: 'center' });
  // The six club colours, one slim band along the foot.
  const stripe = el('div', 'abs', body);
  stripe.style.cssText = `top:${H - 22}px;width:${W}px;height:22px;display:flex`;
  for (const club of CLUBS) el('div', null, stripe).style.cssText = `flex:1;background:${C[club]}`;
  return (t) => {
    enter(t);
    put(line, { o: prog(t, 0.5, 0.4) });
    put(small, { o: prog(t, 0.7, 0.4) });
    put(stripe, { y: lerp(30, 0, E.settle(prog(t, 0.4, 0.6))) });
  };
}

/* ── The timeline ────────────────────────────────────────────────── */

const OVERLAP = 0.75; // a scene stays up under the next one's sweep
const T = (n) => b(n);
function build() {
  scene('open', 0, T(24) + OVERLAP, coldOpen);
  scene('title', T(24), T(32) + OVERLAP, title);
  scene('door', T(32), T(44) + OVERLAP, door);
  scene('phone', T(44), T(52) + OVERLAP, phone);
  scene('lobby', T(52), T(80) + OVERLAP, lobby);
  scene('big', T(80), T(100) + OVERLAP, bigScreen);
  scene('journey', T(100), T(108) + OVERLAP, (r) => framed(r, {
    color: C.journey, accent: C.journeyDeep, tab: ['tab-c-journey', ['At large', 'group'], C.journeyInk],
    clip: 'journey', at: (t) => 0.85 + t, caption: 'At 6:30, the lesson is ready', outline: C.journeyTint,
  }));
  scene('pickup', T(108), T(114) + OVERLAP, (r) => framed(r, {
    color: C.orange, accent: C.hot, tab: ['tab-b-tnt', ['At', 'pickup'], C.hot],
    clip: 'lobby-pickup', at: (t) => 0.8 + Math.min(t, 3), caption: 'Who isn’t checked out yet', from: 'left',
    zoom: { scale: [[0, 1], [0.6, 1], [1.3, 2.1, E.inOut]], ox: [[0, 50], [0.6, 50], [1.3, 16, E.inOut], [2.95, 66, E.inOut]], oy: 93 },
  }));
  scene('settings', T(114), T(120) + OVERLAP, (r) => framed(r, {
    color: C.tnt, accent: C.tntDeep, tab: ['tab-a-puggles', ['Every', 'screen'], C.tntDeep],
    clip: 'settings', at: (t) => 1.6 + t * 1.25, caption: 'One settings page for all', browser: true,
  }));
  scene('app', T(120), T(128) + OVERLAP, oneApp);
  scene('montage', T(128), T(136) + OVERLAP, montage);
  scene('closer', T(136), T(148) + OVERLAP, closer);
  scene('legal', T(148), DURATION + 1, legal);
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
