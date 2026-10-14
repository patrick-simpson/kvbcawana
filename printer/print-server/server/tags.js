'use strict';
// Drop-off tag, BARF tag and bag labels, per-club label templates.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const lazy = require('./lazy');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const syncClient = require('../sync-client');
const { cleanText } = require('../textClean');
const fs    = require('fs');
const $config = lazy('./config');
const $eventBuffer = lazy('./event-buffer');
const $labelLayout = lazy('./label-layout');
const $clubbers = lazy('./clubbers');
const $eligibility = lazy('./eligibility');
const $images = lazy('./images');
const $labelType = lazy('./label-type');
const $labelRender = lazy('./label-render');
const $ledger = lazy('./ledger');
const $attendanceAudit = lazy('./attendance-audit');
const $relay = lazy('./relay');

// What other modules (and server.js) read from this one; live bindings, so cycles are safe.
Object.defineProperties(exports, {
  barfBagOwner: { enumerable: true, get: () => barfBagOwner },
  cleanFriendName: { enumerable: true, get: () => cleanFriendName },
  connectCardGreeting: { enumerable: true, get: () => connectCardGreeting },
  dropOffTagFor: { enumerable: true, get: () => dropOffTagFor },
  generateBarfBag: { enumerable: true, get: () => generateBarfBag },
  generateBarfTag: { enumerable: true, get: () => generateBarfTag },
  generateDropOffTag: { enumerable: true, get: () => generateDropOffTag },
  isBarfNight: { enumerable: true, get: () => isBarfNight },
  LABEL_TEMPLATE_BOOLEANS: { enumerable: true, get: () => LABEL_TEMPLATE_BOOLEANS },
  labelFooterText: { enumerable: true, get: () => labelFooterText },
  labelTemplateFor: { enumerable: true, get: () => labelTemplateFor },
  reportFriend: { enumerable: true, get: () => reportFriend },
  sanitizeLabelTemplate: { enumerable: true, get: () => sanitizeLabelTemplate },
  sanitizeLabelTemplates: { enumerable: true, get: () => sanitizeLabelTemplates },
});

