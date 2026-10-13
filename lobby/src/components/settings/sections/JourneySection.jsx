import { useCallback, useEffect, useRef, useState } from 'react';
import { useSync } from '../../../hooks/useSync.js';
import { listScreens, saveScreenSettings, sendScreenAction } from '../../../hooks/useScreenSync.js';
import {
  AUTO_ADVANCE_CHOICES, CAPTION_SIZE_WORDS, DOWNLOAD_BUTTON_WORDS, JOURNEY_CAPTION_SIZES, JOURNEY_SLIDE_KINDS, SLIDE_EXTRA_WORDS,
  downloadButtons, fetchJourney, journeyView, saveJourney,
} from '../../../lib/journeyClient.js';
import { PanelCard, Toggle } from '../fields.jsx';
import { ScreenGlyph, ScreenState, lessonBytes, lessonStatusWords, seenWords } from '../screens.jsx';

// /settings → Journey (owner 2026-10-12: the Journey kiosk's own Settings
// "really live in the master settings page"): the ROOM settings every Journey
// kiosk follows (captions, the teaching slides), from the sync Worker's one
// journey document (lib/journeyClient.js), and every kiosk's saved lessons
// with its download buttons and two switches. The kiosk keeps all of these in
// its own Settings too (the fallback at the PC); the lesson picker and the
// bullet editor stay only there (owner's choice). The settings page only: a
// TV's own panel has no Journey section.

/** How often the kiosk list re-reads (a kiosk says hello every 2 min, sooner after a press). */
export const KIOSKS_REFRESH_MS = 15 * 1000;
/** After a press, the list re-reads this often for a little while, so the answer shows up. */
export const KIOSKS_AFTER_PRESS_MS = 3 * 1000;
const AFTER_PRESS_FOR_MS = 45 * 1000;

/** The room document: loaded once on opening; every change reads the newest and sends the whole. */
function useJourneyRoom() {
  const { signedIn } = useSync();
  const [doc, setDoc] = useState(/** @type {import('../../../lib/journeyClient.js').JourneyDoc | null} */ (null));
  const [state, setState] = useState(/** @type {'loading' | 'ready' | 'error'} */ ('loading'));
  const [note, setNote] = useState(/** @type {{ text: string, warn?: boolean, card?: string } | null} */ (null));
  useEffect(() => {
    if (!signedIn) return undefined;
    let live = true;
    fetchJourney().then((r) => {
      if (!live) return;
      if (r.ok) { setDoc(r.doc); setState('ready'); }
      else { setState('error'); setNote({ warn: true, text: r.message }); }
    });
    return () => { live = false; };
  }, [signedIn]);
  const chain = useRef(Promise.resolve());
  /** @param {Record<string, any>} changes @param {string} card which card says how it went */
  const save = useCallback((changes, card) => {
    // Optimistic: the control moves at once; one save at a time, in order.
    setDoc((d) => ({ savedAt: d?.savedAt || '', settings: { ...(d?.settings || {}), ...changes, ...(changes.slideExtras ? { slideExtras: { ...(d?.settings?.slideExtras || {}), ...changes.slideExtras } } : {}) } }));
    setNote({ text: 'Saving…', card });
    chain.current = chain.current.then(async () => {
      const r = await saveJourney(changes);
      if (r.ok) { setDoc(r.doc); setNote({ text: 'Saved. Every Journey kiosk takes it within seconds (one that is off, when it next starts).', card }); }
      else setNote({ warn: true, text: `Not saved: ${r.message}`, card });
    });
  }, []);
  return { doc, state, note, save, view: journeyView(doc) };
}

/** How the last change of this card went (or why the document could not load). */
function RoomNote({ room, card }) {
  const n = room.note;
  if (!n || (n.card && n.card !== card)) return null;
  return <p className={`hint${n.warn ? ' hint--warn' : ''}`} role="status">{n.text}</p>;
}

