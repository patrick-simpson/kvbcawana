import React from 'react';
import awanaMark from '../../../print-server/public/brand/logos/awana-clubs-white.svg';

// The print server window's header: the white Awana Clubs mark and the app's
// name (KVBC Awana since v9) on the Awana blue, a Londrina sub line,
// and whatever sits on the right (the status window's stepped chip).
export default function BrandHeader({ sub, subTone, children }) {
  return (
    <header className="app-header">
      <img className="brand-mark" src={awanaMark} alt="Awana Clubs" width="91" height="38" />
      <div className="titles">
        <h1>KVBC Awana</h1>
        {sub ? <span className={`sub${subTone ? ` ${subTone}` : ''}`}>{sub}</span> : null}
      </div>
      {children}
    </header>
  );
}
