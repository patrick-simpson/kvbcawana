// ── Touch check-in (7.1.0) ───────────────────────────────────────────────────
// A full-screen, touch-first check-in over the TwoTimTwo check-in page,
// opened from the panel's "Touch check-in" button. It checks children in
// through content.js's own path (window.__awanaTouchApi: label first, then
// the direct POST, then TwoTimTwo's modal as the fallback), so nothing about
// HOW a check-in happens is new here; only the screen is.
//
//   Search    first name, last name or both, in any order, as you type. A
//             misspelling still finds the child: close names are listed under
//             "Did you mean", best first. Nothing is ever checked in without
//             a tap, so a typo cannot check in the wrong child.
//   Confirm   one tap opens the child's card: Bible and Brought a friend (only
//             for clubs whose check-in has them), then Check in.
//   Siblings  if TwoTimTwo files other children under the same household and
//             they are not in yet, their tiles slide in: one tap each, or All
//             of them, with Bible / Friend copied from the first child (each
//             can be unchecked). Done, or typing a name, closes it. A switch
//             in the panel's Settings turns this page off.
//
// PRIVACY: the household list comes from TwoTimTwo's own /household/csv, which
// carries addresses and phone numbers. Only the household id and the children's
// names are kept, in memory, on this page; nothing is stored, logged or sent.
//
// It draws inside a shadow root, so TwoTimTwo's styles never reach it and its
// styles never reach TwoTimTwo. Motion is transform and opacity only, and
// stops entirely under the OS's reduced motion.