/** Captions on the lesson videos, for every Journey kiosk. */
export function JourneyCaptionsCard({ room }) {
  const v = room.view;
  const off = room.state !== 'ready';
  return (
    <PanelCard title="Captions" tab="var(--brand-journey)" scope="journey">
      <Toggle
        checked={v.captions === true}
        disabled={off}
        onChange={(e) => room.save({ captions: e.target.checked }, 'captions')}
        title="Show captions on the lesson videos"
        hint={v.captions === null
          ? 'Not set yet: each kiosk asks “Show captions?” once. The CC button on the video still turns them on or off for the lesson that is playing.'
          : 'Every Journey kiosk starts each lesson video this way. The CC button on the video still turns them on or off for the lesson that is playing.'}
      />
      <div className="field">
        <label htmlFor="journey-caption-size">Text size</label>
        <select id="journey-caption-size" value={v.captionSize} disabled={off} onChange={(e) => room.save({ captionSize: e.target.value }, 'captions')}>
          {JOURNEY_CAPTION_SIZES.map((size) => <option key={size} value={size}>{/** @type {any} */ (CAPTION_SIZE_WORDS)[size] || size}</option>)}
        </select>
        <span className="hint">How big the captions are while they are on.</span>
      </div>
      <Toggle
        checked={v.captionBackdrop}
        disabled={off}
        onChange={(e) => room.save({ captionBackdrop: e.target.checked }, 'captions')}
        title="Dark backdrop"
        hint="A solid band behind the caption text, for bright video."
      />
      <RoomNote room={room} card="captions" />
    </PanelCard>
  );
}

/** The teaching slides after the video, for every Journey kiosk. */
export function JourneySlidesCard({ room }) {
  const v = room.view;
  const off = room.state !== 'ready';
  return (
    <PanelCard title="Teaching slides" tab="var(--brand-trek)" scope="journey">
      <p className="hint panel-intro">Awana&rsquo;s teaching slides for the lesson play once the video ends.</p>
      <div className="field">
        <label htmlFor="journey-auto-advance">Auto-advance</label>
        <select id="journey-auto-advance" value={String(v.slidesAutoAdvanceSec)} disabled={off}
          onChange={(e) => room.save({ slidesAutoAdvanceSec: Number(e.target.value) }, 'slides')}>
          {/* A value set some other way (not one of these) still shows as itself. */}
          {!AUTO_ADVANCE_CHOICES.some((c) => c.value === v.slidesAutoAdvanceSec) && (
            <option value={String(v.slidesAutoAdvanceSec)}>Every {v.slidesAutoAdvanceSec} seconds</option>
          )}
          {AUTO_ADVANCE_CHOICES.map((c) => <option key={c.value} value={String(c.value)}>{c.label}</option>)}
        </select>
        <span className="hint">Off means the leader moves on (Space, the arrow keys, or a tap).</span>
      </div>
      <span className="field-label">Add to the end of the deck</span>
      {JOURNEY_SLIDE_KINDS.map((kind) => {
        const w = /** @type {any} */ (SLIDE_EXTRA_WORDS)[kind];
        return (
          <Toggle key={kind} checked={v.slideExtras[kind] !== false} disabled={off}
            onChange={(e) => room.save({ slideExtras: { [kind]: e.target.checked } }, 'slides')}
            title={w.title} hint={`The lesson's ${w.hint}.`} />
        );
      })}
      <p className="hint">Tonight&rsquo;s bullets for these slides are edited on the kiosk itself (its Settings → Edit tonight&rsquo;s bullets).</p>
      <RoomNote room={room} card="slides" />
    </PanelCard>
  );
}

/** A kiosk's overall progress, 0..100, from its bytes (null when nothing is known). @param {any} l */
export function overallPercent(l) {
  if (!l || l.known === false || l.supported === false || !(l.bytesTotal > 0)) return null;
  return Math.min(100, Math.floor((l.bytesSaved * 100) / l.bytesTotal));
}

