import { useEffect, useState } from 'react';
import CatalogScene from './CatalogScene.jsx';
import SlideCopy from './SlideCopy.jsx';
import CornerTab from './brand/CornerTab.jsx';
import { slideFrame } from '../lib/lobbyFrame.js';
import { getVideo } from '../lib/videoStore.js';
import {
  MAX_EYEBROW,
  MAX_SLIDES,
  MAX_TEXT,
  isVideoSlide,
  resolveSizeClass,
  resolveTheme,
  slideExpired,
  slideScheduled,
} from '../lib/slides.js';

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

const counter = (len, max) => (
  <span className={`hint slide-counter${len >= max * 0.9 ? ' hint--warn' : ''}`}>{len} / {max} characters</span>
);

export default function SlideCard({
  slide,
  i,
  slidesLength,
  today,
  cardRef,
  patch,
  moveAndFocus,
  duplicate,
  remove,
}) {
  return (
    <div className="slide-card" key={slide.id} ref={cardRef}>
      {/* The index line names the card with the kit's corner tab, as
          the dashboard's cards are named. Same element, same focus
          target after a move; it now reads before the preview. */}
      <CornerTab color="var(--brand-blue)" className="slide-card-tab">
        <div className="slide-card-index" tabIndex={-1}>
          Slide {i + 1} of {slidesLength}{isVideoSlide(slide) ? ' · video' : ''}
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
          <button className="ghost" data-move="down" onClick={() => moveAndFocus(i, i + 1, slide.id, 'down')} disabled={i === slidesLength - 1} aria-label={`Move slide ${i + 1} down`}>↓</button>
          <button className="ghost" data-move="bottom" onClick={() => moveAndFocus(i, slidesLength - 1, slide.id, 'bottom')} disabled={i === slidesLength - 1} aria-label={`Move slide ${i + 1} to the bottom`}>Bottom</button>
          <button className="ghost" onClick={() => duplicate(i)} disabled={slidesLength >= MAX_SLIDES}>Duplicate</button>
          <button className="danger" onClick={() => remove(slide.id)}>Delete</button>
        </div>
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
