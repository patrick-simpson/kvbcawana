'use strict';
// Label generation and the check-in print routes.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const lazy = require('./lazy');
const events  = require('../events');
const feeds   = require('../feeds');
const tonightRules = require('../tonight');
const {
  REPORT_FRESH_MS, normalizedName, displayClub, splitFullName, historyIdentityKey, reportEntryIdentityKey,
  identityKeysOfRow, identityKeysOfReportEntry, distinctReportChildren, reportIsPartial, massUndoRefused,
} = tonightRules;
const fs    = require('fs');
const $config = lazy('./config');
const $eventBuffer = lazy('./event-buffer');
const $clubbers = lazy('./clubbers');
const $eligibility = lazy('./eligibility');
const $images = lazy('./images');
const $labelRender = lazy('./label-render');
const $printing = lazy('./printing');
const $tunes = lazy('./tunes');
const $ledger = lazy('./ledger');
const $tags = lazy('./tags');
const $http = lazy('./http');
const $history = lazy('./history');
const $publishers = lazy('./publishers');
const $configRoutes = lazy('./config-routes');
const app = $http.app;

// What other modules (and server.js) read from this one; live bindings, so cycles are safe.
Object.defineProperties(exports, {
  performCheckinPrint: { enumerable: true, get: () => performCheckinPrint },
});

