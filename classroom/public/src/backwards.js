// Backwards Night on the classroom screen (owner 2026-11-23; the rules are
// shared/backwards.js, the switch is the Worker's). The embedded lobby says
// when it is on (`awana-display:backwards {on}`, its own frame and origin
// only); this spells the text of the classroom's OWN cards and welcomes
// backwards, follows new text as it appears (a welcome's names), and puts
// every original back when it goes off. Never touches the lobby frame.

/** Spelled backwards by letter, accents kept on their letter. @param {string} s */
export function backwardsText(s) {
  if (typeof s !== 'string' || !s) return s;
  let parts;
  try { parts = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s), (x) => x.segment); } catch { parts = Array.from(s); }
  return parts.reverse().join('');
}

/**
 * @param {Element[]} roots the containers whose text turns
 * @returns {{ set: (on: boolean) => void, on: () => boolean }}
 */
export function createBackwards(roots) {
  /** text node -> { orig, shown } */
  const seen = new Map();
  let on = false;
  /** @param {Node} n */
  const flip = (n) => {
    const now = n.nodeValue || '';
    const had = seen.get(n);
    if (had && had.shown === now) return;          // our own write coming back
    const orig = now;
    const shown = backwardsText(orig);
    seen.set(n, { orig, shown });
    if (shown !== now) n.nodeValue = shown;
  };
  /** @param {Node} root */
  const walk = (root) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if ((n.nodeValue || '').trim()) flip(n);
  };
  const mo = typeof MutationObserver === 'function' ? new MutationObserver((list) => {
    if (!on) return;
    for (const m of list) {
      if (m.type === 'characterData') flip(m.target);
      else for (const n of m.addedNodes) (n.nodeType === 3 ? flip(n) : walk(n));
    }
  }) : null;
  return {
    on: () => on,
    set(next) {
      if (next === on) return;
      on = next;
      if (on) {
        for (const r of roots) { walk(r); mo?.observe(r, { subtree: true, childList: true, characterData: true }); }
      } else {
        mo?.disconnect();
        for (const [n, v] of seen) if (n.nodeValue === v.shown) n.nodeValue = v.orig;
        seen.clear();
      }
      document.documentElement.classList.toggle('cr-backwards', on);
    },
  };
}
