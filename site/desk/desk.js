// The desk check-in page (ROADMAP.md#online-check-in, P3). The screen: search
// families-first with "did you mean", tap children (brothers and sisters
// together), visitors, one-off name tags, undo / remove / check out, Brought a
// friend and the friend's first name. Everything that talks to the Worker or
// seals is desk-transport.js; the search, households and grouping are the touch
// check-in's own touch-core block (classic globals, injected into index.html by
// desk-page.mjs): norm, searchPeople, groupFamilies.
//
// A late child's "Go to" drop-off card is the print role's: it reads the job
// this page sealed (who, club, items) and the clock, so nothing here decides it.
import * as cc from './cloud-crypto.js';
import { createDesk, DeskError, printLabel } from './desk-transport.js';

/* global norm, searchPeople, groupFamilies */
const $ = (id) => document.getElementById(id);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const desk = createDesk({
  cc,
  fetch: (...a) => window.fetch(...a),
  store: {
    get: (k) => localStorage.getItem(k),
    set: (k, v) => localStorage.setItem(k, v),
    remove: (k) => localStorage.removeItem(k),
  },
});

// ── State ──────────────────────────────────────────────────────────────────
const CLUBS = ['Puggles', 'Cubbies', 'Sparks', 'T&T', 'Trek', 'Journey'];
const KIT = {
  puggles: { color: '#1DB6D9', deep: '#1A627C' }, cubbies: { color: '#4C72B8', deep: '#2F4F8A' },
  sparks: { color: '#F04A4B', deep: '#B82B32' }, tnt: { color: '#58BD79', deep: '#2F8A4E' },
  trek: { color: '#047E71', deep: '#02554C' }, journey: { color: '#8A649D', deep: '#56467F' },
};
let KIDS = [];                 // the roster: {clubberId, first, last, club, clubId, checkedIn}
let HOUSEHOLDS = null;         // householdIndex()-shaped
let ITEMS = { bible: [], friend: [] };
let rosterLoaded = false;
let TONIGHT_SERVER = null;     // GET /v1/desk/tonight (P5), when it exists
let tonightTried = false;
const PENDING = {};            // clubberId -> true while a check-in is in flight
let SEL = null;                // the family on the right: { title, kids: [person], choice: { recid: {on, bible, friend, friendName} } }
let view = 'family';
let busyUntil = 0;
let busyTimer = null;
let rosterTimer = null;
let statusTimer = null;
let familiesAt = 0;
let signedInOnce = false;

// What this desk did tonight and the roster cannot say: visitors, and who it checked out.
// Per night, per tab (sessionStorage); a reload keeps it.
function loadLocal() {
  try {
    const v = JSON.parse(sessionStorage.getItem('awanaDeskLocal.v1') || 'null');
    if (v && v.night === desk.night) return v;
  } catch { /* none */ }
  return { night: desk.night, visitors: [], out: [] };
}
let LOCAL = { night: '', visitors: [], out: [] };
function saveLocal() { try { sessionStorage.setItem('awanaDeskLocal.v1', JSON.stringify(LOCAL)); } catch { /* the list lasts this load */ } }

function clubKit(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return '';
  if (n.indexOf('puggle') !== -1) return 'puggles';
  if (n.indexOf('cubbie') !== -1) return 'cubbies';
  if (n.indexOf('spark') !== -1) return 'sparks';
  if (n.indexOf('trek') !== -1) return 'trek';
  if (n.indexOf('journey') !== -1) return 'journey';
  if (n.indexOf('t&t') !== -1 || n.indexOf('t & t') !== -1 || n === 'tnt' || n === 't t') return 'tnt';
  return '';
}
const clubOf = (name) => KIT[clubKit(name)] || { color: '#64748B', deep: '#334155' };

// ── Toast and busy ─────────────────────────────────────────────────────────
let toastTimer = null;
function toast(msg, ms, kind) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (kind ? ' ' + kind : '');
  void t.offsetWidth;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), ms || 3500);
}

