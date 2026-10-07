import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import defaults from '../config.js';
import { sanitizeOverrides } from '../hooks/useConfig.js';
import { sanitizeMilestoneList } from '../lib/milestones.js';
import { NIGHT_THEME_VALUES } from '../lib/skins.js';
import { SAMPLE_NAMES, pick } from '../lib/demoNames.js';
import { localDateStr } from '../lib/calendarLogic.js';
import { PICKUP_FROM, PICKUP_UNTIL, parseHHMM } from '../lib/checkoutBoard.js';
import { useDisplayKey } from '../hooks/useDisplayKey.js';
import { useDisplayLogin } from '../hooks/useDisplayLogin.js';
import { pageBuild } from '../lib/buildReload.js';
import { SECTIONS, openingSection } from '../lib/settingsSections.js';
import { isSharedKey, pickShared } from '../lib/sharedSettings.js';
import { ZeroAnimationContext } from '../lib/motion.jsx';
import {
  CelebrationsSection, CheckinsSection, LookSection, PickupSection, ScreenSection, SetupSection,
  SlidesSection, StatusSection, statusProblems,
} from './settings/sections.jsx';
import { FollowingContext } from './settings/fields.jsx';
import awanaClubsMark from '../../shared/brand/logos/awana-clubs-white.svg';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// The form is seeded from the STORED config (savedConfig): never the
// panic-masked or URL-flagged one the stage renders, so a change while
// simplified mode is on cannot write the placeholder values into storage.
// Simplified mode itself is not in the form: it is a switch, applied the
// moment it is flipped (like Ctrl+Shift+X), and read live from savedConfig.
export function seedForm(c) {
  return {
    pusherAppKey: c.pusherAppKey || '',
    pusherCluster: c.pusherCluster || 'us2',
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
    checkoutBoardMode: ['pickup', 'always'].includes(c.checkoutBoardMode) ? c.checkoutBoardMode : 'off',
    checkoutBoardNamesAbove: c.checkoutBoardNamesAbove ?? 3,
    checkoutBoardStaleMin: c.checkoutBoardStaleMin ?? 8,
    checkoutBoardFrom: parseHHMM(c.checkoutBoardFrom) == null ? PICKUP_FROM : c.checkoutBoardFrom,
    checkoutBoardUntil: parseHHMM(c.checkoutBoardUntil) == null ? PICKUP_UNTIL : c.checkoutBoardUntil,
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
    checkoutBoardFrom: parseHHMM(f.checkoutBoardFrom) == null ? PICKUP_FROM : f.checkoutBoardFrom,
    checkoutBoardUntil: parseHHMM(f.checkoutBoardUntil) == null ? PICKUP_UNTIL : f.checkoutBoardUntil,
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
  onChange, onReplace, onReset, onClose, onTest, onResetTally, onOpenSlideEditor, onOpenDebug, onBoardDemo, configure = false,
  syncedDeck, slidesStatus, onForgetSyncedDeck,
  shared = null, shareStatus = null, onShare,
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

  const [section, setSectionState] = useState(() => openingSection(initialTab, {
    status, keyed, problems: problems.length,
  }));
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

  const goTo = (id) => {
    setSectionState(id);
    setView('section');
    onTabChange?.(id);
  };

  const reset = () => {
    if (window.confirm('Reset this screen? Every setting goes back to its default, and the typed slides saved on this device are deleted. The login, keys, uploaded files and the published deck stay.')) {
      onReset();
      onClose();
    }
  };

  const resetTally = () => {
    if (window.confirm("Reset tonight's counter to zero? It re-syncs from the print server's next count, and the “Doors are open” moment can play again tonight.")) onResetTally();
  };

  // #35: move a display's whole setup between machines as a JSON file.
  // Exports what differs from the baked defaults — device overrides plus any
  // ?config= values — so importing on a fresh install reproduces this screen
  // even when it was configured centrally and `overrides` is empty. Never
  // URL flags, never the panic mask, and structurally never the display key,
  // publish token or login key: sanitizeOverrides is VALIDATORS-bound and
  // none of the three is a config key (see src/lib/displayKey.js).
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
    onClose(); // get out of the way so the banner is visible
  };

  // Rail keys: a vertical tablist, so Up/Down (Left/Right too), Home and End.
  const onNavKeyDown = (e) => {
    const i = SECTIONS.findIndex((s) => s.id === section);
    let next = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = SECTIONS[(i + 1) % SECTIONS.length].id;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = SECTIONS[(i - 1 + SECTIONS.length) % SECTIONS.length].id;
    else if (e.key === 'Home') next = SECTIONS[0].id;
    else if (e.key === 'End') next = SECTIONS[SECTIONS.length - 1].id;
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

  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  const panicMode = (savedConfig ?? config)?.panicMode === true;
  const lowPowerForced = config?.reduceMotion === true && (savedConfig ?? config)?.reduceMotion !== true;
  const props = { form, set, update };

  let body;
  if (section === 'status') {
    body = (
      <StatusSection
        status={status} nameStatus={nameStatus} keyed={keyed} displayKey={displayKey} login={login}
        lastEventAt={lastEventAt} openedAt={openedAt} phase={phase} scheduleSource={scheduleSource}
        calendar={calendar} calendarEnabled={form.calendarEnabled} opsFailures={opsFailures}
        layerFaults={layerFaults} remoteConfigError={remoteConfigError} wakeLockStatus={wakeLockStatus}
        demoActive={demoActive} syncedDeck={syncedDeck} slidesStatus={slidesStatus}
        following={form.followPublishedSlides !== false} build={build} goTo={goTo}
        onReload={() => window.location.reload()}
      />
    );
  } else if (section === 'checkins') {
    body = <CheckinsSection {...props} onPreview={preview} />;
  } else if (section === 'slides') {
    body = (
      <SlidesSection
        {...props}
        slideCount={(savedConfig ?? config).manualSlides?.length || 0}
        onEditSlides={() => { flush(); onOpenSlideEditor(); }}
        syncedDeck={syncedDeck}
        today={localDateStr()}
      />
    );
  } else if (section === 'screen') {
    body = <ScreenSection {...props} panicMode={panicMode} onPanic={onPanic} wakeLockStatus={wakeLockStatus} lowPowerForced={lowPowerForced} />;
  } else if (section === 'celebrations') {
    body = <CelebrationsSection {...props} />;
  } else if (section === 'pickup') {
    body = <PickupSection {...props} onBoardDemo={onBoardDemo ? () => { flush(); onBoardDemo(); } : null} />;
  } else if (section === 'look') {
    body = <LookSection {...props} />;
  } else {
    body = (
      <SetupSection
        {...props}
        status={status} secure={secure} login={login}
        syncedDeck={syncedDeck} onForgetSyncedDeck={onForgetSyncedDeck}
        onOpenDebug={onOpenDebug ? () => { flush(); onOpenDebug(); } : null}
        onExport={exportSettings}
        onImport={() => importRef.current?.click()}
        onResetTally={onResetTally ? resetTally : null}
        onReset={reset}
        shared={shared}
        shareStatus={shareStatus}
        onShareNow={onShare ? () => { flush(); onShare(pickShared(normalize(formRef.current))); } : null}
      />
    );
  }

  const pill = {
    connected: keyed ? 'Connected' : 'Connected · not logged in',
    connecting: 'Connecting…',
    disconnected: 'Disconnected',
    off: 'Not set up',
  }[status] || status;

  return (
    <div className="panel-backdrop" onClick={done}>
      <div
        ref={dialogRef}
        className="panel panel--tabbed panel--settings"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        data-view={view}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-header">
          <img className="panel-mark" src={awanaClubsMark} alt="" draggable="false" />
          <h2>Settings</h2>
          <div className={`status-line ${status}`} role="status">
            <span className="dot" />
            <span>{pill}{problems.length ? ` · ${problems.length} to check` : ''}</span>
          </div>
        </div>

        <FollowingContext.Provider value={form.followSharedSettings !== false}>
        <div className="settings-main">
          <nav className="settings-nav" aria-label="Settings sections">
            <div role="tablist" aria-orientation="vertical" aria-label="Settings sections" onKeyDown={onNavKeyDown}>
              {SECTIONS.map((s) => {
                const badge = s.id === 'status' && problems.length ? problems.length
                  : s.id === 'setup' && (status === 'off' || !keyed) ? '!' : null;
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
                    <span className="settings-nav__blurb" id={`tab-${s.id}-blurb`}>{s.blurb}</span>
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
              <h3 className="settings-pane__title">{current.label}</h3>
            </div>
            <div className="panel-body" key={`${section}-${generation}`} onBlur={onPaneBlur} onKeyDown={onPaneKeyDown}>
              {body}
            </div>
          </section>
        </div>

        </FollowingContext.Provider>

        <div className="actions">
          <span className={`hint settings-live${shareStatus?.state === 'failed' ? ' hint--warn' : ''}`} aria-live="polite">
            {shareStatus?.state === 'sending' ? 'Sending to every screen…'
              : shareStatus?.state === 'sent' ? 'Sent to every screen.'
                : shareStatus?.state === 'failed' ? 'This screen only (see Setup → Shared settings).'
                  : configure ? 'Changes go live on the screen as you make them.'
                    : changed ? 'Changes are live on this screen.' : 'Changes apply as you make them.'}
          </span>
          <button type="button" className="ghost" onClick={undo} disabled={!changed}
            title="Put every setting back the way it was when you opened Settings (not the login, keys or uploaded files)">
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