// ── The drop-off tag (7.7.0; on the label printer since 7.17.0) ──────────────
// A child who arrives late gets a plain name tag and the family gets ONE
// extra label: "Drop-off locations at 6:42 PM", then a line
// per child of the household (TwoTimTwo's, from the check-in laptop's
// /touch/context; a child it doesn't place is a household of one), each with
// where their club is right now. Owner's choices: the whole household, printed
// with the first late child, once per family per night.
const dropOffPrinted = new Map();   // household key -> local day it printed
function dropOffName(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function titleCaseName(s) {
  return String(s || '').split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
}
function dropOffTagFor(firstName, lastName, clubName, now = new Date(), opts = {}) {
  const self = dropOffName(`${firstName} ${lastName}`);
  if (!self) return null;
  const ctx = $attendanceAudit.loadTouchContext();
  const house = (ctx.households || []).find(h => h.includes(self)) || [self];
  const key = house.slice().sort().join('|');
  const today = $eventBuffer.localDayISO(now);
  if (!opts.demo && dropOffPrinted.get(key) === today) return null;
  const roster = $clubbers.loadClubbers();
  const byName = new Map(roster.map(r => [dropOffName(`${r.FirstName || ''} ${r.LastName || ''}`), r]));
  const lines = [];
  for (const member of house) {
    const r = byName.get(member);
    if (member !== self && (!r || String(r.Inactive || '').trim())) continue;
    const club = member === self ? (clubName || (r && r.Club) || '') : String((r && r.Club) || '').trim();
    const row = $ledger.scheduleRowFor(club, now);
    if (!row) continue;
    const first = member === self ? String(firstName).trim() : String((r && r.FirstName) || member.split(' ')[0]).trim();
    lines.push({ first: first || titleCaseName(member.split(' ')[0]), club, activity: row.location || '', place: row.room || '' });
  }
  if (!lines.length) return null;
  lines.sort((a, b) => a.first.localeCompare(b.first));
  if (!opts.demo) dropOffPrinted.set(key, today);
  const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return { title: `Drop-off locations at ${time}`, family: titleCaseName(String(lastName || '').trim()) || 'this', lines };
}
// The drop-off label (redesigned 7.18.0). Read at arm's length by a parent in
// a hurry, so the hierarchy is: who, then WHERE, then what is happening there.
//   - A black band: GO TO on the left, the time on the right. Never the
//     word "late" (owner, 2026-10-08: nothing on it singles a child out).
//   - One child: the club mark large on the left, the name in the shout, then
//     the room large, the activity under it.
//   - Siblings: one row each, the club mark, the name, a dotted leader and the
//     room set flush right (the activity under it while the rows are tall
//     enough, beside it after a dot when they are not). One name size and one
//     room size for every row, so the card reads as a list.
// Monochrome and nothing thinner than 0.8 pt: it prints on the D450's 203 dpi
// head. Every size steps down until the widest row fits; a mark that will not
// draw falls back to the club's monogram.
const DROP_M = 10;          // side margin
const DROP_BAND = 24;       // header band height
async function dropOffMark(club) {
  try { return await $labelRender.thermalClubMark($eligibility.clubKey(club), false); } catch (e) { return null; }
}
// ── The BARFED tag (8.1.0, owner 2026-10-11) ─────────────────────────────────
// BARF Night is "Bring A Real Friend". A child who brought one that night gets
// a second name tag to choose from: a slime band with drips across the top
// with BARFED! knocked out of it, their first name below, and two ink splats
// (8.2.0: no line under the name, the owner's pick of the drafts). One colour
// like every label here: the fun is in the shapes.
// Which nights are BARF Nights: church-config.json `barfNights` (dates).
// (config.json's own `barfNights`, when set, wins: a test, or a moved night.)
function isBarfNight(now = new Date()) {
  const nights = Array.isArray($config.config.barfNights) ? $config.config.barfNights
    : Array.isArray($config.churchConfig.barfNights) ? $config.churchConfig.barfNights : [];
  return nights.includes($eventBuffer.localDayISO(now));
}

// The friend's first name as a volunteer typed it: one line, no control
// characters, at most 24 characters. '' for anything else.
function cleanFriendName(raw) {
  return cleanText(raw, 24, { control: '', angle: true, collapse: true });
}

// Tell the sync service who brought a friend tonight (BARF Night's 6:30 email,
// owner 2026-10-11): the child, their club and the friend's first name (or
// none, from TwoTimTwo's own desk box). Only while signed in to the service;
// best effort, never in the way of a label.
function reportFriend(f) {
  if (!$relay.signedInToSync()) return;
  syncClient.syncRequest($config.config.syncUrl, '/v1/cloud/friend', {
    method: 'POST', session: $config.config.syncSession,
    body: { name: `${f.firstName} ${f.lastName}`.trim(), club: f.clubName || '', clubberId: f.clubberId || null, friendName: f.friendName || '' },
  }).then((r) => { if (!r || !r.ok) console.warn(`[barf] friend not recorded on the sync service (${r ? r.status : 'no answer'})`); })
    .catch(() => console.warn('[barf] friend not recorded on the sync service'));
}

// Drips hang off the band: x, length (pt), width. Short over the middle so they
// never reach the name; long at the sides.
const BARF_DRIPS = Object.freeze([
  [14, 30, 11], [38, 15, 8], [64, 22, 10], [104, 8, 7], [140, 12, 8],
  [178, 7, 7], [212, 18, 9], [246, 13, 8], [274, 32, 11],
]);
const BARF_BAND = 40;

async function generateBarfTag({ firstName }) {
  const cvs = createCanvas($labelRender.PX_W, $labelRender.PX_H);
  const ctx = cvs.getContext('2d');
  ctx.scale($labelRender.SCALE, $labelRender.SCALE);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, $labelLayout.PAGE_W, $labelLayout.PAGE_H);
  const type = $labelType.labelType('');
  const ink = '#000000';

  // The slime: a band with a wavy lower edge and drips with round ends.
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo($labelLayout.PAGE_W, 0);
  ctx.lineTo($labelLayout.PAGE_W, BARF_BAND);
  for (let x = $labelLayout.PAGE_W; x >= 0; x -= 12) {
    ctx.quadraticCurveTo(x - 6, BARF_BAND + ((x / 12) % 2 ? 4 : -2), x - 12, BARF_BAND);
  }
  ctx.closePath();
  ctx.fill();
  for (const [x, len, w] of BARF_DRIPS) {
    ctx.beginPath();
    ctx.moveTo(x - w / 2 - 3, BARF_BAND - 2);
    ctx.quadraticCurveTo(x - w / 2, BARF_BAND + 2, x - w / 2, BARF_BAND + len - w / 2);
    ctx.arc(x, BARF_BAND + len - w / 2, w / 2, Math.PI, 0, true);
    ctx.quadraticCurveTo(x + w / 2, BARF_BAND + 2, x + w / 2 + 3, BARF_BAND - 2);
    ctx.closePath();
    ctx.fill();
    // A drop about to fall from the longest drips.
    if (len >= 22) { ctx.beginPath(); ctx.arc(x, BARF_BAND + len + 6, w * 0.28, 0, Math.PI * 2); ctx.fill(); }
  }

  // BARFED!, knocked out of the band.
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const word = 'BARFED!';
  const ws = type.fit(ctx, 'name', word, $labelLayout.PAGE_W - 40, 30, 16);
  type.fill(ctx, 'name', ws, word, $labelLayout.PAGE_W / 2, BARF_BAND / 2 + 1 + type.capCentre(ctx, 'name', word) * ws);

  // Two splats, low in the corners.
  const splat = (cx, cy, r) => {
    ctx.fillStyle = ink;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    [[1.5, -0.6, 0.32], [-1.4, -0.9, 0.24], [1.1, 1.2, 0.2], [-1.6, 0.8, 0.28], [0.2, -1.7, 0.18]].forEach(([dx, dy, k]) => {
      ctx.beginPath(); ctx.arc(cx + dx * r, cy + dy * r, r * k, 0, Math.PI * 2); ctx.fill();
    });
  };
  splat(20, 124, 6);
  splat($labelLayout.PAGE_W - 22, 120, 5);

  // The name, alone below the slime (owner, 2026-10-11: no line under it).
  const first = String(firstName || '').trim() || 'Friend';
  ctx.fillStyle = ink;
  const ns = type.fit(ctx, 'name', first, $labelLayout.PAGE_W - 70, 46, 16);
  type.fill(ctx, 'name', ns, first, $labelLayout.PAGE_W / 2, 98 + type.capCentre(ctx, 'name', first) * ns);

  const pngPath = $images.tmpFilePath('awana-barf', 'png');
  const buffer = cvs.toBuffer('image/png');
  fs.writeFileSync(pngPath, buffer);
  return { pngPath, buffer };
}

