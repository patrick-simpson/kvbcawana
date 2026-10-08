import { useCallback, useState } from 'react';
import { useDisplayLogin } from '../hooks/useDisplayLogin.js';

// First-run helper for the SIGNAGE page. An unconfigured TV used to look
// exactly like a healthy one — placeholder scene, no status sticker, the
// gear faded out — so a volunteer had nothing to click and no idea why no
// check-in ever appeared. Mirrors the countdown page's SetupChecklist
// (which is Tailwind and must stay out of this CSS graph) with signage-
// native markup: the card is a `.panel`, so it inherits the cream paper,
// hint and button styles with one positioning rule.
//
// Where it stands is the lobby's business, not the card's: it sits in the
// strip under the copy's lowest line, beside the gear (OVERLAY.setup in
// src/lib/overlayFit.js), and App asks `setupUp()` there whether the room
// has space for it right now (not over a name, a poster, the pickup board,
// which shares its seat, the tonight strip...). Its own judgement is only "is this screen still
// unconfigured, and has nobody said stop": `useSetupCard`. The two are split
// so App can ask both, and so the card can give way to content.
//
// Hidden once the screen is connected AND keyed (logged in or a pasted
// key), or once dismissed on this device. No framer-motion here; if it
// ever animates it must use M from src/lib/motion.jsx.
export const SETUP_CARD_DISMISS_KEY = 'awanaSetupCardDismissed.v1';

function dismissed() {
  try {
    return localStorage.getItem(SETUP_CARD_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Whether this screen still wants the first-run card, and the two facts the
 * card's steps tick off. `due` is false once the screen is connected and
 * keyed, or the operator chose "Don't show again" on this device.
 * @param {{ status: string, hasDisplayKey: boolean }} screen
 */
export function useSetupCard({ status, hasDisplayKey }) {
  const { loginStatus } = useDisplayLogin();
  const [hidden, setHidden] = useState(dismissed);

  const connected = status !== 'off';
  const keyed = loginStatus === 'logged-in' || Boolean(hasDisplayKey);
  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(SETUP_CARD_DISMISS_KEY, '1');
    } catch {
      /* storage blocked — hide for this session at least */
    }
    setHidden(true);
  }, []);

  return { due: !hidden && !(connected && keyed), connected, keyed, dismiss };
}

/**
 * The card itself: the two steps, what they buy, and the way in. Laid out as
 * a strip (app.css `.setup-card`): the heading and the buttons on one row,
 * the steps side by side under them.
 * @param {{
 *   card: { connected: boolean, keyed: boolean, dismiss: () => void },
 *   onOpenSettings: () => void,
 * }} props
 */
export default function SetupCard({ card, onOpenSettings }) {
  const { connected, keyed, dismiss } = card;
  const remaining = (connected ? 0 : 1) + (keyed ? 0 : 1);

  return (
    <div className="panel setup-card" role="region" aria-label="Display setup">
      <div className="setup-card__head">
        <h3>New display? {remaining === 1 ? 'One quick setup step' : 'Two quick setup steps'}</h3>
        <span className="hint">
          Names, published slides and tonight&rsquo;s counter then sync themselves.
        </span>
      </div>
      <ol>
        <li className={connected ? 'done' : ''}>
          Connect to Pusher — Settings → Setup → <strong>Advanced</strong>: paste the App Key and Cluster
          from the print-server dashboard (Settings → Pusher Integration).
        </li>
        <li className={keyed ? 'done' : ''}>
          Log in with the church&rsquo;s display passphrase — Settings → Setup → <strong>Display login</strong>.
          The passphrase is on the print-server dashboard (Settings → Display login).
        </li>
      </ol>
      <div className="actions">
        <button type="button" className="primary" title="Open Settings (Ctrl+Shift+S)" onClick={onOpenSettings}>
          Open Settings
        </button>
        <button type="button" className="ghost" onClick={dismiss}>Don&rsquo;t show again</button>
      </div>
    </div>
  );
}
