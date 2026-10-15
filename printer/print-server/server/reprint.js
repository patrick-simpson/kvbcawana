'use strict';
// Label preview, reprint, award slips.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const lazy = require('./lazy');
const fs    = require('fs');
const $config = lazy('./config');
const $eventBuffer = lazy('./event-buffer');
const $clubbers = lazy('./clubbers');
const $eligibility = lazy('./eligibility');
const $images = lazy('./images');
const $labelRender = lazy('./label-render');
const $printing = lazy('./printing');
const $tunes = lazy('./tunes');
const $tags = lazy('./tags');
const $http = lazy('./http');
const $history = lazy('./history');
const $leaders = lazy('./leaders');
const $customPdf = lazy('./custom-pdf');
const $configRoutes = lazy('./config-routes');
const app = $http.app;

// What other modules (and server.js) read from this one; live bindings, so cycles are safe.
Object.defineProperties(exports, {
  reprintRun: { enumerable: true, get: () => reprintRun },
});

// ── Label preview ────────────────────────────────────────────────────────────
app.get('/preview', async (req, res) => {
  const { name, firstName: qFirst, lastName: qLast } = req.query;
  // Express hands back an array for a repeated query param (?clubName=a&clubName=b);
  // String() keeps the label renderer off a non-string.
  const clubName = String(req.query.clubName == null ? '' : req.query.clubName);
  let firstName, lastName;
  if (qFirst) {
    firstName = String(qFirst).trim();
    lastName = String(qLast || '').trim();
  } else if (name) {
    const parts = String(name).trim().split(/\s+/);
    firstName = parts[0] || 'Preview';
    lastName = parts.slice(1).join(' ') || '';
  } else {
    firstName = 'Preview';
    lastName = 'Label';
  }

  // Enrich from CSV if available
  $clubbers.clubbers = $clubbers.loadClubbers();
  const record = $clubbers.findClubber(firstName, lastName);
  let allergyTokens = [], handbookGroup = '', birthday = false, birthdayAge = null, noPhoto = false;
  let effectiveClubName = clubName;
  if (record) {
    const allergySource = record.Allergies || record.Notes || '';
    allergyTokens = $eligibility.parseAllergies(allergySource);
    birthday = $eligibility.isCakeWeek(record.Birthdate);
    birthdayAge = $eligibility.birthdayAgeThisWeek(record.Birthdate);   // words beside the cake (#291)
    noPhoto = $eligibility.noPhotoFor(record);
    // Same roster fill (and same ordering) as /print — a preview must show the
    // label the same request would PRINT, pseudo-group suppression included.
    if (!effectiveClubName && record.Club) effectiveClubName = String(record.Club).trim();
    handbookGroup = $eligibility.effectiveHandbookGroup(record.HandbookGroup || record.Group, effectiveClubName);
  }

  // Editor live preview: an unsaved template rides in ?template=<json>. It is
  // sanitized exactly like a saved one and is never persisted; a parse failure
  // falls back to the saved template, so a typo can't 500 the preview. The
  // ?visitor=1 flag exists so the editor can see the VISITOR pill toggle.
  let template = $tags.labelTemplateFor(effectiveClubName);
  if (typeof req.query.template === 'string' && req.query.template) {
    try {
      const t = $tags.sanitizeLabelTemplate(JSON.parse(req.query.template));
      if (t) template = t;
    } catch { /* keep the saved template */ }
  }
  const previewVisitor = req.query.visitor === '1';

  try {
    const twinP = record ? $eligibility.twinDisambiguation(record, $clubbers.clubbers) : { middleInitial: '', nameHint: '' };
    const result = await $labelRender.generateLabel({
      firstName, lastName, clubName: effectiveClubName,
      allergyTokens, handbookGroup, isBirthday: birthday, birthdayAge, noPhoto,
      isVisitor: previewVisitor,
      middleInitial: twinP.middleInitial, nameHint: twinP.nameHint,
      footerText: $tags.labelFooterText(),
      template,
    });
    // X-Tag-Size (inches, "w x h") lets the dashboard draw it at true size.
    res.set('Content-Type', 'image/png');
    res.set('X-Tag-Size', '4.00x2.00');
    res.set('X-Tag-Printer', 'label');
    res.send(result.buffer);
    // Clean up temp file
    fs.unlink(result.pngPath, () => {});
  } catch (err) {
    console.error('[preview] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Reprint ──────────────────────────────────────────────────────────────────
// One history row, reprinted. Factored out of POST /reprint unchanged so the
// range reprint (#257) reuses the SAME path rather than growing a second one —
// which is what keeps the ledger, the tally and the sealed checkin event out
// of it: a reprint is never a check-in, and this function calls neither
// recordAttendance nor events.publish nor publishTally.
//
// Returns { ok: true, name, leader? } or { ok: false, name, error }. It never
// throws and never touches `res`.
//
// opts.silent skips the musical-printer tune (range mode only): at
// config.musicalPrinter === true a burst of 20 would play 20 tunes, and each
// failure costs a synchronous 400ms wait inside playTuneIfEnabled.
async function reprintRow(entry, printerName, opts = {}) {
  const fullName = `${entry.firstName} ${entry.lastName}`;
  // Belt and braces with the route's own guard above: this function is also
  // reached from /reprint-range, and a recognition print that came back out of
  // here as a plain check-in label would be counted as a child. Refuse rather
  // than silently render the wrong artifact.
  if (entry.isAward || entry.isConnectCard) {
    return { ok: false, name: fullName, error: 'not a check-in label' };
  }
  const effectivePrinter = (printerName && printerName.trim()) || entry.printer || $config.PRINTER_NAME;
  const silent = opts.silent === true;

  // A one-off name tag reprinted from the print log stays a one-off: the
  // same plain tag again, a row that is still `oneOff` (never a check-in),
  // and no welcome on the screens (a reprint never greets anyone).
  if (entry.oneOff) {
    let png = null;
    try {
      const result = await $leaders.renderOneOffLabel(entry.firstName, entry.clubName);
      png = result.pngPath;
      await $printing.printLabel(png, effectivePrinter);
      $history.addHistoryEntry({ firstName: entry.firstName, lastName: '', clubName: entry.clubName, printer: effectivePrinter, success: true, oneOff: true });
      console.log(`[reprint] one-off tag ${entry.firstName}`);
      return { ok: true, name: entry.firstName, oneOff: true };
    } catch (err) {
      console.error('[reprint] Error:', err.message);
      $history.addHistoryEntry({ firstName: entry.firstName, lastName: '', clubName: entry.clubName, printer: effectivePrinter, success: false, oneOff: true });
      $eventBuffer.recordPrintFailure(entry.firstName, entry.clubName, err.message);
      return { ok: false, name: entry.firstName, error: err.message, ...$printing.outcomeUnknownBody(err) };
    } finally {
      if (png) fs.unlink(png, () => {});
    }
  }

  // A leader tag reprinted by index must come back out as a leader tag: the
  // kid path below would render allergy/birthday enrichment for a same-named
  // child and record an UNFLAGGED row — turning an adult's name tag into a
  // counted check-in, the exact thing isLeader exists to prevent.
  if (entry.isLeader) {
    let leaderPng = null;
    try {
      const result = await $leaders.renderLeaderLabel({ firstName: entry.firstName, lastName: entry.lastName, clubName: entry.clubName });
      leaderPng = result.pngPath;
      if (!silent) await $tunes.playTuneIfEnabled(effectivePrinter);
      await $printing.printLabel(leaderPng, effectivePrinter);
      $history.addHistoryEntry({
        firstName: entry.firstName, lastName: entry.lastName, clubName: entry.clubName,
        printer: effectivePrinter, success: true, isLeader: true,
      });
      console.log(`[reprint] leader tag ${fullName}`);
      return { ok: true, name: fullName, leader: true };
    } catch (err) {
      console.error('[reprint] Error:', err.message);
      $history.addHistoryEntry({
        firstName: entry.firstName, lastName: entry.lastName, clubName: entry.clubName,
        printer: effectivePrinter, success: false, isLeader: true,
      });
      $eventBuffer.recordPrintFailure(fullName.trim(), entry.clubName, err.message);
      return { ok: false, name: fullName, error: err.message, ...$printing.outcomeUnknownBody(err) };
    } finally {
      if (leaderPng) fs.unlink(leaderPng, () => {});
    }
  }

  let pngPath = null;
  try {
    $clubbers.clubbers = $clubbers.loadClubbers();
    const record = $clubbers.findClubber(entry.firstName, entry.lastName);
    let allergyTokens = [], handbookGroup = '', birthday = false, birthdayAge = null, noPhoto = false;
    if (record) {
      const allergySource = record.Allergies || record.Notes || '';
      allergyTokens = $eligibility.parseAllergies(allergySource);
      handbookGroup = $eligibility.effectiveHandbookGroup(record.HandbookGroup || record.Group, entry.clubName);
      birthday = $eligibility.isCakeWeek(record.Birthdate);
      // Re-derived from the roster, not restored from the history row (which
      // stores no birthdate), so a reprint matches the label that first
      // printed instead of silently dropping its age line.
      birthdayAge = $eligibility.birthdayAgeThisWeek(record.Birthdate);
      noPhoto = $eligibility.noPhotoFor(record);
    }

    const clubImageBuffer = await $images.resolveImageBuffer($history.historyClubImage(entry));
    // NOTE: visitor, stepUp, awanaShares, goToLine and milestoneLine are all
    // absent here because print history never stored them, so a reprint has
    // quietly differed from the original label. Naming the fields makes that
    // omission visible rather than hidden in a run of positional `false`s.
    const twinR = record ? $eligibility.twinDisambiguation(record, $clubbers.clubbers) : { middleInitial: '', nameHint: '' };
    const result = await $labelRender.generateLabel({
      firstName: entry.firstName, lastName: entry.lastName, clubName: entry.clubName,
      clubImageBuffer, allergyTokens, handbookGroup, isBirthday: birthday, birthdayAge, noPhoto,
      middleInitial: twinR.middleInitial, nameHint: twinR.nameHint,
      footerText: $tags.labelFooterText(),
      template: $tags.labelTemplateFor(entry.clubName),
    });
    pngPath = result.pngPath;

    if (!silent) await $tunes.playTuneIfEnabled(effectivePrinter, birthday ? 'birthday' : undefined);
    await $printing.printLabel(pngPath, effectivePrinter);

    $history.addHistoryEntry({
      firstName: entry.firstName, lastName: entry.lastName,
      clubName: entry.clubName, clubImageData: $history.historyClubImage(entry),
      printer: effectivePrinter, success: true, clubberId: entry.clubberId
    });

    console.log(`[reprint] ${fullName}`);
    return { ok: true, name: fullName };
  } catch (err) {
    console.error('[reprint] Error:', err.message);
    $history.addHistoryEntry({
      firstName: entry.firstName, lastName: entry.lastName,
      clubName: entry.clubName, clubImageData: $history.historyClubImage(entry),
      printer: effectivePrinter, success: false, clubberId: entry.clubberId
    });
    $eventBuffer.recordPrintFailure(fullName.trim(), entry.clubName, err.message);
    return { ok: false, name: fullName, error: err.message, ...$printing.outcomeUnknownBody(err) };
  } finally {
    if (pngPath) fs.unlink(pngPath, () => {});
  }
}

app.post('/reprint', async (req, res) => {
  const { name, index, clubberId = null } = req.body || {};
  const history = $history.loadHistory();

  let entry;
  if (typeof index === 'number' && index >= 0 && index < history.length) {
    entry = history[index];
  } else if (name || clubberId) {
    // Award slips (isAward) are excluded from lookup so reprinting "by name"
    // always targets the check-in label, never an award slip that happens to
    // share the same child's name.
    //
    // historyRowMatches is id-first: when the caller knows the clubber id AND
    // the stored row has one, a name collision can no longer reprint the wrong
    // child's label. Rows predating the id fall back to name matching, so this
    // is a strict improvement rather than a behaviour change.
    const parts = String(name || '').trim().split(/\s+/);
    const first = parts[0] || '';
    const last = parts.slice(1).join(' ');
    entry = history.find(e => !$history.isNonCheckinRow(e) && $history.historyRowMatches(e, first, last, clubberId));
  }

  if (!entry) {
    return res.status(404).json({ error: 'No matching print history entry found' });
  }
  // The name/clubberId lookup above already excludes non-check-in rows, but the
  // INDEX path takes whatever row the client pointed at. An award slip or a
  // connect card sent down the kid path below would render as a check-in label
  // AND record a history row WITHOUT its isAward/isConnectCard flag - so
  // isNonCheckinRow() would stop excluding it and an award slip would count as
  // a child on every screen for the rest of the night. (Leader rows are fine:
  // reprintRow has its own leader branch that keeps the flag.)
  if (entry.isAward || entry.isConnectCard) {
    return res.status(400).json({
      error: entry.isAward
        ? 'That row is an award slip, not a check-in label - reprint it from the award card.'
        : 'That row is a connect card, not a check-in label.',
    });
  }

  const r = await reprintRow(entry, req.body.printerName);
  if (!r.ok) return res.status(500).json({ error: r.error, ...(r.outcomeUnknown ? { outcomeUnknown: true } : {}) });
  return res.json(Object.assign({ success: true, name: r.name }, r.leader ? { leader: true } : {}));
});

// Reprint a whole stretch of tonight (#257). A jam or a torn roll eats eight
// labels in a rush; this reprints the run at once instead of one row at a time
// while a line forms at the door.
//
// Two-step by design: without confirm:true it is a DRY RUN that names the
// count and prints nothing — the count comes from the server, not the client.
app.post('/reprint-range', async (req, res) => {
  const { fromTs, toTs, club = '', confirm = false, printerName = '' } = req.body || {};

  // /reprint predates rehearsal mode and is not rehearsal-aware, but a range
  // reprint is inherently a real-night action — refuse rather than spray 20
  // TEST labels at a jammed printer.
  if ($configRoutes.isRehearsalActive()) {
    return res.status(409).json({ error: 'Rehearsal mode is armed — disarm it before reprinting a stretch.' });
  }
  if (printerName && !$customPdf.isSafePrinterName(printerName)) {
    return res.status(400).json({ error: 'printerName contains unsupported characters' });
  }

  const sel = $history.selectReprintRange({ history: $history.loadHistory(), fromISO: fromTs, toISO: toTs, club });
  if (sel.error) {
    return res.status(400).json({
      error: sel.error === 'bad-club'
        ? 'Unknown club'
        : 'Give a start time before an end time (both on today).',
    });
  }
  if (!sel.count) {
    return res.json({ confirmed: false, count: 0, rows: [], skipped: sel.skipped });
  }
  if (confirm !== true) {
    return res.json({
      confirmed: false,
      count: sel.count,
      capped: sel.capped,
      skipped: sel.skipped,
      rows: sel.rows.map(r => ({
        name: `${r.firstName} ${r.lastName}`.trim(),
        clubName: r.clubName || '',
        at: r.timestamp,
      })),
    });
  }

  if (reprintRun) return res.status(409).json({ error: reprintBusyMessage(), busy: reprintRun });
  reprintRun = { kind: 'range', count: sel.rows.length, printed: 0, startedAt: Date.now() };
  const printed = [];
  let stopped = null;
  try {
  for (let i = 0; i < sel.rows.length; i++) {
    const r = await reprintRow(sel.rows[i], printerName, { silent: true });
    // Stop on the FIRST failure: a jam would otherwise fire 19 more ops
    // print-failure events and write 19 more failed history rows.
    if (!r.ok) { stopped = { name: r.name, error: r.error }; break; }
    printed.push(r.name);
    reprintRun.printed = printed.length;
    // Awaited, never Atomics.wait — the point is that a queued POST /print for
    // a child at the door gets served between reprints.
    if (i < sel.rows.length - 1) await new Promise(done => setTimeout(done, $history.REPRINT_RANGE_GAP_MS));
  }
  } finally { reprintRun = null; }

  console.log(`[reprint-range] ${printed.length}/${sel.rows.length} label(s)${stopped ? ` — stopped at ${stopped.name}` : ''}`);
  // Always 200 so the client can render a partial run rather than a bare
  // "failed" after most of the stretch actually came out.
  return res.json({
    success: !stopped, printed, count: sel.rows.length, capped: sel.capped, stoppedAt: stopped,
  });
});

// One reprint run at a time. A second range reprint while one runs used to
// start a second loop interleaved with the first: every label twice, the gap
// between them gone. Now it is refused with 409 and told how far the first run
// has got; the page retries when it is done.
let reprintRun = null;
function reprintBusyMessage() {
  const r = reprintRun;
  return `A reprint is already running (${r.printed} of ${r.count} printed). Wait for it to finish.`;
}

// ── Award slip labels ─────────────────────────────────────────────────────────
// A small recognition slip ("🏅 Awarded: <award>") for a completed book or
// earned award, printed through the SAME generateLabel/printImage pipeline
// as a normal check-in label — no new rendering path, so it can't regress
// one. The award text rides in the existing handbook-group text slot (with
// a medal prefix so it reads unambiguously as an award, not a group name),
// and the inverted (black-background) palette — already used for step-up
// and first-timer labels — makes an award slip visually distinct from a
// normal white check-in label at a glance.
app.post('/print-award', async (req, res) => {
  const {
    name,
    firstName: reqFirst,
    lastName:  reqLast,
    clubName      = '',
    award,
    clubImageData = null,
    printerName   = '',
    clubberId     = null,
  } = req.body || {};

  let firstName, lastName;
  if (reqFirst !== undefined) {
    firstName = String(reqFirst || '').trim();
    lastName  = String(reqLast  || '').trim();
  } else if (name) {
    const parts = String(name).trim().split(/\s+/);
    firstName = parts[0] || '';
    lastName  = parts.slice(1).join(' ') || '';
  } else {
    return res.status(400).json({ error: 'name or firstName is required' });
  }

  const awardText = String(award == null ? '' : award).trim();
  if (!awardText) return res.status(400).json({ error: 'award is required' });

  const effectivePrinter = (printerName && printerName.trim()) ? printerName.trim() : $config.PRINTER_NAME;

  // Duplicate suppression keyed on name+award (NOT name alone) — a child can
  // legitimately earn two different awards in one evening, and each should
  // print. Namespaced ("award:...") so it can never collide with a normal
  // check-in's dedup key in the same recentPrints map.
  const dupKey = `award:${clubberId ? 'id' + clubberId : firstName + ' ' + lastName}:${awardText}`
    .toLowerCase().trim();
  if ($clubbers.isDuplicatePrint(dupKey)) {
    console.log(`[print-award] '${firstName} ${lastName}' — '${awardText}' already printed within ${$clubbers.DUPLICATE_WINDOW_MS / 1000}s — duplicate suppressed`);
    return res.json({ success: true, duplicate: true });
  }
  $clubbers.claimPrint(dupKey);

  // Enrich from the roster the same way /print does, including clubberId
  // awareness — an award slip must show the same allergy/no-photo safety
  // icons a check-in label would.
  $clubbers.clubbers = $clubbers.loadClubbers();
  const record = $clubbers.findClubber(firstName, lastName, clubberId);

  let allergyTokens = [], birthday = false, birthdayAge = null, noPhoto = false;
  let effectiveClubName = clubName;
  if (record) {
    const allergySource = record.Allergies || record.Notes || '';
    allergyTokens = $eligibility.parseAllergies(allergySource);
    birthday = $eligibility.isCakeWeek(record.Birthdate);
    birthdayAge = $eligibility.birthdayAgeThisWeek(record.Birthdate);   // words beside the cake (#291)
    noPhoto  = $eligibility.noPhotoFor(record);
    if (!effectiveClubName && record.Club) effectiveClubName = String(record.Club).trim();
  }

  const medalLine = `🏅 Awarded: ${awardText}`.slice(0, 60);

  let pngPath = null;
  try {
    const clubImageBuffer = await $images.resolveImageBuffer(clubImageData);
    const twinA = record ? $eligibility.twinDisambiguation(record, $clubbers.clubbers) : { middleInitial: '', nameHint: '' };
    const result = await $labelRender.generateLabel({
      firstName, lastName, clubName: effectiveClubName, clubImageBuffer,
      allergyTokens, handbookGroup: medalLine, isBirthday: birthday, birthdayAge, noPhoto,
      middleInitial: twinA.middleInitial, nameHint: twinA.nameHint,
      footerText: $tags.labelFooterText(),
      extras: { inverted: true },
    });
    pngPath = result.pngPath;

    await $tunes.playTuneIfEnabled(effectivePrinter, birthday ? 'birthday' : undefined);
    await $printing.printLabel(pngPath, effectivePrinter);
    $clubbers.recordPrint(dupKey);

    $history.addHistoryEntry({
      firstName, lastName, clubName: effectiveClubName, clubImageData,
      printer: effectivePrinter, success: true, isAward: true, award: awardText,
      clubberId,
    });

    console.log(`[print-award] ${firstName} ${lastName} — ${awardText}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[print-award] Error:', err.message);
    $history.addHistoryEntry({
      firstName, lastName, clubName: effectiveClubName, clubImageData,
      printer: effectivePrinter, success: false, isAward: true, award: awardText,
      clubberId,
    });
    $eventBuffer.recordPrintFailure(`${firstName} ${lastName}`.trim(), effectiveClubName, err.message);
    res.status(500).json({ error: err.message, ...$printing.outcomeUnknownBody(err) });
  } finally {
    $clubbers.releasePrint(dupKey);
    if (pngPath) fs.unlink(pngPath, () => {});
  }
});
