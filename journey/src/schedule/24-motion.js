/* ── Motion: the full profile's motion graphics (owner 2026-10-12) ─────
   On a Mac, a PC or a phone (effectiveProfile() 'full') Journey moves like a
   sports broadcast: the splash, every menu, Read Prep, the handout and the
   flip between the Check-in Display and Journey. The Pi
   ('low') stays exactly as it was: no class, no observer, no element, no
   inline style (only the reduced-motion query is listened to), and every
   rule in style.css's motion block is scoped to html.motion-full (see that
   block for its rules).

   html.motion-full is set when ALL hold: full profile, not configure mode,
   and the OS does not ask for reduced motion (the stylesheet checks that
   too). It follows the quality buttons and the OS setting live.

   Most motion is plain CSS that runs when an element is shown. The flip
   needs a hand from here, driven by watching the DOM rather than by
   touching the code that changes it, so no view switch waits on motion and
   none of that code knows motion exists:
   - the view flip stinger: journeyView's `hidden` class changing (setView,
     startPreview, startTeachingSlides all flip it) puts a full-screen,
     click-through overlay up for under a second. The view under it has
     already changed. Never at startup (this file runs after the first
     setView), never over a playing video (and a video that starts playing
     takes it down at once). */
const MOTION_CLASS = 'motion-full';
const MOTION_LEAD_MS = 600; // the splash lands as the stinger leaves
const reducedMotionQuery =
  typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
let motionWatchers = null;
let motionStinger = null;
let motionLeadTimer = null;

function motionWanted() {
  if (CONFIGURE_MODE || effectiveProfile() !== 'full') return false;
  return !(reducedMotionQuery && reducedMotionQuery.matches);
}

function motionOn() {
  return document.documentElement.classList.contains(MOTION_CLASS);
}

function applyMotionProfile() {
  const root = document.documentElement;
  if (motionWanted()) {
    root.classList.add(MOTION_CLASS);
    startMotionWatchers();
    return;
  }
  if (!root.classList.contains(MOTION_CLASS)) return; // never touch the low page
  root.classList.remove(MOTION_CLASS);
  stopMotionWatchers();
  clearStinger();
}

function startMotionWatchers() {
  if (motionWatchers) return;
  const flip = new MutationObserver((records) => {
    const wasHidden = /(^|\s)hidden(\s|$)/.test(records[0].oldValue || '');
    const nowHidden = journeyView.classList.contains('hidden');
    if (wasHidden !== nowHidden) playViewStinger(nowHidden ? 'checkin' : 'journey');
  });
  flip.observe(journeyView, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
  journeyVideo.addEventListener('playing', clearStinger);
  motionWatchers = [flip];
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
}

// Removes `el` when `last` (the piece that leaves last) ends its animation
// called `name` (a bar also ends its way in); a timer backs that up (a
// hidden tab or a reduced-motion switch mid-flight never sends the event).
function removeAfter(el, last, name, ms) {
  const done = () => {
    if (el.isConnected) el.remove();
    if (motionStinger === el) motionStinger = null;
  };
  last.addEventListener('animationend', (event) => {
    if (!event.animationName || event.animationName === name) done();
  });
  setTimeout(done, ms);
}

function playViewStinger(to) {
  if (!motionOn() || videoPlaying()) return;
  clearStinger();
  const stinger = document.createElement('div');
  stinger.className = to === 'journey' ? 'jm-stinger' : 'jm-stinger is-checkin';
  stinger.setAttribute('aria-hidden', 'true');
  // Four bars, bottom to top: hot, ink, deep, purple (style.css). They peel
  // away in reverse, so the first one in, the hot, is the last one out.
  const bars = [0, 1, 2, 3].map(() => {
    const bar = document.createElement('span');
    bar.className = 'jm-stinger-bar';
    stinger.appendChild(bar);
    return bar;
  });
  const word = document.createElement('div');
  word.className = 'jm-stinger-word';
  const kicker = document.createElement('span');
  kicker.className = 'jm-stinger-kicker';
  if (to === 'journey') {
    // The page's own (already loaded, already stamped) Journey wordmark.
    const mark = document.createElement('img');
    mark.src = journeyPlaceholder.querySelector('img').src;
    mark.alt = '';
    mark.draggable = false;
    kicker.textContent = 'Advocates';
    word.append(mark, kicker);
  } else {
    const shout = document.createElement('span');
    shout.className = 'jm-stinger-shout';
    shout.textContent = 'Check-in';
    kicker.textContent = 'Welcome';
    word.append(shout, kicker);
  }
  stinger.appendChild(word);
  document.body.appendChild(stinger);
  motionStinger = stinger;
  removeAfter(stinger, bars[0], 'jm-bar-out', 1600);
  if (to === 'journey') {
    const root = document.documentElement;
    root.style.setProperty('--jm-lead', `${MOTION_LEAD_MS}ms`);
    clearTimeout(motionLeadTimer);
    motionLeadTimer = setTimeout(() => root.style.removeProperty('--jm-lead'), 2000);
  }
}

if (reducedMotionQuery) {
  if (typeof reducedMotionQuery.addEventListener === 'function') {
    reducedMotionQuery.addEventListener('change', applyMotionProfile);
  } else if (typeof reducedMotionQuery.addListener === 'function') {
    reducedMotionQuery.addListener(applyMotionProfile);
  }
}
applyMotionProfile();
