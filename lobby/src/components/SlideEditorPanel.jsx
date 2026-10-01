import { useEffect, useRef, useState } from 'react';
import CatalogScene from './CatalogScene.jsx';
import SlideCopy from './SlideCopy.jsx';
import { slideFrame } from '../lib/lobbyFrame.js';
import {
  MAX_EYEBROW,
  MAX_SLIDES,
  MAX_TEXT,
  VIDEO_SIZE_WARN_BYTES,
  isVideoSlide,
  makeSlide,
  makeSlideId,
  makeVideoSlide,
  mergeSyncedDeck,
  resolveSizeClass,
  resolveTheme,
  sanitizeSlides,
  slideExpired,
  slideScheduled,
} from '../lib/slides.js';
import { collectGarbage, getVideo, makeVideoId, putVideo } from '../lib/videoStore.js';
import { localDateStr } from '../lib/calendarLogic.js';
import { publishDeck } from '../lib/publishDeck.js';
import { loadPublishToken } from '../lib/publishToken.js';
import { publishViaSync, useSync } from '../hooks/useSync.js';
import CornerTab from './brand/CornerTab.jsx';
import awanaClubsMark from '../../shared/brand/logos/awana-clubs-white.svg';

const THEME_OPTIONS = [
  { value: 'auto', label: 'Auto (rotate)' },
  { value: 'sky', label: 'Sky & orange wave' },
  { value: 'sunset', label: 'Sunset cream' },
  { value: 'night', label: 'Night blue' },
  { value: 'meadow', label: 'Meadow green' },
  { value: 'lavender', label: 'Lavender' },
];

const SIZE_OPTIONS = [
  { value: 'auto', label: 'Auto (fit)' },
  { value: 'xl', label: 'Extra large' },
  { value: 'lg', label: 'Large' },
  { value: 'md', label: 'Medium' },
];

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The typed-slides editor: free-type the text for each background
 * slide, no PowerPoint needed. Slides live in the same saved settings
 * as everything else, so Save here persists them on this device.
 *
 * Video slides: the file is stored in this browser's local storage
 * (IndexedDB) and NEVER uploaded — a deck exported as JSON carries
 * only the video's name, so other devices need the file re-added.
 *
 * `config` is the STORED config (never the panic mask or URL flags).
 */
