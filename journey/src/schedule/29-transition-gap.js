/* ── Club transitions: black gaps and gap welcomes (owner 2026-10-17) ───
   Around every scheduled hand-off between two views the screen goes pure
   black for TRANSITION_GAP_MIN minutes before the hand-off and as many after
   it, so Journey and Trek students pass at the door with no wrong club up.
   The number and the cutting are the family's ONE rule, shared/transitionGap.js
   (a byte copy beside this script, src/shared/transitionGap.js, loaded with
   this script's own ?v=; a test hands it over: window.journeyTransitionGapModule).
   Nothing here spells a gap edge: the night's views go in, the gaps come out.

   Club nights only (owner 2026-10-17; the lobby's rule, clubNightToday(),
   which Journey already asks through trekSmallGroupTime(); the rule not
   loaded = no gap): on any other day the views change with no black, as
   before the gaps existed. Tonight's views (journeyNightViews) are read off
   the schedule itself: the Check-in Display, Journey from JOURNEY_START,
   Trek's card from TREK_START to TREK_END, then the Check-in Display. With a
   2-minute gap: 6:28-6:32 black (Journey welcomed), 6:58-7:02 (Journey and
   Trek) and 7:28-7:32 (Trek). The views themselves still change at the
   hand-off (scheduledPhase(), lastPhase and the poll are untouched): the
   black is a layer over them (#gap-view), never a view, so the check-in
   frame under it stays loaded and connected, and the corner buttons stay
   above it.

   Never over something being watched: a lesson running (journeyLessonRunning:
   its video, slides, intro, caption question, loading overlay), a preview,
   a reading overlay or Settings holds the black off; the lesson rules stand
   as they were, and a lesson that ends inside a gap hands to its next view
   UNDER the black, which stays until the gap's end. ⇄ pressed over the black
   puts it away for the rest of that gap (the operator asked for a view).
   Configure mode: nothing here runs.

   Welcomes: the embedded lobby hands each sanitized check-in up (lib/embed.js
   hostCheckin: id, first name, club, oneOff; this origin only, after its own
   dedupe). While the black is up, a child of one of the gap's clubs (both
   neighbours' clubs, the shared rule's data) gets a welcome card in their
   club's look (Journey purple / Trek teal, the club's wordmark) and a ding,
   up 20 s after that club's latest arrival, one card per club; the rules
   (WELCOME_MS, dedupe by id, the words) are the shared module's, the same
   the downstairs classroom uses. First names live in gapState.welcomes, in
   memory only, and are forgotten when the black goes. */
const GAP_CHECKIN_MESSAGE = 'awana-display:checkin';
const GAP_FADE_MS = 900;
const GAP_TICK_MS = 1000;
const GAP_CLUBS = ['journey', 'trek'];
const GAP_MODULE_URL = (() => {
  const own = document.currentScript && document.currentScript.src;
  const url = new URL('shared/transitionGap.js', own || new URL('src/schedule.js', window.location.href).href);
  if (own) url.search = new URL(own).search;
  return url.href;
})();

const GAP_VIEW_CLUBS = { checkin: [], journey: ['journey'], trek: ['trek'] };

/* Tonight's views end to end, for the shared rule to cut its gaps from, or
   null when tonight is not a club night (no gaps then). Read off the
   schedule itself (scheduledPhaseAt, minute by minute), so the views and
   their hand-offs can never disagree with what the kiosk shows. */
function journeyNightViews(now) {
  if (!trekSmallGroupTime(now)) return null;
  const views = [];
  for (let minute = 0; minute < 24 * 60; minute += 1) {
    const view = scheduledPhaseAt(minute, true);
    const last = views[views.length - 1];
    if (last && last.view === view) last.until = minute + 1;
    else views.push({ view, from: minute, until: minute + 1, clubs: GAP_VIEW_CLUBS[view].slice() });
  }
  return views;
}

/** The scheduled gap holding `now` ({from, until, clubs}), or null. */
function scheduledGap(now = new Date()) {
  const rule = gapState.rule;
  if (!rule) return null;
  try {
    const views = journeyNightViews(now);
    if (!views) return null;
    const minutes = now.getHours() * 60 + now.getMinutes();
    const period = rule.periodAt(rule.periodsFor(views), minutes);
    return period && period.gap ? period : null;
  } catch {
    return null;
  }
}

/** Something on screen the black must never cover. */
function gapHeldOff() {
  return (
    previewMode ||
    journeyLessonRunning() ||
    readerOverlayOpen() ||
    !settingsPanel.classList.contains('hidden')
  );
}

/** Whether the black is up (fading out counts as down). */
function gapBlackUp() {
  return gapState.up;
}

/** Is a welcome card on the black right now? */
function gapWelcoming() {
  return gapState.up && gapWelcomesUp().length > 0;
}

function gapWelcomesUp() {
  if (!gapState.rule || !gapState.welcomes) return [];
  return gapState.rule.welcomesUp(gapState.welcomes, gapState.clubs, Date.now());
}

/* Asks the clock and the screen, and puts the black up or away. Cheap: a
   class changes only when the answer does. Called every second, at the end
   of every setView(), and when the rule arrives. */
