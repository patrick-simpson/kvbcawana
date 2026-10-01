import React from 'react';
import { motion } from 'framer-motion';
import { HOUSE } from '../lib/kit.js';
import { partVariants } from '../lib/landing.js';

/**
 * The label voice: Londrina Solid, tracked caps, the small line that names
 * what comes next ("AWANA BEGINS IN", "PLEDGE OF ALLEGIANCE"). Awana orange
 * by default. With `part` ({ index, hold }) it is one animated part of its
 * slide (see lib/landing.js).
 *
 * @param {{
 *   children: React.ReactNode,
 *   color?: string,
 *   size?: string,
 *   part?: { index: number, hold?: number },
 *   className?: string,
 *   style?: React.CSSProperties,
 * }} props
 */
export const Kicker = ({ children, color = HOUSE.orange, size, part, className = '', style }) => {
  const props = { className: `pj-kicker ${className}`.trim(), style: { color, fontSize: size, ...style } };
  return part
    ? <motion.p {...props} variants={partVariants(part.index, part.hold)}>{children}</motion.p>
    : <p {...props}>{children}</p>;
};
