import React from 'react';
import { motion } from 'framer-motion';
import { partVariants } from '../lib/landing.js';

/**
 * A line of text as one inline-block per word, so the browser can only break
 * between words (never "A|WANA"), and so each word can land and leave on its
 * own beat. With `parts` ({ start, hold }) every word is an animated part in
 * reading order, starting at index `start`; it inherits its slide's
 * hidden / shown / gone state (see lib/landing.js). Without it the words are
 * plain spans and nothing here touches framer-motion, which is what lets the
 * error screens use the same type.
 *
 * @param {{ text: string, parts?: { start: number, hold?: number } }} props
 */
export const Words = ({ text, parts }) => {
  const words = String(text).split(/\s+/).filter(Boolean);
  return words.map((word, i) => (
    <React.Fragment key={i}>
      {i > 0 && ' '}
      {parts ? (
        <motion.span className="w" variants={partVariants(parts.start + i, parts.hold)}>
          {word}
        </motion.span>
      ) : (
        <span className="w">{word}</span>
      )}
    </React.Fragment>
  ));
};

/** How many parts a line of text contributes to its slide's reading order. */
export const wordCount = (text) => String(text ?? '').split(/\s+/).filter(Boolean).length;
