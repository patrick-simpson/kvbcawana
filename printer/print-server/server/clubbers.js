'use strict';
// In-memory CSV snapshot, CSV parser, clubbers, duplicate-print suppression, finding a child.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const lazy = require('./lazy');
const fs    = require('fs');
const $config = lazy('./config');
const $eligibility = lazy('./eligibility');

// What other modules (and server.js) read from this one; live bindings, so cycles are safe.
Object.defineProperties(exports, {
  claimPrint: { enumerable: true, get: () => claimPrint },
  clubbers: { enumerable: true, get: () => clubbers, set: (v) => { clubbers = v; } },
  DUPLICATE_WINDOW_MS: { enumerable: true, get: () => DUPLICATE_WINDOW_MS },
  findClubber: { enumerable: true, get: () => findClubber },
  findClubberIn: { enumerable: true, get: () => findClubberIn },
  isDuplicatePrint: { enumerable: true, get: () => isDuplicatePrint },
  loadClubbers: { enumerable: true, get: () => loadClubbers },
  normalizeHeader: { enumerable: true, get: () => normalizeHeader },
  parseCSV: { enumerable: true, get: () => parseCSV },
  recordPrint: { enumerable: true, get: () => recordPrint },
  releasePrint: { enumerable: true, get: () => releasePrint },
});

// ── In-memory CSV snapshot ────────────────────────────────────────────────────
// Populated at startup and refreshed on every POST /print so changes to
// clubbers.csv (e.g. added mid-event) are picked up automatically.
let clubbers = [];

// ── CSV parser ────────────────────────────────────────────────────────────────
// Parses a raw CSV string into an array of plain objects keyed by canonical
// field names.  Handles both the TwoTimTwo export (quoted fields, spaces in
// headers like "First Name") and the manual clubbers-template.csv format
// ("FirstName").  Returns [] on empty input or any parse error — never throws.

// Map every known header variation to a canonical key.
// Add new mappings here if TwoTimTwo ever renames a column.
const HEADER_MAP = {
  // canonical ← variations (all compared lowercase, spaces/underscores stripped)
  'firstname':      'FirstName',
  'first name':     'FirstName',
  'first_name':     'FirstName',
  'lastname':       'LastName',
  'last name':      'LastName',
  'last_name':      'LastName',
  'birthdate':      'Birthdate',
  'birth date':     'Birthdate',
  'birthday':       'Birthdate',
  'date of birth':  'Birthdate',
  'dob':            'Birthdate',
  'allergies':      'Allergies',
  'allergy':        'Allergies',
  'notes':          'Notes',
  'handbookgroup':  'HandbookGroup',
  'handbook group': 'HandbookGroup',
  'handbook_group': 'HandbookGroup',
  'handbook':       'HandbookGroup',
  'handbook time':  'HandbookGroup',
  'med release':      'MedRelease',
  'medrelease':       'MedRelease',
  'med_release':      'MedRelease',
  'medical release':  'MedRelease',
  // TwoTimTwo exports BOTH "Med Release?" and "Photo Release?", but which
  // one a church actually fills in varies — KVB records the MEDIA release
  // under "Med Release?" and never touches "Photo Release?". Both map to
  // their own key and noPhotoFor() flags on an explicit "no" in either.
  'media release':    'PhotoRelease',
  'mediarelease':     'PhotoRelease',
  'photo release':    'PhotoRelease',
  'photo permission': 'PhotoRelease',
  'club':           'Club',
  'group':          'Group',
  'color':          'Color',
  'grade':          'Grade',
  'gender':         'Gender',
  'clubber id':     'ClubberID',
  'clubberid':      'ClubberID',
  'inactive':       'Inactive',
  'book':           'Book',
  'share balance':   'ShareBalance',
  'sharebalance':    'ShareBalance',
  'leader notes':    'LeaderNotes',
};


function normalizeHeader(raw) {
  // Trailing punctuation must be stripped: the real export names several
  // columns with a question mark ("Med Release?", "Photo Release?") which
  // otherwise never match the map.
  const key = raw.toLowerCase().replace(/[_\s]+/g, ' ').replace(/[?!.:]+$/, '').trim();
  if (HEADER_MAP[key]) return HEADER_MAP[key];
  // The two consent columns get a shape match as well as the exact one. A
  // renamed export ("Photo/Video Release?", "Photo Release (Y/N)", "Medical
  // Release Signed?") used to fall straight through as an unknown header, and
  // an unknown header means noPhotoFor() never sees the column: every child
  // prints as photographable and nothing says why. Consent is the one field
  // where silently losing the column is worse than an imperfect match.
  if (/release|consent|permission|waiver/.test(key)) {
    if (/photo|picture|pictures|image|video|media/.test(key)) return 'PhotoRelease';
    if (/\bmed\b|medical/.test(key)) return 'MedRelease';
  }
  return raw;  // keep original if no mapping found
}