export default function SlideEditorPanel({ config, syncedDeck, onChange, onClose }) {
  // When this screen follows a published deck, what's on the wall is that
  // deck merged with this device's own video slides (mergeSyncedDeck — video
  // bytes never ride a publish), so that merged view is what the editor
  // opens — otherwise editing would silently start from a stale local copy,
  // or lose the videos. Snapshotted at open: if a new publish lands while
  // this panel is up, the banner must keep describing the deck the editor
  // actually opened, not drift to a rev it doesn't contain (that case is
  // surfaced separately, see `newerPublished`).
  const [seededDeck] = useState(() => syncedDeck);
  const [initialSlides] = useState(() => (
    seededDeck ? mergeSyncedDeck(seededDeck.slides, config.manualSlides) : sanitizeSlides(config.manualSlides)
  ));
  const [slides, setSlides] = useState(initialSlides);
  // The local date key (#345), read once when the panel opens — the editor is
  // a short-lived modal, and the badges only need to be right for the session
  // the operator is typing in. LOCAL, never toISOString(): a UTC date in a
  // US-Eastern evening is already tomorrow, i.e. exactly club hours.
  const [today] = useState(localDateStr);
  const [importError, setImportError] = useState('');
  const [videoError, setVideoError] = useState('');
  // { phase: 'idle'|'busy'|'ok'|'edited'|'err', message, deckRev }
  const [publishState, setPublishState] = useState({ phase: 'idle', message: '', deckRev: null });
  // Read once at open: with a token this machine can publish, so Publish is
  // the loud button; without one it can only fail, so Save leads.
  // Signed in to the sync service, any screen can publish.
  const sync = useSync();
  const viaSync = Boolean(sync.url && sync.signedIn);
  const [hadToken] = useState(() => Boolean(loadPublishToken()));
  const hasToken = viaSync || hadToken;
  const fileRef = useRef(null);
  const videoFileRef = useRef(null);
  const cardRefs = useRef({});
  // A pending "put focus back on the moved card" request, consumed by the
  // effect below once the reordered list has rendered.
  const focusReqRef = useRef(null);

  // Every mutation goes through here so a stale "Published rev N" banner can
  // never sit above unpublished changes, and an error clears once the
  // operator starts fixing things.
  const edit = (fn) => {
    setSlides(fn);
    setPublishState((p) => {
      if (p.phase === 'ok') {
        return { phase: 'edited', deckRev: p.deckRev, message: `Edited since rev ${p.deckRev} was published — press Publish to all displays again to send these changes.` };
      }
      if (p.phase === 'err') return { phase: 'idle', message: '', deckRev: null };
      return p;
    });
  };

  const patch = (id, changes) => {
    edit((prev) => prev.map((s) => (s.id === id ? { ...s, ...changes } : s)));
  };

  const move = (from, to) => {
    edit((prev) => {
      if (to < 0 || to >= prev.length || from === to) return prev;
      const next = [...prev];
      const [slide] = next.splice(from, 1);
      next.splice(to, 0, slide);
      return next;
    });
  };

  // Keep the keyboard/remote where the operator left it: after a move, focus
  // the same arrow on the moved card (or its index line if that arrow is now
  // disabled), so repeated presses keep working.
  const moveAndFocus = (from, to, id, action) => {
    focusReqRef.current = { id, action };
    move(from, to);
  };
  useEffect(() => {
    const req = focusReqRef.current;
    if (!req) return;
    focusReqRef.current = null;
    const card = cardRefs.current[req.id];
    const btn = card?.querySelector(`[data-move="${req.action}"]`);
    (btn && !btn.disabled ? btn : card?.querySelector('.slide-card-index'))?.focus();
  }, [slides]);

  const duplicate = (index) => {
    edit((prev) => {
      if (prev.length >= MAX_SLIDES) return prev;
      const next = [...prev];
      // A duplicated video slide shares the same stored file on
      // purpose — garbage collection counts references per deck.
      next.splice(index + 1, 0, { ...prev[index], id: makeSlideId() });
      return next;
    });
  };

  // A blank slide goes without asking; anything with content asks first.
  const remove = (id) => {
    const s = slides.find((x) => x.id === id);
    const hasContent = s && (isVideoSlide(s) || s.text.trim() || s.eyebrow.trim());
    if (hasContent && !window.confirm(isVideoSlide(s)
      ? `Delete the video slide “${s.videoName || 'Video'}”? Its file is removed from this device when you save.`
      : 'Delete this slide?')) return;
    edit((prev) => prev.filter((x) => x.id !== id));
  };

  const addSlide = () => {
    edit((prev) => (prev.length >= MAX_SLIDES ? prev : [...prev, makeSlide()]));
  };

  const onVideoPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file || slides.length >= MAX_SLIDES) return;
    if (
      file.size > VIDEO_SIZE_WARN_BYTES &&
      !window.confirm(`${Math.round(file.size / 1e6)} MB is a large file — it may be slow to store and play on the signage machine. Add it anyway?`)
    ) return;
    const videoId = makeVideoId();
    try {
      await putVideo(videoId, file);
      edit((prev) => [...prev, makeVideoSlide({ videoId, videoName: file.name, videoSize: file.size })]);
      setVideoError('');
    } catch {
      setVideoError("Couldn't store that video on this device — browser storage may be blocked (private window) or full.");
    }
  };

  // Blobs are only garbage-collected when the editor closes, against
  // whichever deck is actually persisted at that moment: Save reaps
  // videos removed this session; Cancel reaps this session's abandoned
  // additions while keeping everything the saved deck still uses.
  const gcAgainst = (deck) => {
    collectGarbage(sanitizeSlides(deck).filter(isVideoSlide).map((s) => s.videoId));
  };

  const save = () => {
    const next = sanitizeSlides(slides);
    // In follow mode the editor opened the published deck merged with this
    // device's video slides, and Save replaces the locally saved deck with
    // it. Warn only when that genuinely loses something: a video slide whose
    // file is garbage-collected the moment no saved deck references it, or a
    // locally typed slide that exists nowhere in the editor (a pre-follow
    // deck being overwritten). A routine save must not nag.
    if (seededDeck) {
      const local = sanitizeSlides(config.manualSlides);
      const keptVideoIds = new Set(next.filter(isVideoSlide).map((s) => s.videoId));
      const lostVideos = local.filter(isVideoSlide).filter((s) => !keptVideoIds.has(s.videoId)).length;
      const keptTexts = new Set(next.filter((s) => !isVideoSlide(s)).map((s) => s.text));
      const lostTexts = local.filter((s) => !isVideoSlide(s)).filter((s) => !keptTexts.has(s.text)).length;
      const losses = [
        lostTexts ? `${lostTexts} typed slide${lostTexts === 1 ? '' : 's'}` : '',
        lostVideos ? `${lostVideos} video slide${lostVideos === 1 ? '' : 's'} (file${lostVideos === 1 ? '' : 's'} DELETED from this device)` : '',
      ].filter(Boolean).join(' and ');
      if (losses && !window.confirm(
        `Saving replaces the deck saved on THIS device — ${losses} not in the editor will be lost. Continue?`)) {
        return;
      }
    }
    onChange({ manualSlides: next });
    gcAgainst(next);
    onClose();
  };

  // Someone else published while this editor was open: the live prop moved
  // past the snapshot the editor opened, and it is not this editor's own
  // publish echoing back. Publishing now would silently replace their deck.
  const newerPublished = syncedDeck
    && syncedDeck.deckRev !== (seededDeck?.deckRev ?? null)
    && syncedDeck.deckRev !== (publishState.deckRev ?? null)
    ? syncedDeck
    : null;

  const calendarOn = config.calendarEnabled !== false;

  // Publish to every display, via the print server. Local save happens FIRST,
  // so a failed publish never loses an edit; the deck that goes out is
  // text-only (video bytes exist only in this browser's storage).
  const publishAll = async () => {
    const next = sanitizeSlides(slides);
    const videoCount = next.filter(isVideoSlide).length;
    const textCount = next.length - videoCount;
    if (textCount === 0 && !window.confirm(
      'Publish an EMPTY deck?\n\nEvery display drops its typed slides until something new is published — screens with calendar slides on keep showing those; the rest show the welcome placeholder.')) return;
    if (videoCount > 0 && !window.confirm(
      `${videoCount} video slide${videoCount === 1 ? ' stays' : 's stay'} on THIS device — the published deck carries text slides only.\n\nPublish the ${textCount} text slide${textCount === 1 ? '' : 's'} to every display?`)) return;
    if (newerPublished && !window.confirm(
      `Someone published rev ${newerPublished.deckRev} while this editor was open. Publish anyway and replace their deck?`)) return;
    // Save-local-first, in BOTH modes: a failed publish never loses an edit,
    // and the locally saved copy is what lets mergeSyncedDeck() keep this
    // device's video slides — in the order arranged here — in the rotation
    // once the new publish comes back. This can no longer destroy local
    // videos as a side effect: in follow mode the editor opened the merged
    // deck, so this device's video slides are in `next` unless the operator
    // deleted them on purpose.
    onChange({ manualSlides: next });
    gcAgainst(next);
    setPublishState({ phase: 'busy', message: 'Publishing…', deckRev: null });
    const result = viaSync
      ? await publishViaSync('slides', next)
      : await publishDeck(next, loadPublishToken());
    if (result.ok) {
      setPublishState({
        phase: 'ok',
        deckRev: result.deckRev,
        message: `Published rev ${result.deckRev} (${plural(result.slideCount, 'slide')}). When this screen shows the new deck, the whole pipe is confirmed — every online display receives the same broadcast, and screens that are off catch up within ~5 minutes of coming back.`,
      });
    } else {
      // Export-and-paste is a real workaround only when the TOKEN is the
      // problem (the dashboard needs none). A deck the server rejected as
      // too large fails identically through the dashboard, so say nothing
      // extra there — the server's message already says what to shorten.
      const fallback = result.reason === 'auth' && !viaSync
        ? ' This machine has no valid publish token — log in under Settings → Setup → Connect this screen, or paste a token under Settings → Setup → Publishing slides. Or press Export and paste the file into the print-server dashboard → Lobby Slides → Publish.'
        : '';
      setPublishState({ phase: 'err', message: `${result.message}${fallback}`, deckRev: null });
    }
  };

  const cancel = () => {
    gcAgainst(config.manualSlides);
    onClose();
  };

  // Compared after sanitizing, so an added-then-abandoned blank slide is not
  // "a change" but any real text, order or video edit is.
  const dirty = JSON.stringify(sanitizeSlides(slides)) !== JSON.stringify(sanitizeSlides(initialSlides));
  const requestClose = () => {
    if (!dirty || window.confirm('Discard the changes to these slides?')) cancel();
  };
  // Escape goes through the same guard. The latest closure is parked in a
  // ref (updated after each render) so the listener is attached once.
  const requestCloseRef = useRef(requestClose);
  useEffect(() => { requestCloseRef.current = requestClose; });
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') requestCloseRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Slides are saved per-device (browser storage), so export/import is
  // how a deck typed at home gets onto the signage machine.
  const exportSlides = () => {
    const blob = new Blob([JSON.stringify(sanitizeSlides(slides), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'awana-slides.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const importSlides = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-importing the same file
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = sanitizeSlides(JSON.parse(reader.result));
        if (imported.length === 0) {
          setImportError('That file has no usable slides in it.');
          return;
        }
        if (slides.length > 0 && !window.confirm(`Replace the ${slides.length} slide(s) here with the ${imported.length} from the file?`)) {
          return;
        }
        edit(() => imported);
        setImportError('');
      } catch {
        setImportError("Couldn't read that file — it isn't a slides JSON export.");
      }
    };
    reader.onerror = () => setImportError("Couldn't read that file.");
    reader.readAsText(file);
  };

  const blankCount = slides.filter((s) => !isVideoSlide(s) && s.text.trim() === '').length;
  const counter = (len, max) => (
    <span className={`hint slide-counter${len >= max * 0.9 ? ' hint--warn' : ''}`}>{len} / {max} characters</span>
  );

  return (
    <div className="panel-backdrop" onClick={requestClose}>
      <div className="panel panel--tabbed panel--slides" role="dialog" aria-label="Typed slides" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <img className="panel-mark" src={awanaClubsMark} alt="" draggable="false" />
          <h2>Typed Slides</h2>
          <div className="hint panel-sub">
            {slides.length} of {MAX_SLIDES} slides
            {seededDeck ? ` · opened from published rev ${seededDeck.deckRev}` : ''}
            {dirty ? ' · unsaved changes' : ''}
          </div>
        </div>

        <div className="panel-body">
          <div className="hint panel-intro">
            Free-type the background slides — no PowerPoint needed — and mix in local video
            files. Videos are stored on <strong>this device only</strong> and never uploaded.
            {config.backgroundSource !== 'manual' && (
              <> This screen&rsquo;s background source is not <strong>Typed slides</strong> — switch it in
              Settings → Slides to put these on screen.</>
            )}
          </div>

          {seededDeck && (
            <div className="hint panel-note">
              <strong>This editor opened the published deck (rev {seededDeck.deckRev})</strong> plus
              this device&rsquo;s own video slides — what this screen is showing.
              <strong> Save slides</strong> keeps video slides (and their order) showing on this
              screen; changed <em>text</em> only reaches the wall via
              <strong> Publish to all displays</strong>, which sends the text slides to every
              screen — video files never leave the device they were added on.
            </div>
          )}

          {slides.length === 0 && (
            <div className="slide-empty">
              No slides yet — press <strong>Add slide</strong> below and just start typing,
              or <strong>Add video</strong> to drop in a local video file.
            </div>
          )}

          {slides.map((slide, i) => (
            <div className="slide-card" key={slide.id} ref={(el) => { cardRefs.current[slide.id] = el; }}>
              {/* The index line names the card with the kit's corner tab, as
                  the dashboard's cards are named. Same element, same focus
                  target after a move; it now reads before the preview. */}
              <CornerTab color="var(--brand-blue)" className="slide-card-tab">
                <div className="slide-card-index" tabIndex={-1}>
                  Slide {i + 1} of {slides.length}{isVideoSlide(slide) ? ' · video' : ''}
                  {/* The row is never hidden when its window closes — an
                      operator has to be able to see and fix the slide that
                      stopped showing. */}
                  {slideExpired(slide, today) && <span className="slide-window-badge is-expired">Expired</span>}
                  {slideScheduled(slide, today) && <span className="slide-window-badge is-scheduled">Starts later</span>}
                </div>
              </CornerTab>
              <div className="slide-card-preview" aria-hidden>
                <div className="slide-card-frame">
                  {isVideoSlide(slide) ? (
                    <VideoThumb videoId={slide.videoId} />
                  ) : (
                    <CatalogScene theme={resolveTheme(slide, i)} still>
                      {/* The TV's own frame and fit, frozen: same sizes,
                          same line breaks, no loops. */}
                      <div className="lobby-stage manual-slide-copy">
                        <SlideCopy
                          frame={slideFrame(slide.text ? slide : { ...slide, text: 'Your text here…' })}
                          theme={resolveTheme(slide, i)}
                          sizeClass={resolveSizeClass(slide)}
                          slide
                          still
                        />
                      </div>
                    </CatalogScene>
                  )}
                </div>
              </div>

              <div className="slide-card-fields">
                {isVideoSlide(slide) ? (
                  <>
                    <div className="slide-card-video-meta">
                      <strong>{slide.videoName || 'Video'}</strong>
                      {slide.videoSize > 0 && <span> · {(slide.videoSize / 1e6).toFixed(1)} MB</span>}
                    </div>
                    <div className="field">
                      <label htmlFor={`dur-${slide.id}`}>Seconds on screen</label>
                      <input
                        id={`dur-${slide.id}`}
                        type="number"
                        min="0"
                        max="600"
                        step="1"
                        value={slide.durationSec}
                        onChange={(e) => patch(slide.id, { durationSec: Number(e.target.value) })}
                      />
                      <span className="hint">0 = play the video to the end, then advance.</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="field">
                      <label htmlFor={`eyebrow-${slide.id}`}>Small top line (optional)</label>
                      <input
                        id={`eyebrow-${slide.id}`}
                        type="text"
                        maxLength={MAX_EYEBROW}
                        value={slide.eyebrow}
                        onChange={(e) => patch(slide.id, { eyebrow: e.target.value })}
                        placeholder="Awana Clubs"
                      />
                      {counter(slide.eyebrow.length, MAX_EYEBROW)}
                    </div>
                    <div className="field">
                      <label htmlFor={`text-${slide.id}`}>Slide text</label>
                      <textarea
                        id={`text-${slide.id}`}
                        rows={3}
                        maxLength={MAX_TEXT}
                        value={slide.text}
                        onChange={(e) => patch(slide.id, { text: e.target.value })}
                        placeholder={'Welcome to\nAwana!'}
                      />
                      {counter(slide.text.length, MAX_TEXT)}
                    </div>
                    <div className="slide-card-row">
                      <div className="field">
                        <label htmlFor={`theme-${slide.id}`}>Look</label>
                        <select
                          id={`theme-${slide.id}`}
                          value={slide.theme}
                          onChange={(e) => patch(slide.id, { theme: e.target.value })}
                        >
                          {THEME_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor={`size-${slide.id}`}>Text size</label>
                        <select
                          id={`size-${slide.id}`}
                          value={slide.textSize || 'auto'}
                          onChange={(e) => patch(slide.id, { textSize: e.target.value })}
                        >
                          {SIZE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor={`dur-${slide.id}`}>Seconds on screen</label>
                        <input
                          id={`dur-${slide.id}`}
                          type="number"
                          min="0"
                          max="600"
                          step="1"
                          value={slide.durationSec}
                          onChange={(e) => patch(slide.id, { durationSec: Number(e.target.value) })}
                        />
                        <span className="hint">0 = use the global slide delay from Settings.</span>
                      </div>
                    </div>
                    {/* Optional show window (#345): a dated announcement
                        retires itself instead of advertising last month's
                        store night. Both dates are inclusive and local. */}
                    <div className="slide-card-row">
                      <div className="field">
                        <label htmlFor={`from-${slide.id}`}>Show from (optional)</label>
                        <input
                          id={`from-${slide.id}`}
                          type="date"
                          value={slide.showFrom || ''}
                          onChange={(e) => patch(slide.id, { showFrom: e.target.value })}
                        />
                        <span className="hint">Blank = show it straight away.</span>
                      </div>
                      <div className="field">
                        <label htmlFor={`until-${slide.id}`}>Show until (optional)</label>
                        <input
                          id={`until-${slide.id}`}
                          type="date"
                          value={slide.showUntil || ''}
                          onChange={(e) => patch(slide.id, { showUntil: e.target.value })}
                        />
                        <span className="hint">
                          Last day it shows, included — then it retires itself on every screen.
                        </span>
                      </div>
                    </div>
                  </>
                )}
                {/* Rebrand stage 4: a slide the room should see without a
                    check-in banner over it (a pick-up notice, a safety
                    reminder). Arriving names wait behind a WAITING chip and
                    then play, each for their full time, on the next slide. */}
                <label className="slide-card-hold">
                  <input
                    type="checkbox"
                    checked={slide.holdCheckIns === true}
                    onChange={(e) => patch(slide.id, { holdCheckIns: e.target.checked ? true : undefined })}
                  />
                  <span>
                    <strong>Hold check-ins while this slide is up</strong>
                    <span className="hint">
                      Arriving names wait, then play in full on the next slide. The fall event posters always do this.
                    </span>
                  </span>
                </label>
                <div className="slide-card-controls">
                  <button className="ghost" data-move="top" onClick={() => moveAndFocus(i, 0, slide.id, 'top')} disabled={i === 0} aria-label={`Move slide ${i + 1} to the top`}>Top</button>
                  <button className="ghost" data-move="up" onClick={() => moveAndFocus(i, i - 1, slide.id, 'up')} disabled={i === 0} aria-label={`Move slide ${i + 1} up`}>↑</button>
                  <button className="ghost" data-move="down" onClick={() => moveAndFocus(i, i + 1, slide.id, 'down')} disabled={i === slides.length - 1} aria-label={`Move slide ${i + 1} down`}>↓</button>
                  <button className="ghost" data-move="bottom" onClick={() => moveAndFocus(i, slides.length - 1, slide.id, 'bottom')} disabled={i === slides.length - 1} aria-label={`Move slide ${i + 1} to the bottom`}>Bottom</button>
                  <button className="ghost" onClick={() => duplicate(i)} disabled={slides.length >= MAX_SLIDES}>Duplicate</button>
                  <button className="danger" onClick={() => remove(slide.id)}>Delete</button>
                </div>
              </div>
            </div>
          ))}

          {importError && <div className="slide-editor-error">{importError}</div>}
          {videoError && <div className="slide-editor-error">{videoError}</div>}
          {blankCount > 0 && (
            <div className="hint" style={{ marginBottom: '0.75rem' }}>
              {blankCount} empty slide{blankCount > 1 ? 's' : ''} will be skipped when you save — type something in first.
            </div>
          )}
          {slides.length === 0 && config.backgroundSource === 'manual' && (
            <div className="hint" style={{ marginBottom: '0.75rem' }}>
              {calendarOn
                ? 'With no slides saved, the calendar slides play on their own.'
                : 'With no slides saved, the screen shows the welcome placeholder instead.'}
            </div>
          )}
          {slides.length > 0 && slides.every((s) => slideExpired(s, today)) && (
            <div className="hint" style={{ marginBottom: '0.75rem' }}>
              Every slide&rsquo;s show-until date has passed, so the screens are
              {calendarOn ? ' playing the calendar slides instead' : ' showing the welcome placeholder'} —
              never a blank background. Clear a date, or push it out, to bring a slide back.
            </div>
          )}
          {slides.some(isVideoSlide) && (
            <div className="hint" style={{ marginBottom: '0.75rem' }}>
              Export carries a video slide's <em>name</em> only — the file stays on this device.
              After importing a deck on another machine, delete its "missing" video slides and
              re-add the files there.
            </div>
          )}
        </div>

        {newerPublished && (
          <div className="slide-editor-error" role="alert" style={{ margin: '0.75rem 2rem 0' }}>
            Someone published rev {newerPublished.deckRev} ({plural(newerPublished.slides.length, 'slide')}) while this
            editor was open. Publishing now replaces their deck with this one — press Cancel and reopen the editor
            to start from theirs.
          </div>
        )}

        <div className="actions">
          <button className="ghost" onClick={addSlide} disabled={slides.length >= MAX_SLIDES}>
            + Add slide
          </button>
          <button className="ghost" onClick={() => videoFileRef.current?.click()} disabled={slides.length >= MAX_SLIDES}>
            + Add video
          </button>
          <input
            ref={videoFileRef}
            type="file"
            accept="video/mp4,video/webm,video/*"
            style={{ display: 'none' }}
            onChange={onVideoPick}
          />
          <button className="ghost" onClick={exportSlides} disabled={slides.length === 0}>Export</button>
          <button className="ghost" onClick={() => fileRef.current?.click()}>Import</button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={importSlides}
          />
          <button onClick={requestClose}>Cancel</button>
          <button className={hasToken ? 'secondary' : 'primary'} onClick={save}>Save slides</button>
          <button
            className={hasToken ? 'primary' : 'secondary'}
            onClick={publishAll}
            disabled={publishState.phase === 'busy'}
            title={hasToken
              ? 'Send this deck to every display, via the print server'
              : 'Needs a publish token — log in under Settings → Setup → Connect this screen, or paste one under Settings → Setup → Publishing slides'}
          >
            {publishState.phase === 'busy' ? 'Publishing…' : 'Publish to all displays'}
          </button>
        </div>
        {publishState.phase !== 'idle' && publishState.phase !== 'busy' && (
          <div
            className={publishState.phase === 'err' ? 'slide-editor-error' : 'hint'}
            style={{ margin: '0.75rem 2rem 0' }}
            role="status"
          >
            {publishState.message}
          </div>
        )}
      </div>
    </div>
  );
}

// Small paused preview of a stored video; a film glyph with an amber
// badge when the file isn't in this browser's storage (e.g. the deck
// was imported from another device).
function VideoThumb({ videoId }) {
  const [src, setSrc] = useState(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let url = null;
    getVideo(videoId).then((blob) => {
      if (cancelled) return;
      if (!blob) {
        setMissing(true);
        return;
      }
      url = URL.createObjectURL(blob);
      setSrc(url);
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [videoId]);

  return (
    <div className="slide-card-video-thumb">
      {src ? (
        <video src={src} preload="metadata" muted />
      ) : (
        <span className="slide-card-video-glyph" aria-hidden>▶</span>
      )}
      {missing && <span className="slide-badge-missing">Video not on this device</span>}
    </div>
  );
}
