import React from 'react';
import churchLogo from '../../../print-server/public/brand/logos/kvbc-awana-two-line-white.svg';

// The print server window's header (owner 2026-10-13): the church's own logo,
// two-line and white on the Awana blue, never under 260px wide (its thin
// church line's floor), with the window's status line under it and whatever
// sits on the right (the status window's stepped chip). The app's name, KVBC
// Awana, is the window's title and this header's heading for screen readers;
// the logo already says it on screen.
export default function BrandHeader({ sub, subTone, children }) {
  return (
    <header className="app-header">
      <div className="titles">
        <img className="brand-logo" src={churchLogo} alt="" width="260" height="55" />
        <h1 className="sr-only">KVBC Awana</h1>
        {sub ? <span className={`sub${subTone ? ` ${subTone}` : ''}`}>{sub}</span> : null}
      </div>
      {children}
    </header>
  );
}
