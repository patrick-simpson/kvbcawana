import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, useIsPresent } from 'framer-motion';
import { M } from '../lib/motion.jsx';
import { getClubPalette } from '../lib/clubs.js';
import { fireBirthday, fireFirstTimer, fireStandard } from '../lib/confetti.js';
import { playBirthdayChime, playChime, playFirstTimerChime } from '../lib/audio.js';
import { nameAccent } from '../lib/nameAccent.js';
import { DUR, EASE, inkEm, measureEm, shoutBaseline } from '../lib/brand.js';
import { holdThenLand, LETTER_FROM, letterEnter } from '../lib/lobbyMotion.js';
import { squishLand, withSquish } from '../lib/squish.js';
import {
  FRONT_WAVE_DELAY, KICKER_TRACKING, KICKER_U, kickerFor, momentFor, NAME_ROOM_U, nameBox, nameRoomU, nameSizeU,
  nameUnderKicker, PER_LETTER_MAX, stickerFor, sublineFor, WAVE_EXIT,
} from '../lib/checkInMoment.js';
import { hostClearancePx, isEmbedded } from '../lib/embed.js';
import { lobbyUnitPx } from '../hooks/useTallerThan.js';
import { celebrationProfile, useCelebration } from '../hooks/useCelebration.js';
import { useFontsReady } from '../hooks/useFontsReady.js';
import Wave from './brand/Wave.jsx';
import Sticker from './brand/Sticker.jsx';
import DoodleCluster from './brand/DoodleCluster.jsx';
import awanaClubsMark from '../../shared/brand/logos/awana-clubs-white.svg';

/**
 * The check-in moment: the catalog's club opener page (p.63), played live.
 * The child's club wave rises from the bottom and carries their name, the
 * club's official mark rides the low side, three doodles land last, and a
 * hot sticker marks a birthday or a first-timer. The colour is always the
 * child's club; what changes between kinds of arrival is only the words
 * (src/lib/checkInMoment.js) and the sticker.
 *
 * One component per RUN (useCheckInQueue): the Overlay keys it on `run`, so
 * during a rush it stays mounted and each next child FLIPS in, scoreboard
 * style. The old name's letters leave upward, a new club's wave sweeps in
 * from the right over the old one, the mark crosses over, and the new name
 * lands. Each child still holds the stage for their full time; the queue
 * decides that, never this component.
 *
 * Choreography, on the brand's 100 ms beat (shared/brand/tokens.json):
 *   entrance  back wave 0 / front wave +70 ms (wipe 640), mark 300,
 *             kicker 400, name 500 + 40 ms a letter (settle 520),
 *             line 800, sticker 900 (pop), doodles 1000 + a beat each
 *   flip      old letters out (exit 220), new club's wave sweeps (560),
 *             new letters from 260 ms, or 560 ms after a club change
 *   leaving   everything lifts out (exit 280), waves drop at 120 / 190 ms
 *
 * The soft squish (src/lib/squish.js): each letter squashes onto its baseline
 * as it lands, the squash rippling across the name at the letter stagger, the
 * kicker whispers one, and the sticker squashes at its pop's peak. Each is a
 * keyframe list fixed when that child's copy first appears; the layout cells,
 * the mark and the measured sticker slot never squish.
 *
 * Layers that persist for the whole run are wrappers whose own `exit` plays
 * when the run ends; everything that changes per child sits inside a small
 * AnimatePresence keyed on what it shows, so it crosses over on a flip.
 * Every element is M.*, and every entrance's last keyframe is its resting
 * state, so under ?lowPower=1 the whole thing appears finished at once.
 */

// Sizes and offsets are in u: 1u = 1% of a 16:9 stage's width
// (`--u: min(1vw, 1.7778vh)` on .checkin).
const u = (n) => `calc(${n} * var(--u))`;

const ENTRANCE = { mark: 0.3, kicker: 0.4, name: 0.5, letter: 0.04, nameDur: DUR.settle, line: 0.8, sticker: 0.9, doodles: 1.0 };
const FLIP = { mark: 0.3, kicker: 0.26, name: 0.26, letter: 0.028, nameDur: 0.36, line: 0.4, sticker: 0.46 };
// After a club change the new name waits for the sweep to land.
const SWEPT = 0.3;

const LEAVE = { duration: DUR.exit, ease: EASE.exit };

/**
 * The name column's room in u. Inside the Journey kiosk's frame, the host's
 * buttons float over the bottom-right corner, right where a long name ends,
 * so the column stops short of them (src/lib/embed.js; app.css moves
 * .checkin__copy's right edge to match). Read from the viewport at render:
 * each child's name is sized as it lands. Standalone it is NAME_ROOM_U.
 */