function parseCSV(raw) {
  if (!raw || !raw.trim()) return [];
  try {
    // Strip a leading UTF-8 BOM. TwoTimTwo's export carries one, and because
    // its fields are quoted the BOM lands *before* the first opening quote —
    // nextField() then takes the unquoted branch and returns `"First Name"`
    // with the quotes still attached. HEADER_MAP misses, every row loses
    // FirstName, and findClubber() matches nobody: the entire roster silently
    // degrades to basic labels (no allergies, group, birthday, or no-photo).
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);

    // The TwoTimTwo CSV has quoted fields that can contain newlines (e.g. Notes,
    // Emergency Contact).  We need a proper stateful parser, not a simple
    // line-by-line split.
    const rows = [];
    let headers = [];
    let headerParsed = false;
    let pos = 0;
    const len = raw.length;

    // Parse one field starting at `pos`. Returns the field value and advances
    // `pos` past the delimiter (comma or end-of-record).
    function nextField() {
      // Skip leading whitespace (but not newlines — those are record separators)
      while (pos < len && raw[pos] === ' ') pos++;

      if (pos >= len) return '';

      if (raw[pos] === '"') {
        // Quoted field — collect until closing quote
        pos++;  // skip opening quote
        let val = '';
        while (pos < len) {
          if (raw[pos] === '"') {
            if (pos + 1 < len && raw[pos + 1] === '"') {
              // Escaped quote
              val += '"';
              pos += 2;
            } else {
              // Closing quote
              pos++;  // skip closing quote
              break;
            }
          } else {
            val += raw[pos];
            pos++;
          }
        }
        // Skip any whitespace between closing quote and delimiter
        while (pos < len && raw[pos] === ' ') pos++;
        return val.trim();
      } else {
        // Unquoted field — collect until comma or newline
        let val = '';
        while (pos < len && raw[pos] !== ',' && raw[pos] !== '\n' && raw[pos] !== '\r') {
          val += raw[pos];
          pos++;
        }
        return val.trim();
      }
    }

    function parseRecord() {
      const fields = [];
      while (pos < len) {
        fields.push(nextField());
        if (pos < len && raw[pos] === ',') {
          pos++;  // skip comma, continue to next field
        } else {
          // End of record (newline or EOF)
          break;
        }
      }
      // Skip trailing newlines between records
      while (pos < len && (raw[pos] === '\r' || raw[pos] === '\n')) pos++;
      return fields;
    }

    while (pos < len) {
      // Skip blank lines / whitespace between records
      while (pos < len && (raw[pos] === '\r' || raw[pos] === '\n' || raw[pos] === ' ')) pos++;
      if (pos >= len) break;

      // Stop at TwoTimTwo footer lines like "Clubber Count=116" or "FILTER,VALUE"
      const restOfLine = raw.slice(pos, raw.indexOf('\n', pos) === -1 ? len : raw.indexOf('\n', pos));
      if (/^Clubber Count=/i.test(restOfLine) || /^FILTER,/i.test(restOfLine)) break;

      const fields = parseRecord();
      if (fields.length === 0 || (fields.length === 1 && !fields[0])) continue;

      if (!headerParsed) {
        headers = fields.map(normalizeHeader);
        headerParsed = true;
        continue;
      }

      const obj = {};
      headers.forEach((h, i) => { obj[h] = fields[i] !== undefined ? fields[i] : ''; });
      rows.push(obj);
    }

    return rows;
  } catch (e) {
    console.warn('[csv] Unexpected parse error:', e.message);
    return [];
  }
}

