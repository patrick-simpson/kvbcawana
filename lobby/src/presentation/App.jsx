import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { AppMode } from './types.js';
import { FLAGS } from './lib/flags.js';
import { stateKey, windowsForDate } from './lib/schedule.js';
import { useEffectiveSchedule } from './hooks/index.js';
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
import { ChurchMark } from './components/ChurchMark.jsx';
import { ResumePill } from './components/ResumePill.jsx';
import { BackupView } from './components/BackupView.jsx';
import { remoteGo, remoteStep } from './lib/remoteSteps.js';
import { ceremonySlide } from './lib/ceremonySlide.js';
import { SetupChecklist } from './components/SetupChecklist.jsx';
import { CountdownView } from './views/CountdownView.jsx';
import { GameTimeView } from './views/GameTimeView.jsx';
import { SlideshowView } from './views/SlideshowView.jsx';
import { ShutdownView } from './views/ShutdownView.jsx';
import { QuickNav } from './views/QuickNav.jsx';
import { TouchMenu } from './views/TouchMenu.jsx';
import { ConfigureView } from './views/ConfigureView.jsx';
import { listenForRelay, relayToScreen } from '../lib/configureRelay.js';
import { listenToProjectors, sendScreenAction, thisScreenId, useScreenSync } from '../hooks/useScreenSync.js';
import { lowPowerPreference, setLowPowerPreference, subscribeLowPower } from './hooks/useLowPower.js';
import { setStingersEnabled, silenceStingers, stingersEnabled, subscribeStingers, unlockStingers } from './lib/stingers.js';
import { isTouch, usePortrait, useTouch } from './lib/touch.js';

const OPENING_WINDOW_INDEX = 0;
/** The remote's Back to the countdown: held until a Next (hooks/useSchedule.js). */
const HELD_COUNTDOWN = Object.freeze({ type: 'countdown', hold: true });
const CONFIGURE = FLAGS.configure;
// The lobby's copy of the projector during the opening ceremony (?mirror=1;
// owner 2026-10-19): silent, no menus, never a registered screen.
const MIRROR = FLAGS.mirror && !CONFIGURE;
if (MIRROR) silenceStingers();
/** The message a mirror sends its host frame (lobby src/lib/embed.js reads the same string). */
export const MIRROR_MESSAGE = 'awana-display:projector-mirror';

/** A backup screen the remote asked for (already cleaned by useScreenSync; checked again). */
const isBackup = (t) => Boolean(t) && ['us-flag', 'awana-flag', 'verse'].includes(t.what);

/** A relayed wall pick, checked before the live projector obeys it. */
const isTarget = (t) => Boolean(t) && typeof t === 'object'
  && (t.type === 'countdown' || (t.type === 'window' && Number.isInteger(t.index) && t.index >= 0 && t.index < 50));

// The projector, managed from /settings (ROADMAP.md#settings-page, phase 2): it registers
// with the sync Worker like a lobby TV, through the signage's own
// useScreenSync (one copy of the rules, on the isolation allowlist), and its
// two device switches are its layer: Low power and the countdown chimes, the
// same stores the menu writes. A wall pick or Resume from /settings is obeyed
// as the menu's own would be.

/** @param {{ enabled: boolean, onAction: (action: string, data?: unknown) => void }} opts */
export function useProjectorScreen({ enabled, onAction }) {
  const lowPower = useSyncExternalStore(subscribeLowPower, lowPowerPreference, lowPowerPreference);
  const stingers = useSyncExternalStore(subscribeStingers, stingersEnabled, stingersEnabled);
  // Both always written out, so "off" is a value /settings can see.
  const overrides = useMemo(() => ({ lowPower, stingers }), [lowPower, stingers]);
  const replaceConfig = useCallback((next) => {
    setLowPowerPreference(next.lowPower === true);
    setStingersEnabled(next.stingers === true);
  }, []);
  useScreenSync({ kind: 'projector', enabled, overrides, replaceConfig, onAction, defaultName: 'Projector' });
}

