import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { AppMode } from './types.js';
import { FLAGS } from './lib/flags.js';
import { stateKey, windowsForDate } from './lib/schedule.js';
import { useEffectiveSchedule } from './hooks/useEffectiveSchedule.js';
import { advisoryTitle } from './lib/scheduleAdvisory.js';
import { DUR, EASE } from './lib/motion-tokens.js';
import { useClock } from './hooks/useClock.js';
import { useSchedule } from './hooks/useSchedule.js';
import { useRealtime } from './hooks/useRealtime.js';
import { useWakeLock } from '../hooks/useWakeLock.js';
import { useBuildReload } from '../hooks/useBuildReload.js';
import { selfReload } from '../lib/reloadLedger.js';
import { projectorIdle } from '../lib/buildReload.js';
import { ViewErrorBoundary, ErrorScreen } from './components/ViewErrorBoundary.jsx';
import { AwanaMark } from './components/AwanaMark.jsx';
import { ResumePill } from './components/ResumePill.jsx';
import { SetupChecklist } from './components/SetupChecklist.jsx';
import { CountdownView } from './views/CountdownView.jsx';
import { GameTimeView } from './views/GameTimeView.jsx';
import { SlideshowView } from './views/SlideshowView.jsx';
import { ShutdownView } from './views/ShutdownView.jsx';
import { QuickNav } from './views/QuickNav.jsx';
import { TouchMenu } from './views/TouchMenu.jsx';
import { ConfigureView } from './views/ConfigureView.jsx';
import { listenForRelay, relayToScreen } from '../lib/configureRelay.js';
import { unlockStingers } from './lib/stingers.js';
import { isTouch, usePortrait, useTouch } from './lib/touch.js';

const OPENING_WINDOW_INDEX = 0;
const CONFIGURE = FLAGS.configure;

/** A relayed wall pick, checked before the live projector obeys it. */
const isTarget = (t) => Boolean(t) && typeof t === 'object'
  && (t.type === 'countdown' || (t.type === 'window' && Number.isInteger(t.index) && t.index >= 0 && t.index < 50));