// The 5 s read budget: a 429 shows "busy, try again in Ns" and counts down.
function setBusy(retryAfterMs) {
  busyUntil = Date.now() + (retryAfterMs || 5000);
  clearInterval(busyTimer);
  const tick = () => {
    const left = Math.ceil((busyUntil - Date.now()) / 1000);
    const b = $('busy');
    if (left <= 0) { clearInterval(busyTimer); busyTimer = null; b.hidden = true; return; }
    b.hidden = false;
    b.textContent = `TwoTimTwo is busy: try again in ${left}s.`;
  };
  tick();
  busyTimer = setInterval(tick, 500);
}
const isBusy = () => Date.now() < busyUntil;

// ── Roster ─────────────────────────────────────────────────────────────────
function nameOf(k) { return `${k.first} ${k.last}`.trim(); }
function person(k) {
  return { name: nameOf(k), recid: 'id:' + k.clubberId, clubId: k.clubId, clubName: k.club || '', kid: k, checkedIn: !!k.checkedIn || !!PENDING[k.clubberId] };
}
const waitingPeople = () => KIDS.filter((k) => !k.checkedIn && !PENDING[k.clubberId]).map(person);
function itemsFor(club) {
  const has = (list) => (list || []).some((c) => clubKit(c) && clubKit(c) === clubKit(club));
  return { bible: has(ITEMS.bible), friend: has(ITEMS.friend) };
}

function applyRoster(data) {
  rosterLoaded = true;
  KIDS = (data.kids || []).map((k) => {
    const mine = KIDS.find((o) => o.clubberId === k.clubberId);
    // Keep what this page knows is newer than the Worker's last read.
    return mine && PENDING[k.clubberId] ? mine : k;
  });
  ITEMS = data.items || { bible: [], friend: [] };
  $('stale').hidden = !data.stale;
  render();
  renderTonight();
  renderCount();
}
function applyFamilies(data) {
  const byName = {}, members = {};
  (data.households || []).forEach((h, i) => {
    const names = (h || []).map(norm).filter(Boolean);
    if (names.length < 2) return;
    members['h' + i] = names;
    names.forEach((n) => { byName[n] = 'h' + i; });
  });
  HOUSEHOLDS = Object.keys(members).length ? { byName, members } : null;
  familiesAt = Date.now();
  render();
}

function onError(e, prefix) {
  if (e instanceof DeskError && e.code === 'signed-out') { showSignIn(e.message); return; }
  if (e instanceof DeskError && e.code === 'busy') { setBusy(e.retryAfterMs); toast((prefix || '') + e.message, 5000, 'bad'); return; }
  toast((prefix || '') + (e && e.message ? e.message : 'Something went wrong.'), 7000, 'bad');
}

async function pollRoster() {
  clearTimeout(rosterTimer);
  let wait = document.hidden ? 60000 : 15000;
  try {
    applyRoster(await desk.roster());
    if (!HOUSEHOLDS || Date.now() - familiesAt > 30 * 60 * 1000) {
      try { applyFamilies(await desk.families()); } catch (e) { if (e.code === 'busy') wait = Math.max(wait, e.retryAfterMs || 5000); }
    }
    if (!tonightTried) {
      tonightTried = true;
      try { TONIGHT_SERVER = await desk.tonight(); renderCount(); } catch { /* the roster's own count stands */ }
    }
  } catch (e) {
    if (e.code === 'signed-out') { showSignIn(e.message); return; }
    // The Worker says when the 5 s clock is free again; ask then, not sooner.
    if (e.code === 'busy') { setBusy(e.retryAfterMs); wait = (e.retryAfterMs || 5000) + 250; }
    else if (!rosterLoaded) toast(e.message, 6000, 'bad');
    else $('stale').hidden = false;
  }
  rosterTimer = setTimeout(pollRoster, wait);
}

async function pollStatus() {
  clearTimeout(statusTimer);
  const led = $('print-led');
  try {
    const s = await desk.printStatus();
    const l = printLabel(s, Date.now());
    led.className = 'led ' + l.kind;
    led.textContent = l.text;
  } catch (e) {
    if (e.code === 'signed-out') { showSignIn(e.message); return; }
    led.className = 'led check';
    led.textContent = e.code === 'unreachable' ? 'No connection: check the internet' : 'Printer status unknown';
  }
  statusTimer = setTimeout(pollStatus, document.hidden ? 60000 : 10000);
}

