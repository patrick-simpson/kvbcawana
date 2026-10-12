/* ── Motion: the full profile's motion graphics (owner 2026-10-12) ─────
   On a Mac, a PC or a phone (effectiveProfile() 'full') Journey moves like a
   sports broadcast: the splash, every menu, Read Prep, the handout, the
   slides and the flip between the Check-in Display and Journey. The Pi
   ('low') stays exactly as it was: no class, no observer, no element, no
   inline style (only the reduced-motion query is listened to), and every
   rule in style.css's motion block is scoped to html.motion-full (see that
   block for its rules).

   html.motion-full is set when ALL hold: full profile, not configure mode,
   and the OS does not ask for reduced motion (the stylesheet checks that
   too). It follows the quality buttons and the OS setting live.

   Most motion is plain CSS that runs when an element is shown. Two pieces
   need a hand from here, and both are driven by watching the DOM rather
   than by touching the code that changes it, so no view switch or slide
   step waits on motion, and none of them knows motion exists:
   - the view flip stinger: journeyView's `hidden` class changing (setView,
     startPreview, startTeachingSlides all flip it) puts a full-screen,
     click-through overlay up for under a second. The view under it has
     already changed. Never at startup (this file runs after the first
     setView), never over a playing video (and a video that starts playing
     takes it down at once).
   - the slide change: the slide counter's text changing (showSlide) sends
     a coloured band over the stage, pops the counter and animates the new
     slide's layers (animateSlideLayers below), after the new slide is
     already there. */
const MOTION_CLASS = 'motion-full';
const MOTION_LEAD_MS = 600; // the splash lands as the stinger leaves
const reducedMotionQuery =
  typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
let motionWatchers = null;
let motionStinger = null;
let motionLeadTimer = null;
let lastSlideNumber = 0;

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
  cancelSlideLayers();
  const sweep = slidesView.querySelector('.jm-slide-sweep');
  if (sweep) sweep.remove();
}

function startMotionWatchers() {
  if (motionWatchers) return;
  const flip = new MutationObserver((records) => {
    const wasHidden = /(^|\s)hidden(\s|$)/.test(records[0].oldValue || '');
    const nowHidden = journeyView.classList.contains('hidden');
    // Into Trek's card: the card has its own entrance (style.css), and a
    // "Check-in" stinger over it would name the wrong screen.
    if (nowHidden && !trekView.classList.contains('hidden')) return;
    if (wasHidden !== nowHidden) playViewStinger(nowHidden ? 'checkin' : 'journey');
  });
  flip.observe(journeyView, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
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

function onSlideCounterChange() {
  if (!motionOn() || slidesView.classList.contains('hidden')) return;
  const match = /(\d+)/.exec(slideCounter.textContent || '');
  const number = match ? Number(match[1]) : 0;
  const back = number === lastSlideNumber - 1;
  lastSlideNumber = number;
  if (typeof slideCounter.animate === 'function') {
    slideCounter.animate(
      [{ opacity: 0, transform: 'scale(1.6)' }, { opacity: 1, transform: 'none' }],
      { duration: 320, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }
    );
  }
  // Under the flip's stinger, slide 1 lands as the stinger leaves.
  animateSlideLayers(back, motionStinger ? MOTION_LEAD_MS : 0);
  if (motionStinger) return; // the flip is already covering the stage
  const old = slidesView.querySelector('.jm-slide-sweep');
  if (old) old.remove();
  const sweep = document.createElement('div');
  sweep.className = back ? 'jm-slide-sweep is-back' : 'jm-slide-sweep';
  sweep.setAttribute('aria-hidden', 'true');
  const band = document.createElement('span');
  const edge = document.createElement('span');
  sweep.append(band, edge);
  slidesView.appendChild(sweep);
  removeAfter(sweep, edge, back ? 'jm-band-back' : 'jm-band-across', 1200);
}

/* The slide's own layers, animated apart (owner 2026-10-12): the background
   (a deck JPEG in #slide-image, or template.jpg behind #slide-template)
   wipes in behind the sweep with a little push, then on a generated slide
   the heading slams in word by word and the bullets cascade. The new slide
   is already in place when this runs (showSlide is synchronous; this is a
   microtask after it), and every frame here starts it hidden, so the old
   slide is gone at once and the new one lands. Web Animations from here,
   not stylesheet keyframes, because the same elements stay on screen from
   slide to slide and have to restart every step; a second press cancels
   what is running and starts the next slide's (nothing ever waits on
   them). Fill `backwards` only: when they end the deck's own pinned
   declarations are all that is left. The words are the heading's own text
   split at its spaces into .jm-word spans (textContent unchanged, nothing
   reordered; the next showSlide rewrites the heading anyway). */
const MOTION_EASE = {
  settle: 'cubic-bezier(0.16, 1, 0.3, 1)',
  wipe: 'cubic-bezier(0.76, 0, 0.24, 1)',
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
  const push = back ? -5 : 5;
  play(
    layer,
    [
      { clipPath: back ? 'inset(0 0 0 100%)' : 'inset(0 100% 0 0)', transform: `translateX(${push}%) scale(1.1)` },
      { clipPath: 'inset(0 0 0 0)', transform: 'none' },
    ],
    560,
    MOTION_EASE.wipe,
    40
  );
  if (!template) return;
  const words = splitHeadingWords(slideTemplateHeading);
  words.forEach((word, i) => {
    play(
      word,
      [
        { opacity: 0, transform: 'translateY(-0.4em) scale(2.2) rotate(-6deg)' },
        { opacity: 1, transform: 'scale(0.94) rotate(0deg)', offset: 0.6 },
        { opacity: 1, transform: 'none' },
      ],
      420,
      MOTION_EASE.settle,
      300 + i * 80
    );
  });
  [...slideTemplateBullets.children].forEach((li, i) => {
    play(
      li,
      [
        { opacity: 0, transform: `translateX(${back ? 6 : -6}%) skewX(-12deg)` },
        { opacity: 1, transform: 'none' },
      ],
      420,
      MOTION_EASE.settle,
      420 + words.length * 80 + i * 120
    );
  });
}

if (reducedMotionQuery) {
  if (typeof reducedMotionQuery.addEventListener === 'function') {
    reducedMotionQuery.addEventListener('change', applyMotionProfile);
  } else if (typeof reducedMotionQuery.addListener === 'function') {
    reducedMotionQuery.addListener(applyMotionProfile);
  }
}
applyMotionProfile();