export const App = () => {
  const now = useClock();

  // All realtime data (live tally + birthday sync + schedule advisory +
  // ?key= adoption) flows through the display's sanctioned sanitized
  // socket — see hooks/useRealtime.js. This replaces the original
  // repo's adoptPusherUrlFlags/useBirthdaySync startup chores. Read
  // before useSchedule() so the `schedule` broadcast can be folded in
  // as an advisory layer over shared/schedule.json (never a
  // replacement — see lib/scheduleAdvisory.js).
  const { tally, schedule: scheduleAdvisory, socketStatus } = useRealtime();
  const { state, isOverride, resumeAt, select, resume, stay } = useSchedule(now, scheduleAdvisory);

  // Advancing past the opening deck's final blackout jumps straight into
  // the first game window (T&T) — the leader ends the ceremony and starts
  // games with one more press of the same arrow key. Resolved against
  // tonight's EFFECTIVE window table (special dates can reshape it), the
  // same table select() indexes into.
  const scheduleCfg = useEffectiveSchedule();
  const effectiveWindows = windowsForDate(now, scheduleCfg) ?? scheduleCfg.windows;
  const firstGameIndex = effectiveWindows.findIndex((w) => w.kind === 'game');

  // ?view=game (the lobby's Settings → Other screens): open on game time
  // exactly as the menu would, so the watchdog and the resume pill still
  // hand it back to the schedule. A game window already on is left alone.
  // Once only: the flag leaves the URL, so a self-update reload lands on the
  // schedule instead of jumping back into games.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || FLAGS.view !== 'game') return;
    deepLinked.current = true;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('view');
      window.history.replaceState(window.history.state, '', url);
    } catch { /* the jump still happens */ }
    if (state.mode !== AppMode.GAME_TIME && firstGameIndex >= 0) select({ type: 'window', index: firstGameIndex });
  }, [state.mode, firstGameIndex, select]);

  // ?vr=1 (visual-regression / screenshot mode): stamp the root so CSS
  // can kill every keyframe animation, and tell framer-motion to skip
  // transform animations — two renders of one state become identical.
  useEffect(() => {
    if (!FLAGS.vr) return undefined;
    document.documentElement.dataset.vr = '1';
    return () => { delete document.documentElement.dataset.vr; };
  }, []);

  // A phone or tablet (lib/touch.js): the root carries it, as it carries
  // ?vr=1, for the e2e suites and anything that asks the DOM. The CSS itself
  // reads the same media queries directly (index.css, the touch and portrait
  // blocks at its end), so the first paint is already the right page.
  const touch = useTouch();
  const portrait = usePortrait();
  useEffect(() => {
    const root = document.documentElement;
    if (touch) root.dataset.touch = '1';
    if (portrait) root.dataset.portrait = '1';
    return () => {
      delete root.dataset.touch;
      delete root.dataset.portrait;
    };
  }, [touch, portrait]);

  // While the tab is hidden (projector input switched away, window
  // minimized) pause every ambient keyframe loop — no reason to burn
  // GPU on animations nobody can see. Resumes on return.
  useEffect(() => {
    const sync = () => {
      if (document.hidden) document.documentElement.dataset.animPaused = '1';
      else delete document.documentElement.dataset.animPaused;
    };
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => {
      document.removeEventListener('visibilitychange', sync);
      delete document.documentElement.dataset.animPaused;
    };
  }, []);

  // The projector must never doze off mid-countdown (same shared hook
  // as the signage page — on the presentation import allowlist).
  useWakeLock(!CONFIGURE);

  // Self-updating (see CLAUDE.md, "Self-updating pages"): the projector picks
  // up a new deploy on its own, and only while nobody is watching it count.
  // Shutdown is always safe, and so is a countdown still more than half an
  // hour out, before 5:30 on a club night, and any other day of the week.
  // The rule itself lives in the shared pure helper; here it is just "not
  // idle means busy".
  // The configure page never reloads itself under the operator's typing.
  const buildReloadBusy = useCallback(() => CONFIGURE || !projectorIdle(state), [state]);
  useBuildReload(buildReloadBusy);

  // A deliberately bare wall (the opening's closing blackout, the shutdown
  // screen's idle blackout) takes the Awana Clubs mark with it. The views
  // report it; a view that goes away reports false on its way out.
  const [bare, setBare] = useState(false);

  // The touch menu (TouchMenu): null while closed, 'menu' open, 'display'
  // open on Display Settings. A device that stops being touch-first (a mouse
  // plugged into a tablet) gets the hover menu back, closed.
  const [menu, setMenu] = useState(/** @type {null | 'menu' | 'display'} */ (null));
  if (menu !== null && !touch) setMenu(null);
  useEffect(() => {
    // On a phone the countdown chimes can only sound once a tap has woken
    // their audio (lib/stingers.js); the PC's browser needs no help.
    const arm = () => {
      if (isTouch()) unlockStingers();
    };
    window.addEventListener('pointerdown', arm, { capture: true, passive: true });
    window.addEventListener('keydown', arm, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', arm, { capture: true });
      window.removeEventListener('keydown', arm, { capture: true });
    };
  }, []);

  // The live projector: obey a wall pick relayed from a configure page beside
  // it (the sound room app's Settings window), as its own menu would.
  useEffect(() => {
    if (CONFIGURE) return undefined;
    return listenForRelay('projector', ['select', 'resume'], (action, target) => {
      if (action === 'resume') resume();
      else if (isTarget(target)) select(target);
    });
  }, [select, resume]);

  if (CONFIGURE) {
    return (
      <ConfigureView
        now={now}
        state={state}
        isOverride={isOverride}
        socketStatus={socketStatus}
        onSelect={(target) => { relayToScreen('projector', 'select', target); select(target); }}
        onResume={() => { relayToScreen('projector', 'resume'); resume(); }}
      />
    );
  }

  return (
    <MotionConfig reducedMotion={FLAGS.vr ? 'always' : 'user'}>
    <div className="w-full h-full relative" style={{ background: '#000000' }}>
      {/* One view at a time; exits run faster than entrances (the kit's rule). */}
      <AnimatePresence mode="wait">
        <motion.div
          key={stateKey(state)}
          className="absolute inset-0"
          data-mode={slugFor(state)}
          data-deck={state.mode === AppMode.SLIDESHOW ? state.deck : undefined}
          initial={{ opacity: 0, scale: 0.985 }}
          animate={{ opacity: 1, scale: 1, transition: { duration: DUR.mode, ease: EASE.settle } }}
          exit={{ opacity: 0, scale: 1.01, transition: { duration: DUR.mode / 2, ease: EASE.exit } }}
        >
          <ViewErrorBoundary label={labelFor(state)}>
            <ActiveView
              state={state}
              now={now}
              tally={tally}
              meetingTheme={advisoryTitle(scheduleAdvisory, now)}
              onSelect={select}
              firstGameIndex={firstGameIndex}
              onBareChange={setBare}
            />
          </ViewErrorBoundary>
        </motion.div>
      </AnimatePresence>

      {/* The Awana Clubs mark, like a broadcast logo: above every view, so no
          slide change or view crossfade ever moves it. */}
      <AwanaMark placement={state.mode === AppMode.GAME_TIME ? 'game' : 'default'} hidden={bare} />

      {touch ? (
        <TouchMenu
          now={now}
          state={state}
          isOverride={isOverride}
          onSelect={select}
          onResume={resume}
          socketStatus={socketStatus}
          open={menu !== null}
          displayOpen={menu === 'display'}
          onOpen={() => setMenu('menu')}
          onClose={() => setMenu(null)}
        />
      ) : (
        <QuickNav now={now} state={state} isOverride={isOverride} onSelect={select} onResume={resume} socketStatus={socketStatus} />
      )}
      {isOverride && <ResumePill now={now} resumeAt={resumeAt} onStay={stay} />}
      {touch ? <SetupChecklist touch onSetUp={() => setMenu('display')} /> : <SetupChecklist />}
    </div>
    </MotionConfig>
  );
};

