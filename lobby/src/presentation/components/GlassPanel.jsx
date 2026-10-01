import React from 'react';

/**
 * The one solid surface for floating operator controls (the menu, the
 * setup note): the kit's ink with a white keyline and a hard offset shadow
 * (flat, never a blur), legible over any view. See `.pj-panel` in index.css.
 */
export const GlassPanel = ({ className = '', children }) => (
  <div className={`pj-panel ${className}`.trim()}>
    {children}
  </div>
);