// ── Drawing ────────────────────────────────────────────────────────────────
function stripe(f) {
  const stops = f.kids.map((c) => clubOf(c.clubName).color);
  return stops.length > 1 ? stops.join(',') : stops[0] + ',' + stops[0];
}
const famLabel = (f) => (f.kids.length === 1 ? f.kids[0].name : f.name + ': ' + f.kids.map((c) => c.name.split(' ')[0]).join(', '));

function famTile(f) {
  const b = el('button', 'fam');
  b.type = 'button';
  b.style.setProperty('--stripe', stripe(f));
  const single = f.kids.length === 1;
  b.appendChild(el('div', 'fn', single ? f.kids[0].name : f.name));
  const line = el('div', 'kids');
  f.kids.forEach((c) => {
    const k = el('span', 'kid'), d = el('span', 'dot');
    d.style.setProperty('--c', clubOf(c.clubName).color);
    k.appendChild(d);
    k.appendChild(document.createTextNode(single ? (c.clubName || '') : c.name.split(' ')[0]));
    line.appendChild(k);
  });
  b.appendChild(line);
  b.setAttribute('aria-label', famLabel(f));
  b.onclick = () => pickFamily(f, null);
  return b;
}
function famCard(f, hits) {
  const b = el('button', 'fcard');
  b.type = 'button';
  b.style.setProperty('--stripe', stripe(f));
  const single = f.kids.length === 1;
  b.appendChild(el('div', 'fn', single ? f.kids[0].name : f.name));
  const line = el('div', 'kids');
  f.kids.forEach((c) => {
    const k = el('span', 'kid' + (hits[c.recid] ? ' hit' : ''));
    k.style.setProperty('--c', clubOf(c.clubName).color);
    k.appendChild(el('span', 'dot'));
    k.appendChild(document.createTextNode(single ? (c.clubName || '') : c.name.split(' ')[0]));
    line.appendChild(k);
  });
  b.appendChild(line);
  b.setAttribute('aria-label', famLabel(f));
  b.onclick = () => pickFamily(f, hits);
  return b;
}
function kidCard(p, fam) {
  const club = clubOf(p.clubName);
  const b = el('button', 'card' + (p.checkedIn ? ' in' : ''));
  b.type = 'button';
  b.style.setProperty('--club', p.checkedIn ? '#CBD5E1' : club.color);
  b.style.setProperty('--deep', club.deep);
  const txt = el('div');
  txt.style.cssText = 'flex:1;min-width:0';
  txt.appendChild(el('div', 'nm', p.name));
  txt.appendChild(el('div', 'cl', p.clubName || ''));
  b.appendChild(txt);
  if (p.checkedIn) { b.appendChild(el('span', 'tag', 'Checked in')); b.setAttribute('aria-disabled', 'true'); }
  else b.onclick = () => pickFamily(fam || { kids: [p], name: p.name }, { [p.recid]: true });
  return b;
}

function render() {
  if (!$('work') || $('work').hidden) return;
  const q = $('search').value;
  $('search-clear').hidden = !q;
  const list = $('list');
  list.textContent = '';
  if (!rosterLoaded) list.appendChild(el('div', 'note', 'Reading the roster…'));
  else if (!KIDS.length) list.appendChild(el('div', 'note', 'TwoTimTwo has nobody on tonight’s check-in page yet. Is the meeting set up?'));
  else if (!q.trim()) renderFamilies(list);
  else renderSearch(list, q);
}

// Families still to come (the search box is empty).
function renderFamilies(list) {
  const all = groupFamilies(waitingPeople(), HOUSEHOLDS);
  if (!all.length) { list.appendChild(el('div', 'cheer', 'Everyone’s checked in!')); return; }
  list.appendChild(el('div', 'lead', all.length + (all.length === 1 ? ' family' : ' families') + ' still to come'));
  const grid = el('div', 'fams');
  all.forEach((f) => grid.appendChild(famTile(f)));
  list.appendChild(grid);
}

