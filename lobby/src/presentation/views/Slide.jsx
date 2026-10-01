import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { ScreenFrame } from '../components/ScreenFrame.jsx';
import { ParticleField } from '../components/ParticleField.jsx';
import { SparkleDoodles } from '../components/SparkleDoodles.jsx';
import { ConfettiBurst } from '../components/ConfettiBurst.jsx';
import { HEADLINE_LINE_HEIGHT, Headline, fittedU, headlineBox } from '../components/Headline.jsx';
import { Kicker } from '../components/Kicker.jsx';
import { BodyText } from '../components/BodyText.jsx';
import { StepChip } from '../components/StepChip.jsx';
import { wordCount } from '../components/Words.jsx';
import { HOUSE } from '../lib/kit.js';
import { chipGeometry, fitChipList, inkEm, measureEm } from '../lib/chip.js';
import { useFontsReady } from '../hooks/useFontsReady.js';
import { ambientVariants, partVariants } from '../lib/landing.js';
import { PLEDGE_FIT, PLEDGE_FIT_PORTRAIT, fitPledge } from '../lib/pledgeFit.js';
import { usePortrait } from '../lib/touch.js';

/**
 * One slide, laid out by its explicit `layout` field, in the kit's three
 * voices: a Londrina kicker names it, a Paytone One headline shouts it, Figtree
 * carries anything the room reads. Every kicker, headline word, body word
 * and chip is a PART: it inherits its slide's hidden / shown / gone state
 * from SlideshowView and lands (or leaves upward) on its own beat, in
 * reading order (lib/landing.js). `hold` is how long the slide waits before
 * its first part lands: long enough for the outgoing slide's words to leave.
 */
export const Slide = ({ slide, now, events, hold = 0, onNext }) => {
  // The ceremony ends on a deliberate blackout: no logo (App hides the mark),
  // no clock, no ambient layers. Checked before anything below reads
  // slide.title (the doodle seed) so a black slide truly renders nothing else.
  if (slide.layout === 'black') return <div className="w-full h-full" style={{ background: '#000000' }} />;

  return (
    <ScreenFrame
      layers={
        <motion.div className="absolute inset-0" variants={ambientVariants(hold)}>
          <ParticleField />
          <SparkleDoodles seed={slide.id.length + slide.title.length} count={slide.layout === 'celebration' ? 22 : 10} />
        </motion.div>
      }
    >
      <div className="pj-frame">
        {slide.layout === 'pledge' ? (
          <PledgeBlock slide={slide} hold={hold} />
        ) : (
          <div className="pj-slide">
            <SlideBody slide={slide} now={now} events={events} hold={hold} />
          </div>
        )}
      </div>

      {slide.layout === 'celebration' && <ConfettiBurst />}

      {/* Invisible right-edge next-slide click zone */}
      {onNext && (
        <button
          onClick={onNext}
          className="absolute inset-y-0 right-0 w-24 cursor-pointer z-50 focus:outline-none opacity-0"
          aria-label="Next Slide"
        />
      )}
    </ScreenFrame>
  );
};

/**
 * A slide headline: the mockup's cap height (its 7.6u in Galindo is 8u in
 * Paytone One), on one line across the text block when it can.
 */
const HEADLINE_FIT = { maxU: 8, widthU: 82 };
/**
 * Upright on a phone or tablet (lib/touch.js) the frame is 100 x 177.78u: a
 * headline takes rows at one big size, broken only between words, rather
 * than shrinking to one line across a narrow wall.
 */
const HEADLINE_FIT_PORTRAIT = { maxU: 12, widthU: 88, minU: 12 };

/** "Wednesday night": the welcome's kicker, from the evening it is. */
export const nightOf = (now) => `${(now ?? new Date()).toLocaleDateString([], { weekday: 'long' })} night`;

/**
 * The pledges, as big as the wall allows (owner, 2026-09-30): the room says
 * them together, so the words fill the frame between the Awana mark and the
 * bottom margin band, at the largest size lib/pledgeFit.js measures to fit,
 * and the title grows with them. Measured again when a web font lands.
 */
