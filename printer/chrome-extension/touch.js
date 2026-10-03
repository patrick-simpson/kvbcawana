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

  // touch-core:begin (this block is copied verbatim into print-server/public/phone.html by scripts/sync-touch-core.cjs; test-touch-search.cjs pins the two equal)
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

  // The children still to come, as families: grouped by TwoTimTwo household
  // (never guessed; a child the household list doesn't place, or every child
  // before it has loaded, is a family of one), named by the children's last
  // name, in alphabetical order.
  function groupFamilies(children, households) {
    var groups = {}, order = [];
    children.forEach(function (c) {
      var hh = households && households.byName[norm(c.name)];
      var key = hh ? 'hh:' + hh : 'kid:' + (c.recid || c.name);
      if (!groups[key]) { groups[key] = { key: key, kids: [] }; order.push(key); }
      groups[key].kids.push(c);
    });
    return order.map(function (k) {
      var g = groups[k];
      var counts = {}, lasts = [];
      g.kids.forEach(function (c) {
        var last = c.name.split(' ').slice(1).join(' ') || c.name;
        if (!counts[last]) { counts[last] = 0; lasts.push(last); }
        counts[last]++;
      });
      lasts.sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); });
      g.name = lasts.slice(0, 2).join(' & ');
      g.kids.sort(function (a, b) { return a.name.localeCompare(b.name); });
      return g;
    }).sort(function (a, b) { return a.name.localeCompare(b.name) || a.kids[0].name.localeCompare(b.kids[0].name); });
  }

  // The biggest equal tiles that fit `n` into a W x H box without scrolling:
  // try every column count and keep the one whose tiles stand tallest, a tile
  // never narrower than `minAspect` times its height (names need the width).
  // Below `minH` tall they no longer fit, so the grid scrolls at minH instead.
  // As children arrive n falls, and a tile only ever grows.
  function fitTiles(n, W, H, gap, minAspect, minH) {
    if (n <= 0 || W <= 0 || H <= 0) return { cols: 1, w: W, h: minH, scroll: false };
    var best = null;
    for (var cols = 1; cols <= n; cols++) {
      var rows = Math.ceil(n / cols);
      var w = (W - gap * (cols - 1)) / cols;
      var h = Math.min((H - gap * (rows - 1)) / rows, w / minAspect);
      if (w > 0 && h > 0 && (!best || h > best.h)) best = { cols: cols, w: w, h: h };
    }
    if (!best || best.h < minH) {
      var cols2 = Math.max(1, Math.floor((W + gap) / (minH * minAspect + gap)));
      return { cols: cols2, w: (W - gap * (cols2 - 1)) / cols2, h: minH, scroll: true };
    }
    return { cols: best.cols, w: best.w, h: best.h, scroll: false };
  }

  // touch-core:end

  if (typeof module === 'object' && module.exports) {
    module.exports = { norm: norm, sound: sound, editDistance: editDistance, searchPeople: searchPeople, householdIndex: householdIndex, parseCsv: parseCsv,
      groupFamilies: groupFamilies, fitTiles: fitTiles };
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
    // .checked-in rows stay in TwoTimTwo's page, hidden: those children are in.
    var els = document.querySelectorAll('.clubber:not(.checked-in)');
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
      .then(function (t) { if (t) { households = householdIndex(t); shareContext(); } })
      .catch(function () { /* no sibling page tonight, nothing else changes */ });
  }

  // The phone page shows the same families and ticks the same boxes (7.7.0):
  // this laptop is the one that can read TwoTimTwo, so it hands the print
  // server the household groupings (children's names only) and the clubs
  // whose check-in has Bible / Brought a friend.
  function itemClubs() {
    var names = {};
    document.querySelectorAll('.clubber[club_id]').forEach(function (r) {
      var img = r.querySelector('.club img');
      var n = img ? (img.getAttribute('alt') || '').trim() : '';
      if (n) names[r.getAttribute('club_id')] = n;
    });
    var out = { bible: [], friend: [] };
    var form = document.getElementById('checkinForm');
    if (!form) return out;
    form.querySelectorAll('input.event[name="events[]"]').forEach(function (input) {
      if (input.getAttribute('automatic') === '1') return;
      var lbl = input.nextElementSibling ? input.nextElementSibling.textContent : '';
      var kind = /bible/i.test(lbl) ? 'bible' : /friend|brought/i.test(lbl) ? 'friend' : '';
      if (!kind) return;
      (input.getAttribute('clubs') || '').split(',').forEach(function (id) {
        id = id.trim();
        var n = names[id] || (CLUBS[id] && CLUBS[id].name);
        if (n && out[kind].indexOf(n) < 0) out[kind].push(n);
      });
    });
    return out;
  }
  function shareContext() {
    if (!households || typeof API.shareContext !== 'function') return;
    var list = Object.keys(households.members).map(function (id) { return households.members[id]; });
    API.shareContext({ households: list, items: itemClubs() });
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
    '.jam{all:unset;cursor:pointer;height:52px;padding:0 22px;border-radius:26px;background:#fff;color:#C2410C;',
    '  border:3px solid #F15A28;font:800 19px "Figtree",system-ui,sans-serif;display:flex;align-items:center;',
    '  box-shadow:0 2px 8px rgba(15,23,42,.12)}',
    '.jam[hidden]{display:none}',
    '.jam.busy{opacity:.55;pointer-events:none}',
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
    '.rfams{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px}',
    '.fcard{all:unset;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;justify-content:center;gap:8px;min-height:104px;',
    '  padding:14px 18px 14px 26px;background:#fff;border-radius:20px;position:relative;overflow:hidden;box-shadow:0 3px 14px rgba(15,23,42,.1)}',
    '.fcard::before{content:"";position:absolute;left:0;top:0;bottom:0;width:12px;background:linear-gradient(var(--stripe))}',
    '.fcard .fn{font:400 32px/1.05 "Paytone One","Figtree",sans-serif;color:#2F4F8A;overflow-wrap:anywhere}',
    '.fcard .kids{display:flex;flex-wrap:wrap;gap:6px 8px}',
    '.fcard .kid{display:inline-flex;align-items:center;gap:6px;padding:4px 12px 4px 8px;border-radius:999px;background:#F1F5F9;',
    '  font:700 19px "Figtree",system-ui,sans-serif;color:#334155}',
    '.fcard .kid.hit{background:color-mix(in srgb,var(--c) 18%,#fff);color:#231F20}',
    '.fcard .dot{width:12px;height:12px;border-radius:50%;background:var(--c)}',
    '.panel{margin-top:18px;padding:12px 14px 14px;background:rgba(255,255,255,.55);border-radius:22px}',
    '.panel .sec{margin-top:2px}',
    '.awayrow{display:flex;flex-wrap:wrap;gap:8px}',
    '.awayrow .famsm{height:48px;flex:0 1 220px}',
    '.tag{font-family:"Londrina Solid","Arial Narrow",sans-serif;font-size:17px;letter-spacing:.05em;text-transform:uppercase;',
    '  padding:4px 10px;border-radius:999px;background:#E2E8F0;color:#475569;white-space:nowrap}',
    '@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}',
    '.fams{display:grid;gap:12px}',
    '.fam{all:unset;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;justify-content:center;gap:.25em;',
    '  padding:.5em .8em .5em 1.1em;background:#fff;border-radius:18px;position:relative;overflow:hidden;min-width:0;',
    '  box-shadow:0 2px 10px rgba(15,23,42,.08);animation:rise .24s cubic-bezier(.2,.8,.2,1) both;transition:transform .12s ease}',
    '.fam:active{transform:scale(.97)}',
    '.fams.compact .fam{gap:.3em;padding:0 .5em 0 .8em;border-radius:12px}',
    '.fams.compact .fam::before{width:6px}',
    '.fams.compact .fam .fn{display:block;white-space:nowrap;text-overflow:ellipsis;min-width:0}',
    '.fams.compact .fam .kids{flex-wrap:nowrap;overflow:hidden;gap:0 .3em}',
    '.away.tight .awaygrid{grid-auto-rows:40px;gap:6px}',
    '.away.tight .famsm .nm{font-size:15px}',
    '.away.tight{margin-top:10px}',
    '.fam .fn{font-family:"Paytone One","Figtree",sans-serif;line-height:1.05;color:#2F4F8A;overflow-wrap:anywhere;',
    '  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
    '.fam .kids{display:flex;flex-wrap:wrap;gap:.2em .7em;font-weight:700;color:#334155;line-height:1.2}',
    '.fam .kid{display:inline-flex;align-items:center;gap:.35em;white-space:nowrap}',
    '.fam .dot{width:.7em;height:.7em;border-radius:50%;background:var(--c);flex:0 0 auto}',
    '.fam::before{content:"";position:absolute;left:0;top:0;bottom:0;width:8px;background:linear-gradient(var(--stripe))}',
    '.away{margin-top:16px;display:flex;flex-direction:column;min-height:0}',
    '.away .lead{color:#64748b}',
    '.awaygrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));grid-auto-rows:56px;gap:8px;overflow-y:auto;min-height:0;flex:1}',
    '.famsm{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;gap:8px;padding:0 12px;',
    '  background:#fff;border-radius:12px;box-shadow:0 1px 4px rgba(15,23,42,.08);min-width:0;transition:transform .12s ease}',
    '.famsm:active{transform:scale(.96)}',
    '.famsm .dots{display:flex;gap:3px;flex:0 0 auto}',
    '.famsm .dot{width:10px;height:10px;border-radius:50%;background:var(--c)}',
    '.famsm .nm{font:400 18px "Paytone One","Figtree",sans-serif;color:#334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}',
    '.famsm .n{font:700 14px "Figtree",system-ui,sans-serif;color:#64748b;background:#F1F5F9;border-radius:999px;padding:2px 8px}',
    '.cheer{display:grid;place-items:center;height:100%;text-align:center;font:400 44px "Paytone One","Figtree",sans-serif;color:#2F8A4E}',
    '.lead{font-family:"Londrina Solid","Arial Narrow",sans-serif;font-size:20px;letter-spacing:.06em;text-transform:uppercase;color:#4C72B8;margin:0 4px 10px}',
    '.scrim{position:fixed;inset:0;background:rgba(15,23,42,.36);opacity:0;pointer-events:none;transition:opacity .2s ease;z-index:2}',
    '.scrim.on{opacity:1;pointer-events:auto}',
    '.sheet{position:fixed;left:50%;bottom:0;width:min(640px,100%);transform:translate(-50%,105%);z-index:3;',
    '  background:#fff;border-radius:28px 28px 0 0;padding:28px 28px 32px;box-shadow:0 -8px 32px rgba(15,23,42,.18);',
    '  transition:transform .26s cubic-bezier(.2,.8,.2,1)}',
    '.sheet:not(.on){visibility:hidden;box-shadow:none;transition:transform .26s ease,visibility 0s .26s}',
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
    '.sib:not(.on){visibility:hidden;transition:transform .28s ease,visibility 0s .28s}',
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
    '.toast:not(.on){opacity:0;visibility:hidden;transition:transform .24s ease,opacity .2s ease,visibility 0s .24s}',
    '.toast.on{transform:translate(-50%,0)}',
    '.toast.bad{background:#B82B32}',
    '.tick{width:34px;height:34px;border-radius:50%;background:#fff;color:#2F8A4E;display:grid;place-items:center;font-size:22px;',
    '  animation:pop .3s cubic-bezier(.3,1.6,.5,1) both}',
    '.toast.bad .tick{color:#B82B32}',
    '@keyframes pop{from{transform:scale(.3)}to{transform:none}}',
    // ── Jelly (7.4.0): the lobby's soft squish, its spring exactly ─────────
    // Jelly UI's scale spring (stiffness 260, damping 17, mass 1), as the
    // lobby's squish.js writes it: releaseEasing() over 750 ms, and the same
    // spring over 900 ms for the screen growing out of its pill. A press
    // squashes onto its ledge in 100 ms and springs back; tiles, cards and
    // buttons land stretched and settle through a squash; the confirm card,
    // the family page and the toast spring in. Exits stay quick and plain,
    // the lobby's rule. The linear() strings are written out literally, never
    // behind var(), so a browser that cannot read one keeps the plain motion.
    '.card,.fam,.fcard,.famsm,.btn,.go1,.opt,.close,.jam,.clear{transform-origin:50% 100%;',
    '  transition-property:scale,translate,border-color,background,filter;transition-duration:520ms;',
    '  transition-timing-function:cubic-bezier(.34,1.56,.64,1);transition-timing-function:linear(0, 0.213, 0.605, 0.93, 1.103, 1.142, 1.106, 1.05, 1.006, 0.984, 0.98, 0.986, 0.994, 1, 1.002, 1.003, 1)}',
    '.card:active,.fam:active,.fcard:active,.famsm:active,.tile .go1:active{transform:none;scale:1.03 .92;translate:0 3px;transition-duration:80ms;transition-timing-function:ease-out}',
    '.btn:active,.opt:active,.close:active,.jam:active,.search .clear:active{transform:none;scale:1.06 .9;translate:0 3px;transition-duration:80ms;transition-timing-function:ease-out}',
    '.search .clear:active{translate:0 calc(-50% + 2px)}',
    '.card.in:active{scale:none;translate:none}',
    // 7.6.0: joyful and quick. A piece lands in ~half a second: up from below,
    // stretched tall, overshoots into a squash, wobbles once and rests. Pieces
    // that stay on screen across a redraw never replay it (.stay); they glide
    // to their new place instead (flip() in render), and a family that has just
    // been checked in pops out of the list as it leaves.
    '@keyframes land{0%{opacity:0;translate:0 18px;scale:.84 1.16}45%{opacity:1;translate:0 -3px;scale:1.07 .93}70%{translate:0 0;scale:.98 1.02}100%{opacity:1;translate:0 0;scale:1 1}}',
    '.card,.fam,.fcard,.famsm,.tile{animation:land 480ms cubic-bezier(.3,.7,.4,1) both}',
    '.stay{animation:none!important}',
    '@keyframes sheetin{0%{transform:translate(-50%,105%)}60%{transform:translate(-50%,-3%) scale(1.02,.98)}80%{transform:translate(-50%,1%) scale(.99,1.01)}100%{transform:translate(-50%,0)}}',
    '.sheet.on{animation:sheetin 460ms cubic-bezier(.3,.7,.4,1) both}',
    '.sib.on{transition:transform 520ms linear(0, 0.213, 0.605, 0.93, 1.103, 1.142, 1.106, 1.05, 1.006, 0.984, 0.98, 0.986, 0.994, 1, 1.002, 1.003, 1)}',
    '@keyframes toastin{0%{transform:translate(-50%,-160%) scale(.8)}55%{transform:translate(-50%,8%) scale(1.06,.94)}78%{transform:translate(-50%,-2%) scale(.98,1.02)}100%{transform:translate(-50%,0) scale(1)}}',
    '.toast.on{animation:toastin 440ms cubic-bezier(.3,.7,.4,1) both}',
    '@keyframes tickpop{0%{transform:scale(0) rotate(-40deg)}60%{transform:scale(1.3) rotate(10deg)}100%{transform:none}}',
    '.toast.on .tick{animation:tickpop 420ms cubic-bezier(.3,.7,.4,1) 120ms both}',
    '.ghosts{position:fixed;inset:0;pointer-events:none;z-index:1;overflow:hidden}',
    '.ghosts>*{position:fixed;display:block!important;margin:0!important}',
    '.ghosts>*>*{width:100%;height:100%;animation:none!important}',
    '@keyframes boxpop{0%{scale:.3;rotate:-20deg}55%{scale:1.25;rotate:6deg}100%{scale:1;rotate:0deg}}',
    '.opt.on .box{animation:boxpop 360ms cubic-bezier(.3,.7,.4,1) both}',
    '.wrap.grow{transition:clip-path 900ms linear(0, 0.145, 0.446, 0.75, 0.977, 1.103, 1.142, 1.126, 1.084, 1.04, 1.006, 0.987, 0.98, 0.982, 0.987, 0.994, 0.999, 1.002, 1.003, 1.003, 1.002, 1.001, 1, 1, 1)}',
    '.wrap.shrink{transition:clip-path 260ms cubic-bezier(.4,0,1,1),opacity 260ms ease}',
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
    // A volunteer in the middle of a family holds off the self-update reload.
    host.addEventListener('pointerdown', function () { window.__awanaTouchLastTap = Date.now(); }, true);
    root = host.attachShadow({ mode: 'open' });
    var style = el('style');
    style.textContent = CSS;
    var wrap = els.wrap = el('div', 'wrap');
    var top = el('div', 'top');
    els.count = el('div', 'count');
    var close = el('button', 'close', '✕');
    close.setAttribute('aria-label', 'Close touch check-in');
    close.addEventListener('click', closeScreen);
    // "Printer jammed": only while the Star is the selected printer (jamInfo).
    // One tap reprints the last minute on the Star and the label printer.
    var jam = els.jam = el('button', 'jam', 'Printer jammed');
    jam.hidden = true;
    jam.addEventListener('click', reprintJam);
    top.append(el('div', 'title', 'Check in'), els.count, el('div', 'sp'), jam, close);

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

    els.ghosts = el('div', 'ghosts');
    wrap.append(top, search, els.list, els.ghosts);
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

  // ── Smooth redraws (7.6.0) ──────────────────────────────────────────────
  // Every tile is keyed. A redraw reuses the element a key already had (so
  // nothing that stays replays its landing), and afterwards every survivor
  // glides from where it was to where it is now (FLIP, on the same jelly
  // curve); new keys land, staggered; keys that left fade and shrink away, or
  // pop when the family has just been checked in.
  var SPRING = 'linear(0, 0.213, 0.605, 0.93, 1.103, 1.142, 1.106, 1.05, 1.006, 0.984, 0.98, 0.986, 0.994, 1, 1.002, 1.003, 1)';
  var kd = { prev: {}, next: {}, fresh: 0 };
  var joyRecids = {};
  function calm() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function beginKeyed(list) {
    var prev = {};
    list.querySelectorAll('[data-k]').forEach(function (e) {
      prev[e.dataset.k] = { el: e, r: e.getBoundingClientRect(), pc: e.parentNode ? e.parentNode.className : '' };
    });
    kd = { prev: prev, next: {}, fresh: 0 };
  }
  function keyed(tag, cls, k) {
    var o = kd.prev[k], e;
    if (o && o.el.tagName === tag.toUpperCase() && !kd.next[k]) {
      e = o.el;
      e.className = cls + ' stay';
      e.removeAttribute('style');
      while (e.firstChild) e.removeChild(e.firstChild);
      e.onclick = null;
      e.removeAttribute('aria-disabled');
    } else {
      e = el(tag, cls);
      e.style.animationDelay = Math.min(kd.fresh++, 14) * 16 + 'ms';
    }
    e.dataset.k = k;
    kd.next[k] = e;
    return e;
  }
  function endKeyed() {
    if (calm()) return;
    Object.keys(kd.next).forEach(function (k) {
      var o = kd.prev[k], e = kd.next[k];
      if (!o || o.el !== e || !e.animate || !e.isConnected) return;
      var r = e.getBoundingClientRect();
      if (!r.width || !o.r.width) return;
      var dx = o.r.left - r.left, dy = o.r.top - r.top, sx = o.r.width / r.width, sy = o.r.height / r.height;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return;
      e.animate([{ transformOrigin: '0 0', transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + sx + ',' + sy + ')' },
        { transformOrigin: '0 0', transform: 'none' }], { duration: 520, easing: SPRING });
    });
    Object.keys(kd.prev).forEach(function (k) {
      if (kd.next[k]) return;
      var o = kd.prev[k];
      if (!o.r.width || !els.ghosts || o.r.bottom < 0 || o.r.top > window.innerHeight) return;
      var holder = el('div', o.pc);
      holder.style.cssText = 'left:' + o.r.left + 'px;top:' + o.r.top + 'px;width:' + o.r.width + 'px;height:' + o.r.height + 'px';
      o.el.classList.add('stay');
      holder.append(o.el);
      els.ghosts.append(holder);
      var joy = (o.el.dataset.recids || '').split(',').some(function (id) { return id && joyRecids[id]; });
      var a = holder.animate(joy
        ? [{ transform: 'none', opacity: 1 }, { transform: 'translateY(-10px) scale(1.12,.9)', opacity: 1, offset: 0.35 },
           { transform: 'translateY(-26px) scale(.4)', opacity: 0 }]
        : [{ transform: 'none', opacity: 1 }, { transform: 'scale(.85)', opacity: 0 }],
        { duration: joy ? 460 : 160, easing: joy ? 'cubic-bezier(.3,.7,.4,1)' : 'ease-in', fill: 'forwards' });
      a.onfinish = function () { holder.remove(); };
    });
  }

  function card(p, i) {
    var club = clubFor(p.clubId, p.clubName);
    var b = keyed('button', 'card' + (p.checkedIn ? ' in' : ''), 'c:' + (p.recid || norm(p.name)));
    b.style.setProperty('--club', p.checkedIn ? '#CBD5E1' : club.color);
    b.style.setProperty('--deep', club.deep);
    if (p.recid) b.dataset.recids = p.recid;
    var txt = el('div');
    txt.style.cssText = 'flex:1;min-width:0';
    txt.append(el('div', 'nm', p.name), el('div', 'cl', club.name));
    b.append(txt);
    if (p.checkedIn) {
      b.append(el('span', 'tag', 'Checked in' + (p.at ? ' ' + timeOf(p.at) : '')));
      b.setAttribute('aria-disabled', 'true');
    } else {
      b.onclick = function () { openConfirm(p); };
    }
    return b;
  }

  // A family in the search results: its name, and every child still to come
  // as a chip, the ones the search matched picked out.
  function famCard(f, hits) {
    var b = keyed('button', 'fcard', 'r:' + f.key);
    var stops = f.kids.map(function (c) { return clubFor(c.clubId, c.clubName).color; });
    b.style.setProperty('--stripe', stops.length > 1 ? stops.join(',') : stops[0] + ',' + stops[0]);
    b.dataset.recids = f.kids.map(function (c) { return c.recid; }).join(',');
    var single = f.kids.length === 1;
    b.append(el('div', 'fn', single ? f.kids[0].name : f.name));
    var line = el('div', 'kids');
    f.kids.forEach(function (c) {
      var club = clubFor(c.clubId, c.clubName);
      var k = el('span', 'kid' + (hits[c.recid] ? ' hit' : ''));
      k.style.setProperty('--c', club.color);
      k.append(el('span', 'dot'), document.createTextNode(single ? club.name : c.name.split(' ')[0]));
      line.append(k);
    });
    b.append(line);
    b.setAttribute('aria-label', famLabel(f));
    b.onclick = function () { famClick(f); };
    return b;
  }

  function awayButton(f, prefix) {
    var b = keyed('button', 'famsm', prefix + f.key);
    b.dataset.recids = f.kids.map(function (c) { return c.recid; }).join(',');
    var dots = el('span', 'dots');
    f.kids.forEach(function (c) {
      var d = el('span', 'dot');
      d.style.setProperty('--c', clubFor(c.clubId, c.clubName).color);
      dots.append(d);
    });
    b.append(dots, el('span', 'nm', f.kids.length === 1 ? f.kids[0].name : f.name));
    if (f.kids.length > 1) b.append(el('span', 'n', String(f.kids.length)));
    b.setAttribute('aria-label', famLabel(f));
    b.onclick = function () { famClick(f); };
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
    beginKeyed(list);
    while (list.firstChild) list.removeChild(list.firstChild);
    if (!q.trim()) {
      renderFamilies(list);
      endKeyed();
      return;
    }
    lastFamSig = '';
    renderSearch(list, all, q);
    endKeyed();
  }

  // Typing (7.6.0): households first, as family cards (every child still to
  // come, the matched ones picked out); then the matching children on their
  // own panel; "Did you mean" families for a misspelling; and only at the very
  // bottom, as small buttons, families not here the last two club nights.
  function renderSearch(list, all, q) {
    var r = searchPeople(all, q);
    var fams = groupFamilies(pageChildren(), households);
    var famOf = {};
    fams.forEach(function (f) { f.kids.forEach(function (k) { famOf[k.recid] = f; }); });
    var hits = {}, seen = {};
    function famsFor(people) {
      var out = [];
      people.forEach(function (p) {
        if (p.checkedIn || !p.recid) return;
        hits[p.recid] = true;
        var f = famOf[p.recid];
        if (f && !seen[f.key]) { seen[f.key] = true; out.push(f); }
      });
      return out;
    }
    var exact = famsFor(r.matches);
    var near = norm(q).length >= 3 ? famsFor(r.close) : [];
    var away = exact.concat(near).filter(isAway);
    exact = exact.filter(function (f) { return !isAway(f); });
    near = near.filter(function (f) { return !isAway(f); });
    var awayKid = {};
    away.forEach(function (f) { f.kids.forEach(function (k) { awayKid[k.recid] = true; }); });
    // A child who is a family of one is already their family card; the panel
    // lists the brothers and sisters the cards hold, and anyone already in.
    var kids = r.matches.filter(function (p) {
      if (p.recid && awayKid[p.recid]) return false;
      return p.checkedIn || !p.recid || !famOf[p.recid] || famOf[p.recid].kids.length > 1;
    });

    if (exact.length) {
      list.append(el('div', 'sec', exact.length === 1 ? 'Family' : 'Families'));
      var g = el('div', 'rfams');
      exact.forEach(function (f) { g.append(famCard(f, hits)); });
      list.append(g);
    }
    if (near.length) {
      list.append(el('div', 'sec', exact.length ? 'Or did you mean' : 'Did you mean'));
      var g2 = el('div', 'rfams');
      near.forEach(function (f) { g2.append(famCard(f, hits)); });
      list.append(g2);
    }
    if (kids.length) {
      var panel = el('div', 'panel');
      panel.append(el('div', 'sec', 'Children'));
      var g3 = el('div', 'grid');
      kids.forEach(function (p, i) { g3.append(card(p, i)); });
      panel.append(g3);
      list.append(panel);
    }
    if (away.length) {
      var box = el('div', 'away');
      box.append(el('div', 'lead', 'Not here the last two club nights'));
      var row = el('div', 'awayrow');
      away.forEach(function (f) { row.append(awayButton(f, 's:')); });
      box.append(row);
      list.append(box);
    }
    if (!exact.length && !near.length && !kids.length && !away.length) {
      list.append(el('div', 'hint', 'No child matches “' + q.trim() + '”. A new child? Use Walk-ins in the panel.'));
    }
  }

  // ── Families still to come (whenever the search is empty) ────────────────
  var lastFamSig = '';
  // Who came to either of the last two club nights (GET /touch/recent, from
  // the print server's attendance ledger), or null until it answers.
  var recent = null, recentAt = 0;
  function loadRecent() {
    if (recent && Date.now() - recentAt < 10 * 60 * 1000) return;
    recentAt = Date.now();
    if (typeof API.recent !== 'function') return;
    API.recent().then(function (r) {
      if (!r || !r.ready) { recent = null; return; }
      var ids = {}, names = {};
      (r.ids || []).forEach(function (x) { ids[String(x).toLowerCase()] = true; });
      (r.names || []).forEach(function (x) { names[norm(x)] = true; });
      recent = { ids: ids, names: names };
      if (state.open && els.input && !els.input.value.trim()) render();
    });
  }
  // A family is "away" when none of its children was at either of the last
  // two club nights; until the ledger answers, nobody is.
  function isAway(f) {
    if (!recent) return false;
    return f.kids.every(function (k) {
      return !recent.ids[String(k.recid || '').toLowerCase()] && !recent.names[norm(k.name)];
    });
  }
  function famSig() {
    return groupFamilies(pageChildren(), households).map(function (f) {
      return f.key + ':' + f.kids.length + (isAway(f) ? 'a' : '');
    }).join('|');
  }

  function famClick(f) {
    if (f.kids.length === 1) openConfirm(f.kids[0]);
    else openSiblings(null, f.kids, { bible: true, friend: false }, f.name);
  }
  function famLabel(f) {
    return f.kids.length === 1 ? f.kids[0].name : f.name + ': ' + f.kids.map(function (c) { return c.name.split(' ')[0]; }).join(', ');
  }

  function renderFamilies(list) {
    var all = groupFamilies(pageChildren(), households);
    lastFamSig = famSig();
    if (!all.length) {
      list.append(el('div', 'cheer', document.querySelectorAll('.clubber').length || tonight.length
        ? 'Everyone\u2019s checked in!' : 'No children on this page yet.'));
      return;
    }
    var main = all.filter(function (f) { return !isAway(f); });
    var away = all.filter(isAway);
    // Everyone left has been away: they are the main list tonight.
    if (!main.length) { main = away; away = []; }
    list.append(el('div', 'lead', main.length + (main.length === 1 ? ' family' : ' families') + ' still to come \u00b7 tap one, or type a name'));
    var W = list.clientWidth - 48;                      // the list's side padding
    var H = list.clientHeight - 24 - 40;                // bottom padding and the line above

    // The away row: small buttons, at most a third of the screen, scrolling
    // inside itself if it needs more.
    var awayBox = null, awayH = 0;
    if (away.length) {
      var colsAway = Math.max(1, Math.floor((W + 8) / (170 + 8)));
      var rowsAway = Math.ceil(away.length / colsAway);
      var awayRow = main.length > 30 ? 40 : 56;
      awayH = Math.min(36 + rowsAway * awayRow + (rowsAway - 1) * 8, Math.round(H * (main.length > 30 ? 0.22 : 0.34)));
      awayBox = el('div', 'away' + (awayRow < 56 ? ' tight' : ''));
      awayBox.style.height = awayH + 'px';
      awayBox.append(el('div', 'lead', 'Not here the last two club nights \u00b7 ' + away.length));
      var ag = el('div', 'awaygrid');
      away.forEach(function (f) { ag.append(awayButton(f, 'a:')); });
      awayBox.append(ag);
      H -= awayH + 16;
    }

    // Up to ~70 families without scrolling (owner, 7.5.0): the gaps close up as
    // the list grows, and once tiles get small the children's names give way
    // to their club dots, so the family's name keeps the whole tile, down to a
    // 40px row.
    var gap = main.length > 40 ? 6 : main.length > 16 ? 8 : 12;
    var fit = fitTiles(main.length, W, H, gap, 2, 40);
    var compact = fit.h < 74;
    var grid = el('div', 'fams' + (compact ? ' compact' : ''));
    grid.style.gap = gap + 'px';
    grid.style.gridTemplateColumns = 'repeat(' + fit.cols + ', minmax(0, 1fr))';
    grid.style.gridAutoRows = Math.floor(fit.h) + 'px';
    if (awayBox) { grid.style.maxHeight = Math.max(40, H) + 'px'; grid.style.overflowY = 'auto'; }
    var fs = compact ? Math.max(13, Math.min(30, fit.h * 0.4)) : Math.max(18, Math.min(64, fit.h * 0.32, fit.w / 8));
    main.forEach(function (f, i) {
      var b = keyed('button', 'fam', 'f:' + f.key);
      b.dataset.recids = f.kids.map(function (c) { return c.recid; }).join(',');
      // Each tile's name fits its width on one line: Paytone One averages a
      // little over half an em a letter, and the tile pads about 1.9em. On a
      // one-line tile the name keeps about 55% of the width, the children the rest.
      var single = f.kids.length === 1;
      var title = single ? f.kids[0].name : f.name;
      var own = Math.min(fs, (fit.w - 8) / (title.length * 0.6 + (compact ? 1.3 : 1.9)));
      b.style.fontSize = Math.max(compact ? 12 : 14, Math.round(own)) + 'px';
      var stops = f.kids.map(function (c) { return clubFor(c.clubId, c.clubName).color; });
      b.style.setProperty('--stripe', stops.length > 1 ? stops.join(',') : stops[0] + ',' + stops[0]);
      b.append(el('div', 'fn', title));
      var line = el('div', 'kids');
      line.style.fontSize = Math.max(13, Math.round(fs * 0.46)) + 'px';
      f.kids.forEach(function (c) {
        var k = el('span', 'kid');
        var dot = el('span', 'dot');
        dot.style.setProperty('--c', clubFor(c.clubId, c.clubName).color);
        k.append(dot);
        if (!compact) k.append(document.createTextNode(single ? clubFor(c.clubId, c.clubName).name : c.name.split(' ')[0]));
        line.append(k);
      });
      b.append(line);
      b.setAttribute('aria-label', famLabel(f));
      b.onclick = function () { famClick(f); };
      grid.append(b);
    });
    list.append(grid);
    if (awayBox) list.append(awayBox);
  }

  // While the families are showing, follow the page: a child checked in at
  // another station (or by the panel) leaves, and the tiles grow. Re-drawn
  // only when the set of families actually changes, so nothing replays.
  // 7.9.0: a search that is open follows too (a child checked in from a
  // phone or the panel drops out of the results within 3 s); the keyed redraw
  // glides what stays, so it never jumps under a finger. Only an open card or
  // family page holds the screen still.
  var lastSearchSig = '';
  setInterval(function () {
    if (!state.open || !els.input || els.sheet.classList.contains('on') || siblingsOpen()) return;
    if (els.input.value.trim()) {
      var sig = famSig() + '#' + Object.keys(recentlyIn).length;
      if (sig !== lastSearchSig) { lastSearchSig = sig; render(); }
      return;
    }
    if (famSig() !== lastFamSig) render();
  }, 3000);
  // ...and tonight's count (and who shows as checked in) every 15 s, from
  // the print app, which counts the phones' check-ins too.
  var lastTonightSig = '';
  setInterval(function () {
    if (!state.open || typeof API.tonight !== 'function') return;
    API.tonight().then(function (list) {
      list = list || [];
      var sig = list.length + ':' + list.map(function (t) { return t.name; }).join('|');
      if (sig === lastTonightSig) return;
      lastTonightSig = sig;
      tonight = list;
      if (els.sheet.classList.contains('on') || siblingsOpen()) {
        var n = people().filter(function (p) { return p.checkedIn; }).length;
        els.count.textContent = n ? n + ' checked in tonight' : '';
      } else render();
    });
  }, 15000);
  window.addEventListener('resize', function () {
    if (state.open && els.input && !els.input.value.trim()) render();
  });

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
    // Bible is ticked to start with wherever the club has it (owner, 7.6.0).
    state.choice = { bible: !!state.items.bible, friend: false };
    var s = els.sheet;
    while (s.firstChild) s.removeChild(s.firstChild);
    s.style.setProperty('--club', club.color);
    s.style.setProperty('--deep', club.deep);
    s.append(el('div', 'bar'), el('div', 'nm', p.name), el('div', 'cl', club.name));
    if (state.items.bible || state.items.friend) {
      var opts = el('div', 'opts');
      if (state.items.bible) opts.append(optButton('Bible', state.choice.bible, function (v) { state.choice.bible = v; }));
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
      var choice = { bible: state.choice.bible, friend: state.choice.friend };
      closeConfirm();
      // Back at once (owner, 7.5.0): the check-in finishes in the background,
      // and the brothers and sisters' page, if any, comes up straight away.
      var sibs = siblingsOf(p);
      checkInBackground([{ c: p, mine: choice }], null);
      if (sibs.length) openSiblings(p, sibs, choice);
      else resetSearch();
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
    // Counted as in from the tap (7.5.0: the screen goes back at once), so the
    // family leaves the list now; a failure puts the child back.
    recentlyIn[p.recid] = { name: p.name, clubName: p.clubName, clubId: p.clubId, at: new Date().toISOString() };
    return API.checkIn(p.recid, options).then(function (how) {
      if (how === 'gone') return 'gone';
      checkedInThisVisit = true;
      setTimeout(refreshTonight, 2500);
      return true;
    }).catch(function () {
      delete recentlyIn[p.recid];
      toast('Couldn’t check in ' + p.name + '. Check the internet, then try again.', true);
      if (state.open && els.input && !els.input.value.trim() && !siblingsOpen()) render();
      return false;
    });
  }

  // The check-ins of one tap, in the background, one green line when they are
  // all through (a failure has already said so in red).
  function checkInBackground(entries, title) {
    var done = 0;
    // Every child of the tap leaves the list now, not as their turn comes.
    entries.forEach(function (e) {
      joyRecids[e.c.recid] = true;
      recentlyIn[e.c.recid] = { name: e.c.name, clubName: e.c.clubName, clubId: e.c.clubId, at: new Date().toISOString() };
    });
    return entries.reduce(function (chain, e) {
      return chain.then(function () { return checkInOne(e.c, e.mine).then(function (ok) { if (ok) done++; }); });
    }, Promise.resolve()).then(function () {
      if (!done) return;
      var bad = entries.length - done;
      if (!bad || !els.toast.classList.contains('bad') || !els.toast.classList.contains('on')) {
        toast(entries.length === 1 ? entries[0].c.name + ' is checked in'
          : (title ? title + ': ' : '') + done + ' checked in', false);
      }
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


  // The family page: after a check-in (first = that child) it offers the
  // brothers and sisters; from a family tile (first = null) it is the family.
  function openSiblings(first, sibs, choice, title) {
    var s = els.sib;
    while (s.firstChild) s.removeChild(s.firstChild);
    var head = el('div', 'head');
    if (first) {
      var last = first.name.split(' ').slice(1).join(' ');
      head.append(el('div', 'done-l', '\u2713 ' + first.name + ' is checked in'),
        el('h2', null, (last ? last + ': also' : 'Also') + ' here tonight?'));
    } else {
      head.append(el('h2', null, title || 'This family'));
    }
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
      // Back to the families at once (owner, 7.5.0); the check-ins go one at a
      // time in the background (the API queues them in order anyway).
      var left = pending.filter(function (e) { return e.state === 'ready'; });
      left.forEach(function (e) { e.state = 'busy'; });
      var famName = first ? first.name.split(' ').slice(1).join(' ') : (title || '');
      checkInBackground(left, famName);
      closeSiblings();
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
      if (state.siblings.length && state.siblings.every(function (x) { return x.state === 'done'; })) closeSiblings();
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

  function loadJam() {
    if (typeof API.jamInfo !== 'function') return;
    API.jamInfo().then(function (j) { if (els.jam) els.jam.hidden = !(j && j.available); });
  }

  function reprintJam() {
    var b = els.jam;
    if (!b || b.classList.contains('busy') || typeof API.jam !== 'function') return;
    b.classList.add('busy');
    toast('Reprinting the last minute…');
    API.jam().then(function (r) {
      b.classList.remove('busy');
      r = r || {};
      if (r.error) { toast(r.error, true); return; }
      if (!r.count) { toast('No check-ins in the last minute to reprint.'); return; }
      var n = r.printed ? r.printed.length : 0;
      var tags = n === 1 ? '1 tag' : n + ' tags';
      if (r.stoppedAt) { toast('Reprinted ' + tags + ', then both printers failed at ' + r.stoppedAt.name + '.', true); return; }
      if (r.star === n && r.label === n) { toast('Reprinted ' + tags + ' on the Star and the label printer.'); return; }
      if (r.label === n) { toast('Reprinted ' + tags + ' on the label printer. The Star is still not printing.', true); return; }
      if (r.star === n) { toast('Reprinted ' + tags + ' on the Star. Label printer: ' + (r.labelError || 'not printing') , true); return; }
      toast('Reprinted ' + tags + '. Star ' + r.star + ', label printer ' + r.label + '.', true);
    });
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
    window.__awanaTouchLastTap = Date.now();
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
  // The screen grows out of the Check in pill (fromRect) on the long spring,
  // and asks the browser for true full screen: no tabs, no address bar. That
  // needs the tap that opened it, so it is asked for here, inside that tap.
  // Escape (or Close) gives it back.
  var enteredFullscreen = false;
  function insetFor(r) {
    return 'inset(' + Math.round(r.top) + 'px ' + Math.round(window.innerWidth - r.right) + 'px '
      + Math.round(window.innerHeight - r.bottom) + 'px ' + Math.round(r.left) + 'px round 20px)';
  }
  function pillRect() {
    var pill = document.getElementById('awana-touch-pill');
    return pill ? pill.getBoundingClientRect() : null;
  }

  function openScreen(fromRect) {
    if (!host) build();
    if (!host.isConnected) document.body.appendChild(host);
    state.open = true;
    window.__awanaTouchOpen = true;
    var de = document.documentElement;
    if (!document.fullscreenElement && de.requestFullscreen) {
      de.requestFullscreen({ navigationUI: 'hide' }).then(function () { enteredFullscreen = true; }).catch(function () { /* stays windowed */ });
    }
    loadHouseholds();
    refreshTonight();
    loadRecent();
    loadJam();
    var w = els.wrap;
    w.classList.remove('shrink', 'grow');
    var r = fromRect || pillRect();
    if (r) {
      w.style.clipPath = insetFor(r);
      w.classList.add('on');
      void w.offsetWidth;
      w.classList.add('grow');
      requestAnimationFrame(function () { w.style.clipPath = 'inset(0px 0px 0px 0px round 0px)'; });
    } else {
      w.style.clipPath = '';
      requestAnimationFrame(function () { w.classList.add('on'); });
    }
    render();
    setTimeout(function () { try { els.input.focus({ preventScroll: true }); } catch (e) { els.input.focus(); } }, 60);
  }

  var checkedInThisVisit = false;
  function closeScreen() {
    state.open = false;
    window.__awanaTouchOpen = false;
    // The page behind: any leftover TwoTimTwo modal cleared, and a reload once
    // the shrink has played if anyone was checked in (content.js, closed()).
    var reload = checkedInThisVisit;
    checkedInThisVisit = false;
    if (typeof API.closed === 'function') setTimeout(function () { API.closed(reload); }, 320);
    closeConfirm();
    els.sib.classList.remove('on');
    if (enteredFullscreen && document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(function () { /* already out */ });
    }
    enteredFullscreen = false;
    var w = els.wrap;
    var r = pillRect();
    w.classList.remove('grow');
    w.classList.add('shrink');
    if (r) w.style.clipPath = insetFor(r);
    w.classList.remove('on');
    setTimeout(function () {
      if (!state.open && host) { host.remove(); w.classList.remove('shrink'); w.style.clipPath = ''; }
    }, 300);
  }

  window.__awanaTouchOpenScreen = openScreen;
  // The phones' families stay current even when nobody opens the touch screen.
  setTimeout(loadHouseholds, 5000);
  setInterval(loadHouseholds, 31 * 60 * 1000);
})();
