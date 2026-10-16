/**
 * Motion timing tokens: the family brand kit's motion table
 * (shared/motion.js, read from shared/brand/tokens.json: one 100 ms beat,
 * four curves) plus the two timings only the projector has. This is the JS
 * mirror of the CSS custom properties declared in index.css (:root); keep the
 * two in sync (there is no runtime bridge on purpose: values are needed
 * before styles resolve). motion-tokens.test.js pins CSS to JS and JS to the
 * kit.
 *
 * The kit's rules: only transform and opacity move; wipe is for colour
 * fields and waves, settle for type landing, pop for chips and stickers,
 * exit for leaving (exits run faster than entrances).
 */
import { BEAT, DUR as KIT_DUR, EASE as KIT_EASE } from '../../../../shared/motion.js';

export const DUR = {
  /** --dur-beat: the kit's one beat; everything starts on one */
  beat: BEAT,
  /** --dur-quick */
  quick: KIT_DUR.quick,
  /** --dur-exit: leaving (the ESC toast, a chip that steps aside) */
  exit: KIT_DUR.exit,
  /** --dur-settle: type landing (headline words, digit reels) */
  settle: KIT_DUR.settle,
  /** --dur-pop: chips and stickers arriving */
  pop: KIT_DUR.pop,
  /** --dur-wipe: colour fields and waves */
  wipe: KIT_DUR.wipe,
  /** --dur-stinger */
  stinger: KIT_DUR.stinger,
  /** --dur-mode: the top-level view crossfade (projector only) */
  mode: 0.8,
  /** --dur-sweep: one club wave crossing the whole wall between slides
   *  (projector only; the approved mockup's 1100 ms traverse) */
  sweep: 1.1,
};

export const EASE = {
  /** --ease-wipe: colour fields and waves */
  wipe: KIT_EASE.wipe,
  /** --ease-settle: type landing */
  settle: KIT_EASE.settle,
  /** --ease-pop: a small overshoot, for chips and stickers */
  pop: KIT_EASE.pop,
  /** --ease-exit: leaving */
  exit: KIT_EASE.exit,
};
