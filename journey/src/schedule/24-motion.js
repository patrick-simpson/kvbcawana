/* ── Motion: Journey's motion graphics (owner 2026-10-12) ─────────────
   Journey moves like a sports broadcast: the splash, every menu, Read Prep,
   the handout, the slides and the flip between the Check-in Display and
   Journey. A page without motion (configure mode, or the OS asking for
   reduced motion) gets no class, no observer, no element, no inline style
   (only the reduced-motion query is listened to), and every rule in
   style.css's motion block is scoped to html.motion-full (see that block
   for its rules).

   html.motion-full is set when BOTH hold: not configure mode, and the OS
   does not ask for reduced motion (the stylesheet checks that too). It
   follows the OS setting live.

   Most motion is plain CSS that runs when an element is shown. Two pieces
   need a hand from here, and both are driven by watching the DOM rather
   than by touching the code that changes it, so no view switch or slide
   step waits on motion, and none of them knows motion exists. Both are the
   same move (owner 2026-10-12, "the band carries it"): a striped colour
   band sweeps across in ONE eased motion, the old picture rides off
   attached to the band's leading edge (same keyframes, same timing, so they
   never part), and the new picture, already in place underneath, is
   uncovered behind the band's trailing edge. Nothing waits for it, a new
   change cancels it and starts its own, and it never takes a click.
   - the view flip: a layer's `hidden` class changing (setView,
     requestPlayback, startTeachingSlides all flip them). The outgoing layer
     is the old picture: .jm-carry-out shows it again for the flip (the
     `hidden` class stays on, so every check in the code still reads it as
     hidden; the check-in iframe is restyled, never moved or reloaded) and
     moves it off with the band. Never at startup (this file runs after the
     first setView), never over a playing video (a video that starts playing
     ends it at once), never into Trek's card (it has its own entrance).
   - the slide change: the slide counter's text changing (showSlide). The
     old slide is a copy of the stage taken once the slide had landed
     (.jm-slide-ghost), carried off over the new one; the new slide's own
     layers then settle in as they are uncovered (animateSlideLayers). */
const MOTION_CLASS = 'motion-full';
// The splash's entrances wait this long under the flip, so its pieces land
// as the band uncovers them rather than playing out behind it.
const MOTION_LEAD_MS = 380;
// The carry's length (style.css --jm-carry-ms has the same numbers) and a
// backstop for its end, in case animationend never comes (hidden tab).
const CARRY_FLIP_MS = 1000;
const CARRY_SLIDE_MS = 720;
const reducedMotionQuery =
  typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
let motionWatchers = null;
let motionStinger = null; // the flip's band layer, while it runs
let motionOutgoing = null; // the layer it is carrying off
let motionLeadTimer = null;
let shownLayer = null;
let lastSlideNumber = 0;

function motionWanted() {
  if (CONFIGURE_MODE) return false;
  return !(reducedMotionQuery && reducedMotionQuery.matches);
}

function motionOn() {
  return document.documentElement.classList.contains(MOTION_CLASS);
}

function applyMotion() {
  const root = document.documentElement;
  if (motionWanted()) {
    root.classList.add(MOTION_CLASS);
    startMotionWatchers();
    return;
  }
  if (!root.classList.contains(MOTION_CLASS)) return; // never touch a still page
  root.classList.remove(MOTION_CLASS);
  stopMotionWatchers();
  clearStinger();
  clearSlideCarry();
  cancelSlideLayers();
  slideGhostSource = null;
}

// Which of the three full-screen layers is showing.
function visibleLayer() {
  if (!journeyView.classList.contains('hidden')) return journeyView;
  if (!trekView.classList.contains('hidden')) return trekView;
  return checkinView;
}

