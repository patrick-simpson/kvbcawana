import React, { useEffect, useRef, useState } from 'react';
import { useClockDrift } from '../hooks/useClockDrift.js';
import { SetupChecklist, useSetupNeeded } from '../components/SetupChecklist.jsx';
import { CLOCK_DRIFT_HELP, QuickNavItems } from './QuickNav.jsx';

/**
 * The operator menu on a phone or tablet (lib/touch.js). The projector PC's
 * menu opens on hover (QuickNav.jsx), and a finger cannot hover: the owner
 * could not reach anything in it, B included. Here it is a visible button in
 * the top-right corner that opens a full-screen sheet with the same items
 * (QuickNavItems, touch-sized), and App renders this INSTEAD of QuickNav, so
 * no invisible panel is left on the wall to catch a tap meant for it.
 *
 * A pick that changes the wall (a window, Resume Schedule) closes the sheet,
 * so the phone shows what it picked; the settings (Skip Weeks, the switches,
 * Display Settings) leave it open. While it is open the sheet owns the
 * keyboard: a tablet's keyboard never reaches the wall's own shortcuts
 * underneath (Space skipped the countdown), typing into its fields still
 * works, and Escape closes it.
 */
export const TouchMenu = ({ now, state, isOverride, onSelect, onResume, socketStatus, open, displayOpen, onOpen, onClose }) => {
  const skewMs = useClockDrift();
  // A screen still to be set up: the button carries a mark (on a phone on its
  // side the wall has no room for the setup note), and the sheet opens on
  // Display Settings with the note's steps at its top.
  const setup = useSetupNeeded().show;
  return (
    <>
      <div className="pj-touch-bar">
        <button
          type="button"
          className="pj-touch-menu"
          onClick={onOpen}
          aria-label="Open the menu"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-describedby={setup ? 'pj-touch-menu-setup' : undefined}
          data-touch-menu
          data-setup={setup ? '' : undefined}
        >
          {setup && <span id="pj-touch-menu-setup" className="sr-only">This display still needs setting up</span>}
          <MenuIcon />
        </button>
        {skewMs !== null && <ClockDriftPill skewMs={skewMs} />}
      </div>
      {open && (
        <MenuSheet
          onClose={onClose}
          now={now}
          state={state}
          isOverride={isOverride}
          socketStatus={socketStatus}
          displayOpen={displayOpen || setup}
          onSelect={(pick) => {
            onSelect(pick);
            onClose();
          }}
          onResume={() => {
            onResume();
            onClose();
          }}
        />
      )}
    </>
  );
};

/** Three bars: the menu, in the kit's white. */
const MenuIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
    <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" fill="none" />
  </svg>
);

/**
 * The clock-drift warning, as on the PC it is always visible; its fix is a
 * tooltip there, which a finger cannot open, so a tap reads it out here.
 */
const ClockDriftPill = ({ skewMs }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="pj-touch-drift">
      <button type="button" className="pj-touch-drift__pill" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        ⚠ clock off by ~{Math.round(Math.abs(skewMs) / 60000)} min
      </button>
      {open && <p className="pj-touch-drift__help" role="status">{CLOCK_DRIFT_HELP}</p>}
    </div>
  );
};

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]';

const MenuSheet = ({ onClose, ...items }) => {
  const sheet = useRef(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  // The sheet owns the keyboard while it is open. A key typed INSIDE it goes
  // to its own field or button as usual and stops at the sheet (onKeyDown
  // below), so it never reaches the wall's window listeners; a key pressed
  // anywhere else (focus on the page behind) is stopped here, in the window's
  // capture phase, before any of them hears it. Focus starts on the sheet and
  // goes back where it was when it closes.
  useEffect(() => {
    const before = document.activeElement;
    sheet.current?.focus();
    const onKey = (e) => {
      if (sheet.current?.contains(e.target)) return;
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        close.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (before && before instanceof HTMLElement && document.contains(before)) before.focus();
    };
  }, []);

  const onKeyDown = (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    // Tab walks the sheet's own controls, never the wall behind it.
    const list = [...(sheet.current?.querySelectorAll(FOCUSABLE) ?? [])];
    if (!list.length) return;
    const i = list.indexOf(document.activeElement);
    const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i === -1 || i === list.length - 1 ? 0 : i + 1);
    e.preventDefault();
    list[next].focus();
  };

  return (
    <div
      ref={sheet}
      className="pj-sheet"
      role="dialog"
      aria-modal="true"
      aria-label="Projector menu"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div className="pj-sheet__head">
        <h2 className="pj-sheet__title">Projector menu</h2>
        <button type="button" className="pj-sheet__close" onClick={onClose} aria-label="Close the menu">
          ✕
        </button>
      </div>
      <div className="pj-sheet__body">
        <div className="pj-sheet__column">
          <SetupChecklist touch inSheet />
          <QuickNavItems touch {...items} />
        </div>
      </div>
    </div>
  );
};
