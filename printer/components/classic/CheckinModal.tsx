import React, { useEffect, useRef } from 'react';
import { Clubber } from './types';

interface CheckinModalProps {
  clubber: Clubber | null;
  onClose: () => void;
  onConfirm: (clubber: Clubber) => void;
}

// A replica of TwoTimTwo's check-in modal: #checkin-modal and the
// button#checkin inside it, TwoTimTwo's own ids (DOM_SELECTORS); keep both. The tt-
// classes are the replica's look (styles/home.css).
export const CheckinModal: React.FC<CheckinModalProps> = ({ clubber, onClose, onConfirm }) => {
  const checkinRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!clubber) return;
    const opener = document.activeElement as HTMLElement | null;
    checkinRef.current?.focus();
    // aria-modal promises the page behind is out of reach, so keep Tab inside
    // the dialog and stop the page scrolling underneath it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const items: HTMLElement[] = Array.prototype.slice.call(dialogRef.current.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'));
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      const active = document.activeElement;
      const inside = !!active && dialogRef.current.contains(active);
      if (e.shiftKey && (active === first || !inside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !inside)) { e.preventDefault(); first.focus(); }
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [clubber, onClose]);

  if (!clubber) return null;

  return (
    <div id="checkin-modal" className="tt-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialogRef} className={`tt-dialog tt-dialog--${clubber.gender}`} role="dialog" aria-modal="true" aria-labelledby="checkin-modal-title">
        <div className="tt-dialog__head">
          <div className="tt-dialog__who">
            <h3 className="tt-dialog__name" id="checkin-modal-title">{clubber.name}</h3>
            <div className="tt-dialog__meta">
              <b>{clubber.club}</b>
              <span><i>Color:</i> {clubber.color}</span>
              <span><i>Group:</i> {clubber.group}</span>
            </div>
          </div>
          <div className="tt-dialog__checks">
            <label><input type="checkbox" defaultChecked /> Bible</label>
            <label><input type="checkbox" /> Friend</label>
          </div>
          <button onClick={onClose} aria-label="Close" className="tt-dialog__x">&times;</button>
        </div>
        <div className="tt-dialog__foot">
          <button id="checkin" ref={checkinRef} onClick={() => onConfirm(clubber)} className="tt-btn tt-btn--go">Checkin</button>
          <button className="tt-btn tt-btn--pay">Add Payment</button>
          <button onClick={onClose} className="tt-btn tt-btn--cancel">Cancel</button>
        </div>
      </div>
    </div>
  );
};
