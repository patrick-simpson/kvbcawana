import React, { useSyncExternalStore } from 'react';
import { FLAGS } from '../lib/flags.js';
import { useConfig } from '../../hooks/useConfig.js';
import { useDisplayLogin } from '../../hooks/useDisplayLogin.js';

// First-run helper: a new screen needs (a) the Pusher key — baked into the
// build when the repository variables are set, else typed — and (b) to be
// logged in with the church's display passphrase, which provisions the
// display key (sealed birthdays) and the publish token. Until both are
// true (or the operator dismisses it), show a quiet note that points at the
// QuickNav menu. Dismissal is remembered per device.
const DISMISS_KEY = 'awanaSetupChecklistDismissed.v1';

/**
 * Where the note stands, in projector units down the 16:9 frame (index.css
 * `.pj-setup-note`): the bottom margin band. `top` is the first line below
 * anything a view draws: the Upcoming Awana Nights list stops at 51.75u
 * (Slide.jsx COMING_UP.bottom, its title-safe margin) and every other view
 * ends higher (the countdown ~46u with its four special nights listed, ~50u
 * with the week's theme chip too; game time ~46u, the shutdown ~42u, the
 * slides ~31u; e2e/setup-card.spec.js measures them). The
 * note used to be a 23rem card in the bottom-left corner, which sat on the
 * left of the events list at 720p and the coming-up chips at 1080p, since a
 * corner of a centred, full-width layout is never free. It is a strip now:
 * two lines, on the slides' own left margin (8u) and no wider than their text
 * block (84u), from `top` down.
 *
 * The band is not empty of the wall's OWN overlays, though. The slideshow's
 * hover Prev / Next pill stands at the window's bottom-right, so the note is
 * only as wide as its words and stops 14.5rem short of the right edge
 * (wrapping to a third line in a 4:3 window's black band if it must). The ESC
 * toast and the watchdog's resume pill stand at bottom-centre, over the
 * middle of any strip wide enough to read: they carry `data-pj-bottom-overlay`
 * and the note is hidden (index.css, `:has()`) while either is in the DOM,
 * its exit animation included.
 */
export const SETUP_NOTE = { top: 51.75, width: 84 };

// The dismissal is one small store, because on a phone or tablet three
// things read it: the note on the wall, its copy at the top of the touch
// menu's sheet, and the menu button's setup mark. Read from storage every
// time (a primitive, so React sees no change until there is one); where
// storage is blocked a dismissal holds for this page's life.
let dismissedHere = false;
const listeners = new Set();

function dismissed() {
  if (dismissedHere) return true;
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** "Don't show again": remembered on this device. */
export function dismissSetup() {
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    dismissedHere = true; // storage blocked — hide for this session at least
  }
  for (const fn of listeners) fn();
}

/**
 * Whether this screen still needs setting up, and what it still needs.
 * `show` is false once it is keyed and logged in, once dismissed, and always
 * in screenshot mode (?vr=1): operator chrome stays out of it.
 */
export function useSetupNeeded() {
  const { config } = useConfig();
  const { loginStatus } = useDisplayLogin();
  const hidden = useSyncExternalStore(subscribe, dismissed, dismissed);
  const hasKey = Boolean(config.pusherAppKey);
  const loggedIn = loginStatus === 'logged-in';
  return { show: !FLAGS.vr && !hidden && !(hasKey && loggedIn), hasKey, loggedIn };
}

/**
 * The note. `touch` (a phone or tablet, lib/touch.js) is its touch form: the
 * same steps, a "Set up" button that opens the touch menu on Display
 * Settings (`onSetUp`), both buttons a finger's size, and no "hover" in its
 * words. `inSheet` is its copy at the top of that menu, where the setting up
 * happens (on a phone on its side the wall has no room for it at all).
 */
export const SetupChecklist = ({ touch = false, inSheet = false, onSetUp }) => {
  const { show, hasKey, loggedIn } = useSetupNeeded();
  if (!show) return null;

  if (touch) {
    return (
      <div
        className={inSheet ? 'pj-sheet__setup' : 'pj-panel pj-setup-note pj-setup-note--touch'}
        role="region"
        aria-label="Display setup"
        data-setup-checklist={inSheet ? undefined : ''}
        data-setup-in-sheet={inSheet ? '' : undefined}
      >
        <div className="pj-setup-note__text">
          <p className="pj-kicker pj-setup-note__kicker">
            New display? {hasKey ? 'one quick setup step' : 'two quick setup steps'}
          </p>
          <ul className="pj-panel-note pj-setup-note__steps">
            {!hasKey && <li>⬜ Live data key (under Advanced)</li>}
            <li>{loggedIn ? '✅' : '⬜'} Log in with the display passphrase</li>
          </ul>
          {inSheet && (
            <p className="pj-panel-note pj-setup-note__where">
              Both are in Display Settings, below. The passphrase is on the print-server dashboard
              (Settings → Display login).
            </p>
          )}
        </div>
        <div className="pj-setup-note__actions">
          {!inSheet && onSetUp && (
            <button type="button" onClick={onSetUp} className="pj-hot-button pj-setup-note__go">
              Set up
            </button>
          )}
          <button type="button" onClick={dismissSetup} className="pj-line-button pj-setup-note__dismiss">
            Don't show again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pj-panel pj-setup-note" role="region" aria-label="Display setup" data-setup-checklist>
      <div className="pj-setup-note__text">
        <p className="pj-kicker pj-setup-note__kicker">
          New display? {hasKey ? 'one quick setup step' : 'two quick setup steps'}
        </p>
        <ul className="pj-panel-note pj-setup-note__steps">
          {!hasKey && <li>⬜ Live data key (under Advanced)</li>}
          <li>{loggedIn ? '✅' : '⬜'} Log in with the display passphrase</li>
        </ul>
        <p className="pj-panel-note pj-setup-note__where">
          Hover the top-right corner → Display Settings. The passphrase is on the print-server dashboard
          (Settings → Display login).
        </p>
      </div>
      <button onClick={dismissSetup} className="pj-line-button pj-setup-note__dismiss">
        Don't show again
      </button>
    </div>
  );
};