// ── BARF Bag labels (8.2.0, owner 2026-10-11) ──────────────────────────────────
// One for each child who brought a friend tonight and one for each friend, to
// stick on their bag: "SOPHIA'S" big, then a slime band rising from the bottom
// with BARF BAG in it. All of them print as ONE job (printImages).
function barfBagOwner(name) {
  const first = String(name || '').trim().split(/\s+/)[0].toLocaleUpperCase('en-US').slice(0, 24);
  if (!first) return '';
  return /S$/.test(first) ? `${first}’` : `${first}’S`;
}

// `info`: {club} for a child (their club under the name), {friendOf} for a
// friend ("FRIEND OF SOPHIA": a friend has no club in TwoTimTwo), neither for
// a label with the name alone.
async function generateBarfBag(name, info = {}) {
  const cvs = createCanvas($labelRender.PX_W, $labelRender.PX_H);
  const ctx = cvs.getContext('2d');
  ctx.scale($labelRender.SCALE, $labelRender.SCALE);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, $labelLayout.PAGE_W, $labelLayout.PAGE_H);
  const type = $labelType.labelType('');
  const ink = '#000000';
  const top = $labelLayout.PAGE_H - BARF_BAND;

  // The slime rises from the bottom: a band, a wavy top edge, drips pointing up.
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.moveTo(0, $labelLayout.PAGE_H);
  ctx.lineTo($labelLayout.PAGE_W, $labelLayout.PAGE_H);
  ctx.lineTo($labelLayout.PAGE_W, top);
  for (let x = $labelLayout.PAGE_W; x >= 0; x -= 12) ctx.quadraticCurveTo(x - 6, top - ((x / 12) % 2 ? 4 : -2), x - 12, top);
  ctx.closePath();
  ctx.fill();
  for (const [x, len, w] of BARF_DRIPS) {
    const l = Math.min(len, 22);
    ctx.beginPath();
    ctx.moveTo(x - w / 2 - 3, top + 2);
    ctx.quadraticCurveTo(x - w / 2, top - 2, x - w / 2, top - l + w / 2);
    ctx.arc(x, top - l + w / 2, w / 2, Math.PI, 0, false);
    ctx.quadraticCurveTo(x + w / 2, top - 2, x + w / 2 + 3, top + 2);
    ctx.closePath();
    ctx.fill();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  const bag = 'BARF BAG';
  const bs = type.fit(ctx, 'name', bag, $labelLayout.PAGE_W - 40, 28, 14);
  type.fill(ctx, 'name', bs, bag, $labelLayout.PAGE_W / 2, top + BARF_BAND / 2 + 1 + type.capCentre(ctx, 'name', bag) * bs);

  const owner = barfBagOwner(name) || 'MY';
  // Between the name and the slime: the child's club, or whose friend this is.
  // With that line the name rides higher and smaller, so both sit above the drips.
  const club = String((info && info.club) || '').trim();
  const friendOf = String((info && info.friendOf) || '').trim().split(/\s+/)[0];
  const sub = club ? club.toLocaleUpperCase('en-US') + (friendOf ? ' FRIEND' : '') : friendOf ? `FRIEND OF ${friendOf.toLocaleUpperCase('en-US')}` : '';
  ctx.fillStyle = ink;
  const os2 = type.fit(ctx, 'name', owner, $labelLayout.PAGE_W - 36, sub ? 34 : 44, 14);
  type.fill(ctx, 'name', os2, owner, $labelLayout.PAGE_W / 2, (sub ? 30 : 42) + type.capCentre(ctx, 'name', owner) * os2);
  if (sub) {
    const ss = type.fit(ctx, 'name', sub, $labelLayout.PAGE_W - 36, 20, 10);
    type.fill(ctx, 'name', ss, sub, $labelLayout.PAGE_W / 2, 64 + type.capCentre(ctx, 'name', sub) * ss);
  }

  const pngPath = $images.tmpFilePath('awana-barfbag', 'png');
  fs.writeFileSync(pngPath, cvs.toBuffer('image/png'));
  return { pngPath };
}