const labelFor = (state) =>
  ({
    [AppMode.COUNTDOWN]: 'countdown',
    [AppMode.GAME_TIME]: 'game time',
    [AppMode.SLIDESHOW]: 'slideshow',
    [AppMode.SHUTDOWN]: 'shutdown',
  })[state.mode];

// Stable machine-readable id for the active view — the hook the e2e
// smoke tests assert on (e2e/countdown-modes.spec.js).
const slugFor = (state) =>
  ({
    [AppMode.COUNTDOWN]: 'countdown',
    [AppMode.GAME_TIME]: 'game-time',
    [AppMode.SLIDESHOW]: 'slideshow',
    [AppMode.SHUTDOWN]: 'shutdown',
  })[state.mode];

const ActiveView = ({ state, now, tally, meetingTheme, onSelect, firstGameIndex, onBareChange }) => {
  switch (state.mode) {
    case AppMode.COUNTDOWN:
      return (
        <CountdownView
          now={now}
          target={state.target}
          theme={meetingTheme}
          onSkip={() => onSelect({ type: 'window', index: OPENING_WINDOW_INDEX })}
        />
      );
    case AppMode.GAME_TIME:
      return <GameTimeView now={now} window={state.window} endsAt={state.endsAt} tally={tally} />;
    case AppMode.SLIDESHOW:
      return (
        <SlideshowView
          deck={state.deck}
          now={now}
          onExit={() => onSelect({ type: 'countdown' })}
          onBareChange={onBareChange}
          onFinish={
            state.deck === 'opening' && firstGameIndex !== -1
              ? () => onSelect({ type: 'window', index: firstGameIndex })
              : undefined
          }
        />
      );
    case AppMode.SHUTDOWN:
      // `now` feeds the shutdown screen's idle blackout (it runs until
      // midnight, mostly to an empty room) — see lib/idleBlackout.js.
      return <ShutdownView now={now} onRestart={() => onSelect({ type: 'countdown' })} onBareChange={onBareChange} />;
  }
};

/**
 * Last-resort boundary (per-view boundaries catch view crashes first). A
 * wall nobody is standing at cannot press Reload, so after ten seconds it
 * reloads itself, under the hourly cap every self-reload on either page
 * shares (src/lib/reloadLedger.js), so a crash that comes straight back
 * cannot spin the projector.
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
    this.timer = null;
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; selfReload(); }, 10_000);
  }
  componentWillUnmount() {
    if (this.timer) clearTimeout(this.timer);
  }
  render() {
    if (this.state.hasError) {
      return (
        <ErrorScreen
          message="Something went wrong — the show must go on."
          detail={this.state.error?.toString()}
          fullScreen
        />
      );
    }
    return this.props.children;
  }
}

export default App;
