import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig } from 'framer-motion';
import { M, ZeroAnimationContext } from './lib/motion.jsx';
import BackgroundIframe from './components/BackgroundIframe.jsx';
import Overlay from './components/Overlay.jsx';
import ParticleLayer from './components/ParticleLayer.jsx';
import TonightTicker, { tickerRows } from './components/TonightTicker.jsx';
import CheckoutBoard from './components/CheckoutBoard.jsx';
import CheckoutBanner from './components/CheckoutBanner.jsx';
import NoticeBanner, { NOTICE_CHECK_MS, noticeShowing } from './components/NoticeBanner.jsx';
import CornerChip from './components/CornerChip.jsx';
import StepChip from './components/brand/StepChip.jsx';
// Operator panels load on demand (their own chunks): see operatorPanels.jsx.
// Their stylesheets stay in the main CSS, in the order they always had (before
// app.css): a lazily appended sheet would land AFTER app.css and win ties.
import './styles/settings-overhaul.css';
import './styles/laptop.css';
import './styles/history.css';
import { DebugOpening, DebugPanel, PanelOpening, RemoteScreenPanel, SettingsPanel, SlideEditorPanel } from './components/operatorPanels.jsx';
import SetupCard, { useSetupCard } from './components/SetupCard.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import StickerChip from './components/StickerChip.jsx';
import MilestoneToast from './components/MilestoneToast.jsx';
import UpNextChip from './components/UpNextChip.jsx';
import { useConfig } from './hooks/useConfig.js';
import { useCheckInQueue, BURST_THRESHOLD } from './hooks/useCheckInQueue.js';
import { useCornerItem } from './hooks/useCornerItem.js';
import { useLinger } from './hooks/useLinger.js';
import { DUR, EASE } from './lib/brand.js';
import { useSocket, simulateEvent, dispatchEvent } from './hooks/useSocket.js';
import { useSyncedDeck } from './hooks/useSyncedDeck.js';
import { useSeenEvents } from './hooks/useSeenEvents.js';
import { useSchedule } from './hooks/useSchedule.js';
import { useWakeLock } from './hooks/useWakeLock.js';
import { useTally } from './hooks/useTally.js';
import { useTheme } from './hooks/useTheme.js';
import { useCalendar } from './hooks/useCalendar.js';
import { useWeather } from './hooks/useWeather.js';
import { useSnowForecast } from './hooks/useSnowForecast.js';
import { LobbyLiveContext } from './lib/lobbyLive.jsx';
import { localDateStr } from './lib/calendarLogic.js';
import { PREVIEW_PROMOS, previewPromo } from './lib/promos.js';
import PromoSlide from './components/PromoSlide.jsx';
import { fireMilestone, setConfettiLevel, setConfettiLoad, setConfettiSkin } from './lib/confetti.js';
import { resolveSkin, sceneForSkin, SKIN_TABLE } from './lib/skins.js';
import { BOARD_HIDDEN, decideBoard, demoCheckout, pickupNow } from './lib/checkoutBoard.js';
import { SAMPLE_BOARD_NAMES, SAMPLE_NAMES, pick } from './lib/demoNames.js';
import { useScreenSync } from './hooks/useScreenSync.js';
import { clubKey, getAllClubs } from './lib/clubs.js';
import { saveClubCounts } from './lib/clubCountsStore.js';
import { OVERLAY, setupUp } from './lib/overlayFit.js';
import {
  autoSlideDeck, calendarSlidesFor, effectiveManualSlides, isSlideDriven, promoSlotFor, promosAreOn,
  snowPhoneAsksWeather, tonightTitleOf, visibleManualSlides, wantsSnowForecast,
} from './lib/lobbyDeck.js';
import {
  activeFaults, checkInsHeldNow, cornerFallbackMs, cornerSlots, cornerSources, flagTabs, isAprilFools,
  nameFaultWords, posterIsHeld, reloadIsBusy, roomFor, shortcutFor, shouldShowStatus, stageClassName,
  statusAriaLabel, tickerIsActive, visibleCornerItem,
} from './lib/lobbyDirector.js';
import {
  clubMilestoneCrossings, freshCrossings, isPrinterFailure, recapInWindow, tallyMilestoneHit,
} from './lib/lobbyEvents.js';
import { STINGER_SEC, holdThenLand } from './lib/lobbyMotion.js';
import { squishLand, withSquish } from './lib/squish.js';
import { birthdayRibbon } from './lib/birthdayWeek.js';
import { autoParticleEffect, weatherMood } from './lib/weather.js';
import { useCelebrationQueue } from './hooks/useCelebrationQueue.js';
import { timedFetch } from './lib/timedFetch.js';
import { isFresh, stampOf, stampReceived } from './lib/freshness.js';
import { COUNT_WATCH_START, countsWithoutNamesNow, nameArrived, watchCounts } from './lib/countsWithoutNames.js';
import { leavesFor, listFresh } from './lib/checkoutLeaves.js';
import { useCheckoutBanners } from './hooks/useCheckoutBanners.js';
import {
  AWARD_MILESTONES, BOOK_MILESTONES, awardMilestoneCopy, bookMilestoneCopy,
  isBigMilestone, nightMilestoneCopy,
} from './lib/milestones.js';
import { receiveSharedSettings, setRemoteDefaults, setSharedLocally } from './hooks/useConfig.js';
import { publishSettings } from './lib/publishSettings.js';
import { onSyncDoorbell, publishViaSync, useSync, useSyncDriver } from './hooks/useSync.js';
import { MISSION_HIDDEN_CLEAR_MS, initialMission, reduceMission } from './lib/missionControl.js';
import { loadPublishToken } from './lib/publishToken.js';
import { FLEET_CONFIG_URL_CHANGE_EVENT, loadFleetConfigUrl, resolveRemoteConfigUrl } from './lib/fleetConfigUrl.js';
import { getClubPalette } from './lib/clubs.js';
import { clubTintFor } from './lib/clubTint.js';
import { parseUrlFlags } from './lib/urlFlags.js';
import { applyPanicMode } from './lib/panic.js';
import { isLatePhase } from './lib/schedule.js';
import {
  clearFirstOfNight, firstOfNightCopy, hasFiredToday, isFirstOfNight, markFiredToday,
} from './lib/firstOfNight.js';
import { useWatchdogReload } from './hooks/useWatchdogReload.js';
import { useBuildReload } from './hooks/useBuildReload.js';
import { useTallerThan } from './hooks/useTallerThan.js';
import { hostCheckin, hostDoorbell, hostMirror, isEmbedded } from './lib/embed.js';
import { useCeremonyMirror } from './hooks/useCeremonyMirror.js';
import { MirrorSwitching } from './components/MirrorSwitching.jsx';
import { isConfigureMode, isSettingsPage, listenForRelay, relayToScreen } from './lib/configureRelay.js';
import { BACKGROUND_VIDEO_CHANGED_EVENT } from './components/VideoBackground.jsx';
import { BOARD_DEMO_MS, BUILD_QUIET_MS, SHARE_DEBOUNCE_MS, COUNTS_WITHOUT_NAMES_MS, TONIGHT_STALE_MS, DROPPED_GRACE_MS, EMBED_FULLSCREEN_MESSAGE, LAYER_FAULT_SHOW_MS, MILESTONE_TOAST_MS, OPS_FAILURES_MAX, SETUP_CARD_QUIET_MS } from './lib/constants.js';

// Read once — the URL can't change without a full page load.
const FLAGS = parseUrlFlags();
// ?configure=1: this screen's Settings only, beside the live screen (the sound
// room app's Settings window; src/lib/configureRelay.js). Saved settings reach
// the live screen through storage; its own buttons are relayed to it. Names,
// sound and confetti never play here, and it holds no wake lock.
const CONFIGURE = isConfigureMode();
// awana.kvbchurch.org/settings (ROADMAP.md#settings-page): configure mode on a device that
// is not a screen, so nothing is relayed and this browser's own cards hide.
const SETTINGS_PAGE = isSettingsPage();
// The live screen's side of the relay: what a configure page may ask of it.
// 'preview-promo' (2026-10-16): Settings → Slides & look → Preview the promos,
// from the sound room's Settings window, plays on the live TV (one of
// PREVIEW_PROMOS' keys, nothing else).
const RELAYED = ['preview-checkin', 'reset-tally', 'board-demo', 'media-changed', 'preview-promo'];
const PROMO_KEYS = new Set(PREVIEW_PROMOS.map((p) => p.key));
// The home page's showcase twin (site/showcase/stub.js, which sets this before
// any app code runs) is framed but is a lobby screen, so it hears relays; its
// relay channel is the stub's own, in-frame, spoken only by the home page.
// Journey's embedded copy (a real kiosk) still never does.
const SHOWCASE = typeof window !== 'undefined' && !!(/** @type {any} */ (window).__SHOWCASE__);
// The home page's promos section loops every poster this lobby has (owner,
// 2026-10-16): the twin hands the list up (the stub reads it here), so a poster
// added to PREVIEW_PROMOS joins the loop by itself.
if (SHOWCASE) /** @type {any} */ (window).__SHOWCASE__.promos = PREVIEW_PROMOS.map((p) => ({ key: p.key, label: p.label }));
const noop = () => {};
// Configure mode and the settings page open Settings on the first render, so
// its chunk is asked for now, beside the main one, not after it has run.
// A screen asks for nothing here: its panels load when a volunteer reaches
// for them (the keyboard shortcut, the first-run card).
if (CONFIGURE) {
  SettingsPanel.preload();
  if (SETTINGS_PAGE) RemoteScreenPanel.preload();
}

// The WAITING chip pops in on the kit's curve and squashes at the pop's peak
// (the soft squish, src/lib/squish.js). A constant: the chip stays mounted
// while its count changes, and a constant target never replays.
const WAITING_ENTER = withSquish(
  holdThenLand(0, DUR.pop, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1 }, EASE.pop),
  squishLand(0, 'chip', DUR.pop, 'pop'),
);

// The ceremony mirror turns the lobby over to the projector by zooming the
// projector's wall up from just under full size, and hands it back by
// shrinking it away (transform and opacity only; instant under zero
// animation). Its last values are at rest: shown full size, or gone.
const MIRROR_SHOW = { opacity: 1, scale: 1, transition: { duration: 0.7, ease: EASE.settle } };
const MIRROR_HIDE = { opacity: 0, scale: 0.86, transition: { duration: 0.6, ease: EASE.exit } };