/** One Journey kiosk: its lessons, its buttons and its two switches. */
function KioskRow({ kiosk, onPressed }) {
  const l = kiosk.status?.lessons ?? null;
  const words = lessonStatusWords(l);
  const pct = overallPercent(l);
  const { why, buttons } = downloadButtons(l, kiosk.online);
  const [note, setNote] = useState(/** @type {{ text: string, warn?: boolean } | null} */ (null));
  const [busy, setBusy] = useState(false);
  // A switch moves at once; the kiosk's own report takes over once it agrees.
  const [mine, setMine] = useState(/** @type {{ downloadsAuto?: boolean, downloadsLeader?: boolean }} */ ({}));
  const reported = { downloadsAuto: l ? l.auto === true : false, downloadsLeader: l ? l.leaders !== false : true };
  const prefs = { ...reported, ...mine };
  const canSet = Boolean(l) && l.supported !== false;

  /** @param {string} action */
  const press = async (action) => {
    if (action === 'delete-downloads' && !window.confirm(
      `Delete every downloaded lesson on ${kiosk.name}? Lessons then play from the internet again there, and downloading them again takes hours.`,
    )) return;
    setBusy(true);
    const res = await sendScreenAction(kiosk.id, action);
    setBusy(false);
    setNote(res.ok
      ? { text: `Sent. ${kiosk.name} does it within a few seconds; this list shows it shortly after.` }
      : { warn: true, text: res.message || 'Not sent.' });
    if (res.ok) onPressed();
  };

  /** @param {'downloadsAuto' | 'downloadsLeader'} key @param {boolean} value */
  const change = async (key, value) => {
    const next = { ...prefs, [key]: value };
    setMine(next);
    const res = await saveScreenSettings(kiosk.id, 'journey', next);
    setNote(res.ok
      ? { text: `Saved. ${kiosk.name} takes it within seconds${kiosk.online ? '' : ' of coming on'}.` }
      : { warn: true, text: `Not saved: ${res.message}` });
    if (res.ok) onPressed();
    else setMine({});
  };

  return (
    <li className="screen-row kiosk-lessons" data-screen={kiosk.id}>
      <div className="screen-row__main">
        <span className="screen-row__glyph"><ScreenGlyph kind="journey" /></span>
        <span className="screen-row__text">
          <span className="screen-row__name">{kiosk.name}</span>
          <span className="screen-row__meta"><ScreenState online={kiosk.online} /> · {kiosk.online ? 'seen' : 'last seen'} {seenWords(kiosk.lastSeen)}</span>
          <span className={`screen-row__status${kiosk.online ? '' : ' screen-row__status--stale'}`} data-testid="kiosk-lessons-words">
            {!words ? 'It has not reported its lessons yet.' : (
              <>
                {words.done && <><strong className="screen-row__done">All saved ✓</strong> · </>}
                {words.count}
                {words.state && <> · {words.state}</>}
                {words.saved && <> · {words.saved}</>}
                {words.error && <span className="screen-row__problem">{words.error}</span>}
              </>
            )}
          </span>
        </span>
      </div>
      <div className="screen-row__body">
        {pct !== null && (
          <div className="kiosk-lessons__progress">
            <div className="kiosk-lessons__bar" role="progressbar" aria-label={`Lessons saved on ${kiosk.name}`}
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`${pct}% saved`}>
              <span className="kiosk-lessons__fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="hint">
              {pct}% of {lessonBytes(l.bytesTotal)} saved
              {l.downloading && l.currentWeek ? ` · now Lesson ${l.currentWeek} at ${l.percent}%` : ''}
            </span>
          </div>
        )}
        <div className="kiosk-lessons__buttons" role="group" aria-label={`Downloads on ${kiosk.name}`}>
          {buttons.map((b) => (
            <button key={b.action} type="button" disabled={b.disabled || busy}
              className={b.action === 'delete-downloads' ? 'danger' : b.action === 'start-downloads' || b.action === 'resume-downloads' ? 'secondary' : 'ghost'}
              onClick={() => press(b.action)} data-action={b.action}>
              {DOWNLOAD_BUTTON_WORDS[/** @type {keyof typeof DOWNLOAD_BUTTON_WORDS} */ (b.action)]}
            </button>
          ))}
        </div>
        {why && <p className="hint">{why}</p>}
        <Toggle
          checked={prefs.downloadsAuto} disabled={!canSet}
          onChange={(e) => change('downloadsAuto', e.target.checked)}
          title="Download lessons automatically"
          hint="By itself, never during a lesson or from 5:30 PM to 8:00 PM."
        />
        <Toggle
          checked={prefs.downloadsLeader} disabled={!canSet}
          onChange={(e) => change('downloadsLeader', e.target.checked)}
          title="Include Leader Videos"
          hint="For previewing in the kiosk's Settings (about 3.2 GB more). A download already running keeps its list."
        />
        {note && <p className={`hint${note.warn ? ' hint--warn' : ''}`} role="status">{note.text}</p>}
      </div>
    </li>
  );
}

