import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from '../components/icons.jsx';
import { DECKS } from '../config.js';
import { useCalendarEvents } from '../hooks/useCalendarEvents.js';
import { DUR, EASE } from '../lib/motion-tokens.js';
import { LEAVE_TOTAL, holdThen } from '../lib/landing.js';
import { HOUSE } from '../lib/kit.js';
import { useKeydown } from '../hooks/useKeydown.js';
import { slideGesture, useTouch } from '../lib/touch.js';
import { ColorSweep } from '../components/ColorSweep.jsx';
import { StepChip } from '../components/StepChip.jsx';
import { Slide } from './Slide.jsx';

/**
 * A slide carries no animation of its own: its parts (kicker, headline
 * words, body words, chips) inherit these three labels and each runs its
 * own beat (lib/landing.js). The slide itself only has to stay mounted until
 * the last of its parts has left, which framer-motion does by waiting on the
 * children's exit.
 */
const SLIDE_VARIANTS = { hidden: {}, shown: {}, gone: {} };

/** The deck's first slide lands just after the view has begun to fade in. */
const FIRST_HOLD = 0.15;
/** Later slides wait for the outgoing slide's words to leave first. */
const CHANGE_HOLD = LEAVE_TOTAL + 0.02;

/**
 * Slide deck. A change is the approved mockup's, in place of the old 3D
 * flip: the outgoing lines leave upward one after another, the six club
 * colours sweep once along the bottom edge and are gone, and the next title
 * and text land. The Awana Clubs mark (App.jsx) and the pledge slides' clock
 * stay put through it, like a broadcast logo. No setTimeout state machine,
 * and keypresses are never dropped mid-transition: every press moves the
 * index and starts a sweep of its own, while a sweep a quicker press caught
 * mid-wall carries on across and off it (unmounting it would snap its waves
 * off the wall in one frame).
 */