// Typing: families first, then "Did you mean", then the children on their own panel.
function renderSearch(list, q) {
  const everyone = KIDS.map(person);
  const r = searchPeople(everyone, q);
  const fams = groupFamilies(waitingPeople(), HOUSEHOLDS);
  const famOf = {};
  fams.forEach((f) => f.kids.forEach((k) => { famOf[k.recid] = f; }));
  const hits = {}, seen = {};
  const famsFor = (people) => {
    const out = [];
    people.forEach((p) => {
      if (p.checkedIn) return;
      hits[p.recid] = true;
      const f = famOf[p.recid];
      if (f && !seen[f.key]) { seen[f.key] = true; out.push(f); }
    });
    return out;
  };
  const exact = famsFor(r.matches);
  const near = norm(q).length >= 3 ? famsFor(r.close) : [];
  // A child who is a family of one is already their family card; the panel lists the
  // brothers and sisters the cards hold, and anyone already in.
  const kids = r.matches.filter((p) => p.checkedIn || (famOf[p.recid] && famOf[p.recid].kids.length > 1));
  if (exact.length) {
    list.appendChild(el('div', 'sec', exact.length === 1 ? 'Family' : 'Families'));
    const g = el('div', 'rfams');
    exact.forEach((f) => g.appendChild(famCard(f, hits)));
    list.appendChild(g);
  }
  if (near.length) {
    list.appendChild(el('div', 'sec', exact.length ? 'Or did you mean' : 'Did you mean'));
    const g2 = el('div', 'rfams');
    near.forEach((f) => g2.appendChild(famCard(f, hits)));
    list.appendChild(g2);
  }
  if (kids.length) {
    const panel = el('div', 'panel');
    panel.appendChild(el('div', 'sec', 'Children'));
    const g3 = el('div', 'grid');
    kids.forEach((p) => g3.appendChild(kidCard(p, famOf[p.recid])));
    panel.appendChild(g3);
    list.appendChild(panel);
  }
  if (!exact.length && !near.length && !kids.length) {
    list.appendChild(el('div', 'note', 'No child matches “' + q.trim() + '”. A visitor? Tap “+ More” for a visitor.'));
  }
}

$('search').addEventListener('input', render);
$('search').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const first = $('list').querySelector('.fcard, .fam');
  if (first) first.click();
});
$('search-clear').addEventListener('click', () => { $('search').value = ''; render(); $('search').focus(); });

// ── The family on the right ────────────────────────────────────────────────
// Tap a family (or a child) and its waiting children are tiles: tap to choose,
// Bible ticked where the club has it, Brought a friend (and the friend's first
// name) where the club has that. Brothers and sisters are chosen together.
function pickFamily(f, hits) {
  const kids = f.kids.filter((p) => !p.checkedIn && !PENDING[p.kid.clubberId]);
  if (!kids.length) return;
  const choice = {};
  kids.forEach((p) => {
    const it = itemsFor(p.clubName);
    // A family of one, or the child just tapped in a search, is already chosen.
    const on = kids.length === 1 || (hits && !!hits[p.recid] && Object.keys(hits).length === 1);
    choice[p.recid] = { on, bible: it.bible, friend: false, friendName: '' };
  });
  SEL = { title: kids.length === 1 ? kids[0].name : (f.name || 'This family'), kids, choice };
  setView('family');
  renderFamilyView();
  $('work').classList.add('show-right');
}

function optButton(label, on, onChange) {
  const b = el('button', 'opt' + (on ? ' on' : ''));
  b.type = 'button';
  const box = el('span', 'box', on ? '✓' : '');
  b.appendChild(box);
  b.appendChild(document.createTextNode(label));
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    const now = !b.classList.contains('on');
    b.classList.toggle('on', now);
    box.textContent = now ? '✓' : '';
    b.setAttribute('aria-pressed', now ? 'true' : 'false');
    onChange(now);
  });
  return b;
}