async function generateDropOffTag(tag) {
  const cvs = createCanvas($labelRender.PX_W, $labelRender.PX_H);
  const ctx = cvs.getContext('2d');
  ctx.scale($labelRender.SCALE, $labelRender.SCALE);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, $labelLayout.PAGE_W, $labelLayout.PAGE_H);
  const type = $labelType.labelType('');
  const ink = '#000000';
  const M = DROP_M;

  // The band.
  const timeText = String(tag.title || '').replace(/^.*\bat\s+/i, '').trim();
  ctx.fillStyle = ink;
  ctx.fillRect(0, 0, $labelLayout.PAGE_W, DROP_BAND);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  type.fill(ctx, 'band', 15, 'GO TO', M, DROP_BAND / 2 + 0.5);
  if (timeText) {
    ctx.textAlign = 'right';
    const ts = 15;
    type.fill(ctx, 'name', ts, timeText, $labelLayout.PAGE_W - M, DROP_BAND / 2 + type.capCentre(ctx, 'name', timeText) * ts);
  }

  const marks = await Promise.all(tag.lines.map((l) => dropOffMark(l.club)));
  // A mark fills a box `bw` wide and `bh` tall, centred: the wordmarks
  // (Sparks, Cubbies, Trek) are wide and the badges (T&T) square, so a square
  // box printed the wordmarks tiny.
  const drawMark = (i, x, y, bw, bh) => {
    const art = marks[i];
    if (art) {
      const scale = Math.min(bw / art.width, bh / art.height);
      const w = art.width * scale;
      const h = art.height * scale;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(art.canvas, x + (bw - w) / 2, y + (bh - h) / 2, w, h);
      return;
    }
    const mono = $images.CLUB_MONOGRAM[$eligibility.clubKey(tag.lines[i].club)] || '?';
    const r = Math.min(bw, bh) * 0.46;
    ctx.fillStyle = ink;
    ctx.beginPath(); ctx.arc(x + bw / 2, y + bh / 2, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const ms = type.fit(ctx, 'monogram', mono, r * 1.5, r, 6);
    type.fill(ctx, 'monogram', ms, mono, x + bw / 2, y + bh / 2 + type.capCentre(ctx, 'monogram', mono) * ms);
  };
  // Cap height of the shout at a size, so a read line can share its baseline.
  const capH = (size) => {
    const r = type.inkReach(ctx, 'name', 'H', 'alphabetic');
    return (r ? r.above : 0.7) * size;
  };
  const shout = (text, size, x, y, align = 'left') => {
    ctx.fillStyle = ink; ctx.textAlign = align; ctx.textBaseline = 'middle';
    type.fill(ctx, 'name', size, text, x, y + type.capCentre(ctx, 'name', text) * size);
  };
  const read = (role, text, size, x, y, align = 'left') => {
    ctx.fillStyle = ink; ctx.textAlign = align; ctx.textBaseline = 'middle';
    type.fill(ctx, role, size, text, x, y);
  };

  const top = DROP_BAND;
  const bottom = $labelLayout.PAGE_H - 6;
  const n = tag.lines.length;

  if (n === 1) {
    // One child: the hero layout.
    const l = tag.lines[0];
    const bw = 92, bh = 72;
    const markX = M;
    const midY = top + (bottom - top) / 2;
    drawMark(0, markX, midY - bh / 2, bw, bh);
    const x = markX + bw + 14;
    const w = $labelLayout.PAGE_W - M - x;
    const nameSize = type.fit(ctx, 'name', l.first, w, 30, 12);
    const roomText = l.place || l.activity || '';
    const actText = l.place && l.activity ? l.activity : '';
    const roomSize = type.fit(ctx, 'goTo', roomText, w, 19, 9);
    const actSize = Math.min(12, roomSize * 0.7);
    const gap = 9;
    const blockH = nameSize * 0.8 + gap + roomSize + (actText ? 2 + actSize : 0);
    let y = midY - blockH / 2;
    shout(l.first, nameSize, x, y + nameSize * 0.4);
    y += nameSize * 0.8 + gap;
    read('goTo', roomText, roomSize, x, y + roomSize / 2);
    y += roomSize + 2;
    if (actText) read('milestone', actText, actSize, x, y + actSize / 2);
  } else {
    // Siblings: an even list.
    const rowH = (bottom - top - 4) / n;
    const bh = Math.min(rowH * 0.74, 30);
    const bw = Math.min(bh * 1.75, 46);
    const twoLine = rowH >= 30;
    const rows = tag.lines.map((l) => ({
      name: l.first,
      room: l.place || l.activity || '',
      act: l.place && l.activity ? l.activity : '',
    }));
    const left = M + bw + 8;
    const right = $labelLayout.PAGE_W - M;
    const LEADER_MIN = 26;
    let nameSize = Math.min(22, rowH * 0.56);
    let roomSize = Math.min(14, rowH * (twoLine ? 0.36 : 0.44));
    const actSizeOf = (rs) => rs * 0.74;
    const rightW = (r) => twoLine
      ? Math.max(type.measure(ctx, 'goTo', roomSize, r.room), r.act ? type.measure(ctx, 'milestone', actSizeOf(roomSize), r.act) : 0)
      : type.measure(ctx, 'goTo', roomSize, r.room) + (r.act ? type.measure(ctx, 'milestone', actSizeOf(roomSize), ` \u00b7 ${r.act}`) : 0);
    const fits = () => rows.every((r) => type.measure(ctx, 'name', nameSize, r.name) + LEADER_MIN + rightW(r) <= right - left);
    while (!fits() && (nameSize > 8 || roomSize > 6)) {
      nameSize = Math.max(8, nameSize - 0.5);
      roomSize = Math.max(6, roomSize - 0.4);
    }
    rows.forEach((r, i) => {
      const y0 = top + 2 + rowH * i;
      const cy = y0 + rowH / 2;
      drawMark(i, M, cy - bh / 2, bw, bh);
      shout(r.name, nameSize, left, cy);
      const nameEnd = left + type.measure(ctx, 'name', nameSize, r.name);
      let roomStart;
      const as = actSizeOf(roomSize);
      if (twoLine && r.act) {
        const lineGap = 1.5;
        const blockH = roomSize + lineGap + as;
        const yRoom = cy - blockH / 2 + roomSize / 2;
        read('goTo', r.room, roomSize, right, yRoom, 'right');
        read('milestone', r.act, as, right, yRoom + roomSize / 2 + lineGap + as / 2, 'right');
        roomStart = right - Math.max(type.measure(ctx, 'goTo', roomSize, r.room), type.measure(ctx, 'milestone', as, r.act));
      } else {
        // One line: the room and the activity on the NAME's baseline.
        const base = cy + capH(nameSize) / 2;
        const tail = r.act ? ` \u00b7 ${r.act}` : '';
        const tailW = tail ? type.measure(ctx, 'milestone', as, tail) : 0;
        ctx.fillStyle = ink; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
        if (tail) type.fill(ctx, 'milestone', as, tail, right, base);
        type.fill(ctx, 'goTo', roomSize, r.room, right - tailW, base);
        roomStart = right - tailW - type.measure(ctx, 'goTo', roomSize, r.room);
      }
      // The dotted leader, from the name to the room, just above the name's
      // baseline, the way a printed menu runs its dots.
      const from = nameEnd + 5;
      const to = roomStart - 5;
      const dotY = cy + capH(nameSize) / 2 - 1.2;
      ctx.fillStyle = ink;
      for (let x = from; x <= to; x += 3.2) {
        ctx.beginPath(); ctx.arc(x, dotY, 0.8, 0, Math.PI * 2); ctx.fill();
      }
    });
  }

  const pngPath = $images.tmpFilePath('awana-dropoff', 'png');
  const buffer = cvs.toBuffer('image/png');
  fs.writeFileSync(pngPath, buffer);
  return { pngPath, buffer };
}

