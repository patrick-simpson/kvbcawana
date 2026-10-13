import React from 'react';

/**
 * The public pages' icon set: one family, drawn for them on a 24px grid with a
 * 2.25 round stroke (the weight of the kit's doodles at button size), filled
 * accents only where a glyph needs a solid (a play triangle, a flame). Rendered
 * once per page as a sprite; <Ico name="…" /> uses a symbol.
 */
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.25, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const SYMBOLS: Record<string, React.ReactNode> = {
  label: <g {...S}><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><path d="M6.5 10.5h7M6.5 13.5h4.5" /><circle cx="17.2" cy="12" r="1.4" /></g>,
  printer: <g {...S}><path d="M6.5 9V3.5h11V9" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M7 14.5h10v6H7z" /><path d="M17.5 12h.01" /></g>,
  tv: <g {...S}><rect x="2.5" y="4" width="19" height="12.5" rx="2" /><path d="M8 20.5h8M12 16.5v4" /></g>,
  projector: <g {...S}><rect x="2.5" y="8" width="19" height="9" rx="2.5" /><circle cx="15.5" cy="12.5" r="2.5" /><path d="M6 12.5h4M5 17v2.5M19 17v2.5M12 8V4.5M8.5 5.5 10 8M15.5 5.5 14 8" /></g>,
  kiosk: <g {...S}><rect x="3.5" y="3" width="17" height="12.5" rx="2" /><path d="M10.5 7v4.5l3.8-2.25z" fill="currentColor" /><path d="M12 15.5V21M8 21h8" /></g>,
  phone: <g {...S}><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M10.5 18.5h3" /><path d="m9.5 10.5 1.8 1.8 3.4-3.6" /></g>,
  laptop: <g {...S}><rect x="4.5" y="4.5" width="15" height="10" rx="1.5" /><path d="M2.5 18.5h19l-1.5-4h-16z" /></g>,
  shield: <g {...S}><path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.3 7.5 9.5 4.4-1.2 7.5-4.9 7.5-9.5V6z" /><path d="m8.8 12 2.3 2.3 4.3-4.6" /></g>,
  lock: <g {...S}><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3M12 14.5v2" /></g>,
  key: <g {...S}><circle cx="8" cy="14" r="4.5" /><path d="M11.3 10.8 20 2.5M16.5 6l2.5 2.5M14 8.5l2 2" /></g>,
  cake: <g {...S}><path d="M4 21h16v-7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2z" /><path d="M4 16.5c1.3 1 2.7 1 4 0s2.7-1 4 0 2.7 1 4 0 2.7-1 4 0M12 12V8.5" /><path d="M12 3.2c.9 1.1 1.3 1.9 1.3 2.6a1.3 1.3 0 0 1-2.6 0c0-.7.4-1.5 1.3-2.6z" fill="currentColor" /></g>,
  star: <g {...S}><path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z" /></g>,
  clock: <g {...S}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></g>,
  refresh: <g {...S}><path d="M20 11a8 8 0 0 0-14.3-4.6L4 8.5" /><path d="M4 3.5v5h5M4 13a8 8 0 0 0 14.3 4.6L20 15.5M20 20.5v-5h-5" /></g>,
  users: <g {...S}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.5-3.6 3.2-6 6.5-6s6 2.4 6.5 6" /><path d="M16 4.8a3.3 3.3 0 0 1 0 6.4M18.5 14.4c1.7.9 2.8 2.9 3 5.6" /></g>,
  wifi: <g {...S}><path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.7 16a5 5 0 0 1 6.6 0" /><path d="M12 19.5h.01" strokeWidth="3" /></g>,
  check: <g {...S}><path d="m4.5 12.5 4.5 4.5 10.5-11" /></g>,
  arrow: <g {...S}><path d="M4 12h15M13 6l6 6-6 6" /></g>,
  arrowDown: <g {...S}><path d="M12 4v15M6 13l6 6 6-6" /></g>,
  download: <g {...S}><path d="M12 3.5v11M7 9.5l5 5 5-5M4.5 19.5h15" /></g>,
  play: <g><path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></g>,
  pause: <g fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1.2" /><rect x="14" y="4.5" width="4" height="15" rx="1.2" /></g>,
  replay: <g {...S}><path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5" /><path d="M4 3.5v5h5" /></g>,
  soundOn: <g {...S}><path d="M3.5 9.5h3.5L12 5.5v13l-5-4H3.5z" fill="currentColor" /><path d="M16 9a4 4 0 0 1 0 6M18.8 6.5a8 8 0 0 1 0 11" /></g>,
  soundOff: <g {...S}><path d="M3.5 9.5h3.5L12 5.5v13l-5-4H3.5z" fill="currentColor" /><path d="m16 9.5 5 5M21 9.5l-5 5" /></g>,
  help: <g {...S}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.8-2.5 2.3-2.5 4" /><path d="M12 17.3h.01" strokeWidth="3" /></g>,
  code: <g {...S}><path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.5 4.5l-3 15" /></g>,
  book: <g {...S}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" /></g>,
  sparkle: <g {...S}><path d="M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7z" fill="currentColor" /></g>,
  chev: <g {...S}><path d="m9 5 7 7-7 7" /></g>,
  close: <g {...S}><path d="M6 6l12 12M18 6 6 18" /></g>,
  peanut: <g {...S}><path d="M9.2 3.5c-3 0-4.8 2.4-4.4 5 .3 1.8 1.6 2.6 1.5 3.9-.1 1.2-1.6 2-1.6 4 0 2.7 2.3 4.6 5 4.3 3-.3 3.4-2.9 5-3.4 1.6-.5 3.2.1 4.6-1.5 1.9-2.1 1.3-5.4-1-6.6-1.3-.7-2.7-.5-3.6-1.5-.9-1-.8-2.5-1.9-3.4-.9-.6-2-.8-3.6-.8z" /></g>,
  nocam: <g {...S}><path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.8l1.5-2h6.4l1.5 2h2.8A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" /><circle cx="12" cy="13" r="3.4" /><path d="M3.5 3.5l17 17" strokeWidth="2.75" /></g>,
  milk: <g {...S}><path d="M7 3h10l-1.3 17.2a1.5 1.5 0 0 1-1.5 1.3H9.8a1.5 1.5 0 0 1-1.5-1.3z" /><path d="M7.6 10.5h8.8" /></g>,
  // The Journey kiosk's gear, the same drawing as its corner button (journey/public/index.html).
  gear: <g {...S}><path d="M9.81 4.93L10.38 2.54L13.62 2.54L14.19 4.93A7.4 7.4 0 0 1 15.45 5.45L17.54 4.16L19.84 6.46L18.55 8.55A7.4 7.4 0 0 1 19.07 9.81L21.46 10.38L21.46 13.62L19.07 14.19A7.4 7.4 0 0 1 18.55 15.45L19.84 17.54L17.54 19.84L15.45 18.55A7.4 7.4 0 0 1 14.19 19.07L13.62 21.46L10.38 21.46L9.81 19.07A7.4 7.4 0 0 1 8.55 18.55L6.46 19.84L4.16 17.54L5.45 15.45A7.4 7.4 0 0 1 4.93 14.19L2.54 13.62L2.54 10.38L4.93 9.81A7.4 7.4 0 0 1 5.45 8.55L4.16 6.46L6.46 4.16L8.55 5.45A7.4 7.4 0 0 1 9.81 4.93Z" /><circle cx="12" cy="12" r="3" /></g>,
  swap: <g {...S}><path d="M4 8.5h15M15 4.5l4 4-4 4M20 15.5H5M9 11.5l-4 4 4 4" /></g>,
  search: <g {...S}><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5.5 5.5" /></g>,
};

export type IcoName = keyof typeof SYMBOLS;

export const IconSprite: React.FC = () => (
  <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
    <defs>
      {Object.entries(SYMBOLS).map(([id, body]) => <symbol key={id} id={`kv-${id}`} viewBox="0 0 24 24">{body}</symbol>)}
    </defs>
  </svg>
);

export const Ico: React.FC<{ name: IcoName; className?: string; title?: string }> = ({ name, className = '', title }) => (
  <svg className={`kv-ico ${className}`} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} aria-label={title} focusable="false">
    <use href={`#kv-${name}`} />
  </svg>
);