const PledgeBlock = ({ slide, hold }) => {
  const fonts = useFontsReady();
  const portrait = usePortrait();
  const table = portrait ? PLEDGE_FIT_PORTRAIT : PLEDGE_FIT;
  const fit = useMemo(() => fitPledge(slide.body, undefined, table), [slide.body, fonts, table]); // eslint-disable-line react-hooks/exhaustive-deps
  const side = (100 - fit.widthU) / 2;
  return (
    <div
      className="pj-slide pj-slide--pledge"
      data-pledge-rows={fit.rows}
      style={{ top: `calc(${fit.topU} * var(--u))`, left: `calc(${side} * var(--u))`, right: `calc(${side} * var(--u))` }}
    >
      <Kicker size={`calc(${fit.kickerU} * var(--u))`} part={{ index: 0, hold }}>{slide.title}</Kicker>
      <BodyText
        text={slide.body}
        size={`calc(${fit.bodyU} * var(--u))`}
        parts={{ start: 1, hold }}
        style={{ marginTop: `calc(${fit.gapU} * var(--u))`, lineHeight: fit.lineHeight }}
      />
    </div>
  );
};

const SlideBody = ({ slide, now, events, hold }) => {
  const portrait = usePortrait();
  const headlineFit = portrait ? HEADLINE_FIT_PORTRAIT : HEADLINE_FIT;
  const comingUp = portrait ? COMING_UP_PORTRAIT : COMING_UP;
  switch (slide.layout) {
    case 'celebration':
    case 'welcome':
      return (
        <>
          <Kicker size="var(--text-kicker)" part={{ index: 0, hold }}>{nightOf(now)}</Kicker>
          <Headline
            text={slide.title}
            fit={headlineFit}
            parts={{ start: 1, hold }}
            style={{ marginTop: 'calc(1.4 * var(--u))' }}
          />
          {slide.subtitle && (
            <BodyText
              text={slide.subtitle}
              size="var(--text-body)"
              parts={{ start: 1 + wordCount(slide.title), hold }}
              style={{ marginTop: 'calc(2 * var(--u))' }}
            />
          )}
        </>
      );

    case 'closing':
      return (
        <>
          <Headline text={slide.title} fit={headlineFit} parts={{ start: 0, hold }} />
          {slide.body && (
            <BodyText
              text={slide.body}
              size="var(--text-body)"
              parts={{ start: wordCount(slide.title), hold }}
              style={{ marginTop: 'calc(2 * var(--u))' }}
            />
          )}
        </>
      );

    case 'coming-up':
      return (
        <>
          <Headline text={slide.title} fit={comingUp.headline} parts={{ start: 0, hold }} />
          <ComingUpList title={slide.title} events={events ?? []} start={wordCount(slide.title)} hold={hold} />
        </>
      );
  }
};

/** "WED SEP 23": the chip label for one upcoming night. */
export const nightLabel = (date) =>
  date
    .toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
    .replace(/,/g, '')
    .toUpperCase();

/**
 * The coming-up slide's layout, in projector units. `top`, `gapX`/`gapY`,
 * `headlineLine` and `frame` restate index.css (.pj-slide's top, .pj-chip-row's
 * gaps, .pj-headline's line-height, .pj-frame's height); Slide.test.jsx pins
 * them to it. The list may run down to `bottom`, which keeps a title-safe
 * margin clear above the frame's bottom edge.
 */
export const COMING_UP = {
  // The mockup's 5.6u in Galindo, at its cap height in Paytone One.
  headline: { maxU: 5.9, widthU: 84 },
  headlineLine: HEADLINE_LINE_HEIGHT,
  top: 15,
  listGap: 3.4,
  frame: 56.25,
  bottom: 51.75,
  row: 80,
  gapX: 1.6,
  gapY: 1.4,
  /** The chips' size when the nights fit easily. */
  maxU: 3.2,
  /** Never smaller than this with more than one night left: the old pill badges' ~1.8u, and then some. */
  minU: 2,
};

/**
 * The same slide upright on a phone or tablet (lib/touch.js): a 100 x 177.78u
 * frame. `top` and the gaps restate the portrait block at the end of
 * index.css, and Slide.test.jsx pins them to it. The list stops at `bottom`,
 * above the slide controls and the setup note at the bottom of the screen.
 */