function renderFamilyView() {
  const v = $('family-view');
  v.textContent = '';
  if (!SEL || !SEL.kids.length) {
    v.appendChild(el('div', 'note', 'Pick a family on the left. Tap each child who is here, then Check in.'));
    return;
  }
  const head = el('div', 'fhead');
  head.appendChild(el('h2', null, SEL.title));
  head.appendChild(el('p', null, SEL.kids.length === 1 ? 'Tap Check in.' : 'Tap each child who is here. Brothers and sisters check in together.'));
  v.appendChild(head);
  const tiles = el('div', 'tiles');
  SEL.kids.forEach((p) => {
    const ch = SEL.choice[p.recid];
    const club = clubOf(p.clubName), it = itemsFor(p.clubName);
    const t = el('div', 'tile' + (ch.on ? ' on' : '') + (PENDING[p.kid.clubberId] ? ' sending' : ''));
    t.setAttribute('role', 'button');
    t.tabIndex = 0;
    t.setAttribute('aria-pressed', ch.on ? 'true' : 'false');
    t.dataset.name = p.name;
    t.style.setProperty('--club', club.color);
    t.style.setProperty('--deep', club.deep);
    t.appendChild(el('div', 'nm', p.name));
    t.appendChild(el('div', 'cl', p.clubName || ''));
    t.appendChild(el('span', 'tick', ch.on ? '✓' : ''));
    const toggle = () => { ch.on = !ch.on; renderFamilyView(); };
    t.addEventListener('click', toggle);
    t.addEventListener('keydown', (e) => { if (e.target === t && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); toggle(); } });
    if (it.bible || it.friend) {
      const opts = el('div', 'opts');
      let fname = null;
      if (it.bible) opts.appendChild(optButton('Bible', ch.bible, (v2) => { ch.bible = v2; }));
      if (it.friend) {
        fname = el('input', 'fname');
        fname.type = 'text';
        fname.maxLength = 24;
        fname.placeholder = 'Friend’s first name (BARF Night)';
        fname.setAttribute('aria-label', 'Friend’s first name');
        fname.autocomplete = 'off';
        fname.setAttribute('autocapitalize', 'words');
        fname.value = ch.friendName;
        fname.hidden = !ch.friend;
        fname.addEventListener('click', (e) => e.stopPropagation());
        fname.addEventListener('keydown', (e) => e.stopPropagation());
        fname.addEventListener('input', () => { ch.friendName = fname.value; });
        opts.appendChild(optButton('Brought a friend', ch.friend, (v2) => {
          ch.friend = v2;
          fname.hidden = !v2;
          if (v2) setTimeout(() => { try { fname.focus(); } catch { /* ignore */ } }, 30);
        }));
      }
      t.appendChild(opts);
      if (fname) t.appendChild(fname);
    }
    tiles.appendChild(t);
  });
  v.appendChild(tiles);
  const acts = el('div', 'acts');
  const none = el('button', 'btn no', 'Cancel');
  none.type = 'button';
  none.onclick = () => { SEL = null; $('work').classList.remove('show-right'); renderFamilyView(); };
  const all = el('button', 'btn ghost', SEL.kids.length === 2 ? 'Both of them' : 'All of them');
  all.type = 'button';
  all.hidden = SEL.kids.length < 2;
  all.onclick = () => { SEL.kids.forEach((p) => { SEL.choice[p.recid].on = true; }); renderFamilyView(); };
  const chosen = SEL.kids.filter((p) => SEL.choice[p.recid].on);
  const go = el('button', 'btn go', chosen.length > 1 ? 'Check in ' + chosen.length : 'Check in');
  go.type = 'button';
  go.id = 'checkin-go';
  go.disabled = !chosen.length || !desk.hasHistory || SEL.kids.some((p) => PENDING[p.kid.clubberId]);
  go.onclick = submitSelected;
  acts.appendChild(none); acts.appendChild(all); acts.appendChild(go);
  v.appendChild(acts);
}