function nameRoom() {
  if (!isEmbedded()) return NAME_ROOM_U;
  const px = lobbyUnitPx();
  if (!(px > 0)) return NAME_ROOM_U;
  return nameRoomU(window.innerWidth / px, hostClearancePx(window.innerWidth) / px);
}

const DOODLES = [
  { kind: 'sparkle', x: u(74), y: u(10.6), size: u(2.6) },
  { kind: 'dot', x: u(78.6), y: u(9.4), size: u(1.1) },
  { kind: 'sparkleX', x: u(77.4), y: u(14.2), size: u(1.7), rotate: 12 },
];

function useFlipTracking(event, clubKey) {
  // Whether THIS child brought a different club than the one before them in
  // the run, captured once per child (derived state, not a ref, so a later
  // re-render for a font load cannot re-time an entrance already playing).
  const [seen, setSeen] = useState({ id: event.id, club: clubKey, changed: false });
  if (seen.id !== event.id) {
    const next = { id: event.id, club: clubKey, changed: seen.club !== clubKey };
    setSeen(next);
    return next.changed;
  }
  return seen.changed;
}

/**
 * A per-child copy's class, plus `is-leaving` from the moment its exit
 * starts: the leaving copy steps out of the flow at once (app.css), so only
 * the incoming child sizes its cell and nothing above it jumps twice.
 */
function useLeaving(base) {
  return useIsPresent() ? base : `${base} is-leaving`;
}

// The club colours ride on each per-child copy as well as the root, so a
// leaving name and kicker keep the colours they arrived in while the next
// club's wave sweeps in over them.
const clubInk = (club) => ({ '--club-deep': club.deep, '--club-tint': club.accent });

function Kicker({ text, delay, club }) {
  // Fixed at mount. The kicker is keyed on its words, so it stays mounted
  // through a flip whose next child reads the same (WELCOME, WELCOME) while
  // `delay` moves from the entrance's timing to the flip's; as keyframes, a
  // new `delay` would be a new target, and the kicker would land again.
  const [enter] = useState(() => withSquish(
    holdThenLand(delay, 0.32, { opacity: 0, y: '0.5em' }, { opacity: 1, y: '0em' }, EASE.settle),
    squishLand(delay, 'kicker', 0.32, 'settle'),
  ));
  return (
    <M.div
      className={useLeaving('checkin__kicker')}
      style={clubInk(club)}
      initial={enter.initial}
      animate={enter.animate}
      exit={{ opacity: 0, transition: { duration: 0.18, ease: EASE.exit } }}
      transition={enter.transition}
    >
      {text}
    </M.div>
  );
}

function Line({ text, delay }) {
  return (
    <M.p
      className={useLeaving('checkin__line')}
      initial={{ opacity: 0, y: '0.4em' }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.18, ease: EASE.exit } }}
      transition={{ duration: 0.36, delay, ease: EASE.settle }}
    >
      {text}
    </M.p>
  );
}

/**
 * The birthday / first-timer sticker, slapped on at its beat: it pops on the
 * kit's curve and squashes at the pop's peak, the loudest squish on the
 * lobby. Fixed at mount (keyed on the child). The squish rides the Sticker
 * itself, never `.checkin__sticker-slot`, which stickerOrigin() measures with
 * getBoundingClientRect (transforms included) just as the sticker lands.
 */
function MomentSticker({ moment, at, children }) {
  const [enter] = useState(() => withSquish(
    holdThenLand(at, DUR.pop, { opacity: 0, scale: 0.2, rotate: -40 }, { opacity: 1, scale: 1, rotate: 0 }, EASE.pop),
    squishLand(at, 'sticker', DUR.pop, 'pop'),
  ));
  return (
    <Sticker
      className={`checkin__sticker checkin__sticker--${moment}`}
      kind="starburst"
      tilt={-8}
      initial={enter.initial}
      animate={enter.animate}
      exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.2, ease: EASE.exit } }}
      transition={enter.transition}
    >
      {children}
    </Sticker>
  );
}

const NO_CONFETTI = () => {};

/**
 * The sticker's centre as a 0..1 fraction of the viewport, measured when a
 * burst fires: the sticker is laid out in u, so where it sits depends on the
 * screen's shape. Undefined (confetti.js then uses its 16:9 fallback) when
 * there is nothing laid out to measure.
 */
function stickerOrigin(root) {
  const r = root?.querySelector?.('.checkin__sticker-slot')?.getBoundingClientRect?.();
  if (!r || !r.width || !window.innerWidth || !window.innerHeight) return undefined;
  return { x: (r.left + r.width / 2) / window.innerWidth, y: (r.top + r.height / 2) / window.innerHeight };
}

// The cells above a changing line glide to their new place rather than
// snapping (framer-motion layout animation, instant under ?lowPower=1).
const GLIDE = { duration: DUR.settle, ease: EASE.settle };

