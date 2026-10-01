import React from 'react';
import { motion } from 'framer-motion';
import waveSvg from '../../../shared/brand/shapes/wave-journey.svg?raw';
import { DUR, EASE } from '../lib/motion-tokens.js';

/**
 * Pull the viewBox and path out of the kit's single-shape wave SVG. A kit
 * file that is not a plain `<svg viewBox><path d/></svg>` throws here at
 * import, which fails the build rather than a screen.
 * @param {string} svg
 */
export function parseWave(svg) {
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1];
  const d = svg.match(/\sd="([^"]+)"/)?.[1];
  if (!viewBox || !d) throw new Error('brand kit wave is not a single-path SVG');
  return { viewBox, d };
}

/** The catalog's club wave (shared/brand/shapes/), the same curve the lobby draws. */
export const WAVE = parseWave(waveSvg);

/**
 * The catalog's club wave: the S-curved colour field that rises from the
 * edge of every club opener page. Flat and solid, like the catalog; two
 * layers (a far one in the club's deep shade, a near one in its colour)
 * make an edge. It stretches to its box: `height` is a percentage of the
 * screen's height, `position` the edge it grows from (a top wave is the same
 * curve turned upside down), `flip` mirrors it so two layers can cross.
 *
 * It rises in from its edge on the kit's wipe curve (`delay` staggers a
 * pair), and `drift` sways it slowly sideways (bleeding past both edges so
 * the ends never show). Both are transform-only: under ?vr=1 and reduced
 * motion the entrance jumps to its resting place and the drift is killed.
 */
export const ClubWave = ({
  color,
  position = 'bottom',
  height = 12,
  flip = false,
  drift = false,
  delay = 0,
  className = '',
}) => {
  const top = position === 'top';
  return (
    <motion.div
      className={`pj-wave ${className}`.trim()}
      style={{ [position]: 0, height: `${height}%`, left: drift ? '-4%' : 0, right: drift ? '-4%' : 0 }}
      aria-hidden="true"
      initial={{ y: top ? '-101%' : '101%' }}
      animate={{ y: '0%' }}
      transition={{ duration: DUR.wipe, ease: EASE.wipe, delay }}
    >
      <div className={`pj-wave__turn ${top ? 'is-top' : ''}`}>
        <div className={drift ? 'pj-wave__drift' : 'pj-wave__still'}>
          <svg
            viewBox={WAVE.viewBox}
            preserveAspectRatio="none"
            style={flip ? { transform: 'scaleX(-1)' } : undefined}
            focusable="false"
          >
            <path d={WAVE.d} fill={color} />
          </svg>
        </div>
      </div>
    </motion.div>
  );
};
