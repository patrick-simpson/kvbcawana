import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { RotateCcw } from '../components/icons.jsx';
import { ScreenFrame } from '../components/ScreenFrame.jsx';
import { ParticleField } from '../components/ParticleField.jsx';
import { SparkleDoodles } from '../components/SparkleDoodles.jsx';
import { ClubWave } from '../components/ClubWave.jsx';
import { Kicker } from '../components/Kicker.jsx';
import { Headline } from '../components/Headline.jsx';
import { BodyText } from '../components/BodyText.jsx';
import { HOUSE } from '../lib/kit.js';
import { FLAGS } from '../lib/flags.js';
import { shouldBlackout } from '../lib/idleBlackout.js';
import { useKeydown } from '../hooks/useKeydown.js';
import { usePortrait, useTouch } from '../lib/touch.js';

const RESTART_KEYS = ['Space', 'Enter', 'ArrowRight', 'PageDown'];

/**
 * End-of-night screen, at full production value like every other view —
 * until nobody has touched the room for twenty minutes, at which point
 * it drops to solid black to save the projector's lamp (the shutdown
 * window runs 19:35 to midnight). Any key or mouse move brings it back.
 *
 * This lives HERE and nowhere else on purpose: shutdown is the one mode
 * guaranteed to be facing an empty room. A countdown, a ceremony or a
 * game clock going black on an idle keyboard would be a bug, not a
 * feature — people watch those without touching anything.
 */
export const ShutdownView = ({ now, onRestart, onBareChange }) => {
  // Idle is measured against the app's own ticking clock, so `?now=`
  // time travel can't make the screen believe it has been idle for
  // hours. A missing `now` just means "never idle".
  const nowMs = now ? now.getTime() : null;
  const nowRef = useRef(nowMs);
  const [lastActivity, setLastActivity] = useState(nowMs);
  useEffect(() => {
    nowRef.current = nowMs;
  }, [nowMs]);

  // The idle clock starts at mount. With no clock at all (`now` absent)
  // the reference point tracks the tick, so idle is always zero and the
  // screen simply never blacks out — the safe direction to fail in.
  const idleSince = lastActivity ?? nowMs;

  // ?vr=1 screenshot runs never black out — a visual-regression capture
  // of this view must be the view.
  const blackout = !FLAGS.vr && nowMs != null && shouldBlackout(nowMs - idleSince);

  // Mirrors `blackout` for the key handler, which needs to know whether
  // the operator could actually see the screen they just pressed at.
  const blackedRef = useRef(false);
  useEffect(() => {
    blackedRef.current = blackout;
  }, [blackout]);

  // The idle blackout is a bare wall: App takes the Awana Clubs mark away
  // with it, and gives it back on wake (or when this view goes).
  useEffect(() => {
    onBareChange?.(blackout);
  }, [blackout, onBareChange]);
  useEffect(() => () => onBareChange?.(false), [onBareChange]);

  // Activity is only tracked to whole clock ticks: a volunteer walking
  // past generates hundreds of mousemove events, and re-rendering the
  // screen for each of them would be worse than the lamp hours this
  // saves. Same value in, no state change, no re-render.
  const wake = useCallback(() => {
    setLastActivity((prev) => (nowRef.current === prev ? prev : nowRef.current));
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', wake, { passive: true });
    return () => window.removeEventListener('mousemove', wake);
  }, [wake]);

  // A phone or tablet has no mouse to move: a finger on the screen is the
  // activity that keeps it lit. And there, only the Start Over button starts
  // the evening again. On the PC the whole screen is a restart click (a
  // projector's clicker, a mouse anywhere), but a finger taps a screen it is
  // reading, and one tap on "Have a safe drive home!" restarted the countdown.
  const touch = useTouch();
  // Upright on a phone or tablet the headline takes rows at one big size.
  const portrait = usePortrait();
  useEffect(() => {
    if (!touch) return undefined;
    window.addEventListener('pointerdown', wake, { passive: true });
    return () => window.removeEventListener('pointerdown', wake);
  }, [touch, wake]);

  useKeydown((e) => {
    const wasBlack = blackedRef.current;
    wake();
    if (!RESTART_KEYS.includes(e.code)) return;
    e.preventDefault();
    // A press against a black screen only wakes it: nobody presses a
    // key at a black wall meaning "restart the whole evening".
    if (!wasBlack) onRestart();
  });

  if (blackout) {
    // Deliberately bare — every ambient layer unmounts with it, so the
    // idle screen costs nothing to run. Pure black is the house
    // background anyway; this is the degenerate case of it.
    return (
      <div
        data-blackout="1"
        className="w-full h-full"
        style={{ background: '#000000' }}
        onClick={wake}
      />
    );
  }

  return (
    <ScreenFrame
      layers={
        <>
          {/* The house wave (the lobby's sunflower behind Awana orange),
              rising once and then still: the end of the night. */}
          <ClubWave color={HOUSE.sun} position="bottom" height={13} flip />
          <ClubWave color={HOUSE.orange} position="bottom" height={9.5} delay={0.08} />
          <ParticleField />
          <SparkleDoodles seed={9} count={8} />
        </>
      }
    >
      <div
        className="pj-frame pj-shutdown cursor-pointer"
        onClick={touch ? undefined : onRestart}
      >
        <motion.div className="flex flex-col items-center" initial="hidden" animate="shown">
          <Kicker size="var(--text-kicker)" part={{ index: 0, hold: 0.2 }}>Awana night</Kicker>

          <Headline
            text="SEE YOU NEXT WEEK!"
            fit={portrait ? { maxU: 12, widthU: 88, minU: 12 } : { maxU: 8, widthU: 86 }}
            parts={{ start: 1, hold: 0.2 }}
            style={{ marginTop: 'calc(1.4 * var(--u))' }}
          />

          <BodyText
            text="Have a safe drive home!"
            size="var(--text-body)"
            parts={{ start: 5, hold: 0.2 }}
            style={{ marginTop: 'calc(2 * var(--u))' }}
          />
        </motion.div>

        <button
          className="pj-line-button mt-14 flex items-center gap-2 px-8 py-3"
          style={{ fontSize: 'var(--pj-restart-size, calc(1.5 * var(--u)))' }}
          onClick={(e) => {
            e.stopPropagation();
            onRestart();
          }}
        >
          <RotateCcw size={16} strokeWidth={2.5} />
          Start Over
        </button>
        {/* A keyboard's hint: a phone has no Space bar to press. */}
        {!touch && (
          <p
            className="pj-kicker text-white/30"
            style={{ fontSize: 'calc(1.1 * var(--u))', marginTop: 'calc(0.9 * var(--u))' }}
          >
            or press Space
          </p>
        )}
      </div>
    </ScreenFrame>
  );
};