// ── Load clubbers from CSV ────────────────────────────────────────────────────
// Reads clubbers.csv from the same directory as this script.
// Gracefully handles every failure mode so the server always keeps running:
//   ENOENT  — file doesn't exist yet (first run, or file was deleted)
//   EBUSY   — PowerShell is currently overwriting the file mid-event
//   other   — malformed data, permissions, etc.
// The roster is re-read before every label so a mid-event addition is picked
// up, but it was also re-PARSED and its sample names logged every time, on a
// file that changes a few times a night. One stat() now answers "same file as
// last time?" and the parsed rows are reused; a changed file is parsed and
// logged as before.
let clubbersStamp = null;
function loadClubbers() {
  const csvPath = $config.CSV_FILE;
  const stamp = $config.fileStamp(csvPath);
  if (stamp !== 'missing' && stamp === clubbersStamp && clubbers.length > 0) return clubbers;
  try {
    const raw = fs.readFileSync(csvPath, 'utf8');
    const rows = parseCSV(raw);
    clubbersStamp = stamp;
    if (rows.length > 0) {
      // Log every parsed column (not just the known ones) so a renamed
      // TwoTimTwo header that misses HEADER_MAP is visible in the console
      // instead of silently dropping enrichment (group, allergies, ...).
      const keys = Object.keys(rows[0]);
      console.log(`[csv] Loaded ${rows.length} clubber(s) from clubbers.csv (columns: ${keys.join(', ')})`);
      // Log a few sample names to verify parsing
      const samples = rows.slice(0, 3).map(r => `${r.FirstName} ${r.LastName}`).join(', ');
      console.log(`[csv] Sample names: ${samples}`);
      // And what the consent columns hold, as value counts. This is the line
      // to read when "no camera icons are printing": it shows the literal
      // spellings TwoTimTwo exported and how many rows they flagged.
      const consent = $eligibility.rosterConsentSummary(rows);
      console.log(`[csv] Photo consent: ${consent.flagged} of ${consent.total} flagged no-photo | Med Release? ${consent.hasMedColumn ? $eligibility.describeConsentColumns(consent.medValues) : '(column missing)'} | Photo Release? ${consent.hasPhotoColumn ? $eligibility.describeConsentColumns(consent.photoValues) : '(column missing)'}`);
      const consentMsg = $eligibility.consentWarningFor(consent);
      if (consentMsg) console.warn(`[csv] WARNING: ${consentMsg}`);
    } else {
      console.log('[csv] clubbers.csv is empty or has no data rows');
    }
    return rows;
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.warn('[csv] clubbers.csv not found — running without enrichment data');
    } else if (e.code === 'EBUSY') {
      // EBUSY: PowerShell may be writing this file mid-event.
      // Skip this reload; the next request will try again automatically.
      console.warn('[csv] clubbers.csv is busy (being written) — skipping reload');
    } else {
      console.warn('[csv] Failed to read/parse clubbers.csv:', e.message);
    }
    // Last-known-good fallback: a transient read failure mid-event must not
    // wipe the in-memory roster — that would silently downgrade every label
    // to "basic" (no allergies, no groups) until the file becomes readable.
    if (clubbers.length > 0) {
      console.warn(`[csv] Keeping last good roster in memory (${clubbers.length} clubber(s))`);
    }
    return clubbers;
  }
}

// ── Duplicate-print suppression ───────────────────────────────────────────────
// A cold printer plus PowerShell startup can push a print past the client's
// request timeout; the client then aborts and retries even though the first
// request is still printing (or just printed). Printing is per-child-per-
// check-in, so any /print for a name that already printed successfully within
// this window is a duplicate — acknowledge it as success without printing.
// Deliberate reprints go through POST /reprint, which is not gated.
//
// 45s, NOT 25s: the extension aborts a print at PRINT_TIMEOUT_MS (35s, see
// content.js) and then retries, so a window shorter than that client timeout
// let the retry through as a fresh print and a slow printer produced two
// labels and two history rows for one child. The window has to outlast the
// longest wait any client will do before it gives up, plus a little.
const DUPLICATE_WINDOW_MS = 45000;
const recentPrints = new Map();  // nameKey → timestamp of last successful print
// Prints under way, claimed at the duplicate check and released when the print
// settles. recordPrint() runs only after the label is out, so until 7.11.1 two
// requests that overlapped (the extension's retry at 38 s behind a slow
// driver, two detection paths, a double tap) both passed the window test
// before either had recorded, and both printed. A claim is never older than
// IN_FLIGHT_MAX_MS: a throw that skipped a release cannot block a child's next
// label for the rest of the night.
const printsInFlight = new Map();  // nameKey → claimed at
const IN_FLIGHT_MAX_MS = 2 * 60 * 1000;

function isDuplicatePrint(nameKey) {
  const claimed = printsInFlight.get(nameKey);
  if (claimed !== undefined && Date.now() - claimed < IN_FLIGHT_MAX_MS) return true;
  const last = recentPrints.get(nameKey);
  return last !== undefined && Date.now() - last < DUPLICATE_WINDOW_MS;
}

function claimPrint(nameKey) { printsInFlight.set(nameKey, Date.now()); }
function releasePrint(nameKey) { printsInFlight.delete(nameKey); }

function recordPrint(nameKey) {
  const now = Date.now();
  recentPrints.set(nameKey, now);
  // Prune expired entries so the map stays small over a whole event night
  for (const [k, t] of recentPrints) {
    if (now - t >= DUPLICATE_WINDOW_MS) recentPrints.delete(k);
  }
}

// ── Find a child in the CSV ───────────────────────────────────────────────────
// An explicit clubberId (the extension reads it off the check-in page's
// .clubber[recid] attribute) matches exactly against the export's
// "Clubber ID" column — immune to middle names, suffixes, and duplicate
// names. Name matching stays as the fallback: case-insensitive and
// whitespace-trimmed on both sides so "alice " matches "Alice".
function findClubberIn(rows, firstName, lastName, clubberId) {
  const id = String(clubberId == null ? '' : clubberId).trim();
  if (id) {
    const byId = rows.find(r => String(r.ClubberID || '').trim() === id);
    if (byId) return byId;
  }
  const fn = (firstName || '').toLowerCase().trim();
  const ln = (lastName  || '').toLowerCase().trim();
  if (!fn && !ln) return null;
  return rows.find(r =>
    (r.FirstName || '').toLowerCase().trim() === fn &&
    (r.LastName  || '').toLowerCase().trim() === ln
  ) || null;
}

function findClubber(firstName, lastName, clubberId) {
  return findClubberIn(clubbers, firstName, lastName, clubberId);
}