function Name({ text, entrance, timing, size, wraps, box, club }) {
  const className = useLeaving(`checkin__name${wraps ? ' checkin__name--wraps' : ''}`);
  // The beat sheet is fixed when this child's name first appears (the name is
  // keyed on the child, and a font landing re-renders it): only sizes follow
  // a re-render, never a keyframe.
  const [sheet] = useState(() => ({
    from: LETTER_FROM[entrance] ?? LETTER_FROM.pop, name: timing.name, letter: timing.letter, dur: timing.nameDur,
  }));
  const perLetter = [...text].length <= PER_LETTER_MAX;
  const words = text.split(' ').filter(Boolean);
  let at = 0;
  const piece = (content, key, index) => {
    const enter = letterEnter({ at: sheet.name + index * sheet.letter, dur: sheet.dur, from: sheet.from(index) });
    return (
      <M.span
        key={key}
        className="checkin__letter"
        initial={enter.initial}
        animate={enter.animate}
        exit={{ opacity: 0, y: '-0.6em', scale: 1, transition: { duration: 0.22, delay: index * 0.014, ease: EASE.exit } }}
        transition={enter.transition}
      >
        {content}
      </M.span>
    );
  };
  return (
    <h1
      className={className}
      style={{
        fontSize: u(size),
        lineHeight: box.lineHeight,
        '--squish-baseline': `${shoutBaseline(box.lineHeight)}em`,
        paddingTop: `${box.padTop}em`,
        paddingBottom: `${box.padBottom}em`,
        ...clubInk(club),
      }}
      aria-label={text}
    >
      {words.map((word, w) => (
        // The space between words sits OUTSIDE each inline-block word, where
        // it is a real breakable space; inside one it would collapse away.
        <span key={w}>
          {w > 0 ? ' ' : null}
          <span className="checkin__word" aria-hidden="true">
            {perLetter
              ? [...word].map((ch, i) => piece(ch, i, at++))
              : piece(word, 0, w * 3)}
          </span>
        </span>
      ))}
    </h1>
  );
}

