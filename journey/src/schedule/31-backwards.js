
/* ── Backwards Night (owner 2026-11-23) ──────────────────────────────
   "I want almost everything to be backwards on the screen." The embedded
   Check-in Display (its own frame and origin only) says when (lobby
   hostBackwards: {type, on}, nothing else); this page then spells the words
   of its OWN cards backwards: the splash, the lesson intro's cards, Trek's
   card, the count chip and the club-gap welcomes, following new text as it
   appears (a welcome's names), and puts every original back after. The
   lesson video, its captions, the teaching slides and Settings stay the
   right way round (the lesson is taught from them). Configure mode: nothing. */
const BACKWARDS_MESSAGE = 'awana-display:backwards';

/** Spelled backwards by letter, accents kept on their letter (shared/backwards.js's rule). */
function backwardsText(s) {
  if (typeof s !== 'string' || !s) return s;
  let parts;
  try { parts = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s), (x) => x.segment); } catch { parts = Array.from(s); }
  return parts.reverse().join('');
}

const backwardsState = { on: false, seen: new Map(), observer: null };

function backwardsRoots() {
  return ['journey-splash', 'journey-intro', 'trek-view', 'journey-chip', 'gap-view']
    .map((id) => document.getElementById(id)).filter((el) => el !== null);
}

function backwardsFlip(node) {
  const now = node.nodeValue || '';
  const had = backwardsState.seen.get(node);
  if (had && had.shown === now) return;
  const shown = backwardsText(now);
  backwardsState.seen.set(node, { orig: now, shown });
  if (shown !== now) node.nodeValue = shown;
}

function backwardsWalk(root) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) if ((n.nodeValue || '').trim()) backwardsFlip(n);
}

function setBackwardsNight(on) {
  if (on === backwardsState.on) return;
  backwardsState.on = on;
  const roots = backwardsRoots();
  if (on) {
    if (!backwardsState.observer && typeof MutationObserver === 'function') {
      backwardsState.observer = new MutationObserver((list) => {
        if (!backwardsState.on) return;
        for (const m of list) {
          if (m.type === 'characterData') backwardsFlip(m.target);
          else for (const n of m.addedNodes) (n.nodeType === 3 ? backwardsFlip(n) : backwardsWalk(n));
        }
      });
    }
    for (const r of roots) {
      backwardsWalk(r);
      if (backwardsState.observer) backwardsState.observer.observe(r, { subtree: true, childList: true, characterData: true });
    }
  } else {
    if (backwardsState.observer) backwardsState.observer.disconnect();
    for (const [n, v] of backwardsState.seen) if (n.nodeValue === v.shown) n.nodeValue = v.orig;
    backwardsState.seen.clear();
  }
  document.documentElement.classList.toggle('backwards', on);
  console.info(`[journey] Backwards Night ${on ? 'on' : 'off'}`);
}

if (!CONFIGURE_MODE) {
  window.addEventListener('message', (event) => {
    if (!checkinFrame || event.source !== checkinFrame.contentWindow || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || typeof data !== 'object' || data.type !== BACKWARDS_MESSAGE) return;
    setBackwardsNight(data.on === true);
  });
}