function startMotionWatchers() {
  if (motionWatchers) return;
  shownLayer = visibleLayer();
  const flip = new MutationObserver((records) => {
    const was = shownLayer;
    const now = visibleLayer();
    shownLayer = now;
    if (was === now) return;
    // Into Trek's card: the card has its own entrance (style.css). Only
    // flips into or out of Journey get the band, as they always have.
    if (now === trekView || (was !== journeyView && now !== journeyView)) {
      clearStinger();
      return;
    }
    const keep = was === journeyView ? keptJourneyPieces(records) : [];
    playViewFlip(was, now === journeyView ? 'journey' : 'checkin', keep);
  });
  for (const layer of [journeyView, trekView, checkinView, ...CARRY_KEEPABLE]) {
    flip.observe(layer, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
  }
  const slides = new MutationObserver(onSlideCounterChange);
  slides.observe(slideCounter, { childList: true, characterData: true, subtree: true });
  journeyVideo.addEventListener('playing', clearStinger);
  motionWatchers = [flip, slides];
}

function stopMotionWatchers() {
  if (!motionWatchers) return;
  for (const watcher of motionWatchers) watcher.disconnect();
  journeyVideo.removeEventListener('playing', clearStinger);
  motionWatchers = null;
}

function videoPlaying() {
  return !journeyVideo.classList.contains('hidden') && !journeyVideo.paused;
}

function clearStinger() {
  if (motionStinger) motionStinger.remove();
  motionStinger = null;
  if (motionOutgoing) motionOutgoing.classList.remove('jm-carry-out', 'is-back');
  motionOutgoing = null;
  for (const piece of motionKept) piece.classList.remove('jm-carry-keep');
  motionKept = [];
  const still = slidesView.querySelector('.jm-slide-still');
  if (still) still.remove();
}

/* Leaving Journey, the code that changes the view has already put away what
   Journey was showing (stopJourneyContent hides the splash, empties the
   slides) before this sees the flip, so the old picture would be black. The
   pieces that are pictures rather than playback (the splash, the
   placeholder, the slides) are shown again for the carry by .jm-carry-keep
   (their `hidden` class stays on and their entrances are held at rest, so
   they ride off exactly as they stood); the slides get the copy of the last
   slide that landed. The video is never kept: its source is gone. */
const CARRY_KEEPABLE = [journeyPlaceholder, journeySplash, slidesView];
let motionKept = [];

function keptJourneyPieces(records) {
  const before = new Map();
  for (const record of records) {
    if (CARRY_KEEPABLE.includes(record.target) && !before.has(record.target)) {
      before.set(record.target, record.oldValue || '');
    }
  }
  return CARRY_KEEPABLE.filter((piece) => {
    const wasShown = before.has(piece)
      ? !/(^|\s)hidden(\s|$)/.test(before.get(piece))
      : !piece.classList.contains('hidden');
    return wasShown && piece.classList.contains('hidden');
  });
}

// The band: four stripes, trailing to leading hot, ink, deep, club purple.
// The purple's leading edge is square (the old picture hangs on it); the
// stripes between are slanted (style.css).
function buildCarryBand() {
  const band = document.createElement('div');
  band.className = 'jm-carry-band';
  const stripes = document.createElement('div');
  stripes.className = 'jm-carry-stripes';
  for (let i = 0; i < 4; i += 1) {
    const stripe = document.createElement('span');
    stripe.className = 'jm-carry-stripe';
    stripes.appendChild(stripe);
  }
  band.appendChild(stripes);
  return band;
}

// Calls `done` once, when `band` ends its carry (by event, or by the timer
// for a tab that never sends it).
function afterCarry(band, ms, done) {
  let fired = false;
  const once = () => {
    if (fired) return;
    fired = true;
    done();
  };
  band.addEventListener('animationend', (event) => {
    if (!event.animationName || /^jm-carry/.test(event.animationName)) once();
  });
  setTimeout(once, ms);
}

function playViewFlip(from, to, keep = []) {
  clearStinger();
  if (!motionOn() || videoPlaying()) return;
  for (const piece of keep) {
    if (piece === slidesView) {
      if (!slideGhostSource) continue;
      const still = document.createElement('div');
      still.className = 'jm-slide-still';
      still.setAttribute('aria-hidden', 'true');
      still.inert = true;
      still.appendChild(slideGhostSource.node);
      slideGhostSource = null;
      slidesView.appendChild(still);
    }
    piece.classList.add('jm-carry-keep');
    motionKept.push(piece);
  }
  const back = to === 'checkin'; // back to the Check-in Display: right to left
  const stinger = document.createElement('div');
  stinger.className = back ? 'jm-stinger is-back' : 'jm-stinger';
  stinger.setAttribute('aria-hidden', 'true');
  const band = buildCarryBand();
  stinger.appendChild(band);
  // Same frame, same keyframes, same timing: the old layer and the band
  // start together and stay together.
  from.classList.add('jm-carry-out');
  if (back) from.classList.add('is-back');
  document.body.appendChild(stinger);
  motionStinger = stinger;
  motionOutgoing = from;
  afterCarry(band, CARRY_FLIP_MS + 600, () => {
    if (motionStinger === stinger) clearStinger();
  });
  if (to === 'journey') {
    const root = document.documentElement;
    root.style.setProperty('--jm-lead', `${MOTION_LEAD_MS}ms`);
    clearTimeout(motionLeadTimer);
    motionLeadTimer = setTimeout(() => root.style.removeProperty('--jm-lead'), 2000);
  }
}

/* The lesson intro's last card into the video (06-lesson-intro.js): the same
   carry, the card hung on the band, the video (attached, still paused) what
   it uncovers. The one place motion is waited on, because the intro is a
   timed sequence of its own: `done` (which starts the video) runs when the
   band has passed, at once without motion. */
const CARRY_INTRO_MS = 820;
let introCarry = null; // { el, sweep }

function cancelIntroCarry() {
  if (!introCarry) return;
  introCarry.sweep.remove();
  introCarry.el.classList.remove('jm-intro-out');
  introCarry = null;
}

function carryIntroOff(el, done) {
  cancelIntroCarry();
  if (!motionOn()) {
    done();
    return;
  }
  const sweep = document.createElement('div');
  sweep.className = 'jm-intro-sweep';
  sweep.setAttribute('aria-hidden', 'true');
  const band = buildCarryBand();
  sweep.appendChild(band);
  el.classList.add('jm-intro-out');
  el.after(sweep);
  const carry = { el, sweep };
  introCarry = carry;
  afterCarry(band, CARRY_INTRO_MS + 400, () => {
    if (introCarry !== carry) return;
    cancelIntroCarry();
    done();
  });
}

/* The slide change. The copy of the slide on screen is taken once that
   slide has landed (its picture resolved: the cache read showSlide started),
   so when the next press changes the stage the old slide is still in hand.
   It is the stage cloned whole, ids and all, inside an aria-hidden,
   click-through layer appended AFTER the real stage: the deck's own pinned
   rules style the copy exactly like the original, every lookup in the code
   (cached references, getElementById) still finds the real one first, and
   the copy is gone in under a second. No copy yet (the first slide, or a
   press faster than the cache) carries off plain black instead. */
let slideGhostSource = null; // { show, node }
let slideCarry = null; // { ghost, sweep }

function captureSlideSource() {
  if (!motionOn() || !slideshowActive()) return;
  slideGhostSource = { show: slideshow, node: slideStage.cloneNode(true) };
}

function clearSlideCarry() {
  if (!slideCarry) return;
  slideCarry.ghost.remove();
  slideCarry.sweep.remove();
  slideCarry = null;
}

function onSlideCounterChange() {
  if (!motionOn() || slidesView.classList.contains('hidden') || !slideshowActive()) return;
  const match = /(\d+)/.exec(slideCounter.textContent || '');
  const number = match ? Number(match[1]) : 0;
  const back = number === lastSlideNumber - 1;
  lastSlideNumber = number;
  const show = slideshow;
  const old = slideGhostSource && slideGhostSource.show === show ? slideGhostSource.node : null;
  slideGhostSource = null;
  // Take this slide's copy once its picture is in (the same memoized
  // promise showSlide is waiting on, so this runs right after it).
  const item = show.items[show.index];
  if (item) {
    resolveSlideUrl(show, item.url).then(() => {
      if (slideshow === show && show.index === number - 1) captureSlideSource();
    }, () => {});
  }
  if (typeof slideCounter.animate === 'function') {
    slideCounter.animate(
      [{ opacity: 0, transform: 'scale(1.3)' }, { opacity: 1, transform: 'none' }],
      { duration: 260, easing: MOTION_EASE.settle }
    );
  }
  clearSlideCarry();
  // Under the flip's band, slide 1 is what the flip uncovers.
  if (motionStinger) {
    animateSlideLayers(back, MOTION_LEAD_MS);
    return;
  }
  const ghost = document.createElement('div');
  ghost.className = back ? 'jm-slide-ghost is-back' : 'jm-slide-ghost';
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  if (old) ghost.appendChild(old);
  const sweep = document.createElement('div');
  sweep.className = back ? 'jm-slide-sweep is-back' : 'jm-slide-sweep';
  sweep.setAttribute('aria-hidden', 'true');
  const band = buildCarryBand();
  sweep.appendChild(band);
  slidesView.append(ghost, sweep);
  const carry = { ghost, sweep };
  slideCarry = carry;
  afterCarry(band, CARRY_SLIDE_MS + 500, () => {
    if (slideCarry === carry) clearSlideCarry();
  });
  animateSlideLayers(back, 0);
}

/* The new slide's own layers (owner 2026-10-12), timed to the band: the
   background drifts the last few percent in the band's direction (a little
   parallax, same curve, so it reads as being pushed into place), and on a
   generated slide the heading's words and the bullets settle in as the
   trailing edge uncovers them: short moves, quick fades, no overshoot. The
   new slide is already in place when this runs (showSlide is synchronous;
   this is a microtask after it). Web Animations from here, not stylesheet
   keyframes, because the same elements stay on screen from slide to slide
   and have to restart every step; a second press cancels what is running
   and starts the next slide's (nothing ever waits on them). Fill
   `backwards` only: when they end the deck's own pinned declarations are
   all that is left. The words are the heading's own text split at its
   spaces into .jm-word spans (textContent unchanged, nothing reordered; the
   next showSlide rewrites the heading anyway). */
const MOTION_EASE = {
  settle: 'cubic-bezier(0.16, 1, 0.3, 1)',
  carry: 'cubic-bezier(0.5, 0, 0.2, 1)',
};
let slideLayerAnims = [];

function cancelSlideLayers() {
  for (const anim of slideLayerAnims) anim.cancel();
  slideLayerAnims = [];
}

function splitHeadingWords(heading) {
  const text = heading.textContent;
  heading.textContent = '';
  for (const part of text.split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) {
      heading.appendChild(document.createTextNode(part));
    } else {
      const word = document.createElement('span');
      word.className = 'jm-word';
      word.textContent = part;
      heading.appendChild(word);
    }
  }
  return [...heading.querySelectorAll('.jm-word')];
}

