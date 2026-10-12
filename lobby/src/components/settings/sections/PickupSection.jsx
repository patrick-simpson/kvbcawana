import { useState } from 'react';
import { getAllClubs } from '../../../lib/clubs.js';
import { SAMPLE_BOARD_NAMES } from '../../../lib/demoNames.js';
import { decideBoard, demoCheckout } from '../../../lib/checkoutBoard.js';
import CheckoutBoard from '../../CheckoutBoard.jsx';
import { PanelCard, Toggle } from '../fields.jsx';

export function PickupBoardCard({ form, set, goTo, title = <>Who&apos;s still here</> }) {
  return (
      <PanelCard title={title} tab="var(--brand-puggles-deep)" scope="shared" preview="pickup">
        {/* No switch and no times since 2026-10-08 (owner): the pickup
            features come on by themselves at 7:30 pm (checkoutBoard.js
            PICKUP_START), and the printer only sends a list on club nights. */}
        <p className="hint panel-intro">
          Shows by itself from 7:30 pm on club nights. Which clubs are on the list is set under Printing → Pickup list.
          {goTo && <>{' '}<button type="button" className="ghost small" onClick={() => goTo('printing')}>Which clubs →</button></>}
        </p>
        <span className="hint">
          Lists children who have <strong>not been checked out yet</strong> in the check-in system along the bottom of
          the screen, under the slides, each club&apos;s names after its plate, and says &ldquo;<em>name</em> has checked
          out&rdquo; there as each one leaves the list. Needs the check-in laptop and a volunteer with the check-in page
          open — when that tab closes, the board shows its age instead of freezing.
          {' '}<strong>It is not a verified headcount:</strong> it reflects whether checkout was actually recorded,
          which during a busy pickup often lags. Treat it as a prompt to go look, never as proof the building is clear.
        </span>
        <Toggle
          checked={form.cornerStillHere !== false}
          onChange={set('cornerStillHere')}
          title="Count down in the corner during pickup"
          hint="From 7:30 pm the corner's tonight counter becomes PICKUP and counts down as children are checked out. Not while the board hides names (below), and not from a list that has stopped updating."
        />
        <div className="field">
          <label htmlFor="cbnames">Stop showing names at or below</label>
          <input
            id="cbnames" type="number" min="0" max="200"
            value={form.checkoutBoardNamesAbove}
            onChange={set('checkoutBoardNamesAbove')}
          />
          <span className={`hint${Number(form.checkoutBoardNamesAbove) === 0 ? ' hint--warn' : ''}`}>
            At or below this many children, the board hides the names and shows &ldquo;almost everyone has been
            picked up&rdquo; instead, and a child leaving the list is &ldquo;a child&rdquo;, never a name.
            {' '}<strong>This is the setting that matters.</strong> A long list is anonymous — one name among forty
            tells a passer-by nothing. A list of two names, late in the evening, points at two specific children who
            are not yet with a parent. 0 turns the guard off entirely, which is not recommended on a public screen.
          </span>
        </div>
        <div className="field">
          <label htmlFor="cbstale">Treat the list as stale after (minutes)</label>
          <input
            id="cbstale" type="number" min="1" max="120"
            value={form.checkoutBoardStaleMin}
            onChange={set('checkoutBoardStaleMin')}
          />
          <span className="hint">After this long with no update the board says so, rather than showing a frozen list that still looks live.</span>
        </div>
      </PanelCard>
  );
}

/** The board drawn on sample names, following the form (a TV's own panel; the page has the live TV preview). */
export function PickupPreviewCard({ form, onBoardDemo }) {
  const [sample] = useState(() => demoCheckout(getAllClubs(), SAMPLE_BOARD_NAMES, Date.now()));
  // The preview follows the form: the same rules the TV applies, on sample
  // names, so turning the naming guard up shows what the room would see.
  const previewDecision = decideBoard({
    checkout: sample,
    namesAbove: Number(form.checkoutBoardNamesAbove) || 0,
    staleMin: 120,
    now: sample.at,
    demo: true,
  });
  return (
      <PanelCard title="Preview" tab="var(--brand-journey)" preview="pickup">
        <div className="board-preview" role="img" aria-label="A preview of the pickup board with sample names along the bottom of the screen, each club's names after its plate">
          <CheckoutBoard decision={previewDecision} checkout={sample} calm preview demo />
        </div>
        <span className="hint panel-intro">
          Sample names, not real children. It follows the settings above as you change them.
        </span>
        {onBoardDemo && (
          <button type="button" className="secondary section-jump" onClick={onBoardDemo}
            title="Settings closes and this screen shows the board with sample names for about 20 seconds. Only this screen; it marks it ‘demo mode’ until reloaded.">
            Show a demo on this TV (20 s)
          </button>
        )}
      </PanelCard>
  );
}

// The classic rail's Pickup board section (?rail=classic).
export function PickupSection({ form, set, onBoardDemo }) {
  return (
    <>
      <PickupBoardCard form={form} set={set} />
      <PickupPreviewCard form={form} onBoardDemo={onBoardDemo} />
    </>
  );
}