export const COMING_UP_PORTRAIT = {
  headline: { maxU: 9, widthU: 88, minU: 9 },
  headlineLine: HEADLINE_LINE_HEIGHT,
  // index.css: `.pj-slide:has(> .pj-chip-row)`, the list's own place on a tall frame.
  top: 26,
  listGap: 4,
  frame: 177.78,
  bottom: 122,
  row: 88,
  gapX: 2.4,
  gapY: 3.4,
  maxU: 6.4,
  minU: 3.6,
};

/**
 * Where the coming-up list sits and how big its chips are: sized to the
 * room left under the headline, so five nights with long names (the
 * church's feed lists long special titles most weeks, "Bring a Friend Night -
 * Posters due" among them, and a long name takes a row of its own) still end
 * inside the wall. Below COMING_UP.minU it shows the soonest nights that fit
 * rather than shrinking further.
 * @param {string} title the slide's headline
 * @param {Array<{ label: string, value: string }>} chips
 * @param {typeof COMING_UP} [c] the frame's table (COMING_UP_PORTRAIT upright on touch)
 */
export function comingUpLayout(title, chips, c = COMING_UP) {
  const headU = fittedU(title, c.headline);
  const headLines = Math.max(1, Math.ceil((measureEm(String(title).toUpperCase()) * headU) / c.headline.widthU));
  // A title with a tall mark (É, Ș) takes the room Headline gives it.
  const box = headlineBox(title);
  const lineU = box.lineHeight === HEADLINE_LINE_HEIGHT ? c.headlineLine : box.lineHeight;
  const listTopU = c.top + headU * (lineU * headLines + box.padTop + box.padBottom) + c.listGap;
  const widths = chips.map(({ label, value }) => chipGeometry(measureEm(label.toUpperCase()), measureEm(value), inkEm(value)).width);
  const { sizeU, count } = fitChipList(widths, {
    maxU: c.maxU,
    minU: c.minU,
    rowU: c.row,
    heightU: c.bottom - listTopU,
    gapXU: c.gapX,
    gapYU: c.gapY,
  });
  // Rounded down, so the CSS never asks for a hair more than the fit allowed.
  return { listTopU, sizeU: Math.floor(sizeU * 1000) / 1000, count };
}

/**
 * Upcoming calendar nights for the closing "Coming up" slide, as stepped
 * chips: the date over the night's name. A special night (a theme night, a
 * party) gets the kit's one hot red-orange; an ordinary club night the
 * house blue.
 */
const ComingUpList = ({ title, events, start, hold }) => {
  // The fit measures the chips' text: measure again once the faces land.
  useFontsReady();
  const c = usePortrait() ? COMING_UP_PORTRAIT : COMING_UP;
  const upcoming = events.slice(0, 5);
  if (upcoming.length === 0) {
    return (
      <BodyText
        text="See you next week!"
        size="var(--text-body)"
        parts={{ start, hold }}
        style={{ marginTop: 'calc(2 * var(--u))' }}
      />
    );
  }
  const chips = upcoming.map((event) => ({ event, label: nightLabel(event.date), value: event.title }));
  const { sizeU, count } = comingUpLayout(title, chips, c);
  return (
    <div
      className="pj-chip-row"
      data-chip-u={sizeU}
      style={{ marginTop: `calc(${c.listGap} * var(--u))`, maxWidth: `calc(${c.row} * var(--u))` }}
    >
      {chips.slice(0, count).map(({ event, label, value }, idx) => (
        // A flex box, not inline-block: no line box, so a row stands exactly
        // as tall as its chips (which is what the fit counts).
        <motion.span
          key={`${event.title}-${event.daysUntil}`}
          className="flex"
          variants={partVariants(start + idx, hold)}
        >
          <StepChip
            label={label}
            value={value}
            size={`calc(${sizeU} * var(--u))`}
            plate={event.isSpecial ? HOUSE.hot : HOUSE.blueDeep}
          />
        </motion.span>
      ))}
    </div>
  );
};