async function submitSelected() {
  if (!SEL) return;
  const picks = SEL.kids.filter((p) => SEL.choice[p.recid].on);
  if (!picks.length) return;
  picks.forEach((p) => { PENDING[p.kid.clubberId] = true; });
  renderFamilyView(); render();
  let ok = 0, already = 0, stop = false;
  const done = [];
  for (const p of picks) {
    if (stop) { delete PENDING[p.kid.clubberId]; continue; }
    const ch = SEL.choice[p.recid], it = itemsFor(p.clubName);
    try {
      const r = await desk.checkIn(
        { clubberId: p.kid.clubberId, name: p.name, club: p.clubName },
        { bible: it.bible && ch.bible, friend: it.friend && ch.friend, friendName: ch.friendName },
      );
      p.kid.checkedIn = true;
      if (r.already) already++; else ok++;
      done.push(p);
    } catch (e) {
      stop = e.code === 'busy' || e.code === 'signed-out' || e.code === 'unreachable';
      onError(e, `Couldn’t check in ${p.name}: `);
    } finally {
      delete PENDING[p.kid.clubberId];
    }
  }
  if (ok) toast(ok === 1 && !already ? `${done[0].name} is checked in` : `${ok} checked in`, 3500, 'good');
  else if (already) toast('Already checked in (another desk got there first).', 4500);
  if (SEL) {
    SEL.kids = SEL.kids.filter((p) => !p.kid.checkedIn);
    if (!SEL.kids.length) { SEL = null; $('search').value = ''; $('work').classList.remove('show-right'); }
  }
  renderFamilyView(); render(); renderTonight(); renderCount();
  setTimeout(pollStatus, 800);
  clearTimeout(rosterTimer);
  rosterTimer = setTimeout(pollRoster, 6000);
}

// ── Tonight: who is in, undo / remove / check out ──────────────────────────
function tonightRows() {
  const rows = KIDS.filter((k) => k.checkedIn && !PENDING[k.clubberId]).map((k) => ({
    key: 'id:' + k.clubberId, name: nameOf(k), club: k.club || '', clubberId: k.clubberId, visitor: false, out: LOCAL.out.indexOf('id:' + k.clubberId) !== -1, kid: k,
  }));
  LOCAL.visitors.forEach((v) => rows.push({ key: v.key, name: v.name, club: v.club, clubberId: null, visitor: true, out: LOCAL.out.indexOf(v.key) !== -1 }));
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
function hereNow() { return tonightRows().filter((r) => !r.out); }
function renderCount() {
  const here = hereNow();
  const n = TONIGHT_SERVER && Number.isFinite(TONIGHT_SERVER.checkedIn) ? TONIGHT_SERVER.checkedIn : here.length;
  const pill = $('count-pill');
  pill.textContent = n + ' in';
  pill.setAttribute('aria-label', n + ' here now. Show who.');
  $('source').textContent = TONIGHT_SERVER ? 'Tonight: counted by the service' : 'Tonight: from TwoTimTwo, via the service';
}
function renderTonight() {
  const v = $('tonight-view');
  v.textContent = '';
  const rows = tonightRows();
  const here = rows.filter((r) => !r.out);
  v.appendChild(el('div', 'total', here.length + (here.length === 1 ? ' child here now' : ' children here now')));
  const byClub = {};
  here.forEach((r) => { const c = r.club || 'No club'; byClub[c] = (byClub[c] || 0) + 1; });
  const chips = el('div', 'chips');
  Object.keys(byClub).sort().forEach((c) => {
    const chip = el('span', 'chip');
    const d = el('span', 'dot');
    d.style.setProperty('--c', clubOf(c).color);
    chip.appendChild(d);
    chip.appendChild(document.createTextNode(c + ' ' + byClub[c]));
    chips.appendChild(chip);
  });
  v.appendChild(chips);
  if (!rows.length) { v.appendChild(el('div', 'note', 'Nobody is checked in yet.')); return; }
  rows.forEach((r) => {
    const row = el('div', 'row' + (r.out ? ' out' : ''));
    row.style.setProperty('--club', clubOf(r.club).color);
    row.dataset.name = r.name;
    const who = el('div', 'who');
    const b = el('b', null, r.name);
    if (r.visitor) b.appendChild(el('span', 'vtag', 'Visitor'));
    who.appendChild(b);
    who.appendChild(el('span', null, r.out ? (r.club ? r.club + ' · checked out' : 'checked out') : r.club));
    row.appendChild(who);
    if (!r.out) {
      const acts = el('div', 'rowacts');
      const undo = el('button', null, r.visitor ? 'Remove' : 'Undo check-in');
      undo.type = 'button';
      undo.onclick = () => ask(r, 'undo');
      const out = el('button', 'tt', 'Check out');
      out.type = 'button';
      out.onclick = () => ask(r, 'checkout');
      acts.appendChild(undo); acts.appendChild(out);
      row.appendChild(acts);
    }
    v.appendChild(row);
  });
}

function setView(next) {
  view = next;
  $('family-view').hidden = next !== 'family';
  $('tonight-view').hidden = next !== 'tonight';
  $('tab-family').setAttribute('aria-selected', next === 'family' ? 'true' : 'false');
  $('tab-tonight').setAttribute('aria-selected', next === 'tonight' ? 'true' : 'false');
  if (next === 'tonight') { renderTonight(); $('work').classList.add('show-right'); }
}
$('tab-family').onclick = () => setView('family');
$('tab-tonight').onclick = () => setView('tonight');
$('count-pill').onclick = () => setView('tonight');
$('back-btn').onclick = () => $('work').classList.remove('show-right');

// ── Dialogs ────────────────────────────────────────────────────────────────
let openDialog = null;
function showDialog(id) {
  if (openDialog) $(openDialog).classList.remove('on');
  openDialog = id;
  $('scrim').classList.add('on');
  $(id).classList.add('on');
}
function hideDialog() {
  if (openDialog) $(openDialog).classList.remove('on');
  openDialog = null;
  $('scrim').classList.remove('on');
}
$('scrim').addEventListener('click', hideDialog);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideDialog(); });