function refreshGap() {
  if (!gapState.rule || CONFIGURE_MODE) return;
  const now = new Date();
  const gap = scheduledGap(now);
  const key = gap ? `${now.toDateString()} ${gap.from}` : '';
  if (key !== gapState.key) {
    const leaving = gapState.key && !key;
    gapState.key = key;
    if (gapState.dismissed !== key) gapState.dismissed = '';
    // Out of a gap: the view the schedule wants is under the black before it lifts.
    if (leaving) pollSchedule();
  }
  const want = !!gap && gapState.dismissed !== key && !gapHeldOff();
  gapState.clubs = want ? gap.clubs.slice() : [];
  if (want) showGapBlack();
  else hideGapBlack();
  drawGapWelcomes();
}

function showGapBlack() {
  if (gapState.up) return;
  gapState.up = true;
  clearTimeout(gapState.outTimer);
  gapView.classList.remove('jm-gap-out', 'hidden');
  // A view-flip band would ride over the black (it sits above every layer).
  if (typeof clearStinger === 'function') clearStinger();
}

function hideGapBlack() {
  if (!gapState.up) return;
  gapState.up = false;
  // Names go with the black (the seen ids stay, for the dedupe).
  if (gapState.welcomes) gapState.welcomes = { cards: {}, seen: gapState.welcomes.seen };
  if (motionOn()) {
    gapView.classList.add('jm-gap-out');
    clearTimeout(gapState.outTimer);
    gapState.outTimer = setTimeout(() => {
      if (gapState.up) return;
      gapView.classList.add('hidden');
      gapView.classList.remove('jm-gap-out');
    }, GAP_FADE_MS);
  } else {
    gapView.classList.add('hidden');
  }
}

/* ⇄ over the black: the operator wants a view, so this gap's black is put
   away until it ends (the next gap comes as usual). */
function dismissGap() {
  if (!gapState.up) return;
  gapState.dismissed = gapState.key;
  hideGapBlack();
  drawGapWelcomes();
}

/* The welcome cards: one per club, centred, or side by side (Journey left,
   Trek right) when both clubs have one. */
function drawGapWelcomes() {
  const up = gapState.up ? gapWelcomesUp() : [];
  for (const club of GAP_CLUBS) {
    const el = gapWelcomeEls[club];
    if (!el) continue;
    const on = up.includes(club);
    if (!on) {
      if (!el.classList.contains('hidden')) el.classList.add('hidden');
      // A name leaves the page with its card.
      const gone = el.querySelector('.gap-welcome-names');
      if (gone.textContent) gone.textContent = '';
      continue;
    }
    const slot = up.length > 1 ? (club === 'journey' ? 'left' : 'right') : 'center';
    if (el.dataset.slot !== slot) el.dataset.slot = slot;
    const names = el.querySelector('.gap-welcome-names');
    const words = gapState.rule.welcomeWords(gapState.welcomes.cards[club].names);
    if (names.textContent !== words) names.textContent = words;
    const long = words.length > 24 ? 'long' : '';
    if ((el.dataset.size || '') !== long) el.dataset.size = long;
    el.classList.remove('hidden');
  }
}

let gapAudio = null;
/** A soft two-note ding, made here (no sound file; the classroom's notes). */
function gapDing() {
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    gapAudio = gapAudio || new Context();
    if (gapAudio.state === 'suspended') gapAudio.resume();
    const t = gapAudio.currentTime + 0.02;
    for (const [freq, at, gain] of [[1318.5, 0, 0.16], [1760, 0.12, 0.12]]) {
      const osc = gapAudio.createOscillator();
      const g = gapAudio.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, t + at);
      g.gain.linearRampToValueAtTime(gain, t + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + 1.1);
      osc.connect(g).connect(gapAudio.destination);
      osc.start(t + at);
      osc.stop(t + at + 1.2);
    }
  } catch {
    /* no sound here */
  }
}

/* A check-in handed up by the embedded lobby (its own frame, this origin). */
function onGapCheckin(event) {
  if (!checkinFrame || event.source !== checkinFrame.contentWindow || event.origin !== CHECKIN_DISPLAY_ORIGIN) return;
  const data = event.data;
  if (!data || typeof data !== 'object' || data.type !== GAP_CHECKIN_MESSAGE) return;
  if (!gapState.rule || !gapState.up) return;
  const result = gapState.rule.welcomeFor(gapState.welcomes || gapState.rule.emptyWelcomes(), data, gapState.clubs, Date.now());
  if (!result.ding) return;
  gapState.welcomes = result.state;
  drawGapWelcomes();
  gapDing();
}

async function loadGapRule() {
  if (window.journeyTransitionGapModule) return window.journeyTransitionGapModule;
  try {
    return await import(GAP_MODULE_URL);
  } catch {
    return null;
  }
}

if (!CONFIGURE_MODE) {
  window.addEventListener('message', onGapCheckin);
  loadGapRule().then((rule) => {
    if (!rule || typeof rule.periodsFor !== 'function' || typeof rule.welcomeFor !== 'function') return;
    gapState.rule = rule;
    gapState.welcomes = rule.emptyWelcomes();
    refreshGap();
  });
  setInterval(refreshGap, GAP_TICK_MS);
}
