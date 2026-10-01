import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CLUBS } from '../config.js';
import { THEME, artUrl } from '../lib/shared-config.js';
import { ScreenFrame } from '../components/ScreenFrame.jsx';
import { ParticleField } from '../components/ParticleField.jsx';
import { SparkleDoodles } from '../components/SparkleDoodles.jsx';
import { ClubWave } from '../components/ClubWave.jsx';
import { ConfettiBurst } from '../components/ConfettiBurst.jsx';
import { BigTimer } from '../components/BigTimer.jsx';
import { Headline } from '../components/Headline.jsx';
import { StepChip } from '../components/StepChip.jsx';
import { useLowPower } from '../hooks/useLowPower.js';
import { CakeArt } from '../../components/BirthdayArt.jsx';
import { secondsUntil } from '../lib/schedule.js';
import {
  WARNING_LABELS,
  WARNING_STINGER_INTENSITY,
  warningFor,
} from '../lib/gameWarning.js';
import { playStinger } from '../lib/stingers.js';
import { birthdaysThisWeek, listNames } from '../lib/birthdays.js';
import { countForClub } from '../lib/tally.js';
import { mulberry32 } from '../lib/color.js';
import { FAR_WAVE_KEEP, HOUSE, WARNING_TONES, shade } from '../lib/kit.js';
import { chipGeometry, inkEm, measureEm } from '../lib/chip.js';
import { DUR, EASE } from '../lib/motion-tokens.js';
import { holdThen, partVariants } from '../lib/landing.js';
import { useBirthdays } from '../hooks/useBirthdays.js';
import { usePortrait } from '../lib/touch.js';

/** Tally older than this is treated as gone (print server offline). */
const TALLY_STALE_MS = 10 * 60 * 1000;

/** The chip row's size (the value's font size), in projector units. */
const CHIP_U = 3.4;
/** The widest the birthday chip may grow before it shrinks to fit, in units. */
const BIRTHDAY_MAX_U = 36;
/**
 * Upright on a phone or tablet (lib/touch.js) the frame is 100 x 177.78u: the
 * portrait block at the end of index.css sets the chips' size
 * (--pj-game-chip-u, falling back to CHIP_U) and these, a birthday chip may
 * run the frame's width, and the marks stand twice as tall.
 */
const PORTRAIT = { birthdayMaxU: 88, markAreaU2: 240, markMaxHU: 14 };
/** The chip row's size as CSS: CHIP_U, or the portrait block's. */
const CHIP_SIZE = `calc(var(--pj-game-chip-u, ${CHIP_U}) * var(--u))`;

/** The view's parts land just after its crossfade has begun. */
const LAND_HOLD = 0.25;

/**
 * Per-club game-time screen, the approved mockup: the club's catalog waves
 * along the top and bottom edges (its deep shade behind its colour), the
 * club's white mark, GAME TIME! in the club's colour, a clock to the
 * window's end with club-coloured colons, a stepped chip "GAME ENDS /
 * 6:30 PM", official character art standing on the bottom wave, and a
 * small live "CHECKED IN" chip per club (the print server's tally
 * broadcast) in the top-right corner. Combined windows (Puggles & Cubbies)
 * get both marks, and the second club's colours on the top edge.
 *
 * `tally` arrives as a prop (from useRealtime, via the display's
 * sanctioned sanitized socket) instead of the original repo's own
 * useTally hook — the view itself is unchanged.
 */