let pendingConfirm = null;
function ask(row, mode) {
  pendingConfirm = { row, mode };
  const first = row.name.split(' ')[0];
  if (mode === 'undo') {
    $('confirm-title').textContent = (row.visitor ? 'Remove ' : 'Undo ') + row.name + (row.visitor ? ' from tonight?' : '’s check-in?');
    $('confirm-body').textContent = row.visitor
      ? first + ' is not on TwoTimTwo, so this only takes them off tonight’s count here, and a label that has not printed yet is dropped.'
      : 'TwoTimTwo undoes it, and then ' + first + ' comes off tonight’s count and a label that has not printed yet is dropped. If TwoTimTwo does not confirm it, nothing changes and this page says why.';
    $('confirm-ok').textContent = row.visitor ? 'Remove' : 'Undo check-in';
  } else {
    $('confirm-title').textContent = 'Check out ' + row.name + '?';
    $('confirm-body').textContent = row.visitor
      ? first + ' is not on TwoTimTwo, so this only marks them checked out here.'
      : 'TwoTimTwo checks ' + first + ' out. If it does not answer OK, nothing changes and this page says why.';
    $('confirm-ok').textContent = 'Check out';
  }
  showDialog('confirm-dialog');
}
$('confirm-cancel').onclick = () => { pendingConfirm = null; hideDialog(); };
$('confirm-ok').onclick = async () => {
  const c = pendingConfirm;
  pendingConfirm = null;
  hideDialog();
  if (!c) return;
  const child = { clubberId: c.row.clubberId, name: c.row.name, club: c.row.club, visitor: c.row.visitor };
  try {
    if (c.mode === 'undo') {
      await desk.undo(child);
      if (c.row.visitor) LOCAL.visitors = LOCAL.visitors.filter((v) => v.key !== c.row.key);
      else if (c.row.kid) c.row.kid.checkedIn = false;
      toast(c.row.name + (c.row.visitor ? ' removed.' : '’s check-in is undone.'), 4000, 'good');
    } else {
      await desk.checkout(child);
      LOCAL.out.push(c.row.key);
      toast(c.row.name + ' is checked out.', 4000, 'good');
    }
    saveLocal();
  } catch (e) {
    onError(e, c.mode === 'undo' ? 'Not undone: ' : 'Not checked out: ');
  }
  render(); renderTonight(); renderCount();
  clearTimeout(rosterTimer);
  rosterTimer = setTimeout(pollRoster, 6000);
};

