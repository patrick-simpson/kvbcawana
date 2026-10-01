/**
 * Motion timing tokens: the family brand kit's motion table
 * (shared/brand/tokens.json: one 100 ms beat, four curves) plus the two
 * timings only the projector has. This is the JS mirror of the CSS custom
 * properties declared in index.css (:root); keep the two in sync (there is
 * no runtime bridge on purpose: values are needed before styles resolve).
 * motion-tokens.test.js pins CSS to JS and JS to the kit.
 *
 * The kit's rules: only transform and opacity move; wipe is for colour
 * fields and waves, settle for type landing, pop for chips and stickers,
 * exit for leaving (exits run faster than entrances).
 */
import tokens from '../../../shared/brand/tokens.json';

const kit = tokens.motion;
const ms = (n) => n / 1000;

export const DUR = {
  /** --dur-beat: the kit's one beat; everything starts on one */
  beat: ms(kit.beatMs),
  /** --dur-quick */
  quick: ms(kit.durationsMs.quick),
  /** --dur-exit: leaving (the ESC toast, a chip that steps aside) */
  exit: ms(kit.durationsMs.exit),
  /** --dur-settle: type landing (headline words, digit reels) */
  settle: ms(kit.durationsMs.settle),
  /** --dur-pop: chips and stickers arriving */
  pop: ms(kit.durationsMs.pop),
  /** --dur-wipe: colour fields and waves */
  wipe: ms(kit.durationsMs.wipe),
  /** --dur-stinger */
  stinger: ms(kit.durationsMs.stinger),
  /** --dur-mode: the top-level view crossfade (projector only) */
  mode: 0.8,
  /** --dur-sweep: one club wave crossing the whole wall between slides
   *  (projector only; the approved mockup's 1100 ms traverse) */
  sweep: 1.1,
};

export const EASE = {
  /** --ease-wipe: colour fields and waves */
  wipe: kit.curves.wipe,
  /** --ease-settle: type landing */
  settle: kit.curves.settle,
  /** --ease-pop: a small overshoot, for chips and stickers */
  pop: kit.curves.pop,
  /** --ease-exit: leaving */
  exit: kit.curves.exit,
};