// Operator-configured footer (#8) — one short line (church name, a verse,
// service times) along the bottom of every label. Read from config here, at
// the call sites, and passed INTO generateLabel as input.footerText: the
// renderer stays a pure function of its argument, which is what keeps the
// golden-image suite meaningful.
function labelFooterText() {
  return String($config.config.labelFooter || '').trim();
}

// Connect-card greeting (#10) — operator-configurable, with the long-standing
// default. Read from config at the call site (never inside the renderer) for
// the same purity reason as labelFooterText above.
const DEFAULT_CONNECT_GREETING = "We're so glad you're here!";
function connectCardGreeting() {
  return String($config.config.connectCardGreeting || '').trim() || DEFAULT_CONNECT_GREETING;
}

// ── Per-club label templates (#1) ─────────────────────────────────────────────
// config.labelTemplates is a map of clubKey (or 'default') → a small object of
// layout OVERRIDES. Only deviations from the stock label are stored — a switch
// that's on and a name ceiling of 48 are the defaults, not data — which keeps
// config.json tiny and lets the default layout evolve without stale copies of
// it frozen in every install's config.
const LABEL_TEMPLATE_BOOLEANS = [
  'showIconPanel', 'showLastName', 'showClubLine',
  'showGroupLine', 'showVisitorPill', 'showFooter',
];
const LABEL_TEMPLATE_MAX_CLUBS = 12;

