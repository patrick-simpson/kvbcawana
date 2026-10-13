import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import defaults from '../config.js';
import { sanitizeOverrides } from '../hooks/useConfig.js';
import { sanitizeMilestoneList } from '../lib/milestones.js';
import { NIGHT_THEME_VALUES } from '../lib/skins.js';
import { SAMPLE_NAMES, pick } from '../lib/demoNames.js';
import { localDateStr } from '../lib/calendarLogic.js';
import { useDisplayKey } from '../hooks/useDisplayKey.js';
import { useDisplayLogin } from '../hooks/useDisplayLogin.js';
import { useSync } from '../hooks/useSync.js';
import { pageBuild } from '../lib/buildReload.js';
import {
  classicOpeningSection, classicSectionsFor, nextFocusState, openingSection, railMode, resolveClassicSection, resolveSection, sectionsFor,
} from '../lib/settingsSections.js';
import { initialMission } from '../lib/missionControl.js';
import { isSharedKey, pickShared } from '../lib/sharedSettings.js';
import { ZeroAnimationContext } from '../lib/motion.jsx';
import {
  AccountSection, CelebrationsSection, CheckinsSection, ClassicLookSection, JourneySection, LookSection, PickupSection, PrintingSection,
  ScreenSection, SetupSection, SharedSettingsCard, ShowSection, SlidesSection, StatusSection, TonightSection, statusProblems,
} from './settings/sections/index.js';
import TvPreview, { previewEnabled } from './settings/TvPreview.jsx';
import { EMPTY_NOTICE } from './settings/NoticeCard.jsx';
import { FollowingContext, RemoteScreenContext, SettingsPageContext } from './settings/fields.jsx';
import { ScreenOverviewSection, ScreensSection } from './settings/screens.jsx';
import LaptopSection from './settings/laptop.jsx';
import HistorySection from './settings/history.jsx';
import { CORNER_CLUB_IDS } from '../lib/clubs.js';
import { celebrateChange } from '../lib/settingsJoy.js';
import awanaClubsMark from '../../shared/brand/logos/awana-clubs-white.svg';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// The form is seeded from the STORED config (savedConfig): never the
// panic-masked or URL-flagged one the stage renders, so a change while
// simplified mode is on cannot write the placeholder values into storage.
// Simplified mode itself is not in the form: it is a switch, applied the
// moment it is flipped (like Ctrl+Shift+X), and read live from savedConfig.
export function seedForm(c) {
  return {
    backgroundSource: ['powerpoint', 'pptx', 'video'].includes(c.backgroundSource) ? c.backgroundSource : 'manual',
    powerpointEmbedUrl: c.powerpointEmbedUrl || '',
    slideshowDelaySec: c.slideshowDelaySec ?? 5,
    standardDisplayMs: c.standardDisplayMs ?? 6000,
    specialDisplayMs: c.specialDisplayMs ?? 8000,
    audioMuted: !!c.audioMuted,
    showConnectionStatus: !!c.showConnectionStatus,
    showTally: c.showTally !== false,
    showTallySyncNote: c.showTallySyncNote !== false,
    showTonightTicker: c.showTonightTicker === true,
    keepScreenAwake: c.keepScreenAwake !== false,
    cornerClub: CORNER_CLUB_IDS.includes(c.cornerClub) ? c.cornerClub : '',
    showClock: !!c.showClock,
    // Reads the one skin table. When this repeated the ids by hand, a saved
    // skin the list had never heard of (thanksgiving, easter, vbs) was silently
    // reset to 'none' the moment Settings was opened.
    nightTheme: NIGHT_THEME_VALUES.includes(c.nightTheme) ? c.nightTheme : 'none',
    followPrinterTheme: c.followPrinterTheme !== false,
    followPublishedSlides: c.followPublishedSlides !== false,
    followSharedSettings: c.followSharedSettings !== false,
    aprilFools: c.aprilFools === true,
    particleEffect: ['auto', 'snow', 'rain', 'sparkle', 'off'].includes(c.particleEffect)
      ? c.particleEffect
      : 'auto',
    weatherTheme: c.weatherTheme === true,
    confettiLevel: ['reduced', 'off'].includes(c.confettiLevel) ? c.confettiLevel : 'full',
    reduceMotion: c.reduceMotion === true,
    clubMilestoneEvery: c.clubMilestoneEvery ?? 10,
    clubTintBackground: c.clubTintBackground === true,
    firstArrivalMoment: c.firstArrivalMoment !== false,
    showBirthdayWeekRibbon: c.showBirthdayWeekRibbon !== false,
    clubPhrases: { ...(c.clubPhrases || {}) },
    checkoutBoardNamesAbove: c.checkoutBoardNamesAbove ?? 3,
    checkoutBoardStaleMin: c.checkoutBoardStaleMin ?? 8,
    cornerStillHere: c.cornerStillHere !== false,
    milestoneEvery: c.milestoneEvery ?? 25,
    // Threshold LISTS (#358) — seeded through the same sanitizer the config
    // validator uses, so an old saved list is repaired, never silently reset.
    bookMilestones: sanitizeMilestoneList(c.bookMilestones ?? [5, 10, 25]),
    awardMilestones: sanitizeMilestoneList(c.awardMilestones ?? [10, 25, 50]),
    calendarEnabled: c.calendarEnabled !== false,
    calendarUrl: c.calendarUrl || '',
    calendarWelcomeText: c.calendarWelcomeText || 'Welcome to Awana!',
    calendarShowWelcome: c.calendarShowWelcome !== false,
    calendarShowNextWeek: c.calendarShowNextWeek !== false,
    calendarShowRemaining: c.calendarShowRemaining !== false,
    seasonPromos: c.seasonPromos !== false,
    showWeatherChip: c.showWeatherChip !== false,
    weatherLocationName: c.weatherLocationName || '',
    weatherLat: c.weatherLat ?? 44.552,
    weatherLon: c.weatherLon ?? -69.6317,
    weatherUnits: c.weatherUnits === 'celsius' ? 'celsius' : 'fahrenheit',
  };
}

