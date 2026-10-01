import React from 'react';

/**
 * The shared pure-black shell and ambient layer stack, applied
 * identically on every view. Flat and crisp — no scanlines, no
 * edge-darkening vignette, and (by operator request) no brand bars:
 * this is a projector on a white wall, edge to edge black.
 */
export const ScreenFrame = ({
  layers,
  shake = false,
  className = '',
  children,
}) => (
  <div
    className={`w-full h-full flex flex-col relative overflow-hidden ${shake ? 'animate-screen-shake' : ''} ${className}`}
    style={{ background: '#000000' }}
  >
    {layers}

    <div className="relative z-10 flex-1 flex flex-col min-h-0">{children}</div>
  </div>
);
