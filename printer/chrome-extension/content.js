(function() {
  if (window.__awanaPrinterLoaded) return;
  window.__awanaPrinterLoaded = true;

  const EXTENSION_VERSION = '7.18.0';
  const PRINT_COOLDOWN = 2000;
  // POST /print is synchronous on the server: PowerShell + a cold printer can
  // take 15-30 s (the server retries the spooler internally). This must sit
  // ABOVE that worst case — aborting a print that is still succeeding and
  // retrying it is exactly what double-printed labels. The server also
  // suppresses same-name duplicates as a second layer of defence.
  const PRINT_TIMEOUT_MS = 35000;
  // A visiting family typed into one form (#323). Four is the practical cap a
  // desk can handle without a line forming; each child is still printed by its
  // own independent POST /print, never a batch endpoint.
  const MAX_GUEST_FAMILY = 4;
  const BATCH_DELAY = 400;
  const DEBOUNCE_MS = 100;
  const STATUS_TIMEOUT = 3000;
  const PRINT_SERVER = 'http://localhost:3456';
  const STORAGE_KEY = 'awana_selectedPrinterId';
  const MINIMIZE_KEY = 'awana_widgetMinimized';
  const PRINTER_KEY  = 'awana_selectedPrinterName';

  const QUEUE_KEY      = 'awana_printQueue';
  const MUTE_KEY       = 'awana_soundMuted';
  const QUICK_MODE_KEY = 'awana_quickMode';
  const STEP_UP_KEY    = 'awana_stepUpMode'; // 'auto' | 'on' | 'off'
  const STORE_KEY      = 'awana_storeMode';  // 'auto' | 'on' | 'off'

  let selectedMode        = localStorage.getItem(STORAGE_KEY) || 'auto';
  // The printer is chosen in ONE place, the print dashboard (6.26.0): every
  // print goes to the printer the server is set to, so this is always empty
  // and a choice this browser saved before is forgotten (just below).
  const selectedPrinterName = '';
  try { localStorage.removeItem(PRINTER_KEY); } catch (e) { /* private mode */ }
  let soundMuted          = localStorage.getItem(MUTE_KEY) === 'true';
  let quickModeEnabled    = localStorage.getItem(QUICK_MODE_KEY) === 'true';
  let stepUpMode          = localStorage.getItem(STEP_UP_KEY) || 'auto';
  let storeMode           = localStorage.getItem(STORE_KEY) || 'auto';
  let lastPrintedName = null;
  var batchPrintedNames = new Set();
  // R-1: reconcile-against-checkin_report state (see scheduleReconcile at the
  // bottom of the file). Declared here so loadPrintedState can restore
  // reconcileBaselineDone before the roster/reconcile passes ever run.
  var reconcileBaselineDone = false;
  var reconcileInFlight = false;

  // ── Remote check-in detection state ────────────────────────────────────────
  // The .clubber list on TwoTimTwo.com shrinks when a kid is checked in on
  // ANY device.  By diffing the visible set between scans we can detect
  // check-ins that happened on a phone/other laptop and print their label
  // here.  A session-scoped "printed" set dedupes against the existing
  // #lastCheckin detection path so locally-checked-in kids aren't reprinted.
  // R-4: ROSTER_CACHE, printedNames, knownClubbers, pendingMissing and
  // batchPrintedNames are all keyed by a stable *identity key* — 'id:<recid>'
  // when TwoTimTwo's own clubber id is known, else 'nm:<lowercased name>' for
  // walk-ins / offline-cached entries that have no recid. This is what keeps
  // two kids who share a first+last name from collapsing into one entry.
  // ROSTER_CACHE must still be searchable by name (widget search, sibling
  // lookups), so ROSTER_NAME_INDEX is a secondary nameKey → identityKey index.
  var ROSTER_CACHE      = {};          // { identityKey: { displayName, clubName, clubImageData, recid, clubId, element } }
  // { nameKeyLower: identityKey | AMBIGUOUS_NAME }. Two children really can
  // share a display name (twins, cousins, two unrelated Jane Does). A
  // single-valued index silently resolved such a name to whichever row was
  // scanned last, which meant a label could print with the OTHER child's club
  // and consent data while marking that child printed — so she then never got
  // a label at all. When a name maps to more than one clubber id we record the
  // collision instead and refuse to guess: callers fall back to the name key,
  // which prints the right name and never attributes one child's safety data
  // to another.
  // Local calendar date (YYYY-MM-DD). Must be local, not UTC: after 7pm ET a
  // UTC date is already tomorrow, which would ask TwoTimTwo for the wrong
  // meeting mid-club.
  function todayIsoDate() {
    var d = new Date();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  var AMBIGUOUS_NAME = '*ambiguous*';
  var ROSTER_NAME_INDEX = {};
  var knownClubbers   = new Set();   // last-seen identity keys
  var printedNames    = new Set();   // session dedup, identity keys
  var baselineScanned = false;
  // A kid must be missing from at least this many consecutive scans before the
  // roster-diff path is allowed to print their label. This defends against
  // transient disappearances (search filter, scroll virtualization, page
  // re-render) that are NOT real check-ins.
  var PENDING_MISS_THRESHOLD = 2;
  // Map<nameKey, consecutiveMissCount>
  var pendingMissing  = new Map();
  // If >= this fraction of the known roster disappears in a single scan, treat
  // it as a UI reshuffle (filter / tab switch / reload with filter active) and
  // re-baseline instead of printing anyone.
  var MASS_DISAPPEAR_RATIO = 0.8;
  // Any roster shrink that crosses the 80 % ratio is treated as a UI
  // reshuffle. Set abs threshold to 1 (was 3) so small clubs (≤10 kids) are
  // protected from search-filter phantom prints — a real check-in only loses
  // 1 kid at a time, so a 50-kid roster never shrinks to <80 % from a single
  // checkin and a legitimate single check-in still flows through guard B.
  var MASS_DISAPPEAR_ABS   = 1;
  var REMOTE_PRINTED_KEY  = 'awana_printedNames';
  var REMOTE_PRINTED_TS   = 'awana_printedTs';
  var REMOTE_BASELINE_KEY = 'awana_baselineDone';
  var REMOTE_KNOWN_KEY    = 'awana_knownClubbers';
  var REMOTE_ROSTER_KEY   = 'awana_rosterCache';
  var REMOTE_STALE_MS     = 4 * 60 * 60 * 1000; // 4h idle resets dedup (new event night)
  var SCAN_INTERVAL_MS    = 5000;
  var AUTO_REFRESH_INTERVAL_MS = 30000;
  // R-1: separate baseline flag for the checkin_report reconcile pass — kept
  // next to the roster-diff baseline key but tracked independently so a
  // reload can't re-trigger the "first pass never prints" seeding twice.
  var REMOTE_RECONCILE_BASELINE_KEY = 'awana_reconcileBaselineDone';

  // ── The dedup state is shared by every TwoTimTwo tab, and keyed by the day ──
  // It lived in sessionStorage, which is per TAB: a second TwoTimTwo tab (a
  // volunteer opening the roster in a new tab, a browser restore) started with
  // an empty printed set, seeded its own baseline a minute after load, and then
  // printed every check-in made elsewhere as "missed" (7.11.1). Now one copy
  // in localStorage, under today's date so a new club night starts clean and
  // nothing from last week is ever "already printed"; other days' copies are
  // removed as they are found. The 4-hour idle reset still applies on top.
  var SHARED_DEDUP_PREFIX = 'awana_shared_';
  var dedupStore = {
    key: function(k) { return SHARED_DEDUP_PREFIX + todayIsoDate() + '_' + k; },
    getItem: function(k) { return localStorage.getItem(this.key(k)); },
    setItem: function(k, v) { localStorage.setItem(this.key(k), v); },
    removeItem: function(k) { localStorage.removeItem(this.key(k)); },
  };
  function pruneSharedDedup(storage, today) {
    var keep = SHARED_DEDUP_PREFIX + today + '_';
    var gone = [];
    for (var i = 0; i < storage.length; i++) {
      var k = storage.key(i);
      if (k && k.indexOf(SHARED_DEDUP_PREFIX) === 0 && k.indexOf(keep) !== 0) gone.push(k);
    }
    gone.forEach(function(k) { storage.removeItem(k); });
    return gone.length;
  }
  try { pruneSharedDedup(localStorage, todayIsoDate()); } catch (e) { /* storage off */ }

  // ── R-4: stable identity keys ───────────────────────────────────────────
  // Internal whitespace is collapsed, not just trimmed: the check-in report's
  // name sits between two links in the markup, so its text can come back with
  // padding or a line break inside it ("Jane  Doe") while the roster row reads
  // "Jane Doe". Keying those differently would make reconcile treat one child
  // as two and print a duplicate label.
  function nameKeyOf(name) {
    return String(name == null ? '' : name).toLowerCase().replace(/\s+/g, ' ').trim();
  }
  function identityKey(recid, displayName) {
    return recid ? ('id:' + recid) : ('nm:' + nameKeyOf(displayName));
  }
  // Older sessionStorage payloads (pre-identity-key) stored bare lowercased
  // names with no prefix. Treat anything without an 'id:'/'nm:' prefix as an
  // 'nm:' key so a mid-event extension update doesn't reprint everyone.
  function migrateLegacyKey(v) {
    if (typeof v !== 'string') return v;
    return (/^(id:|nm:)/).test(v) ? v : ('nm:' + v);
  }
  // Resolve the identity key for a name, preferring an explicitly-known recid,
  // else looking the name up in ROSTER_NAME_INDEX (populated by scanClubberList
  // whenever the kid has been seen on the live roster), else falling back to
  // the name-only key.
  function resolveIdentityKey(name, recid) {
    if (recid == null) {
      var idk = ROSTER_NAME_INDEX[nameKeyOf(name)];
      if (idk && idk !== AMBIGUOUS_NAME) recid = idk.indexOf('id:') === 0 ? idk.slice(3) : null;
    }
    return identityKey(recid, name);
  }
  function isPrinted(name, recid) {
    if (printedNames.has(resolveIdentityKey(name, recid))) return true;
    // A label printed before this station knew the child's TwoTimTwo id was
    // recorded under a name key — a hand-typed walk-in is the common case, and
    // registering that walk-in (the F-3 checkbox) then checks them in, so they
    // come back from the check-in report carrying a real id. Without this
    // fallback the id-keyed lookup misses the name-keyed record and reconcile
    // prints a SECOND label for the same child.
    return printedNames.has('nm:' + nameKeyOf(name));
  }

  // ── Walk-in guest FAMILY (#323) ──────────────────────────────────────────
  // Pure: turns the guest form's rows into the /print payloads, in print
  // order. Row 0 is the "First Last" the operator typed; the extra rows carry
  // their own first name and club and inherit row 0's LAST name — a visiting
  // mother with three children should type the surname once.
  //
  // Only row 0 may print the family's connect card: four welcome cards for one
  // household is a stack of paper nobody wants. Every row is otherwise a
  // completely ordinary single-child payload, so each label goes through the
  // exact same path, dedup key and history row as a lone walk-in does today.
  //
  // Deliberately NOT a roster lookup: there is no household index, no
  // roster-derived grouping and no auto-batching of registered children here —
  // this is only the rows a human typed. (The sibling check-in feature was
  // removed in v6.1.0 and stays removed.)
  function buildGuestFamilyPayloads(primaryName, extraRows, shared) {
    var parts = String(primaryName == null ? '' : primaryName).trim().split(/\s+/).filter(Boolean);
    var first = parts[0] || '';
    var last = parts.slice(1).join(' ');
    if (!first) return [];
    var s = shared || {};
    var rows = [{ firstName: first, club: s.club || '' }];
    (extraRows || []).forEach(function(r) {
      rows.push({
        firstName: String((r && r.firstName) || '').trim(),
        club: (r && r.club) || ''
      });
    });
    var out = [];
    var seen = {};
    rows.forEach(function(r) {
      if (!r.firstName) return;                        // a blank extra row is just not a child
      var full = (r.firstName + (last ? ' ' + last : '')).trim();
      var k = full.toLowerCase().replace(/\s+/g, ' ');
      // The same child twice would be eaten by the server's 25s duplicate
      // window, and one of the two children would leave with no label.
      if (seen[k]) return;
      seen[k] = true;
      if (out.length >= MAX_GUEST_FAMILY) return;
      var p = {
        name: full, clubName: r.club || '', clubImageData: null,
        printerName: s.printerName || '', stepUpNight: !!s.stepUpNight
      };
      if (s.visitor) p.visitor = true;
      if (out.length > 0) p.suppressConnectCard = true;   // one card per family
      out.push(p);
    });
    return out;
  }
  // Secondary name → identityKey index lookup, so ROSTER_CACHE (keyed by
  // identity) stays reachable from code that only has a display name (widget
  // search, sibling matching, doPrint's clubberId lookup).
  function rosterLookupByName(name) {
    var idk = ROSTER_NAME_INDEX[nameKeyOf(name)];
    if (!idk || idk === AMBIGUOUS_NAME) return null;
    return ROSTER_CACHE[idk] || null;
  }

  function loadPrintedState() {
    try {
      var ts = parseInt(dedupStore.getItem(REMOTE_PRINTED_TS) || '0', 10);
      if (ts && Date.now() - ts < REMOTE_STALE_MS) {
        var arr = JSON.parse(dedupStore.getItem(REMOTE_PRINTED_KEY) || '[]');
        if (Array.isArray(arr)) printedNames = new Set(arr.map(migrateLegacyKey));
        baselineScanned = dedupStore.getItem(REMOTE_BASELINE_KEY) === '1';
        reconcileBaselineDone = dedupStore.getItem(REMOTE_RECONCILE_BASELINE_KEY) === '1';
        // Restore knownClubbers + ROSTER_CACHE so diff survives a reload.
        var knownArr = JSON.parse(dedupStore.getItem(REMOTE_KNOWN_KEY) || '[]');
        if (Array.isArray(knownArr)) knownClubbers = new Set(knownArr.map(migrateLegacyKey));
        var rosterObj = JSON.parse(dedupStore.getItem(REMOTE_ROSTER_KEY) || '{}');
        if (rosterObj && typeof rosterObj === 'object') {
          ROSTER_CACHE = {};
          ROSTER_NAME_INDEX = {};
          Object.keys(rosterObj).forEach(function(k) {
            var v = rosterObj[k];
            // Pre-identity-key persisted caches were keyed by bare name.
            var idk = (/^(id:|nm:)/).test(k) ? k : identityKey(v && v.recid, (v && v.displayName) || k);
            ROSTER_CACHE[idk] = v;
            if (v && v.displayName) ROSTER_NAME_INDEX[nameKeyOf(v.displayName)] = idk;
          });
        }
      } else {
        dedupStore.removeItem(REMOTE_PRINTED_KEY);
        dedupStore.removeItem(REMOTE_PRINTED_TS);
        dedupStore.removeItem(REMOTE_BASELINE_KEY);
        dedupStore.removeItem(REMOTE_KNOWN_KEY);
        dedupStore.removeItem(REMOTE_ROSTER_KEY);
        dedupStore.removeItem(REMOTE_RECONCILE_BASELINE_KEY);
      }
    } catch (e) { /* ignore sessionStorage errors */ }
  }

  var rosterDirty = false;
  function saveScanState() {
    try {
      dedupStore.setItem(REMOTE_KNOWN_KEY, JSON.stringify(Array.from(knownClubbers)));
      if (rosterDirty) {
        dedupStore.setItem(REMOTE_ROSTER_KEY, JSON.stringify(ROSTER_CACHE));
        persistRosterLocal();
        rosterDirty = false;
      }
    } catch (e) { /* ignore quota errors */ }
  }

  // ── Offline roster cache ────────────────────────────────────────────────────
  // The scraped roster is persisted to chrome.storage.local (survives tab
  // closes and browser restarts) so widget search and label printing still
  // work if TwoTimTwo or the venue Wi-Fi goes down mid-event and the page
  // can no longer render its .clubber list.
  var ROSTER_LOCAL_KEY = 'awana_rosterCacheLocal';
  var ROSTER_LOCAL_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // two weeks

  function persistRosterLocal() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    try {
      var entries = Object.keys(ROSTER_CACHE).slice(0, 400).map(function(k) {
        var m = ROSTER_CACHE[k];
        return { displayName: m.displayName, clubName: m.clubName || '', clubImageData: m.clubImageData || null, recid: m.recid || null, clubId: m.clubId || null };
      });
      var payload = {};
      payload[ROSTER_LOCAL_KEY] = { ts: Date.now(), entries: entries };
      chrome.storage.local.set(payload);
    } catch (e) { /* storage full — non-critical */ }
  }

  function restoreRosterFromLocal() {
    if (Object.keys(ROSTER_CACHE).length > 0) return; // live roster present
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get(ROSTER_LOCAL_KEY, function(result) {
      var saved = result && result[ROSTER_LOCAL_KEY];
      if (!saved || !Array.isArray(saved.entries)) return;
      if (Date.now() - (saved.ts || 0) > ROSTER_LOCAL_MAX_AGE_MS) return;
      if (Object.keys(ROSTER_CACHE).length > 0) return; // roster appeared meanwhile
      saved.entries.forEach(function(m) {
        if (!m || !m.displayName) return;
        var idk = identityKey(m.recid, m.displayName);
        ROSTER_CACHE[idk] = {
          displayName: m.displayName, clubName: m.clubName || '',
          clubImageData: m.clubImageData || null, element: null,
          recid: m.recid || null, clubId: m.clubId || null
        };
        ROSTER_NAME_INDEX[nameKeyOf(m.displayName)] = idk;
      });
      console.log('[Awana] Restored ' + saved.entries.length + ' roster entries from local cache (offline mode)');
    });
  }

  function markPrinted(name, recid) {
    if (!name || !name.trim()) return;
    var key = resolveIdentityKey(name, recid);
    printedNames.add(key);
    try {
      dedupStore.setItem(REMOTE_PRINTED_KEY, JSON.stringify(Array.from(printedNames)));
      dedupStore.setItem(REMOTE_PRINTED_TS, String(Date.now()));
    } catch (e) { /* ignore quota errors */ }
  }

  function unmarkPrinted(name, recid) {
    if (!name || !name.trim()) return;
    printedNames.delete(resolveIdentityKey(name, recid));
    printedNames.delete('nm:' + nameKeyOf(name));
    try {
      dedupStore.setItem(REMOTE_PRINTED_KEY, JSON.stringify(Array.from(printedNames)));
    } catch (e) { /* ignore quota errors */ }
  }

  // TwoTimTwo's #lastCheckin line after an undo: the child's name and
  // "(checkin undone)" (docs/TWOTIMTWO.md §2.3), or the undo link's own word.
  // The word, never a substring: "undo" inside a NAME (Mundo, Dundon,
  // Fundora, Mundorf) read as an undo until 7.11.1, so those children never
  // got a label and, on the reconcile and phone paths, were marked printed
  // without one.
  function isUndo(text) {
    return !!text && /\bundo(ne)?\b/i.test(String(text));
  }

  // Step Up Night — the one Wednesday a year when kids whose age/grade puts
  // them in a different club next year get a "Stepping up to X" label.
  // Detection: scan the TwoTimTwo page for "step up" text (case-insensitive)
  // outside our own widget. The widget toggle ('auto' | 'on' | 'off') lets
  // the volunteer override either way.
  function scanCalendarFor(pattern) {
    var headings = document.querySelectorAll(
      'h1, h2, h3, h4, [class*="event"], [class*="club-night"], [class*="theme"], [class*="title"], [class*="header"], #event-name, #club-night'
    );
    for (var i = 0; i < headings.length; i++) {
      var el = headings[i];
      // #awana-widget is the id injectWidget() actually assigns — the old
      // '#awana-printer-widget' never matched anything, so our own panel text
      // was scanned as if it were page content.
      if (el.closest && el.closest('#awana-widget')) continue;
      if (el.id === 'awana-search-input') continue;
      if (!el.offsetParent && el.tagName !== 'TITLE') continue;
      var text = el.innerText || el.textContent || '';
      if (pattern.test(text)) return true;
    }
    return false;
  }

  function isStepUpNight() {
    if (stepUpMode === 'on')  return true;
    if (stepUpMode === 'off') return false;
    return scanCalendarFor(/step\s*up/i);
  }

  // Awana Store Night — kids spend their accumulated shares ("shekels") at
  // a small in-house store. On these nights the label gets a small 🪙 N
  // badge in the bottom-right icon strip, sourced from TwoTimTwo's own
  // share-balance report (one CSV per club, fetched with the volunteer's
  // logged-in session). The +1 reflects tonight's attendance share.
  function isAwanaStoreNight() {
    if (storeMode === 'on')  return true;
    if (storeMode === 'off') return false;
    return scanCalendarFor(/store/i);
  }

  // Share-balance cache. Populated by fetchShareBalances() when a Store
  // Night becomes active. byKey is normalized "first last" → integer.
  var SHARES = { byKey: {}, fetchedAt: 0, fetching: false, lastError: null };
  var SHARES_TTL_MS = 5 * 60 * 1000;
  // Shares club ids now live in CHURCH_CFG (server church-config.json).

  function normalizeName(name) {
    return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  // Tiny CSV parser — these files are simple, trusted, same-origin, two
  // columns ("Name","Balance"). Returns array of [name, balance] pairs,
  // skipping header. Bails on anything that doesn't look like CSV (e.g.
  // a login redirect HTML page).
  function parseShareCsv(text) {
    if (!text || /<\s*html/i.test(text.slice(0, 200))) return [];
    var lines = text.split(/\r?\n/);
    var out = [];
    for (var i = 1; i < lines.length; i++) {  // skip header
      var line = lines[i].trim();
      if (!line) continue;
      // Match "Name","Balance" — balance may be empty
      var m = line.match(/^"([^"]*)","([^"]*)"\s*$/);
      if (!m) continue;
      out.push([m[1], m[2]]);
    }
    return out;
  }

  function fetchShareBalances() {
    if (SHARES.fetching) return Promise.resolve();
    SHARES.fetching = true;
    var byKey = {};
    var origin = location.origin;  // e.g. https://kvbchurch.twotimtwo.com
    return Promise.all(CHURCH_CFG.sharesClubIds.map(function(id) {
      var url = origin + '/report/shekelBalance?club_id=' + id + '&output=csv';
      return fetch(url, { credentials: 'same-origin' })
        .then(function(r) { return r.ok ? r.text() : ''; })
        .then(function(txt) {
          parseShareCsv(txt).forEach(function(row) {
            var key = normalizeName(row[0]);
            if (!key) return;
            var bal = parseInt(row[1], 10);
            byKey[key] = isNaN(bal) ? 0 : bal;
          });
        })
        .catch(function(e) {
          console.warn('[Awana] Share balance fetch failed for club ' + id + ':', e.message);
        });
    })).then(function() {
      SHARES.byKey = byKey;
      SHARES.fetchedAt = Date.now();
      SHARES.lastError = null;
      var count = Object.keys(byKey).length;
      console.log('[Awana] Loaded share balances:', count, 'kids across', CHURCH_CFG.sharesClubIds.length, 'clubs');
      return byKey;
    }).catch(function(e) {
      SHARES.lastError = e.message;
      console.warn('[Awana] Share balance load failed:', e.message);
    }).then(function(v) {
      SHARES.fetching = false;
      return v;
    });
  }

  // Kicks off a refresh if cache is stale; returns whatever we have right
  // now without blocking. Returns null if the kid isn't in any CSV (per
  // user's "no badge for unknown kids" rule).
  function getShareBalance(firstName, lastName) {
    if (Date.now() - SHARES.fetchedAt > SHARES_TTL_MS) fetchShareBalances();
    var key = normalizeName(firstName + ' ' + lastName);
    return Object.prototype.hasOwnProperty.call(SHARES.byKey, key) ? SHARES.byKey[key] : null;
  }

  // ── Audio feedback ──────────────────────────────────────────────────────────
  var audioCtx = null;
  function playTone(freq, duration, type) {
    if (soundMuted) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      gain.gain.value = 0.15;
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + (duration || 0.2));
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + (duration || 0.2));
    } catch (e) { /* audio not available */ }
  }
  function playSuccess() { playTone(880, 0.12); setTimeout(function() { playTone(1108, 0.15); }, 120); }
  function playError() { playTone(330, 0.3, 'square'); }

  // ── Offline print queue ────────────────────────────────────────────────────
  function getQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch(e) { return []; }
  }
  function saveQueue(q) {
    if (q.length > 50) q.length = 50;
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
    updateQueueBadge();
  }
  function queuePrint(payload) {
    var q = getQueue();
    q.push(payload);
    saveQueue(q);
    // The label did NOT print, so "printed" is withdrawn. Every detection path
    // marks a child printed before doPrint, and flushQueue rightly drops a
    // queued item whose child is marked printed; with the mark left standing,
    // every label queued while the print server was down was dropped the
    // moment it came back, silently (7.11.1). Whichever print really goes
    // through marks the child again, and the queued copy is then the one
    // dropped.
    if (payload && payload.name) unmarkPrinted(payload.name, payload.clubberId);
    console.log('[Awana] Queued print for later (' + q.length + ' in queue)');
  }
  function flushQueue() {
    var q = getQueue();
    if (q.length === 0) return;
    console.log('[Awana] Flushing ' + q.length + ' queued print(s)');
    var item = q.shift();
    saveQueue(q);
    // Drop any queued item whose target was already printed in this session
    // (or carried over via sessionStorage). Without this, a queue persisted in
    // localStorage across a browser crash can replay a label that another path
    // (onCheckin / roster diff / Pusher) has already produced.
    var hasName = !!(item && item.name);
    var idKey = hasName ? resolveIdentityKey(item.name, item.clubberId) : null;
    if (idKey && printedNames.has(idKey)) {
      console.log('[Awana] Dropping queued print (already printed this session):', item.name);
      if (getQueue().length > 0) setTimeout(flushQueue, PRINT_COOLDOWN);
      return;
    }
    fetch(PRINT_SERVER + '/print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
      signal: AbortSignal.timeout(PRINT_TIMEOUT_MS)
    }).then(function(r) {
      if (r.ok) {
        if (idKey) markPrinted(item.name, item.clubberId);
        playSuccess();
        console.log('[Awana] Flushed queued print: ' + item.name);
        if (getQueue().length > 0) setTimeout(flushQueue, PRINT_COOLDOWN);
      } else {
        // Put it back
        var q2 = getQueue(); q2.unshift(item); saveQueue(q2);
      }
    }).catch(function() {
      var q2 = getQueue(); q2.unshift(item); saveQueue(q2);
    });
  }
  function updateQueueBadge() {
    var badge = document.getElementById('awana-queue-badge');
    var q = getQueue();
    if (badge) {
      badge.textContent = q.length > 0 ? q.length + ' queued' : '';
      badge.style.display = q.length > 0 ? 'block' : 'none';
    }
  }

  function applyCheckinOptions(modalContainer, options) {
    if (!options || !modalContainer) return;
    // Map panel option keys to regex patterns that match modal checkbox labels
    var optionPatterns = {
      'Bible':   /bible/i,
      'Friend':  /friend|brought/i
    };
    var allCheckboxes = modalContainer.querySelectorAll('input[type="checkbox"]');
    allCheckboxes.forEach(function(cb) {
      // Resolve label text: prefer wrapping <label>, then label[for=id], then adjacent text
      var labelText = '';
      var lbl = cb.closest('label');
      if (!lbl && cb.id) lbl = document.querySelector('label[for="' + cb.id + '"]');
      if (lbl) {
        labelText = lbl.textContent || '';
      } else if (cb.nextSibling) {
        labelText = (cb.nextSibling.textContent || cb.nextSibling.nodeValue || '');
      }
      Object.keys(options).forEach(function(key) {
        if (!options[key]) return;
        var pattern = optionPatterns[key];
        if (pattern && pattern.test(labelText) && !cb.checked) {
          cb.checked = true;
          cb.dispatchEvent(new Event('change', { bubbles: true }));
          cb.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }
      });
    });
  }

  // ── F-2: direct check-in API ─────────────────────────────────────────────
  // Mirrors TwoTimTwo's own POST /clubber/checkinclubber (docs/TWOTIMTWO.md
  // §2.2/§2.3) instead of clicking the .clubber row and polling for the
  // modal's button#checkin. Used by executePhoneAction / Quick Mode; each
  // falls back to the original click-and-poll dance whenever
  // the calendar id or CSRF token can't be found, or the POST doesn't verify —
  // a TwoTimTwo redesign must degrade check-in, never break it outright.
  function findCsrfToken() {
    // Yii 1.x injects one page-wide CSRF field (name fixed by the app's
    // csrfTokenName config — 'YII_CSRF_TOKEN' here, same name the login form
    // uses per docs/TWOTIMTWO.md §1) into any form it renders when CSRF
    // protection is on.
    var el = document.querySelector('input[name="YII_CSRF_TOKEN"]');
    return el && el.value ? el.value : null;
  }

  // Reads #checkinForm's own '.event' checkboxes (docs §2.2) and returns the
  // events[] values to submit: automatic="1" items (e.g. Attendance) always,
  // any explicit Bible/Friend `options` next, else whatever the DOM's live
  // checkbox state is. An event whose clubs="…" CSV doesn't include this
  // clubber's club_id is skipped entirely, even if its checkbox happens to be
  // checked — that CSV is what keeps a stale, previously-club's selection
  // from leaking into this child's submission.
  function collectApplicableEvents(clubId, options) {
    var out = [];
    var form = document.getElementById('checkinForm');
    if (!form) return out;
    var inputs = form.querySelectorAll('input.event[name="events[]"]');
    for (var i = 0; i < inputs.length; i++) {
      var input = inputs[i];
      var clubsAttr = (input.getAttribute('clubs') || '').split(',')
        .map(function(s) { return s.trim(); }).filter(Boolean);
      var appliesToClub = clubsAttr.length === 0 || (clubId != null && clubsAttr.indexOf(String(clubId)) !== -1);
      if (!appliesToClub) continue;
      var isAutomatic = input.getAttribute('automatic') === '1';
      var include = isAutomatic || input.checked;
      if (options) {
        var lbl = input.closest('label');
        if (!lbl && input.id) lbl = document.querySelector('label[for="' + input.id + '"]');
        var labelText = lbl ? (lbl.textContent || '') : (input.nextSibling ? (input.nextSibling.textContent || '') : '');
        if (/bible/i.test(labelText) && Object.prototype.hasOwnProperty.call(options, 'Bible')) include = options.Bible;
        if (/friend|brought/i.test(labelText) && Object.prototype.hasOwnProperty.call(options, 'Friend')) include = options.Friend;
      }
      if (include && input.value) out.push(input.value);
    }
    return out;
  }

  // Did TwoTimTwo record the check-in? Its answer to POST /clubber/checkinclubber
  // is the short #lastCheckin snippet naming the child (docs/TWOTIMTWO.md §2.3).
  // Until 7.11.0 the test was "the child's first name appears in the reply",
  // which a whole page passes too: a refused post, a signed-out session or a
  // redirect answered with the check-in page (every name on the roster) or
  // the login form, and the extension hid the row, printed the label and told
  // the phone the child was in (green) while TwoTimTwo had nothing. So: a
  // snippet, never a page, never the login form or the bare "Login Required"
  // the AJAX endpoints answer with when signed out, and it names the child.
  function checkinReplyOk(text, childName) {
    var CHECKIN_REPLY_MAX = 4000;   // a snippet; the check-in page itself is far larger
    var t = typeof text === 'string' ? text.trim() : '';
    if (!t || t.length > CHECKIN_REPLY_MAX) return false;
    if (/<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i.test(t)) return false;
    if (t === 'Login Required' || /name=["']LoginForm\[/.test(t) || /type=["']password["']/i.test(t)) return false;
    var first = (childName || '').trim().split(/\s+/)[0] || '';
    return !!first && t.toLowerCase().indexOf(first.toLowerCase()) !== -1;
  }

  // POSTs the real check-in directly. Resolves true only once the row has
  // actually vanished from the roster (the same success signal the
  // click-and-poll path uses) — a truthy HTTP response alone isn't trusted.
  function driveCheckinDirect(clubberId, childName, clubId, options) {
    if (!clubberId) return Promise.resolve(false);
    var calInput = document.getElementById('calendar_id');
    var calendarId = calInput && calInput.value;
    // No CSRF token on TwoTimTwo's check-in page (see postTouchCheckin): one is
    // sent only if a page has it. Requiring it sent every check-in to the modal.
    var csrfToken = findCsrfToken();
    if (!calendarId) return Promise.resolve(false);

    var body = 'clubber_id=' + encodeURIComponent(clubberId) +
      '&calendar_id=' + encodeURIComponent(calendarId);
    collectApplicableEvents(clubId, options).forEach(function(v) {
      body += '&events%5B%5D=' + encodeURIComponent(v);
    });
    if (csrfToken) body += '&YII_CSRF_TOKEN=' + encodeURIComponent(csrfToken);

    return fetch('/clubber/checkinclubber', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body,
      signal: AbortSignal.timeout(8000)
    }).then(function(r) {
      if (!r.ok) return false;
      return r.text();
    }).then(function(text) {
      if (!checkinReplyOk(text, childName)) return false;
      // Drop the row ourselves. TwoTimTwo removes a checked-in child's row from
      // its own AJAX success handler — which never runs here, because posting
      // directly is the whole point of this path. Without this the row stays
      // put forever, the caller's "did the row disappear?" verification always
      // times out, and it falls back to the click-and-poll dance — checking the
      // child in a SECOND time and double-crediting their events.
      // Marked the way TwoTimTwo's own handler marks it (hidden, .checked-in),
      // found by its id so a name with a stray space cannot miss it.
      var row = rowByRecid(clubberId) || findClubberElByName(childName);
      if (row) { row.classList.add('checked-in'); row.style.display = 'none'; }
      return true;
    }).catch(function() {
      return false;
    });
  }

  // Shared entry point for the three driven-check-in call sites. Resolves
  // true only when the direct POST both looked successful AND the row
  // disappeared within ~2s; false means "fall back to click-and-poll" —
  // never a rejection, so callers can always .then() it.
  function tryDirectCheckin(clubberId, childName, clubId, options) {
    if (CHURCH_CFG.enableDrivenCheckin === false) return Promise.resolve(false);
    // A fresh meeting id first (see ensureFreshCheckinTokens), then the post;
    // a refusal re-reads the page and posts once more, as the touch screen does.
    return ensureFreshCheckinTokens().then(function() {
      return driveCheckinDirect(clubberId, childName, clubId, options);
    }).then(function(posted) {
      if (posted) return true;
      console.log('[Awana] Direct check-in for ' + childName + ' was not confirmed; refreshing the page tokens and trying once more');
      return refreshCheckinTokens().then(function() { return driveCheckinDirect(clubberId, childName, clubId, options); });
    }).then(function(posted) {
      if (!posted) return false;
      return new Promise(function(resolve) {
        var attempts = 0;
        (function poll() {
          if (!findClubberElByName(childName)) { resolve(true); return; }
          if (++attempts >= 20) { resolve(false); return; } // didn't verify — caller falls back
          setTimeout(poll, 100);
        })();
      });
    });
  }

  // After clicking the modal's check-in button, wait for the kid's row to
  // disappear from the .clubber roster — that's the only signal that
  // TwoTimTwo actually accepted the check-in. If the row is still there
  // after the verify window, re-click the row once before giving up. This
  // protects against modal races where the click landed but TwoTimTwo
  // dismissed the modal without recording the check-in.
  function verifyBatchCheckin(sib, options, pollAttempt, retriesLeft) {
    if (!findClubberElByName(sib.name)) return;
    if (pollAttempt < 20) { // up to 2 s for TwoTimTwo to update the DOM
      setTimeout(function() {
        verifyBatchCheckin(sib, options, pollAttempt + 1, retriesLeft);
      }, 100);
      return;
    }
    if (retriesLeft > 0) {
      console.log('[Awana] Batch: ' + sib.name + ' did not check in after click — retrying (' + retriesLeft + ' left)');
      var freshEl = findClubberElByName(sib.name);
      if (freshEl) {
        freshEl.click();
        setTimeout(function() {
          pollForCheckinButton(sib, options, 30, retriesLeft - 1);
        }, 200);
        return;
      }
      // Race: row vanished between attempts → success
      return;
    }
    console.log('[Awana] Batch: ' + sib.name + ' could not be verified as checked in (retries exhausted)');
    recordUnverified(sib.name,
      (sib.element && sib.element.getAttribute) ? sib.element.getAttribute('recid') : null,
      sib.clubName || '');
  }

  function pollForCheckinButton(sib, options, attempts, retriesLeft) {
    // Retry budget is 2 (operator's pick for #2) — was 1 since v3.0.4.
    if (typeof retriesLeft !== 'number') retriesLeft = 2;
    if (attempts <= 0) {
      // Modal never opened — click the row again before giving up
      if (retriesLeft > 0) {
        console.log('[Awana] Modal never opened for ' + sib.name + ' — re-clicking row');
        var freshEl = findClubberElByName(sib.name);
        if (freshEl) {
          freshEl.click();
          setTimeout(function() {
            pollForCheckinButton(sib, options, 30, retriesLeft - 1);
          }, 200);
          return;
        }
      }
      console.log('[Awana] Timed out waiting for check-in button for ' + sib.name);
      recordUnverified(sib.name,
        (sib.element && sib.element.getAttribute) ? sib.element.getAttribute('recid') : null,
        sib.clubName || '');
      return;
    }
    var checkinBtn = null;

    // Strategy 1: TwoTimTwo-specific — button#checkin inside a visible #checkin-modal
    // Bug 1 fix: use getComputedStyle().display instead of offsetParent.
    // The modal is position:fixed, so offsetParent is ALWAYS null even when fully visible.
    var ttModal = document.getElementById('checkin-modal');
    if (ttModal && window.getComputedStyle(ttModal).display !== 'none') {
      checkinBtn = ttModal.querySelector('button#checkin');
    }

    // Strategy 2: explicit TwoTimTwo-style selectors
    if (!checkinBtn) {
      checkinBtn = document.querySelector('.checkin-btn, button[data-action="checkin"]');
    }

    // Strategy 3: any visible button with check-in text in document
    if (!checkinBtn) {
      var allBtns = document.querySelectorAll('button, [role="button"]');
      for (var i = 0; i < allBtns.length; i++) {
        var btn = allBtns[i];
        if (!btn.offsetParent) continue;
        var txt = btn.textContent.toLowerCase().trim();
        if (txt === 'checkin' || txt === 'check in' || txt === 'check-in') {
          checkinBtn = btn;
          break;
        }
      }
    }

    // Strategy 4: modal-scoped fallback — use #checkin-modal directly to avoid
    // accidentally matching buttons in other Bootstrap modals (like #page-info-window)
    if (!checkinBtn) {
      var modalBtns = document.querySelectorAll('#checkin-modal button, .dialog button, [role="dialog"] button');
      for (var i = 0; i < modalBtns.length; i++) {
        if (!modalBtns[i].offsetParent) continue;
        var txt = modalBtns[i].textContent.toLowerCase().trim();
        if (txt === 'checkin' || txt === 'check in' || txt === 'check-in') {
          checkinBtn = modalBtns[i];
          break;
        }
      }
    }

    if (checkinBtn && checkinBtn.offsetParent !== null) {
      console.log('[Awana] Found check-in button, applying options and clicking for ' + sib.name);

      // Bug 2 fix: use #checkin-modal directly instead of .closest('[class*="modal"]'),
      // which incorrectly matches .modal-footer (an ancestor with "modal" in its class name),
      // resulting in 0 checkboxes found and options never being applied.
      var modalContainer = document.getElementById('checkin-modal') || checkinBtn.parentElement;
      applyCheckinOptions(modalContainer, options);

      // Bug 3 fix: only call .click() once — the dispatchEvent was causing a double-submission
      checkinBtn.click();

      // Verify the click actually checked the kid in (row disappears)
      // before giving up. Retry once on failure.
      verifyBatchCheckin(sib, options, 0, retriesLeft);
    } else {
      setTimeout(function() {
        pollForCheckinButton(sib, options, attempts - 1, retriesLeft);
      }, 100);
    }
  }

  function getClubImageDataUrl(img) {
    try {
      if (!img || !img.src || !img.complete || img.naturalWidth === 0) {
        return null;
      }
      // Capture at up to 320px, never above the image's own resolution.
      // The print server draws this into a ~317px icon zone on a 300 DPI
      // label, so the old fixed 64×64 capture forced a 5× upscale at print
      // time — the logos came out blurry and speckled on thermal output.
      const _side = Math.min(320, Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = _side;
      const _ctx = canvas.getContext('2d');
      _ctx.imageSmoothingEnabled = true;
      _ctx.imageSmoothingQuality = 'high';
      const _aspect = img.naturalWidth / img.naturalHeight;
      let _dw, _dh, _ox = 0, _oy = 0;
      if (_aspect > 1) { _dw = _side; _dh = _side / _aspect; _oy = (_side - _dh) / 2; }
      else             { _dh = _side; _dw = _side * _aspect; _ox = (_side - _dw) / 2; }
      _ctx.drawImage(img, _ox, _oy, _dw, _dh);
      return canvas.toDataURL('image/png');
    } catch (e) {
      return img.src || null;
    }
  }

  function injectWidget() {
    // Default to minimized so the widget never obstructs the page on first load.
    // Only stay expanded if the user explicitly expanded it (stored 'false').
    var isMinimized = localStorage.getItem(MINIMIZE_KEY) !== 'false';

    // Shared building blocks so every section of the panel looks the same.
    function sectionLabel(text) {
      var el = document.createElement('div');
      Object.assign(el.style, {
        fontFamily: "'Londrina Solid', 'Arial Narrow', system-ui, sans-serif",
        fontSize: '12px', color: '#94a3b8', fontWeight: '400',
        textTransform: 'uppercase', letterSpacing: '0.06em'
      });
      el.textContent = text;
      return el;
    }
    function divider() {
      var el = document.createElement('div');
      Object.assign(el.style, { height: '1px', background: '#e2e8f0', margin: '2px 0' });
      return el;
    }

    // ── Outer container ──
    const widget = document.createElement('div');
    widget.id = 'awana-widget';
    Object.assign(widget.style, {
      fontFamily: "'Figtree', system-ui, -apple-system, sans-serif",
      fontSize: '13px',
      transition: 'all 0.2s ease'
    });

    // ── Collapsed state: small branded pill ──
    const pill = document.createElement('div');
    pill.id = 'awana-pill';
    Object.assign(pill.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '6px 12px',
      background: '#4caf50',
      color: '#ffffff',
      borderRadius: '20px',
      cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(76,175,80,0.3)',
      fontSize: '12px',
      fontWeight: '600',
      userSelect: 'none',
      whiteSpace: 'nowrap',
      transition: 'all 0.15s ease'
    });
    pill.innerHTML = '<span style="font-size:14px">&#x1F5A8;</span> Club Print';
    pill.title = 'Expand print controls';
    pill.addEventListener('mouseenter', function() { pill.style.background = '#43a047'; });
    pill.addEventListener('mouseleave', function() { pill.style.background = '#4caf50'; });

    // Where the widget sits, in one place. The panel's max-height is derived
    // from these, so the "how far down the page" and "how tall may it be"
    // numbers can never drift apart.
    const PANEL_TOP = 55;   // clears TwoTimTwo's two nav bars
    const PANEL_GAP = 12;   // breathing room at the bottom edge
    // TwoTimTwo's search magnifier sits in the top-right corner and the pill
    // covered it, so the widget is pulled in by about an inch (96 CSS px).
    const PANEL_RIGHT = PANEL_GAP + 96;

    // ── Expanded state: full panel ──
    const panel = document.createElement('div');
    panel.id = 'awana-panel';
    // A COLUMN BOUNDED BY THE VIEWPORT, not a box that grows without limit.
    //
    // This used to be `overflow: hidden` with no height cap, on a widget fixed at
    // top:55px with nothing constraining it either. So the moment the panel grew
    // taller than the screen — which is exactly what ticking "Also register in
    // TwoTimTwo" does, revealing four more controls — the overflow was CLIPPED
    // with no scrollbar. On a laptop at the check-in table the Print button and
    // the registration fields simply became unreachable, mid-check-in, with no
    // way to get at them.
    //
    // Now: the header stays pinned, the body scrolls, and the whole thing can
    // never exceed the space between the site's nav bar and the bottom of the
    // window.
    Object.assign(panel.style, {
      background: '#ffffff',
      border: '1px solid #c8e6c9',
      borderRadius: '8px',
      boxShadow: '0 6px 20px rgba(15, 23, 42, 0.12)',
      overflow: 'hidden',
      minWidth: '260px',
      width: '320px',
      maxWidth: 'calc(100vw - 24px)',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',   // positioning context for the "more below" fade
      // Cannot outgrow the viewport: PANEL_TOP is where the widget is pinned,
      // plus a matching gap at the bottom so it never kisses the taskbar.
      maxHeight: 'calc(100vh - ' + (PANEL_TOP + PANEL_GAP) + 'px)'
    });

    // Panel header (purple bar with title + close X)
    const panelHeader = document.createElement('div');
    Object.assign(panelHeader.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '8px 12px',
      background: '#4caf50',
      color: '#ffffff',
      // Never squeezed by a long body — the close button must always be
      // reachable, which is the escape hatch when anything else goes wrong.
      flex: '0 0 auto'
    });

    const headerLeft = document.createElement('div');
    Object.assign(headerLeft.style, { display: 'flex', alignItems: 'center', gap: '6px' });
    headerLeft.innerHTML = '<span style="font-size:14px">&#x1F5A8;</span>' +
      '<span style="font-weight:700;font-size:13px">Club Print</span>' +
      '<span style="font-size:10px;opacity:0.7">v' + EXTENSION_VERSION + '</span>';

    const closeBtn = document.createElement('button');
    Object.assign(closeBtn.style, {
      background: 'rgba(255,255,255,0.2)',
      border: 'none',
      color: '#ffffff',
      width: '22px',
      height: '22px',
      borderRadius: '50%',
      cursor: 'pointer',
      fontSize: '14px',
      lineHeight: '22px',
      textAlign: 'center',
      padding: '0',
      transition: 'background 0.15s ease'
    });
    closeBtn.innerHTML = '&#x2715;';
    closeBtn.title = 'Minimize';
    closeBtn.addEventListener('mouseenter', function() { closeBtn.style.background = 'rgba(0,0,0,0.15)'; });
    closeBtn.addEventListener('mouseleave', function() { closeBtn.style.background = 'rgba(255,255,255,0.2)'; });

    panelHeader.append(headerLeft, closeBtn);

    // Panel body
    const panelBody = document.createElement('div');
    panelBody.id = 'awana-panel-body';
    Object.assign(panelBody.style, {
      padding: '10px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      // THE FIX: this is the scroll container. flex:1 1 auto lets it take the
      // remaining height under the pinned header and no more.
      flex: '1 1 auto',
      overflowY: 'auto',
      overflowX: 'hidden',
      overscrollBehavior: 'contain',  // scrolling to the end must not scroll the page behind
      scrollbarGutter: 'stable'       // no content jump when the scrollbar appears
    });

    // Controls row
    const controls = document.createElement('div');
    Object.assign(controls.style, { display: 'flex', alignItems: 'center', gap: '8px' });

    const modeSelect = document.createElement('select');
    modeSelect.id = 'awana-mode-select';
    Object.assign(modeSelect.style, {
      flex: '1',
      padding: '5px 8px',
      borderRadius: '6px',
      border: '1px solid #e2e8f0',
      cursor: 'pointer',
      fontSize: '12px',
      background: '#f8fafc'
    });

    var modes = [
      ['auto', 'Auto-Print'],
      ['dialog', 'Print Dialog'],
      ['off', 'Off']
    ];
    modes.forEach(function(pair) {
      var value = pair[0], label = pair[1];
      var option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      modeSelect.appendChild(option);
    });
    modeSelect.value = selectedMode;
    modeSelect.addEventListener('change', function() {
      selectedMode = modeSelect.value;
      localStorage.setItem(STORAGE_KEY, selectedMode);
      console.log('[Awana] Mode changed to:', selectedMode);
    });

    const statusEl = document.createElement('span');
    statusEl.id = 'awana-status';
    statusEl.style.fontSize = '16px';
    statusEl.style.minWidth = '20px';
    statusEl.style.textAlign = 'center';

    const testBtn = document.createElement('button');
    testBtn.textContent = 'Test';
    Object.assign(testBtn.style, {
      fontSize: '11px',
      padding: '5px 10px',
      background: '#f1f5f9',
      border: '1px solid #e2e8f0',
      borderRadius: '6px',
      cursor: 'pointer',
      fontWeight: '600',
      color: '#475569',
      transition: 'background 0.15s ease'
    });
    testBtn.addEventListener('mouseenter', function() { testBtn.style.background = '#e2e8f0'; });
    testBtn.addEventListener('mouseleave', function() { testBtn.style.background = '#f1f5f9'; });
    testBtn.addEventListener('click', function() {
      console.log('[Awana] Test button clicked');
      doPrint('Test Child', 'Sparks', null);
    });

    // Night-systems canary: exercises the whole pipeline — server → TEST
    // label print → Pusher canary event — plus this page's selectors.
    var nightTestBtn = document.createElement('button');
    nightTestBtn.textContent = 'Night Test';
    Object.assign(nightTestBtn.style, {
      fontSize: '11px', padding: '5px 10px',
      background: '#eef2ff', border: '1px solid #c7d2fe',
      borderRadius: '6px', cursor: 'pointer',
      fontWeight: '600', color: '#4338ca',
      transition: 'background 0.15s ease'
    });
    nightTestBtn.addEventListener('mouseenter', function() { nightTestBtn.style.background = '#e0e7ff'; });
    nightTestBtn.addEventListener('mouseleave', function() { nightTestBtn.style.background = '#eef2ff'; });
    nightTestBtn.addEventListener('click', function() {
      nightTestBtn.disabled = true;
      nightTestBtn.textContent = 'Testing...';
      var selectorsOk = runSelectorSelfTest();
      fetch(PRINT_SERVER + '/canary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printerName: selectedPrinterName || undefined }),
        signal: AbortSignal.timeout(45000)
      })
        .then(function(r) { return r.json(); })
        .then(function(res) {
          var lines = (res.stages || []).map(function(s) {
            return (s.passed ? '✅' : '❌') + ' ' + s.stage + (s.detail ? ' — ' + s.detail : '');
          });
          lines.unshift((selectorsOk ? '✅' : '❌') + ' page selectors');
          alert('Night systems test:\n\n' + lines.join('\n'));
        })
        .catch(function() {
          alert('Night systems test:\n\n' + (selectorsOk ? '✅' : '❌') + ' page selectors\n❌ server — could not reach the print server');
        })
        .finally(function() {
          nightTestBtn.disabled = false;
          nightTestBtn.textContent = 'Night Test';
        });
    });

    controls.append(modeSelect, statusEl);
    var testsRow = document.createElement('div');
    Object.assign(testsRow.style, { display: 'flex', gap: '6px', flexWrap: 'wrap' });
    testsRow.append(testBtn, nightTestBtn);

    // Printer row
    var printerRow = document.createElement('div');
    Object.assign(printerRow.style, { display: 'flex', flexDirection: 'column', gap: '2px' });

    var printerLabel = sectionLabel('Printing to');

    // Read-only: the printer is set on the print dashboard, and only there.
    var printingTo = document.createElement('div');
    printingTo.id = 'awana-printing-to';
    Object.assign(printingTo.style, {
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px',
      fontSize: '12px', color: '#334155'
    });
    var printingToName = document.createElement('span');
    printingToName.id = 'awana-printing-to-name';
    printingToName.textContent = 'Checking...';
    var printingToChange = document.createElement('a');
    printingToChange.href = PRINT_SERVER + '/#settings';
    printingToChange.target = '_blank';
    printingToChange.rel = 'noopener';
    printingToChange.textContent = 'Change';
    Object.assign(printingToChange.style, { fontSize: '11px', color: '#2563eb', whiteSpace: 'nowrap' });
    // Green when the print server answers, red when it doesn't.
    var printingToDot = document.createElement('span');
    printingToDot.id = 'awana-printing-to-dot';
    Object.assign(printingToDot.style, {
      width: '8px', height: '8px', borderRadius: '50%', background: '#cbd5e1',
      flex: '0 0 auto', alignSelf: 'center'
    });
    printingToName.style.flex = '1';
    printingToName.style.overflow = 'hidden';
    printingToName.style.textOverflow = 'ellipsis';
    printingToName.style.whiteSpace = 'nowrap';
    printingTo.append(printingToDot, printingToName, printingToChange);
    printerRow.append(printerLabel, printingTo);

    // Status rows
    var csvStatus = document.createElement('div');
    csvStatus.id = 'awana-csv-status';
    Object.assign(csvStatus.style, {
      fontSize: '11px',
      color: '#94a3b8',
      whiteSpace: 'nowrap',
      padding: '2px 0'
    });
    csvStatus.textContent = 'Syncing roster...';

    // ── Privacy status ────────────────────────────────────────────────────────
    // Whether children's first names leave the print PC encrypted. Fed by the
    // /health poll below.
    //
    // This row shows STATE ONLY, never the key itself. This panel is injected
    // into a page served by twotimtwo.com, so anything rendered here is
    // readable by that site's scripts — which is also why the server redacts
    // displayKey for every non-loopback caller. The key is typed on the
    // dashboard, at loopback, and nowhere else.
    var privacyStatus = document.createElement('div');
    privacyStatus.id = 'awana-privacy-status';
    Object.assign(privacyStatus.style, {
      display: 'none',
      fontSize: '11px',
      padding: '5px 8px',
      borderRadius: '6px',
      lineHeight: '1.4'
    });

    var updateRow = document.createElement('div');
    updateRow.id = 'awana-update-notice';
    Object.assign(updateRow.style, {
      display: 'none',
      fontSize: '11px',
      color: '#f59e0b',
      fontWeight: 'bold',
      padding: '4px 8px',
      background: '#fffbeb',
      borderRadius: '6px',
      border: '1px solid #fde68a'
    });

    // Walk-in guest section
    var walkInLabel = sectionLabel('Walk-in Guest');

    var walkInRow = document.createElement('div');
    Object.assign(walkInRow.style, { display: 'flex', gap: '4px' });

    var guestInput = document.createElement('input');
    guestInput.type = 'text';
    guestInput.placeholder = 'First Last';
    Object.assign(guestInput.style, {
      flex: '1', padding: '5px 8px', borderRadius: '6px',
      border: '1px solid #e2e8f0', fontSize: '12px',
      background: '#f8fafc', color: '#1e293b', outline: 'none'
    });

    var walkInPrintBtn = document.createElement('button');
    walkInPrintBtn.textContent = 'Print';
    Object.assign(walkInPrintBtn.style, {
      fontSize: '11px', padding: '5px 10px',
      background: '#4caf50', color: '#ffffff',
      border: 'none', borderRadius: '6px',
      cursor: 'pointer', fontWeight: '600',
      transition: 'background 0.15s ease'
    });
    walkInPrintBtn.addEventListener('mouseenter', function() {
      walkInPrintBtn.style.background = walkInPrintBtn.dataset.awanaHover || '#43a047';
    });
    walkInPrintBtn.addEventListener('mouseleave', function() {
      walkInPrintBtn.style.background = walkInPrintBtn.dataset.awanaBase || '#4caf50';
    });

    // Club selector for walk-ins
    var walkInClubRow = document.createElement('div');
    Object.assign(walkInClubRow.style, { display: 'flex', gap: '4px', alignItems: 'center' });

    var clubSelect = document.createElement('select');
    Object.assign(clubSelect.style, {
      flex: '1', padding: '5px 8px', borderRadius: '6px',
      border: '1px solid #e2e8f0', fontSize: '11px',
      background: '#f8fafc', color: '#475569'
    });
    // The club list comes from the print server (GET /clubs), which is the one
    // place it is defined. Five hardcoded copies of this list used to drift —
    // this dropdown was the one that never got Journey, so a Journey walk-in
    // could only be printed under the wrong club or none at all. The baked
    // fallback below is only for a server that is not running yet; it is
    // replaced the moment /clubs answers.
    var CLUB_FALLBACK = ['Puggles', 'Cubbies', 'Sparks', 'T&T', 'Trek', 'Journey'];
    // The list the server last gave us, remembered so a family row added AFTER
    // /clubs answered is not stuck on the offline fallback (#323).
    var CLUB_LIST = CLUB_FALLBACK.slice();
    var CLUB_SELECTS = [clubSelect];
    function renderClubOptions(sel, clubs) {
      var keep = sel.value;
      sel.textContent = '';
      [''].concat(clubs).forEach(function(c) {
        var opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c === '' ? '(no club)' : c;
        sel.appendChild(opt);
      });
      if (keep) sel.value = keep;   // a mid-refresh fetch must not clear the operator's pick
    }
    function renderAllClubOptions(clubs) {
      CLUB_LIST = clubs.slice();
      CLUB_SELECTS.forEach(function(sel) { renderClubOptions(sel, CLUB_LIST); });
    }
    // A club dropdown for one family row, styled exactly like the main one.
    function makeClubSelect() {
      var sel = document.createElement('select');
      Object.assign(sel.style, {
        flex: '1', padding: '5px 8px', borderRadius: '6px',
        border: '1px solid #e2e8f0', fontSize: '11px',
        background: '#f8fafc', color: '#475569'
      });
      CLUB_SELECTS.push(sel);
      renderClubOptions(sel, CLUB_LIST);
      return sel;
    }
    renderClubOptions(clubSelect, CLUB_FALLBACK);
    fetch(PRINT_SERVER + '/clubs', { signal: AbortSignal.timeout(4000) })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(d) {
        if (d && Array.isArray(d.clubs) && d.clubs.length) renderAllClubOptions(d.clubs);
      })
      .catch(function() { /* offline: the fallback list stands */ });

    var visitorCheck = document.createElement('label');
    Object.assign(visitorCheck.style, {
      display: 'flex', alignItems: 'center', gap: '3px',
      fontSize: '11px', color: '#64748b', cursor: 'pointer', whiteSpace: 'nowrap'
    });
    var visitorCb = document.createElement('input');
    visitorCb.type = 'checkbox';
    visitorCheck.append(visitorCb);
    visitorCheck.append(document.createTextNode('Visitor'));

    // ── Leader tag from this same row ──────────────────────────────────────
    // An adult volunteer's tag, not a check-in: it never counts toward
    // tonight, never registers anyone in TwoTimTwo and never enters the
    // session dedup set.
    //
    // Sharing the guest row keeps the panel compact, but it means one
    // checkbox changes what Print DOES — so ticking it visibly retargets the
    // whole row (amber button, new caption, the two child-only controls
    // disabled) rather than leaving an identical-looking form that produces a
    // different label.
    var leaderCheck = document.createElement('label');
    Object.assign(leaderCheck.style, {
      display: 'flex', alignItems: 'center', gap: '3px',
      fontSize: '11px', color: '#64748b', cursor: 'pointer', whiteSpace: 'nowrap'
    });
    var leaderCb = document.createElement('input');
    leaderCb.type = 'checkbox';
    leaderCheck.append(leaderCb);
    leaderCheck.append(document.createTextNode('Leader'));

    // ── Custom label from the same row ─────────────────────────────────────
    // "VOLUNTEER", "KITCHEN", "Room 4 Helper": one line of free text on a
    // blank label. It names nobody, so it is even further from a check-in
    // than a leader tag is — nothing is counted, nothing is recorded, nothing
    // is registered. Mutually exclusive with Leader: one row cannot print two
    // different kinds of label at once.
    var customCheck = document.createElement('label');
    Object.assign(customCheck.style, {
      display: 'flex', alignItems: 'center', gap: '3px',
      fontSize: '11px', color: '#64748b', cursor: 'pointer', whiteSpace: 'nowrap'
    });
    var customCb = document.createElement('input');
    customCb.type = 'checkbox';
    customCheck.append(customCb);
    customCheck.append(document.createTextNode('Custom'));

    walkInClubRow.append(clubSelect, visitorCheck, leaderCheck, customCheck);

    // Custom mode's own feedback line. The leader branch borrows the chips'
    // status line and the family branch borrows familyStatus, but familyWrap
    // is HIDDEN in custom mode, so a custom label needs a line of its own or
    // its only feedback is the transient status glyph.
    var customStatus = document.createElement('div');
    customStatus.id = 'awana-custom-status';
    Object.assign(customStatus.style, { display: 'none', fontSize: '10px', color: '#94a3b8' });
    function setCustomStatus(text, color) {
      customStatus.textContent = text;
      customStatus.style.color = color || '#94a3b8';
      customStatus.style.display = text ? 'block' : 'none';
    }

    // ── "Did you mean…?" for the walk-in row ───────────────────────────────
    // An inline question with two explicit answers, shown when the typed name
    // is one this extension already knows (a roster child, or a remembered
    // leader). Built as real buttons rather than a confirm(): a confirm()
    // blocks the page a check-in station is driving, and its two answers are
    // OK and Cancel, neither of which is what either question is asking.
    var walkInChoice = document.createElement('div');
    walkInChoice.id = 'awana-walkin-choice';
    Object.assign(walkInChoice.style, {
      display: 'none', flexDirection: 'column', gap: '6px',
      fontSize: '11px', color: '#7c2d12', lineHeight: '1.4',
      padding: '8px', background: '#fffbeb',
      border: '1px solid #fde68a', borderRadius: '8px'
    });
    function hideWalkInChoice() {
      walkInChoice.style.display = 'none';
      walkInChoice.textContent = '';
    }
    function showWalkInChoice(message, buttons) {
      walkInChoice.textContent = '';
      var line = document.createElement('div');
      // textContent, never innerHTML: this string carries a child's name off
      // the roster, which is operator/site data and never markup.
      line.textContent = message;
      walkInChoice.appendChild(line);
      var row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', gap: '6px', flexWrap: 'wrap' });
      buttons.forEach(function(b) {
        var btn = document.createElement('button');
        btn.textContent = b.label;
        Object.assign(btn.style, {
          fontSize: '11px', padding: '5px 10px', border: 'none', borderRadius: '6px',
          cursor: 'pointer', fontWeight: '600', color: '#ffffff',
          background: b.background || '#475569'
        });
        btn.addEventListener('click', function() { hideWalkInChoice(); b.run(); });
        row.appendChild(btn);
      });
      walkInChoice.appendChild(row);
      walkInChoice.style.display = 'flex';
    }

    // Pure, so both questions are unit-tested without a page: given the typed
    // name, whatever the roster index resolved it to, and the remembered
    // leaders the panel already loaded, say which question (if any) to ask.
    //
    // The roster takes precedence when a name is somehow both. An uncounted or
    // double-counted CHILD is the failure this exists to stop, and a volunteer
    // who shares a clubber's full name is far rarer than a clubber typed into
    // the guest box by mistake.
    function walkInNameConflict(name, rosterEntry, leaders) {
      var key = nameKeyOf(name);
      if (!key) return null;
      if (rosterEntry && rosterEntry.displayName && nameKeyOf(rosterEntry.displayName) === key) {
        return { kind: 'roster', roster: rosterEntry };
      }
      var list = leaders || [];
      for (var i = 0; i < list.length; i++) {
        var l = list[i];
        if (!l) continue;
        if (nameKeyOf(((l.firstName || '') + ' ' + (l.lastName || ''))) === key) {
          return { kind: 'leader', leader: l };
        }
      }
      return null;
    }

    function isLeaderMode() { return leaderCb.checked; }
    function isCustomMode() { return customCb.checked; }

    // One checkbox changes what Print DOES, so ticking either visibly
    // retargets the whole row (new button colour and caption, new section
    // title, the controls that no longer apply disabled) rather than leaving
    // an identical-looking form that produces a different label.
    function applyRowMode() {
      var custom = isCustomMode();
      var leader = isLeaderMode();
      // Everything a child's walk-in needs is meaningless in BOTH of the other
      // two modes; the club is meaningless only for a custom label (a leader
      // tag prints "<Club> Leader").
      var notAChild = custom || leader;

      walkInPrintBtn.textContent = custom ? 'Print Custom Label' : (leader ? 'Print Leader Tag' : 'Print');
      var base = custom ? '#0ea5e9' : (leader ? '#f59e0b' : '#4caf50');
      var hover = custom ? '#0284c7' : (leader ? '#d97706' : '#43a047');
      walkInPrintBtn.style.background = base;
      walkInPrintBtn.dataset.awanaBase = base;
      walkInPrintBtn.dataset.awanaHover = hover;
      guestInput.placeholder = custom ? 'Label text' : (leader ? "Leader's name" : 'First Last');
      guestInput.maxLength = custom ? 60 : 160;
      walkInLabel.textContent = custom ? 'Custom Label' : (leader ? 'Leader Name Tag' : 'Walk-in Guest');

      // Neither an adult leader nor a strip of text is a visiting child, and
      // neither is registered as a clubber.
      visitorCb.disabled = notAChild;
      registerCb.disabled = notAChild;
      clubSelect.disabled = custom;
      visitorCheck.style.opacity = notAChild ? '0.4' : '1';
      registerCheck.style.opacity = notAChild ? '0.4' : '1';
      clubSelect.style.opacity = custom ? '0.4' : '1';
      if (notAChild) {
        visitorCb.checked = false;
        registerCb.checked = false;
        registerFields.style.display = 'none';
      }
      leaderCheck.style.color = leader ? '#b45309' : '#64748b';
      leaderCheck.style.fontWeight = leader ? '700' : 'normal';
      customCheck.style.color = custom ? '#0369a1' : '#64748b';
      customCheck.style.fontWeight = custom ? '700' : 'normal';
      // One adult, or one strip of text — either way the family rows (#323)
      // are meaningless: hidden AND cleared, so a leftover row cannot print a
      // child label out of a mode that has nothing to do with children.
      familyWrap.style.display = notAChild ? 'none' : 'flex';
      if (notAChild) clearFamilyRows();
      hideWalkInChoice();   // the question was about a child; this row is not one now
      syncFamilyUi();
    }
    leaderCb.addEventListener('change', function() {
      if (leaderCb.checked) customCb.checked = false;
      applyRowMode();
    });
    customCb.addEventListener('change', function() {
      if (customCb.checked) leaderCb.checked = false;
      applyRowMode();
    });

    // \u2500\u2500 F-3: optional "also register in TwoTimTwo" \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    // The label print above always happens regardless of this checkbox \u2014 a
    // child at the door gets a label whether or not TwoTimTwo registration
    // succeeds. This just additionally submits the real registration form
    // (docs/TWOTIMTWO.md \u00A74) so the walk-in leaves a TwoTimTwo record too.
    var registerCheck = document.createElement('label');
    Object.assign(registerCheck.style, {
      display: 'flex', alignItems: 'center', gap: '4px',
      fontSize: '11px', color: '#64748b', cursor: 'pointer'
    });
    var registerCb = document.createElement('input');
    registerCb.type = 'checkbox';
    registerCheck.append(registerCb, document.createTextNode('Also register in TwoTimTwo'));

    var registerFields = document.createElement('div');
    registerFields.id = 'awana-register-fields';
    Object.assign(registerFields.style, {
      display: 'none', flexDirection: 'column', gap: '6px',
      padding: '10px', background: '#f8fafc', borderRadius: '8px',
      border: '1px solid #e2e8f0'
    });

    // Says what the four boxes are for and that all of them are needed. The
    // register call refuses without every field, and previously said so only
    // AFTER the operator pressed Print — at the door, with a child waiting.
    var registerHint = document.createElement('div');
    registerHint.textContent = 'All four are required by TwoTimTwo';
    Object.assign(registerHint.style, {
      fontSize: '10px', color: '#94a3b8', fontWeight: '600',
      letterSpacing: '0.02em', marginBottom: '1px'
    });

    function regFieldInput(placeholder, type) {
      var inp = document.createElement('input');
      inp.type = type || 'text';
      inp.placeholder = placeholder;
      Object.assign(inp.style, {
        padding: '5px 8px', borderRadius: '6px', border: '1px solid #e2e8f0',
        fontSize: '11px', background: '#fff', color: '#1e293b', outline: 'none'
      });
      return inp;
    }
    var guardianInput  = regFieldInput('Guardian name');
    var phoneInput     = regFieldInput('Guardian phone', 'tel');
    var birthdateInput = regFieldInput('Birthdate', 'date');

    // Factored out so each extra family row (#323) gets its own identical
    // control — TwoTimTwo requires gender, grade AND birthdate per child.
    function makeGenderSelect() {
      var sel = document.createElement('select');
      Object.assign(sel.style, {
        flex: '1', padding: '5px 8px', borderRadius: '6px',
        border: '1px solid #e2e8f0', fontSize: '11px', background: '#fff', color: '#1e293b'
      });
      [['M', 'Boy'], ['F', 'Girl']].forEach(function(pair) {
        var o = document.createElement('option');
        o.value = pair[0]; o.textContent = pair[1];
        sel.appendChild(o);
      });
      return sel;
    }
    var genderSelect = makeGenderSelect();

    // grade_id \u2192 club mapping from the real registration form (docs \u00A74).
    var GRADE_OPTIONS = [
      { id: 17, label: 'Age 2 (Puggles)' },
      { id: 3,  label: 'Preschool 1yr before K (Cubbies)' },
      { id: 22, label: 'Preschool 2yr before K (Cubbies)' },
      { id: 4,  label: 'K (Sparks)' },
      { id: 5,  label: 'Gr 1 (Sparks)' },
      { id: 6,  label: 'Gr 2 (Sparks)' },
      { id: 7,  label: 'Gr 3 (T&T)' },
      { id: 8,  label: 'Gr 4 (T&T)' },
      { id: 9,  label: 'Gr 5 (T&T)' },
      { id: 18, label: 'Gr 6 (Trek)' },
      { id: 19, label: 'Gr 7 (Trek)' },
      { id: 20, label: 'Gr 8 (Trek)' },
      { id: 21, label: 'Gr 9 (Journey)' },
      { id: 23, label: 'Gr 10 (Journey)' }
    ];
    function makeGradeSelect() {
      var sel = document.createElement('select');
      Object.assign(sel.style, {
        flex: '1', padding: '5px 8px', borderRadius: '6px',
        border: '1px solid #e2e8f0', fontSize: '11px', background: '#fff', color: '#1e293b'
      });
      var placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Grade\u2026';
      placeholder.disabled = true;
      placeholder.selected = true;
      sel.appendChild(placeholder);
      GRADE_OPTIONS.forEach(function(g) {
        var o = document.createElement('option');
        o.value = String(g.id); o.textContent = g.label;
        sel.appendChild(o);
      });
      return sel;
    }
    var gradeSelect = makeGradeSelect();

    var genderGradeRow = document.createElement('div');
    Object.assign(genderGradeRow.style, { display: 'flex', gap: '4px' });
    genderGradeRow.append(genderSelect, gradeSelect);

    var registerStatus = document.createElement('div');
    registerStatus.id = 'awana-register-status';
    Object.assign(registerStatus.style, { fontSize: '10px', color: '#94a3b8' });

    registerFields.append(registerHint, guardianInput, phoneInput, birthdateInput, genderGradeRow, registerStatus);

    // ── A whole visiting family in one submission (#323) ──────────────────
    // A visiting mother with three children used to mean typing the same
    // surname, club and guardian details three times while a line formed
    // behind her. "+ Add another child" adds a row with its own first name and
    // club (and, when registering, its own birthdate/gender/grade, all three of
    // which TwoTimTwo requires per child); the surname, guardian and phone come
    // from the row above. Each child is still printed by its OWN sequential
    // POST /print — no batch endpoint — and only the first prints the family's
    // connect card.
    var familyWrap = document.createElement('div');
    Object.assign(familyWrap.style, { display: 'flex', flexDirection: 'column', gap: '4px' });

    var addChildBtn = document.createElement('button');
    addChildBtn.type = 'button';
    addChildBtn.textContent = '+ Add another child';
    addChildBtn.title = 'Print labels for a whole visiting family — one connect card';
    Object.assign(addChildBtn.style, {
      fontSize: '11px', padding: '4px 8px', background: '#f1f5f9', color: '#475569',
      border: '1px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer', fontWeight: '600'
    });

    var familyRows = document.createElement('div');
    Object.assign(familyRows.style, { display: 'flex', flexDirection: 'column', gap: '4px' });

    var familyStatus = document.createElement('div');
    familyStatus.id = 'awana-family-status';
    Object.assign(familyStatus.style, { fontSize: '10px', color: '#94a3b8' });

    familyWrap.append(addChildBtn, familyRows, familyStatus);

    var familyRowData = [];

    function syncFamilyUi() {
      var full = familyRowData.length >= MAX_GUEST_FAMILY - 1;
      addChildBtn.disabled = isLeaderMode() || isCustomMode() || full;
      addChildBtn.style.opacity = addChildBtn.disabled ? '0.5' : '1';
      addChildBtn.textContent = full
        ? ('Family full (' + MAX_GUEST_FAMILY + ' children)')
        : '+ Add another child';
      familyRowData.forEach(function(r) {
        r.regRow.style.display = registerCb.checked ? 'flex' : 'none';
      });
    }

    function removeFamilyRow(entry) {
      var i = familyRowData.indexOf(entry);
      if (i === -1) return;
      familyRowData.splice(i, 1);
      var ci = CLUB_SELECTS.indexOf(entry.clubSel);
      if (ci > 0) CLUB_SELECTS.splice(ci, 1);   // index 0 is the main dropdown
      if (entry.el.parentNode) entry.el.parentNode.removeChild(entry.el);
      syncFamilyUi();
      updateScrollFade();
    }

    function addFamilyRow() {
      if (familyRowData.length >= MAX_GUEST_FAMILY - 1) return;   // row 1 + 3 extras
      var el = document.createElement('div');
      Object.assign(el.style, { display: 'flex', flexDirection: 'column', gap: '3px' });

      var top = document.createElement('div');
      Object.assign(top.style, { display: 'flex', gap: '4px', alignItems: 'center' });

      var firstInput = document.createElement('input');
      firstInput.type = 'text';
      firstInput.placeholder = 'First name';
      Object.assign(firstInput.style, {
        flex: '1', padding: '5px 8px', borderRadius: '6px',
        border: '1px solid #e2e8f0', fontSize: '12px',
        background: '#f8fafc', color: '#1e293b', outline: 'none'
      });
      firstInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') triggerWalkIn(); });

      var clubSel = makeClubSelect();

      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '\u00D7';
      removeBtn.title = 'Remove this child';
      Object.assign(removeBtn.style, {
        fontSize: '12px', lineHeight: '1', padding: '4px 7px', background: '#fff',
        color: '#dc2626', border: '1px solid #fecaca', borderRadius: '6px',
        cursor: 'pointer', fontWeight: '700'
      });

      top.append(firstInput, clubSel, removeBtn);

      var regRow = document.createElement('div');
      Object.assign(regRow.style, { display: 'none', gap: '4px' });
      var birthInput = document.createElement('input');
      birthInput.type = 'date';
      Object.assign(birthInput.style, {
        flex: '1', padding: '5px 8px', borderRadius: '6px', border: '1px solid #e2e8f0',
        fontSize: '11px', background: '#fff', color: '#1e293b', outline: 'none'
      });
      var genderSel = makeGenderSelect();
      var gradeSel = makeGradeSelect();
      regRow.append(birthInput, genderSel, gradeSel);

      el.append(top, regRow);
      familyRows.appendChild(el);

      var entry = {
        el: el, regRow: regRow, firstInput: firstInput, clubSel: clubSel,
        birthInput: birthInput, genderSel: genderSel, gradeSel: gradeSel
      };
      removeBtn.addEventListener('click', function() { removeFamilyRow(entry); });
      familyRowData.push(entry);
      syncFamilyUi();
      updateScrollFade();
      try { firstInput.focus({ preventScroll: true }); } catch (e) { /* older browsers */ }
      return entry;
    }

    function readFamilyRows() {
      return familyRowData.map(function(r) {
        return { firstName: r.firstInput.value.trim(), club: r.clubSel.value };
      });
    }

    function clearFamilyRows() {
      familyRowData.slice().forEach(removeFamilyRow);
      familyStatus.textContent = '';
    }

    addChildBtn.addEventListener('click', addFamilyRow);

    // Now that every control the Leader/Custom modes touch exists, settle the
    // row into its initial (child) state.
    applyRowMode();

    // ── Remembered leaders ─────────────────────────────────────────────────
    // The same adults volunteer every week, so the server remembers whoever
    // has had a tag printed and offers them back as one-tap chips: tick a few,
    // Print selected, and a whole team is tagged without typing a name.
    var leaderChipsWrap = document.createElement('div');
    Object.assign(leaderChipsWrap.style, { display: 'none', flexDirection: 'column', gap: '4px' });

    var leaderChipsHeader = document.createElement('div');
    Object.assign(leaderChipsHeader.style, {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px'
    });
    var leaderChipsTitle = document.createElement('div');
    Object.assign(leaderChipsTitle.style, { fontSize: '10px', color: '#94a3b8', fontWeight: '600' });
    leaderChipsTitle.textContent = 'Remembered leaders';
    var leaderPrintSelBtn = document.createElement('button');
    leaderPrintSelBtn.textContent = 'Print selected';
    Object.assign(leaderPrintSelBtn.style, {
      fontSize: '10px', padding: '3px 8px', background: '#f59e0b', color: '#ffffff',
      border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600'
    });
    leaderChipsHeader.append(leaderChipsTitle, leaderPrintSelBtn);

    var leaderChipsList = document.createElement('div');
    Object.assign(leaderChipsList.style, { display: 'flex', flexWrap: 'wrap', gap: '4px' });

    var leaderChipsStatus = document.createElement('div');
    Object.assign(leaderChipsStatus.style, { fontSize: '10px', color: '#94a3b8' });

    leaderChipsWrap.append(leaderChipsHeader, leaderChipsList, leaderChipsStatus);

    // key → true for the ticked chips, and the last list the server sent.
    // The selection survives a re-render so a refresh (or a batch that partly
    // failed) does not silently clear what the operator ticked, and the batch
    // is built from this state rather than scraped back out of the DOM.
    var leaderSelection = {};
    var leaderCache = [];

    function setLeaderChipsStatus(text, color) {
      leaderChipsStatus.textContent = text || '';
      leaderChipsStatus.style.color = color || '#94a3b8';
    }

    function renderLeaderChips(leaders, hidden) {
      leaderChipsList.textContent = '';
      leaderCache = (leaders || []).slice();
      if (!leaders || !leaders.length) {
        leaderChipsWrap.style.display = 'none';
        return;
      }
      leaderChipsWrap.style.display = 'flex';
      leaders.forEach(function(l) {
        var chip = document.createElement('span');
        Object.assign(chip.style, {
          display: 'inline-flex', alignItems: 'center', gap: '4px',
          fontSize: '11px', padding: '2px 4px 2px 6px', borderRadius: '999px',
          background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e'
        });
        var pick = document.createElement('label');
        Object.assign(pick.style, { display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer' });
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!leaderSelection[l.key];
        Object.assign(cb.style, { margin: '0', cursor: 'pointer' });
        cb.addEventListener('change', function() {
          if (cb.checked) leaderSelection[l.key] = true; else delete leaderSelection[l.key];
        });
        var nameText = ((l.firstName || '') + ' ' + (l.lastName || '')).trim();
        pick.append(cb, document.createTextNode(nameText + (l.clubName ? ' · ' + l.clubName : '')));

        // Print just this one — the common case is a single latecomer.
        var oneBtn = document.createElement('button');
        oneBtn.textContent = '\u2399';
        oneBtn.title = 'Print ' + nameText + "'s tag";
        Object.assign(oneBtn.style, {
          border: 'none', background: 'transparent', cursor: 'pointer',
          fontSize: '11px', color: '#b45309', padding: '0 2px'
        });
        oneBtn.addEventListener('click', function() { printLeaders([l]); });

        // Forget: a leader who moved away, or a name typed wrong.
        var xBtn = document.createElement('button');
        xBtn.textContent = '\u00D7';
        xBtn.title = 'Forget ' + nameText;
        Object.assign(xBtn.style, {
          border: 'none', background: 'transparent', cursor: 'pointer',
          fontSize: '13px', lineHeight: '1', color: '#b45309', padding: '0 3px'
        });
        xBtn.addEventListener('click', function() {
          if (!confirm('Forget ' + nameText + '? Their tag can still be printed by typing the name.')) return;
          delete leaderSelection[l.key];
          fetch(PRINT_SERVER + '/leaders/forget', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: l.key }),
            signal: AbortSignal.timeout(4000)
          }).then(function(r) { return r.ok ? r.json() : null; })
            .then(function(d) { if (d) renderLeaderChips(d.leaders, d.hidden); })
            .catch(function() { setLeaderChipsStatus('Could not reach the print server', '#ef4444'); });
        });

        chip.append(pick, oneBtn, xBtn);
        leaderChipsList.appendChild(chip);
      });
      setLeaderChipsStatus(hidden ? hidden + ' not printed this season (hidden)' : '');
    }

    function refreshLeaderChips() {
      fetch(PRINT_SERVER + '/leaders', { signal: AbortSignal.timeout(4000) })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(d) { if (d) renderLeaderChips(d.leaders, d.hidden); })
        .catch(function() { /* offline: leave whatever is on screen */ });
    }

    // One code path for a single chip, a batch of chips, and the typed field:
    // the server prints them sequentially and reports per name, so a jam
    // halfway through names the tag that did not come out.
    function printLeaders(leaders) {
      if (!leaders || !leaders.length) {
        setLeaderChipsStatus('Tick a leader first', '#ef4444');
        return;
      }
      setLeaderChipsStatus('Printing ' + leaders.length + ' tag' + (leaders.length === 1 ? '' : 's') + '\u2026');
      setStatus('\u23F3');
      fetch(PRINT_SERVER + '/print-leader', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leaders: leaders.map(function(l) {
            return { firstName: l.firstName, lastName: l.lastName, clubName: l.clubName || '' };
          }),
          printerName: selectedPrinterName || ''
        }),
        signal: AbortSignal.timeout(PRINT_TIMEOUT_MS * Math.max(1, leaders.length))
      }).then(function(r) { return r.json().then(function(d) { return { ok: r.ok, d: d }; }); })
        .then(function(res) {
          var d = res.d || {};
          if (!res.ok) {
            setStatus('\u274C'); playError();
            setLeaderChipsStatus(d.error || 'Print failed', '#ef4444');
          } else if (d.failed) {
            setStatus('\u274C'); playError();
            var bad = (d.results || []).filter(function(x) { return !x.success; })
              .map(function(x) { return x.name; }).join(', ');
            setLeaderChipsStatus('Printed ' + d.printed + ', failed: ' + bad, '#ef4444');
          } else {
            setStatus('\u2705'); playSuccess();
            setLeaderChipsStatus('Printed ' + (d.printed != null ? d.printed : leaders.length) + ' tag'
              + ((d.printed === 1) ? '' : 's'), '#16a34a');
            leaderSelection = {};
          }
          clearStatus();
          refreshLeaderChips();
        })
        .catch(function() {
          setStatus('\u274C'); playError(); clearStatus();
          setLeaderChipsStatus('Could not reach the print server', '#ef4444');
        });
    }

    // One line of free text at the door. Same fetch shape as printLeaders()
    // above, and the same rule as the leader path: it never calls markPrinted,
    // never registers anyone in TwoTimTwo, and never touches printedNames.
    function printCustomLabel(text) {
      var clean = String(text || '').replace(/\s+/g, ' ').trim();
      if (!clean) { setCustomStatus('Type the label text first', '#ef4444'); return; }
      setCustomStatus('Printing\u2026');
      setStatus('\u23F3');
      fetch(PRINT_SERVER + '/print-custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: clean, printerName: selectedPrinterName || '' }),
        signal: AbortSignal.timeout(PRINT_TIMEOUT_MS)
      }).then(function(r) { return r.json().then(function(d) { return { ok: r.ok, d: d || {} }; }); })
        .then(function(res) {
          if (!res.ok || res.d.success !== true) {
            setStatus('\u274C'); playError();
            setCustomStatus(res.d.error || 'Print failed', '#ef4444');
          } else if (res.d.duplicate) {
            setStatus('\u2705'); playSuccess();
            setCustomStatus('Already printed a moment ago', '#94a3b8');
          } else {
            setStatus('\u2705'); playSuccess();
            setCustomStatus('Printed \u00B7 not counted, not recorded', '#16a34a');
            guestInput.value = '';
          }
          clearStatus();
        })
        .catch(function() {
          setStatus('\u274C'); playError(); clearStatus();
          setCustomStatus('Could not reach the print server', '#ef4444');
        });
    }

    leaderPrintSelBtn.addEventListener('click', function() {
      printLeaders(leaderCache.filter(function(l) { return leaderSelection[l.key]; }));
    });

    refreshLeaderChips();

    registerCb.addEventListener('change', function() {
      registerFields.style.display = registerCb.checked ? 'flex' : 'none';
      syncFamilyUi();   // each family row's birthdate/gender/grade follows it (#323)
      // Scroll the revealed form into view. The panel scrolls now, but a form
      // that appears below the fold on an unchanged-looking panel is the same
      // "where did it go" problem wearing a different hat.
      if (registerCb.checked) {
        try {
          registerFields.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          guardianInput.focus({ preventScroll: true });
        } catch (e) { /* older browsers: the panel still scrolls by hand */ }
      }
      updateScrollFade();
    });

    function setRegisterStatus(text, color) {
      registerStatus.textContent = text;
      registerStatus.style.color = color || '#94a3b8';
    }

    // Fire-and-forget: the labels have already printed by the time this
    // resolves, and it never blocks or retries a print on a registration
    // failure.
    //
    // `children` is [{firstName, lastName, birthdate, gradeId, gender}] — one
    // entry for a lone walk-in, up to MAX_GUEST_FAMILY for a visiting family
    // (#323), all under ONE household. `Clubber[i][...]` indexing is the
    // documented shape (docs/TWOTIMTWO.md §4: "Creates a household + one or
    // more clubbers") but this repo has never exercised i > 0, so index 0 is
    // kept byte-identical to what shipped before and the whole submission is
    // all-or-nothing: TwoTimTwo requires gender, grade AND birthdate per
    // child, and half a registered family is worse than none.
    function registerWalkInFamily(children, guardianName, phone) {
      var kids = (children || []).filter(function(c) { return c && c.firstName; });
      if (!kids.length) return;
      if (!guardianName || !phone || kids.some(function(c) { return !c.birthdate || !c.gradeId; })) {
        setRegisterStatus('\u26A0 Fill in guardian, phone, birthdate & grade (for every child) to register', '#f59e0b');
        return;
      }
      var csrfToken = findCsrfToken();
      if (!csrfToken) {
        setRegisterStatus('\u26A0 Could not find TwoTimTwo\u2019s form token \u2014 not registered (label still printed)', '#ef4444');
        return;
      }
      setRegisterStatus('Registering in TwoTimTwo\u2026', '#94a3b8');
      var body = 'jscript=yep' +
        '&Household%5Bname1%5D=' + encodeURIComponent(guardianName) +
        '&Household%5Bphn1%5D=' + encodeURIComponent(phone);
      kids.forEach(function(c, i) {
        body += '&Clubber%5B' + i + '%5D%5Bfirst_name%5D=' + encodeURIComponent(c.firstName) +
          '&Clubber%5B' + i + '%5D%5Blast_name%5D=' + encodeURIComponent(c.lastName || '') +
          '&Clubber%5B' + i + '%5D%5Bgender%5D=' + encodeURIComponent(c.gender) +
          '&Clubber%5B' + i + '%5D%5Bgrade_id%5D=' + encodeURIComponent(c.gradeId) +
          '&Clubber%5B' + i + '%5D%5Bbirthdate%5D=' + encodeURIComponent(c.birthdate);
      });
      body += '&YII_CSRF_TOKEN=' + encodeURIComponent(csrfToken);
      fetch('/clubber/register?default_visitor=Y', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body,
        signal: AbortSignal.timeout(10000)
      }).then(function(r) {
        if (r.ok) {
          setRegisterStatus('\u2713 Registered ' + kids.length + (kids.length === 1 ? ' child' : ' children') + ' in TwoTimTwo', '#16a34a');
        } else {
          setRegisterStatus('\u26A0 Registration failed (HTTP ' + r.status + ') \u2014 label printed, register manually', '#ef4444');
        }
      }).catch(function(err) {
        setRegisterStatus('\u26A0 Registration failed (' + err.message + ') \u2014 label printed, register manually', '#ef4444');
      });
    }

    function triggerWalkIn() {
      var name = guestInput.value.trim();
      if (!name) return;
      var club = clubSelect.value;
      // A question about the PREVIOUS name must never sit over a new one.
      hideWalkInChoice();

      // Custom mode: one line of free text on a blank label. Even further from
      // a check-in than the leader branch below — no markPrinted (nothing was
      // printed FOR anybody, so the session dedup set must never learn this
      // string), no TwoTimTwo registration, no club, no visitor flag. The
      // server records nothing either: no history row, no tally, no event.
      if (isCustomMode()) {
        printCustomLabel(name);
        return;
      }

      // Leader mode: an adult's tag. Deliberately none of what follows —
      // no markPrinted (a leader is not a check-in, so reconcile and the
      // roster-diff observer must never see them), no TwoTimTwo registration,
      // no share balance, no visitor flag. The server remembers the name, so
      // next week this is a chip instead of typing.
      if (isLeaderMode()) {
        var parts = name.split(/\s+/);
        printLeaders([{ firstName: parts[0] || '', lastName: parts.slice(1).join(' '), clubName: club }]);
        guestInput.value = '';
        return;
      }

      // ── The typed name is one we already know ────────────────────────────
      // Two ways a walk-in goes quietly wrong. The child is actually ON THE
      // ROSTER, so printing them as a guest files a name-keyed row now and the
      // driven check-in files an id-keyed one minutes later, and the night
      // counts one child twice. Or the name belongs to a remembered LEADER, so
      // an adult volunteer lands in tonight's count as a child.
      //
      // Both are genuinely ambiguous from here — a visiting cousin really can
      // share a clubber's name — so the panel ASKS, inline, and never picks.
      // Nothing has been printed or marked at this point, so either answer is
      // still a clean first action.
      var conflict = walkInNameConflict(name, rosterLookupByName(name), leaderCache);
      if (conflict && conflict.kind === 'roster') {
        showWalkInChoice('Looks like ' + conflict.roster.displayName + ' is on the roster.', [
          { label: 'Use roster', background: '#4caf50',
            run: function() { printRosterChild(conflict.roster); } },
          { label: 'Print as visitor', background: '#64748b',
            run: function() { printWalkInAsChild(name, club); } }
        ]);
        return;
      }
      if (conflict && conflict.kind === 'leader') {
        var known = ((conflict.leader.firstName || '') + ' ' + (conflict.leader.lastName || '')).trim();
        showWalkInChoice(known + ' is a remembered leader.', [
          { label: 'Print Leader Tag', background: '#f59e0b', run: function() {
            // Flip the row into leader mode as well as printing, so what is on
            // screen matches what came out of the printer.
            leaderCb.checked = true;
            customCb.checked = false;
            applyRowMode();
            printLeaders([{
              firstName: conflict.leader.firstName,
              lastName: conflict.leader.lastName,
              clubName: conflict.leader.clubName || club
            }]);
            guestInput.value = '';
          } },
          { label: 'Print as child anyway', background: '#64748b',
            run: function() { printWalkInAsChild(name, club); } }
        ]);
        return;
      }

      printWalkInAsChild(name, club);
    }

    // "Use roster": print with TwoTimTwo's own clubber id and the roster's club,
    // which is the identity the driven check-in would have used — so the server
    // files ONE row for this child instead of a name row now and an id row
    // later. Nothing is registered on TwoTimTwo: the site already knows them.
    function printRosterChild(meta) {
      markPrinted(meta.displayName, meta.recid);
      doPrint(meta.displayName, meta.clubName || '', meta.clubImageData || null, 'walkin-roster', meta.recid);
      guestInput.value = '';
      clearFamilyRows();
    }

    // The walk-in path proper, unchanged but for being reachable from the
    // inline choice above as well as straight from Print.
    function printWalkInAsChild(name, club) {
      // One payload per child (#323): the typed row, plus any family rows,
      // sharing the typed surname. A lone walk-in produces exactly the single
      // payload it always did.
      var payloads = buildGuestFamilyPayloads(name, readFamilyRows(), {
        club: club,
        printerName: selectedPrinterName || '',
        stepUpNight: isStepUpNight(),
        visitor: visitorCb.checked
      });
      if (!payloads.length) return;

      if (isAwanaStoreNight()) {
        payloads.forEach(function(p) {
          var np = p.name.split(/\s+/);
          var bal = getShareBalance(np[0] || '', np.slice(1).join(' '));
          if (bal !== null) p.awanaShares = bal + 1;
        });
      }
      // Record every walk-in in the session dedup set. This was the ONE print
      // path that never did, so once the guest was registered and checked in
      // (the new one-step option makes that routine), reconcile / roster-diff /
      // the last-checkin observer all saw a name they had no record of printing
      // and produced a SECOND label.
      payloads.forEach(function(p) { markPrinted(p.name); });

      // Capture what registration needs BEFORE the form is cleared. The
      // register fields are looked up per first name and the list is built
      // FROM the payloads, so the household submitted is exactly the set of
      // children that got labels — no blank row, no duplicate, nothing past
      // the cap. Row 1's birthdate/gender/grade are the shared controls; each
      // extra row carries its own.
      var regByFirst = {};
      var typedFirst = (payloads[0].name.split(/\s+/)[0] || '').toLowerCase();
      regByFirst[typedFirst] = {
        birthdate: birthdateInput.value, gradeId: gradeSelect.value, gender: genderSelect.value
      };
      familyRowData.forEach(function(r) {
        var first = r.firstInput.value.trim().toLowerCase();
        if (!first || regByFirst[first]) return;
        regByFirst[first] = {
          birthdate: r.birthInput.value, gradeId: r.gradeSel.value, gender: r.genderSel.value
        };
      });
      var children = payloads.map(function(p) {
        var np = p.name.split(/\s+/);
        var reg = regByFirst[(np[0] || '').toLowerCase()] || {};
        return {
          firstName: np[0] || '',
          lastName: np.slice(1).join(' '),
          birthdate: reg.birthdate,
          gradeId: reg.gradeId,
          gender: reg.gender
        };
      });
      var guardianName = guardianInput.value.trim();
      var guardianPhone = phoneInput.value.trim();
      var wantRegister = registerCb.checked;

      setStatus('\u23F3');
      familyStatus.textContent = payloads.length > 1 ? ('Printing 1 of ' + payloads.length + '\u2026') : '';

      // Clear the form synchronously, exactly as before — the operator is
      // already typing the next family by the time the labels come out.
      guestInput.value = '';
      clearFamilyRows();

      printGuestFamily(payloads, 0, { ok: 0, queued: 0, failed: 0 });

      // F-3: registration is independent of the prints above \u2014 it never waits
      // on them and never blocks/undoes them if the TwoTimTwo POST fails.
      if (wantRegister) registerWalkInFamily(children, guardianName, guardianPhone);
    }

    // One child per request, in order, NEVER a batch endpoint: each label goes
    // through the same single-child /print path, dedup key and history row as a
    // lone walk-in. It recurses in BOTH the then and the catch, so one child's
    // failure queues only that child and the next label still prints.
    function printGuestFamily(payloads, i, tally) {
      if (i >= payloads.length) {
        if (payloads.length > 1) {
          familyStatus.style.color = (tally.ok === payloads.length) ? '#16a34a' : '#f59e0b';
          familyStatus.textContent = 'Printed ' + tally.ok + ' of ' + payloads.length
            + (tally.queued ? ' \u00B7 ' + tally.queued + ' queued offline' : '')
            + (tally.failed ? ' \u00B7 ' + tally.failed + ' failed' : '');
        }
        return;
      }
      var next = function() {
        if (payloads.length > 1 && i + 1 < payloads.length) {
          familyStatus.style.color = '#94a3b8';
          familyStatus.textContent = 'Printing ' + (i + 2) + ' of ' + payloads.length + '\u2026';
        }
        printGuestFamily(payloads, i + 1, tally);
      };
      fetch(PRINT_SERVER + '/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloads[i]),
        signal: AbortSignal.timeout(PRINT_TIMEOUT_MS)
      }).then(function(r) {
        if (r.ok) { tally.ok++; setStatus('\u2705'); playSuccess(); }
        else { tally.failed++; setStatus('\u274C'); playError(); }
        clearStatus();
        next();
      }).catch(function() {
        // Offline: this child replays later carrying its own
        // suppressConnectCard, so a flushed row 1 still prints the one card.
        queuePrint(payloads[i]);
        tally.queued++;
        setStatus('\uD83D\uDCE6');
        clearStatus();
        next();
      });
    }
    guestInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') triggerWalkIn(); });
    walkInPrintBtn.addEventListener('click', triggerWalkIn);

    walkInRow.append(guestInput, walkInPrintBtn);

    // ── Tonight's check-ins (reprint) ──
    var tonightHeader = document.createElement('div');
    Object.assign(tonightHeader.style, { display: 'flex', alignItems: 'center', gap: '6px' });
    var tonightLabel = sectionLabel('Tonight');
    tonightLabel.style.flex = '1';
    var tonightCount = document.createElement('span');
    tonightCount.id = 'awana-tonight-count';
    Object.assign(tonightCount.style, { fontSize: '10px', color: '#94a3b8' });
    var tonightRefresh = document.createElement('button');
    tonightRefresh.textContent = '\u21BB';
    tonightRefresh.title = 'Refresh list';
    Object.assign(tonightRefresh.style, {
      fontSize: '11px', padding: '0 6px', background: '#f1f5f9',
      border: '1px solid #e2e8f0', borderRadius: '4px', cursor: 'pointer',
      color: '#475569', lineHeight: '16px'
    });
    tonightRefresh.addEventListener('click', function() { loadTonight(); loadCountCheck(); });
    // Reset tonight to zero (operator request): marks every check-in row
    // undone on the server (tally and every display drop within seconds),
    // pulls tonight out of the season ledger, clears the recap buffer, then
    // clears this station's print dedup and RE-BASELINES reconcile from the
    // live report — so kids still checked in on TwoTimTwo are re-seeded
    // without a paper explosion, and fresh check-ins print again.
    var tonightReset = document.createElement('button');
    tonightReset.textContent = 'Reset';
    tonightReset.title = 'Set tonight back to zero — marks every check-in undone (labels, tally, displays)';
    Object.assign(tonightReset.style, {
      fontSize: '10px', padding: '0 6px', background: '#fef2f2',
      border: '1px solid #fecaca', borderRadius: '4px', cursor: 'pointer',
      color: '#991b1b', fontWeight: '600', lineHeight: '16px'
    });
    tonightReset.addEventListener('click', function() {
      if (!confirm('Reset tonight to ZERO?\n\nEvery check-in tonight is marked undone: the count here, the tally, and every display drop to 0, and tonight comes out of streaks/milestones. Kids who check in again will print again.')) return;
      tonightReset.disabled = true;
      fetch(PRINT_SERVER + '/reset-tonight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
        signal: AbortSignal.timeout(8000)
      }).then(function(r) { return r.json().then(function(d) { return { ok: r.ok, d: d }; }); })
        .then(function(res) {
          tonightReset.disabled = false;
          if (!res.ok) { alert(res.d && res.d.error ? res.d.error : 'Reset failed.'); return; }
          printedNames.clear();
          try {
            dedupStore.removeItem(REMOTE_PRINTED_KEY);
            dedupStore.removeItem(REMOTE_PRINTED_TS);
            dedupStore.removeItem(REMOTE_RECONCILE_BASELINE_KEY);
          } catch (e) { /* ignore */ }
          reconcileBaselineDone = false;
          runReconcile();   // re-seed dedup from the live report, print nothing
          loadTonight();
          console.log('[Awana] Tonight reset: ' + (res.d && res.d.undone) + ' check-in(s) undone');
        })
        .catch(function() {
          tonightReset.disabled = false;
          alert('Could not reach the print server to reset.');
        });
    });
    tonightHeader.append(tonightLabel, tonightCount, tonightReset, tonightRefresh);

    // Does our number agree with TwoTimTwo's own? Sits directly under the
    // Tonight heading because that is where the count it qualifies lives.
    var countCheck = document.createElement('div');
    countCheck.id = 'awana-count-check';
    Object.assign(countCheck.style, {
      display: 'none', fontSize: '10px', lineHeight: '14px', padding: '1px 0'
    });

    var tonightList = document.createElement('div');
    tonightList.id = 'awana-tonight-list';
    Object.assign(tonightList.style, {
      display: 'flex', flexDirection: 'column', gap: '2px',
      maxHeight: '132px', overflowY: 'auto'
    });

    // Queue badge
    var queueBadge = document.createElement('div');
    queueBadge.id = 'awana-queue-badge';
    Object.assign(queueBadge.style, {
      display: 'none', fontSize: '11px', color: '#f59e0b',
      fontWeight: '600', padding: '2px 0'
    });

    // ── R-1: reconcile-against-checkin_report status + manual "Sync now" ──
    var reconcileRow = document.createElement('div');
    Object.assign(reconcileRow.style, { display: 'flex', alignItems: 'center', gap: '6px' });
    var reconcileStatus = document.createElement('span');
    reconcileStatus.id = 'awana-reconcile-status';
    Object.assign(reconcileStatus.style, { fontSize: '10px', color: '#94a3b8', flex: '1' });
    var syncNowBtn = document.createElement('button');
    syncNowBtn.textContent = 'Sync now';
    Object.assign(syncNowBtn.style, {
      fontSize: '10px', padding: '3px 8px', background: '#f1f5f9',
      border: '1px solid #e2e8f0', borderRadius: '4px', cursor: 'pointer',
      color: '#475569', fontWeight: '600'
    });
    syncNowBtn.addEventListener('click', function() {
      syncNowBtn.disabled = true;
      syncNowBtn.textContent = 'Syncing…';
      runReconcile().then(function() {
        syncNowBtn.disabled = false;
        syncNowBtn.textContent = 'Sync now';
      });
    });
    reconcileRow.append(reconcileStatus, syncNowBtn);

    // ── #2: check-ins that didn't stick — hidden until there's something ──
    var verifyRow = document.createElement('div');
    verifyRow.id = 'awana-verify-row';
    Object.assign(verifyRow.style, { display: 'none', alignItems: 'center', gap: '6px' });
    var verifyStatus = document.createElement('span');
    verifyStatus.id = 'awana-verify-status';
    Object.assign(verifyStatus.style, { fontSize: '10px', color: '#f59e0b', fontWeight: '600', flex: '1' });
    var verifyBtn = document.createElement('button');
    verifyBtn.textContent = 'Verify';
    Object.assign(verifyBtn.style, {
      fontSize: '10px', padding: '2px 8px', borderRadius: '6px',
      border: '1px solid #e2e8f0', background: '#f8fafc', color: '#475569', cursor: 'pointer'
    });
    verifyBtn.addEventListener('click', function() {
      verifyBtn.disabled = true;
      runSelfVerify().then(function() { verifyBtn.disabled = false; });
    });
    verifyRow.append(verifyStatus, verifyBtn);

    // ── #3: contract-drift canary — manual trigger + last result ──
    var contractRow = document.createElement('div');
    Object.assign(contractRow.style, { display: 'flex', alignItems: 'center', gap: '6px' });
    var contractStatus = document.createElement('span');
    contractStatus.id = 'awana-contract-status';
    Object.assign(contractStatus.style, { fontSize: '10px', color: '#94a3b8', flex: '1' });
    contractStatus.textContent = 'Site contract: checked daily';
    var contractBtn = document.createElement('button');
    contractBtn.textContent = 'Check site';
    contractBtn.title = 'Verify every TwoTimTwo selector and endpoint this extension depends on (read-only)';
    Object.assign(contractBtn.style, {
      fontSize: '10px', padding: '2px 8px', borderRadius: '6px',
      border: '1px solid #e2e8f0', background: '#f8fafc', color: '#475569', cursor: 'pointer'
    });
    contractBtn.addEventListener('click', function() {
      contractBtn.disabled = true;
      contractStatus.textContent = 'Site contract: checking\u2026';
      runContractCanary(true).then(function(r) {
        contractBtn.disabled = false;
        if (!r) { contractStatus.textContent = 'Site contract: check failed to run'; return; }
        var soft = r.results.filter(function(x) { return !x.passed && x.soft; });
        if (r.ok) {
          contractStatus.textContent = 'Site contract: \u2713 ' +
            (soft.length ? 'passes (' + soft.length + ' off-day note' + (soft.length > 1 ? 's' : '') + ')' : 'all ' + r.results.length + ' checks pass');
          contractStatus.style.color = '#94a3b8';
          contractStatus.title = soft.map(function(x) { return x.check + ': ' + x.detail; }).join('\n');
        } else {
          var bad = r.results.filter(function(x) { return !x.passed && !x.soft; }).map(function(x) { return x.check; });
          contractStatus.textContent = '\u26A0 Site contract: ' + bad.length + ' check(s) failing';
          contractStatus.style.color = '#f59e0b';
          contractStatus.title = bad.join(', ');
        }
      });
    });
    contractRow.append(contractStatus, contractBtn);

    // ── Quick Mode toggle ──
    var quickModeRow = document.createElement('div');
    Object.assign(quickModeRow.style, {
      display: 'flex', alignItems: 'center', gap: '6px',
      padding: '6px 8px', background: quickModeEnabled ? '#e3f2fd' : '#f8fafc',
      borderRadius: '6px', border: '1px solid ' + (quickModeEnabled ? '#90caf9' : '#e2e8f0'),
      transition: 'all 0.15s ease'
    });
    var quickModeLbl = document.createElement('label');
    Object.assign(quickModeLbl.style, {
      display: 'flex', alignItems: 'center', gap: '6px',
      fontSize: '12px', fontWeight: '600', cursor: 'pointer', flex: '1', color: '#1e293b'
    });
    var quickModeCb = document.createElement('input');
    quickModeCb.type = 'checkbox';
    quickModeCb.checked = quickModeEnabled;
    var quickModeText = document.createElement('span');
    quickModeText.textContent = 'Quick Mode';
    var quickModeHint = document.createElement('span');
    Object.assign(quickModeHint.style, { fontSize: '10px', color: '#64748b', fontWeight: '400' });
    quickModeHint.textContent = 'One-click check-in + keyboard';
    quickModeLbl.append(quickModeCb, quickModeText);
    quickModeRow.append(quickModeLbl, quickModeHint);

    function applyQuickModeVisuals() {
      panelHeader.style.background = quickModeEnabled ? '#2196f3' : '#4caf50';
      pill.style.background = quickModeEnabled ? '#2196f3' : '#4caf50';
      pill.style.boxShadow = quickModeEnabled ? '0 2px 8px rgba(33,150,243,0.3)' : '0 2px 8px rgba(76,175,80,0.3)';
      quickModeRow.style.background = quickModeEnabled ? '#e3f2fd' : '#f8fafc';
      quickModeRow.style.borderColor = quickModeEnabled ? '#90caf9' : '#e2e8f0';
    }
    quickModeCb.addEventListener('change', function() {
      quickModeEnabled = quickModeCb.checked;
      localStorage.setItem(QUICK_MODE_KEY, quickModeEnabled ? 'true' : 'false');
      applyQuickModeVisuals();
      console.log('[Awana] Quick Mode:', quickModeEnabled ? 'ON' : 'OFF');
    });
    // Apply initial visual state
    applyQuickModeVisuals();

    // ── Step Up Night control ──
    // 'auto' detects the page text; 'on'/'off' force the mode regardless.
    var stepUpRow = document.createElement('div');
    Object.assign(stepUpRow.style, {
      display: 'flex', alignItems: 'center', gap: '6px',
      padding: '6px 8px', background: '#f8fafc',
      borderRadius: '6px', border: '1px solid #e2e8f0',
      transition: 'all 0.15s ease'
    });
    var stepUpLbl = document.createElement('label');
    Object.assign(stepUpLbl.style, {
      display: 'flex', alignItems: 'center', gap: '6px',
      fontSize: '12px', fontWeight: '600', cursor: 'pointer', flex: '1', color: '#1e293b'
    });
    var stepUpText = document.createElement('span');
    stepUpText.textContent = 'Step Up Night';
    var stepUpSelect = document.createElement('select');
    stepUpSelect.id = 'awana-stepup-select';
    Object.assign(stepUpSelect.style, {
      padding: '2px 4px', borderRadius: '4px',
      border: '1px solid #cbd5e1', fontSize: '11px',
      background: '#fff', color: '#1e293b'
    });
    [
      { v: 'auto', l: 'Auto' },
      { v: 'on',   l: 'On'   },
      { v: 'off',  l: 'Off'  }
    ].forEach(function(opt) {
      var o = document.createElement('option');
      o.value = opt.v; o.textContent = opt.l;
      if (opt.v === stepUpMode) o.selected = true;
      stepUpSelect.appendChild(o);
    });
    var stepUpHint = document.createElement('span');
    Object.assign(stepUpHint.style, { fontSize: '10px', color: '#64748b', fontWeight: '400' });
    function updateStepUpHint() {
      if (stepUpMode === 'auto') {
        stepUpHint.textContent = isStepUpNight() ? 'auto: ON' : 'auto: off';
      } else {
        stepUpHint.textContent = '';
      }
    }
    function applyStepUpVisuals() {
      var active = isStepUpNight();
      stepUpRow.style.background = active ? '#fff7ed' : '#f8fafc';
      stepUpRow.style.borderColor = active ? '#fdba74' : '#e2e8f0';
      updateStepUpHint();
    }
    stepUpLbl.append(stepUpText);
    stepUpRow.append(stepUpLbl, stepUpHint, stepUpSelect);
    stepUpSelect.addEventListener('change', function() {
      stepUpMode = stepUpSelect.value;
      localStorage.setItem(STEP_UP_KEY, stepUpMode);
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ awana_stepUpMode: stepUpMode });
      }
      applyStepUpVisuals();
      console.log('[Awana] Step Up Night mode:', stepUpMode, '→ active:', isStepUpNight());
    });
    applyStepUpVisuals();
    // Re-evaluate auto detection every minute (page text may load late)
    setInterval(function() { if (stepUpMode === 'auto') applyStepUpVisuals(); }, 60000);

    // ── Awana Store Night control ──
    // Same Auto/On/Off pattern as Step Up. When active, fetchShareBalances
    // pulls one CSV per club_id 2..6 from the volunteer's logged-in
    // TwoTimTwo session and labels get a 🪙 N badge in the icon strip.
    var storeRow = document.createElement('div');
    Object.assign(storeRow.style, {
      display: 'flex', alignItems: 'center', gap: '6px',
      padding: '6px 8px', background: '#f8fafc',
      borderRadius: '6px', border: '1px solid #e2e8f0',
      transition: 'all 0.15s ease'
    });
    var storeLbl = document.createElement('label');
    Object.assign(storeLbl.style, {
      display: 'flex', alignItems: 'center', gap: '6px',
      fontSize: '12px', fontWeight: '600', cursor: 'pointer', flex: '1', color: '#1e293b'
    });
    var storeText = document.createElement('span');
    storeText.textContent = 'Awana Store Night';
    var storeSelect = document.createElement('select');
    storeSelect.id = 'awana-store-select';
    Object.assign(storeSelect.style, {
      padding: '2px 4px', borderRadius: '4px',
      border: '1px solid #cbd5e1', fontSize: '11px',
      background: '#fff', color: '#1e293b'
    });
    [
      { v: 'auto', l: 'Auto' },
      { v: 'on',   l: 'On'   },
      { v: 'off',  l: 'Off'  }
    ].forEach(function(opt) {
      var o = document.createElement('option');
      o.value = opt.v; o.textContent = opt.l;
      if (opt.v === storeMode) o.selected = true;
      storeSelect.appendChild(o);
    });
    var storeHint = document.createElement('span');
    Object.assign(storeHint.style, { fontSize: '10px', color: '#64748b', fontWeight: '400' });
    function applyStoreVisuals() {
      var active = isAwanaStoreNight();
      storeRow.style.background = active ? '#fef3c7' : '#f8fafc';
      storeRow.style.borderColor = active ? '#fcd34d' : '#e2e8f0';
      if (storeMode === 'auto') {
        if (active) {
          var n = Object.keys(SHARES.byKey).length;
          storeHint.textContent = n ? ('auto: ON, ' + n + ' kids') : 'auto: ON, loading…';
        } else {
          storeHint.textContent = 'auto: off';
        }
      } else if (active) {
        var n2 = Object.keys(SHARES.byKey).length;
        storeHint.textContent = n2 ? (n2 + ' kids loaded') : 'loading…';
      } else {
        storeHint.textContent = '';
      }
    }
    storeLbl.append(storeText);
    storeRow.append(storeLbl, storeHint, storeSelect);
    storeSelect.addEventListener('change', function() {
      storeMode = storeSelect.value;
      localStorage.setItem(STORE_KEY, storeMode);
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ awana_storeMode: storeMode });
      }
      if (isAwanaStoreNight()) {
        fetchShareBalances().then(applyStoreVisuals);
      }
      applyStoreVisuals();
      console.log('[Awana] Store Night mode:', storeMode, '→ active:', isAwanaStoreNight());
    });
    applyStoreVisuals();
    // Re-evaluate auto detection (and refresh balance count) every minute
    setInterval(function() {
      if (storeMode === 'auto') applyStoreVisuals();
      if (isAwanaStoreNight() && Date.now() - SHARES.fetchedAt > SHARES_TTL_MS) {
        fetchShareBalances().then(applyStoreVisuals);
      }
    }, 60000);
    // Initial fetch if active on load
    if (isAwanaStoreNight() && SHARES.fetchedAt === 0) {
      fetchShareBalances().then(applyStoreVisuals);
    }

    // ── Search bar ──
    var searchContainer = document.createElement('div');
    Object.assign(searchContainer.style, { position: 'relative' });

    var searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search roster...';
    searchInput.id = 'awana-search-input';
    Object.assign(searchInput.style, {
      width: '100%', padding: '6px 8px 6px 26px', borderRadius: '6px',
      border: '1px solid #e2e8f0', fontSize: '12px',
      background: '#f8fafc', color: '#1e293b', outline: 'none',
      boxSizing: 'border-box'
    });
    searchInput.addEventListener('focus', function() { searchInput.style.borderColor = '#90caf9'; });
    searchInput.addEventListener('blur', function() {
      searchInput.style.borderColor = '#e2e8f0';
      // Delay hiding results so click events on results can fire
      setTimeout(function() {
        var dd = document.getElementById('awana-search-results');
        if (dd) dd.style.display = 'none';
      }, 200);
    });

    var searchIcon = document.createElement('span');
    Object.assign(searchIcon.style, {
      position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)',
      fontSize: '12px', color: '#94a3b8', pointerEvents: 'none'
    });
    searchIcon.textContent = '\uD83D\uDD0D'; // 🔍

    var searchResults = document.createElement('div');
    searchResults.id = 'awana-search-results';
    Object.assign(searchResults.style, {
      display: 'none', position: 'absolute', top: '100%', left: '0', right: '0',
      background: '#fff', border: '1px solid #e2e8f0', borderRadius: '0 0 6px 6px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.1)', maxHeight: '240px', overflowY: 'auto',
      zIndex: '100001'
    });

    var searchSelectedIdx = -1;

    function renderSearchResults(query) {
      while (searchResults.firstChild) searchResults.removeChild(searchResults.firstChild);
      searchSelectedIdx = -1;
      if (!query || query.length < 2) {
        searchResults.style.display = 'none';
        return;
      }
      var q = query.toLowerCase();
      var matches = [];
      Object.keys(ROSTER_CACHE).forEach(function(key) {
        if (matches.length >= 8) return;
        var meta = ROSTER_CACHE[key];
        if (!meta || !meta.displayName) return;
        if (meta.displayName.toLowerCase().indexOf(q) !== -1) {
          matches.push(meta);
        }
      });
      if (matches.length === 0) {
        searchResults.style.display = 'none';
        return;
      }
      matches.forEach(function(meta, idx) {
        var row = document.createElement('div');
        row.setAttribute('data-idx', idx);
        Object.assign(row.style, {
          padding: '6px 10px', cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid #f1f5f9', fontSize: '12px',
          transition: 'background 0.1s'
        });
        row.addEventListener('mouseenter', function() {
          searchSelectedIdx = idx;
          highlightSearchResult();
        });
        row.addEventListener('click', function() {
          searchInput.value = '';
          searchResults.style.display = 'none';
          triggerSearchCheckin(meta);
        });
        var nameSpan = document.createElement('span');
        nameSpan.style.fontWeight = '600';
        nameSpan.textContent = meta.displayName;
        var clubSpan = document.createElement('span');
        Object.assign(clubSpan.style, { fontSize: '10px', color: '#64748b' });
        clubSpan.textContent = meta.clubName || '';
        row.append(nameSpan, clubSpan);
        searchResults.appendChild(row);
      });
      searchResults.style.display = 'block';
    }

    function highlightSearchResult() {
      var rows = searchResults.children;
      for (var i = 0; i < rows.length; i++) {
        rows[i].style.background = (i === searchSelectedIdx) ? '#e3f2fd' : '';
      }
    }

    function triggerSearchCheckin(meta) {
      var name = meta.displayName;
      if (isPrinted(name, meta.recid)) {
        console.log('[Awana] Already checked in this session:', name);
        return;
      }
      if (quickModeEnabled) {
        // Quick Mode: print immediately + auto-click the clubber element to check in on TwoTimTwo
        markPrinted(name, meta.recid);
        doPrint(name, meta.clubName || '', meta.clubImageData || null, undefined, meta.recid);
        var el = meta.element;
        if (el && el.isConnected) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.click();
          setTimeout(function() {
            pollForCheckinButton({ name: name, element: el }, {}, 30);
          }, 150);
        }
      } else {
        // Normal mode: scroll to and click the clubber element (opens TwoTimTwo modal)
        var el = meta.element;
        if (el && el.isConnected) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.click();
        } else {
          // Offline roster entry (no live DOM row): print the label anyway so
          // the kid isn't stuck at the door — do the TwoTimTwo check-in once
          // the site is reachable again.
          console.log('[Awana] ' + name + ' not on the live page — printing label only (cached roster)');
          markPrinted(name, meta.recid);
          doPrint(name, meta.clubName || '', meta.clubImageData || null, undefined, meta.recid);
        }
      }
    }

    searchInput.addEventListener('input', function() {
      renderSearchResults(searchInput.value.trim());
    });

    searchInput.addEventListener('keydown', function(e) {
      var rows = searchResults.children;
      if (rows.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        searchSelectedIdx = Math.min(searchSelectedIdx + 1, rows.length - 1);
        highlightSearchResult();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        searchSelectedIdx = Math.max(searchSelectedIdx - 1, 0);
        highlightSearchResult();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        var idx = searchSelectedIdx >= 0 ? searchSelectedIdx : 0;
        if (rows[idx]) {
          var matchKey = Object.keys(ROSTER_CACHE).filter(function(k) {
            return ROSTER_CACHE[k].displayName === rows[idx].querySelector('span').textContent;
          })[0];
          if (matchKey) {
            searchInput.value = '';
            searchResults.style.display = 'none';
            triggerSearchCheckin(ROSTER_CACHE[matchKey]);
          }
        }
      } else if (e.key === 'Escape') {
        searchInput.value = '';
        searchResults.style.display = 'none';
      }
    });

    // Auto-focus rules (#1), each decided by the operator:
    //   • ready on load and again after every check-in ("load + after
    //     check-in") — so back-to-back arrivals are type→Enter→type→Enter;
    //   • the box is CLEARED first, so a leftover query never prefixes the
    //     next kid's name;
    //   • NEVER steals focus: if the cursor is in any other field (the guest
    //     register form, TwoTimTwo's own inputs, a modal) or the operator is
    //     mid-search here, nothing moves.
    REFOCUS_SEARCH = function() {
      if (isMinimized) return;
      if (window.__awanaTouchOpen) return;   // the touch check-in is in front
      var ae = document.activeElement;
      // Never steal from ANYTHING the operator focused — not just text
      // fields: a keyboard operator tabbed onto the modal's Checkin button
      // (or any link) must not have Enter rerouted into the search box.
      if (ae && ae !== searchInput && ae !== document.body && ae !== document.documentElement) return;
      if (ae === searchInput && searchInput.value) return;
      // The search box lives on the Check in tab: on another tab the operator
      // is doing something else there, so nothing moves.
      if (searchInput.offsetParent === null) return;
      searchInput.value = '';
      searchResults.style.display = 'none';
      try { searchInput.focus({ preventScroll: true }); } catch (e) { searchInput.focus(); }
    };

    searchContainer.append(searchIcon, searchInput, searchResults);

    // ── CSV warning banner ──
    var csvWarningBanner = document.createElement('div');
    csvWarningBanner.id = 'awana-csv-warning';
    Object.assign(csvWarningBanner.style, {
      display: 'none', fontSize: '11px', color: '#92400e', fontWeight: '600',
      padding: '6px 8px', background: '#fffbeb', borderRadius: '6px',
      border: '1px solid #fde68a', cursor: 'pointer', textAlign: 'center'
    });
    csvWarningBanner.textContent = 'Roster may be outdated \u2014 click to refresh';
    csvWarningBanner.addEventListener('click', function() {
      csvWarningBanner.style.display = 'none';
      syncCsv();
    });

    // Sound mute toggle
    var soundRow = document.createElement('div');
    Object.assign(soundRow.style, { display: 'flex', alignItems: 'center', gap: '4px' });
    var muteLabel = document.createElement('label');
    Object.assign(muteLabel.style, {
      display: 'flex', alignItems: 'center', gap: '3px',
      fontSize: '11px', color: '#94a3b8', cursor: 'pointer'
    });
    var muteCb = document.createElement('input');
    muteCb.type = 'checkbox';
    muteCb.checked = soundMuted;
    muteCb.addEventListener('change', function() {
      soundMuted = muteCb.checked;
      localStorage.setItem(MUTE_KEY, soundMuted ? 'true' : 'false');
    });
    muteLabel.append(muteCb);
    muteLabel.append(document.createTextNode('Mute sounds'));
    soundRow.appendChild(muteLabel);

    // ── Help / panic button ──
    var helpBtn = document.createElement('button');
    helpBtn.textContent = 'Help \u2014 Not Working?';
    Object.assign(helpBtn.style, {
      width: '100%', padding: '6px', background: '#fff7ed', color: '#c2410c',
      border: '1px solid #fed7aa', borderRadius: '6px', cursor: 'pointer',
      fontWeight: '600', fontSize: '11px', transition: 'background 0.15s ease'
    });
    helpBtn.addEventListener('mouseenter', function() { helpBtn.style.background = '#ffedd5'; });
    helpBtn.addEventListener('mouseleave', function() { helpBtn.style.background = '#fff7ed'; });
    helpBtn.addEventListener('click', function() {
      helpBtn.textContent = 'Checking...';
      helpBtn.disabled = true;
      fetch(PRINT_SERVER + '/diagnostics', { signal: AbortSignal.timeout(5000) })
        .then(function(r) { return r.json(); })
        .then(function(tests) {
          var failed = tests.filter(function(t) { return !t.passed; });
          var msg = '';
          if (failed.length === 0) {
            msg = '\u2705 Everything looks good! Try clicking Test to print a test label.';
          } else {
            msg = '\u26A0\uFE0F Issues found:\n';
            failed.forEach(function(t) {
              if (t.test === 'Printer detected') msg += '\n\u2022 Your printer may be off or disconnected. Check the USB cable and turn it on.';
              else if (t.test === 'CSV loaded') msg += '\n\u2022 Roster data is missing. Labels will still print but without allergy/birthday info.';
              else if (t.test === 'Label rendering') msg += '\n\u2022 Label rendering failed. Try restarting the server.';
              else msg += '\n\u2022 ' + t.test + ': ' + (t.detail || 'failed');
            });
          }
          alert(msg);
        })
        .catch(function() {
          alert('\u274C Cannot reach the print server.\n\nMake sure the Club Print window is open on this computer.');
        })
        .finally(function() {
          helpBtn.textContent = 'Help \u2014 Not Working?';
          helpBtn.disabled = false;
        });
    });

    // Last-5 confirmation feed (#17a/#29): every print this station sent,
    // with its detection source, pinned at the top of the panel.
    var feedWrap = document.createElement('div');
    var feedLabel = sectionLabel('Last prints');
    var feedList = document.createElement('div');
    feedList.id = 'awana-feed-list';
    Object.assign(feedList.style, { display: 'flex', flexDirection: 'column', gap: '1px', fontSize: '11px', color: '#94a3b8' });
    feedList.textContent = 'No prints yet tonight';
    feedWrap.append(feedLabel, feedList);

    // ── Layout (7.0.0): a top strip that is always there, then four tabs ──
    // The top strip says where labels print and shows a problem only when
    // there is one (each of those rows hides itself when all is well). Below
    // it, tabs in the order the night goes: Check in (the rush: search, Quick
    // Mode, the print mode, last prints), Walk-ins (guests, families,
    // registering, leaders), Tonight (the count, its checks, the reprint list)
    // and Settings (night modes, sound, tests, every status detail, help).
    // Every element and its behaviour is unchanged; only where it sits.
    var topStrip = document.createElement('div');
    topStrip.id = 'awana-panel-top';
    Object.assign(topStrip.style, {
      display: 'flex', flexDirection: 'column', gap: '6px',
      padding: '8px 12px', flex: '0 0 auto', borderBottom: '1px solid #e8f5e9'
    });
    topStrip.append(printerRow, queueBadge, csvWarningBanner, updateRow);

    // Its sibling page, on unless switched off (localStorage, this browser).
    var touchSibRow = document.createElement('label');
    Object.assign(touchSibRow.style, { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer', color: '#1e293b' });
    var touchSibCb = document.createElement('input');
    touchSibCb.type = 'checkbox';
    try { touchSibCb.checked = localStorage.getItem('awana_touchSiblings') !== 'off'; } catch (e) { touchSibCb.checked = true; }
    touchSibCb.addEventListener('change', function() {
      try { localStorage.setItem('awana_touchSiblings', touchSibCb.checked ? 'on' : 'off'); } catch (e) { /* private mode */ }
    });
    touchSibRow.append(touchSibCb, document.createTextNode('Offer brothers and sisters after a check-in'));

    var TABS = [
      ['checkin', 'Check in'], ['walkins', 'Walk-ins'], ['tonight', 'Tonight'], ['settings', 'Settings']
    ];
    var tabBar = document.createElement('div');
    tabBar.setAttribute('role', 'tablist');
    Object.assign(tabBar.style, {
      display: 'flex', flex: '0 0 auto', padding: '0 8px',
      borderBottom: '1px solid #e2e8f0', background: '#ffffff'
    });
    var tabButtons = {};
    var tabPanes = {};
    function pane(key, children) {
      var el = document.createElement('div');
      el.id = 'awana-tab-' + key;
      el.setAttribute('role', 'tabpanel');
      Object.assign(el.style, { display: 'none', flexDirection: 'column', gap: '8px' });
      el.append.apply(el, children);
      tabPanes[key] = el;
      return el;
    }
    function showPanelTab(key) {
      TABS.forEach(function(t) {
        var on = t[0] === key;
        tabPanes[t[0]].style.display = on ? 'flex' : 'none';
        var b = tabButtons[t[0]];
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.style.color = on ? '#2e7d32' : '#64748b';
        b.style.borderBottomColor = on ? '#4caf50' : 'transparent';
      });
      panelBody.scrollTop = 0;
      if (scrollFade) updateScrollFade();   // not yet built on the first call
      if (key === 'checkin') refocusSearch();
      if (key === 'tonight') loadTonight();
    }
    TABS.forEach(function(t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.textContent = t[1];
      Object.assign(b.style, {
        flex: '1 1 0', background: 'none', border: 'none', borderBottom: '2px solid transparent',
        padding: '8px 4px 6px', margin: '0', cursor: 'pointer',
        fontFamily: "'Londrina Solid', 'Arial Narrow', system-ui, sans-serif",
        fontSize: '14px', letterSpacing: '0.05em', textTransform: 'uppercase', color: '#64748b'
      });
      b.addEventListener('click', function() { showPanelTab(t[0]); });
      tabButtons[t[0]] = b;
      tabBar.appendChild(b);
    });

    var sectionGap = function() { var d = divider(); d.style.margin = '4px 0'; return d; };
    panelBody.append(
      pane('checkin', [searchContainer, quickModeRow, controls, feedWrap]),
      pane('walkins', [walkInLabel, walkInRow, walkInClubRow, customStatus, walkInChoice, familyWrap,
        registerCheck, registerFields, leaderChipsWrap]),
      pane('tonight', [tonightHeader, countCheck, tonightList, reconcileRow, verifyRow]),
      pane('settings', [
        sectionLabel('Night modes'), stepUpRow, storeRow,
        sectionGap(), sectionLabel('Touch check-in'), touchSibRow,
        sectionGap(), sectionLabel('Sound'), soundRow,
        sectionGap(), sectionLabel('Tests'), testsRow,
        sectionGap(), sectionLabel('Status'), csvStatus, contractRow, privacyStatus,
        sectionGap(), helpBtn
      ])
    );
    showPanelTab('checkin');

    // A scrollbar the operator can actually SEE. A body that scrolls but shows
    // no affordance looks identical to content that is cut off — which is the
    // impression this panel gave before, and the reason nobody tried scrolling.
    if (!document.getElementById('awana-panel-scroll-style')) {
      var scrollStyle = document.createElement('style');
      scrollStyle.id = 'awana-panel-scroll-style';
      scrollStyle.textContent =
        '#awana-panel-body{scrollbar-width:thin;scrollbar-color:#cbd5e1 transparent;}' +
        '#awana-panel-body::-webkit-scrollbar{width:8px;}' +
        '#awana-panel-body::-webkit-scrollbar-track{background:transparent;}' +
        '#awana-panel-body::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:4px;' +
        'border:2px solid #ffffff;}' +
        '#awana-panel-body::-webkit-scrollbar-thumb:hover{background:#94a3b8;}';
      document.head.appendChild(scrollStyle);
    }

    var scrollFade = document.createElement('div');
    Object.assign(scrollFade.style, {
      position: 'absolute', left: '1px', right: '1px', bottom: '0',
      height: '26px', pointerEvents: 'none', opacity: '0',
      transition: 'opacity 0.15s ease',
      borderRadius: '0 0 8px 8px',
      background: 'linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0.96))'
    });

    // Shown only when there is genuinely more below, so it never lies about
    // content that is not there.
    function updateScrollFade() {
      var moreBelow = panelBody.scrollHeight - panelBody.scrollTop - panelBody.clientHeight > 4;
      scrollFade.style.opacity = moreBelow ? '1' : '0';
    }
    panelBody.addEventListener('scroll', updateScrollFade, { passive: true });
    // Content grows and shrinks as sections expand (the register form) and as
    // the roster loads, so recompute on size changes rather than only on scroll.
    if (typeof ResizeObserver === 'function') {
      try { new ResizeObserver(updateScrollFade).observe(panelBody); } catch (e) { /* ignore */ }
    }
    window.addEventListener('resize', updateScrollFade);
    setTimeout(updateScrollFade, 0);

    panel.append(panelHeader, topStrip, tabBar, panelBody, scrollFade);
    widget.append(pill, panel);

    // ── Mount: fixed overlay on the right, below the site nav bars ──
    Object.assign(widget.style, {
      position: 'fixed',
      top: PANEL_TOP + 'px',
      right: PANEL_RIGHT + 'px',
      zIndex: '99999',
      // Bound here too, so the widget itself can never be taller than the
      // screen even if a future child ignores the panel's own cap.
      maxHeight: 'calc(100vh - ' + (PANEL_TOP + PANEL_GAP) + 'px)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end'
    });
    document.body.appendChild(widget);

    // ── The Check in pill (7.4.0): the touch check-in's door ──
    // Its own pill, always just left of whatever the widget is showing (the
    // Club Print pill, or the open panel), in the brand kit's blue. One tap
    // grows the touch check-in out of it into true full screen (touch.js).
    var touchPill = document.createElement('button');
    touchPill.id = 'awana-touch-pill';
    touchPill.type = 'button';
    touchPill.title = 'Touch check-in (full screen)';
    touchPill.innerHTML = '<span style="font-size:14px">&#x2714;&#xFE0E;</span> Check in';
    Object.assign(touchPill.style, {
      position: 'fixed', top: PANEL_TOP + 'px', zIndex: '99999',
      display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 14px',
      background: '#4c72b8', color: '#ffffff', border: 'none', borderRadius: '20px', cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(76,114,184,0.35)', fontSize: '12px', fontWeight: '700',
      fontFamily: "'Figtree', system-ui, sans-serif", whiteSpace: 'nowrap', userSelect: 'none',
      transformOrigin: '50% 100%',
      transition: 'scale 750ms linear(0, 0.213, 0.605, 0.93, 1.103, 1.142, 1.106, 1.05, 1.006, 0.984, 0.98, 0.986, 0.994, 1, 1.002, 1.003, 1)'
    });
    // The lobby's press: squash onto the ledge, spring back on release.
    touchPill.addEventListener('pointerdown', function() { touchPill.style.transitionDuration = '100ms'; touchPill.style.scale = '1.06 0.9'; });
    var releasePill = function() { touchPill.style.transitionDuration = '750ms'; touchPill.style.scale = '1 1'; };
    touchPill.addEventListener('pointerup', releasePill);
    touchPill.addEventListener('pointerleave', releasePill);
    touchPill.addEventListener('click', function() {
      if (typeof window.__awanaTouchOpenScreen === 'function') window.__awanaTouchOpenScreen(touchPill.getBoundingClientRect());
    });
    document.body.appendChild(touchPill);
    function placeTouchPill() {
      var r = widget.getBoundingClientRect();
      touchPill.style.right = Math.max(8, Math.round(window.innerWidth - r.left + 8)) + 'px';
    }
    window.addEventListener('resize', placeTouchPill);
    if (typeof ResizeObserver === 'function') {
      try { new ResizeObserver(placeTouchPill).observe(widget); } catch (e) { /* ignore */ }
    }

    // ── Toggle logic ──
    function applyMinimized(min) {
      isMinimized = min;
      pill.style.display = min ? 'flex' : 'none';
      // 'flex', not 'block': the panel is a flex column (pinned header +
      // scrolling body), and restoring it as a block would drop that layout.
      panel.style.display = min ? 'none' : 'flex';
      localStorage.setItem(MINIMIZE_KEY, min ? 'true' : 'false');
      placeTouchPill();
    }

    pill.addEventListener('click', function() { applyMinimized(false); loadTonight(); refocusSearch(); });
    closeBtn.addEventListener('click', function() { applyMinimized(true); });
    applyMinimized(isMinimized);
    // Ready to type the first name the moment the page settles.
    setTimeout(refocusSearch, 400);

    console.log('[Awana] Widget injected');
  }

  // Whether names leave the print PC encrypted. State only — see the long note
  // where the element is created for why the key itself is never rendered here.
  function renderPrivacyStatus(data) {
    var el = document.getElementById('awana-privacy-status');
    if (!el) return;
    // No welcome screen configured means no names on the wire and nothing to
    // warn about. Silence is the correct output, not a green badge.
    if (!data.pusher || !data.pusher.configured) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.textContent = '';
    if (data.displayKeyConfigured) {
      el.style.background = '#f0fdf4';
      el.style.border = '1px solid #bbf7d0';
      el.style.color = '#166534';
      el.textContent = '🔒 Names encrypted on the welcome screen'
        + (data.displayKeyId ? ' (key ' + data.displayKeyId + ')' : '');
    } else {
      el.style.background = '#fef2f2';
      el.style.border = '1px solid #fecaca';
      el.style.color = '#991b1b';
      var msg = document.createElement('span');
      msg.textContent = "⚠ Names are NOT encrypted — anyone can subscribe to the welcome screen's channel. ";
      var link = document.createElement('a');
      link.href = PRINT_SERVER + '/#display-key';
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Set a display key';
      link.style.color = '#991b1b';
      link.style.fontWeight = '700';
      el.append(msg, link);
    }
  }

  // Check server health: extension version mismatch, server updates, CSV warnings
  // Every new version loads by itself, at any hour (owner, 7.4.1): the app
  // installs its own update within a minute and restarts the print server;
  // this is Chrome's half. The extension re-reads its folder (the app has
  // already written the new files there) and the check-in tab reloads, which
  // is all "restart Chrome" ever achieved, without closing anyone's tabs. It
  // waits only for what is in flight: a tag still queued to print, a touch
  // check-in being posted, or the touch screen in use (up to two minutes of
  // quiet). Tried once per version per tab, so a copy that cannot reload
  // itself (installed from somewhere else) falls back to the notice.
  var selfUpdating = false;
  function selfUpdateTo(version) {
    if (selfUpdating) return;
    var key = 'awanaSelfUpdate.' + version;
    try { if (sessionStorage.getItem(key)) return; } catch (e) { /* storage off */ }
    selfUpdating = true;
    var started = Date.now();
    (function whenIdle() {
      var busy = getQueue().length > 0 || _quickModeProcessing ||
        (window.__awanaTouchOpen && Date.now() - (window.__awanaTouchLastTap || 0) < 20000);
      if (busy && Date.now() - started < 120000) { setTimeout(whenIdle, 2000); return; }
      try { sessionStorage.setItem(key, '1'); } catch (e) { /* storage off */ }
      console.log('[Awana] Loading extension v' + version + ' (was v' + EXTENSION_VERSION + ')');
      try { chrome.runtime.sendMessage({ type: 'AWANA_RELOAD_SELF' }); } catch (e) { /* already reloading */ }
      setTimeout(function() { location.reload(); }, 1500);
    })();
  }

  function checkForExtensionUpdate() {
    fetch(PRINT_SERVER + '/health', { signal: AbortSignal.timeout(3000) })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        renderPrivacyStatus(data);
        var notice = document.getElementById('awana-update-notice');
        // Extension version mismatch (highest priority)
        if (data.version && data.version !== EXTENSION_VERSION) {
          if (notice) {
            notice.style.display = 'block';
            // When the app manages the extension folder, the new files are
            // ALREADY on disk — the app rewrote them at launch. Chrome just
            // hasn't re-read them. Say the action that actually works instead
            // of "reload extension", which reads as "go download it again".
            var managed = data.extension && data.extension.version === data.version;
            if (managed) selfUpdateTo(data.version);
            notice.textContent = managed
              ? 'Extension v' + data.version + ' is installed — restart Chrome to load it'
              : 'Update available: v' + data.version + ' (reload extension at chrome://extensions)';
          }
        } else if (data.latestVersion && data.latestVersion !== data.version) {
          // Server itself is outdated — offer one-click update. The server
          // exits with a special code and the launcher re-runs the installer.
          if (notice && notice.dataset.updating !== '1') {
            notice.style.display = 'block';
            notice.textContent = '';
            var msg = document.createElement('span');
            msg.textContent = 'Server update v' + data.latestVersion + ' available ';
            var updBtn = document.createElement('button');
            updBtn.textContent = 'Update now';
            Object.assign(updBtn.style, {
              fontSize: '10px', padding: '2px 8px', marginLeft: '6px',
              background: '#f59e0b', color: '#fff', border: 'none',
              borderRadius: '4px', cursor: 'pointer', fontWeight: '700'
            });
            updBtn.addEventListener('click', function() {
              notice.dataset.updating = '1';
              notice.textContent = 'Updating \u2014 the server will restart itself (about a minute)...';
              fetch(PRINT_SERVER + '/update-now', { method: 'POST', signal: AbortSignal.timeout(5000) })
                .catch(function() { /* server exits before responding sometimes — expected */ });
            });
            notice.append(msg, updBtn);
          }
        }
        // CSV warnings
        var csvWarning = document.getElementById('awana-csv-warning');
        if (csvWarning && data.warnings && Array.isArray(data.warnings)) {
          var hasCsvIssue = data.warnings.some(function(w) {
            return w.type === 'csvStale' || w.type === 'csvMissing' || w.type === 'csvEmpty';
          });
          csvWarning.style.display = hasCsvIssue ? 'block' : 'none';
        }
      })
      .catch(function() { /* server offline, ignore */ });
  }

  // The family's faces (6.26.0): Figtree to read, Londrina Solid for the panel's
  // labels, the same files the dashboard and the lobby use, from the print
  // server's copy of the brand kit. Fetched as bytes and handed to FontFace, so
  // the check-in page's own font rules cannot block them; with the server down
  // the panel simply keeps the system face.
  function loadBrandFonts() {
    if (typeof FontFace === 'undefined' || !document.fonts) return;
    [['Figtree', 'figtree-latin-wght-normal.woff2', '100 900'],
     ['Londrina Solid', 'londrina-solid-full-400-normal.woff2', '400'],
     ['Paytone One', 'paytone-one-full-400-normal.woff2', '400']].forEach(function(f) {
      fetch(PRINT_SERVER + '/brand/fonts/' + f[1], { signal: AbortSignal.timeout(5000) })
        .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
        .then(function(buf) {
          var face = new FontFace(f[0], buf, { weight: f[2] });
          document.fonts.add(face);
          return face.load();
        })
        .catch(function() { /* system face it is */ });
    });
  }

  // Shows where labels print, as the print dashboard has it set ("Phomemo
  // D450, backup Brother QL-820NWB"). A server older than 6.26.0
  // has no inUse: its default printer is shown instead.
  function fetchPrinters() {
    var nameEl = document.getElementById('awana-printing-to-name');
    if (!nameEl) return;
    fetch(PRINT_SERVER + '/printers', { signal: AbortSignal.timeout(5000) })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var use = data.inUse || { name: data.serverDefault || '' };
        var text = use.name || 'the Windows default printer';
        if (use.backup) text += ', backup ' + use.backup;
        nameEl.textContent = text;
        nameEl.title = text;
        setPrintingDot(true);
      })
      .catch(function() { nameEl.textContent = 'Print server not reachable'; setPrintingDot(false); });
  }
  function setPrintingDot(ok) {
    var dot = document.getElementById('awana-printing-to-dot');
    if (dot) dot.style.background = ok ? '#4caf50' : '#e53935';
  }

  // Auto-focus (#1): the widget's search box is the fastest path from "kid at
  // the door" to "label printing", so it should be ready to type into at all
  // times the operator isn't deliberately somewhere else. injectWidget()
  // installs the real implementation (it owns the input); this hook lets
  // doPrint(), which lives outside that closure, ask for a refocus after
  // every check-in.
  var REFOCUS_SEARCH = null;
  function refocusSearch() {
    if (REFOCUS_SEARCH) {
      try { REFOCUS_SEARCH(); } catch (e) { /* focus must never break printing */ }
    }
  }

  // ── Batch check-in self-verify report (#2) ─────────────────────────────
  // v3.0.4 made driven check-ins verify themselves (row must vanish) and
  // retry; what it never did was REPORT the ones that still didn't stick —
  // those died in console.log, and the operator found out at pickup when a
  // kid was never marked present. Every terminal "could not verify" now
  // lands here: retried against the authoritative checkin_report (30s after
  // the failure, then on every reconcile poll — up to 2 self-verify retries
  // per kid), surfaced in the widget, and posted to the print server so the
  // dashboard shows the same list. Entries clear themselves the moment the
  // report shows the kid (a late-sticking check-in is a success, not a bug).
  var UNVERIFIED = {};            // identity key → {name, clubberId, club, at, retries}
  var unverifiedTimer = null;     // pending 30s one-shot verify pass
  var UNVERIFIED_RETRY_MAX = 2;

  function recordUnverified(name, clubberId, club) {
    var key = resolveIdentityKey(name, clubberId);
    if (!UNVERIFIED[key]) {
      UNVERIFIED[key] = {
        name: name, clubberId: clubberId || null, club: club || '',
        at: new Date().toISOString(), retries: 0
      };
      console.warn('[Awana] Self-verify: ' + name + ' may not be checked in on TwoTimTwo — tracking');
    }
    updateVerifyWidget();
    postUnverified();
    if (!unverifiedTimer) {
      unverifiedTimer = setTimeout(function() {
        unverifiedTimer = null;
        runSelfVerify();
      }, 30000);
    }
  }

  // Core pass, shared by the 30s one-shot and every reconcile poll (which
  // already holds a fresh report — no second fetch). Report present → kid
  // stuck after all, clear them; absent → retry the site check-in (twice,
  // then just keep them on the report for a human).
  // Retry pacing: TwoTimTwo has ONE #checkin-modal, so driving two kids in
  // the same pass spawns competing poll loops that click whichever modal
  // button is visible — a double submission for one kid and a burnt retry
  // for the other. One re-drive per pass, and never within 10s of the last
  // (the 30s one-shot, the reconcile poll and the widget button can overlap).
  var lastSelfVerifyDriveAt = 0;
  var SELF_VERIFY_DRIVE_GAP_MS = 10000;

  function selfVerifyAgainstReport(entries) {
    var keys = Object.keys(UNVERIFIED);
    if (!keys.length) return;
    var reportIdKeys = new Set();
    var reportNameKeys = new Set();
    entries.forEach(function(e) {
      reportIdKeys.add(identityKey(e.clubberId, e.name));
      reportNameKeys.add('nm:' + nameKeyOf(e.name));
    });
    var drivenThisPass = false;
    keys.forEach(function(key) {
      var item = UNVERIFIED[key];
      // Clear on an id match always; on a bare NAME match only when we hold
      // no id — with twins, sibling B's successful report row must not clear
      // sibling A's tracked failure (same name, different clubberId).
      var clearedById = reportIdKeys.has(key);
      var clearedByName = !item.clubberId && reportNameKeys.has('nm:' + nameKeyOf(item.name));
      if (clearedById || clearedByName) {
        console.log('[Awana] Self-verify: ' + item.name + ' is in tonight\'s report — cleared');
        delete UNVERIFIED[key];
        return;
      }
      if (item.retries >= UNVERIFIED_RETRY_MAX) return; // listed for the human now
      if (drivenThisPass) return;                        // one modal dance at a time
      if (Date.now() - lastSelfVerifyDriveAt < SELF_VERIFY_DRIVE_GAP_MS) return;
      drivenThisPass = true;
      lastSelfVerifyDriveAt = Date.now();
      item.retries++;
      console.log('[Awana] Self-verify: retrying check-in for ' + item.name +
        ' (' + item.retries + '/' + UNVERIFIED_RETRY_MAX + ')');
      var el = findClubberElByName(item.name);
      if (el && el.isConnected) {
        el.click();
        pollForCheckinButton({ name: item.name, element: el }, {}, 30, 0);
      } else if (item.clubberId) {
        tryDirectCheckin(item.clubberId, item.name, null, {});
      }
    });
    updateVerifyWidget();
    postUnverified();
  }

  function runSelfVerify() {
    if (!Object.keys(UNVERIFIED).length) return Promise.resolve();
    return fetchCheckinReport().then(function(entries) {
      if (entries === null) return; // report unavailable — next poll retries
      selfVerifyAgainstReport(entries);
    });
  }

  function updateVerifyWidget() {
    var row = document.getElementById('awana-verify-row');
    var el = document.getElementById('awana-verify-status');
    if (!row || !el) return;
    var names = Object.keys(UNVERIFIED).map(function(k) { return UNVERIFIED[k].name; });
    if (!names.length) {
      row.style.display = 'none';
      return;
    }
    row.style.display = 'flex';
    el.textContent = '\u26A0 ' + names.length + ' check-in' + (names.length > 1 ? 's' : '') + ' didn\'t stick';
    el.title = 'Printed a label but never confirmed on TwoTimTwo: ' + names.join(', ') +
      '. Click Verify to re-check; re-check these kids on the site if it persists.';
  }

  // Dashboard half of "widget + dashboard": replace-semantics list, so an
  // emptied report clears the server warning too. Best-effort like every
  // other feed post — never blocks printing or the retry chain.
  function postUnverified() {
    var entries = Object.keys(UNVERIFIED).map(function(k) {
      var it = UNVERIFIED[k];
      return { name: it.name, clubberId: it.clubberId, club: it.club, at: it.at };
    }).slice(-30); // the server caps at 30 — send the newest rather than 400 on #31
    fetch(PRINT_SERVER + '/feed/unverified-checkins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: entries }),
      signal: AbortSignal.timeout(5000)
    }).catch(function() { /* server offline — widget still shows the list */ });
  }

  function setStatus(text) {
    const el = document.getElementById('awana-status');
    if (el) {
      el.textContent = text;
      console.log('[Awana] Status:', text);
    }
  }

  function clearStatus() {
    setTimeout(function() { setStatus(''); }, STATUS_TIMEOUT);
  }

  // ── Is our number right? ──────────────────────────────────────────────────
  // The print server counts labels it printed; TwoTimTwo counts children its
  // own check-in screen recorded. This shows whether those two agree, because
  // the interesting case is silent otherwise: a child checked in and walked
  // off without a label, and nobody finds out until somebody reads a report
  // days later.
  //
  // The two directions are worded differently ON PURPOSE. Short means a child
  // is in the building wearing nothing — act now. Over is usually a walk-in
  // guest printed without "Also register in TwoTimTwo", which is a supported
  // way to work, so the server subtracts those before calling anything wrong
  // and this only ever shows what is left unexplained.
  function renderCountCheck(v) {
    var el = document.getElementById('awana-count-check');
    if (!el) return;
    if (!v || !v.known) {
      // Never dress up "I don't know" as agreement.
      el.style.display = 'none';
      return;
    }
    el.style.display = '';
    var clubs = (v.byClub || []).filter(function(c) { return c.unexplained !== 0; })
      .map(function(c) { return c.club + ' ' + (c.unexplained < 0 ? '\u2212' : '+') + Math.abs(c.unexplained); })
      .join(', ');
    if (v.matches) {
      el.style.color = '#16a34a';
      el.textContent = '\u2713 Matches TwoTimTwo (' + v.theirs + ')';
      el.title = v.explained
        ? v.explained + ' walk-in guest(s) printed here are not registered in TwoTimTwo, which accounts for the difference.'
        : 'This server and TwoTimTwo agree on tonight\u2019s count.';
      return;
    }
    var short = v.unexplained < 0;
    el.style.color = short ? '#dc2626' : '#f59e0b';
    el.textContent = '\u26A0 TwoTimTwo ' + v.theirs + ' \u00B7 printed ' + v.ours + ' \u2014 '
      + Math.abs(v.unexplained) + (short ? ' with no label' : ' extra')
      + (clubs ? ' (' + clubs + ')' : '');
    el.title = short
      ? 'These children are checked in on TwoTimTwo but this server printed no label for them.'
      : 'This server printed more labels than TwoTimTwo has check-ins, beyond the walk-in guests it knows are unregistered.';
  }

  function loadCountCheck() {
    fetch(PRINT_SERVER + '/reconcile', { signal: AbortSignal.timeout(3000) })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(renderCountCheck)
      .catch(function() { /* print server down — the panel says so elsewhere */ });
  }

  // ── Tonight's check-ins list (widget reprint) ──────────────────────────────
  // Pulls today's print history from the server and renders the most recent
  // prints with a one-tap reprint button — rescues torn/jammed/lost labels
  // without leaving the check-in page.
  function loadTonight() {
    var list = document.getElementById('awana-tonight-list');
    var count = document.getElementById('awana-tonight-count');
    if (!list) return;
    fetch(PRINT_SERVER + '/history/today', { signal: AbortSignal.timeout(3000) })
      .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(allEntries) {
        // Count only LIVE check-ins: history is a log, so an undone kid's row
        // stays in it forever — counting raw rows was why the number never
        // went back down after an undo. Failed prints, award slips, connect
        // cards, leader name tags and one-off name tags never counted as
        // check-ins either (mirrors the server's isNonCheckinRow()).
        var entries = (allEntries || []).filter(function(e) {
          return e && e.success !== false && !e.undone && !e.isAward && !e.isConnectCard && !e.isLeader && !e.oneOff;
        });
        if (count) count.textContent = entries.length ? entries.length + ' printed' : '';
        while (list.firstChild) list.removeChild(list.firstChild);
        if (!entries.length) {
          var empty = document.createElement('div');
          Object.assign(empty.style, { fontSize: '11px', color: '#94a3b8', padding: '2px 0' });
          empty.textContent = 'No check-ins yet tonight';
          list.appendChild(empty);
          return;
        }
        entries.slice(0, 8).forEach(function(e) {
          var fullName = ((e.firstName || '') + ' ' + (e.lastName || '')).trim();
          var row = document.createElement('div');
          Object.assign(row.style, {
            display: 'flex', alignItems: 'center', gap: '6px',
            fontSize: '11px', padding: '3px 6px', background: '#f8fafc',
            borderRadius: '4px'
          });
          var nameSpan = document.createElement('span');
          nameSpan.style.flex = '1';
          nameSpan.style.fontWeight = '600';
          nameSpan.textContent = fullName;
          var timeSpan = document.createElement('span');
          timeSpan.style.color = '#94a3b8';
          try {
            timeSpan.textContent = new Date(e.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          } catch (err) { timeSpan.textContent = ''; }
          var reBtn = document.createElement('button');
          reBtn.textContent = 'Reprint';
          Object.assign(reBtn.style, {
            fontSize: '10px', padding: '2px 8px', background: '#f1f5f9',
            border: '1px solid #e2e8f0', borderRadius: '4px', cursor: 'pointer',
            color: '#475569', fontWeight: '600'
          });
          reBtn.addEventListener('click', function() {
            reBtn.disabled = true;
            reBtn.textContent = '...';
            fetch(PRINT_SERVER + '/reprint', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: fullName }),
              signal: AbortSignal.timeout(PRINT_TIMEOUT_MS)
            }).then(function(r) {
              reBtn.disabled = false;
              reBtn.textContent = 'Reprint';
              if (r.ok) { setStatus('\u2705'); playSuccess(); } else { setStatus('\u274C'); playError(); }
              clearStatus();
            }).catch(function() {
              reBtn.disabled = false;
              reBtn.textContent = 'Reprint';
              setStatus('\u274C'); playError(); clearStatus();
            });
          });
          row.append(nameSpan, timeSpan, reBtn);
          list.appendChild(row);
        });
      })
      .catch(function() {
        if (count) count.textContent = '';
      });
  }

  function watchCheckins() {
    var debounceTimer = null;

    function checkForChange() {
      const lastCheckinEl = document.querySelector('#lastCheckin div');
      if (!lastCheckinEl) {
        lastPrintedName = null;
        return;
      }

      const clone = lastCheckinEl.cloneNode(true);
      const undoLink = clone.querySelector('a');
      if (undoLink) undoLink.remove();

      const text = clone.textContent.trim();

      if (isUndo(text)) {
        lastPrintedName = text;
      } else if (text && text !== lastPrintedName) {
        lastPrintedName = text;
        console.log('[Awana] Check-in detected:', text);
        onCheckin(text);
      } else if (!text) {
        lastPrintedName = null;
      }
    }

    const observer = new MutationObserver(function() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(checkForChange, DEBOUNCE_MS);
    });

    const watchTarget = document.querySelector('#lastCheckin') || document.body;
    observer.observe(watchTarget, {
      childList: true,
      subtree: true,
      characterData: true
    });

    console.log('[Awana] Watching for check-ins');
  }

  // ── Remote check-in detection ──────────────────────────────────────────────
  // Scan the visible .clubber list and compare against the previous scan.
  // Any name that was present last scan but is now missing just got checked
  // in (locally OR remotely).  On the very first scan we only populate the
  // baseline — we must NOT print the entire roster.

  // A search filter on the page hides .clubber rows the same way a check-in
  // does. Skip the diff scan whenever any non-widget text input has a value,
  // and drop any half-accumulated pendingMissing state — otherwise a quick
  // typing flap would breach PENDING_MISS_THRESHOLD and phantom-print.
  function isSearchActive() {
    var inputs = document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])');
    for (var i = 0; i < inputs.length; i++) {
      var inp = inputs[i];
      if (inp.id === 'awana-search-input') continue;
      // The widget's id is 'awana-widget'; the old '#awana-printer-widget'
      // selector matched nothing, and the walk-in guest field carries no id
      // (so the 'awana-walkin' prefix test never fired either). Net effect:
      // typing a walk-in guest's name silently froze remote check-in
      // detection until the field was cleared.
      if (inp.closest && inp.closest('#awana-widget')) continue;
      if (!inp.offsetParent) continue;
      var v = (inp.value || '').trim();
      if (v.length > 0) return true;
    }
    return false;
  }

  function scanClubberList() {
    if (isSearchActive()) {
      if (pendingMissing.size > 0) pendingMissing.clear();
      return;
    }
    var current = new Set();
    var clubberEls = document.querySelectorAll('.clubber');
    for (var i = 0; i < clubberEls.length; i++) {
      var nameEl = clubberEls[i].querySelector('.name');
      if (!nameEl) continue;
      var displayName = nameEl.innerText.trim();
      if (!displayName) continue;
      // recid is TwoTimTwo's own id on the .clubber row — it gives exact
      // identity to the print server (CSV "Clubber ID" match), the direct
      // check-in API, AND the identity key below, so two kids sharing a
      // display name no longer collide (R-4).
      var recid = clubberEls[i].getAttribute('recid') || null;
      var idKey = identityKey(recid, displayName);
      var nk = nameKeyOf(displayName);
      var priorIdk = ROSTER_NAME_INDEX[nk];
      ROSTER_NAME_INDEX[nk] = (priorIdk && priorIdk !== idKey) ? AMBIGUOUS_NAME : idKey;
      current.add(idKey);

      // Cache club info + DOM element while the kid is still visible — once
      // they disappear, lookupClub() can't find them.  The element reference
      // is always refreshed so search/quick-mode clicks target the current DOM.
      var imgEl = clubberEls[i].querySelector('.club img');
      if (!ROSTER_CACHE[idKey]) {
        ROSTER_CACHE[idKey] = {
          displayName: displayName,
          clubName: imgEl ? (imgEl.getAttribute('alt') || '').trim().replace(/&amp;/g, '&') : '',
          clubImageData: imgEl ? getClubImageDataUrl(imgEl) : null,
          element: clubberEls[i],
          recid: recid,
          clubId: clubberEls[i].getAttribute('club_id') || null
        };
        rosterDirty = true;
      } else {
        // idKey already pins this entry to this specific recid (or, absent a
        // recid, this specific name) — just keep the element/club_id fresh.
        ROSTER_CACHE[idKey].element = clubberEls[i];
        var freshClubId = clubberEls[i].getAttribute('club_id') || null;
        if (freshClubId !== ROSTER_CACHE[idKey].clubId) {
          ROSTER_CACHE[idKey].clubId = freshClubId;
          rosterDirty = true;
        }
      }
    }

    if (!baselineScanned) {
      knownClubbers = current;
      baselineScanned = true;
      try { dedupStore.setItem(REMOTE_BASELINE_KEY, '1'); } catch (e) {}
      console.log('[Awana] Baseline established: ' + current.size + ' kids');
      saveScanState();
      return;
    }

    // ── Guard A: mass-disappearance → re-baseline, no prints ────────────────
    // A filter/tab switch/reload with a different filter state can drop a
    // large chunk of .clubber rows at once. Those kids weren't checked in —
    // they're just no longer rendered. If the current scan lost >3 kids AND
    // shrunk to less than 80% of the previous known size, treat it as a UI
    // reshuffle and re-baseline WITHOUT printing.
    var missingCount = 0;
    knownClubbers.forEach(function(key) { if (!current.has(key)) missingCount++; });
    var shrunkRatio = knownClubbers.size > 0 ? (current.size / knownClubbers.size) : 1;
    if (missingCount > MASS_DISAPPEAR_ABS && shrunkRatio < MASS_DISAPPEAR_RATIO) {
      console.log('[Awana] Roster shrunk sharply (' + knownClubbers.size + ' → ' +
                  current.size + ', ' + missingCount + ' missing) — re-baselining, no prints');
      knownClubbers = current;
      pendingMissing.clear();
      saveScanState();
      return;
    }

    // ── Guard B: consecutive-miss confirmation ──────────────────────────────
    // A kid must be absent from PENDING_MISS_THRESHOLD consecutive scans before
    // we print their label. A single-scan flap (virtualization, brief filter)
    // never triggers a print. Reappearing in `current` clears the pending state.
    //
    // We evaluate the union of knownClubbers + pendingMissing so a kid who is
    // missing for scan N stays tracked through scan N+1 even after
    // knownClubbers gets reassigned to `current` below.
    var candidates = new Set();
    knownClubbers.forEach(function(k) { candidates.add(k); });
    pendingMissing.forEach(function(_, k) { candidates.add(k); });

    candidates.forEach(function(key) {
      if (current.has(key)) {
        // Reappeared — false alarm, forget any pending miss.
        if (pendingMissing.has(key)) pendingMissing.delete(key);
        return;
      }
      if (printedNames.has(key)) {
        pendingMissing.delete(key);
        return;
      }
      var meta = ROSTER_CACHE[key];
      if (!meta) return;
      var misses = (pendingMissing.get(key) || 0) + 1;
      if (misses < PENDING_MISS_THRESHOLD) {
        pendingMissing.set(key, misses);
        console.log('[Awana] ' + meta.displayName + ' missing ' + misses + '/' +
                    PENDING_MISS_THRESHOLD + ' — awaiting confirmation');
        return;
      }
      pendingMissing.delete(key);
      console.log('[Awana] Remote check-in detected:', meta.displayName);
      triggerRemotePrint(meta.displayName, meta.clubName, meta.clubImageData, meta.recid);
    });

    knownClubbers = current;
    saveScanState();
  }

  function triggerRemotePrint(fullName, clubName, clubImageData, recid) {
    if (selectedMode === 'off') return;
    var key = resolveIdentityKey(fullName, recid);
    // Same fix as onCheckin: per-name dedup is sufficient. The roster-diff
    // path can detect several remote check-ins in the same scan tick, and
    // each one needs to print — gating on a 2 s global cooldown silently
    // dropped all but the first.
    if (printedNames.has(key)) return;
    markPrinted(fullName, recid);
    doPrint(fullName, clubName || '', clubImageData || null,
      phoneNamesInFlight.has(nameKeyOf(fullName)) ? 'phone' : 'remote', recid);
  }

  // Re-query a .clubber row by display name. Element references captured
  // earlier go stale once TwoTimTwo re-renders the roster after a check-in,
  // so callers must re-resolve before each .click() — otherwise the click
  // hits a detached node and the modal never opens (label prints, page
  // check-in silently fails).
  // TwoTimTwo keeps a checked-in child's row in the page, hidden, with
  // .checked-in (live page, 2026-10-03). Every "is the row gone yet?" check
  // here means "not checked in yet", so those rows never count: before 7.6.0
  // they did, a check-in that had worked looked like one that had not, and
  // the modal fallback clicked the hidden row and checked the child in again.
  function findClubberElByName(name) {
    var target = (name || '').trim();
    if (!target) return null;
    var els = document.querySelectorAll('.clubber:not(.checked-in)');
    for (var i = 0; i < els.length; i++) {
      var nameEl = els[i].querySelector('.name');
      if (nameEl && nameEl.innerText.trim() === target) return els[i];
    }
    return null;
  }

  function lookupClub(name) {
    var clubbers = document.querySelectorAll('.clubber');
    for (var i = 0; i < clubbers.length; i++) {
      var clubber = clubbers[i];
      const nameEl = clubber.querySelector('.name');
      if (nameEl && nameEl.innerText.trim() === name) {
        const imgEl = clubber.querySelector('.club img');
        if (imgEl) {
          return {
            clubName: (imgEl.getAttribute('alt') || '').trim().replace(/&amp;/g, '&'),
            clubImageData: getClubImageDataUrl(imgEl)
          };
        }
        return { clubName: '', clubImageData: null };
      }
    }
    return { clubName: '', clubImageData: null };
  }

  function onCheckin(name) {
    if (selectedMode === 'off') return;
    var key = resolveIdentityKey(name);
    // Per-name dedup is the actual deduplication mechanism. Two parents
    // checking different kids back-to-back must both print, so we do NOT
    // gate on a global time cooldown here — that was the v3.0.4 regression
    // that dropped the second of any two prints within 2 s.
    if (batchPrintedNames.has(key)) return; // already printed in batch
    if (printedNames.has(key)) return; // already printed this session (local or remote)

    var cachedMeta = rosterLookupByName(name);
    markPrinted(name, cachedMeta && cachedMeta.recid);
    var club = lookupClub(name);
    doPrint(name, club.clubName, club.clubImageData, 'local', cachedMeta && cachedMeta.recid);
  }

  function doPrint(fullName, clubName, imageData, source, explicitClubberId) {
    setStatus('\u23F3');

    var parts = fullName.split(' ');
    var firstName = parts[0] || '';
    var lastName = parts.slice(1).join(' ') || '';

    var payload = {
      name: fullName, clubName: clubName, clubImageData: imageData,
      printerName: selectedPrinterName || '',
      stepUpNight: isStepUpNight()
    };
    // TwoTimTwo's own clubber id lets the server match the exact CSV row even
    // when two kids share a name or a middle name is on the label. An
    // explicitly-known id (reconcile report, roster-diff meta) wins over the
    // ROSTER_CACHE lookup by name; name stays as the fallback for walk-ins
    // and offline entries with no cached row.
    var cached = rosterLookupByName(fullName);
    var resolvedClubberId = explicitClubberId || (cached && cached.recid) || null;
    if (resolvedClubberId) payload.clubberId = resolvedClubberId;
    if (isAwanaStoreNight()) {
      var bal = getShareBalance(firstName, lastName);
      if (bal !== null) payload.awanaShares = bal + 1;
    }

    console.log('[Awana] POST /print:', fullName, '|', clubName || '(no club)');

    function attemptPrint(p, retriesLeft) {
      return fetch(PRINT_SERVER + '/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p),
        signal: AbortSignal.timeout(PRINT_TIMEOUT_MS)
      }).then(function(response) {
        if (response.ok) return true;
        throw new Error('HTTP ' + response.status);
      }).catch(function(err) {
        if (retriesLeft > 0) {
          console.log('[Awana] Print failed, retrying in 3s (' + retriesLeft + ' left):', err.message);
          return new Promise(function(resolve) {
            setTimeout(function() { resolve(attemptPrint(p, retriesLeft - 1)); }, 3000);
          });
        }
        throw err;
      });
    }

    var printPromise;
    if (selectedMode !== 'dialog') {
      printPromise = attemptPrint(payload, 1).then(function() {
        setStatus('\u2705');
        playSuccess();
        clearStatus();
        flushQueue();
        loadTonight();
        recordFeed(fullName, source, true);
        console.log('[Awana] Silent print sent to server');
        return true;
      }).catch(function(err) {
        console.log('[Awana] Server unavailable after retry, queuing:', err.message);
        queuePrint(payload);
        recordFeed(fullName, source, false);
        setStatus('\uD83D\uDCE6'); // 📦 queued icon
        clearStatus();
        return false;
      });
    } else {
      printPromise = Promise.resolve(false);
    }

    printPromise.then(function(sentToServer) {
      if (sentToServer || selectedMode === 'off') return;
      if (selectedMode === 'dialog') fallbackPrint(firstName, lastName, clubName, imageData);
    });

    // Auto-focus (#1): whatever the outcome (printed, queued, dialog), be
    // ready for the next kid. Delayed so a closing TwoTimTwo modal's own
    // focus churn settles first; the never-steal guard handles the rest.
    printPromise.then(function() {
      setTimeout(refocusSearch, 400);
    });
  }

  function fallbackPrint(firstName, lastName, clubName, imageData) {
    // Ask the server to generate the same label PNG it would silently print,
    // then show it in the browser's print dialog — so both modes look identical.
    var fullName = firstName + (lastName ? ' ' + lastName : '');
    fetch(PRINT_SERVER + '/label', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: fullName, clubName: clubName, clubImageData: imageData }),
      signal: AbortSignal.timeout(5000)
    }).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.blob();
    }).then(function(blob) {
      var reader = new FileReader();
      reader.onload = function() { printLabelDataUrl(reader.result); };
      reader.readAsDataURL(blob);
    }).catch(function(err) {
      console.warn('[Awana] /label unavailable (' + err.message + '), using local HTML');
      printLabelDataUrl(null, firstName, lastName, clubName, imageData);
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function printLabelDataUrl(dataUrl, firstName, lastName, clubName, imageData) {
    var frame = document.getElementById('awana-print-frame');
    if (!frame) {
      frame = document.createElement('iframe');
      frame.id = 'awana-print-frame';
      Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0',
        width: '0', height: '0', border: '0', visibility: 'hidden' });
      document.body.appendChild(frame);
    }

    var html;
    if (dataUrl) {
      // Server-generated PNG — same output as auto-print
      html = '<!DOCTYPE html><html><head><style>' +
        '@page { size: 4in 2in; margin: 0; }' +
        '* { margin: 0; padding: 0; }' +
        'body { width: 4in; height: 2in; overflow: hidden; }' +
        'img { width: 4in; height: 2in; display: block; }' +
        '</style></head><body><img src="' + dataUrl + '"/></body></html>';
    } else {
      // ── Offline fallback label ───────────────────────────────────────────
      // Fires ONLY when the print server is unreachable, which is exactly why
      // it cannot be unified with the real renderer: every safety field on a
      // normal label — allergy icons, birthday, photo-consent, handbook group —
      // is derived by the SERVER from its roster CSV. The extension has never
      // held that data, so an offline label physically cannot show it.
      //
      // The danger is therefore not the missing icons, it's that the label
      // still LOOKS complete: a volunteer who has learned "no peanut icon means
      // no peanut allergy" would read this as safe. So it says plainly that it
      // is incomplete. A label that admits what it doesn't know is safe; one
      // that quietly omits an allergy is not.
      //
      // Names, club names, and the icon URL all come from the page's DOM, so
      // they go through escapeHtml/attr before being concatenated into markup —
      // an apostrophe or an angle bracket in a kid's name would otherwise
      // mangle (or inject into) the label.
      var fontSize = (firstName || '').length > 12 ? '32pt' : (firstName || '').length > 8 ? '40pt' : '48pt';
      var iconHtml = imageData
        ? '<div class="icon-col"><img src="' + escapeHtml(imageData) + '"/></div><div class="divider"></div>'
        : '';
      var lastNameHtml = lastName ? '<div class="ln">' + escapeHtml(lastName) + '</div>' : '';
      var clubHtml = clubName
        ? '<div class="sep"></div><div class="cn">' + escapeHtml(clubName) + '</div>'
        : '';
      html = '<!DOCTYPE html><html><head><style>' +
        '@page { size: 4in 2in; margin: 0; }' +
        '* { box-sizing: border-box; margin: 0; padding: 0; }' +
        'body { width: 4in; height: 2in; display: flex; align-items: center; justify-content: center; font-family: Helvetica, Arial, sans-serif; }' +
        '.badge { width: 3.8in; height: 1.8in; border: 1.5pt solid #000; border-radius: 12pt; display: flex; align-items: stretch; overflow: hidden; }' +
        '.icon-col { width: 1.1in; display: flex; align-items: center; justify-content: center; background: #f4f4f4; flex-shrink: 0; padding: 8pt; }' +
        '.icon-col img { width: 52pt; height: 52pt; object-fit: contain; }' +
        '.divider { width: 1pt; background: #ddd; flex-shrink: 0; }' +
        '.text { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 6pt 10pt; text-align: center; }' +
        '.fn { font-size: ' + fontSize + '; font-weight: bold; line-height: 1.05; word-break: break-word; }' +
        '.ln { font-size: 20pt; margin-top: 2pt; }' +
        '.sep { width: 65%; height: 0.5pt; background: #ccc; margin: 5pt auto; }' +
        '.cn { font-size: 12pt; font-style: italic; color: #444; }' +
        // Inverted band so it survives a 1-bit thermal print and is impossible
        // to mistake for part of the normal layout.
        '.offline { margin-top: 4pt; background: #000; color: #fff; font-size: 8pt; ' +
        'font-weight: bold; letter-spacing: 0.4pt; padding: 2pt 6pt; border-radius: 3pt; }' +
        '</style></head><body><div class="badge">' +
        iconHtml +
        '<div class="text"><div class="fn">' + escapeHtml(firstName || '') + '</div>' +
        lastNameHtml + clubHtml +
        '<div class="offline">OFFLINE &mdash; CHECK ALLERGY LIST</div>' +
        '</div></div></body></html>';
    }

    frame.contentWindow.document.open();
    frame.contentWindow.document.write(html);
    frame.contentWindow.document.close();

    setTimeout(function() {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
        setStatus('\u2705');
        console.log('[Awana] Print dialog opened');
      } catch (err) {
        setStatus('\u274C');
        console.error('[Awana] Print failed:', err);
      }
      clearStatus();
    }, 600);
  }

  // Sync clubbers.csv from the authenticated browser session to the print server.
  // The browser has session cookies for twotimtwo.com, so fetch('/clubber/csv')
  // succeeds here even though PowerShell's Invoke-WebRequest can't authenticate.
  function setCsvStatus(text, color) {
    var el = document.getElementById('awana-csv-status');
    if (el) {
      el.textContent = text;
      el.style.color = color || '#94a3b8';
    }
  }

  function syncCsv() {
    setCsvStatus('Syncing roster...', '#94a3b8');
    fetch('/clubber/csv')
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var ct = r.headers.get('content-type') || '';
        if (ct.indexOf('html') !== -1) throw new Error('Got HTML, not CSV (login required?)');
        return r.text();
      })
      .then(function(csv) {
        if (!csv || !csv.trim()) {
          setCsvStatus('No roster data from site', '#f59e0b');
          return;
        }
        return fetch(PRINT_SERVER + '/update-csv', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csv: csv }),
          signal: AbortSignal.timeout(5000)
        });
      })
      .then(function(r) {
        if (r && r.ok) {
          return r.json();
        }
      })
      .then(function(data) {
        if (data && data.count !== undefined) {
          setCsvStatus('Roster synced (' + data.count + ' clubbers)', '#22c55e');
          console.log('[Awana] Synced clubbers.csv to print server (' + data.count + ' clubbers)');
        }
      })
      .catch(function(err) {
        console.log('[Awana] CSV sync failed:', err.message);
        // Check if the server already has roster data on disk from a previous sync
        fetch(PRINT_SERVER + '/roster-status', { signal: AbortSignal.timeout(3000) })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.count > 0) {
              setCsvStatus('Using saved roster (' + data.count + ')', '#f59e0b');
            } else {
              setCsvStatus('No roster data -- labels will be basic', '#ef4444');
            }
          })
          .catch(function() {
            setCsvStatus('Server offline -- no roster data', '#ef4444');
          });
      });
  }

  // ── Peak-window auto-refresh ───────────────────────────────────────────────
  // TwoTimTwo.com doesn't push updates of remote check-ins, so during the
  // busiest window (5:40 PM - 6:00 PM) we reload the page every 30 seconds
  // so the .clubber-list diff sees the latest state.  Suppressed while the
  // user is mid-action (modal open, typing).
  // Is this element actually on screen (not display:none, not hidden, not
  // detached)? offsetParent is null for all three, and for position:fixed,
  // which a modal often is, so check the computed style too.
  function isShowing(el) {
    if (!el || !el.isConnected) return false;
    if (el.offsetParent !== null) return true;
    var cs = window.getComputedStyle ? window.getComputedStyle(el) : null;
    return !!cs && cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  function autoRefresh() {
    try {
      if (document.hidden) return;
      // Club night only. The clock window alone has no day component, so a
      // tab left open on any other evening was reloading itself every 30 s
      // between 5:40 and 6:00 — losing whatever the volunteer was doing.
      if (!isInClubWindow()) return;
      var now = new Date();
      var mins = now.getHours() * 60 + now.getMinutes();
      var WINDOW_START = 17 * 60 + 40; // 5:40 PM
      var WINDOW_END   = 18 * 60;      // 6:00 PM
      if (mins < WINDOW_START || mins >= WINDOW_END) return;

      // Suppress reload if any modal is open or user is typing, or the touch
      // check-in is up (a reload would drop it and its full screen mid-family).
      if (window.__awanaTouchOpen) return;
      // #checkin-modal is static markup on TwoTimTwo's page: it is always
      // THERE, so a presence check meant this reload never happened. Ask
      // whether it is showing.
      if (isShowing(document.getElementById('checkin-modal'))) return;
      var active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;
      // Nothing in flight: a label still printing or queued, a phone check-in
      // being driven, or a quick-mode batch would be cut off by the reload.
      if (getQueue().length > 0 || _quickModeProcessing || phoneActionsInFlight.size > 0) return;

      console.log('[Awana] Peak-window auto-refresh');
      location.reload();
    } catch (e) { console.log('[Awana] autoRefresh error:', e); }
  }


  // ── Church config (#50) ─────────────────────────────────────────────────────
  // Club-night windows, shares club ids, and the driven-check-in kill switch
  // come from the print server (GET /config/church + /config) with baked KVBC
  // fallbacks, replacing scattered hardcodes.
  var CHURCH_CFG = {
    sharesClubIds: [2, 3, 4, 5, 6],
    clubNights: [{ dow: 3, start: '17:30', end: '20:00' }],
    enableDrivenCheckin: true
  };

  function loadChurchConfig() {
    fetch(PRINT_SERVER + '/config/church', { signal: AbortSignal.timeout(4000) })
      .then(function(r) { return r.json(); })
      .then(function(cfg) {
        if (Array.isArray(cfg.sharesClubIds) && cfg.sharesClubIds.length) CHURCH_CFG.sharesClubIds = cfg.sharesClubIds;
        if (Array.isArray(cfg.clubNights) && cfg.clubNights.length) CHURCH_CFG.clubNights = cfg.clubNights;
        if (cfg.ymCheckout && typeof cfg.ymCheckout === 'object') {
          var yc = cfg.ymCheckout;
          if (yc.enabled === false) YM_CHECKOUT.enabled = false;
          if (typeof yc.at === 'string' && parseHM(yc.at) !== null) YM_CHECKOUT.at = yc.at;
          if (Array.isArray(yc.clubs) && yc.clubs.length) YM_CHECKOUT.clubs = yc.clubs.map(function(c) { return String(c).toLowerCase(); });
        }
        console.log('[Awana] Church config loaded');
      })
      .catch(function() { /* baked defaults */ });
    fetch(PRINT_SERVER + '/config', { signal: AbortSignal.timeout(4000) })
      .then(function(r) { return r.json(); })
      .then(function(cfg) {
        if (cfg && cfg.enableDrivenCheckin === false) CHURCH_CFG.enableDrivenCheckin = false;
      })
      .catch(function() { /* default on */ });
  }

  function parseHM(v) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim());
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  function isInClubWindow() {
    var now = new Date();
    var mins = now.getHours() * 60 + now.getMinutes();
    return CHURCH_CFG.clubNights.some(function(w) {
      if (!w || Number(w.dow) !== now.getDay()) return false;
      var st = parseHM(w.start), en = parseHM(w.end);
      return st !== null && en !== null && mins >= st && mins < en;
    });
  }

  // ── Youth check-out (7.10.0) ───────────────────────────────────────────────
  // Trek and Journey leave the building partway through the night, so from
  // 7:15 PM on a club night every Trek and Journey child still checked in is
  // checked OUT on TwoTimTwo, the way a volunteer tapping Check out on its
  // Checkout page would, and anyone who checks in after that is checked out
  // within the half minute (owner, 2026-10-03). It reads TwoTimTwo's own
  // Checkout page (docs/TWOTIMTWO.md §2.1: a row per child still checked in,
  // a.checkout[clubber_id], the club in the icon's alt) and posts exactly what
  // that page's own button posts: calendar_id (from the page's script) and
  // clubber_id, answered "OK". Until midnight; church-config.json's ymCheckout
  // {enabled, at, clubs} can move or turn it off.
  var YM_CHECKOUT = { enabled: true, at: '19:15', clubs: ['trek', 'journey'] };
  var YM_SWEEP_MS = 30 * 1000;
  var ymSweeping = false;

  function ymCheckoutDue(now) {
    if (!YM_CHECKOUT.enabled) return false;
    var mins = now.getHours() * 60 + now.getMinutes();
    var at = parseHM(YM_CHECKOUT.at);
    if (at === null || mins < at) return false;
    return CHURCH_CFG.clubNights.some(function(w) { return w && Number(w.dow) === now.getDay(); });
  }

  function ymClubOf(alt) {
    var a = String(alt || '').trim().toLowerCase();
    for (var i = 0; i < YM_CHECKOUT.clubs.length; i++) if (a.indexOf(YM_CHECKOUT.clubs[i]) !== -1) return YM_CHECKOUT.clubs[i];
    return '';
  }

  // Who this station has already checked out tonight, by meeting date: the
  // check-in report keeps listing a child after a check-out, so without this
  // every sweep would post them again.
  // A child whose check-out TwoTimTwo refuses (or that errors) is tried
  // YM_MAX_FAILS times on a night, not every 30 s all evening: the page
  // answered, and asking again is load on the church's site for the same
  // answer. Tonight's counts live beside the done list, keyed by the date,
  // and both are pruned of other nights as they are written.
  var YM_MAX_FAILS = 3;
  function ymStillToTry(ids, done, fails) {
    return ids.filter(function(id) { return done.indexOf(id) === -1 && (fails[id] || 0) < YM_MAX_FAILS; });
  }
  function ymFails(date) {
    try { var o = JSON.parse(localStorage.getItem('awanaYmFail.' + date) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; }
  }
  function ymMarkFails(date, fails) {
    try { localStorage.setItem('awanaYmFail.' + date, JSON.stringify(fails)); } catch (e) { /* storage off */ }
    ymPruneNights(localStorage, date);
  }
  function ymPruneNights(storage, date) {
    var gone = [];
    for (var i = 0; i < storage.length; i++) {
      var k = storage.key(i);
      if (k && (k.indexOf('awanaYmOut.') === 0 || k.indexOf('awanaYmFail.') === 0) && k.slice(k.indexOf('.') + 1) !== date) gone.push(k);
    }
    gone.forEach(function(k) { storage.removeItem(k); });
    return gone.length;
  }
  function ymDone(date) {
    try { return JSON.parse(localStorage.getItem('awanaYmOut.' + date) || '[]'); } catch (e) { return []; }
  }
  function ymMarkDone(date, ids) {
    try { localStorage.setItem('awanaYmOut.' + date, JSON.stringify(ids.slice(-500))); } catch (e) { /* storage off */ }
  }

  // Tell the print server who is checked out tonight (7.15.0): the WHOLE list
  // for the meeting date, every pass, so tonight's count drops on every screen
  // as Trek and Journey leave, and a restarted server catches up within a
  // pass. Clubber ids only. Best-effort, like every other feed post.
  function postCheckedOut(date, ids) {
    fetch(PRINT_SERVER + '/feed/checked-out', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: date, clubberIds: ids }),
      signal: AbortSignal.timeout(8000)
    }).catch(function() { /* the next pass sends it again */ });
  }

  // One sweep. Resolves { ok, checkedOut: [names], failed: [names] }. `force`
  // skips the clock (the test hook below), never the page checks.
  //
  // Who is in comes from TwoTimTwo's check-in report for the meeting the
  // Checkout page is on (live, 2026-10-03: KVBC's Checkout page lists nobody,
  // the check-out tracking it shows being off for its clubs, while the report
  // lists every check-in), plus anyone the Checkout page itself lists, should
  // that ever be turned on. The check-out is that page's own call either way;
  // TwoTimTwo answers it "OK".
  // TwoTimTwo's Checkout page, read for its meeting: resolves { ok, html, doc,
  // cal, date } or { ok: false, error }. The page's own script carries the
  // meeting id its Check out button posts (calendar_id), and the selected
  // date is the meeting's. Shared by the youth sweep and the phone's Check
  // out (7.16.0).
  function readCheckoutPage() {
    return fetch('/clubber/checkout', { credentials: 'same-origin', signal: AbortSignal.timeout(15000) })
      .then(function(r) {
        if (/\/site\/login/.test(r.url || '')) return '';
        return r.ok ? r.text() : '';
      })
      .then(function(html) {
        var doc = new DOMParser().parseFromString(html || '', 'text/html');
        if (!/Checkout Clubber/.test(doc.title || '')) return { ok: false, error: 'not the checkout page (signed out?)' };
        var cal = /calendar_id:\s*(\d+)/.exec(html);
        var dateOpt = doc.querySelector('select#date option[selected]');
        var date = dateOpt ? dateOpt.getAttribute('value') : '';
        if (!cal || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'no meeting on the checkout page' };
        return { ok: true, html: html, doc: doc, cal: cal[1], date: date };
      });
  }

  // The Checkout page's own call: calendar_id + clubber_id, answered with
  // exactly "OK" (docs/TWOTIMTWO.md §2.1). Resolves true only for that exact
  // answer; anything else (a page, the login form, "Login Required", an
  // error, no network) is false. Never rejects.
  function postClubberCheckout(cal, id) {
    return fetch('/clubber/checkout', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'calendar_id=' + encodeURIComponent(cal) + '&clubber_id=' + encodeURIComponent(id),
      signal: AbortSignal.timeout(10000)
    }).then(function(r) { return r.ok ? r.text() : ''; })
      .then(function(t) { return String(t).trim() === 'OK'; })
      .catch(function() { return false; });
  }

  function ymSweep(force) {
    if (ymSweeping) return Promise.resolve({ ok: false, busy: true });
    if (!force && !ymCheckoutDue(new Date())) return Promise.resolve({ ok: true, idle: true, checkedOut: [], failed: [] });
    ymSweeping = true;
    return readCheckoutPage()
      .then(function(page) {
        if (!page.ok) return { ok: false, error: page.error, checkedOut: [], failed: [] };
        var doc = page.doc;
        var date = page.date;
        var want = {};
        doc.querySelectorAll('a.checkout[clubber_id]').forEach(function(a) {
          var tr = a.closest('tr');
          var img = tr && tr.querySelector('img.club-icon-20');
          if (!img || !ymClubOf(img.getAttribute('alt'))) return;
          var nameEl = tr.querySelector('td.name, td.clubber');
          want[a.getAttribute('clubber_id')] = nameEl ? nameEl.textContent.trim().replace(/\s+/g, ' ') : '';
        });
        return fetchCheckinReport(date).then(function(report) {
          (report || []).forEach(function(e) { if (ymClubOf(e.club) && !(e.clubberId in want)) want[e.clubberId] = e.name; });
          var done = ymDone(date);
          var fails = ymFails(date);
          var ids = ymStillToTry(Object.keys(want), done, fails);
          var out = { ok: true, checkedOut: [], failed: [] };
          return ids.reduce(function(chain, id) {
            return chain.then(function() {
              return postClubberCheckout(page.cal, id).then(function(ok) {
                if (ok) { out.checkedOut.push(want[id] || id); done.push(id); }
                else { out.failed.push(want[id] || id); fails[id] = (fails[id] || 0) + 1; }
              });
            });
          }, Promise.resolve()).then(function() {
            ymMarkDone(date, done);
            ymMarkFails(date, fails);
            postCheckedOut(date, done);
            if (out.checkedOut.length) console.log('[Awana] Youth check-out: ' + out.checkedOut.length + ' Trek/Journey checked out');
            if (out.failed.length) console.warn('[Awana] Youth check-out failed for ' + out.failed.length);
            return out;
          });
        });
      })
      .catch(function(e) { return { ok: false, error: String(e && e.message || e), checkedOut: [], failed: [] }; })
      .then(function(r) { ymSweeping = false; return r; });
  }
  window.__awanaYmSweep = ymSweep;

  // ── Confirmation feed (#17a) + pinned last-5 (#29 polish) ──────────────────
  // Every print this station sends, newest first, with how it was detected:
  // local click, remote roster-diff, phone check-in, manual widget action, or
  // R-1's reconcile-against-checkin_report catch-up.
  var printFeed = []; // { name, source, ok, at }
  var SOURCE_ICON = { local: '🖱', remote: '📡', phone: '📱', manual: '⌨', reconcile: '♻️' };

  function recordFeed(name, source, ok) {
    printFeed.unshift({ name: name, source: source || 'manual', ok: ok, at: Date.now() });
    if (printFeed.length > 5) printFeed.length = 5;
    renderPrintFeed();
  }

  function renderPrintFeed() {
    var list = document.getElementById('awana-feed-list');
    if (!list) return;
    list.innerHTML = '';
    if (!printFeed.length) {
      list.textContent = 'No prints yet tonight';
      list.style.color = '#94a3b8';
      return;
    }
    list.style.color = '';
    printFeed.forEach(function(f) {
      var row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', padding: '1px 0' });
      var icon = document.createElement('span');
      icon.textContent = SOURCE_ICON[f.source] || '⌨';
      icon.title = f.source;
      var nm = document.createElement('span');
      nm.style.fontWeight = '600';
      nm.style.flex = '1';
      nm.style.overflow = 'hidden';
      nm.style.textOverflow = 'ellipsis';
      nm.style.whiteSpace = 'nowrap';
      nm.textContent = f.name;
      var check = document.createElement('span');
      check.textContent = f.ok ? '✓ printed' : '📦 queued';
      check.style.color = f.ok ? '#16a34a' : '#f59e0b';
      row.append(icon, nm, check);
      list.appendChild(row);
    });
  }

  // ── Phone check-in executor (#17b) ──────────────────────────────────────────
  // The phone page queues actions on the print server; this station (which
  // holds the authenticated TwoTimTwo session) long-polls for them and drives
  // the real check-in in the DOM. The label prints via the normal detection
  // path — never directly — so dedup still guarantees a single label.
  var phoneActionsInFlight = new Set();  // action ids being driven
  var phoneNamesInFlight = new Set();    // lowercased names → tag feed source

  function reportPhoneAction(id, ok, detail) {
    fetch(PRINT_SERVER + '/pending-actions/' + id + '/result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: ok, detail: detail || '' }),
      signal: AbortSignal.timeout(4000)
    }).catch(function() {});
  }

  // Does TwoTimTwo's own check-in report list this child tonight? The only
  // answer a phone is given a green line for (7.11.0). The direct post's reply
  // and the row vanishing are this station's READING of a reply; the report is
  // TwoTimTwo's record, and once the two disagreed: the phone said checked in,
  // the label printed, and TwoTimTwo had nothing. Matched by the child's
  // TwoTimTwo id when the row carried one, else by name. null: the report
  // could not be read (signed out, network), so nothing is known either way.
  function reportHasCheckin(entries, recid, name) {
    if (!Array.isArray(entries)) return null;
    var id = recid ? String(recid) : '';
    var key = nameKeyOf(name);
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i] || {};
      if (id && String(e.clubberId || '') === id) return true;
      if (key && nameKeyOf(e.name) === key) return true;
    }
    return false;
  }

  // Read the report; on an unreadable report read it once more a moment
  // later, and only then trust the reply already judged (checkinReplyOk, a
  // fresh meeting id) rather than fail a check-in TwoTimTwo may well have.
  function confirmCheckinOnReport(recid, name) {
    return fetchCheckinReport().then(function(entries) {
      var has = reportHasCheckin(entries, recid, name);
      if (has !== null) return has;
      return new Promise(function(r) { setTimeout(r, 2000); })
        .then(function() { return fetchCheckinReport(); })
        .then(function(again) { var h = reportHasCheckin(again, recid, name); return h === null ? true : h; });
    });
  }

  // Claim before driving (7.11.1). The print server leases the action to
  // whoever claims it first and stops offering it, so a second tab, or this
  // tab's next poll half a second later, never drives the same child twice;
  // a claim nobody answers in 90 s is offered again. Claimed by someone else
  // (409) or gone (404): nothing to do here. The server unreachable: drive
  // anyway, as before; the lock already makes this the only printing tab.
  function executePhoneAction(action) {
    if (!action || typeof action.id !== 'string' || phoneActionsInFlight.has(action.id)) return;
    phoneActionsInFlight.add(action.id);
    fetch(PRINT_SERVER + '/pending-actions/' + action.id + '/claim', { method: 'POST', signal: AbortSignal.timeout(4000) })
      .then(function(r) {
        if (r.status === 409 || r.status === 404) { phoneActionsInFlight.delete(action.id); return; }
        drivePhoneAction(action);
      })
      .catch(function() { drivePhoneAction(action); });
  }

  function drivePhoneAction(action) {
    if (action.type === 'undo') { driveUndoAction(action); return; }
    if (action.type === 'checkout') { driveCheckoutAction(action); return; }
    var nameKey = action.name.toLowerCase().trim();

    var el = findClubberElByName(action.name);
    if (!el) {
      // No row to check in. TwoTimTwo hides a row it has checked in, so a
      // child this station already printed is in; otherwise the page is
      // filtered or the name differs, and the desk has to look.
      if (isPrinted(action.name)) reportPhoneAction(action.id, true, 'Already checked in at this station');
      else reportPhoneAction(action.id, false, 'Kid not on the check-in page (already in, or filtered)');
      return;
    }
    // A row still on the page is NOT checked in, printed label or not (a
    // label printed for a check-in TwoTimTwo never recorded is exactly the
    // case this path must repair), so the check-in is driven either way; the
    // label's own dedup stops a second print.
    console.log('[Awana] Phone check-in: driving ' + action.name);
    phoneNamesInFlight.add(nameKey);
    var recid = el.getAttribute('recid');
    var clubId = el.getAttribute('club_id');

    // The green line: TwoTimTwo's report lists the child. If it does not, the
    // row this station hid comes back for the desk, and the phone hears why.
    function reportDone() {
      confirmCheckinOnReport(recid, action.name).then(function(has) {
        if (has) {
          reportPhoneAction(action.id, true, '');
          setTimeout(function() { phoneNamesInFlight.delete(nameKey); }, 15000);
          return;
        }
        var row = recid ? document.querySelector('.clubber[recid="' + String(recid).replace(/[^0-9A-Za-z_-]/g, '') + '"]') : null;
        if (row) { row.classList.remove('checked-in'); row.style.display = ''; }
        phoneNamesInFlight.delete(nameKey);
        reportPhoneAction(action.id, false, 'TwoTimTwo did not record the check-in. Check in at the desk.');
      });
    }

    // Success = the row vanishes (TwoTimTwo removes checked-in kids).
    function verifyAndReport() {
      var deadline = Date.now() + 25000;
      (function verify() {
        if (!findClubberElByName(action.name)) {
          reportDone();
          return;
        }
        if (Date.now() > deadline) {
          phoneNamesInFlight.delete(nameKey);
          reportPhoneAction(action.id, false, 'Row did not clear — check in at the desk');
          return;
        }
        setTimeout(verify, 1000);
      })();
    }

    // F-2: try the direct check-in POST first; fall back to click + poll.
    // Bible / Brought a friend as the phone's card had them (7.7.0).
    var phoneOpts = {};
    if (action.options && typeof action.options.Bible === 'boolean') phoneOpts.Bible = action.options.Bible;
    if (action.options && typeof action.options.Friend === 'boolean') phoneOpts.Friend = action.options.Friend;
    tryDirectCheckin(recid, action.name, clubId, phoneOpts).then(function(ok) {
      if (ok) { reportDone(); return; }
      if (window.__awanaTouchOpen) {
        // The touch screen covers the page: a modal opened now would sit
        // behind it, unseen (the 7.4 freeze). Say so instead.
        phoneNamesInFlight.delete(nameKey);
        reportPhoneAction(action.id, false, 'Could not check in from the phone; check in at the desk');
        return;
      }
      el.click();
      pollForCheckinButton({ name: action.name, element: el }, phoneOpts, 30);
      verifyAndReport();
    });
  }

  // ── Phone undo (7.14.0) ────────────────────────────────────────────────
  // The phone's "Undo check-in": TwoTimTwo's own undo, the call its report's
  // undoCheckin(id) link makes (docs/TWOTIMTWO.md §2.3: POST
  // /clubber/checkinclubberundo with calendar_id and clubber_id, answered with
  // a short snippet ending "(checkin undone)"). Judged as strictly as a
  // check-in's reply: TwoTimTwo's own short answer saying so, never a page,
  // the login form or the bare "Login Required". Each reason a phone can be
  // told is one sentence here (the server keeps 200 characters of it).
  var UNDO_SAY = {
    off: 'Phone check-ins and undos are switched off on the check-in laptop (printer dashboard, Settings, "Allow driven check-ins").',
    'no-id': 'The check-in laptop has no TwoTimTwo id for this child. Use Remove, and undo at the desk.',
    'no-form': 'The printing TwoTimTwo tab on the laptop is not the check-in page. Open the check-in page there and try again.',
    'signed-out': 'The check-in laptop is signed out of TwoTimTwo. Sign in there and try again.',
    refused: 'TwoTimTwo refused the undo (it may have no check-in for this child at tonight\'s meeting). Check at the desk.',
    network: 'The check-in laptop could not reach TwoTimTwo. Check its internet and try again.'
  };

  // One reply, one verdict: 'ok' | 'signed-out' | 'refused'.
  function undoReplyVerdict(text) {
    var t = typeof text === 'string' ? text.trim() : '';
    if (t === 'Login Required' || /name=["']LoginForm\[/.test(t) || /type=["']password["']/i.test(t)) return 'signed-out';
    if (!t || t.length > 4000) return 'refused';   // a snippet; any page is far larger
    if (/<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i.test(t)) return 'refused';
    return /\(\s*checkin\s+undone\s*\)/i.test(t) ? 'ok' : 'refused';
  }

  // The post itself, with this page's meeting id (#calendar_id, kept fresh by
  // ensureFreshCheckinTokens). No meeting id means this tab is not the
  // check-in page, and nothing is sent: an undo filed under no meeting, or
  // last week's, is not one. Resolves 'ok' | 'no-form' | 'signed-out' |
  // 'refused' | 'http-N' | 'network'; never rejects.
  function postUndoCheckin(clubberId) {
    var calInput = document.getElementById('calendar_id');
    var calendarId = calInput && calInput.value;
    if (!calendarId) return Promise.resolve('no-form');
    var body = 'calendar_id=' + encodeURIComponent(calendarId) + '&clubber_id=' + encodeURIComponent(clubberId);
    var csrfToken = findCsrfToken();   // none on the live page; sent only if one appears
    if (csrfToken) body += '&YII_CSRF_TOKEN=' + encodeURIComponent(csrfToken);
    return fetch('/clubber/checkinclubberundo', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body, signal: AbortSignal.timeout(8000)
    }).then(function(r) {
      if (/\/site\/login/.test(r.url || '')) return 'signed-out';
      if (!r.ok) return 'http-' + r.status;
      return r.text().then(undoReplyVerdict);
    }).catch(function() { return 'network'; });
  }

  // The whole undo. A fresh meeting id first; a refusal re-reads the page and
  // posts once more (a refusal is harmless to repeat: the child is either
  // still in, or TwoTimTwo refuses again). Then TwoTimTwo's report must not
  // list the child any more, the same record a phone check-in is held to; an
  // unreadable report leaves the reply's word standing. Resolves
  // { ok, detail }.
  function undoCheckinOnTwoTimTwo(clubberId, name) {
    if (CHURCH_CFG.enableDrivenCheckin === false) return Promise.resolve({ ok: false, detail: UNDO_SAY.off });
    if (!clubberId) return Promise.resolve({ ok: false, detail: UNDO_SAY['no-id'] });
    var id = String(clubberId);
    return ensureFreshCheckinTokens().then(function() {
      return postUndoCheckin(id);
    }).then(function(r) {
      if (r === 'ok' || r === 'signed-out' || r === 'no-form') return r;
      console.log('[Awana] Phone undo for ' + name + ' not confirmed (' + r + '); refreshing the page tokens and trying once more');
      return refreshCheckinTokens().then(function() { return postUndoCheckin(id); });
    }).then(function(r) {
      if (r !== 'ok') {
        var why = UNDO_SAY[r] || (/^http-/.test(r) ? 'TwoTimTwo answered with an error (' + r.replace('http-', 'HTTP ') + '). Check at the desk.' : UNDO_SAY.refused);
        return { ok: false, detail: why };
      }
      return fetchCheckinReport().then(function(entries) {
        if (reportHasCheckin(entries, id, '') === true) {
          return { ok: false, detail: 'TwoTimTwo answered "(checkin undone)" but its report still lists ' + (name || 'the child') + '. Check the report at the desk.' };
        }
        // What TwoTimTwo's own undo leaves on its page: the child's row back
        // in the list, so they can be checked in again here or from a phone.
        var row = document.querySelector('.clubber[recid="' + id.replace(/[^0-9A-Za-z_-]/g, '') + '"]');
        if (row) { row.classList.remove('checked-in'); row.style.display = ''; }
        return { ok: true, detail: '' };
      });
    });
  }

  function driveUndoAction(action) {
    console.log('[Awana] Phone undo: ' + action.name);
    undoCheckinOnTwoTimTwo(action.clubberId, action.name).then(function(r) {
      reportPhoneAction(action.id, r.ok === true, r.detail);
    });
  }

  // ── Phone check-out (7.16.0) ───────────────────────────────────────────
  // The phone's "Check out": TwoTimTwo's own check-out, the call its Checkout
  // page's button makes (the youth sweep's postClubberCheckout: calendar_id
  // from that page and the clubber id, answered exactly "OK"). Nothing else
  // counts. There is no report to confirm it against (the check-in report
  // goes on listing a child after a check-out), so the exact answer is the
  // record. On OK the id joins tonight's checked-out list, posted to the print
  // server with the youth sweep's (so a restarted print server catches up).
  var CHECKOUT_SAY = {
    off: 'Phone check-ins and check-outs are switched off on the check-in laptop (printer dashboard, Settings, "Allow driven check-ins").',
    'no-id': 'The check-in laptop has no TwoTimTwo id for this child, so it cannot check them out there.',
    'signed-out': 'The check-in laptop could not open TwoTimTwo\'s Checkout page (signed out?). Sign in there and try again.',
    'no-meeting': 'TwoTimTwo\'s Checkout page shows no meeting tonight. Check at the desk.',
    refused: 'TwoTimTwo did not answer OK to the check-out (the child may not be checked in at tonight\'s meeting). Check at the desk.',
    network: 'The check-in laptop could not reach TwoTimTwo. Check its internet and try again.'
  };

  // Resolves { ok, detail }; never rejects.
  function checkoutOnTwoTimTwo(clubberId, name) {
    if (CHURCH_CFG.enableDrivenCheckin === false) return Promise.resolve({ ok: false, detail: CHECKOUT_SAY.off });
    if (!clubberId) return Promise.resolve({ ok: false, detail: CHECKOUT_SAY['no-id'] });
    var id = String(clubberId);
    return readCheckoutPage().then(function(page) {
      if (!page.ok) return { ok: false, detail: /meeting/.test(page.error || '') ? CHECKOUT_SAY['no-meeting'] : CHECKOUT_SAY['signed-out'] };
      return postClubberCheckout(page.cal, id).then(function(ok) {
        if (!ok) return { ok: false, detail: CHECKOUT_SAY.refused };
        var done = ymDone(page.date);
        if (done.indexOf(id) === -1) done.push(id);
        ymMarkDone(page.date, done);
        postCheckedOut(page.date, done);
        console.log('[Awana] Phone check-out: ' + (name || id) + ' checked out on TwoTimTwo');
        return { ok: true, detail: '' };
      });
    }).catch(function() { return { ok: false, detail: CHECKOUT_SAY.network }; });
  }

  function driveCheckoutAction(action) {
    console.log('[Awana] Phone check-out: ' + action.name);
    checkoutOnTwoTimTwo(action.clubberId, action.name).then(function(r) {
      reportPhoneAction(action.id, r.ok === true, r.detail);
    });
  }

  function pollPendingActions() {
    if (CHURCH_CFG.enableDrivenCheckin === false) {
      setTimeout(pollPendingActions, 60000);
      return;
    }
    // accept=undo,checkout: this extension can drive the phone's undo
    // (7.14.0) and check-out (7.16.0) too.
    fetch(PRINT_SERVER + '/pending-actions?accept=undo,checkout', { signal: AbortSignal.timeout(30000) })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        (data.actions || []).forEach(executePhoneAction);
        setTimeout(pollPendingActions, 500);
      })
      .catch(function() { setTimeout(pollPendingActions, 10000); });
  }

  // ── R-1: reconcile against TwoTimTwo's own check-in report ─────────────────
  // scanClubberList() infers remote check-ins from rows vanishing off the
  // roster — a heuristic guarded against filters/re-renders/mass-disappear,
  // but still a heuristic. /clubber/checkin_report (docs/TWOTIMTWO.md §2.4) is
  // the authoritative "who is checked in tonight" list, so periodically
  // cross-checking it catches anything the diff engine missed (a station that
  // was asleep, a scan that happened to land on a guard, etc).
  var RECONCILE_MAX_PRINTS          = 5;
  // The FIRST pass still runs a minute after load, deliberately: it is what
  // seeds the session baseline, and a station opened mid-event should not
  // spend five minutes not knowing who is already checked in.
  var RECONCILE_FIRST_DELAY_MS      = 60 * 1000;
  // Every 5 minutes during club, not every 60 seconds. The print server now
  // builds tonight's count out of this report, so the poll is load-bearing
  // rather than a safety net - but it is a full page fetch and parse against
  // the church's own site, and a minute apart is far more traffic than the
  // count needs. The server treats a report as fresh for 12 minutes, which is
  // two of these plus slack, so one missed poll changes nothing. "Sync now" in
  // the widget is still there for the operator who cannot wait.
  var RECONCILE_INTERVAL_CLUB_MS    = 5 * 60 * 1000;
  var RECONCILE_INTERVAL_OFF_MS     = 10 * 60 * 1000;

  function fetchCheckinReport(date) {
    return fetch('/clubber/checkin_report?date=' + (date || todayIsoDate()), { credentials: 'same-origin', signal: AbortSignal.timeout(10000) })
      .then(function(r) { return r.ok && !/\/site\/login/.test(r.url || '') ? r.text() : null; })
      .then(function(html) {
        if (!html) return null;
        var doc = new DOMParser().parseFromString(html, 'text/html');
        // Signed out is the login form (or a redirect to it, above). Never the
        // words "Login Required": every TwoTimTwo page carries them in its own
        // script (its AJAX error handlers), so that test read every report as
        // signed out and this parse never ran on the live site (7.10.0).
        if (doc.querySelector('input[name="LoginForm[password]"]')) return null;
        var tables = doc.querySelectorAll('table');
        if (!tables.length) return null;
        var out = [];
        // The report's own "Count: N" footers, summed: what TwoTimTwo says it
        // lists. Sent with the entries, so a parse that found fewer children
        // than that is known to be partial (7.13.0) instead of being trusted.
        var declared = 0;
        var declaredAll = true;
        tables.forEach(function(table) {
          var titleTh = table.querySelector('th.title');
          var clubImg = titleTh ? titleTh.querySelector('img[alt]') : null;
          var clubName = clubImg ? (clubImg.getAttribute('alt') || '').trim().replace(/&amp;/g, '&') : '';
          if (!clubName) return; // the page's decorative title table
          var totals = table.querySelector('tfoot tr.totals');
          var cm = totals ? /Count:\s*(\d+)/i.exec(totals.textContent || '') : null;
          if (cm) declared += parseInt(cm[1], 10); else declaredAll = false;
          var rows = table.querySelectorAll('tbody tr');
          rows.forEach(function(row) {
            var tds = row.querySelectorAll('td');
            if (!tds.length) return;
            var link = row.querySelector('a[href*="/meeting/clubberCheckin/"]');
            if (!link) return;
            var m = /\/meeting\/clubberCheckin\/(\d+)/.exec(link.getAttribute('href') || '');
            if (!m) return;
            var clubberId = m[1];
            // The name is the text of the cell that holds the edit link, with
            // every link taken out. Live (2026-10-03) that cell is
            // [edit link] Name [undo link]. Only when it holds nothing else is
            // the name in the next cell (the older markup). Reading the next
            // cell FIRST took "YES 1 Share 1 Point" for a name on clubs with
            // those columns: those children merged into one in tonight's count
            // and the missed-check-in pass printed labels with it (2026-10-07).
            var cell = link.closest('td') || tds[0];
            var clone = cell.cloneNode(true);
            clone.querySelectorAll('a').forEach(function(a) { a.remove(); });
            var name = (clone.textContent || '').trim().replace(/\s+/g, ' ');
            if (!name) {
              var next = cell.nextElementSibling;
              name = next ? (next.textContent || '').trim().replace(/\s+/g, ' ') : '';
            }
            // Never a summary cell: no child is called "YES" or "2 Points".
            // (the whole text: a child may be called "No..." or "Yes...").
            if (name && /^(?:(?:yes|no)\b\s*)?(?:\d+\s*(?:shares?|points?)\b\s*)*$/i.test(name)) name = '';
            // No name read: the roster knows this clubber id (the report's id
            // is the roster's recid). Still none: the entry keeps its id for
            // the count, and is never printed (runReconcile skips it).
            if (!name) {
              var known = ROSTER_CACHE['id:' + clubberId];
              if (known && known.displayName) name = known.displayName;
            }
            out.push({ clubberId: clubberId, name: name, club: clubName });
          });
        });
        if (declaredAll) out.declared = declared;
        return out;
      })
      .catch(function(e) {
        console.log('[Awana] Reconcile fetch failed:', e.message);
        return null;
      });
  }

  // Undo detection (roadmap follow-up to R-1): post this SAME authoritative
  // list to the print server on every successful parse, not just when it's
  // used to catch a missed check-in. The server has no way on its own to
  // learn that a check-in it already printed a label for was later undone on
  // TwoTimTwo — its print-history.json only ever grows — so it diffs this
  // report against that history to notice one. `ok: true` is sent ONLY when
  // fetchCheckinReport() actually parsed a real report (never inferred from
  // an empty list, which just as plausibly means a login bounce or a missing
  // table); the server refuses anything without it rather than guess.
  // Best-effort and silent on failure, same as every other feed post in this
  // codebase — a print-server hiccup or an older server build without this
  // route must never interrupt reconcile's own missed-check-in/phantom work.
  function postCheckinReport(entries) {
    fetch(PRINT_SERVER + '/feed/checkin-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        declared: typeof entries.declared === 'number' ? entries.declared : undefined,
        entries: entries.map(function(e) {
          return { clubberId: e.clubberId, name: e.name, club: e.club };
        })
      }),
      signal: AbortSignal.timeout(8000)
    }).catch(function() { /* best-effort — never block reconcile on this */ });
  }

  function updateReconcileWidget(phantomCount) {
    var el = document.getElementById('awana-reconcile-status');
    if (!el) return;
    if (phantomCount > 0) {
      el.textContent = '⚠ ' + phantomCount + ' phantom?';
      el.style.color = '#f59e0b';
      el.title = phantomCount + ' printed name(s) not found in tonight’s TwoTimTwo report';
    } else {
      el.textContent = 'Reconciled ✓';
      el.style.color = '#94a3b8';
      el.title = '';
    }
  }

  function runReconcile() {
    if (reconcileInFlight) return Promise.resolve();
    reconcileInFlight = true;
    return fetchCheckinReport().then(function(entries) {
      reconcileInFlight = false;
      if (entries === null) {
        console.log('[Awana] Reconcile: report unavailable this pass (login required / no tables)');
        return;
      }
      console.log('[Awana] Reconcile: report has ' + entries.length + ' checked-in kid(s)');
      postCheckinReport(entries);
      selfVerifyAgainstReport(entries); // #2: every poll re-checks the didn't-stick list

      if (!reconcileBaselineDone) {
        // First successful reconcile this session: seed dedup with everyone
        // already checked in so we never print the whole existing roster —
        // a station opened mid-event must not trigger a paper explosion.
        // Persisted to the shared dedup store so a reload, or another tab, can't re-baseline.
        entries.forEach(function(e) { markPrinted(e.name, e.clubberId); });
        reconcileBaselineDone = true;
        try { dedupStore.setItem(REMOTE_RECONCILE_BASELINE_KEY, '1'); } catch (err) { /* ignore */ }
        console.log('[Awana] Reconcile: baseline seeded with ' + entries.length + ' existing check-in(s) — will not print for these');
        updateReconcileWidget(0);
        return;
      }

      // Anyone in the report not already printed this session is a check-in
      // the roster-diff detector missed.
      var missed = entries.filter(function(e) { return !isPrinted(e.name, e.clubberId); });

      // Inverse check — TELEMETRY ONLY. Never unprint, never print for this.
      // Note this intentionally also flags plain walk-in prints that were
      // never registered in TwoTimTwo (F-3 checkbox left off) — that's
      // expected noise, not necessarily a real phantom.
      // Match on BOTH the id key and the name key: a child in the report under
      // an id may have been printed under their name (see isPrinted), and
      // counting that as a phantom would cry wolf on every walk-in.
      var reportKeys = new Set();
      entries.forEach(function(e) {
        reportKeys.add(identityKey(e.clubberId, e.name));
        reportKeys.add('nm:' + nameKeyOf(e.name));
      });
      var phantomCount = 0;
      printedNames.forEach(function(key) { if (!reportKeys.has(key)) phantomCount++; });
      if (phantomCount > 0) {
        console.warn('[Awana] Reconcile: ' + phantomCount + ' locally-printed name(s) not present in tonight\'s report (possible phantom print)');
      }
      updateReconcileWidget(phantomCount);

      if (missed.length === 0) return;
      if (missed.length > RECONCILE_MAX_PRINTS) {
        console.warn('[Awana] Reconcile found ' + missed.length + ' missed check-in(s) — printing only ' +
          RECONCILE_MAX_PRINTS + ' this pass (a gap this large means something is wrong; check the roster)');
      }
      missed.slice(0, RECONCILE_MAX_PRINTS).forEach(function(e) {
        // Never a label without a name (an entry whose name could not be read
        // and whose id the roster does not know yet).
        if (!e.name) { console.warn('[Awana] Reconcile: clubber ' + e.clubberId + ' has no readable name; not printing'); return; }
        // Mode check FIRST. Marking before it meant a reconcile tick that fired
        // while a volunteer had printing off (reloading paper) permanently ate
        // those check-ins — flipping the mode back never recovered them, unlike
        // every other detection path, which returns before marking.
        if (selectedMode === 'off') return;
        markPrinted(e.name, e.clubberId);
        var cached = rosterLookupByName(e.name);
        var clubName = (cached && cached.clubName) || e.club || '';
        var clubImageData = (cached && cached.clubImageData) || null;
        console.log('[Awana] Reconcile: printing missed check-in for ' + e.name);
        doPrint(e.name, clubName, clubImageData, 'reconcile', e.clubberId);
      });
    }).catch(function(err) {
      reconcileInFlight = false;
      console.log('[Awana] Reconcile error:', err.message);
    });
  }

  function scheduleNextReconcile() {
    var delay = isInClubWindow() ? RECONCILE_INTERVAL_CLUB_MS : RECONCILE_INTERVAL_OFF_MS;
    setTimeout(function() {
      runReconcile().then(scheduleNextReconcile).catch(scheduleNextReconcile);
    }, delay);
  }

  // ── Selector self-test ───────────────────────────────────────────────────────
  // The whole detection pipeline hangs off a handful of TwoTimTwo DOM
  // selectors. If the site ships a redesign, everything fails SILENTLY — the
  // widget still shows green and nobody notices until kids stop getting
  // labels. This probes the live DOM every 10 minutes, reports to the server
  // (dashboard Night Status card), and throws a loud page banner on hard
  // failure. Modal selectors (#checkin-modal, button#checkin) only exist
  // while a modal is open, so they're verified passively by the driven
  // check-in paths, not here.
  var SELFTEST_INTERVAL_MS = 10 * 60 * 1000;
  var selectorBannerShown = false;

  function runSelectorSelfTest() {
    var results = [];
    try {
      var clubberEls = document.querySelectorAll('.clubber');
      results.push({ check: '.clubber roster rows', passed: clubberEls.length > 0, detail: clubberEls.length + ' row(s)' });

      var namesOk = false, iconsOk = false;
      if (clubberEls.length > 0) {
        for (var i = 0; i < clubberEls.length; i++) {
          if (clubberEls[i].querySelector('.name')) { namesOk = true; break; }
        }
        for (var j = 0; j < clubberEls.length; j++) {
          if (clubberEls[j].querySelector('.club img')) { iconsOk = true; break; }
        }
        results.push({ check: '.clubber .name', passed: namesOk, detail: namesOk ? '' : 'no .name inside any .clubber row' });
        // Missing icons only degrade the label (monogram fallback) — soft check.
        results.push({ check: '.club img icons', passed: iconsOk, detail: iconsOk ? '' : 'no club icons found (labels fall back to monograms)' });
      }

      var lastCheckinOk = !!document.querySelector('#lastCheckin');
      results.push({ check: '#lastCheckin', passed: lastCheckinOk, detail: lastCheckinOk ? '' : 'local check-in detection is blind' });

      // Hard failure = the load-bearing selectors are gone while the page has
      // real content (an empty roster after everyone checks in is normal).
      var pageHasContent = document.body && document.body.children.length > 3;
      var hard = pageHasContent && (!lastCheckinOk || (clubberEls.length > 0 && !namesOk));
      var ok = !hard;

      fetch(PRINT_SERVER + '/selftest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: ok, results: results, extensionVersion: EXTENSION_VERSION }),
        signal: AbortSignal.timeout(3000)
      }).catch(function() { /* server offline — dashboard will show stale */ });

      if (hard && !selectorBannerShown) {
        selectorBannerShown = true;
        var banner = document.createElement('div');
        banner.id = 'awana-selector-banner';
        banner.textContent = '⚠ CLUB PRINTER: the check-in page layout has changed — automatic label printing may be broken. Use the widget search or walk-in printing, and check the dashboard.';
        Object.assign(banner.style, {
          position: 'fixed', top: '0', left: '0', right: '0', zIndex: '2147483647',
          background: '#dc2626', color: '#fff', fontWeight: '700',
          fontSize: '14px', padding: '10px 16px', textAlign: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.35)'
        });
        document.body.appendChild(banner);
      } else if (!hard && selectorBannerShown) {
        selectorBannerShown = false;
        var existing = document.getElementById('awana-selector-banner');
        if (existing) existing.remove();
      }
      return ok;
    } catch (e) {
      console.log('[Awana] Selector self-test error:', e);
      return true; // a broken probe must not cry wolf
    }
  }

  // ── Contract-drift canary (#3) ───────────────────────────────────────────────
  // The 10-minute self-test above probes the three passive DOM selectors. This
  // is the FULL sweep of everything docs/TWOTIMTWO.md documents as load-bearing
  // — roster attributes, the check-in form contract, the authoritative
  // checkin_report parse, and the roster CSV export — so a TwoTimTwo redesign
  // is caught the first time the page is opened that day (i.e. BEFORE club
  // night), not mid-event when a modal click silently stops working. Runs
  // automatically once per calendar day plus on demand from the widget button;
  // results go to the server (dashboard Night Status card + tray alert).
  // Read-only by design: it never clicks, posts a check-in, or prints.
  var CONTRACT_CANARY_STAMP_KEY = 'awana_contractCanaryLastDay';
  var contractCanaryRunning = false;

  function runContractCanary(manual) {
    if (contractCanaryRunning) return Promise.resolve(null);
    contractCanaryRunning = true;
    var results = [];
    // soft: a check that can legitimately fail outside a live meeting (no
    // report tables on a Saturday, CSRF input not rendered off-day). Soft
    // misses are shown as info but never flip the sweep to FAILING — the
    // first real-world run cried DRIFT on a quiet weekend for exactly this.
    var push = function(check, passed, detail, soft) {
      results.push({ check: check, passed: !!passed, detail: detail || '', soft: !!soft && !passed });
    };

    // A: roster DOM contract (superset of the passive self-test).
    var clubberEls = document.querySelectorAll('.clubber');
    var pageHasContent = document.body && document.body.children.length > 3;
    var rosterPresent = clubberEls.length > 0;
    push('.clubber roster rows', rosterPresent || !pageHasContent, clubberEls.length + ' row(s)');
    if (rosterPresent) {
      var first = clubberEls[0];
      push('.clubber .name', !!first.querySelector('.name'));
      push('.clubber .club img[alt]', !!first.querySelector('.club img[alt]'), 'club name + icon source');
      push('.clubber[recid] identity attr', first.hasAttribute('recid'), 'exact-identity match + direct check-in');
      push('.clubber[club_id] attr', first.hasAttribute('club_id'), 'events[] club applicability');
    }
    push('#lastCheckin', !!document.querySelector('#lastCheckin'), 'local check-in detection');

    // B: check-in form contract (read statically — never clicks anything).
    var calInput = document.getElementById('calendar_id');
    push('#calendar_id has a meeting id', !!(calInput && calInput.value), 'direct check-in needs it');
    push('YII_CSRF_TOKEN findable', !!findCsrfToken(),
      'often absent outside a live meeting; direct check-in falls back to the click path', true);
    push('input.event[name="events[]"] rows', document.querySelectorAll('input.event[name="events[]"]').length > 0,
      'check-in items (Attendance etc.)');

    // C: the two HTTP contracts, both read-only.
    var reportCheck = fetch('/clubber/checkin_report?date=' + todayIsoDate(), {
      credentials: 'same-origin', signal: AbortSignal.timeout(15000)
    }).then(function(r) { return r.ok ? r.text() : null; }).then(function(html) {
      if (!html) {
        push('/clubber/checkin_report parses', false, 'fetch failed (HTTP error)');
      } else if (/name="LoginForm\[password\]"/.test(html)) {
        // The login form, never the words "Login Required" (every page's own
        // script carries them; see fetchCheckinReport).
        push('/clubber/checkin_report parses', false, 'login bounce — session expired?');
      } else {
        var tables = new DOMParser().parseFromString(html, 'text/html').querySelectorAll('table').length;
        push('/clubber/checkin_report parses', tables > 0,
          tables > 0 ? tables + ' report table(s) found'
                     : 'page loads but has no meeting tables — normal on a non-club day', true);
      }
    }).catch(function(e) {
      push('/clubber/checkin_report parses', false, e.message);
    });
    var csvCheck = fetch('/clubber/csv', { credentials: 'same-origin', signal: AbortSignal.timeout(15000) })
      .then(function(r) { return r.ok ? r.text() : null; })
      .then(function(text) {
        var header = text ? String(text).split(/\r?\n/, 1)[0] : '';
        push('/clubber/csv roster export', !!text && header.indexOf('Clubber ID') !== -1,
          text ? ('header: ' + header.slice(0, 80)) : 'fetch failed');
      })
      .catch(function(e) {
        push('/clubber/csv roster export', false, e.message);
      });

    return Promise.all([reportCheck, csvCheck]).then(function() {
      contractCanaryRunning = false;
      var ok = results.every(function(r) { return r.passed || r.soft; });
      console.log('[Awana] Contract canary (' + (manual ? 'manual' : 'auto') + '): ' +
        (ok ? 'all checks passed' : 'DRIFT DETECTED') + ' — ' + results.length + ' check(s)');
      fetch(PRINT_SERVER + '/contract-canary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: ok, results: results, extensionVersion: EXTENSION_VERSION, manual: manual === true }),
        signal: AbortSignal.timeout(5000)
      }).catch(function() { /* server offline — the widget still shows it */ });
      return { ok: ok, results: results };
    }).catch(function(e) {
      contractCanaryRunning = false;
      console.log('[Awana] Contract canary error:', e);
      return null; // a broken probe must not cry wolf
    });
  }

  function maybeRunDailyContractCanary() {
    var today = todayIsoDate();
    try {
      if (localStorage.getItem(CONTRACT_CANARY_STAMP_KEY) === today) return;
    } catch (e) { /* storage blocked — run anyway */ }
    // An empty page (login bounce, slow load) must not burn the day's run.
    if (!document.body || document.body.children.length <= 3) return;
    runContractCanary(false).then(function(r) {
      if (!r) return;
      try { localStorage.setItem(CONTRACT_CANARY_STAMP_KEY, today); } catch (e) { /* ignore */ }
    });
  }

  // ── Quick Mode: one-click check-in interceptor ──────────────────────────────
  // When Quick Mode is ON, intercept clicks on .clubber elements. Let the native
  // click flow through (TwoTimTwo opens its modal), then auto-dismiss the modal.
  // We print immediately — before the modal even opens — since we already have
  // the name + club info.  The existing onCheckin() path also fires when
  // #lastCheckin updates, but printedNames dedup prevents a double print.
  var _quickModeProcessing = false;
  document.body.addEventListener('click', function(e) {
    if (!quickModeEnabled) return;
    if (_quickModeProcessing) return;
    var clubberEl = e.target.closest('.clubber');
    if (!clubberEl) return;
    var nameEl = clubberEl.querySelector('.name');
    if (!nameEl) return;
    var name = nameEl.innerText.trim();
    if (!name) return;
    if (selectedMode === 'off') return;
    var recid = clubberEl.getAttribute('recid') || null;
    if (isPrinted(name, recid)) return; // already printed
    var batchKey = resolveIdentityKey(name, recid);
    if (batchPrintedNames.has(batchKey)) return;

    console.log('[Awana] Quick Mode check-in:', name);
    // Print immediately
    markPrinted(name, recid);
    batchPrintedNames.add(batchKey);
    setTimeout(function() { batchPrintedNames.delete(batchKey); }, 8000);
    var club = lookupClub(name);
    doPrint(name, club.clubName, club.clubImageData, undefined, recid);

    // F-2: try the direct check-in POST first — this blocks TwoTimTwo's own
    // click handler from ever opening a modal at all. Only if the direct path
    // is unavailable/fails do we replay the click and fall back to the
    // original open-modal + auto-dismiss dance.
    if (recid && CHURCH_CFG.enableDrivenCheckin !== false) {
      e.preventDefault();
      e.stopPropagation();
      var clubId = clubberEl.getAttribute('club_id') || null;
      tryDirectCheckin(recid, name, clubId, {}).then(function(ok) {
        if (ok) return;
        _quickModeProcessing = true;
        clubberEl.click();
        setTimeout(function() {
          pollForCheckinButton({ name: name, element: clubberEl }, {}, 30);
          setTimeout(function() { _quickModeProcessing = false; }, 500);
        }, 150);
      });
      return;
    }

    // Let native click open the modal, then auto-dismiss after 150ms
    setTimeout(function() {
      _quickModeProcessing = true;
      pollForCheckinButton({ name: name, element: clubberEl }, {}, 30);
      setTimeout(function() { _quickModeProcessing = false; }, 500);
    }, 150);
  }, true); // capture phase

  // ── Touch check-in's way in (7.1.0) ───────────────────────────────────────
  // touch.js (the full-screen touch check-in, a second content script) checks
  // children in through THIS, so it is the exact path Quick Mode uses: the
  // label prints first (same dedupe), then the direct POST to TwoTimTwo, and
  // only if that cannot be verified TwoTimTwo's own modal, driven with the
  // same Bible / Friend options. Content scripts share one isolated world, so
  // this object is visible to touch.js and never to the TwoTimTwo page.
  // ── Touch check-in's own path (7.4.1) ──────────────────────────────────────
  // The touch screen covers the whole page, so it must never fall back to
  // clicking a row: TwoTimTwo's modal then opened BEHIND the screen, stacked
  // up a few check-ins later, and left its grey backdrop over the page after
  // Close (the owner's "page becomes unresponsive"). It posts directly, judges
  // success by TwoTimTwo's own answer, and drops the row by its recid (a
  // name-text match missed rows whose name differed by a space or a nickname,
  // which was what sent check-ins to the modal in the first place). A failed
  // post re-reads the check-in page in the background for a fresh CSRF token
  // and calendar id, and tries once more; then it says so.
  var touchQueue = Promise.resolve();

  // A row TwoTimTwo has checked in stays in the page, hidden, with
  // .checked-in; that child is not there to check in any more.
  function rowByRecid(recid) {
    return recid ? document.querySelector('.clubber[recid="' + String(recid).replace(/[^0-9A-Za-z_-]/g, '') + '"]:not(.checked-in)') : null;
  }

  // The meeting id (#calendar_id) and any CSRF token are read from the page as
  // it was LOADED. The check-in tab stays open for days, so by club night a
  // direct post carried last week's meeting: TwoTimTwo answered as if it had
  // worked (its snippet) and filed the check-in under the old meeting, or
  // refused it. Before 7.11.0 only the touch screen refreshed, and only after a
  // refusal, which the stale-but-accepted case never produces. Now every
  // direct post (phone, Quick Mode, touch) starts from a page copy no older
  // than CHECKIN_TOKENS.freshMs, one fetch of the page every few minutes.
  var CHECKIN_TOKENS = { at: Date.now(), freshMs: 5 * 60 * 1000 };
  function ensureFreshCheckinTokens() {
    if (Date.now() - CHECKIN_TOKENS.at < CHECKIN_TOKENS.freshMs) return Promise.resolve(true);
    return refreshCheckinTokens();
  }

  function refreshCheckinTokens() {
    return fetch(location.pathname + location.search, { credentials: 'same-origin', signal: AbortSignal.timeout(8000) })
      .then(function(r) { return r.ok ? r.text() : ''; })
      .then(function(html) {
        if (!html) return false;
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var tok = doc.querySelector('input[name="YII_CSRF_TOKEN"]');
        var cal = doc.getElementById('calendar_id');
        if (tok && tok.value) document.querySelectorAll('input[name="YII_CSRF_TOKEN"]').forEach(function(i) { i.value = tok.value; });
        var mine = document.getElementById('calendar_id');
        if (cal && cal.value && mine) mine.value = cal.value;
        if (cal && cal.value) CHECKIN_TOKENS.at = Date.now();
        return !!(cal && cal.value);
      })
      .catch(function() { return false; });
  }

  function postTouchCheckin(recid, name, clubId, options) {
    var calInput = document.getElementById('calendar_id');
    var calendarId = calInput && calInput.value;
    // TwoTimTwo's own check-in posts #checkinForm as it is: clubber_id,
    // calendar_id and events[], and NO CSRF token (live page, 2026-10-03: the
    // check-in page carries none). Requiring one sent every touch check-in to
    // the hidden modal. A token is still sent if a page ever has one.
    var csrfToken = findCsrfToken();
    if (!calendarId) return Promise.resolve('no-form');
    var body = 'clubber_id=' + encodeURIComponent(recid) + '&calendar_id=' + encodeURIComponent(calendarId);
    collectApplicableEvents(clubId, options).forEach(function(v) { body += '&events%5B%5D=' + encodeURIComponent(v); });
    if (csrfToken) body += '&YII_CSRF_TOKEN=' + encodeURIComponent(csrfToken);
    return fetch('/clubber/checkinclubber', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body, signal: AbortSignal.timeout(8000)
    }).then(function(r) {
      if (!r.ok) return 'http-' + r.status;
      return r.text().then(function(text) {
        if (!checkinReplyOk(text, name)) return 'no-confirm';
        // What TwoTimTwo's own success handler does: mark the row checked in
        // and hide it (its name filter and undo both expect the row to stay).
        var row = rowByRecid(recid);
        if (row) { row.classList.add('checked-in'); row.style.display = 'none'; }
        var last = document.querySelector('#lastCheckin div');
        if (last) last.innerHTML = text;   // what TwoTimTwo's own success handler does
        return 'ok';
      });
    }).catch(function() { return 'network'; });
  }

  function touchCheckin(recid, name, clubId, options) {
    return ensureFreshCheckinTokens().then(function() {
      return postTouchCheckin(recid, name, clubId, options);
    }).then(function(r) {
      if (r === 'ok') return r;
      console.log('[Awana] Touch check-in for ' + name + ' failed (' + r + '); refreshing the page tokens and trying once more');
      return refreshCheckinTokens().then(function() { return postTouchCheckin(recid, name, clubId, options); });
    });
  }

  // TwoTimTwo's modal or its backdrop, left behind by anything: closed, so
  // the page answers clicks again when the touch screen goes away.
  function clearStuckModal() {
    var m = document.getElementById('checkin-modal');
    if (m && window.getComputedStyle(m).display !== 'none') {
      var x = m.querySelector('[data-dismiss="modal"], [data-bs-dismiss="modal"], .close, .btn-close');
      if (x) x.click();
      m.style.display = 'none';
      m.classList.remove('in', 'show');
    }
    document.querySelectorAll('.modal-backdrop').forEach(function(b) { b.remove(); });
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('padding-right');
    document.body.style.removeProperty('overflow');
  }

  window.__awanaTouchApi = {
    // Resolves 'direct' (posted and confirmed by TwoTimTwo) or 'gone' (no such
    // row: already in). Rejects with Error(reason) when it could not check in.
    // Never opens TwoTimTwo's modal (see touchCheckin). One at a time.
    checkIn: function(recid, options) {
      var el = rowByRecid(recid);
      if (!el) return Promise.resolve('gone');
      var nameEl = el.querySelector('.name');
      var name = nameEl ? nameEl.innerText.trim() : '';
      var clubId = el.getAttribute('club_id') || null;
      var opts = options || {};
      if (name && selectedMode !== 'off' && !isPrinted(name, recid)) {
        var batchKey = resolveIdentityKey(name, recid);
        if (!batchPrintedNames.has(batchKey)) {
          markPrinted(name, recid);
          batchPrintedNames.add(batchKey);
          setTimeout(function() { batchPrintedNames.delete(batchKey); }, 8000);
          var club = lookupClub(name);
          doPrint(name, club.clubName, club.clubImageData, undefined, recid);
        }
      }
      var run = touchQueue.then(function() {
        if (!rowByRecid(recid)) return 'gone';
        return touchCheckin(recid, name, clubId, opts).then(function(r) {
          if (r === 'ok') return 'direct';
          if (!rowByRecid(recid)) return 'gone';
          throw new Error(r);
        });
      });
      touchQueue = run.catch(function() {});
      return run;
    },
    // Closing the touch screen: clear anything TwoTimTwo left over the page,
    // and reload it when children were checked in, so its own lists, counts
    // and token are fresh. Waits for the print queue to empty first.
    closed: function(checkedIn) {
      clearStuckModal();
      if (!checkedIn) return;
      var tries = 0;
      (function reloadWhenIdle() {
        if (window.__awanaTouchOpen) return;           // reopened meanwhile
        if ((getQueue().length > 0 || _quickModeProcessing) && ++tries < 20) { setTimeout(reloadWhenIdle, 500); return; }
        touchQueue.then(function() { if (!window.__awanaTouchOpen) location.reload(); });
      })();
    },
    // Tonight's live check-ins from the print server (the panel's own Tonight
    // list), as "first last" keys; empty when the server can't be reached.
    tonight: function() {
      return fetch(PRINT_SERVER + '/history/today', { signal: AbortSignal.timeout(3000) })
        .then(function(r) { return r.ok ? r.json() : []; })
        .then(function(all) {
          return (all || []).filter(function(e) {
            return e && e.success !== false && !e.undone && !e.isAward && !e.isConnectCard && !e.isLeader && !e.oneOff;
          }).map(function(e) { return { name: ((e.firstName || '') + ' ' + (e.lastName || '')).trim(), at: e.timestamp || e.at || null, clubName: e.clubName || '' }; });
        })
        .catch(function() { return []; });
    },
    // Who was at either of the last two club nights (the print server's
    // attendance ledger), for the touch check-in's bottom row; null on error.
    recent: function() {
      return fetch(PRINT_SERVER + '/touch/recent', { signal: AbortSignal.timeout(3000) })
        .then(function(r) { return r.ok ? r.json() : null; })
        .catch(function() { return null; });
    },
    // The phone page's families and Bible/Friend clubs (7.7.0), to the print
    // server: names and club names only.
    shareContext: function(payload) {
      return fetch(PRINT_SERVER + '/touch/context', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(5000),
      }).catch(function() { /* print app not running: phones keep the last copy */ });
    },
    // A one-off name tag (7.18.0): a typed first name and a club, printed and
    // welcomed on the screens, never a check-in and never counted. Resolves
    // the server's answer ({success, duplicate?, demo?}); rejects with
    // Error(the server's own message) on a refusal or a printer failure.
    printOneOff: function(firstName, clubName) {
      return fetch(PRINT_SERVER + '/print-oneoff', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName: firstName, clubName: clubName, printerName: selectedPrinterName || '' }),
        signal: AbortSignal.timeout(20000),
      }).then(function(r) {
        return r.json().catch(function() { return {}; }).then(function(d) {
          if (!r.ok || !d || d.success !== true) throw new Error((d && d.error) || 'The tag did not print.');
          return d;
        });
      }, function() { throw new Error('Can\u2019t reach the print app. Is it running?'); });
    },
    // Undo check-in from the touch screen (7.18.0): tonight's counted children
    // with what an undo needs (POST /phone/tonight; loopback, so no PIN), the
    // undo itself (POST /phone/undo: inTwoTimTwo for a child with a TwoTimTwo
    // id, queued for this tab's own poller exactly like the phone's Undo
    // check-in; without one it is the local Remove), and its progress
    // (GET /phone/status/:id). Each rejects with Error(the server's message);
    // a status the server has lost rejects with err.status 404.
    tonightEntries: function() {
      return fetch(PRINT_SERVER + '/phone/tonight', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        signal: AbortSignal.timeout(5000),
      }).then(function(r) {
        if (!r.ok) throw new Error('The print app did not answer (HTTP ' + r.status + ').');
        return r.json();
      }, function() { throw new Error('Can\u2019t reach the print app. Is it running?'); })
        .then(function(d) { return (d && Array.isArray(d.entries)) ? d.entries : []; });
    },
    undoCheckin: function(entry, inTwoTimTwo) {
      var body = { firstName: entry.firstName || '', lastName: entry.lastName || '', clubberId: entry.clubberId || null };
      if (inTwoTimTwo) body.inTwoTimTwo = true;
      return fetch(PRINT_SERVER + '/phone/undo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
      }).then(function(r) {
        return r.json().catch(function() { return {}; }).then(function(d) {
          if (!r.ok) { var e = new Error((d && d.error) || 'The print app refused that (HTTP ' + r.status + ').'); e.status = r.status; throw e; }
          return d || {};
        });
      }, function() { throw new Error('Can\u2019t reach the print app. Is it running?'); });
    },
    undoStatus: function(id) {
      return fetch(PRINT_SERVER + '/phone/status/' + encodeURIComponent(id), { signal: AbortSignal.timeout(5000) })
        .then(function(r) {
          return r.json().catch(function() { return {}; }).then(function(d) {
            if (!r.ok) { var e = new Error((d && d.error) || 'HTTP ' + r.status); e.status = r.status; throw e; }
            return d || {};
          });
        });
    },
    printServer: PRINT_SERVER,
  };

  // ── One printing tab ─────────────────────────────────────────────────────
  // Every TwoTimTwo tab in this browser runs this script, and until 7.11.1
  // every one of them detected, scanned, reconciled, polled the phones and
  // flushed the queue: a second tab printed its own copy of every label. One
  // tab now holds the "awana-print-leader" Web Lock and runs the print
  // machinery; the others keep the widget (search, settings, reprints,
  // tonight) and say so. The lock passes to the next tab the moment the
  // leader closes, and the shared dedup store means the new leader does not
  // print the night again. No Web Locks (an old Chrome): the tab leads alone.
  var PRINT_LEADER_LOCK = 'awana-print-leader';
  function electPrintLeader(locks, onLead, onWait) {
    if (!locks || typeof locks.request !== 'function') { onLead(); return; }
    var led = false;
    var lead = function() { if (!led) { led = true; onLead(); } };
    var waiting = false;
    try {
      var p = locks.request(PRINT_LEADER_LOCK, { mode: 'exclusive' }, function() {
        lead();
        return new Promise(function() { /* held for the life of this tab */ });
      });
      if (p && typeof p.catch === 'function') p.catch(function() { lead(); });
      if (typeof locks.query === 'function') {
        locks.query().then(function(q) {
          var held = (q && q.held || []).some(function(l) { return l.name === PRINT_LEADER_LOCK; });
          if (held && !led && onWait) { waiting = true; onWait(); }
        }).catch(function() { /* no answer: nothing to say */ });
      }
    } catch (e) { lead(); }
    return function isWaiting() { return waiting && !led; };
  }

  // Every boot step on its own: one exception in the 2,200-line injectWidget()
  // (a TwoTimTwo markup change, a missing element) used to end the script
  // right there, before detection, the queue flush or the phone poll had
  // started, so the desk printed nothing and the console said why to nobody.
  // A step that fails is logged and the rest still boot.
  function bootStep(label, fn) {
    try { fn(); } catch (e) { console.error('[Awana] ' + label + ' failed at boot: ' + (e && e.message ? e.message : e)); }
  }

  bootStep('widget', injectWidget);
  loadPrintedState();
  // Restore Step Up Night and Awana Store mode (chrome.storage.local survives
  // extension updates).
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.remove('awana_selectedPrinterName');
    chrome.storage.local.get(['awana_stepUpMode', 'awana_storeMode'], function(result) {
      if (result.awana_stepUpMode && result.awana_stepUpMode !== stepUpMode) {
        stepUpMode = result.awana_stepUpMode;
        localStorage.setItem(STEP_UP_KEY, stepUpMode);
        var sus = document.getElementById('awana-stepup-select');
        if (sus) sus.value = stepUpMode;
      }
      if (result.awana_storeMode && result.awana_storeMode !== storeMode) {
        storeMode = result.awana_storeMode;
        localStorage.setItem(STORE_KEY, storeMode);
        var sst = document.getElementById('awana-store-select');
        if (sst) sst.value = storeMode;
        if (isAwanaStoreNight()) fetchShareBalances();
      }
    });
    chrome.storage.onChanged && chrome.storage.onChanged.addListener(function(changes, area) {
      if (area !== 'local') return;
      if (changes.awana_stepUpMode) {
        stepUpMode = changes.awana_stepUpMode.newValue || 'auto';
        localStorage.setItem(STEP_UP_KEY, stepUpMode);
        var sus = document.getElementById('awana-stepup-select');
        if (sus) sus.value = stepUpMode;
      }
      if (changes.awana_storeMode) {
        storeMode = changes.awana_storeMode.newValue || 'auto';
        localStorage.setItem(STORE_KEY, storeMode);
        var sst = document.getElementById('awana-store-select');
        if (sst) sst.value = storeMode;
        if (isAwanaStoreNight()) fetchShareBalances();
      }
    });
  }
  // What every tab runs: the widget's own data, read-only probes, update checks.
  bootStep('brand fonts', loadBrandFonts);
  bootStep('printer list', fetchPrinters);
  setInterval(fetchPrinters, 120000);   // keeps the ready dot honest
  bootStep('tonight', loadTonight);
  bootStep('count check', loadCountCheck);
  // If the page produced no roster (site down, offline reload, or this tab is
  // not the printing one), fall back to the copy cached in chrome.storage.local
  // so search still works.
  setTimeout(restoreRosterFromLocal, 2000);
  bootStep('church config', loadChurchConfig);
  bootStep('update check', checkForExtensionUpdate);
  // Periodically check server health for CSV warnings + update notices
  setInterval(checkForExtensionUpdate, 60000);
  // Selector self-test: first probe after the page settles, then every 10 min
  setTimeout(runSelectorSelfTest, 15000);
  setInterval(runSelectorSelfTest, SELFTEST_INTERVAL_MS);
  // Keep the Tonight list fresh while the panel is expanded (other stations
  // print too — their check-ins should show up here for reprints).
  setInterval(function() {
    var panel = document.getElementById('awana-panel');
    if (panel && panel.style.display !== 'none') { loadTonight(); loadCountCheck(); }
  }, 60000);
  updateQueueBadge();

  // What only the printing tab runs: everything that detects a check-in,
  // prints, reconciles, drives phone actions or writes to the print server.
  function startPrintMachinery() {
    bootStep('printed state', loadPrintedState);   // the shared store as it stands now, not at this tab's load
    bootStep('check-in watcher', watchCheckins);
    // Establish the roster baseline on load (or re-populate ROSTER_CACHE after a
    // reload that preserved baselineScanned in the shared dedup store).
    setTimeout(scanClubberList, 500);
    // Safety-net scan in case the MutationObserver misses a DOM change —
    // adaptive (#17a): 2 s inside the club-night window so remote check-ins
    // print fast at the door, 5 s the rest of the week. Self-rescheduling
    // setTimeout instead of setInterval so a slow scan can never stack.
    (function scheduleScan() {
      setTimeout(function() {
        try { scanClubberList(); } catch (e) { /* keep scanning */ }
        scheduleScan();
      }, isInClubWindow() ? 2000 : SCAN_INTERVAL_MS);
    })();
    // Peak-window auto-refresh
    setInterval(autoRefresh, AUTO_REFRESH_INTERVAL_MS);
    // Youth check-out: every half minute; it does nothing before 7:15 on a club night.
    setInterval(function() { ymSweep(false); }, YM_SWEEP_MS);
    setTimeout(pollPendingActions, 4000);
    bootStep('roster sync', syncCsv);
    // Contract canary (#3): once per day, shortly after the page settles.
    setTimeout(maybeRunDailyContractCanary, 45000);
    // R-1: first reconcile pass ~60s after load, then self-reschedules based on
    // isInClubWindow() (every 60s in-window, every 10 min otherwise).
    setTimeout(function() {
      runReconcile().then(scheduleNextReconcile).catch(scheduleNextReconcile);
    }, RECONCILE_FIRST_DELAY_MS);
    // Flush any queued prints on startup
    setTimeout(flushQueue, 3000);
    // Periodically try to flush queue
    setInterval(function() {
      if (getQueue().length > 0) flushQueue();
    }, 30000);
    setStatus('');
    console.log('[Awana] This tab prints');
  }
  electPrintLeader(typeof navigator !== 'undefined' ? navigator.locks : null, startPrintMachinery, function() {
    setStatus('Another TwoTimTwo tab is printing; this one only looks things up.');
    console.log('[Awana] Another tab holds the print lock; waiting');
  });

  console.log('[Awana] Extension loaded (v' + EXTENSION_VERSION + ')');
})();