export const App = () => {
  const now = useClock();

  // All realtime data (live tally + birthday sync + schedule advisory)
  // flows through the display's sanctioned sanitized
  // socket — see hooks/useRealtime.js. This replaces the original
  // repo's useBirthdaySync startup chore. Read
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
  useWakeLock(!CONFIGURE && !MIRROR);

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
  // screen's idle blackout) takes the church's logo with it. The views
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

  // Managed from /settings (ROADMAP.md#settings-page, phase 2): registered with the sync
  // Worker, its two switches followed, a wall pick or Resume obeyed. Never
  // from the configure page itself.
  // The opening-ceremony remote (owner 2026-10-19; /lobby/projector-remote.html).
  // Next and Back are the arrow keys on the deck; on the countdown a Next
  // starts the ceremony. A backup (a flag beside its pledge, or 2 Timothy
  // 2:15) covers the wall until the remote takes it down, Escape does, or a
  // Next/Back is pressed (which only takes it down: the slide under it is
  // still the one the room was on).
  const [backup, setBackup] = useState(/** @type {null | 'us-flag' | 'awana-flag' | 'verse'} */ (null));
  const remoteStepFor = (dir) => {
    if (backup) { setBackup(null); return; }
    if (state.mode === AppMode.SLIDESHOW) remoteStep(dir);
    else if (state.mode === AppMode.COUNTDOWN && dir === 1) select({ type: 'window', index: OPENING_WINDOW_INDEX });
  };
  useEffect(() => {
    if (!backup) return undefined;
    const onKey = (e) => {
      if (e.code !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setBackup(null);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [backup]);

  // The gym projector announces every slide its opening deck moves to (any
  // cause: keys, the remote, its own timer) as a slide-go for its mirrors;
  // it ignores its own echo. A mirror never announces.
  const announceSlide = useCallback((index) => {
    if (CONFIGURE || MIRROR) return;
    const id = thisScreenId();
    if (id) sendScreenAction(id, 'slide-go', { index });
  }, []);

  // A mirror follows every projector's announcements and backups. A slide-go
  // while it still counts down (the gym started early) opens the ceremony
  // first and goes to that slide once the deck is up.
  const pendingGo = useRef(/** @type {number | null} */ (null));
  const mirrorState = useRef(state);
  useEffect(() => { mirrorState.current = state; }, [state]);
  useEffect(() => {
    if (!MIRROR) return undefined;
    return listenToProjectors((action, data) => {
      const s = mirrorState.current;
      if (action === 'slide-go') {
        const index = /** @type {{index: number}} */ (data).index;
        if (s.mode === AppMode.SLIDESHOW && s.deck === 'opening') remoteGo(index);
        else if (s.mode === AppMode.COUNTDOWN) { pendingGo.current = index; select({ type: 'window', index: OPENING_WINDOW_INDEX }); }
      } else if (action === 'backup' && isBackup(data)) setBackup(/** @type {any} */ (data).what);
      else if (action === 'backup-end') setBackup(null);
      else if (action === 'to-countdown') { setBackup(null); select(HELD_COUNTDOWN); }
    });
  }, [select]);
  useEffect(() => {
    if (pendingGo.current === null || state.mode !== AppMode.SLIDESHOW) return;
    const index = pendingGo.current;
    pendingGo.current = null;
    remoteGo(index);
  }, [state]);
  // ...and tells its host (the lobby) whether the ceremony is on: a real
  // slide of the opening deck, not its closing blackout (owner 2026-10-22:
  // "the other screens should un duplicate once we get to the pure black screen").
  const [openingIndex, setOpeningIndex] = useState(0);
  const onDeckIndex = useCallback((index) => { setOpeningIndex(index); announceSlide(index); }, [announceSlide]);
  const ceremony = state.mode === AppMode.SLIDESHOW && state.deck === 'opening' && ceremonySlide(openingIndex);
  useEffect(() => {
    if (!MIRROR || window.parent === window) return;
    try { window.parent.postMessage({ type: MIRROR_MESSAGE, ceremony }, window.location.origin); } catch { /* host gone */ }
  }, [ceremony]);

  useProjectorScreen({
    enabled: !CONFIGURE && !MIRROR,
    onAction: (action, target) => {
      if (action === 'resume') resume();
      else if (action === 'select' && isTarget(target)) select(target);
      else if (action === 'slide-next') remoteStepFor(1);
      else if (action === 'slide-prev') remoteStepFor(-1);
      else if (action === 'backup' && isBackup(target)) setBackup(target.what);
      else if (action === 'backup-end') setBackup(null);
      else if (action === 'to-countdown') { setBackup(null); select(HELD_COUNTDOWN); }
    },
  });

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
              onIndexChange={onDeckIndex}
            />
          </ViewErrorBoundary>
        </motion.div>
      </AnimatePresence>

      {/* The church's logo, like a broadcast logo: above every view, so no
          slide change or view crossfade ever moves it. The shutdown screen
          signs the night off with the full logo, tagline and all. */}
      <AnimatePresence>{backup && <BackupView key={backup} what={backup} />}</AnimatePresence>

      <ChurchMark hidden={bare && !backup} full={state.mode === AppMode.SHUTDOWN} />

      {MIRROR ? null : touch ? (
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
      {!MIRROR && isOverride && <ResumePill now={now} resumeAt={resumeAt} onStay={stay} />}
      {MIRROR ? null : touch ? <SetupChecklist touch onSetUp={() => setMenu('display')} /> : <SetupChecklist />}
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

const ActiveView = ({ state, now, tally, meetingTheme, onSelect, firstGameIndex, onBareChange, onIndexChange }) => {
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
          onIndexChange={state.deck === 'opening' ? onIndexChange : undefined}
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