function animateSlideLayers(back, lead) {
  cancelSlideLayers();
  if (typeof slideStage.animate !== 'function') return;
  const play = (el, frames, duration, easing, delay) => {
    slideLayerAnims.push(el.animate(frames, { duration, easing, delay: lead + delay, fill: 'backwards' }));
  };
  const template = !slideTemplate.classList.contains('hidden');
  const layer = template ? slideTemplate : slideImage;
  const dir = back ? 1 : -1;
  play(
    layer,
    [{ transform: `translateX(${dir * 6}%)` }, { transform: 'none' }],
    CARRY_SLIDE_MS,
    MOTION_EASE.carry,
    0
  );
  if (!template) return;
  // The trailing edge reaches the bullets (left) before the heading
  // (centre) going forward, the other way round going back.
  const words = splitHeadingWords(slideTemplateHeading);
  const headingAt = back ? 220 : 280;
  const bulletsAt = back ? 280 : 200;
  words.forEach((word, i) => {
    play(
      word,
      [
        { opacity: 0, transform: `translateX(${dir * 0.5}em) scale(1.08)` },
        { opacity: 1, transform: 'none' },
      ],
      440,
      MOTION_EASE.settle,
      headingAt + i * 55
    );
  });
  [...slideTemplateBullets.children].forEach((li, i) => {
    play(
      li,
      [
        { opacity: 0, transform: `translateX(${dir * 1.2}em)` },
        { opacity: 1, transform: 'none' },
      ],
      460,
      MOTION_EASE.settle,
      bulletsAt + i * 90
    );
  });
}

if (reducedMotionQuery) {
  if (typeof reducedMotionQuery.addEventListener === 'function') {
    reducedMotionQuery.addEventListener('change', applyMotion);
  } else if (typeof reducedMotionQuery.addListener === 'function') {
    reducedMotionQuery.addListener(applyMotion);
  }
}
applyMotion();