// The clamp table applied before anything is written, to the seed too, so
// the diff below compares like with like.
export function normalize(f) {
  return {
    ...f,
    standardDisplayMs: clamp(Math.round(f.standardDisplayMs) || 6000, 2000, 20000),
    specialDisplayMs: clamp(Math.round(f.specialDisplayMs) || 8000, 3000, 25000),
    slideshowDelaySec: clamp(Number(f.slideshowDelaySec) || 0, 0, 120),
    milestoneEvery: clamp(Math.round(f.milestoneEvery) || 0, 0, 10000),
    bookMilestones: sanitizeMilestoneList(f.bookMilestones),
    awardMilestones: sanitizeMilestoneList(f.awardMilestones),
    clubMilestoneEvery: clamp(Math.round(f.clubMilestoneEvery) || 0, 0, 1000),
    checkoutBoardNamesAbove: clamp(Math.round(f.checkoutBoardNamesAbove) || 0, 0, 200),
    checkoutBoardStaleMin: clamp(Math.round(f.checkoutBoardStaleMin) || 8, 1, 120),
    calendarUrl: f.calendarUrl.trim(),
    calendarWelcomeText: f.calendarWelcomeText.trim().slice(0, 80) || 'Welcome to Awana!',
    weatherLocationName: f.weatherLocationName.trim().slice(0, 80),
    weatherLat: clamp(Number(f.weatherLat) || 0, -90, 90),
    weatherLon: clamp(Number(f.weatherLon) || 0, -180, 180),
  };
}

/** The keys of `next` whose value differs from `base` (JSON compare, so clubPhrases behaves like a scalar). */
function diff(next, base) {
  return Object.fromEntries(
    Object.entries(next).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(base[k])),
  );
}