export const SlideshowView = ({ deck, now, onExit, onFinish, onBareChange }) => {
  // "Upcoming Awana Nights": when the calendar knows about upcoming
  // events (same calendar-feed.json the lobby display reads), the
  // closing deck ENDS on a slide announcing them — goodnight plays
  // first, then the deck settles on the events and holds: parents in
  // the room at pickup are exactly the audience for it.
  const events = useCalendarEvents();
  const slides = useMemo(() => {
    const base = DECKS[deck];
    if (deck !== 'closing' || events.length === 0) return base;
    const comingUp = {
      id: 'coming-up',
      layout: 'coming-up',
      title: 'Upcoming Awana Nights',
      // No duration: the deck remains here for the rest of the window.
    };
    // Goodnight gains a duration so the deck auto-settles on the events
    // even when nobody touches the keyboard.
    return [...base.map((s) => (s.duration ? s : { ...s, duration: 20 })), comingUp];
  }, [deck, events]);
  const [index, setIndex] = useState(0);
  // How many changes there have been: after the first, a landing slide
  // waits for the outgoing one's words to leave.
  const [changes, setChanges] = useState(0);
  // The sweeps still crossing the wall, oldest first. Each change adds one;
  // each leaves the list only once its last wave is off the wall.
  const [sweeps, setSweeps] = useState(/** @type {{ id: number, dir: 1 | -1 }[]} */ ([]));
  const sweepIds = useRef(0);
  const sweepDone = useCallback((id) => setSweeps((list) => list.filter((w) => w.id !== id)), []);
  const [escArmed, setEscArmed] = useState(false);
  // A phone or tablet (lib/touch.js) moves the deck with a finger instead.
  const touch = useTouch();
  const finger = useRef(/** @type {null | { id: number, x: number, y: number, t: number }} */ (null));

  const slide = slides[Math.min(index, slides.length - 1)];

  const goTo = (next, dir) => {
    if (next < 0) return;
    if (next >= slides.length) {
      // Past the end of the deck: the opening ceremony hands off to the
      // first game window (onFinish, wired in App.jsx) — one more press
      // of the same arrow key on the final blackout starts T&T games.
      // Decks without a hand-off (closing) simply hold their last slide.
      onFinish?.();
      return;
    }
    setChanges((n) => n + 1);
    const id = (sweepIds.current += 1);
    setSweeps((list) => [...list, { id, dir }]);
    setIndex(next);
  };
  const goNext = () => goTo(index + 1, 1);
  const goPrev = () => goTo(index - 1, -1);

  // The closing blackout is a bare wall: tell App to take the mark away.
  const bare = slide.layout === 'black';
  useEffect(() => {
    onBareChange?.(bare);
  }, [bare, onBareChange]);
  useEffect(() => () => onBareChange?.(false), [onBareChange]);

  // Auto-advance (leader can always advance manually first)
  useEffect(() => {
    if (!slide.duration || index >= slides.length - 1) return;
    const timer = setTimeout(goNext, slide.duration * 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, slide.duration, slides.length]);

  // Escape is press-twice (replaces the old window.confirm dialog)
  useEffect(() => {
    if (!escArmed) return;
    const timer = setTimeout(() => setEscArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [escArmed]);

  // On touch, the wall itself is the clicker: a swipe or a tap anywhere that
  // is not a control moves the deck (lib/touch.js slideGesture), on every
  // slide, the closing blackout included (its next tap starts games, as the
  // next key press does). Exit is a visible button, pressed twice like
  // Escape. Nothing of this is on the PC: the arrow keys and the hover pill.
  const onPointerDown = (e) => {
    if (!touch || !e.isPrimary || e.target.closest?.(CONTROLS)) return;
    finger.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp };
  };
  const onPointerUp = (e) => {
    const down = finger.current;
    finger.current = null;
    if (!touch || !down || down.id !== e.pointerId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const move = slideGesture({
      dx: e.clientX - down.x,
      dy: e.clientY - down.y,
      dt: e.timeStamp - down.t,
      x: down.x - rect.left,
      width: rect.width || window.innerWidth,
    });
    if (move === 'next') goNext();
    else if (move === 'prev') goPrev();
  };
  const onPointerCancel = () => {
    finger.current = null;
  };
  const exitTap = () => {
    if (escArmed) onExit();
    else setEscArmed(true);
  };

  useKeydown((e) => {
    if (['Space', 'ArrowRight', 'PageDown'].includes(e.code)) {
      e.preventDefault();
      goNext();
    } else if (['ArrowLeft', 'PageUp'].includes(e.code)) {
      e.preventDefault();
      goPrev();
    } else if (e.code === 'Escape') {
      if (escArmed) onExit();
      else setEscArmed(true);
    }
  });

  return (
    <div
      className="w-full h-full relative group"
      data-slide={slide.id}
      style={{ background: '#000000' }}
      onPointerDown={touch ? onPointerDown : undefined}
      onPointerUp={touch ? onPointerUp : undefined}
      onPointerCancel={touch ? onPointerCancel : undefined}
    >
      <AnimatePresence>
        <motion.div
          key={slide.id}
          className="absolute inset-0"
          variants={SLIDE_VARIANTS}
          initial="hidden"
          animate="shown"
          exit="gone"
        >
          <Slide
            slide={slide}
            now={now}
            events={events}
            hold={changes > 0 ? CHANGE_HOLD : FIRST_HOLD}
            onNext={!touch && (index < slides.length - 1 || onFinish) ? goNext : undefined}
          />
        </motion.div>
      </AnimatePresence>

      {/* The pledge slides' clock: it belongs to the deck, not the slide, so
          it holds still while the words around it change. */}
      <AnimatePresence>
        {slide.showClock && (
          <motion.div
            key="clock"
            className="pj-slide-clock"
            initial={{ opacity: 0 }}
            animate={holdThen(changes > 0 ? CHANGE_HOLD : FIRST_HOLD, DUR.settle, { opacity: 0 }, { opacity: 1 }, EASE.settle)}
            exit={{ opacity: 0, transition: { duration: DUR.exit, ease: EASE.exit } }}
          >
            <SlideClock now={now} />
          </motion.div>
        )}
      </AnimatePresence>

      {sweeps.map((w) => (
        <ColorSweep key={w.id} direction={w.dir} onDone={() => sweepDone(w.id)} />
      ))}

      {/* Exit confirmation toast. data-pj-bottom-overlay: it stands on the
          bottom band, so the first-run setup note gives way while it is up
          (index.css). */}
      <AnimatePresence>
        {escArmed && (
          <motion.div
            className="absolute left-1/2 z-50"
            data-pj-bottom-overlay
            style={{ bottom: 'var(--pj-toast-bottom, calc(3 * var(--u)))', x: '-50%' }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0, transition: { duration: DUR.pop, ease: EASE.pop } }}
            exit={{ opacity: 0, y: 12, transition: { duration: DUR.exit, ease: EASE.exit } }}
          >
            <StepChip
              label="Exit slides"
              value={touch ? 'Tap Exit again' : 'Press ESC again'}
              size="var(--pj-toast-size, calc(2.2 * var(--u)))"
              plate={HOUSE.hot}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hover navigation. Fixed at the window's bottom-right, 2rem in and
          about 11.75rem wide: the first-run setup note stops short of it
          (index.css .pj-setup-note), and e2e/setup-card.spec.js measures it
          through data-slideshow-nav. A finger cannot hover, so on touch it is
          not there at all (it stood at opacity 0, and a blind tap on it moved
          the deck); the touch controls below take its place. */}
      {!touch && (
      <div
        className="fixed bottom-8 right-8 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-50"
        data-slideshow-nav
      >
        <div className="pj-panel flex gap-1 p-1">
          <NavPill disabled={index === 0} onClick={goPrev}>
            <ChevronLeft size={16} strokeWidth={2.5} />
            Prev
          </NavPill>
          <NavPill disabled={index === slides.length - 1 && !onFinish} onClick={goNext}>
            Next
            <ChevronRight size={16} strokeWidth={2.5} />
          </NavPill>
        </div>
      </div>
      )}

      {/* Touch: the deck's own controls, always visible, each a finger's
          size (index.css's touch block places them clear of the wall's
          words). Exit is pressed twice, like Escape, with the same toast. */}
      {touch && (
        <div className="pj-touch-slides" data-slideshow-touch-nav>
          <button
            type="button"
            className={`pj-touch-slides__exit${escArmed ? ' is-armed' : ''}`}
            onClick={exitTap}
            aria-label={escArmed ? 'Tap again to exit the slides' : 'Exit the slides'}
          >
            Exit
          </button>
          <button type="button" onClick={goPrev} disabled={index === 0} aria-label="Previous slide">
            <ChevronLeft size={22} strokeWidth={2.6} />
          </button>
          <button type="button" onClick={goNext} disabled={index === slides.length - 1 && !onFinish} aria-label="Next slide">
            <ChevronRight size={22} strokeWidth={2.6} />
          </button>
        </div>
      )}
    </div>
  );
};

/**
 * "6:00:33 PM" in the label voice. Londrina has no tabular figures, so each
 * digit sits in its own fixed cell and the clock never twitches as the
 * seconds tick.
 */
const SlideClock = ({ now }) => {
  const text = now.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
  return (
    <span className="pj-kicker" aria-label={text}>
      {[...text].map((ch, i) =>
        /[0-9]/.test(ch)
          ? <span key={i} className="pj-fig" aria-hidden="true">{ch}</span>
          : <span key={i} aria-hidden="true">{ch}</span>,
      )}
    </span>
  );
};

/** What a finger presses on purpose: a tap on one never also moves the deck. */
const CONTROLS = 'button, a, input, select, textarea, label, [role="button"], [role="dialog"], [data-pj-bottom-overlay]';

const NavPill = ({ disabled, onClick, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className="pj-kicker flex items-center gap-1.5 px-4 py-2 rounded-full text-white text-sm disabled:opacity-25 hover:bg-white/15 transition-all"
    style={{ letterSpacing: '0.1em', marginRight: 0 }}
  >
    {children}
  </button>
);