// ── More: a visitor and a one-off name tag ─────────────────────────────────
function clubPicker(holder, onChange) {
  let value = '';
  holder.textContent = '';
  CLUBS.forEach((c) => {
    const k = clubOf(c);
    const b = el('button', null, c);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', 'false');
    b.style.setProperty('--c', k.color);
    b.style.setProperty('--d', k.deep);
    b.addEventListener('click', () => {
      value = c;
      holder.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', x === b ? 'true' : 'false'));
      onChange();
    });
    holder.appendChild(b);
  });
  return { get value() { return value; }, reset() { value = ''; holder.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', 'false')); } };
}
const visitorClub = clubPicker($('visitor-clubs'), syncMore);
const oneoffClub = clubPicker($('oneoff-clubs'), syncMore);
function syncMore() {
  $('visitor-go').disabled = !$('visitor-name').value.trim() || !visitorClub.value || !desk.hasHistory;
  $('oneoff-go').disabled = !$('oneoff-name').value.trim() || !oneoffClub.value;
}
$('visitor-name').addEventListener('input', syncMore);
$('oneoff-name').addEventListener('input', syncMore);
$('more-btn').onclick = () => { $('more-err').textContent = ''; syncMore(); showDialog('more-dialog'); setTimeout(() => $('visitor-name').focus(), 30); };
$('more-close').onclick = hideDialog;
$('visitor-go').onclick = async () => {
  const name = $('visitor-name').value.replace(/\s+/g, ' ').trim();
  const club = visitorClub.value;
  $('visitor-go').disabled = true;
  try {
    await desk.checkIn({ name, club, visitor: true }, {});
    LOCAL.visitors.push({ key: 'v:' + cc.newRowId(), name, club });
    saveLocal();
    $('visitor-name').value = ''; visitorClub.reset();
    hideDialog();
    toast(name + ' is checked in (visitor).', 3500, 'good');
    renderTonight(); renderCount();
    setTimeout(pollStatus, 800);
  } catch (e) {
    $('more-err').textContent = e.message;
  }
  syncMore();
};
$('oneoff-go').onclick = async () => {
  const name = $('oneoff-name').value;
  const club = oneoffClub.value;
  $('oneoff-go').disabled = true;
  try {
    await desk.oneOffTag({ name, club });
    $('oneoff-name').value = ''; oneoffClub.reset();
    hideDialog();
    toast('Name tag sent to the printer.', 3500, 'good');
    setTimeout(pollStatus, 800);
  } catch (e) {
    $('more-err').textContent = e.message;
  }
  syncMore();
};

// ── Sign-in and start ──────────────────────────────────────────────────────
function showSignIn(message) {
  clearTimeout(rosterTimer); clearTimeout(statusTimer);
  desk.signOut();
  $('pin-screen').hidden = false;
  $('work').hidden = true; $('bar').hidden = true;
  $('count-pill').hidden = true; $('more-btn').hidden = true;
  $('pin').value = '';
  $('pin-err').textContent = message || '';
  $('pin-btn').disabled = false;
  $('pin-btn').textContent = 'Unlock';
  setTimeout(() => $('pin').focus(), 30);
}
function showDesk() {
  signedInOnce = true;
  LOCAL = loadLocal();
  $('pin-screen').hidden = true;
  $('work').hidden = false; $('bar').hidden = false;
  $('count-pill').hidden = false; $('more-btn').hidden = false;
  $('nohistory').hidden = desk.hasHistory;
  setView('family');
  renderFamilyView();
  render();
  renderTonight();
  pollRoster();
  pollStatus();
  setTimeout(() => $('search').focus(), 50);
}
$('pin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const word = $('pin').value;
  if (!word.trim()) return;
  $('pin-btn').disabled = true;
  $('pin-btn').textContent = 'Checking…';
  $('pin-err').textContent = '';
  try {
    await desk.signIn(word);
    $('pin').value = '';
    showDesk();
  } catch (err) {
    $('pin-btn').disabled = false;
    $('pin-btn').textContent = 'Unlock';
    $('pin-err').textContent = err.message || 'Could not sign in.';
  }
});
$('signout').onclick = () => showSignIn('');
document.addEventListener('visibilitychange', () => { if (!document.hidden && signedInOnce && !$('work').hidden) { pollRoster(); pollStatus(); } });

if (desk.restore() === 'ready') showDesk();
else {
  try { if (localStorage.getItem('awanaSyncSession.v1')) $('pin-intro').textContent = 'This computer is signed in, but check-in needs the passphrase once to check the history key.'; } catch { /* no storage */ }
  setTimeout(() => $('pin').focus(), 30);
}
