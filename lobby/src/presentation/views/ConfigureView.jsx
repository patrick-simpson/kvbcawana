import React from 'react';
import { QuickNavItems } from './QuickNav.jsx';

/**
 * The projector's configure page (?configure=1): the operator menu's items,
 * laid out as the touch sheet lays them out, for the sound room app's
 * Settings window, which shows it beside the live projector in the same
 * browser profile. The switches, Skip Weeks and Display Settings save to that
 * profile's storage, and the projector takes them live (each store listens
 * for another window's change). The wall picks (a window, Main Countdown,
 * Resume Schedule) are relayed to the projector by App, which also mirrors
 * them here, so this list shows what the wall is showing.
 *
 * Nothing of the wall renders here: no countdown, no chimes, no wake lock.
 */
export const ConfigureView = ({ now, state, isOverride, onSelect, onResume, socketStatus }) => (
  <div className="pj-sheet pj-sheet--configure" role="main" aria-label="Projector settings">
    <div className="pj-sheet__body">
      <div className="pj-sheet__column">
        <p className="pj-sheet__hint pj-sheet__intro">
          A pick under &ldquo;Show on the wall&rdquo; changes the projector straight away. Everything else is saved for it and
          takes effect at once.
        </p>
        <QuickNavItems
          touch
          now={now}
          state={state}
          isOverride={isOverride}
          onSelect={onSelect}
          onResume={onResume}
          socketStatus={socketStatus}
        />
      </div>
    </div>
  </div>
);