export const GameTimeView = ({ now, window: gameWindow, endsAt, tally }) => {
  // Held still under ?vr=1 / OS reduced-motion, where every ambient layer stops.
  const lowPower = useLowPower();
  const clubs = gameWindow.clubs.map((id) => CLUBS[id]);
  const primary = clubs[0];
  const secondary = clubs[1];
  const topClub = secondary ?? primary;

  // This week's (Sun–Sat) birthdays for the club(s) on screen.
  const roster = useBirthdays();
  const celebrants = birthdaysThisWeek(roster, now).filter((b) => gameWindow.clubs.includes(b.club));

  // Live check-in tally (hidden when absent or stale — judged against
  // the ticking clock so it self-hides if the print server goes quiet).
  const tallyFresh = tally != null && now.getTime() - tally.at.getTime() < TALLY_STALE_MS;
  const clubCounts = clubs
    .map((club) => ({ club, count: tallyFresh ? countForClub(tally, club.id) : null }))
    .filter((c) => c.count !== null);

  const seconds = secondsUntil(endsAt, now);

  // Wrap-up warning for the rotation boundary (lib/gameWarning.js). The
  // treatment is deliberately restrained: the figures recolour, and the
  // one chip under the clock names the moment ("TWO MINUTES", "LAST 30
  // SECONDS") while still carrying the end time on its label.
  const warning = warningFor(seconds);
  const tone = WARNING_TONES[warning];

  // The last state we ANNOUNCED, not the last state rendered: a
  // re-render (a tally arriving, a birthday resolving) must never
  // re-fire the cue, and the clock re-renders every second.
  const announced = useRef('none');
  useEffect(() => {
    if (warning === announced.current) return;
    announced.current = warning;
    const intensity = WARNING_STINGER_INTENSITY[warning];
    // No-op unless the operator armed countdown sounds in QuickNav —
    // a projector in a quiet room must never surprise anyone.
    if (intensity != null) playStinger(intensity);
  }, [warning]);

  const endTimeStr = endsAt.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return (
    <ScreenFrame
      layers={
        <>
          {/* The catalog's club waves along both edges: deep behind colour
              along the top (the second club's, on a combined window), and
              the club's own along the bottom, the far one slowly drifting. */}
          <ClubWave color={shade(topClub.deep, FAR_WAVE_KEEP)} position="top" height={9} flip />
          <ClubWave color={topClub.deep} position="top" height={6} delay={0.08} />
          <ParticleField />
          <SparkleDoodles
            seed={gameWindow.startMin}
            colors={[...clubs.map((c) => c.color), '#FFFFFF', HOUSE.sun]}
            count={16}
          />
          <ClubWave color={primary.deep} position="bottom" height={15} flip drift={!lowPower} />
          <ClubWave color={primary.color} position="bottom" height={11} delay={0.08} />
          <CharacterArt clubs={clubs} seed={gameWindow.startMin} />
        </>
      }
    >
      <div className="pj-frame">
        <motion.div className="pj-game" initial="hidden" animate="shown">
          {/* Club marks — the kit's white knockouts; the name in the club's
              colour if a mark cannot load */}
          <motion.div className="pj-game__marks" variants={partVariants(0, LAND_HOLD)}>
            {clubs.map((club) => (
              <ClubEmblem key={club.id} club={club} />
            ))}
          </motion.div>

          <Headline
            text="GAME TIME!"
            color={primary.color}
            size="var(--text-game-headline)"
            parts={{ start: 1, hold: LAND_HOLD }}
            style={{ marginTop: 'calc(1.1 * var(--u))' }}
          />

          <motion.div variants={partVariants(3, LAND_HOLD)}>
            <BigTimer
              seconds={seconds}
              color="#FFFFFF"
              accent={primary.color}
              warnColor={tone?.digits}
              size="var(--text-game-timer)"
            />
          </motion.div>

          <motion.div className="pj-chip-row pj-game__chips" variants={partVariants(4, LAND_HOLD)}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={warning}
                className="inline-block"
                data-warning={warning !== 'none' ? warning : undefined}
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1, transition: { duration: DUR.pop, ease: EASE.pop } }}
                exit={{ opacity: 0, scale: 0.85, transition: { duration: DUR.exit, ease: EASE.exit } }}
              >
                {warning === 'none' ? (
                  <StepChip label="Game ends" value={endTimeStr} size={CHIP_SIZE} plate={primary.deep} />
                ) : (
                  <StepChip
                    label={`Game ends ${endTimeStr}`}
                    value={WARNING_LABELS[warning]}
                    size={CHIP_SIZE}
                    plate={tone.plate}
                  />
                )}
              </motion.span>
            </AnimatePresence>

            {/* This week's birthdays for the club(s) on screen: the kit's one
                hot chip, with the cake riding beside it. This side of the
                app knows each birthday's month and day but still NOT a year,
                so there is no candle count and no age — same constraint as
                the signage banner. */}
            {celebrants.length > 0 && (
              <BirthdayChip names={listNames(celebrants.map((b) => b.name))} still={lowPower} />
            )}
          </motion.div>
        </motion.div>
      </div>

      {/* Subtle live check-in counts (print server tally broadcast) */}
      <AnimatePresence>
        {clubCounts.length > 0 && (
          <motion.div
            className="pj-game__tally"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0, transition: { duration: DUR.pop, ease: EASE.pop } }}
            exit={{ opacity: 0, y: -10, transition: { duration: DUR.exit, ease: EASE.exit } }}
          >
            {clubCounts.map(({ club, count }) => (
              // Remount on each increment: leaders see the arrival land as a
              // little pop, same trick as the signage tally.
              <motion.span
                key={`${club.id}-${count}`}
                className="inline-block"
                initial={{ scale: 1.25 }}
                animate={{ scale: 1, transition: { duration: DUR.pop, ease: EASE.pop } }}
              >
                <StepChip
                  label={clubCounts.length > 1 ? club.name : 'Checked in'}
                  value={count}
                  size="var(--pj-game-tally, calc(2.3 * var(--u)))"
                  plate={club.deep}
                />
              </motion.span>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {celebrants.length > 0 && <ConfettiBurst />}
    </ScreenFrame>
  );
};

/**
 * The birthday chip: HAPPY BIRTHDAY over the names, on the kit's hot plate,
 * shrinking to fit a long list rather than pushing the row off the wall.
 * The cake beside it sways gently unless the ambient layers are held still.
 */
const BirthdayChip = ({ names, still }) => {
  const maxU = usePortrait() ? PORTRAIT.birthdayMaxU : BIRTHDAY_MAX_U;
  const label = 'HAPPY BIRTHDAY';
  const widthEm = chipGeometry(measureEm(label), measureEm(names), inkEm(names)).width;
  const size = `min(${CHIP_SIZE}, calc(${(maxU / widthEm).toFixed(3)} * var(--u)))`;
  return (
    <span className="pj-game__birthday">
      <span className="pj-game__cake" aria-hidden="true">
        <motion.span
          className="block"
          animate={still ? undefined : { rotate: [0, -5, 5, 0], scale: [1, 1.06, 1] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut', delay: 0.9 }}
        >
          <CakeArt />
        </motion.span>
      </span>
      <StepChip label={label} value={names} size={size} plate={HOUSE.hot} />
    </span>
  );
};

/** A mark's optical area in square projector units (a wordmark reads smaller than
 *  the T&T hexagon at the same area, so this runs a little over the mockup's 51). */
const MARK_AREA_U2 = 60;
/** No mark stands taller than this, in units. */
const MARK_MAX_H_U = 6.9;

/**
 * The club's official mark (from shared/theme.json: the white knockout,
 * which is what reads on black); a failed load falls back to the club's
 * name in its own colour, so a missing file can never blank the screen.
 * Marks differ wildly in shape (the T&T hexagon is square, the Cubbies
 * wordmark 3.5 to 1), so each is sized to the same optical area rather than
 * the same height.
 */
const ClubEmblem = ({ club }) => {
  const portrait = usePortrait();
  const areaU2 = portrait ? PORTRAIT.markAreaU2 : MARK_AREA_U2;
  const maxHU = portrait ? PORTRAIT.markMaxHU : MARK_MAX_H_U;
  const [failed, setFailed] = useState(false);
  const [ratio, setRatio] = useState(null);
  const art = THEME.clubs[club.id]?.art ?? {};
  const logo = art.logoWhite ?? art.logo;

  if (!logo || failed) {
    return (
      <span className="pj-headline" style={{ color: club.color, fontSize: 'calc(4.6 * var(--u))' }}>
        {club.name}
      </span>
    );
  }
  const h = ratio ? Math.min(maxHU, Math.sqrt(areaU2 / ratio)) : maxHU;
  return (
    <motion.img
      src={artUrl(logo)}
      alt={club.name}
      onError={() => setFailed(true)}
      onLoad={(e) => {
        const { naturalWidth: w, naturalHeight: nh } = e.currentTarget;
        if (w > 0 && nh > 0) setRatio(w / nh);
      }}
      draggable={false}
      className="select-none"
      style={{ height: `calc(${h.toFixed(3)} * var(--u))`, width: 'auto', opacity: ratio ? undefined : 0 }}
    />
  );
};

/**
 * Official club character art in the lower corners — one per side,
 * seed-picked (stable per window) from the characters the theme ships,
 * standing on the bottom wave. Decorative layer only.
 */
const CharacterArt = ({ clubs, seed }) => {
  const pool = clubs.flatMap(
    (club) => THEME.clubs[club.id]?.art.characters?.map((path) => ({ club, path })) ?? [],
  );
  if (pool.length === 0) return null;

  const rand = mulberry32(seed);
  const first = pool[Math.floor(rand() * pool.length)];
  const rest = pool.filter((c) => c !== first);
  const second = rest.length > 0 ? rest[Math.floor(rand() * rest.length)] : null;

  const corners = [
    { char: first, side: { left: 'calc(4 * var(--u))' }, rotate: -6, x: -40 },
    ...(second ? [{ char: second, side: { right: 'calc(4.5 * var(--u))' }, rotate: 6, x: 40 }] : []),
  ];

  return (
    <>
      {corners.map(({ char, side, rotate, x }) => {
        // Hold, then land: one keyframe list rather than initial + delay
        // (see lib/landing.js), resting on its last value.
        const land = holdThen(0.5, DUR.wipe, { opacity: 0, y: 60, x, rotate: 0 }, { opacity: 1, y: 0, x: 0, rotate }, EASE.pop);
        return (
          <motion.img
            key={char.path}
            src={artUrl(char.path)}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="pj-game__character select-none pointer-events-none"
            style={side}
            initial={{ opacity: 0, y: 60, x, rotate: 0 }}
            animate={land}
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        );
      })}
    </>
  );
};