(function () {
  'use strict';

  // ── Search (pure; the tests load this half in Node) ──────────────────────
  function norm(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/['’-]/g, '')
      .replace(/[^a-z ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // A light sound-alike key, so "Jaxon" meets "Jackson" and "Kaitlyn" meets
  // "Caitlin": the spellings parents pick between, not a general phonetics.
  function sound(s) {
    return s
      .replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/x/g, 'ks').replace(/q/g, 'k')
      .replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/gh/g, 'g')
      .replace(/y/g, 'i').replace(/z/g, 's').replace(/ie$/, 'i').replace(/ee/g, 'i')
      .replace(/(.)\1+/g, '$1').replace(/h$/, '');
  }

  // Optimal string alignment distance (Damerau-Levenshtein without repeated
  // edits of one substring): a swapped pair of letters costs one.
  function editDistance(a, b) {
    if (a === b) return 0;
    var m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    var prev2 = null, prev = new Array(n + 1), cur = new Array(n + 1);
    for (var j = 0; j <= n; j++) prev[j] = j;
    for (var i = 1; i <= m; i++) {
      cur[0] = i;
      for (var k = 1; k <= n; k++) {
        var cost = a[i - 1] === b[k - 1] ? 0 : 1;
        var v = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + cost);
        if (prev2 && i > 1 && k > 1 && a[i - 1] === b[k - 2] && a[i - 2] === b[k - 1]) v = Math.min(v, prev2[k - 2] + 1);
        cur[k] = v;
      }
      var t = prev2 || new Array(n + 1);
      prev2 = prev; prev = cur; cur = t;
    }
    return prev[n];
  }

  // How far a typed word may be from a name and still be offered: none for
  // one or two letters (those are only ever a prefix), one for up to four,
  // two after that.
  function allowedEdits(len) { return len <= 2 ? 0 : len <= 4 ? 1 : 2; }

  // How well one typed word matches one name word: { d, prefix }.
  function wordMatch(q, t) {
    if (t.indexOf(q) === 0) return { d: 0, prefix: true };
    var d = Math.min(editDistance(q, t), editDistance(q, t.slice(0, q.length)));
    var sq = sound(q), st = sound(t);
    d = Math.min(d, editDistance(sq, st), editDistance(sq, st.slice(0, sq.length)));
    return { d: d, prefix: false };
  }

  /**
   * @param {{name: string}[]} people
   * @param {string} query
   * @returns {{matches: object[], close: object[]}} matches: every typed word
   *   starts a word of the name; close: within a few letters ("Did you mean").
   */
  function searchPeople(people, query, limits) {
    var lim = limits || { matches: 40, close: 8 };
    var q = norm(query).split(' ').filter(Boolean);
    if (!q.length) return { matches: [], close: [] };
    var matches = [], close = [];
    for (var i = 0; i < people.length; i++) {
      var p = people[i];
      var words = p._words || (p._words = norm(p.name).split(' ').filter(Boolean));
      if (!words.length) continue;
      var all = true, ok = true, total = 0, firstHit = false;
      for (var a = 0; a < q.length && ok; a++) {
        var best = null;
        for (var b = 0; b < words.length; b++) {
          var m = wordMatch(q[a], words[b]);
          if (!best || m.d < best.d || (m.d === best.d && m.prefix && !best.prefix)) { best = m; if (a === 0) firstHit = b === 0; }
        }
        if (best.d > allowedEdits(q[a].length)) ok = false;
        else { total += best.d; if (!best.prefix) all = false; }
      }
      if (!ok) continue;
      if (all) matches.push({ p: p, firstHit: firstHit });
      else close.push({ p: p, d: total });
    }
    matches.sort(function (x, y) {
      if (x.firstHit !== y.firstHit) return x.firstHit ? -1 : 1;
      if (!!x.p.checkedIn !== !!y.p.checkedIn) return x.p.checkedIn ? 1 : -1;
      return x.p.name.localeCompare(y.p.name);
    });
    close.sort(function (x, y) { return x.d - y.d || x.p.name.localeCompare(y.p.name); });
    return {
      matches: matches.slice(0, lim.matches).map(function (m) { return m.p; }),
      close: close.slice(0, lim.close).map(function (m) { return m.p; }),
    };
  }

  // TwoTimTwo's /household/csv → { nameKey: householdId } and
  // { householdId: [nameKey...] }. Only those two things survive the parse.
  function parseCsv(text) {
    var rows = [], row = [], field = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = ''; rows.push(row); row = [];
      } else field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function householdIndex(csvText) {
    var rows = parseCsv(String(csvText || ''));
    var byName = {}, members = {};
    if (!rows.length) return { byName: byName, members: members };
    var head = rows[0].map(function (h) { return norm(h); });
    var idCol = head.indexOf('household id');
    var kidsCol = head.indexOf('active clubbers');
    if (idCol < 0 || kidsCol < 0) return { byName: byName, members: members };
    for (var r = 1; r < rows.length; r++) {
      var id = (rows[r][idCol] || '').trim();
      var kids = (rows[r][kidsCol] || '').split(',').map(norm).filter(Boolean);
      if (!id || kids.length < 2) continue;
      members[id] = kids;
      kids.forEach(function (k) { byName[k] = id; });
    }
    return { byName: byName, members: members };
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = { norm: norm, sound: sound, editDistance: editDistance, searchPeople: searchPeople, householdIndex: householdIndex, parseCsv: parseCsv };
    return;
  }

  // ── The screen ────────────────────────────────────────────────────────────
  var API = window.__awanaTouchApi;
  if (!API || window.__awanaTouchLoaded) return;
  window.__awanaTouchLoaded = true;

  var CLUBS = {
    '4': { name: 'Puggles', color: '#1DB6D9', deep: '#1A627C' },
    '1': { name: 'Cubbies', color: '#4C72B8', deep: '#2F4F8A' },
    '2': { name: 'Sparks', color: '#F04A4B', deep: '#B82B32' },
    '3': { name: 'T&T', color: '#58BD79', deep: '#2F8A4E' },
    '6': { name: 'Trek', color: '#047E71', deep: '#02554C' },
    '7': { name: 'Journey', color: '#8A649D', deep: '#56467F' },
  };
  function clubFor(id, name) {
    if (CLUBS[id]) return CLUBS[id];
    var n = norm(name);
    for (var k in CLUBS) if (norm(CLUBS[k].name) === n) return CLUBS[k];
    return { name: name || '', color: '#64748B', deep: '#334155' };
  }

  // The children still to check in are the page's own rows (TwoTimTwo removes
  // a row once the child is in); tonight's list from the print server adds
  // the ones already in, greyed.
  function pageChildren() {
    var out = [];
    var els = document.querySelectorAll('.clubber');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var nameEl = el.querySelector('.name');
      var name = nameEl ? nameEl.textContent.trim().replace(/\s+/g, ' ') : '';
      var recid = el.getAttribute('recid');
      if (!name || !recid || recentlyIn[recid]) continue;
      var img = el.querySelector('.club img');
      var clubName = img ? (img.getAttribute('alt') || '').trim() : '';
      out.push({ name: name, recid: recid, clubId: el.getAttribute('club_id') || '', clubName: clubName });
    }
    return out;
  }

  // Which of TwoTimTwo's check-in items (Bible, Brought a friend) this club's
  // check-in has, read off the page's own check-in form.
  function itemsFor(clubId) {
    var out = { bible: false, friend: false };
    var form = document.getElementById('checkinForm');
    if (!form) return out;
    var inputs = form.querySelectorAll('input.event[name="events[]"]');
    for (var i = 0; i < inputs.length; i++) {
      var input = inputs[i];
      if (input.getAttribute('automatic') === '1') continue;
      var clubs = (input.getAttribute('clubs') || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      if (clubs.length && clubs.indexOf(String(clubId)) < 0) continue;
      var lbl = input.closest('label') || (input.id ? document.querySelector('label[for="' + input.id + '"]') : null);
      var text = lbl ? lbl.textContent : (input.nextSibling ? input.nextSibling.textContent : '') || '';
      if (/bible/i.test(text)) out.bible = true;
      if (/friend|brought/i.test(text)) out.friend = true;
    }
    return out;
  }

  var recentlyIn = {};      // recid -> { name, clubName, clubId, at }: in, as far as this screen knows
  var tonight = [];         // [{ name, at, clubName }] from the print server
  var households = null;    // householdIndex(), or null until loaded
  var householdsAt = 0;
  var siblingsOn = function () { try { return localStorage.getItem('awana_touchSiblings') !== 'off'; } catch (e) { return true; } };

  function loadHouseholds() {
    if (households && Date.now() - householdsAt < 30 * 60 * 1000) return;
    householdsAt = Date.now();
    fetch('/household/csv', { credentials: 'same-origin', signal: AbortSignal.timeout(15000) })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (t) { if (t) households = householdIndex(t); })
      .catch(function () { /* no sibling page tonight, nothing else changes */ });
  }

  function refreshTonight() {
    return API.tonight().then(function (list) { tonight = list || []; render(); });
  }

  // ── DOM ───────────────────────────────────────────────────────────────────
  var host, root, els = {};
  var state = { open: false, child: null, items: null, choice: { bible: false, friend: false }, siblings: [], sibChoice: null };

  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box}',
    '.wrap{position:fixed;inset:0;z-index:1;display:flex;flex-direction:column;',
    '  background:#EAF4FB;color:#231F20;font-family:"Figtree",system-ui,sans-serif;',
    '  opacity:0;transform:scale(.985);transition:opacity .18s ease,transform .22s cubic-bezier(.2,.8,.2,1)}',
    '.wrap.on{opacity:1;transform:none}',
    '.top{display:flex;align-items:center;gap:16px;padding:18px 24px 10px}',
    '.title{font-family:"Paytone One","Figtree",sans-serif;font-size:30px;line-height:1;color:#2F4F8A}',
    '.count{font-family:"Londrina Solid","Arial Narrow",sans-serif;font-size:20px;letter-spacing:.04em;text-transform:uppercase;color:#4C72B8}',
    '.sp{flex:1}',
    '.close{all:unset;cursor:pointer;width:52px;height:52px;border-radius:50%;background:#fff;color:#231F20;',
    '  display:grid;place-items:center;font-size:26px;box-shadow:0 2px 8px rgba(15,23,42,.12)}',
    '.close:active{transform:scale(.94)}',
    '.search{margin:6px 24px 14px;position:relative}',
    '.search input{width:100%;height:76px;border-radius:20px;border:3px solid #fff;background:#fff;',
    '  padding:0 24px 0 64px;font:600 30px "Figtree",system-ui,sans-serif;color:#231F20;outline:none;',
    '  box-shadow:0 4px 16px rgba(47,79,138,.12);transition:border-color .15s ease}',
    '.search input:focus{border-color:#4C72B8}',
    '.search .mag{position:absolute;left:22px;top:50%;transform:translateY(-50%);font-size:26px;opacity:.55;pointer-events:none}',
    '.search .clear{all:unset;position:absolute;right:16px;top:50%;transform:translateY(-50%);cursor:pointer;',
    '  width:48px;height:48px;border-radius:50%;display:none;place-items:center;font-size:22px;color:#64748b}',
    '.search.has .clear{display:grid}',
    '.list{flex:1;overflow-y:auto;padding:0 24px 24px;overscroll-behavior:contain}',
    '.hint{padding:40px 8px;text-align:center;color:#64748b;font-size:22px}',
    '.sec{font-family:"Londrina Solid","Arial Narrow",sans-serif;font-size:20px;letter-spacing:.06em;text-transform:uppercase;color:#4C72B8;margin:14px 4px 8px}',
    '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}',
    '.card{all:unset;cursor:pointer;display:flex;align-items:center;gap:14px;min-height:84px;padding:14px 18px 14px 22px;',
    '  background:#fff;border-radius:18px;position:relative;overflow:hidden;box-shadow:0 2px 10px rgba(15,23,42,.08);',
    '  animation:rise .22s cubic-bezier(.2,.8,.2,1) both;transition:transform .12s ease}',
    '.card:active{transform:scale(.97)}',
    '.card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:10px;background:var(--club)}',
    '.card .nm{font-family:"Paytone One","Figtree",sans-serif;font-size:26px;line-height:1.1;flex:1;min-width:0;overflow-wrap:anywhere}',
    '.card .cl{font-family:"Londrina Solid","Arial Narrow",sans-serif;font-size:18px;letter-spacing:.05em;text-transform:uppercase;color:var(--deep)}',
    '.card.in{cursor:default;background:#F1F5F9;box-shadow:none}',
    '.card.in .nm{color:#94a3b8}',
    '.card.in .cl{color:#94a3b8}',
    '.card.in:active{transform:none}',
    '.tag{font-family:"Londrina Solid","Arial Narrow",sans-serif;font-size:17px;letter-spacing:.05em;text-transform:uppercase;',
    '  padding:4px 10px;border-radius:999px;background:#E2E8F0;color:#475569;white-space:nowrap}',
    '@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}',
    '.scrim{position:fixed;inset:0;background:rgba(15,23,42,.36);opacity:0;pointer-events:none;transition:opacity .2s ease;z-index:2}',
    '.scrim.on{opacity:1;pointer-events:auto}',
    '.sheet{position:fixed;left:50%;bottom:0;width:min(640px,100%);transform:translate(-50%,105%);z-index:3;',
    '  background:#fff;border-radius:28px 28px 0 0;padding:28px 28px 32px;box-shadow:0 -8px 32px rgba(15,23,42,.18);',
    '  transition:transform .26s cubic-bezier(.2,.8,.2,1)}',
    '.sheet.on{transform:translate(-50%,0)}',
    '.sheet .bar{height:10px;border-radius:999px;background:var(--club);margin:-8px 0 20px}',
    '.sheet .nm{font-family:"Paytone One","Figtree",sans-serif;font-size:44px;line-height:1.05;overflow-wrap:anywhere}',
    '.sheet .cl{font-family:"Londrina Solid","Arial Narrow",sans-serif;font-size:22px;letter-spacing:.05em;text-transform:uppercase;color:var(--deep);margin-top:6px}',
    '.opts{display:flex;gap:12px;margin:22px 0 4px;flex-wrap:wrap}',
    '.opt{all:unset;cursor:pointer;display:flex;align-items:center;gap:12px;min-height:64px;padding:0 22px;border-radius:16px;',
    '  border:3px solid #E2E8F0;font:700 22px "Figtree",system-ui,sans-serif;color:#334155;transition:border-color .12s ease,background .12s ease}',
    '.opt .box{width:30px;height:30px;border-radius:9px;border:3px solid #94a3b8;display:grid;place-items:center;color:#fff;font-size:20px;transition:all .12s ease}',
    '.opt.on{border-color:var(--club);background:color-mix(in srgb,var(--club) 10%,#fff)}',
    '.opt.on .box{background:var(--club);border-color:var(--club)}',
    '.acts{display:flex;gap:14px;margin-top:24px}',
    '.btn{all:unset;cursor:pointer;flex:1;display:grid;place-items:center;min-height:76px;border-radius:20px;',
    '  font:400 28px "Paytone One","Figtree",sans-serif;transition:transform .1s ease,filter .1s ease}',
    '.btn:active{transform:scale(.97)}',
    '.btn.go{background:var(--club,#4C72B8);color:#fff;flex:2}',
    '.btn.no{background:#F1F5F9;color:#334155}',
    '.btn[disabled]{filter:grayscale(.6) opacity(.6);cursor:default}',
    '.sib{position:fixed;inset:0;z-index:4;background:#EAF4FB;display:flex;flex-direction:column;',
    '  transform:translateX(100%);transition:transform .28s cubic-bezier(.2,.8,.2,1)}',
    '.sib.on{transform:none}',
    '.sib .head{padding:24px 24px 6px}',
    '.sib .done-l{font-family:"Londrina Solid","Arial Narrow",sans-serif;font-size:22px;letter-spacing:.05em;text-transform:uppercase;color:#2F8A4E}',
    '.sib h2{margin:4px 0 0;font:400 34px "Paytone One","Figtree",sans-serif;color:#2F4F8A}',
    '.sib .tiles{flex:1;overflow-y:auto;padding:16px 24px;display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;align-content:start}',
    '.tile{background:#fff;border-radius:20px;padding:18px 18px 16px 24px;position:relative;overflow:hidden;box-shadow:0 2px 10px rgba(15,23,42,.08);',
    '  animation:rise .24s cubic-bezier(.2,.8,.2,1) both}',
    '.tile::before{content:"";position:absolute;left:0;top:0;bottom:0;width:10px;background:var(--club)}',
    '.tile .nm{font-family:"Paytone One","Figtree",sans-serif;font-size:28px;line-height:1.1}',
    '.tile .cl{font-family:"Londrina Solid","Arial Narrow",sans-serif;font-size:18px;letter-spacing:.05em;text-transform:uppercase;color:var(--deep)}',
    '.tile .opts{margin:12px 0 0}',
    '.tile .opt{min-height:52px;font-size:19px;padding:0 16px}',
    '.tile .opt .box{width:26px;height:26px;font-size:17px}',
    '.tile .go1{all:unset;box-sizing:border-box;width:100%;cursor:pointer;display:grid;place-items:center;margin-top:12px;min-height:64px;border-radius:16px;',
    '  background:var(--club);color:#fff;font:400 24px "Paytone One","Figtree",sans-serif;transition:transform .1s ease}',
    '.tile .go1:active{transform:scale(.97)}',
    '.tile.done .go1{background:#E8F5E9;color:#2F8A4E;cursor:default}',
    '.tile.busy .go1{opacity:.7;cursor:default}',
    '.sib .foot{display:flex;gap:14px;padding:14px 24px 24px}',
    '.toast{position:fixed;left:50%;top:20px;transform:translate(-50%,-160%);z-index:5;display:flex;align-items:center;gap:14px;',
    '  padding:16px 24px;border-radius:999px;background:#2F8A4E;color:#fff;font:700 22px "Figtree",system-ui,sans-serif;',
    '  box-shadow:0 8px 24px rgba(15,23,42,.2);transition:transform .24s cubic-bezier(.2,.8,.2,1)}',
    '.toast.on{transform:translate(-50%,0)}',
    '.toast.bad{background:#B82B32}',
    '.tick{width:34px;height:34px;border-radius:50%;background:#fff;color:#2F8A4E;display:grid;place-items:center;font-size:22px;',
    '  animation:pop .3s cubic-bezier(.3,1.6,.5,1) both}',
    '.toast.bad .tick{color:#B82B32}',
    '@keyframes pop{from{transform:scale(.3)}to{transform:none}}',
    '@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}',
  ].join('\n');

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function build() {
    host = document.createElement('div');
    host.id = 'awana-touch-checkin';
    // The host is the one layer over TwoTimTwo; inside it the screen, the
    // scrim, the confirm card, the sibling page and the toast stack 1 to 5.
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:block';
    root = host.attachShadow({ mode: 'open' });
    var style = el('style');
    style.textContent = CSS;
    var wrap = els.wrap = el('div', 'wrap');
    var top = el('div', 'top');
    els.count = el('div', 'count');
    var close = el('button', 'close', '✕');
    close.setAttribute('aria-label', 'Close touch check-in');
    close.addEventListener('click', closeScreen);
    top.append(el('div', 'title', 'Check in'), els.count, el('div', 'sp'), close);

    var search = els.search = el('div', 'search');
    var input = els.input = el('input');
    input.type = 'text';
    input.placeholder = 'Type a first or last name';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('autocapitalize', 'words');
    input.setAttribute('aria-label', 'Search children by name');
    input.addEventListener('input', render);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var r = searchPeople(people(), input.value);
        var ready = r.matches.filter(function (p) { return !p.checkedIn; });
        if (ready.length === 1) openConfirm(ready[0]);
      }
    });
    var clear = el('button', 'clear', '✕');
    clear.setAttribute('aria-label', 'Clear');
    clear.addEventListener('click', function () { input.value = ''; render(); input.focus(); });
    search.append(el('span', 'mag', '🔍'), input, clear);

    els.list = el('div', 'list');
    els.list.setAttribute('aria-live', 'polite');

    els.scrim = el('div', 'scrim');
    els.scrim.addEventListener('click', closeConfirm);
    els.sheet = el('div', 'sheet');
    els.sheet.setAttribute('role', 'dialog');
    els.sib = el('div', 'sib');
    els.sib.setAttribute('role', 'dialog');
    els.toast = el('div', 'toast');

    wrap.append(top, search, els.list);
    root.append(style, wrap, els.scrim, els.sheet, els.sib, els.toast);
    document.addEventListener('keydown', onKey, true);
  }

  function people() {
    var list = pageChildren();
    var seen = {};
    list.forEach(function (p) { seen[norm(p.name)] = true; });
    Object.keys(recentlyIn).forEach(function (id) {
      var r = recentlyIn[id];
      if (!seen[norm(r.name)]) { seen[norm(r.name)] = true; list.push({ name: r.name, clubName: r.clubName, clubId: r.clubId, checkedIn: true, at: r.at }); }
    });
    tonight.forEach(function (t) {
      if (!t.name || seen[norm(t.name)]) return;
      seen[norm(t.name)] = true;
      list.push({ name: t.name, clubName: t.clubName || '', clubId: '', checkedIn: true, at: t.at });
    });
    return list;
  }

  function timeOf(at) {
    if (!at) return '';
    var d = new Date(at);
    return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function card(p, i) {
    var club = clubFor(p.clubId, p.clubName);
    var b = el('button', 'card' + (p.checkedIn ? ' in' : ''));
    b.style.setProperty('--club', p.checkedIn ? '#CBD5E1' : club.color);
    b.style.setProperty('--deep', club.deep);
    b.style.animationDelay = Math.min(i, 10) * 18 + 'ms';
    var txt = el('div');
    txt.style.cssText = 'flex:1;min-width:0';
    txt.append(el('div', 'nm', p.name), el('div', 'cl', club.name));
    b.append(txt);
    if (p.checkedIn) {
      b.append(el('span', 'tag', 'Checked in' + (p.at ? ' ' + timeOf(p.at) : '')));
      b.setAttribute('aria-disabled', 'true');
    } else {
      b.addEventListener('click', function () { openConfirm(p); });
    }
    return b;
  }

  function render() {
    if (!els.list) return;
    var all = people();
    var inCount = all.filter(function (p) { return p.checkedIn; }).length;
    els.count.textContent = inCount ? inCount + ' checked in tonight' : '';
    var q = els.input.value;
    els.search.classList.toggle('has', !!q);
    var list = els.list;
    while (list.firstChild) list.removeChild(list.firstChild);
    if (!q.trim()) {
      list.append(el('div', 'hint', all.length ? 'Start typing a child’s first or last name.' : 'No children on this page yet. Is the TwoTimTwo check-in page loaded?'));
      return;
    }
    var r = searchPeople(all, q);
    var n = 0;
    if (r.matches.length) {
      var g = el('div', 'grid');
      r.matches.forEach(function (p) { g.append(card(p, n++)); });
      list.append(g);
    }
    if (r.close.length && norm(q).length >= 3) {
      list.append(el('div', 'sec', r.matches.length ? 'Or did you mean' : 'Did you mean'));
      var g2 = el('div', 'grid');
      r.close.forEach(function (p) { g2.append(card(p, n++)); });
      list.append(g2);
    }
    if (!r.matches.length && !r.close.length) {
      list.append(el('div', 'hint', 'No child matches “' + q.trim() + '”. A new child? Use Walk-ins in the panel.'));
    }
  }

  // ── Confirm ───────────────────────────────────────────────────────────────
  function optButton(label, on, onChange) {
    var b = el('button', 'opt' + (on ? ' on' : ''));
    var box = el('span', 'box', on ? '✓' : '');
    b.append(box, document.createTextNode(label));
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.addEventListener('click', function () {
      var now = !b.classList.contains('on');
      b.classList.toggle('on', now);
      box.textContent = now ? '✓' : '';
      b.setAttribute('aria-pressed', now ? 'true' : 'false');
      onChange(now);
    });
    return b;
  }

  function openConfirm(p) {
    var club = clubFor(p.clubId, p.clubName);
    state.child = p;
    state.items = itemsFor(p.clubId);
    state.choice = { bible: false, friend: false };
    var s = els.sheet;
    while (s.firstChild) s.removeChild(s.firstChild);
    s.style.setProperty('--club', club.color);
    s.style.setProperty('--deep', club.deep);
    s.append(el('div', 'bar'), el('div', 'nm', p.name), el('div', 'cl', club.name));
    if (state.items.bible || state.items.friend) {
      var opts = el('div', 'opts');
      if (state.items.bible) opts.append(optButton('Bible', false, function (v) { state.choice.bible = v; }));
      if (state.items.friend) opts.append(optButton('Brought a friend', false, function (v) { state.choice.friend = v; }));
      s.append(opts);
    }
    var acts = el('div', 'acts');
    var no = el('button', 'btn no', 'Cancel');
    no.addEventListener('click', closeConfirm);
    var go = el('button', 'btn go', 'Check in');
    go.addEventListener('click', function () {
      if (go.disabled) return;
      go.disabled = true;
      go.textContent = 'Checking in…';
      checkInOne(p, state.choice).then(function (ok) {
        closeConfirm();
        if (!ok) return;
        afterCheckIn(p, state.choice);
      });
    });
    acts.append(no, go);
    s.append(acts);
    els.scrim.classList.add('on');
    s.classList.add('on');
    setTimeout(function () { try { go.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 30);
  }

  function closeConfirm() {
    els.scrim.classList.remove('on');
    els.sheet.classList.remove('on');
    state.child = null;
  }

  // One check-in through the panel's own path. Resolves true when it went (or
  // is going) through; false, with a red toast, when it could not start.
  function checkInOne(p, choice) {
    var options = {};
    var items = itemsFor(p.clubId);
    if (items.bible) options.Bible = !!choice.bible;
    if (items.friend) options.Friend = !!choice.friend;
    return API.checkIn(p.recid, options).then(function (how) {
      if (how === 'gone') {
        toast(p.name + ' is already checked in', false);
        return false;
      }
      recentlyIn[p.recid] = { name: p.name, clubName: p.clubName, clubId: p.clubId, at: new Date().toISOString() };
      setTimeout(refreshTonight, 2500);
      return true;
    }).catch(function () {
      toast('Couldn’t check in ' + p.name + '. Try it on the TwoTimTwo page.', true);
      return false;
    });
  }

  // ── Siblings ──────────────────────────────────────────────────────────────
  function siblingsOf(p) {
    if (!households || !siblingsOn()) return [];
    var key = norm(p.name);
    var id = households.byName[key];
    if (!id) return [];
    var wanted = {};
    households.members[id].forEach(function (k) { if (k !== key) wanted[k] = true; });
    return pageChildren().filter(function (c) { return wanted[norm(c.name)] && c.recid !== p.recid; });
  }

  function afterCheckIn(p, choice) {
    var sibs = siblingsOf(p);
    if (!sibs.length) {
      toast(p.name + ' is checked in', false);
      resetSearch();
      return;
    }
    openSiblings(p, sibs, choice);
  }

  function openSiblings(first, sibs, choice) {
    var s = els.sib;
    while (s.firstChild) s.removeChild(s.firstChild);
    var head = el('div', 'head');
    var last = first.name.split(' ').slice(1).join(' ');
    head.append(el('div', 'done-l', '✓ ' + first.name + ' is checked in'),
      el('h2', null, 'Also here tonight' + (last ? ' from the ' + last + ' family' : '') + '?'));
    var tiles = el('div', 'tiles');
    var pending = [];
    sibs.forEach(function (c, i) {
      var club = clubFor(c.clubId, c.clubName);
      var items = itemsFor(c.clubId);
      var mine = { bible: items.bible && !!choice.bible, friend: items.friend && !!choice.friend };
      var t = el('div', 'tile');
      t.style.setProperty('--club', club.color);
      t.style.setProperty('--deep', club.deep);
      t.style.animationDelay = 60 + i * 40 + 'ms';
      t.append(el('div', 'nm', c.name), el('div', 'cl', club.name));
      if (items.bible || items.friend) {
        var o = el('div', 'opts');
        if (items.bible) o.append(optButton('Bible', mine.bible, function (v) { mine.bible = v; }));
        if (items.friend) o.append(optButton('Brought a friend', mine.friend, function (v) { mine.friend = v; }));
        t.append(o);
      }
      var go = el('button', 'go1', 'Check in');
      var entry = { c: c, mine: mine, t: t, go: go, state: 'ready' };
      go.addEventListener('click', function () { checkInTile(entry); });
      t.append(go);
      tiles.append(t);
      pending.push(entry);
    });
    var foot = el('div', 'foot');
    var done = el('button', 'btn no', 'Done');
    done.addEventListener('click', closeSiblings);
    var allBtn = el('button', 'btn go', sibs.length === 2 ? 'Both of them' : 'All of them');
    allBtn.style.setProperty('--club', '#4C72B8');
    allBtn.addEventListener('click', function () {
      if (allBtn.disabled) return;
      allBtn.disabled = true;
      // One at a time, in order: the panel's path drives one TwoTimTwo page.
      pending.reduce(function (chain, entry) {
        return chain.then(function () { return checkInTile(entry); });
      }, Promise.resolve()).then(function () { setTimeout(closeSiblings, 600); });
    });
    foot.append(done, allBtn);
    s.append(head, tiles, foot);
    state.siblings = pending;
    s.classList.add('on');   // its own heading says the first child is in; no toast
  }

  function checkInTile(entry) {
    if (entry.state !== 'ready') return Promise.resolve();
    entry.state = 'busy';
    entry.t.classList.add('busy');
    entry.go.textContent = 'Checking in…';
    return checkInOne(entry.c, entry.mine).then(function (ok) {
      entry.t.classList.remove('busy');
      if (ok) {
        entry.state = 'done';
        entry.t.classList.add('done');
        entry.go.textContent = '✓ Checked in';
      } else {
        entry.state = 'ready';
        entry.go.textContent = 'Check in';
      }
      if (state.siblings.length && state.siblings.every(function (x) { return x.state === 'done'; })) setTimeout(closeSiblings, 700);
    });
  }

  function closeSiblings() {
    els.sib.classList.remove('on');
    state.siblings = [];
    resetSearch();
  }

  function siblingsOpen() { return els.sib && els.sib.classList.contains('on'); }

  function resetSearch() {
    els.input.value = '';
    render();
    setTimeout(function () { try { els.input.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 30);
  }

  var toastTimer = null;
  function toast(text, bad) {
    var t = els.toast;
    while (t.firstChild) t.removeChild(t.firstChild);
    t.classList.toggle('bad', !!bad);
    t.append(el('span', 'tick', bad ? '!' : '✓'), document.createTextNode(text));
    t.classList.remove('on');
    void t.offsetWidth;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, bad ? 6000 : 2600);
  }

  function onKey(e) {
    if (!state.open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (els.sheet.classList.contains('on')) closeConfirm();
      else if (siblingsOpen()) closeSiblings();
      else closeScreen();
      return;
    }
    // Typing a name while the sibling page is up: that is the next family.
    if (siblingsOpen() && e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      els.sib.classList.remove('on');
      state.siblings = [];
      els.input.value = '';
      try { els.input.focus({ preventScroll: true }); } catch (err) { els.input.focus(); }
    }
  }

  // ── Open / close ──────────────────────────────────────────────────────────
  function openScreen() {
    if (!host) build();
    if (!host.isConnected) document.body.appendChild(host);
    state.open = true;
    window.__awanaTouchOpen = true;
    loadHouseholds();
    refreshTonight();
    render();
    requestAnimationFrame(function () { els.wrap.classList.add('on'); });
    setTimeout(function () { try { els.input.focus({ preventScroll: true }); } catch (e) { els.input.focus(); } }, 60);
  }

  function closeScreen() {
    state.open = false;
    window.__awanaTouchOpen = false;
    closeConfirm();
    els.sib.classList.remove('on');
    els.wrap.classList.remove('on');
    setTimeout(function () { if (!state.open && host) host.remove(); }, 230);
  }

  window.__awanaTouchOpenScreen = openScreen;
})();