/** Every Journey kiosk's saved lessons: progress, the buttons, the two switches. */
export function JourneyLessonsCard({ goTo }) {
  const { signedIn } = useSync();
  const [state, setState] = useState(/** @type {{ kiosks: any[] | null, error: string }} */ ({ kiosks: null, error: '' }));
  const [fastUntil, setFastUntil] = useState(0);
  const load = useCallback(() => listScreens().then((res) => {
    setState(res.ok ? { kiosks: res.screens.filter((s) => s.kind === 'journey'), error: '' } : (s) => ({ ...s, error: res.message }));
  }), []);
  useEffect(() => {
    if (!signedIn) return undefined;
    load();
    const fast = Date.now() < fastUntil;
    const t = setInterval(() => {
      load();
      if (fast && Date.now() >= fastUntil) setFastUntil(0);
    }, fast ? KIOSKS_AFTER_PRESS_MS : KIOSKS_REFRESH_MS);
    return () => clearInterval(t);
  }, [signedIn, load, fastUntil]);

  const kiosks = state.kiosks || [];
  return (
    <PanelCard title="Lessons on the Journey PCs" tab="var(--brand-hot)">
      <p className="hint panel-intro">
        Each Journey PC can save every lesson&rsquo;s full-quality video ahead of time, so lessons play from the PC
        instead of the church&rsquo;s slow internet. The buttons here do what the kiosk&rsquo;s own Settings → Lessons on
        this computer does.
      </p>
      {state.kiosks === null && !state.error && <p className="hint" role="status">Looking for Journey kiosks…</p>}
      {state.error && <p className="hint hint--warn" role="status">{state.error}</p>}
      {state.kiosks !== null && kiosks.length === 0 && (
        <p className="hint">
          No Journey kiosk has signed in yet. Sign the kiosk in with the passphrase (its Settings → Sync) and it shows up
          here within a couple of minutes.
          {goTo && <>{' '}<button type="button" className="ghost small" onClick={() => goTo('screens')}>All screens →</button></>}
        </p>
      )}
      {kiosks.length > 0 && (
        <ul className="screen-list">
          {kiosks.map((k) => <KioskRow key={k.id} kiosk={k} onPressed={() => { setFastUntil(Date.now() + AFTER_PRESS_FOR_MS); }} />)}
        </ul>
      )}
    </PanelCard>
  );
}

/**
 * Journey (owner 2026-10-12, the settings page only): captions and the
 * teaching slides for every Journey kiosk, and each kiosk's saved lessons.
 */
export function JourneySection({ goTo }) {
  const { signedIn } = useSync();
  const room = useJourneyRoom();
  if (!signedIn) {
    return (
      <PanelCard title="Journey" tab="var(--brand-journey)">
        <p className="hint">Sign in under Account &amp; app to change the Journey kiosks from here.</p>
        {goTo && <button type="button" className="secondary section-jump" onClick={() => goTo('account')}>Sign in →</button>}
      </PanelCard>
    );
  }
  return (
    <>
      <JourneyCaptionsCard room={room} />
      <JourneySlidesCard room={room} />
      <JourneyLessonsCard goTo={goTo} />
    </>
  );
}