// Controls whose every change is a decision (a box, a radio, a menu) apply
// at once; typed fields apply when they lose focus or on Enter, so a half-
// typed number never reaches the TV.
const LIVE_INPUTS = new Set(['checkbox', 'radio', 'select-one']);

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
const PHONE_QUERY = '(max-width: 719px), (max-height: 480px)';

export default function SettingsPanel({
  config, savedConfig, overrides, status, nameStatus, demoActive, lastEventAt, calendar, phase, scheduleSource,
  opsFailures, remoteConfigError, wakeLockStatus, layerFaults,
  initialTab = null, onTabChange,
  onChange, onReplace, onReset, onClose, onTest, onResetTally, onOpenSlideEditor, onOpenDebug, onBoardDemo, onPreviewPromo, configure = false, page = false,
  syncedDeck, slidesStatus, onForgetSyncedDeck,
  shared = null, shareStatus = null, onShare,
  // The settings page's Screens (ROADMAP.md#settings-page, phase 2): `onOpenScreen` opens
  // one from the list; `screen` is set when this panel IS that screen's
  // (RemoteScreenPanel), with its note, actions, rename and forget.
  onOpenScreen = null, screen = null, screenNote = null, onScreenAction, onScreenRenamed, onScreenForgotten,
  // Mission control's memory-only feed of recent first names (App, settings page only), and the rail.
  mission = null, rail: railProp = null, tonightTitle = null,
}) {
  const stored = savedConfig ?? config;
  const [initial] = useState(() => seedForm(stored));
  const [form, setFormState] = useState(initial);
  const formRef = useRef(initial);
  // What has actually been written so far; each apply diffs against it, so
  // only a key the operator touched is ever written (a baked build key or a
  // ?config= fleet value is never pinned by someone who changed the confetti).
  const appliedRef = useRef(normalize(initial));
  // The device's own layer as it was on opening: Undo puts back exactly this.
  const [openedOverrides] = useState(() => ({ ...(overrides ?? {}) }));
  const [changed, setChanged] = useState(false);
  // Remounts the section after an Undo, so fields with local drafts re-read.
  const [generation, setGeneration] = useState(0);

  const zeroAnimation = useContext(ZeroAnimationContext);
  const { displayKey } = useDisplayKey();
  const login = useDisplayLogin();
  const secure = Boolean(globalThis.crypto?.subtle);
  const keyed = Boolean(displayKey) || login.loginStatus === 'logged-in';
  const [openedAt] = useState(() => Date.now());
  const [build] = useState(() => pageBuild());
  const problems = statusProblems({ opsFailures, layerFaults, remoteConfigError, wakeLockStatus, demoActive, status });

  const { signedIn } = useSync();
  // The new rail (eight sections since the 2026-10-13 reorganize), or the old one (?rail=classic: deleted the release after the overhaul).
  const [rail] = useState(() => railProp ?? railMode());
  const classic = rail === 'classic';
  const sections = classic ? classicSectionsFor(page, { remote: Boolean(screen) }) : sectionsFor(page, { remote: Boolean(screen) });
  // The settings page opens on signing in until it is signed in: nothing
  // there reaches a screen without it.
  const [section, setSectionState] = useState(() => (classic
    ? (page && !signedIn && !initialTab ? 'setup' : classicOpeningSection(initialTab, { status, keyed, problems: problems.length }))
    : openingSection(initialTab, { status, keyed, problems: problems.length, page, signedIn })));
  // The live TV preview (settings page only): what the draft would look like.
  // The focus belongs to the section it was set in: a new section starts on the slide.
  const [focusState, setFocusState] = useState({ section: '', focus: 'slide' });
  const [previewOn, setPreviewOn] = useState(false);
  const [noticeDraft, setNoticeDraft] = useState(EMPTY_NOTICE);
  const [wide, setWide] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(min-width: 1200px)').matches : false));
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const q = window.matchMedia('(min-width: 1200px)');
    const on = () => setWide(q.matches);
    q.addEventListener?.('change', on);
    return () => q.removeEventListener?.('change', on);
  }, []);
  const [previewKilled, setPreviewKilled] = useState(false);
  // Phones show the list, then one section full screen; an explicit request
  // (the first-run card) goes straight to its section.
  const [view, setView] = useState(() => (initialTab ? 'section' : 'list'));

  const dialogRef = useRef(null);
  const navRefs = useRef({});
  const backRef = useRef(null);
  const importRef = useRef(null);

  // Did this session change a shared setting? Undo then sends the opening
  // values back out, so every screen goes back too.
  const sharedTouchedRef = useRef(false);
  const flush = useCallback((next = formRef.current) => {
    const n = normalize(next);
    const patch = diff(n, appliedRef.current);
    if (!Object.keys(patch).length) return;
    appliedRef.current = n;
    onChange(patch);
    setChanged(true);
    // A shared change (contract v6) goes to every screen, with this screen's
    // whole shared set, so the screens converge on what this one shows.
    if (onShare && n.followSharedSettings !== false && Object.keys(patch).some(isSharedKey)) {
      sharedTouchedRef.current = true;
      onShare(pickShared(n));
    }
  }, [onChange, onShare]);

  /** Change the form; `apply: false` for a typed field (flushed on blur / Enter). */
  const update = (patchOrFn, { apply = true } = {}) => {
    const next = typeof patchOrFn === 'function' ? patchOrFn(formRef.current) : { ...formRef.current, ...patchOrFn };
    formRef.current = next;
    setFormState(next);
    if (apply) flush(next);
  };

  const set = (key) => (e) => {
    const { type } = e.target;
    const value = type === 'checkbox'
      ? e.target.checked
      : type === 'number'
        ? Number(e.target.value)
        : e.target.value;
    update({ [key]: value }, { apply: LIVE_INPUTS.has(type) });
  };

  // A typed field applies when focus leaves it, or on Enter (focusout bubbles,
  // so one listener on the pane covers every field in it).
  const onPaneBlur = (e) => {
    if (e.target.matches?.('input, textarea')) flush();
  };
  const onPaneKeyDown = (e) => {
    if (e.key === 'Enter' && e.target.matches?.('input:not([type="checkbox"]):not([type="radio"]):not([type="file"])')) flush();
  };

  const onPanic = (on) => {
    onChange({ panicMode: on });
    setChanged(true);
  };

  const done = useCallback(() => { flush(); onClose(); }, [flush, onClose]);

  const undo = () => {
    // The form was seeded from this very layer (plus the defaults and any
    // ?config= values under it), so going back to the seed is going back to it.
    (onReplace ?? onChange)(openedOverrides);
    if (sharedTouchedRef.current && onShare && initial.followSharedSettings !== false) {
      sharedTouchedRef.current = false;
      onShare(pickShared(normalize(initial)));
    }
    formRef.current = initial;
    appliedRef.current = normalize(initial);
    setFormState(initial);
    setChanged(false);
    setGeneration((g) => g + 1);
  };

  const goTo = (asked) => {
    const id = (classic ? resolveClassicSection(asked) : resolveSection(asked)) ?? asked;
    setSectionState(id);
    setView('section');
    onTabChange?.(id);
  };

  const reset = () => {
    if (window.confirm('Reset this screen? Every setting goes back to its default, and the typed slides saved on this device are deleted. The sign-in, keys, uploaded files and the published deck stay.')) {
      onReset();
      onClose();
    }
  };

  const resetTally = () => {
    if (window.confirm("Reset tonight's counter to zero? It re-syncs from the next count, and the “Doors are open” moment can play again tonight.")) onResetTally();
  };

  // #35: move a display's whole setup between machines as a JSON file.
  // Exports what differs from the baked defaults — device overrides plus any
  // ?config= values — so importing on a fresh install reproduces this screen
  // even when it was configured centrally and `overrides` is empty. Never
  // URL flags, never the panic mask, and structurally never the display key,
  // publish token or login key: sanitizeOverrides is VALIDATORS-bound and
  // neither is a config key (see src/lib/displayKey.js).
  const exportSettings = () => {
    flush();
    const baseline = { ...defaults, audioMuted: !defaults.audioEnabledByDefault };
    const source = { ...(savedConfig ?? config), ...appliedRef.current };
    const payload = Object.fromEntries(
      Object.entries(sanitizeOverrides(source)).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(baseline[k])),
    );
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'awana-display-settings.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 0);
  };

  const importSettings = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let raw;
      try {
        raw = JSON.parse(reader.result);
      } catch {
        window.alert('That file is not a valid settings export.');
        return;
      }
      // Count what would actually apply — a slides export is valid JSON and
      // used to be greeted with "Settings imported." while changing nothing.
      const clean = sanitizeOverrides(raw);
      const n = Object.keys(clean).length;
      if (!n) {
        window.alert('That file has no display settings in it — is it a slides export? (Slide decks are imported from the slide editor’s Import button.)');
        return;
      }
      if (!window.confirm(`Import ${n} setting${n === 1 ? '' : 's'} from this file now? Matching settings on this display are replaced; anything not in the file is left as it is.`)) return;
      onChange(clean);
      window.alert(`Imported ${n} setting${n === 1 ? '' : 's'}. Video files and uploaded decks do not travel — re-add those on this device.`);
      onClose();
    };
    reader.onerror = () => window.alert('Could not read that file.');
    reader.readAsText(file);
  };

  const preview = () => {
    flush();
    onTest?.({ firstName: pick(SAMPLE_NAMES), club: 'Sparks' });
    // Get out of the way so the banner is visible (a screen opened from the
    // settings page plays it over there, so this stays open).
    if (!screen) onClose();
  };

  // Rail keys: a vertical tablist, so Up/Down (Left/Right too), Home and End.
  const onNavKeyDown = (e) => {
    const i = sections.findIndex((s) => s.id === section);
    let next = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = sections[(i + 1) % sections.length].id;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = sections[(i - 1 + sections.length) % sections.length].id;
    else if (e.key === 'Home') next = sections[0].id;
    else if (e.key === 'End') next = sections[sections.length - 1].id;
    if (next) {
      e.preventDefault();
      setSectionState(next);
      onTabChange?.(next);
      navRefs.current[next]?.focus();
    }
  };

  const onNavClick = (id) => {
    goTo(id);
    // On a phone the list gives way to the section: move focus with it.
    if (window.matchMedia?.(PHONE_QUERY)?.matches) requestAnimationFrame(() => backRef.current?.focus());
  };

  const back = () => {
    setView('list');
    requestAnimationFrame(() => navRefs.current[section]?.focus());
  };

  // Every box, radio option and menu choice gets its own little celebration
  // (src/lib/settingsJoy.js): one native listener for the whole dialog.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const onChange = (e) => celebrateChange(e);
    dialog.addEventListener('change', onChange);
    return () => dialog.removeEventListener('change', onChange);
  }, []);

  // Escape closes from anywhere (nothing is ever lost: changes are already
  // applied). Tab is kept inside the dialog.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') done();
      else if (e.key === 'Tab' && dialogRef.current) {
        const items = [...dialogRef.current.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [done]);

  // Focus moves into the panel on opening and back where it was on closing.
  useLayoutEffect(() => {
    const before = document.activeElement;
    navRefs.current[section]?.focus({ preventScroll: true });
    return () => { if (before instanceof HTMLElement && before.isConnected) before.focus({ preventScroll: true }); };
    // Opening only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = sections.find((s) => s.id === section) ?? sections[0];
  const panicMode = (savedConfig ?? config)?.panicMode === true;
  const lowPowerForced = config?.reduceMotion === true && (savedConfig ?? config)?.reduceMotion !== true;
  const props = { form, set, update };

  const today = localDateStr();
  const slidesProps = {
    slideCount: (savedConfig ?? config).manualSlides?.length || 0,
    onEditSlides: () => { flush(); onOpenSlideEditor(); },
    syncedDeck,
    today,
    tonightTitle,
    onPreviewPromo: onPreviewPromo ? (key) => { flush(); onPreviewPromo(key); } : null,
    onForgetSyncedDeck,
  };
  const accountProps = {
    secure,
    build,
    shared,
    shareStatus,
    onOpenDebug: onOpenDebug ? () => { flush(); onOpenDebug(); } : null,
    onExport: exportSettings,
    onImport: () => importRef.current?.click(),
    onResetTally: onResetTally ? resetTally : null,
    onReset: reset,
    onShareNow: onShare ? () => { flush(); onShare(pickShared(normalize(formRef.current))); } : null,
  };

  let body;
  if (section === 'screens' && onOpenScreen) {
    body = <ScreensSection onOpen={onOpenScreen} goTo={goTo} />;
  } else if ((section === 'status' || section === 'tonight') && screen) {
    body = (
      <>
        <ScreenOverviewSection
          screen={screen} following={form.followSharedSettings !== false} goTo={goTo}
          onAction={(a) => { flush(); onScreenAction?.(a); }} onRenamed={onScreenRenamed} onForgotten={onScreenForgotten}
        />
        {/* The new rail has no Account section on a screen opened from the page: its follow switch lives here. */}
        {!classic && <SharedSettingsCard form={form} set={set} shared={shared} shareStatus={shareStatus} onShareNow={null} />}
      </>
    );
  } else if (section === 'tonight') {
    body = (
      <TonightSection
        status={status} nameStatus={nameStatus} keyed={keyed} displayKey={displayKey}
        lastEventAt={lastEventAt} openedAt={openedAt} phase={phase} scheduleSource={scheduleSource}
        calendar={calendar} calendarEnabled={form.calendarEnabled} opsFailures={opsFailures}
        layerFaults={layerFaults} remoteConfigError={remoteConfigError} wakeLockStatus={wakeLockStatus}
        demoActive={demoActive} syncedDeck={syncedDeck} slidesStatus={slidesStatus}
        following={form.followPublishedSlides !== false} build={build} goTo={goTo}
        onReload={() => window.location.reload()}
        mission={mission ?? initialMission()} noticeDraft={noticeDraft} onNoticeDraft={setNoticeDraft}
      />
    );
  } else if (section === 'status') {
    body = (
      <StatusSection
        status={status} nameStatus={nameStatus} keyed={keyed} displayKey={displayKey}
        lastEventAt={lastEventAt} openedAt={openedAt} phase={phase} scheduleSource={scheduleSource}
        calendar={calendar} calendarEnabled={form.calendarEnabled} opsFailures={opsFailures}
        layerFaults={layerFaults} remoteConfigError={remoteConfigError} wakeLockStatus={wakeLockStatus}
        demoActive={demoActive} syncedDeck={syncedDeck} slidesStatus={slidesStatus}
        following={form.followPublishedSlides !== false} build={build} goTo={goTo}
        onReload={() => window.location.reload()}
      />
    );
  } else if (section === 'show') {
    body = (
      <ShowSection
        {...props} onPreview={onTest ? preview : null} onBoardDemo={onBoardDemo ? () => { flush(); onBoardDemo(); } : null}
        panicMode={panicMode} onPanic={onPanic} wakeLockStatus={wakeLockStatus} lowPowerForced={lowPowerForced} goTo={goTo}
      />
    );
  } else if (section === 'look' && !classic) {
    body = <LookSection {...props} {...slidesProps} />;
  } else if (section === 'printing') {
    body = <PrintingSection goTo={goTo} />;
  } else if (section === 'journey') {
    body = <JourneySection goTo={goTo} />;
  } else if (section === 'account') {
    body = <AccountSection {...props} {...accountProps} />;
  } else if (section === 'checkins') {
    body = <CheckinsSection {...props} onPreview={onTest ? preview : null} />;
  } else if (section === 'slides') {
    body = <SlidesSection {...props} {...slidesProps} />;
  } else if (section === 'screen') {
    body = <ScreenSection {...props} panicMode={panicMode} onPanic={onPanic} wakeLockStatus={wakeLockStatus} lowPowerForced={lowPowerForced} />;
  } else if (section === 'celebrations') {
    body = <CelebrationsSection {...props} />;
  } else if (section === 'pickup') {
    body = <PickupSection {...props} onBoardDemo={onBoardDemo ? () => { flush(); onBoardDemo(); } : null} />;
  } else if (section === 'laptop') {
    body = <LaptopSection />;
  } else if (section === 'history') {
    body = <HistorySection />;
  } else if (section === 'look') {
    body = <ClassicLookSection {...props} />;
  } else {
    body = <SetupSection {...props} {...accountProps} />;
  }

  // The live TV preview (docs/SETTINGS-OVERHAUL.md section 6): the settings
  // page only, on Tonight / What screens show / Slides & look. Wide screens get
  // a sticky column; narrower ones a toggle strip on show / look.
  const previewAllowed = !classic && page && !screen && !previewKilled && previewEnabled();
  const previewOnSection = previewAllowed && ['tonight', 'show', 'look'].includes(section);
  const showColumn = previewOnSection && wide;
  const showStrip = previewAllowed && !wide && ['show', 'look'].includes(section);
  const publishedSlide = syncedDeck?.slides?.find?.((sl) => sl && sl.type !== 'video' && !sl.videoId) ?? null;
  const previewFocus = focusState.section === section ? focusState.focus : 'slide';
  const tvPreview = (
    <TvPreview
      form={form} focus={previewFocus} noticeDraft={noticeDraft}
      publishedSlide={publishedSlide} today={today} tonightTitle={tonightTitle} onHide={() => setPreviewKilled(true)}
    />
  );
  // The focus is the card the pointer or keyboard focus is in (data-preview on PanelCard).
  const trackFocus = (e) => {
    const card = e.target?.closest?.('[data-preview]');
    if (card?.dataset.preview) setFocusState((prev) => nextFocusState(prev, section, card.dataset.preview));
  };

  // The settings page is not a screen: what matters there is the sign-in.
  const pill = screen ? (screen.online ? 'On now' : 'Off') : page ? (signedIn ? 'Signed in' : 'Not signed in') : {
    connected: keyed ? 'Connected' : 'Connected · not signed in',
    connecting: 'Connecting…',
    disconnected: 'Disconnected',
    off: 'Not set up',
  }[status] || status;

  return (
    <div className="panel-backdrop" onClick={done}>
      <div
        ref={dialogRef}
        className={`panel panel--tabbed panel--settings${showColumn ? ' has-preview' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        data-view={view}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-header">
          <img className="panel-mark" src={awanaClubsMark} alt="" draggable="false" />
          <h2>{screen ? screen.name : page ? 'KVBC Awana Settings' : 'Settings'}</h2>
          <div className={`status-line ${screen ? (screen.online ? 'connected' : 'off') : page ? (signedIn ? 'connected' : 'off') : status}`} role="status">
            <span className="dot" />
            <span>{pill}{problems.length && !screen ? ` · ${problems.length} to check` : ''}</span>
          </div>
          {screen && (
            <button type="button" className="ghost small settings-screen-back" onClick={onClose}>← All screens</button>
          )}
        </div>

        <SettingsPageContext.Provider value={page}>
        <RemoteScreenContext.Provider value={screen ? { id: screen.id, kind: screen.kind, name: screen.name } : null}>
        <FollowingContext.Provider value={form.followSharedSettings !== false}>
        <div className="settings-main">
          <nav className="settings-nav" aria-label="Settings sections">
            <div role="tablist" aria-orientation="vertical" aria-label="Settings sections" onKeyDown={onNavKeyDown}>
              {sections.map((s) => {
                const badge = screen ? null
                  : (s.id === 'status' || s.id === 'tonight') && problems.length ? problems.length
                    : (s.id === 'setup' || s.id === 'account') && (page ? !signedIn : (status === 'off' || !keyed)) ? '!' : null;
                return (
                  <button
                    key={s.id}
                    ref={(el) => { navRefs.current[s.id] = el; }}
                    type="button"
                    role="tab"
                    id={`tab-${s.id}`}
                    aria-selected={section === s.id}
                    aria-controls={`tabpanel-${s.id}`}
                    aria-labelledby={`tab-${s.id}-label`}
                    aria-describedby={`tab-${s.id}-blurb`}
                    tabIndex={section === s.id ? 0 : -1}
                    className="settings-nav__item"
                    onClick={() => onNavClick(s.id)}
                  >
                    <span className="settings-nav__label" id={`tab-${s.id}-label`}>{s.label}</span>
                    <span className="settings-nav__blurb" id={`tab-${s.id}-blurb`}>{screen && (s.id === 'status' || s.id === 'tonight') ? 'On or off, its name, its buttons' : s.blurb}</span>
                    {badge != null && <span className="settings-nav__badge" aria-label={`${badge} to check`}>{badge}</span>}
                  </button>
                );
              })}
            </div>
          </nav>

          <section
            className="settings-pane"
            role="tabpanel"
            id={`tabpanel-${section}`}
            aria-labelledby={`tab-${section}-label`}
            tabIndex={-1}
          >
            <div className="settings-pane__head">
              <button ref={backRef} type="button" className="ghost settings-back" onClick={back} aria-label="Back to all settings">
                ← All settings
              </button>
              <h3 className="settings-pane__title" key={section}>{current.label}</h3>
            </div>
            {showStrip && (
              <>
                <div className="tv-preview-strip">
                  <button type="button" className="ghost small" aria-pressed={previewOn} onClick={() => setPreviewOn((v) => !v)}>
                    {previewOn ? 'Hide the preview' : 'Preview'}
                  </button>
                  <span className="hint">What a TV would show with these settings.</span>
                </div>
                {previewOn && tvPreview}
              </>
            )}
            <div
              className="panel-body" key={`${section}-${generation}`} onBlur={onPaneBlur} onKeyDown={onPaneKeyDown}
              onFocusCapture={previewOnSection ? trackFocus : undefined} onPointerOverCapture={previewOnSection ? trackFocus : undefined}
            >
              {body}
            </div>
          </section>
          {showColumn && <aside className="settings-preview-col" aria-label="TV preview">{tvPreview}</aside>}
        </div>

        </FollowingContext.Provider>
        </RemoteScreenContext.Provider>
        </SettingsPageContext.Provider>

        <div className="actions">
          <span className={`hint settings-live${shareStatus?.state === 'failed' || screenNote?.warn ? ' hint--warn' : ''}`} aria-live="polite">
            {screen && screenNote ? screenNote.text
              : shareStatus?.state === 'sending' ? 'Sending to every screen…'
              : shareStatus?.state === 'sent' ? 'Sent to every screen.'
                : shareStatus?.state === 'failed' ? `This screen only (see ${classic ? 'Setup' : 'Account & app'} → Church-wide settings).`
                  : screen ? `Changes reach ${screen.name} as you make them.`
                  : page ? (signedIn ? 'Changes reach every screen as you make them.' : (classic ? 'Sign in under Setup to change every screen.' : 'Sign in under Account & app to change every screen.'))
                    : configure ? 'Changes go live on the screen as you make them.'
                    : changed ? 'Changes are live on this screen.' : 'Changes apply as you make them.'}
          </span>
          <button type="button" className="ghost" onClick={undo} disabled={!changed}
            title="Put every setting back the way it was when you opened Settings (not the sign-in, keys or uploaded files)">
            Undo changes
          </button>
          {/* Configure mode (the sound room app's Settings window) has no
              Done: the window itself is closed instead. */}
          {configure ? null : zeroAnimation
            ? <button type="button" className="primary" onClick={done}>Done</button>
            : <jelly-button variant="mint" onClick={done}>Done</jelly-button>}
        </div>
        <input
          ref={importRef}
          type="file"
          accept=".json,application/json"
          hidden
          data-testid="import-settings-file"
          onChange={importSettings}
        />
      </div>
    </div>
  );
}