export default function App() {
  // ?config=<url>: centrally-managed overrides fetched once at startup,
  // sanitized through the same validators as localStorage overrides.
  // Failures are remembered so the Settings panel can tell the operator
  // their central config isn't being applied — silently falling back
  // looks identical to working until club night.
  const [remoteConfigError, setRemoteConfigError] = useState(null);
  // The display login can deliver that same URL (#394), so a replacement
  // screen is set up by one passphrase instead of by hand. It lives in its own
  // storage slot — never in the config object, which `?config=` and Settings →
  // Export both operate on — and is applied HERE, through the one remote-config
  // path that already existed. An explicit `?config=` still wins: someone
  // standing at the screen with a URL in their hand outranks what the print
  // server last handed it. Tracked as state so a screen that logs in for the
  // first time picks its fleet settings up without a reload.
  const [provisionedConfigUrl, setProvisionedConfigUrl] = useState(loadFleetConfigUrl);
  useEffect(() => {
    const sync = () => setProvisionedConfigUrl(loadFleetConfigUrl());
    window.addEventListener(FLEET_CONFIG_URL_CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(FLEET_CONFIG_URL_CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  const remoteConfigUrl = resolveRemoteConfigUrl(FLAGS.configUrl, provisionedConfigUrl);
  useEffect(() => {
    if (!remoteConfigUrl) return undefined;
    let cancelled = false;
    timedFetch(remoteConfigUrl, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((raw) => {
        if (cancelled) return;
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          setRemoteDefaults(raw);
          setRemoteConfigError(null);
        } else {
          setRemoteConfigError('remote config is not a JSON settings object');
        }
      })
      .catch((err) => {
        if (!cancelled) setRemoteConfigError(err?.message || 'fetch failed');
      });
    return () => { cancelled = true; };
  }, [remoteConfigUrl]);

  const { config: effectiveConfig, storedConfig, overrides, shared, updateConfig, replaceConfig, resetConfig } = useConfig();

  // Layering — baked defaults < ?config= remote < this device's overrides <
  // ?lowPower=1 URL flag — lives in useConfig.js so EVERY
  // consumer (the socket included) sees the same effective config. Only the
  // panic mask is applied here, last, because the stage is the only thing that
  // renders it: Settings edits `storedConfig`, and the socket reads the
  // flagged-but-unmasked `effectiveConfig` straight from the store. Memoized so
  // `config` keeps a stable identity per store snapshot.
  const config = useMemo(() => applyPanicMode(effectiveConfig), [effectiveConfig]);
  // The lobby director (rebrand stage 4). The typed slideshow reports each
  // slide; a promo poster or a slide marked "Hold check-ins" holds the
  // check-in queue while it is up, and names on screen pause the slideshow
  // in turn, so the two never compete for the room. `special` only ever
  // comes from a deck that can move on to an ordinary slide (see
  // ManualSlideshow), so a child can never wait forever.
  const [slideInfo, setSlideInfo] = useState({ key: 'none', special: false, poster: false });
  // Settings → Slides → "Preview the promos": one promo played full screen on
  // this TV for its own hold, over whatever the slideshow is doing. It holds
  // check-ins exactly as the real poster would (names wait behind the
  // WAITING chip, then play in full), so a rehearsal never hides a child.
  const [promoPreview, setPromoPreview] = useState(/** @type {{ promo: any, at: number } | null} */ (null));
  const previewUp = !FLAGS.overlay && promoPreview != null;
  // `specialDates` is the shared schedule's break-week table (#342) — the same
  // file the projector reads. resolvePhase already applies it (a cancelled
  // night is 'off'); the calendar slides need it too, so nights-remaining and
  // the heads-up slide agree with the projector.
  const { phase, specialDates, schedule: sharedSchedule, source: scheduleSource } = useSchedule(config);
  // The opening ceremony on the lobby (owner 2026-10-19): the projector's own
  // page, mirrored from 6:00 until T&T game time (lib/ceremonyMirror.js). It
  // covers the wall like a promo poster does and holds check-ins the same way
  // (WAITING chip; the names play as one run when the lobby comes back).
  const { mounted: mirrorMounted, up: mirrorCopying, switching: mirrorSwitchingNow, frameRef: mirrorFrameRef, query: mirrorQuery } = useCeremonyMirror({
    schedule: sharedSchedule, showcase: SHOWCASE, configure: CONFIGURE, settingsPage: SETTINGS_PAGE, overlay: FLAGS.overlay,
  });
  // The switching card (five seconds) then the gym's own picture: one cover.
  const mirrorUp = mirrorCopying || mirrorSwitchingNow;
  const coverUp = previewUp || mirrorUp;
  // Framed (the classroom, the Journey kiosk), the host is told when the
  // mirror goes up and comes down (lib/embed.js hostMirror): the classroom
  // raises this frame over its black for it, Journey holds its self-update.
  // Nothing is said until the mirror first goes up (a host starts at "down").
  const mirrorToldRef = useRef(false);
  useEffect(() => {
    if (CONFIGURE || !isEmbedded()) return;
    if (!mirrorUp && !mirrorToldRef.current) return;
    mirrorToldRef.current = true;
    try { window.parent.postMessage(hostMirror(mirrorUp), window.location.origin); } catch { /* no parent to tell */ }
  }, [mirrorUp]);
  const checkInsHeld = checkInsHeldNow({ overlay: FLAGS.overlay, slideSpecial: slideInfo.special, previewUp: coverUp });
  const {
    currentEvent, run: checkInRun, step: checkInStep, enqueue, skipCurrent, pending, gap: checkInGap,
  } = useCheckInQueue(config, { held: checkInsHeld });
  const { count, bump, reset: resetTally, sync: syncTally, rollover: rolloverTally } = useTally();
  // Set (synchronously, before the reconciled `count` even commits) whenever
  // a tally broadcast jumps the counter, so the milestone effect below can
  // tell a reconciliation apart from a real one-at-a-time bump() and skip
  // celebrating it — an undo or an offline catch-up must never fire a
  // "you just hit 50!" toast.
  const tallySyncedRef = useRef(false);
  // …and the visible half of the same event (#351): when a broadcast moves the
  // counter by MORE than one, say so under the number. A wall that jumps 38 →
  // 45, or counts down after an operator undo, otherwise looks broken to
  // everyone standing in the lobby. { from, to } for the wording. The corner
  // shows the tally only at its own slide loads, frozen in between, so this is
  // a LATCH rather than a timer: the next tally snapshot carries it (the note
  // then sits under the corrected number for that one load) and clears it.
  // Deliberately NOT the celebration queue: an explanation must never be able
  // to displace a milestone toast.
  const [tallySync, setTallySync] = useState(/** @type {{from: number, to: number}|null} */ (null));
  // A correction to a counter nobody can see explains nothing later on.
  const showTallyRef = useRef(config.showTally);
  useEffect(() => { showTallyRef.current = config.showTally; }, [config.showTally]);
  const { hasSeen, markSeen, stats: seenStats } = useSeenEvents();
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useTheme(config);

  // Who is still waiting to be picked up. Just the latest snapshot — all of the
  // "may this be on screen, and may it name anyone" judgement lives in the pure
  // decideBoard() in src/lib/checkoutBoard.js.
  const [checkout, setCheckout] = useState(null);

  // Re-evaluated on a slow ticker as well as on new data, because the board's
  // most important transition — going stale when the volunteer closes the
  // TwoTimTwo tab — happens when NOTHING arrives. An effect keyed only on the
  // payload would leave a frozen list looking live all night.
  // `now` is held in state rather than read inside the memo, so the decision
  // stays a pure function of its inputs and the clock is an explicit dependency.
  const [boardNow, setBoardNow] = useState(0);
  useEffect(() => {
    const advance = () => setBoardNow(Date.now());
    advance();
    const t = setInterval(advance, 30000);
    return () => clearInterval(t);
  }, [checkout]);   // re-stamp on new data so a fresh board is never shown as aged

  // When this screen first saw the list empty: in pickup mode the board says
  // "Everyone has been checked out" for a minute from then, and steps away.
  // Stamped where the payload lands (handleCheckout), not from an effect.
  const [emptySince, setEmptySince] = useState(/** @type {number | null} */ (null));
  // "<First name> has checked out" (owner, 2026-10-08; src/lib/checkoutLeaves.js
  // says when a departure may be said, useCheckoutBanners takes the turns):
  // each fresh list is compared with the last one this screen saw in a row
  // (the baseline), which a reconnect or a status change forgets, so the
  // Worker's replay of the last list to a screen that connects is a baseline,
  // never a room full of departures. A check-in moment outranks the banners.
  const { current: leaveNow, add: addLeaves, clear: clearLeaves } = useCheckoutBanners({ held: currentEvent != null });
  const leaveBaselineRef = useRef(/** @type {{ entries: any[], stamp: number } | null} */ (null));
  const leaveRulesRef = useRef({ staleMin: config.checkoutBoardStaleMin, namesAbove: config.checkoutBoardNamesAbove });
  useEffect(() => {
    leaveRulesRef.current = { staleMin: config.checkoutBoardStaleMin, namesAbove: config.checkoutBoardNamesAbove };
  }, [config.checkoutBoardStaleMin, config.checkoutBoardNamesAbove]);
  const handleCheckout = useCallback((sanitized) => {
    // ?club=<id>: the pickup board lists only that club's children (the naming
    // rule then counts that club alone, so it anonymises sooner, never later).
    const payload = FLAGS.club && Array.isArray(sanitized?.entries)
      ? { ...sanitized, entries: sanitized.entries.filter((e) => clubKey(e?.club) === FLAGS.club) }
      : sanitized;
    const stamped = stampReceived(payload);
    setCheckout(stamped);
    const empty = Array.isArray(payload?.entries) && payload.entries.length === 0;
    setEmptySince((was) => (empty ? (was ?? Date.now()) : null));
    const now = Date.now();
    const after = { entries: Array.isArray(payload?.entries) ? payload.entries : [], stamp: stampOf(stamped) };
    const { staleMin, namesAbove } = leaveRulesRef.current;
    if (!FLAGS.overlay) {
      addLeaves(leavesFor({ before: leaveBaselineRef.current, after, now, staleMin, namesAbove, pickup: pickupNow({ now }) }));
    }
    leaveBaselineRef.current = listFresh(after.stamp, staleMin, now) ? after : null;
  }, [addLeaves]);

  // Settings → Pickup board → "Show a demo on this TV": a sample board for
  // BOARD_DEMO_MS on this screen only, whatever the mode and the clock. It
  // never touches the real checkout data, and the naming rule still applies.
  const [boardDemoAt, setBoardDemoAt] = useState(/** @type {number | null} */ (null));
  useEffect(() => {
    if (boardDemoAt == null) return undefined;
    const t = setTimeout(() => setBoardDemoAt(null), BOARD_DEMO_MS);
    return () => clearTimeout(t);
  }, [boardDemoAt]);
  const boardDemo = boardDemoAt != null;
  const boardData = useMemo(
    () => (boardDemo ? demoCheckout(getAllClubs(), SAMPLE_BOARD_NAMES, boardDemoAt) : checkout),
    [boardDemo, boardDemoAt, checkout],
  );

  const boardDecision = useMemo(() => decideBoard({
    checkout: boardData,
    namesAbove: config.checkoutBoardNamesAbove,
    staleMin: config.checkoutBoardStaleMin,
    emptySince,
    demo: boardDemo,
    now: boardNow,
  }), [boardData, config.checkoutBoardNamesAbove, config.checkoutBoardStaleMin, emptySince, boardDemo, boardNow]);
  // Is the room being picked up: from 7:30 pm by itself, every night
  // (checkoutBoard.js pickupNow). The board, the "has checked out" banners and
  // the corner counter all follow it; outside it, no banner waits.
  const pickup = pickupNow({ now: boardNow, demo: boardDemo });
  const pickupHours = pickupNow({ now: boardNow });
  useEffect(() => { if (!pickupHours) clearLeaves(); }, [pickupHours, clearLeaves]);

  // Church-authored announcements (#onNotice): latest one wins, same as
  // the tally/ops widgets. NoticeBanner picks its presentation from `level`;
  // whether it is still up is judged HERE, on this one clock, and handed to
  // the banner, so the room rules below (the copy stepping aside for a
  // critical notice) and the banner itself can never disagree about it.
  const [notice, setNotice] = useState(null);
  const [noticeNow, setNoticeNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNoticeNow(Date.now()), NOTICE_CHECK_MS);
    return () => clearInterval(t);
  }, []);
  const noticeUp = noticeShowing(notice, noticeNow);

  // Who holds which part of the room (src/lib/overlayFit.js lobbyRoom): the
  // pickup board in the foot (never the middle, owner 2026-10-07), and a
  // critical notice in the middle or, on an OBS feed, the top band.
  const room = roomFor({
    overlay: FLAGS.overlay,
    notice,
    noticeUp,
    boardState: boardDecision.state,
    checkInUp: currentEvent != null,
    leaveUp: leaveNow != null,
  });

  // One celebration at a time. Three milestone paths (night thresholds,
  // per-club, every-Nth) can fire in the same instant — and cluster exactly
  // when the room is busiest, because they're all driven by the same arriving
  // children. Queueing them stops overlapping toasts and doubled confetti.
  const {
    current: celebration,
    enqueue: enqueueCelebration,
    depth: celebrationDepth,
  } = useCelebrationQueue(MILESTONE_TOAST_MS, { held: checkInsHeld });

  // Confetti fires when a celebration reaches the SCREEN, not when it is
  // queued — otherwise a burst would go off for a toast nobody can see yet.
  useEffect(() => {
    if (celebration == null) return;
    // A club's own milestone bursts in that club's colors (#332) — club
    // identity is the strongest signal these kids respond to. The room-wide
    // night/tally milestones keep the house palette, and `off()`/`scaled()`
    // inside fireMilestone still gate everything exactly as before.
    const ofOneClub = celebration.kind === 'club' || celebration.kind === 'kid';
    fireMilestone({
      big: isBigMilestone(celebration.count) || undefined,
      colors: ofOneClub ? getClubPalette(celebration.club).confetti : undefined,
    });
  }, [celebration]);

  // The palette behind the toast's club colors and its wordmark — null for
  // the room-wide 'night' and 'tally' kinds, which carry no club at all.
  const celebrationClub = useMemo(() => (
    (celebration && (celebration.kind === 'club' || celebration.kind === 'kid'))
      ? getClubPalette(celebration.club)
      : null
  ), [celebration]);

  // Club milestones (#36): the printer's live tally broadcasts carry
  // per-club counts; when one club crosses a multiple of
  // clubMilestoneEvery, the milestone toast celebrates that club.
  const clubCountsRef = useRef({});
  const [tallyCounts, setTallyCounts] = useState(/** @type {Record<string, number> | null} */ (null));
  // Same once-per-night rule the night milestones have: a tally that bounces
  // down (an operator undo) and back up must not re-fire the same threshold.
  const firedClubMilestonesRef = useRef(new Set());
  // Once-per-session latch for the "Doors are open" flourish (#335). The
  // per-day localStorage key is the durable half; this is the half that holds
  // inside a single batched burst and on a device with storage blocked.
  const firstOfNightFiredRef = useRef(false);
  // The printer's season broadcast, null until (or unless) one arrives.
  const [printerSeason, setPrinterSeason] = useState(/** @type {string|null} */ (null));
  // Rehearsal mode (#19): true while the printer's tallies carry the
  // rehearsal flag. Unlike printerSeason this DECAYS with the next tally:
  // the moment the operator disarms, the very next broadcast (sent
  // immediately on toggle) drops the flag and the watermark disappears.
  const [rehearsalActive, setRehearsalActive] = useState(false);

  const handleTally = useCallback((tally) => {
    // Unified theming (#18): remember the printer's season broadcast. Kept
    // for the whole session — tallies repeat every ~60s on club nights, so a
    // live printer keeps this fresh, and a dead one leaves the last real
    // choice standing rather than snapping the room back to a guess.
    setPrinterSeason(tally.season ?? null);
    setRehearsalActive(tally.rehearsal === true);
    const prevCounts = clubCountsRef.current;
    for (const { club, count, key } of clubMilestoneCrossings(prevCounts, tally.counts, config.clubMilestoneEvery)) {
      if (!firedClubMilestonesRef.current.has(key)) {
        firedClubMilestonesRef.current.add(key);
        enqueueCelebration({ kind: 'club', club, count });
      }
    }
    clubCountsRef.current = { ...prevCounts, ...tally.counts };
    // The latest per-club counts, as they are, for the per-screen club count
    // in the top-right corner (config.cornerClub).
    setTallyCounts(tally.counts);
    // And for the Journey kiosk next door (same origin), whose Trek small
    // group card counts Trek's children: numbers only (clubCountsStore.js).
    saveClubCounts(tally.counts, tally.at);

    // Reconcile the corner "Tonight" counter to this broadcast's total —
    // the fix for both an operator UNDO on the print server (total drops)
    // and ordinary drift (missed events while offline, a doubled banner).
    // See useTally.js's sync() for the freshness/no-op rules.
    const delta = syncTally(tally.total, tally.at);
    if (delta) {
      tallySyncedRef.current = true;
      // One-step deltas are ordinary broadcast ordering (our bump() and the
      // printer's total crossing paths) and happen constantly — narrating
      // those would be noise, and would teach the room to ignore the note.
      // Only a jump UP is explained (7.15.0): since the count is "here now",
      // a drop is children checking out (Trek and Journey leave at 7:15), not
      // a correction, and saying "synced" every week at 7:15 would be wrong.
      if (delta > 1 && showTallyRef.current) {
        setTallySync({ from: tally.total - delta, to: tally.total });
      }
    }
  }, [config.clubMilestoneEvery, enqueueCelebration, syncTally]);

  // Operator telemetry from the printer (ops events): a red count on the
  // Signal sticker + details in the panels. NEVER a public banner.
  // Only genuine FAILURE types feed the red count — the ops channel also
  // carries good news (update-ok, the printer's post-update health beacon)
  // and neutral pings (canary), and counting those as "printer problems"
  // would raise a standing false alarm after every successful update,
  // training operators to ignore the count real print-failures depend on.
  const [opsFailures, setOpsFailures] = useState([]);
  const recordOps = useCallback((ops) => {
    if (!isPrinterFailure(ops)) return;
    setOpsFailures((prev) => [ops, ...prev].slice(0, OPS_FAILURES_MAX));
  }, []);

  // Lobby "tonight" ticker (#onTonight): aggregate counts across every
  // club, straight from the printer's broadcast. Just the latest
  // snapshot — TonightTicker itself judges staleness against `at`.
  const [tonight, setTonight] = useState(null);
  // Night milestones ride this broadcast because it is the authoritative
  // church-wide count. `prev` starts unset so the FIRST payload is a baseline,
  // never a crossing — a screen that boots at 120 kids must not replay every
  // threshold it missed. `firedRef` makes each threshold once-per-night even if
  // the count bounces (a reconnect re-delivering an older snapshot, say).
  const prevCheckedInRef = useRef(null);
  const firedNightMilestonesRef = useRef(new Set());
  // Handbook progress rides the same broadcast (#358). Awana is about the
  // handbook, but attendance was the only thing the screen ever cheered — and
  // these two counters have been on the wire all along with nothing rendering
  // them. Same baseline-then-crossing rule, one prev-ref and one fired-Set
  // each, so a screen booting at 8pm never replays the evening and a counter
  // that bounces (a reconnect re-delivering an older snapshot) never re-fires.
  const prevBooksRef = useRef(null);
  const firedBookMilestonesRef = useRef(new Set());
  const prevAwardsRef = useRef(null);
  const firedAwardMilestonesRef = useRef(new Set());
  const handleTonight = useCallback((payload) => {
    setTonight(stampReceived(payload));
    // One helper for all three counters: baseline the first payload, then
    // celebrate each threshold at most once tonight.
    const crossings = (value, prevRef, firedRef, thresholds, copy, kind) => {
      if (typeof value !== 'number') return;
      const prev = prevRef.current;
      prevRef.current = value;
      // First sight (prev unset) is a baseline, never a crossing.
      for (const threshold of freshCrossings(prev, value, firedRef.current, thresholds)) {
        firedRef.current.add(threshold);
        enqueueCelebration({ kind, count: threshold, ...copy(threshold) });
      }
    };
    const list = (value, fallback) => (Array.isArray(value) ? value : fallback);
    crossings(payload?.checkedIn, prevCheckedInRef, firedNightMilestonesRef,
      undefined, nightMilestoneCopy, 'night');
    crossings(payload?.booksCompleted, prevBooksRef, firedBookMilestonesRef,
      list(config.bookMilestones, BOOK_MILESTONES), bookMilestoneCopy, 'books');
    crossings(payload?.awardsEarned, prevAwardsRef, firedAwardMilestonesRef,
      list(config.awardMilestones, AWARD_MILESTONES), awardMilestoneCopy, 'awards');
  }, [config.bookMilestones, config.awardMilestones, enqueueCelebration]);

  // Church-authored announcements (#onNotice): the state lives above, beside
  // the room rules it feeds.
  // durationSec 0 is the owner's "Take it down" (routes.md 10.4): clear now.
  const handleNotice = useCallback((payload) => setNotice(payload?.durationSec === 0 ? null : stampReceived(payload)), []);
  const clearNotice = useCallback(() => setNotice(null), []);

  // Every live check-in — real or simulated — plays a banner and bumps
  // tonight's tally. Once the ceremony starts, live banners switch to
  // the calm 'late' treatment (no confetti cannon, ducked chime).
  const handleCheckIn = useCallback((payload, meta) => {
    // DEDUPE FIRST. Two check-in stations, or a recap replaying on its own
    // decrypt chain while the live event is still in flight, can deliver the
    // same id twice. markSeen was already being called here; it was just never
    // consulted, so the second delivery banner'd and counted a second child.
    if (payload.id && hasSeen(payload.id)) return;
    if (payload.id) markSeen(payload.id, payload.at ?? Date.now());
    // Framed (the downstairs classroom, the Journey kiosk), every real
    // check-in goes up to the host page first (lib/embed.js hostCheckin: an
    // allowlist of the sanitized frame, this origin only): each welcomes the
    // clubs of its own moment (a club-night gap's welcome cards).
    if (!CONFIGURE && meta?.countsTowardTally !== false && isEmbedded()) {
      const message = hostCheckin(payload);
      if (message) {
        try { window.parent.postMessage(message, window.location.origin); } catch { /* no parent to tell */ }
      }
    }
    // ?club=<id> (lib/urlFlags.js): one club's lobby; only this club's
    // children are welcomed here.
    if (FLAGS.club && clubKey(payload.club) !== FLAGS.club) return;
    const late = isLatePhase(phaseRef.current);
    const presentation = late ? 'late' : 'live';
    enqueue({ ...payload, presentation });
    // "Doors are open" (#335): the night's FIRST arrival gets a one-time
    // flourish riding behind their ordinary banner. Gated BEFORE bump(),
    // because the gate is "this device has counted nobody yet". All of the
    // judgement — including the phase gate that stops a screen booting at
    // 6:40pm from crowning whoever it sees first — is in lib/firstOfNight.js.
    if (config.firstArrivalMoment !== false
        && !payload.oneOff
        && isFirstOfNight({
          count,
          phase: phaseRef.current,
          presentation,
          // The in-memory latch matters as much as the day key: `count` is
          // React state, so two check-ins delivered in one batch would both
          // read zero, and storage can be blocked outright.
          alreadyFired: firstOfNightFiredRef.current || hasFiredToday(),
        })) {
      firstOfNightFiredRef.current = true;
      markFiredToday();
      enqueueCelebration({
        kind: 'first',
        firstName: payload.firstName,
        club: payload.club,
        count: 1,
        ...firstOfNightCopy(payload.firstName),
      });
    }
    // Milestone wall (#10): the sealed `milestone` flag marks the same nights
    // the label's milestone line fires (5/10/25/50). Live check-ins only —
    // a late-phase arrival gets a quiet banner, not a wall celebration.
    if (payload.milestone && !late) {
      enqueueCelebration({
        kind: 'kid',
        firstName: payload.firstName,
        club: payload.club,
        count: payload.milestone,
      });
    }
    // The optimistic tick. `meta` never comes off the wire (see dispatchEvent):
    // only a locally injected event can carry it, which is what lets Settings'
    // "Preview a check-in" rehearse a banner without moving the lobby's number.
    // The check-in's own `at` lets useTally tell "the printer's total already
    // counts this child" from "this child is new".
    // A one-off name tag (printer 7.18.0) is welcomed and never counted:
    // the printer's tally does not count it either, so a tick here would
    // only be taken back by the next tally.
    if (meta?.countsTowardTally !== false && !payload.oneOff) bump(payload.at);
    // `count` and the config flag are read above, so they belong in the deps.
    // Re-identifying this handler is free: useSocket keeps handlers in a ref
    // it re-points every render, so the live socket never churns.
  }, [enqueue, bump, hasSeen, markSeen, enqueueCelebration, count, config.firstArrivalMoment]);

  // Recap replay: after a reconnect, celebrate the kids this display
  // missed — quiet variant, skipping ids already seen live and anything
  // older than the replay window.
  const handleRecap = useCallback((recap) => {
    // The age window is lobbyEvents.js recapInWindow (the recap's own newest
    // entry, bounded by this clock).
    for (const entry of recapInWindow(recap.entries, { maxAgeMin: config.recapMaxAgeMin, now: Date.now() })) {
      if (hasSeen(entry.id)) continue;
      markSeen(entry.id, entry.at);
      // ?club=<id>: only that club's missed children are replayed (never handed up).
      if (FLAGS.club && clubKey(entry.club) !== FLAGS.club) continue;
      enqueue({ ...entry, presentation: 'replay' });
      bump(entry.at);
    }
  }, [config.recapMaxAgeMin, hasSeen, markSeen, enqueue, bump]);

  // This week's birthday roster (the sealed `birthdays` broadcast). Latest
  // payload wins. The sanitizer emits ONLY { entries } — the wire's `at` is
  // stripped — so there is deliberately no staleness judgement here; the
  // printer rebroadcasts every ten minutes on club night.
  const [birthdays, setBirthdays] = useState(null);

  // The synced slide deck — published once at the check-in machine, mirrored
  // to every screen over the sealed `slides` event, cached for reboots.
  const { deck: syncedDeck, onSlides, forget: forgetSyncedDeck } = useSyncedDeck();

  // Shared settings (contract v6). A sealed `settings` frame from the print
  // server lands in the config store's shared layer (newest publishedAt wins).
  // A shared change made in Settings here is applied at once and sent to the
  // print server SHARE_DEBOUNCE_MS after the last change (a typed field or a
  // run of switches is one publish), from this screen's own shared values.
  const onSettings = useCallback((payload) => { receiveSharedSettings(payload); }, []);
  const [shareStatus, setShareStatus] = useState(/** @type {{state: string, message?: string, rev?: number, at?: number}} */ ({ state: 'idle' }));
  const shareTimerRef = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
  const sync = useSync();
  const syncRef = useRef(sync);
  useEffect(() => { syncRef.current = sync; }, [sync]);
  const pendingShareRef = useRef(/** @type {Record<string, unknown> | null} */ (null));
  const shareSettings = useCallback((sharedValues) => {
    setSharedLocally(sharedValues);
    pendingShareRef.current = sharedValues;
    setShareStatus({ state: 'sending' });
    if (shareTimerRef.current) clearTimeout(shareTimerRef.current);
    shareTimerRef.current = setTimeout(async () => {
      shareTimerRef.current = null;
      const values = pendingShareRef.current;
      if (!values) return;
      // Signed in to the sync service: it is the one home for shared settings,
      // reachable from every screen. Otherwise the print server on this
      // computer, as before.
      const result = syncRef.current.url && syncRef.current.signedIn
        ? await publishViaSync('settings', values)
        : await publishSettings(values, loadPublishToken());
      // A newer change queued while this one was in flight sends itself.
      if (pendingShareRef.current !== values) return;
      pendingShareRef.current = null;
      if (result.ok) {
        setSharedLocally(values, { rev: result.rev, publishedAt: result.publishedAt });
        setShareStatus({ state: 'sent', rev: result.rev, at: Date.now() });
      } else {
        setShareStatus({ state: 'failed', message: result.message });
      }
    }, SHARE_DEBOUNCE_MS);
  }, []);
  useEffect(() => () => { if (shareTimerRef.current) clearTimeout(shareTimerRef.current); }, []);

  const socketHandlers = useMemo(() => ({
    onCheckin: handleCheckIn,
    onRecap: handleRecap,
    onOps: recordOps,
    onTally: handleTally,
    onTonight: handleTonight,
    onNotice: handleNotice,
    onCheckout: handleCheckout,
    onBirthdays: setBirthdays,
    onSlides,
    onSettings,
  }), [handleCheckIn, handleRecap, recordOps, handleTally, handleTonight, handleNotice, handleCheckout, onSlides, onSettings]);

  // In configure mode the socket only feeds Settings' status: no child's
  // name, recap, pickup or notice is ever shown in the booth's Settings window.
  // The settings page's one exception (docs/SETTINGS-OVERHAUL.md section 5): mission
  // control's FIRST NAMES, five at most, newest first, from the same sanitized
  // frames this socket already decrypts. They go to React state here and nowhere
  // else (never storage, never the network), and are cleared on sign-out and
  // when the page has been hidden for MISSION_HIDDEN_CLEAR_MS. The stage itself
  // still shows nothing in configure mode: the handlers below stay no-ops for it.
  const [mission, missionDispatch] = useReducer(reduceMission, undefined, initialMission);
  const liveHandlers = useMemo(() => {
    if (!CONFIGURE) return socketHandlers;
    const quiet = { ...socketHandlers, onCheckin: noop, onRecap: noop, onCheckout: noop, onNotice: noop };
    if (!SETTINGS_PAGE) return quiet;
    return {
      ...quiet,
      onCheckin: (payload) => missionDispatch({ type: 'checkin', payload }),
      onRecap: (payload) => missionDispatch({ type: 'recap', payload }),
      onTally: (payload, meta) => { socketHandlers.onTally?.(payload, meta); missionDispatch({ type: 'tally', payload }); },
    };
  }, [socketHandlers]);
  const { status, lastEventAt, lastCheckinAt, retry, nameStatus, slidesStatus, hasDisplayKey } = useSocket(liveHandlers);
  // A reconnect (any change of the socket's state) forgets the last list: the
  // next one is a baseline, never a room full of "has checked out".
  useEffect(() => { leaveBaselineRef.current = null; }, [status]);
  // The sync service's state (shared settings, the published deck) enters
  // through the same sanitizing dispatch path as a live frame.
  useEffect(() => { if (SETTINGS_PAGE && !sync.signedIn) missionDispatch({ type: 'clear' }); }, [sync.signedIn]);
  useEffect(() => {
    if (!SETTINGS_PAGE) return undefined;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const onVisibility = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'hidden') timer = setTimeout(() => missionDispatch({ type: 'clear' }), MISSION_HIDDEN_CLEAR_MS);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);
  const syncStore = useMemo(() => ({ config: effectiveConfig, overrides, updateConfig }), [effectiveConfig, overrides, updateConfig]);
  useSyncDriver({ handlers: liveHandlers, dispatch: dispatchEvent, store: syncStore });

  // Which typed deck actually renders: the published one wherever this device
  // follows it (the default), else this device's own. An EMPTY published deck
  // is a real deck — the operator cleared the slides everywhere — so it wins
  // too; only "never received one" falls back to the local deck. Either way
  // THIS device's saved video slides stay in the rotation (mergeSyncedDeck):
  // their bytes exist only in this browser and can never ride a publish, so
  // following the published deck must not silently drop them.
  const followPublishedSlides = config.followPublishedSlides !== false;
  const manualSlides = useMemo(
    () => effectiveManualSlides(followPublishedSlides, syncedDeck, config.manualSlides),
    [followPublishedSlides, syncedDeck, config.manualSlides]
  );

  // ── Simulated events go through the SAME sanitizers as real ones ────────────
  // The debug panel used to call these handlers directly, so every fake payload
  // bypassed the privacy boundary — the one thing this app is built around.
  // Routing them through `simulateEvent` means a malformed fake is dropped
  // exactly as a malformed real event would be, which also turns the panel into
  // a live contract check: if a simulator's shape drifts from the allowlist, the
  // button visibly does nothing (and logs why) instead of rendering something
  // the wire could never deliver.
  //
  // `demoActive` drives the on-screen badge. Once set it stays set for the rest
  // of the session: a training run must never be mistakable for real check-ins,
  // and "the badge quietly disappeared" is exactly how that mistake happens.
  const [demoActive, setDemoActive] = useState(false);
  const startBoardDemo = useCallback(() => {
    setDemoActive(true);
    setBoardDemoAt(Date.now());
    setBoardNow(Date.now());
  }, []);
  const simulate = useCallback((event, payload, meta) => {
    setDemoActive(true);
    return simulateEvent(event, payload, socketHandlers, meta);
  }, [socketHandlers]);

  const wakeLockStatus = useWakeLock(config.keepScreenAwake && !CONFIGURE);

  // Kiosk self-heal: reload once if the pipe stays dead far longer than
  // any normal blip (rate-limited; 'off' — never configured — is exempt).
  useWatchdogReload(status, CONFIGURE ? 0 : config.watchdogReloadMin);

  // ── Calendar-aware slides ─────────────────────────────────
  // The local date key ticks over at midnight so "tonight" flips
  // without a reload on a display that runs for days.
  const [todayStr, setTodayStr] = useState(localDateStr);
  useEffect(() => {
    const timer = setInterval(() => {
      const next = localDateStr();
      setTodayStr((prev) => (prev === next ? prev : next));
    }, 60000);
    return () => clearInterval(timer);
  }, []);
  // A new night starts tonight's count and every once-per-night ledger over.
  // These refs lived as long as the page, so a TV left up all week read last
  // Wednesday's count in the corner until the first tally landed, and the
  // 25/50/100 crossings, the club milestones, the handbook thresholds and
  // "Doors are open" fired on the first club night after a load and never
  // again until someone reloaded it. The first broadcast of the new night is
  // a baseline again (prev refs null), never a replay.
  const nightRef = useRef(todayStr);
  useEffect(() => {
    if (nightRef.current === todayStr) return;
    nightRef.current = todayStr;
    rolloverTally();
    clubCountsRef.current = {};
    setTallyCounts(null);
    firedClubMilestonesRef.current = new Set();
    firstOfNightFiredRef.current = false;
    prevCheckedInRef.current = null;
    firedNightMilestonesRef.current = new Set();
    prevBooksRef.current = null;
    firedBookMilestonesRef.current = new Set();
    prevAwardsRef.current = null;
    firedAwardMilestonesRef.current = new Set();
  }, [todayStr, rolloverTally]);

  // "Birthday this Friday!" for an arriving child the roster says has a
  // birthday later this week. Pure matcher — see src/lib/birthdayWeek.js for
  // the fail-safe rules (ambiguity, or a birthday today, means no ribbon).
  const today = useMemo(() => new Date(`${todayStr}T00:00:00`), [todayStr]);
  const birthdayWeekRibbon = useMemo(() => {
    if (config.showBirthdayWeekRibbon === false) return null;
    if (!currentEvent || !birthdays) return null;
    return birthdayRibbon(currentEvent.firstName, currentEvent.club, birthdays.entries, today);
  }, [config.showBirthdayWeekRibbon, currentEvent, birthdays, today]);

  const calendar = useCalendar(config);
  // The corner chip works over any background source — it's an overlay
  // widget like the clock, not part of the slide rotation.
  const showWeatherChip = config.showWeatherChip !== false;
  // Fetch when ANY consumer needs it — the chip, weather theming, or the
  // auto particle effect. Gating solely on the chip meant hiding one small
  // corner widget silently stopped the whole room responding to the
  // weather — a coupling nobody would guess.
  const weatherTheme = config.weatherTheme === true;
  const particleAuto = config.particleEffect === 'auto';
  // The snow slide's phone shows the weather too, so it asks while that
  // slide can air.
  const snowPhone = snowPhoneAsksWeather(config, todayStr);
  const weather = useWeather(config, (showWeatherChip || weatherTheme || particleAuto || snowPhone) && !FLAGS.overlay);
  const lobbyLive = useMemo(() => ({ weather, checkedIn: count }), [weather, count]);
  // 'auto' matches the particles to the sky outside: snowfall when it's
  // snowing, rainfall when it's raining or storming, nothing otherwise
  // (and nothing when the weather is unknown — no location, dead API).
  const particleEffect = particleAuto ? autoParticleEffect(weather) : config.particleEffect;

  // Memoized on exactly the inputs buildCalendarSlides reads: a fresh array
  // every render used to restart the background slideshow's hold timer on
  // every App re-render (i.e. every event), stalling the show on one slide.
  const { calendarEnabled, calendarWelcomeText, calendarShowWelcome, calendarShowNextWeek, calendarShowRemaining } = config;
  const calendarSlides = useMemo(() => calendarSlidesFor({
    enabled: calendarEnabled,
    events: calendar.events,
    todayStr,
    specialDates,
    welcomeText: calendarWelcomeText,
    showWelcome: calendarShowWelcome,
    showNextWeek: calendarShowNextWeek,
    showRemaining: calendarShowRemaining,
  }), [calendarEnabled, calendar.events, todayStr, specialDates, calendarWelcomeText, calendarShowWelcome, calendarShowNextWeek, calendarShowRemaining]);

  // This season's event promos (src/lib/promos.js) — ONE slot however many are
  // live today, because three extra slides in an eight-slide deck would turn
  // the lobby TV into a poster wall. Same rules as the calendar slides above:
  // derived fresh from (events, today, config), never persisted, never
  // published, and memoized on exactly the inputs it reads so the background's
  // hold timer isn't restarted by every check-in.
  const seasonPromos = config.seasonPromos;
  // The snow-alerts slide's forecast (src/lib/snowAlerts.js): asked for only in
  // the snow season and only when the slide could show, so a September screen
  // or an OBS overlay never calls the weather API for it.
  const promosOn = promosAreOn(calendarEnabled, seasonPromos);
  const snowForecast = useSnowForecast(config, wantsSnowForecast(promosOn, todayStr, FLAGS.overlay));
  const promoSlot = useMemo(
    () => promoSlotFor(calendar.events, todayStr, { specialDates, enabled: promosOn, snowForecast }),
    [calendar.events, todayStr, specialDates, promosOn, snowForecast]
  );

  // A preview runs for its promo's own hold, and Escape ends it early (a click
  // on it does too). Each start is a new `at`, so the poster replays from the
  // top even when the same one is picked twice.
  const startPromoPreview = useCallback((key) => {
    const promo = previewPromo(key, calendar.events, todayStr, specialDates);
    if (promo) setPromoPreview({ promo, at: Date.now() });
  }, [calendar.events, todayStr, specialDates]);
  const stopPromoPreview = useCallback(() => setPromoPreview(null), []);
  useEffect(() => {
    if (!promoPreview) return undefined;
    const ms = Math.max(1, Number(promoPreview.promo.durationSec) || 15) * 1000;
    const timer = setTimeout(() => setPromoPreview(null), ms);
    const onKey = (e) => { if (e.key === 'Escape') setPromoPreview(null); };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [promoPreview]);

  // One array identity per (calendarSlides, promoSlot) pair, for the same
  // reason the memo above exists — see BackgroundIframe's `deck`.
  const autoSlides = useMemo(
    () => autoSlideDeck(calendarSlides, promoSlot),
    [calendarSlides, promoSlot]
  );

  // Per-slide show windows (#345): a dated announcement retires itself. The
  // filter runs on the LOCAL date key (`todayStr`, which already ticks over at
  // midnight without a reload) — never a toISOString()-derived one, which in a
  // US-Eastern evening is already tomorrow, i.e. exactly club hours.
  //
  // A deck whose every slide has expired becomes [], and the background
  // concatenates the calendar slides SEPARATELY, so the screen falls back to
  // those (or to the welcome placeholder with the calendar off) — never to a
  // blank background. The editor is deliberately NOT filtered: it shows every
  // slide with an "expired" badge, because the operator has to be able to see
  // and fix the one that stopped showing.
  const shownManualSlides = useMemo(
    () => visibleManualSlides(manualSlides, todayStr),
    [manualSlides, todayStr]
  );

  // Thin the confetti while a rush is draining so cheap signage sticks
  // hold 60fps with banners firing back-to-back.
  useEffect(() => {
    setConfettiLoad(pending > BURST_THRESHOLD);
  }, [pending]);

  // Room-wide confetti intensity (Settings → Screen & corner).
  useEffect(() => {
    setConfettiLevel(CONFIGURE ? 'off' : config.confettiLevel);
  }, [config.confettiLevel]);

  // Tally milestones: every Nth check-in gets a room-wide celebration.
  // Fires only on a genuine increment, so restoring a saved tally on
  // page load can't re-celebrate. Goes through the same queue as the club and
  // night milestones so it can't overlap them.
  const prevCountRef = useRef(count);
  useEffect(() => {
    const prev = prevCountRef.current;
    prevCountRef.current = count;
    // A tally reconciliation (see handleTally) jumps `count` directly,
    // bypassing bump() — never a real one-at-a-time arrival, so it must
    // never read as crossing a milestone.
    if (tallySyncedRef.current) { tallySyncedRef.current = false; return; }
    if (!tallyMilestoneHit(prev, count, config.milestoneEvery)) return;
    enqueueCelebration({ kind: 'tally', count });
  }, [count, config.milestoneEvery, enqueueCelebration]);

  const [settingsOpen, setSettingsOpen] = useState(CONFIGURE);
  const [slideEditorOpen, setSlideEditorOpen] = useState(false);
  // Settings remembers its tab for the session, and the slide editor knows
  // whether it was opened from Settings → Slides (so closing it goes back
  // there) or straight from the keyboard (so closing it returns to the stage).
  const [settingsTab, setSettingsTab] = useState(null);
  // The settings page: a lobby TV opened from Screens, edited in the Worker.
  const [managedScreen, setManagedScreen] = useState(null);
  const backToScreens = () => { setSettingsTab('screens'); setManagedScreen(null); };
  const [editorFromSettings, setEditorFromSettings] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  // The slide editor goes back where it came from: Settings → Slides & look,
  // or the stage when the keyboard opened it.
  const closeSlideEditor = () => {
    setSlideEditorOpen(false);
    if (editorFromSettings) {
      SettingsPanel.preload();
      setEditorFromSettings(false);
      setSettingsTab('slides');
      setSettingsOpen(true);
    }
  };
  // Settings open = a volunteer at work: the panels it opens (the slide
  // editor, the debug panel) are fetched now, so they open at once.
  useEffect(() => {
    if (!settingsOpen) return;
    SlideEditorPanel.preload();
    if (!CONFIGURE) DebugPanel.preload();
  }, [settingsOpen]);

  // The first-run card: still wanted on this screen (useSetupCard), and does
  // the room have space for it right now (setupUp: not over a name, a poster,
  // an open panel, the pickup board, a critical notice or the tonight strip,
  // all of which are what the lobby is showing). It stands in the foot of the
  // lobby, the pickup board's seat.
  // The strip's clock is kept here and handed to it, so the card and the strip
  // agree at the moment the feed goes stale.
  const [tonightNow, setTonightNow] = useState(() => Date.now());
  useEffect(() => {
    const advance = () => setTonightNow(Date.now());
    advance();
    const t = setInterval(advance, 30000);
    return () => clearInterval(t);
  }, [tonight]);   // re-stamp on new data so a fresh payload is never judged aged
  // The strip rides the waves in the foot, where the pickup board stands: it
  // steps away while the board is up, as it does for a name.
  const tickerActive = tickerIsActive({ checkInUp: currentEvent != null, held: checkInsHeld, room });
  const setupCard = useSetupCard({ status, hasDisplayKey });
  // Two of the facts setupUp judges flip before the room can see it, and the
  // card is judged by what the room sees:
  //  - A name is up from the moment its run starts until its exit has
  //    finished, and the gap between runs is never shorter than that exit
  //    (useCheckInQueue), so "a name is up" is the child on screen OR the gap.
  //    Judged by `currentEvent` alone the card came back over a name still
  //    leaving. And it does not come back the instant the room is clear
  //    either: on a screen that is not keyed yet the card is always due, and
  //    names a few seconds apart had it popping in for a second between
  //    every pair, so it waits SETUP_CARD_QUIET_MS after the last name.
  //  - A held slide's flag drops the moment the slideshow moves on, while its
  //    poster is on screen until the stinger's wave covers the screen (and the
  //    wave itself until it has gone): the card waits out the whole stinger
  //    (STINGER_SEC) before it comes back. The flag's other edge is
  //    immediate: the card goes when a held slide is chosen (ManualSlideshow
  //    reports it in the same commit that mounts the slide). Zero animation
  //    has no stinger, so no wait.
  const setupNameUp = useLinger(currentEvent != null || checkInGap, SETUP_CARD_QUIET_MS);
  const setupHeld = useLinger(checkInsHeld, config.reduceMotion === true ? 0 : Math.ceil(STINGER_SEC * 1000));
  const setupSeated = setupUp({
    due: setupCard.due,
    overlay: FLAGS.overlay,
    panelOpen: settingsOpen || slideEditorOpen,
    checkInUp: setupNameUp,
    held: setupHeld,
    ticker: !FLAGS.overlay && config.showTonightTicker === true && tickerActive && tickerRows(tonight, tonightNow).length > 0,
    room,
  });

  // If the realtime pipe drops mid-club, surface the status dot even when
  // it's switched off in settings — a dead connection must never be
  // silent. A short grace period ignores ordinary reconnect blips.
  const [droppedLong, setDroppedLong] = useState(false);
  useEffect(() => {
    const disconnected = status === 'disconnected';
    const timer = setTimeout(() => setDroppedLong(disconnected), disconnected ? DROPPED_GRACE_MS : 0);
    return () => clearTimeout(timer);
  }, [status]);
  // The names arrive encrypted (see src/lib/envelope.js). A screen that can't
  // read them looks EXACTLY like a quiet night — connected, clock ticking,
  // weather fine, counts even climbing — which is the worst failure available:
  // nobody investigates a quiet night. So a name fault forces the sticker up
  // regardless of the setting, and says which half is broken, because the fixes
  // differ (paste the key on this screen vs. set one on the print server).
  const nameFault = nameStatus && nameStatus !== 'ok';
  const nameFaultText = nameFaultWords(nameStatus);

  // Cross-check for the other direction: if the PRINT SERVER is the side
  // missing its key, it publishes nothing on the name events, so this screen
  // sees a climbing tally and no banners. Without this, that is indistinguishable
  // from a quiet night, and the one-pager would send nobody anywhere.
  // Only a rise this screen SEES, unnamed (src/lib/countsWithoutNames.js): a
  // replayed frame from last club night, or a screen opened after the names
  // went by, is not the fault.
  const [countWatch, setCountWatch] = useState(COUNT_WATCH_START);
  const [watchedTonight, setWatchedTonight] = useState(null);
  if (tonight !== watchedTonight) {
    setWatchedTonight(tonight);
    if (tonight) {
      setCountWatch(watchCounts(countWatch, {
        count: tonight.checkedIn || 0,
        fresh: isFresh(stampOf(tonight), TONIGHT_STALE_MS, tonight.receivedAt ?? tonightNow),
        now: tonight.receivedAt ?? tonightNow,
        lastNameAt: lastCheckinAt,
      }));
    }
  }
  const [watchedNameAt, setWatchedNameAt] = useState(lastCheckinAt);
  if (lastCheckinAt !== watchedNameAt) {
    setWatchedNameAt(lastCheckinAt);
    if (lastCheckinAt) setCountWatch(nameArrived(countWatch));
  }
  const countsWithoutNames = countsWithoutNamesNow(countWatch, {
    now: tonightNow,
    afterMs: COUNTS_WITHOUT_NAMES_MS,
    fresh: isFresh(stampOf(tonight), TONIGHT_STALE_MS, tonightNow),
    nameFault: Boolean(nameFault),
  });

  // Layer-fault ledger. Every stage layer sits behind an ErrorBoundary keyed on
  // boardNow, so a crashed layer is retried every 30 s instead of being fenced
  // off for the rest of the display's uptime — and each crash is recorded here,
  // because a silently dead background is indistinguishable from a quiet
  // night. A fault stays "active" (forces the Signal sticker, shows in
  // Settings) for LAYER_FAULT_SHOW_MS after its LAST crash: a persistent fault
  // re-crashes on every retry and never ages out; a one-off disappears.
  const [layerFaults, setLayerFaults] = useState({});   // { [label]: { count, lastAt } }
  const recordLayerFault = useCallback((label) => {
    setLayerFaults((prev) => ({ ...prev, [label]: { count: (prev[label]?.count ?? 0) + 1, lastAt: Date.now() } }));
  }, []);
  const activeLayerFaults = useMemo(
    () => activeFaults(layerFaults, boardNow, LAYER_FAULT_SHOW_MS),
    [layerFaults, boardNow]
  );
  // Self-updating (see CLAUDE.md, "Self-updating pages"): a lobby TV that has
  // been running for days picks up a new deploy on its own, but only while the
  // room has nothing to look at. Busy is deliberately generous: a banner (and
  // therefore any birthday ribbon riding on it), a milestone or doors-open
  // celebration, the checkout board in any visible state, an open panel, or an
  // event that landed in the last few seconds. There is no deadline, so a rush
  // simply postpones the reload until it is over.
  //
  // Anyone WAITING counts too: behind a slide that holds check-ins the stage
  // can be empty for minutes with children in line, and the line lives only
  // in memory. A reload then would drop them for good (they are already
  // marked seen, so no recap brings them back).
  const buildReloadBusy = useCallback(() => reloadIsBusy({
    checkInUp: currentEvent != null,
    pending,
    celebrationUp: celebration != null,
    celebrationsQueued: celebrationDepth(),
    settingsOpen,
    previewUp: coverUp,
    slideEditorOpen,
    debugOpen,
    boardVisible: boardDecision.state !== BOARD_HIDDEN,
    leaveUp: leaveNow != null,
    lastEventAt,
    now: Date.now(),
    quietMs: BUILD_QUIET_MS,
  }), [currentEvent, pending, celebration, celebrationDepth, settingsOpen, coverUp, slideEditorOpen, debugOpen,
    boardDecision.state, leaveNow, lastEventAt]);
  useBuildReload(buildReloadBusy);

  // Printer trouble also forces the sticker visible — a kid at the door
  // with no label is exactly when the operator needs the red count.
  const showStatus = shouldShowStatus({
    configured: config.showConnectionStatus,
    status,
    layerFaults: activeLayerFaults.length,
    droppedLong,
    opsFailures: opsFailures.length,
    nameFault: Boolean(nameFault),
    countsWithoutNames,
  });

  // The corner info: ONE item at a time (the time, tonight's tally or the
  // weather), moving on with each slide load and frozen in between (owner,
  // 2026-09-27; src/lib/cornerInfo.js). The typed slideshow reports its
  // loads; any other background (a PowerPoint embed, a video, a lone
  // slide, the placeholder) cannot, so a timer on the slideshow delay
  // stands in. The connection status sticker is not in the rotation: a
  // dead pipe must never be silent, so it never waits its turn.
  const clearShownCorrection = useCallback((shown) => {
    if (shown?.correction) setTallySync((latched) => (latched === shown.correction ? null : latched));
  }, []);
  // A problem sticker that runs past one line (a fault in words on its strip,
  // or the retry wording beside the printer's count) stands tall enough that
  // a chip stacked under it would reach down into a raised headline (the
  // stack must end by 14u, where a raised wide row starts: OVERLAY.stack).
  // Measured, since how the words wrap depends on the screen. While it
  // stands that tall the top slot's item sits out: the weather leaves the
  // rotation (the bottom corner has no room for a long sky either, beside
  // the ticker's widest night), and the WAITING chip comes down to the
  // bottom corner, which a held slide leaves empty. The problem outranks the
  // sky.
  const stickerRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const stickerTall = useTallerThan(stickerRef, OVERLAY.stack.stickerMax, showStatus);
  // The per-screen club count (owner, 2026-10-08; Settings → Screen & corner
  // → This TV → "Club count (upper right)"): one club's "here now" count from
  // the latest tally, all night, in the top slot under the status sticker.
  // It takes the slot the weather and the WAITING chip share, so they move
  // out exactly as they do for a tall sticker (the weather leaves the
  // rotation, the WAITING chip comes down to the bottom corner), and the
  // stack keeps its 14u budget. A tall sticker (a fault strip) outranks it,
  // as it outranks the sky. Hidden until a tally has the club in it.
  const { count: cornerClubCount, chipUp: clubChipUp, topTaken } = cornerSlots({
    overlay: FLAGS.overlay, cornerClub: config.cornerClub, tallyCounts, stickerTall,
  });
  const slideDriven = isSlideDriven({
    overlay: FLAGS.overlay,
    backgroundSource: config.backgroundSource,
    autoCount: autoSlides.length,
    manualCount: shownManualSlides.length,
  });
  const corner = useCornerItem(
    // What the rotation may show (lobbyDirector.js cornerSources).
    cornerSources({ config, count, weather, showWeatherChip, topTaken, tallySync, boardDecision, boardData, pickup }),
    {
      fallbackMs: cornerFallbackMs(slideDriven, config.slideshowDelaySec),
      // The correction has reached the corner, frozen into this tally
      // snapshot, so the latch is spent; the next tally load is ordinary.
      onShown: clearShownCorrection,
    },
  );
  const advanceCorner = corner.advance;
  // A slide that holds check-ins is not a load the corner counts: it is
  // hidden there, so an item picked on it would be skipped unseen (with the
  // default three-slide deck and three items, the same one every lap). The
  // first ordinary slide after it picks up where the corner left off.
  const handleSlide = useCallback((info) => {
    setSlideInfo(info);
    if (info.key !== 'none' && !info.special) advanceCorner();
  }, [advanceCorner]);
  // Hidden while a slide holds check-ins: a poster is its own moment. (While
  // a name is up the slideshow is paused, so the corner simply holds still;
  // the check-in wave covers the bottom corner anyway.)
  const cornerHidden = FLAGS.overlay || checkInsHeld;
  // While the sticker stands tall (stickerTall, above) the top slot has no
  // room under it: the weather sits out, and one already up leaves now
  // rather than at the next load.
  const cornerItem = visibleCornerItem(corner.item, topTaken);

  // The sync note is opt-out (#351). Gated at RENDER, not at capture, so
  // turning it off in Settings hides one that is already up rather than
  // leaving a stuck note behind.
  const syncNote = config.showTallySyncNote !== false;

  // Themed skin — 'auto' resolves by season, and because it derives
  // from todayStr it rolls over at midnight without a reload, like
  // everything else date-derived. Noon avoids TZ edge cases.
  // Tonight's calendar title lets 'auto' pick Easter / VBS / Thanksgiving,
  // none of which a month table can express (floating, lunar, or
  // church-scheduled). Falls back to the month when nothing matches.
  // `.tonight`, not `.today` — deriveClubInfo has never returned a `today`
  // key, so this read was always undefined and the calendar half of 'auto'
  // (Easter / VBS / Thanksgiving by title) silently never fired. Passing
  // specialDates too means a cancelled night can't dress the room for an
  // event that isn't happening.
  const tonightTitle = useMemo(
    () => tonightTitleOf(calendar.events, todayStr, specialDates),
    [calendar.events, todayStr, specialDates],
  );
  // April Fools (#21): screens only, and only does anything on April 1st —
  // a toggle left on all year is inert 364 days. The settings panel
  // counter-rotates in CSS so the operator can always find the exit.
  const aprilFools = isAprilFools(config.aprilFools === true, todayStr);

  const skin = resolveSkin(
    config.nightTheme,
    new Date(`${todayStr}T12:00:00`),
    tonightTitle,
    config.followPrinterTheme !== false ? printerSeason : null,
  );

  // The season picks the scene; the weather only adds atmosphere over it, so a
  // deliberately-chosen VBS skin doesn't vanish because it started raining.
  const sceneTheme = sceneForSkin(skin);
  const skinAccents = SKIN_TABLE[skin] ?? null;

  // Season-shaped confetti (#340) — the sibling of the setConfettiLevel effect
  // above, keyed on the RESOLVED skin so 'auto' seasons and the printer's
  // season broadcast both reach the bursts. A skin with no profile (or 'none')
  // clears it, so the room-wide milestones go back to the house palette. Level
  // 'off', the rush thinner and reduced-motion all still gate every burst
  // inside fireMilestone — a season is never a reason to override those.
  useEffect(() => {
    setConfettiSkin(SKIN_TABLE[skin]?.confetti ?? null);
  }, [skin]);
  const mood = useMemo(
    () => (weatherTheme ? weatherMood(weather) : { cozy: false, dim: 1, reason: 'off' }),
    [weatherTheme, weather],
  );

  // Keyboard shortcuts for the hidden panels. Ctrl+Shift+X is the panic
  // switch — S/E/D were taken. Settings and the slide editor are OPEN-only:
  // both hold unsaved edits, so their own (guarded) Cancel/Escape is the one
  // way out — a second press of the chord must never throw work away. The
  // Debug panel holds nothing, so it stays a toggle. Nothing fires while the
  // operator is typing in a field (Ctrl+Shift+X inside a slide textarea used
  // to flip panic mode).
  useEffect(() => {
    const onKey = (e) => {
      const action = shortcutFor(e);
      if (!action) return;
      e.preventDefault();
      if (action === 'debug') {
        DebugPanel.preload();
        setDebugOpen((v) => !v);
      } else if (action === 'settings') {
        SettingsPanel.preload();
        setSettingsTab(null);
        setSettingsOpen(true);
      } else if (action === 'editor') {
        SlideEditorPanel.preload();
        setEditorFromSettings(false);
        setSlideEditorOpen(true);
      } else {
        updateConfig({ panicMode: !storedConfig.panicMode });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [updateConfig, storedConfig.panicMode]);

  // Double-click anywhere on the stage toggles fullscreen — easier than
  // hunting for F11 on a TV keyboard or remote-desktop session. Panels
  // stop the event so double-clicking inside a text field stays normal.
  const stageRef = useRef(null);
  const toggleFullscreen = useCallback(() => {
    // Embedded (the Journey Display kiosk's iframe), fullscreening the stage
    // fullscreens only the FRAME: it covers Journey's own corner buttons and
    // the operator has no way back out. So hand the request up and let the
    // parent fullscreen its whole page instead. The message carries nothing
    // but its type, and the Journey side checks that event.source is its own
    // iframe before acting on it. Standalone behaviour is untouched.
    if (isEmbedded()) {
      window.parent.postMessage({ type: EMBED_FULLSCREEN_MESSAGE }, '*');
      return;
    }
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      stageRef.current?.requestFullscreen?.().catch(() => {});
    }
  }, []);

  const previewCheckIn = useCallback((p) => simulate('checkin', p, { countsTowardTally: false }), [simulate]);
  const resetTonight = useCallback(() => {
    // Resetting the counter is also the documented way to give back a
    // "Doors are open" flourish an afternoon rehearsal consumed (#335).
    clearFirstOfNight();
    firstOfNightFiredRef.current = false;
    resetTally();
  }, [resetTally]);

  // Configure mode: the page shows only Settings, on a plain ground.
  useEffect(() => {
    if (!CONFIGURE) return undefined;
    document.documentElement.classList.add('configure-mode');
    // A background video saved here lives in this profile's IndexedDB; tell
    // the live screen to read it again.
    const relayVideo = () => relayToScreen('lobby', 'media-changed');
    window.addEventListener(BACKGROUND_VIDEO_CHANGED_EVENT, relayVideo);
    return () => {
      document.documentElement.classList.remove('configure-mode');
      window.removeEventListener(BACKGROUND_VIDEO_CHANGED_EVENT, relayVideo);
    };
  }, []);

  // The live screen: do what a configure page beside it asks, exactly as its
  // own Settings buttons would. Never in configure mode itself, and never in
  // Journey's embedded copy (a lobby relay is for the lobby screen).
  useEffect(() => {
    if (CONFIGURE || (isEmbedded() && !SHOWCASE)) return undefined;
    return listenForRelay('lobby', RELAYED, (action, data) => {
      if (action === 'preview-checkin') previewCheckIn(data);
      else if (action === 'preview-promo') {
        const key = data && typeof data === 'object' ? /** @type {{ key?: unknown }} */ (data).key : null;
        if (typeof key === 'string' && PROMO_KEYS.has(key)) startPromoPreview(key);
      }
      else if (action === 'reset-tally') resetTonight();
      else if (action === 'board-demo') startBoardDemo();
      else if (action === 'media-changed') window.dispatchEvent(new Event(BACKGROUND_VIDEO_CHANGED_EVENT));
    });
  }, [previewCheckIn, resetTonight, startBoardDemo, startPromoPreview]);

  // Journey's embedded copy passes the sync service's doorbell up to the
  // kiosk page, which has no live channel of its own, so a change or a
  // command from /settings → Journey reaches it in a second or two instead of
  // at its next poll (lib/embed.js hostDoorbell: the word and a screen id,
  // nothing else; this origin only).
  useEffect(() => {
    if (CONFIGURE || !isEmbedded()) return undefined;
    return onSyncDoorbell((what, payload) => {
      const message = hostDoorbell(what, payload);
      if (!message) return;
      try { window.parent.postMessage(message, window.location.origin); } catch { /* no parent to tell */ }
    });
  }, []);

  // Managed from /settings (ROADMAP.md#settings-page, phase 2): a real screen registers
  // with the sync Worker, follows its own settings there as its device layer,
  // and does what /settings asks of it, as its own buttons would. The preview
  // picks its own sample name: nothing name-shaped crosses the wire for it.
  useScreenSync({
    kind: 'lobby',
    enabled: !CONFIGURE && !isEmbedded(),
    overrides,
    replaceConfig,
    defaultName: FLAGS.overlay ? 'OBS overlay' : 'Lobby TV',
    onAction: (action) => {
      if (action === 'preview-checkin') previewCheckIn({ firstName: pick(SAMPLE_NAMES), club: 'Sparks' });
      else if (action === 'reset-tally') resetTonight();
      else if (action === 'board-demo') startBoardDemo();
    },
  });

  // Overlay mode (?overlay=1): transparent stage with banners + confetti
  // only, for use as an OBS browser source / ProPresenter web overlay.
  // The html element also needs the class so nothing paints behind the
  // stage; ?chroma=RRGGBB swaps transparency for a solid key color.
  const { overlay, chroma } = FLAGS;
  useEffect(() => {
    if (!overlay) return undefined;
    document.documentElement.classList.add('overlay-mode');
    return () => document.documentElement.classList.remove('overlay-mode');
  }, [overlay]);

  // While a child's banner holds the stage, the background scene breathes that
  // child's own club colour (#349) — so a Cubbies arrival and a T&T arrival no
  // longer paint the same wall. Off unless the operator asked for it, and every
  // "don't" (overlay feed, panic mode, a video or uploaded PowerPoint that is
  // not ours to tint) lives in the pure clubTintFor(). The fade back out is a
  // plain CSS transition in app.css, so .zero-animation-mode already reduces it
  // to an instant snap on the low-power kiosk.
  const clubTint = useMemo(() => clubTintFor({
    enabled: config.clubTintBackground === true,
    active: currentEvent != null,
    overlay,
    panicMode: config.panicMode,
    backgroundSource: config.backgroundSource,
    club: currentEvent?.club,
  }), [config.clubTintBackground, config.panicMode, config.backgroundSource, currentEvent, overlay]);

  // Zero-animation mode (config.reduceMotion — see ?lowPower=1 in
  // urlFlags.js): ZeroAnimationContext above only reaches framer-motion
  // components built with M.* from src/lib/motion.jsx. Plain CSS
  // @keyframes/transition rules elsewhere in app.css (the doodle-scene
  // drift, the connecting-status pulse, the cozy-filter fade, and any
  // future one added the same way) don't go through React at all, so
  // they need their own, equally durable kill switch: this class plus
  // the blanket `.zero-animation-mode, .zero-animation-mode * { animation:
  // none !important; transition: none !important; }` rule in app.css
  // together disable EVERY CSS animation/transition on the page, current
  // or future, without needing each one individually exempted.
  useEffect(() => {
    if (!config.reduceMotion) return undefined;
    document.documentElement.classList.add('zero-animation-mode');
    return () => document.documentElement.classList.remove('zero-animation-mode');
  }, [config.reduceMotion]);

  // Embedded (the Journey kiosk's iframe), the host's own buttons float over
  // this page's bottom-right corner, and nothing in here can paint over a
  // parent's element. The html.embedded rules in app.css keep the corner
  // chip, the ticker, a long name and the operator's panels out of the
  // host's column there (src/lib/embed.js has the geometry). Standalone, no
  // class and no rule: the layout is exactly what it always was.
  useEffect(() => {
    if (!isEmbedded()) return undefined;
    document.documentElement.classList.add('embedded');
    return () => document.documentElement.classList.remove('embedded');
  }, []);

  // Who holds which part of the room (rebrand stage 4b-2; `room` above, the
  // bands in src/lib/overlayFit.js). The slide copy steps back behind a
  // critical notice in the middle, the way it does for a name; the pickup
  // board in the foot leaves it where it is. The demo,
  // rehearsal and simplified-mode tabs hanging from the top edge push the
  // top band down under them.
  // The simplified-mode confirmation hangs there too: at the bottom it sat
  // on the tonight strip, which simplified mode keeps.
  const { panicUp, flagCount, flagsUp } = flagTabs({
    overlay, panicMode: config.panicMode, demoActive, rehearsalActive,
  });
  const bandNoticeUp = noticeUp && notice?.level !== 'critical';
  // A promo poster is full-bleed art with its own header where the band
  // sits: a band notice steps aside for it as it does for a toast (a poster
  // always moves on, since it holds check-ins), and comes back after.
  const posterHeld = posterIsHeld({ checkInsHeld, slidePoster: slideInfo.poster, previewUp: coverUp });
  const stageClass = stageClassName({
    overlay, aprilFools, checkInUp: currentEvent != null, critical: room.critical, flagsUp,
  });

  // Arrivals held behind a poster or a marked slide: say how many are
  // waiting, so the room knows the names are coming. It lives in the top
  // slot under the status sticker, or in the bottom corner while the sticker
  // stands tall (see stickerTall).
  const waitingChip = (
    <AnimatePresence>
      {checkInsHeld && pending > 0 && (
        <M.div
          key="waiting"
          className="corner-chip corner-chip--waiting"
          role="status"
          aria-label={`${pending} ${pending === 1 ? 'child' : 'children'} waiting to be welcomed`}
          initial={WAITING_ENTER.initial}
          animate={WAITING_ENTER.animate}
          exit={{ opacity: 0, scale: 0.9, transition: { duration: DUR.exit, ease: EASE.exit } }}
          transition={WAITING_ENTER.transition}
        >
          <StepChip label="WAITING" value={pending} size="calc(2.5 * min(1vw, 1.7778vh))" />
        </M.div>
      )}
    </AnimatePresence>
  );

  return (
    // "user" makes framer-motion honor the OS-level prefers-reduced-motion
    // setting for every transform animation (the CSS media query and
    // canvas-confetti already do); opacity fades remain so banners still
    // appear either way. config.reduceMotion forces "always" regardless of
    // the OS setting — needed because a kiosk Chromium rarely has that OS
    // setting exposed/set even on hardware that badly needs it reduced.
    // ZeroAnimationContext goes further still: MotionConfig's
    // reducedMotion only ever gates transform/positional values, never
    // opacity — see src/lib/motion.jsx. Every M.* component in the tree
    // below (and any future one built the same way) reads this directly,
    // so config.reduceMotion === true means truly zero animation, not
    // just reduced transforms.
    <ZeroAnimationContext.Provider value={config.reduceMotion}>
    <LobbyLiveContext.Provider value={lobbyLive}>
    <MotionConfig reducedMotion={config.reduceMotion ? 'always' : 'user'}>
    <div
      className={stageClass}
      data-skin={skin !== 'none' ? skin : undefined}
      style={{
        ...(chroma ? { background: chroma } : null),
        // Accent pair straight from SKIN_TABLE — see the note in app.css.
        ...(skinAccents ? { '--skin-a': skinAccents.a, '--skin-b': skinAccents.b } : null),
      }}
      ref={stageRef}
      onDoubleClick={toggleFullscreen}
    >
      {/* Every stage layer sits behind its own crash fence: a broken
          background or corner widget disappears quietly instead of
          white-screening the whole display mid-club. */}
      {!overlay && (
        <ErrorBoundary label="background" eventKey={`${config.backgroundSource}|${boardNow}`} onError={() => recordLayerFault('background')}>
          <BackgroundIframe
            url={config.powerpointEmbedUrl}
            slideshowDelaySec={config.slideshowDelaySec}
            useLocalSlideshow={config.useLocalSlideshow}
            backgroundSource={config.backgroundSource}
            manualSlides={shownManualSlides}
            calendarSlides={autoSlides}
            sceneTheme={sceneTheme ?? 'sky'}
            cozy={mood.cozy}
            dim={mood.dim}
            clubTint={clubTint}
            reduceMotion={config.reduceMotion}
            paused={currentEvent != null}
            onSlide={handleSlide}
          />
        </ErrorBoundary>
      )}

      {/* Settings → Slides → "Preview the promos": the poster over the slideshow,
          on this TV only, for its own hold. A click anywhere ends it. */}
      {previewUp && (
        <ErrorBoundary label="promo-preview" onError={stopPromoPreview}>
          <div className="lobby-preview" onClick={stopPromoPreview} data-testid="promo-preview">
            <PromoSlide key={promoPreview.at} promo={promoPreview.promo} />
            <button type="button" className="lobby-preview__stop" onClick={stopPromoPreview}>
              Preview · click or press Esc to stop
            </button>
          </div>
        </ErrorBoundary>
      )}

      {/* The opening ceremony, mirrored (owner 2026-10-19): the projector's own
          page, loaded hidden a little before 6:00, turned over to the moment
          its ceremony starts and handed back when T&T game time does. */}
      <AnimatePresence>
      {mirrorMounted && (
        <ErrorBoundary key="ceremony-mirror" label="ceremony-mirror" onError={() => recordLayerFault('ceremony-mirror')}>
          <M.div
            className="lobby-mirror"
            data-testid="ceremony-mirror"
            data-up={mirrorUp ? '1' : '0'}
            aria-hidden={!mirrorUp}
            initial={false}
            animate={mirrorUp ? MIRROR_SHOW : MIRROR_HIDE}
            exit={MIRROR_HIDE}
          >
            <iframe
              ref={mirrorFrameRef}
              className="lobby-mirror__frame"
              title="The game time projector"
              src={`./countdown.html?mirror=1${config.reduceMotion ? '&vr=1' : ''}${mirrorQuery}`}
              tabIndex={-1}
            />
            {mirrorSwitchingNow && <MirrorSwitching />}
            {/* The copy says what it is (owner 2026-10-22), so nobody mistakes it for a stuck screen. */}
            {mirrorCopying && <p className="lobby-mirror__label" data-testid="ceremony-label">Opening ceremony in progress</p>}
          </M.div>
        </ErrorBoundary>
      )}
      </AnimatePresence>

      {/* Ambient particles (#26): snow / rain / sparkles just above the
          background, below every widget and banner. Signage only (never on
          OBS overlay feeds) and skipped under reduce-motion / panic. */}
      {!overlay && particleEffect && particleEffect !== 'off'
        && config.reduceMotion !== true && config.panicMode !== true && (
        <ErrorBoundary label="particles" eventKey={boardNow} onError={() => recordLayerFault('particles')}>
          <ParticleLayer effect={particleEffect} />
        </ErrorBoundary>
      )}

      <ErrorBoundary label="banner" eventKey={currentEvent?.id} onError={() => { skipCurrent(); recordLayerFault('banner'); }}>
        <Overlay
          currentEvent={currentEvent}
          run={checkInRun}
          step={checkInStep}
          audioEnabled={!config.audioMuted && !CONFIGURE}
          clubPhrases={config.clubPhrases}
          birthdayRibbon={birthdayWeekRibbon}
        />
      </ErrorBoundary>

      {/* Church-authored announcements. Rendered regardless of overlay
          mode — like the check-in banner above, a genuine cancellation
          notice must reach an OBS/ProPresenter feed too, not just the
          lobby TV. */}
      <ErrorBoundary label="notice-banner" eventKey={`${notice?.at ?? ''}|${boardNow}`} onError={() => recordLayerFault('notice')}>
        <NoticeBanner
          notice={notice}
          now={noticeNow}
          yielding={celebration != null || posterHeld}
          compact={flagsUp}
          place={room.critical === 'band' ? 'band' : 'centre'}
        />
      </ErrorBoundary>

      {/* The corner info's bottom corner (the time or tonight's tally); the
          weather's is in the corner stack below. One item, one corner, at a
          time: see useCornerItem. */}
      {!overlay && (
        <ErrorBoundary label="corner-info" eventKey={boardNow} onError={() => recordLayerFault('corner widgets')}>
          <div className="corner-bottom">
            <CornerChip
              item={cornerItem}
              corner="bottom"
              loads={corner.loads}
              hidden={cornerHidden}
              showNote={syncNote}
              size="calc(3.1 * min(1vw, 1.7778vh))"
            />
            {topTaken && waitingChip}
          </div>
        </ErrorBoundary>
      )}

      {/* Lobby "tonight" stat strip. Not part of the corner rotation
          (it's realtime print-server data, not an operator-configured
          corner item) — only overlay mode (transparent OBS/ProPresenter
          source, banners + confetti only) hides it. Yields to an active
          check-in banner, and to the pickup board in the foot it rides in,
          via `active`; see TonightTicker.jsx. */}
      {!overlay && config.showTonightTicker === true && (
        <ErrorBoundary label="tonight-ticker" eventKey={boardNow} onError={() => recordLayerFault('tonight strip')}>
          <TonightTicker tonight={tonight} active={tickerActive} now={tonightNow} />
        </ErrorBoundary>
      )}

      {/* Who is still waiting to be picked up, in the foot under the slides.
          Off unless the operator turned it on, and it yields to an active
          check-in banner — a child arriving at the door outranks the pickup
          list. All the visibility judgement is in the pure decideBoard(); see
          src/lib/checkoutBoard.js for why it is gated. */}
      {room.board && (
        <ErrorBoundary label="checkout-board" eventKey={boardNow} onError={() => recordLayerFault('pickup board')}>
          <CheckoutBoard decision={boardDecision} checkout={boardData} calm={config.panicMode === true} demo={boardDemo} />
        </ErrorBoundary>
      )}

      {/* "<First name> has checked out", one child at a time, in the foot in
          place of the list (owner, 2026-10-08): see src/lib/checkoutLeaves.js
          for when a name may be said. */}
      {!overlay && (
        <ErrorBoundary label="checkout-banner" eventKey={leaveNow?.id ?? 0} onError={() => recordLayerFault('pickup board')}>
          <CheckoutBanner item={room.banner ? leaveNow : null} calm={config.panicMode === true} />
        </ErrorBoundary>
      )}

      {/* Top-right corner stack: the status sticker, then one slot shared by
          the corner info's top corner (the weather) and the WAITING chip
          while a slide holds check-ins. The status sticker is a problem
          indicator, not corner info: it shows whenever there is a problem,
          whatever slide is up. */}
      {!overlay && (
        <div className="corner-stack">
          {showStatus && (
            <StickerChip
              rootRef={stickerRef}
              className={`status-dot ${status}`}
              label="Signal"
              aria-live="polite"
              aria-label={statusAriaLabel(status, opsFailures.length)}
            >
              {/* The kit chip (StepPlate): SIGNAL on the pill, the state on the
                  block. One line for the pipe (and the printer's count),
                  then any fault in words on its own sunflower strip. */}
              <span className="status-line">
                <span className="dot" />
                <span className="status-word">
                  {status === 'off' ? 'not set up' : status}
                  {/* While the pipe is down, show what the socket is doing
                      about it — "disconnected" alone reads as dead-forever. */}
                  {status !== 'connected' && retry
                    ? ` · retry ${retry.attempts}${retry.delaySec ? ` in ~${retry.delaySec}s` : '…'}`
                    : ''}
                </span>
                {opsFailures.length > 0 && (
                  <span className="ops-count" title="Printer problems tonight — see Settings">
                    ⚠ {opsFailures.length}
                  </span>
                )}
              </span>
              {/* Name faults get WORDS, not a colour. "disconnected" at least
                  tells an operator to look at the network; a silent absence of
                  banners tells them nothing, so this says which side to fix. */}
              {nameFaultText && (
                <span className="name-fault" title="Children's names arrive encrypted — see Settings → Account & app">
                  {nameFaultText}
                </span>
              )}
              {!nameFaultText && countsWithoutNames && (
                <span className="name-fault" title="The print server may be missing its display key">
                  COUNTS RISING, NO NAMES — CHECK THE PRINTER
                </span>
              )}
              {activeLayerFaults.length > 0 && (
                <span className="name-fault" title="A screen layer crashed and is being retried — see Settings">
                  LAYER FAULT: {activeLayerFaults.join(', ')}
                </span>
              )}
            </StickerChip>
          )}
          {/* The rotating slot sits UNDER the problem indicator, so the corner
              info coming and going never moves it; the weather and the
              WAITING chip never show together (the corner is hidden while
              a slide holds check-ins) and cross over in one cell. */}
          <AnimatePresence>
            {clubChipUp && (
              <M.div
                key={`club-${config.cornerClub}`}
                className="corner-chip corner-chip--club"
                role="status"
                aria-label={`${getClubPalette(config.cornerClub).name}: ${cornerClubCount} here now`}
                initial={WAITING_ENTER.initial}
                animate={WAITING_ENTER.animate}
                exit={{ opacity: 0, scale: 0.9, transition: { duration: DUR.exit, ease: EASE.exit } }}
                transition={WAITING_ENTER.transition}
              >
                <StepChip
                  label={getClubPalette(config.cornerClub).name.toUpperCase()}
                  value={cornerClubCount}
                  size="calc(2.5 * min(1vw, 1.7778vh))"
                  plate={getClubPalette(config.cornerClub).primary}
                />
              </M.div>
            )}
          </AnimatePresence>
          <div className="corner-top">
            <CornerChip
              item={cornerItem}
              corner="top"
              loads={corner.loads}
              hidden={cornerHidden}
              size="calc(2.5 * min(1vw, 1.7778vh))"
            />
            {!topTaken && waitingChip}
          </div>
        </div>
      )}


      {/* One toast, three sources — see useCelebrationQueue. The queue
          guarantees only one is ever on screen; MilestoneToast picks the copy,
          the plate (a club's own colours and wordmark on a club milestone,
          #332) and its place in the top band. */}
      <MilestoneToast
        celebration={celebration}
        club={celebrationClub}
        compact={flagsUp}
        below={room.toastBelow}
        afterNotice={bandNoticeUp}
      />

      {/* "+N more coming" while a run has a line behind it, as a kit chip on
          the club's own wave above its mark: the names it counts ride the
          same wave, so it is only ever up while that wave is (never in the
          gap between two runs), and on a run's first child it lands with the
          club's mark, once the wave has risen under it. Hidden while a slide
          holds check-ins (the WAITING chip counts the line then). */}
      <AnimatePresence>
        {!overlay && !checkInsHeld && currentEvent != null && pending >= BURST_THRESHOLD && (
          <UpNextChip key="up-next" pending={pending} rising={checkInStep === 0} />
        )}
      </AnimatePresence>


      {/* Once a simulated event has been fired, say so for the rest of the
          session. A volunteer walking past the lobby TV during training must
          never mistake a fake banner for a real child arriving — and a badge
          that timed out would defeat that at exactly the wrong moment. Cleared
          only by reloading, which is also how you leave demo mode. */}
      {/* Rehearsal watermark (#19): the printer is running a fake club
          night, so every banner on this screen is practice. Same rule as
          the demo pill — a passer-by must never mistake a rehearsal banner
          for a real child arriving. Follows the tally flag live. */}
      {/* The demo, rehearsal and simplified-mode flags hang from the top
          edge as kit tabs, side by side, in their own strip above the top
          band (which moves down while they hang). */}
      {flagsUp && (
        <div className={`top-flags${flagCount > 2 ? ' top-flags--tight' : ''}`}>
          {panicUp && (
            <div className="panic-pill" title="Simplified mode is on — toggle with Ctrl+Shift+X or in Settings → What screens show">
              simplified mode
            </div>
          )}
          {demoActive && (
            <div className="demo-pill" title="A simulated event has been fired on this screen. Reload to clear.">
              demo mode · not real check-ins
            </div>
          )}
          {rehearsalActive && (
            <div className="rehearsal-pill" title="The print server is in rehearsal mode. Check-ins on this screen are practice, not real arrivals.">
              rehearsal · practice run, not real check-ins
            </div>
          )}
        </div>
      )}

      {/* First-run card: an unconfigured TV must offer a volunteer a way in.
          It stands in the strip under the copy's lowest line, beside the
          left gutter (OVERLAY.setup), so it never covers a headline; setupUp() says
          when the room has space for it (never on an OBS/ProPresenter feed,
          over a panel, a name, a poster or the pickup board), and it hides
          itself once the screen is connected and keyed. */}
      {setupSeated && !CONFIGURE && (
        <SetupCard
          card={setupCard}
          onOpenSettings={() => { SettingsPanel.preload(); setSettingsTab('setup'); setSettingsOpen(true); }}
        />
      )}

      {settingsOpen && SETTINGS_PAGE && managedScreen && (
        <ErrorBoundary label="settings-panel" onError={backToScreens}>
          <RemoteScreenPanel
            fallback={<PanelOpening label="Settings" onClose={backToScreens} />}
            screen={managedScreen}
            shared={shared}
            shareStatus={shareStatus}
            onShare={shareSettings}
            onBack={backToScreens}
            onForgotten={backToScreens}
            onRenamed={(name) => setManagedScreen((s) => (s ? { ...s, name } : s))}
            onOpenSlideEditor={() => {
              SlideEditorPanel.preload();
              setSettingsOpen(false);
              setEditorFromSettings(true);
              setSlideEditorOpen(true);
            }}
          />
        </ErrorBoundary>
      )}

      {settingsOpen && !(SETTINGS_PAGE && managedScreen) && (
        <ErrorBoundary label="settings-panel" onError={() => setSettingsOpen(false)}>
          <SettingsPanel
            fallback={<PanelOpening label="Settings" onClose={CONFIGURE ? noop : () => setSettingsOpen(false)} />}
            onOpenScreen={SETTINGS_PAGE ? setManagedScreen : null}
            mission={SETTINGS_PAGE ? mission : null}
            tonightTitle={tonightTitle}
            config={config}
            savedConfig={storedConfig}
            overrides={overrides}
            status={status}
            nameStatus={nameStatus}
            demoActive={demoActive}
            initialTab={settingsTab}
            layerFaults={activeLayerFaults}
            lastEventAt={lastEventAt}
            calendar={calendar}
            phase={phase}
            scheduleSource={scheduleSource}
            opsFailures={opsFailures}
            remoteConfigError={remoteConfigUrl ? remoteConfigError : null}
            wakeLockStatus={wakeLockStatus}
            syncedDeck={syncedDeck}
            slidesStatus={slidesStatus}
            onForgetSyncedDeck={forgetSyncedDeck}
            onChange={updateConfig}
            onReplace={replaceConfig}
            shared={shared}
            shareStatus={shareStatus}
            onShare={shareSettings}
            onReset={resetConfig}
            configure={CONFIGURE}
            page={SETTINGS_PAGE}
            onClose={CONFIGURE ? noop : () => setSettingsOpen(false)}
            // A rehearsal for the operator, not a child in the lobby: it plays
            // the banner and lights the demo badge, but the public "Tonight"
            // count belongs to the printer and must not move for a preview.
            // In configure mode these three play on the live screen instead.
            onTest={SETTINGS_PAGE ? undefined : CONFIGURE ? (p) => relayToScreen('lobby', 'preview-checkin', p) : previewCheckIn}
            onResetTally={SETTINGS_PAGE ? undefined : CONFIGURE ? () => relayToScreen('lobby', 'reset-tally') : resetTonight}
            onOpenSlideEditor={() => {
              SlideEditorPanel.preload();
              setSettingsOpen(false);
              setEditorFromSettings(true);
              setSlideEditorOpen(true);
            }}
            onOpenDebug={CONFIGURE ? undefined : () => { DebugPanel.preload(); setSettingsOpen(false); setDebugOpen(true); }}
            onPreviewPromo={SETTINGS_PAGE ? undefined : CONFIGURE ? (key) => relayToScreen('lobby', 'preview-promo', { key }) : (key) => {
              // Like the board demo: close Settings so the TV shows it.
              startPromoPreview(key);
              setSettingsOpen(false);
            }}
            onBoardDemo={SETTINGS_PAGE ? undefined : () => {
              if (CONFIGURE) { relayToScreen('lobby', 'board-demo'); return; }
              // A rehearsal on this screen: the demo badge stays up until reload,
              // like every other simulated thing.
              startBoardDemo();
              setSettingsOpen(false);
            }}
          />
        </ErrorBoundary>
      )}

      {slideEditorOpen && (
        <ErrorBoundary label="slide-editor" onError={() => setSlideEditorOpen(false)}>
          <SlideEditorPanel
            fallback={<PanelOpening label="Typed slides" onClose={closeSlideEditor} />}
            config={storedConfig}
            syncedDeck={followPublishedSlides ? syncedDeck : null}
            onChange={updateConfig}
            onClose={closeSlideEditor}
          />
        </ErrorBoundary>
      )}

      {debugOpen && (
        <ErrorBoundary label="debug-panel" onError={() => setDebugOpen(false)}>
          <DebugPanel
            fallback={<DebugOpening />}
            onSimulate={(p) => simulate('checkin', p)}
            onSimulateRecap={(p) => simulate('recap', p)}
            onSimulateOps={(p) => simulate('ops', p)}
            onSimulateTally={(p) => simulate('tally', p)}
            onSimulateCheckout={(p) => simulate('checkout', p)}
            onSimulateBirthdays={(p) => simulate('birthdays', p)}
            onSimulateTonight={(p) => simulate('tonight', p)}
            onSimulateNotice={(p) => simulate('notice', p)}
            onClearNotice={clearNotice}
            onClose={() => setDebugOpen(false)}
            status={status}
            lastEventAt={lastEventAt}
            pending={pending}
            phase={phase}
            seenStats={seenStats}
            opsFailures={opsFailures}
            wakeLockStatus={wakeLockStatus}
          />
        </ErrorBoundary>
      )}
    </div>
    </MotionConfig>
    </LobbyLiveContext.Provider>
    </ZeroAnimationContext.Provider>
  );
}