// ── Label generation (returns PNG, no printing) ──────────────────────────────
// Same enrichment pipeline as /print but streams the PNG back to the caller.
// Used by the "Print Dialog" mode so both paths render the same label.
app.post('/label', async (req, res) => {
  const {
    name,
    firstName: reqFirst,
    lastName:  reqLast,
    clubName      = '',
    clubImageData = null,
    visitor       = false,
    stepUpNight   = false,
    awanaShares   = null,
    clubberId     = null
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

  $clubbers.clubbers = $clubbers.loadClubbers();
  const record = $clubbers.findClubber(firstName, lastName, clubberId);

  let allergyTokens, handbookGroup, birthday, birthdayAge, noPhoto;
  let effectiveClubName = clubName;
  if (record) {
    const allergySource = record.Allergies || record.Notes || '';
    allergyTokens = $eligibility.parseAllergies(allergySource);
    birthday = $eligibility.isCakeWeek(record.Birthdate);
    birthdayAge = $eligibility.birthdayAgeThisWeek(record.Birthdate);   // words beside the cake (#291)
    noPhoto = $eligibility.noPhotoFor(record);
    // Same roster fill (and same ordering) as /print: the group is judged
    // against the club that actually prints, so a club-less request for a
    // Puggles kid still drops the "Puggles group" pseudo-group. Review caught
    // this path diverging from /print.
    if (!effectiveClubName && record.Club) effectiveClubName = String(record.Club).trim();
    handbookGroup = $eligibility.effectiveHandbookGroup(record.HandbookGroup || record.Group, effectiveClubName);
  } else {
    allergyTokens = [];
    handbookGroup = '';
    birthday = false;
    birthdayAge = null;
    noPhoto = false;
  }

  // Step Up Night eligibility — only kicks in when the client says it's
  // step-up night AND the kid is in a graduating cohort.
  const stepUp = !!stepUpNight && $eligibility.isSteppingUp(record, effectiveClubName);
  const stepUpNextClub = stepUp ? ($eligibility.nextClubFor(effectiveClubName) || '') : '';

  try {
    const clubImageBuffer = await $images.resolveImageBuffer(clubImageData);
    // Same extras /print builds, so the label a volunteer sees in Print Dialog
    // mode (and any preview) matches what auto-print produces. Without this a
    // first-timer's label silently lost its inverted palette on this path.
    // milestoneLine is deliberately NOT computed here: it comes from recording
    // attendance, and a preview/dialog render must not record a check-in.
    const labelExtras = {};
    const labelGoTo = $ledger.lateGoToLine(effectiveClubName);
    if (labelGoTo) labelExtras.goToLine = labelGoTo;
    if (visitor && $config.config.firstTimerInverted !== false) labelExtras.inverted = true;

    const twin = record ? $eligibility.twinDisambiguation(record, $clubbers.clubbers) : { middleInitial: '', nameHint: '' };
    const result = await $labelRender.generateLabel({
      firstName, lastName, clubName: effectiveClubName, clubImageBuffer,
      allergyTokens, handbookGroup, isBirthday: birthday, birthdayAge, isVisitor: !!visitor,
      stepUp, stepUpNextClub, awanaShares, noPhoto,
      middleInitial: twin.middleInitial, nameHint: twin.nameHint,
      footerText: $tags.labelFooterText(),
      template: $tags.labelTemplateFor(effectiveClubName),
      extras: labelExtras,
    });
    fs.unlink(result.pngPath, () => {});
    res.set('Content-Type', 'image/png');
    res.send(result.buffer);
  } catch (err) {
    console.error('[label] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// The check-in print, factored out of POST /print so POST /phone/visitor can
// run the exact same pipeline — dedup window, roster enrichment, season
// ledger, checkin event, history row, tally — without looping an HTTP request
// back into this process. Returns { status, body } for the caller to send.
// Never throws: a jammed printer or a corrupt PNG is a 500 body, not a crash.
async function performCheckinPrint(input) {
  const {
    firstName,
    lastName,
    clubName      = '',
    clubImageData = null,
    printerName   = '',
    visitor       = false,
    stepUpNight   = false,
    awanaShares   = null,
    clubberId     = null,
    suppressConnectCard = false,
    demo          = false,
    cloudCheckin  = false,
    regen         = false,
    broughtFriend = false,
    friendName    = '',
    greetJob      = null
  } = input || {};

  // ── Demo / training mode ────────────────────────────────────────────────────
  // A demo check-in prints a REAL label (so a volunteer sees the actual output)
  // carrying the same diagonal TEST band /canary uses, and touches nothing else.
  // Every persistent side effect below is skipped, because each one causes real
  // damage during training:
  //   • addHistoryEntry   → print-history.json feeds /checkin-csv-export, which
  //                         is imported BACK INTO TwoTimTwo. Fake kids would be
  //                         recorded as having attended.
  //   • recordAttendance  → the season ledger is permanent; a padded count makes
  //                         real milestone lines ("10th club night!") wrong for
  //                         the rest of the year.
  //   • publish + buffer  → fake children celebrated by name on the lobby TV.
  //   • publishTally      → inflates tonight's counts on every screen.
  // This is the same set /canary already skips; demo mode generalises it to an
  // arbitrary name and club.
  const isDemo = demo === true || demo === 'true' || $configRoutes.isRehearsalActive();

  const effectivePrinter = (printerName && printerName.trim()) ? printerName.trim() : $config.PRINTER_NAME;

  // Duplicate check-in retry (client timeout/retry, double-tap, overlapping
  // detection paths) — the label already printed, so just acknowledge it.
  // Keyed on the clubber id when the client knows it: a name-only key means two
  // children who share a name and check in within the window collide, and the
  // second is silently reported as a duplicate and never printed. Falls back to
  // the name for walk-ins and older extensions that send no id.
  const dupKey = (clubberId ? `id:${String(clubberId).trim()}` : `${firstName} ${lastName}`)
    .toLowerCase().trim();
  // Cloud check-in (8.0.0): the sync service checked this child in on
  // TwoTimTwo and asked for the tag (cloudCheckin). The extension, which did
  // not drive that check-in, finds the child later (its report check, or a
  // roster diff after a reload) and asks again, past the 45 s window above,
  // perhaps by name alone: that second tag is refused for the rest of the
  // night. And the other way: a cloud job for a child whose tag already
  // printed tonight is refused. An undone check-in counts for neither.
  // `regen` (a pulled job of a later generation: the child was undone and checked
  // in again) is a new tag; the Worker's claim and the job journal already hold
  // one label to a generation.
  if (!isDemo && !regen && $history.printedTonightFor(firstName, lastName, clubberId, cloudCheckin)) {
    console.log(`[print] '${firstName} ${lastName}' already has tonight's tag (${cloudCheckin ? 'cloud job' : 'printed for a cloud check-in'}) — duplicate suppressed`);
    $eventBuffer.greetLate(firstName, lastName, clubberId, clubName, greetJob);
    return { status: 200, body: { success: true, duplicate: true } };
  }
  // Demo mode skips the duplicate window: a trainer demonstrating the same
  // child twice in a row is the normal case, not a double-tap to suppress.
  if (!isDemo && !regen && $clubbers.isDuplicatePrint(dupKey)) {
    console.log(`[print] '${firstName} ${lastName}' already printed within ${$clubbers.DUPLICATE_WINDOW_MS / 1000}s — duplicate suppressed`);
    $eventBuffer.greetLate(firstName, lastName, clubberId, clubName, greetJob);
    return { status: 200, body: { success: true, duplicate: true } };
  }
  if (!isDemo) $clubbers.claimPrint(dupKey);

  // Reload CSV on every request so mid-event additions are always picked up.
  // If the file is locked or missing, loadClubbers() returns [] and logs a
  // warning — this request continues with a basic label.
  $clubbers.clubbers = $clubbers.loadClubbers();

  // Attempt to enrich the label with data from the CSV. Enrichment fails
  // OPEN: a roster row this code did not expect (a date in a new format, a
  // notes field that is not text) used to throw here, before the try below,
  // and the child at the door got no label and the extension no answer. Now
  // the basic label prints and the console says what was skipped.
  let record = null;
  let allergyTokens = [], handbookGroup = '', birthday = false, cakeWeek = false, birthdayAge = null, noPhoto = false;
  let effectiveClubName = clubName;
  try {
  record = $clubbers.findClubber(firstName, lastName, clubberId);
  if (record) {
    // TwoTimTwo CSV has "Notes" instead of a dedicated "Allergies" column.
    // Check Allergies first (manual CSV), fall back to Notes (TwoTimTwo).
    const allergySource = record.Allergies || record.Notes || '';
    allergyTokens = $eligibility.parseAllergies(allergySource);
    birthday      = $eligibility.isBirthdayWeek(record.Birthdate);   // real — feeds the display event
    cakeWeek      = $eligibility.isCakeWeek(record.Birthdate);       // label icon: real or half-birthday
    birthdayAge   = $eligibility.birthdayAgeThisWeek(record.Birthdate);   // words beside the cake (#291)
    noPhoto       = $eligibility.noPhotoFor(record);
    // Detection paths that never saw the kid's page row (checkin-report
    // polling on a freshly loaded station) send no club — fill it from the
    // roster so the label isn't club-less. Icon falls back to the club mark.
    if (!effectiveClubName && record.Club) effectiveClubName = String(record.Club).trim();
    // After the roster fill, so the group is judged against the club that
    // actually prints — a club-less POST for a Puggles kid must still drop
    // the "Puggles group" pseudo-group.
    handbookGroup = $eligibility.effectiveHandbookGroup(record.HandbookGroup || record.Group, effectiveClubName);
    console.log(`[csv] Enriched: ${firstName} ${lastName} | group: ${handbookGroup || '(none)'} | allergies: ${allergyTokens.join(', ') || '(none)'} | birthday: ${birthday}${noPhoto ? ' | NO PHOTO' : ''}`);
  } else {
    // Child not in CSV (new visitor, typo, or CSV unavailable) — print a basic
    // label using only the data from the POST request. No crash, no skip.
    allergyTokens = [];
    handbookGroup = '';
    birthday      = false;
    cakeWeek      = false;
    birthdayAge   = null;
    noPhoto       = false;
    if (firstName || lastName) {
      console.log(`[csv] '${firstName} ${lastName}' not found in CSV — printing basic label`);
    }
  }
  } catch (e) {
    console.warn(`[csv] Enrichment failed for '${firstName} ${lastName}' (${e && e.message}) — printing basic label`);
    allergyTokens = []; handbookGroup = ''; birthday = false; cakeWeek = false; birthdayAge = null; noPhoto = false;
    effectiveClubName = clubName;
  }

  // Step Up Night: only honour the client's flag if the kid is actually in
  // a graduating cohort (puggle = always, cubbie = 5 by Oct 15, others =
  // graduating grade). All other kids print a normal label tonight.
  let stepUp = false, stepUpNextClub = '';
  try {
    stepUp = !!stepUpNight && $eligibility.isSteppingUp(record, effectiveClubName);
    stepUpNextClub = stepUp ? ($eligibility.nextClubFor(effectiveClubName) || '') : '';
  } catch (e) {
    console.warn(`[print] Step-up check failed for '${firstName} ${lastName}' (${e && e.message}) — printing a normal label`);
    stepUp = false; stepUpNextClub = '';
  }
  if (stepUp) {
    console.log(`[print] ${firstName} ${lastName} stepping up: ${effectiveClubName} → ${stepUpNextClub}`);
  }
  if (awanaShares != null) {
    console.log(`[print] ${firstName} ${lastName} shares badge: ${awanaShares}`);
  }
  console.log(`[print] ${firstName} ${lastName} | ${handbookGroup || effectiveClubName || '—'} | printer: ${effectivePrinter || 'default'}`);

  // Wave 2 extras: late-arrival routing from the group schedule (#28),
  // attendance milestones (#30), and the inverted first-timer palette (#27).
  const extras = {};
  let goTo = null;
  try { goTo = $ledger.lateGoToLine(effectiveClubName); } catch (e) { console.warn(`[print] Late routing failed (${e && e.message}) — no "Go to" line`); }
  // A late child's name tag carries no "Go to:" line: the family gets one
  // drop-off label instead, after the name tag (owner, 2026-10-08: the card
  // the receipt printer had, on the label printer).
  const dropOffInstead = !!goTo;
  if (visitor && $config.config.firstTimerInverted !== false) extras.inverted = true;

  let pngPath = null;
  let connectPngPath = null;
  try {
    const clubImageBuffer = await $images.resolveImageBuffer(clubImageData);

    // Attendance is recorded before rendering so the milestone prints on
    // the very night it's earned. Never blocks the label on a ledger error.
    // Skipped for demo prints — the ledger is permanent, and padding it would
    // corrupt real milestone lines for the rest of the season.
    let milestoneLine = '';
    let autoFirstTimer = false;
    let streakCount = null;
    let newKid = false;
    let welcomeBack = false;
    let milestoneCount = null;
    if (!isDemo) {
      try {
        const att = $ledger.recordAttendance(firstName, lastName, clubberId);
        milestoneLine = $ledger.milestoneLineFor(att.seasonCount);
        // Streak flame (#14): earns its ink at six consecutive club nights.
        if (att.streak >= 6) streakCount = att.streak;
        // New-kid sparkle (#15): the first two club weeks.
        if (att.isNewKid) newKid = true;
        // Auto connect card (#10): a new face at a club that has met before.
        // Both halves matter — firstEver alone fires for EVERY kid on opening
        // night (and on a fresh install), because everyone's ledger starts at
        // one. This is deliberately "first time on this machine's ledger", not
        // "first time ever at church" — the ledger is the only memory we have.
        autoFirstTimer = !!$config.config.connectCardAutoFirstTimer && att.firstEver && att.priorNightExists;
        // Welcome back (#9): a RETURNING kid's first night of the season -
        // firstEver kids get the first-timer treatment instead, never both.
        welcomeBack = !att.firstEver && att.seasonCount === 1;
        // Milestone wall (#10): the display celebrates the same nights the
        // label's milestone line marks (5/10/25/50).
        if (milestoneLine) milestoneCount = att.seasonCount;
      } catch { /* ledger trouble must not stop the print */ }
    }
    if (milestoneLine) extras.milestoneLine = milestoneLine;
    // Trophy band (#293): pure decoration off a cached LOCAL feed, in its own
    // try/catch. A missing, stale or malformed feed prints the stock label and
    // never delays it — printing is never gated on the pipe. Demo prints are
    // excluded on purpose: they skip history, so a demo band could not be
    // deduped (same reason a demo skips the ledger-derived milestone).
    let trophyBook = '';
    if (!isDemo && $config.config.trophyBand !== false) {
      try {
        const hit = feeds.getCompletedBook(`${firstName} ${lastName}`);
        if (hit && hit.book) {
          // Once per child per club night, the same way the auto connect card
          // dedupes: a lost label or a second station must not band twice.
          const todayIso = $eventBuffer.localDayISO();
          const alreadyBanded = $history.loadHistory().some(e => e && e.trophyBook && e.success !== false
            && $eventBuffer.isOnLocalDay(e.timestamp, todayIso)
            && $history.historyRowMatches(e, firstName, lastName, clubberId));
          if (!alreadyBanded) {
            const band = $ledger.trophyBandFor(hit.book);
            if (band) { extras.trophyBand = band; trophyBook = hit.book; }
          }
        }
      } catch { /* a decoration must never stop a label */ }
    }
    // The operator's explicit visitor flag and the ledger heuristic converge
    // here for the connect card and the display's welcome treatment. The
    // label's inverted palette deliberately stays on the EXPLICIT flag only:
    // a heuristic misfire that prints one extra welcome card is shrugged off,
    // one that turns a regular kid's label black tells every volunteer to
    // welcome the wrong child.
    const isFirstTimerTonight = !!visitor || autoFirstTimer;

    const twin = record ? $eligibility.twinDisambiguation(record, $clubbers.clubbers) : { middleInitial: '', nameHint: '' };
    const result = await $labelRender.generateLabel({
      firstName, lastName, clubName: effectiveClubName, clubImageBuffer,
      allergyTokens, handbookGroup, isBirthday: cakeWeek, birthdayAge, isVisitor: !!visitor,
      stepUp, stepUpNextClub, awanaShares, noPhoto, streakCount, isNewKid: newKid,
      middleInitial: twin.middleInitial, nameHint: twin.nameHint,
      testBanner: isDemo,   // a demo label is visibly marked
      footerText: $tags.labelFooterText(),
      template: $tags.labelTemplateFor(effectiveClubName),
      extras,
    });
    pngPath = result.pngPath;

    // Musical printer: EVERY label announces itself (operator request — was
    // test prints only, which is why real check-ins printed silently). Tunes
    // cycle per label; a birthday kid's label plays Happy Birthday. Played
    // BEFORE the label so the backfeed returns the media to its start.
    await $tunes.playTuneIfEnabled(effectivePrinter, cakeWeek ? 'birthday' : undefined);
    await $printing.printLabel(pngPath, effectivePrinter);
    if (!isDemo) $clubbers.recordPrint(dupKey);

    // Connect card (#27/#10): first-time families optionally get a second
    // label pointing them to the club's time and place — triggered by the
    // operator's explicit visitor flag, or (when enabled) by the attendance
    // ledger spotting a first-ever check-in. Failure here never fails the
    // check-in — the main label already printed. Must stay a SAME-REQUEST
    // second printImage: a separate POST would die in the duplicate window.
    // The explicit visitor flag always fires (an operator re-flagging after a
    // lost card is deliberate); the AUTO path fires once per kid per night —
    // a re-print past the duplicate window (lost label, roster fix, a second
    // station) must not hand the family a second welcome card, and firstEver
    // alone can't see that because tonight is still the kid's only ledger date.
    // A visiting FAMILY (#323) is several independent prints — one per child —
    // that share one household, so every child after the first asks for its
    // card to be suppressed and the family gets ONE welcome card, not four.
    // Absent or garbage means "print the card": that is today's behaviour, and
    // POST /phone/visitor (which never sends the field) and the extension's
    // offline queue both depend on it.
    const suppressCard = suppressConnectCard === true || suppressConnectCard === 'true';
    let shouldConnectCard = false;
    if ($config.config.connectCard && !suppressCard) {
      if (visitor) {
        shouldConnectCard = true;
      } else if (autoFirstTimer) {
        const todayIso = $eventBuffer.localDayISO();
        shouldConnectCard = !$history.loadHistory().some(e => e && e.isConnectCard && e.success !== false
          && $eventBuffer.isOnLocalDay(e.timestamp, todayIso)
          && $history.historyRowMatches(e, firstName, lastName, clubberId));
      }
    }
    if (shouldConnectCard) {
      try {
        const row = $ledger.scheduleRowFor(effectiveClubName);
        const where = row ? [row.startTime, row.location, row.room].filter(Boolean).join(' · ') : '';
        const card = await $labelRender.generateLabel({
          firstName, lastName, clubName: effectiveClubName, clubImageBuffer,
          greeting: $tags.connectCardGreeting(),
          isVisitor: true,
          testBanner: isDemo,   // a demo card must be as visibly fake as its label
          footerText: $tags.labelFooterText(),
          extras: where ? { goToLine: where } : {},
        });
        connectPngPath = card.pngPath;
        await $printing.printLabel(connectPngPath, effectivePrinter);
        console.log(`[print] Connect card printed for ${firstName} ${lastName}${autoFirstTimer && !visitor ? ' (auto: first-ever check-in)' : ''}`);
        // Recorded like an award slip: visible in the dashboard's history,
        // excluded from everything that counts check-ins.
        if (!isDemo) {
          $history.addHistoryEntry({
            firstName, lastName, clubName: effectiveClubName, clubImageData,
            printer: effectivePrinter, success: true, isConnectCard: true, clubberId,
          });
        }
      } catch (e) {
        console.warn('[print] Connect card failed (non-critical):', e.message);
      }
    }

    // The drop-off tag: a late child, and the
    // first of their household tonight. Never fails the check-in.
    if (dropOffInstead) {
      let dropPath = null;
      try {
        const tag = $tags.dropOffTagFor(firstName, lastName, effectiveClubName, new Date(), { demo: isDemo });
        if (tag) {
          const out = await $tags.generateDropOffTag(tag);
          dropPath = out.pngPath;
          await $printing.printLabel(dropPath, effectivePrinter);
          console.log(`[print] Drop-off tag for the ${tag.family} family: ${tag.lines.map(l => l.first).join(', ')}`);
        }
      } catch (e) {
        console.warn('[print] Drop-off tag failed (non-critical):', e.message);
      } finally {
        if (dropPath) fs.unlink(dropPath, () => {});
      }
    }

    // BARF Night (8.1.0, owner): a child who brought a friend gets a second
    // tag, BARFED, to choose from. After their own tag, and never in its way.
    if (broughtFriend === true && $tags.isBarfNight()) {
      let barfPath = null;
      try {
        const out = await $tags.generateBarfTag({ firstName });
        barfPath = out.pngPath;
        await $printing.printLabel(barfPath, effectivePrinter);
        console.log(`[print] BARFED tag for '${firstName}'`);
      } catch (e) {
        console.warn('[print] BARFED tag failed (non-critical):', e.message);
      } finally {
        if (barfPath) fs.unlink(barfPath, () => {});
      }
    }
    // Who brought a friend, for BARF Night's email (a cloud check-in was
    // recorded by the service itself). Any night: the list is by date.
    if (broughtFriend === true && !isDemo && !cloudCheckin) {
      $tags.reportFriend({ firstName, lastName, clubName: effectiveClubName, clubberId, friendName: $tags.cleanFriendName(friendName) });
    }

    if (isDemo) {
      // The label printed and nothing else happened: no broadcast, no history,
      // no tally, no ledger. Deliberately logged so a demo run is obvious when
      // reading the console after a training session.
      console.log(`[demo] Printed a TEST label for '${firstName} ${lastName}' (${effectiveClubName || 'no club'}) — nothing recorded or broadcast`);
      return { status: 200, body: { success: true, demo: true } };
    } else {
      // Event bus: checkin (v2 — id + at for replay dedup), buffered for recap,
      // plus a fresh tally so displays update within seconds of the check-in.
      const checkinEvent = events.buildCheckin({
        firstName, club: effectiveClubName, isBirthday: !!birthday, isFirstTimer: isFirstTimerTonight,
        welcomeBack, milestone: milestoneCount,
      });
      // A station's job: the greeting (birthday, first-timer, milestone: only this computer
      // has the roster and the history) is the ONE the single publisher lets through,
      // named by the job it is for (lobby/worker/src/routes.md section 8).
      // With no job (the phone page's relay job, the extension, a phone visitor) a station
      // names the child instead, so the single publisher can still greet them once.
      // (An id-less print the roster knows is named by the roster's id: the same child.)
      const knownId = clubberId || (record && String(record.ClubberID || '').trim()) || null;
      const greetChild = !greetJob && $config.cloudStation ? $eventBuffer.greetingChild(firstName, lastName, knownId, effectiveClubName) : null;
      events.publish($config.EVENT_CHANNEL, 'checkin', checkinEvent, greetJob && $config.cloudStation ? { job: greetJob } : (greetChild ? { child: greetChild } : undefined));
      $eventBuffer.rememberGreeting(firstName, lastName, knownId, checkinEvent);
      $eventBuffer.pushEventToBuffer(checkinEvent);

      // Log to print history. trophyBook is the once-per-night marker for
      // #293's band — written on SUCCESS only, so a jammed label (which nobody
      // ever saw) still gets its band on the reprint.
      $history.addHistoryEntry({
        firstName, lastName, clubName: effectiveClubName, clubImageData,
        printer: effectivePrinter, success: true, visitor: !!visitor, clubberId,
        trophyBook, cloudCheckin: cloudCheckin === true,
      });

      $publishers.publishTally();

      return { status: 200, body: { success: true } };
    }
  } catch (err) {
    // Log the error but keep the server alive — the next check-in must still work.
    // A jammed printer or corrupted PDF is not a reason to bring down the server.
    console.error('[print] Error:', err.message);
    // A failed DEMO print is a training problem, not an operational one: it must
    // not appear in the history the dashboard shows, and must not raise an `ops`
    // print-failure event that makes the church think a real label was lost.
    if (!isDemo) {
      $history.addHistoryEntry({
        firstName, lastName, clubName: effectiveClubName, clubImageData,
        printer: effectivePrinter, success: false, visitor: !!visitor, clubberId
      });
      $eventBuffer.recordPrintFailure(`${firstName} ${lastName}`.trim(), effectiveClubName, err.message);
    }
    return { status: 500, body: { error: err.message, ...(isDemo ? { demo: true } : {}) } };
  } finally {
    if (!isDemo) $clubbers.releasePrint(dupKey);
    if (pngPath) fs.unlink(pngPath, () => {});
    if (connectPngPath) fs.unlink(connectPngPath, () => {});
  }
}

// BARF Bag labels (8.2.0, owner 2026-10-11): one label per name, "SOPHIA'S"
// over BARF BAG, all in ONE print job. Sent by the sync Worker (a job from
// lobby Settings: every child who brought a friend tonight, and each friend
// who was named), or from this laptop. Names in, labels out; nothing kept.
const BARF_BAGS_MAX = 120;
app.post('/print-barf-bags', async (req, res) => {
  const raw = req.body && Array.isArray(req.body.names) ? req.body.names : null;
  if (!raw) return res.status(400).json({ error: 'names must be a list' });
  const names = raw.map((n) => $tags.cleanFriendName(n)).filter((n) => $tags.barfBagOwner(n)).slice(0, BARF_BAGS_MAX);
  if (!names.length) return res.status(400).json({ error: 'No names to print.' });
  const paths = [];
  try {
    for (const n of names) paths.push((await $tags.generateBarfBag(n)).pngPath);
    await $printing.printImages(paths, $config.PRINTER_NAME);
    console.log(`[print] ${names.length} BARF Bag label(s), one job`);
    res.json({ ok: true, printed: names.length });
  } catch (e) {
    console.error('[print] BARF Bag labels failed:', e.message);
    res.status(500).json({ error: 'The BARF Bag labels did not print. Check the label printer, then try again.' });
  } finally {
    for (const p of paths) fs.unlink(p, () => {});
  }
});

app.post('/print', async (req, res) => {
  const body = req.body || {};
  let firstName, lastName;
  if (body.firstName !== undefined) {
    firstName = String(body.firstName || '').trim();
    lastName  = String(body.lastName  || '').trim();
  } else if (body.name) {
    ({ firstName, lastName } = splitFullName(body.name));
  } else {
    return res.status(400).json({ error: 'name or firstName is required' });
  }
  const out = await performCheckinPrint({
    firstName, lastName,
    clubName: body.clubName, clubImageData: body.clubImageData, printerName: body.printerName,
    visitor: body.visitor, stepUpNight: body.stepUpNight, awanaShares: body.awanaShares,
    clubberId: body.clubberId, suppressConnectCard: body.suppressConnectCard, demo: body.demo,
    cloudCheckin: body.cloud === true,
    regen: body.regen === true,
    broughtFriend: body.friend === true, friendName: $tags.cleanFriendName(body.friendName),
    greetJob: typeof body.cloudJob === 'string' && /^[A-Za-z0-9_-]{22}$/.test(body.cloudJob) ? body.cloudJob : null,
  });
  res.status(out.status).json(out.body);
});