// One template: returns the overrides-only form, or null for a non-object.
function sanitizeLabelTemplate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = { version: 1 };
  for (const k of LABEL_TEMPLATE_BOOLEANS) {
    if (raw[k] === false) out[k] = false;
  }
  if (raw.nameMaxPt !== undefined) {
    const n = Math.round(Number(raw.nameMaxPt));
    if (Number.isFinite(n) && n >= 18 && n < 48) out.nameMaxPt = n;
  }
  return out;
}

// The whole map. Club keys are normalized through clubKey() so 'T&T', 't & t'
// and 'tnt' can't become three diverging templates. clubKey() returns null for
// a club it doesn't recognize, so an unrecognized key is dropped here — a
// custom-named club is served by the 'default' entry instead, which is also
// how labelTemplateFor resolves it at print time.
// Returns {ok, value} or {ok:false, error}.
function sanitizeLabelTemplates(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'templates must be an object keyed by club name (or "default")' };
  }
  const out = {};
  for (const rawKey of Object.keys(raw).slice(0, LABEL_TEMPLATE_MAX_CLUBS)) {
    const key = rawKey === 'default' ? 'default' : $eligibility.clubKey(rawKey);
    if (!key) continue;
    const t = sanitizeLabelTemplate(raw[rawKey]);
    if (!t || Object.keys(t).length <= 1) continue;   // no overrides → nothing to store
    out[key] = t;
  }
  return { ok: true, value: out };
}

// Resolve the template for one club: exact club entry, else 'default', else
// null (stock label). Type-guarded at every step — this reads persisted
// config, and a hand-edited config.json must degrade, not throw, mid-event.
function labelTemplateFor(clubName) {
  const all = $config.config.labelTemplates;
  if (!all || typeof all !== 'object' || Array.isArray(all)) return null;
  const key = $eligibility.clubKey(clubName);
  const chosen = (key && all[key]) || all.default || null;
  return (chosen && typeof chosen === 'object' && !Array.isArray(chosen)) ? chosen : null;
}
