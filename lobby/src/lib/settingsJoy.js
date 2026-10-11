// @ts-check
// Settings' joyful feedback (owner, 2026-10-11: "joyful animations as I
// select each option"). Choosing a box, a radio option or a menu value makes
// that control boing and throws a little burst of kit sparkles from it.
//
// Done in the DOM, from the change event, never as a CSS animation keyed on
// :checked: that would also play on every already-checked box the moment a
// section mounts (the same reason the soft squish uses transitions). Nothing
// at all happens under zero animation (?lowPower=1) or the OS's reduced
// motion; the CSS kill switches cover the boing too, and the sparkles are
// never even made.

/** Kit colours the sparkles draw from (tokens.css' house colours). */
export const JOY_COLORS = Object.freeze(['#1DB6D9', '#FCB614', '#F15A28', '#7AC143', '#EC008C', '#2E3192']);
export const JOY_MS = 700;
const SPARKS = 8;

/** @param {Window} win */
export function joyAllowed(win = window) {
  if (win.document.documentElement.classList.contains('zero-animation-mode')) return false;
  try {
    return !win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true;
  }
}

/**
 * The control a change event should celebrate, and whether it is a
 * selection (sparkles) or a deselection (only a small boop).
 *
 * @param {EventTarget|null} target
 * @returns {{ el: HTMLElement, selected: boolean }|null}
 */
export function joyTarget(target) {
  if (!(target instanceof HTMLElement)) return null;
  if (target instanceof HTMLInputElement && target.type === 'checkbox') {
    return { el: target, selected: target.checked };
  }
  if (target instanceof HTMLInputElement && target.type === 'radio') {
    const option = target.closest('.radio-option');
    return option instanceof HTMLElement ? { el: option, selected: true } : null;
  }
  if (target instanceof HTMLSelectElement) return { el: target, selected: true };
  return null;
}

/**
 * Celebrate one change: restart the control's boing and, for a selection,
 * burst sparkles from its centre in a layer of their own on <body> (never
 * inside React's tree), cleared after JOY_MS.
 *
 * @param {Event} event
 * @param {Window} [win]
 */
export function celebrateChange(event, win = window) {
  const hit = joyTarget(event.target);
  if (!hit || !joyAllowed(win)) return;
  const { el, selected } = hit;
  const cls = selected ? 'joy-pop' : 'joy-boop';
  el.classList.remove('joy-pop', 'joy-boop');
  void el.offsetWidth; // restart the animation on a quick second change
  el.classList.add(cls);
  win.setTimeout(() => el.classList.remove(cls), JOY_MS);
  if (!selected) return;

  // Burst from the part that was picked: a radio's own dot (not the middle
  // of its pill, over its words), a menu's arrow, a box itself.
  const target = /** @type {HTMLElement} */ (event.target);
  const r = target.getBoundingClientRect();
  const x = target instanceof HTMLSelectElement ? r.right - 18 : r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const burst = win.document.createElement('div');
  burst.className = 'joy-burst';
  burst.setAttribute('aria-hidden', 'true');
  burst.style.left = `${x}px`;
  burst.style.top = `${y}px`;
  const reach = target instanceof HTMLSelectElement ? 34 : Math.max(28, Math.min(48, Math.max(r.width, r.height) * 1.2));
  for (let i = 0; i < SPARKS; i += 1) {
    const a = (Math.PI * 2 * i) / SPARKS + (i % 2 ? 0.2 : -0.1);
    const d = reach * (i % 2 ? 0.8 : 1.1);
    const s = win.document.createElement('span');
    s.className = i % 3 === 2 ? 'joy-burst__dot' : 'joy-burst__spark';
    s.style.setProperty('--dx', `${(Math.cos(a) * d).toFixed(1)}px`);
    s.style.setProperty('--dy', `${(Math.sin(a) * d).toFixed(1)}px`);
    s.style.setProperty('--spin', `${i % 2 ? 140 : -120}deg`);
    s.style.background = JOY_COLORS[i % JOY_COLORS.length];
    burst.appendChild(s);
  }
  win.document.body.appendChild(burst);
  win.setTimeout(() => burst.remove(), JOY_MS);
}