export default function CheckInMoment({ event, step = 0, audioEnabled, clubPhrases, ribbon }) {
  useFontsReady();
  const club = getClubPalette(event.club);
  const clubKey = club.name || 'awana';
  const mark = club.logo || awanaClubsMark;
  const markAlt = club.name ? `${club.name} logo` : 'Awana Clubs';
  const moment = momentFor(event);
  const first = step === 0;
  const changed = useFlipTracking(event, clubKey);
  const t = first ? ENTRANCE : changed
    ? { ...FLIP, kicker: FLIP.kicker + SWEPT, name: FLIP.name + SWEPT, line: FLIP.line + SWEPT, sticker: FLIP.sticker + SWEPT }
    : FLIP;

  const kicker = kickerFor(event, moment);
  const phrase = clubPhrases?.[String(event.club ?? '').trim().toLowerCase()];
  const line = sublineFor(moment, { ribbon, phrase });
  const sticker = stickerFor(moment);
  const display = String(event.firstName).toUpperCase();
  const { size, wraps } = nameSizeU(display, (s) => measureEm(s), nameRoom());
  // Room for a tall mark (JOSÉ, NGUYỄN, ȘTEFAN) clear of the kicker above and
  // the line below: measured, so only a mark that would meet one gets any.
  const kickerU = (measureEm(kicker.toUpperCase(), 'Londrina Solid') + KICKER_TRACKING * [...kicker].length) * KICKER_U;
  const under = nameUnderKicker(display, kickerU, size, (s) => measureEm(s));
  const box = nameBox(
    { under: under ? inkEm(under) : { ascent: 0, descent: 0 }, whole: inkEm(display) },
    { sizeU: size, line: Boolean(line), wraps },
  );
  const accent = nameAccent(event.firstName);

  // Confetti lands with the name (or out of the sticker, for the two kinds
  // that have one). Only a live arrival bursts: celebrationProfile keeps a
  // late arrival's chime ducked and a replayed recap silent, and neither
  // throws confetti. Fired from this component's own effect so it can time
  // the burst to the choreography and aim it at the measured sticker; once
  // per child, and cleared if the child flips away or the run ends first.
  const rootRef = useRef(null);
  const live = event.presentation === 'live';
  const burstAt = (sticker ? t.sticker : t.name) * 1000;
  const { primary, accent: tint } = club;
  useEffect(() => {
    if (!live) return undefined;
    const timer = setTimeout(() => {
      const origin = stickerOrigin(rootRef.current);
      if (moment === 'birthday') fireBirthday([primary, tint], origin);
      else if (moment === 'first') fireFirstTimer(origin);
      else fireStandard([primary, tint, '#FFFFFF', '#FCB614']);
    }, burstAt);
    return () => clearTimeout(timer);
  }, [event.id, live, burstAt, moment, primary, tint]);
  useCelebration(event.id, audioEnabled, celebrationProfile(event.presentation, {
    confetti: NO_CONFETTI,
    chime: moment === 'birthday' ? playBirthdayChime : moment === 'first' ? playFirstTimerChime : playChime,
  }));

  const modeClass = { birthday: 'birthday', first: 'first-timer', back: 'welcome-back', welcome: 'welcome' }[moment];

  return (
    <div
      ref={rootRef}
      className={`checkin banner ${modeClass}${event.presentation !== 'live' ? ' calm' : ''}`}
      style={{ '--club-primary': club.primary, '--club-deep': club.deep, '--club-tint': club.accent }}
      data-club={clubKey}
    >
      {/* The two waves: deep behind, club colour in front, each rising on
          its own wrapper at the start of the run and dropping away at its
          end. A new club mid-run sweeps its wave in over the old one. */}
      <M.div
        className="checkin__layer checkin__layer--back"
        initial={{ y: '106%' }}
        animate={{ y: 0 }}
        exit={{ y: '106%', transition: { ...WAVE_EXIT.back, ease: EASE.exit } }}
        transition={{ duration: DUR.wipe, ease: EASE.wipe }}
      >
        <AnimatePresence initial={false}>
          <Wave
            key={clubKey}
            className="checkin__wave checkin__wave--back"
            color={club.deep}
            flip
            style={{ zIndex: step + 1 }}
            initial={{ x: '102%' }}
            animate={{ x: 0 }}
            exit={{ opacity: 0, transition: { delay: DUR.stinger + 0.06, duration: 0 } }}
            transition={{ duration: DUR.stinger, delay: 0.06, ease: EASE.wipe }}
          />
        </AnimatePresence>
      </M.div>
      <M.div
        className="checkin__layer checkin__layer--front"
        initial={{ y: '106%' }}
        animate={{ y: 0 }}
        exit={{ y: '106%', transition: { ...WAVE_EXIT.front, ease: EASE.exit } }}
        transition={{ duration: DUR.wipe, delay: FRONT_WAVE_DELAY, ease: EASE.wipe }}
      >
        <AnimatePresence initial={false}>
          <Wave
            key={clubKey}
            className="checkin__wave checkin__wave--front"
            color={club.primary}
            style={{ zIndex: step + 1 }}
            initial={{ x: '102%' }}
            animate={{ x: 0 }}
            exit={{ opacity: 0, transition: { delay: DUR.stinger, duration: 0 } }}
            transition={{ duration: DUR.stinger, ease: EASE.wipe }}
          />
        </AnimatePresence>
      </M.div>

      {/* Doodles sit under the mark and the copy, so a long name paints over
          them rather than the other way round. */}
      <M.div className="checkin__doodles" exit={{ opacity: 0, transition: LEAVE }}>
        <DoodleCluster items={DOODLES} color="var(--club-tint)" delay={ENTRANCE.doodles} twinkle={event.presentation === 'live'} />
      </M.div>

      <M.div
        className="checkin__mark-slot"
        initial={{ opacity: 0, x: '-24%' }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, y: '-30%', transition: LEAVE }}
        transition={{ duration: 0.42, delay: ENTRANCE.mark, ease: EASE.settle }}
      >
        <AnimatePresence initial={false}>
          <M.img
            key={clubKey}
            className="checkin__mark"
            src={mark}
            alt={markAlt}
            initial={{ opacity: 0, x: '-18%' }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.18, ease: EASE.exit } }}
            transition={{ duration: 0.38, delay: t.mark, ease: EASE.settle }}
          />
        </AnimatePresence>
      </M.div>

      <M.div className="checkin__copy" exit={{ opacity: 0, y: u(-1.6), transition: LEAVE }}>
        <M.div className="checkin__cell checkin__cell--kicker" layout="position" transition={GLIDE}>
          <AnimatePresence>
            <Kicker key={kicker} text={kicker} delay={t.kicker} club={club} />
          </AnimatePresence>
        </M.div>
        <M.div className="checkin__cell checkin__cell--name" layout="position" transition={GLIDE}>
          <AnimatePresence>
            <Name key={event.id} text={display} entrance={accent.entrance} timing={t} size={size} wraps={wraps} box={box} club={club} />
          </AnimatePresence>
        </M.div>
        <div className="checkin__cell checkin__cell--line">
          <AnimatePresence>
            {line && <Line key={line} text={line} delay={t.line} />}
          </AnimatePresence>
        </div>
      </M.div>

      <M.div className="checkin__sticker-slot" exit={{ opacity: 0, scale: 0.8, transition: LEAVE }}>
        <AnimatePresence>
          {sticker && (
            <MomentSticker key={event.id} moment={moment} at={t.sticker}>
              {sticker.map((l) => <span key={l}>{l}</span>)}
            </MomentSticker>
          )}
        </AnimatePresence>
      </M.div>

    </div>
  );
}

