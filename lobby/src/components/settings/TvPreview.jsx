import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ZeroAnimationContext } from '../../lib/motion.jsx';
import CatalogScene from '../CatalogScene.jsx';
import SlideCopy from '../SlideCopy.jsx';
import CheckInMoment from '../CheckInMoment.jsx';
import CheckoutBoard from '../CheckoutBoard.jsx';
import CornerChip from '../CornerChip.jsx';
import NoticeBanner from '../NoticeBanner.jsx';
import { SAMPLE_BOARD_NAMES, SAMPLE_NAMES } from '../../lib/demoNames.js';
import { getAllClubs } from '../../lib/clubs.js';
import { decideBoard, demoCheckout } from '../../lib/checkoutBoard.js';
import { slideFrame } from '../../lib/lobbyFrame.js';
import { isVideoSlide, resolveSizeClass, resolveTheme } from '../../lib/slides.js';
import { resolveSkin, sceneForSkin } from '../../lib/skins.js';
import '../../styles/settings-overhaul.css';

// The live TV preview (docs/SETTINGS-OVERHAUL.md section 6): the settings
// page's picture of what a TV will show, drawn by the REAL components in a
// fixed 1600x900 stage scaled to its column (the slide editor's thumbnail
// frame, `.slide-card-frame`, is the precedent), fed the panel's DRAFT form.
//
// Motion off: everything sits inside ZeroAnimationContext value={true}, so
// every `M` element renders its last keyframe, which is the finished frame
// (CLAUDE.md "Zero-animation / ?lowPower=1"). Pointer events off and
// aria-hidden; ONE role="img" label describes it. SAMPLE names only (never a
// child from mission control). Any throw lands on a static miniature, and two
// throws hide the preview. ?preview=0 turns it off.

export const STAGE_W = 1600;
export const STAGE_H = 900;
/** Two crashes and the preview hides itself. */
export const PREVIEW_MAX_THROWS = 2;
const SAMPLE_CHILD = SAMPLE_NAMES[0];

/** Is the preview wanted at all? ?preview=0 is the kill. @param {string} [search] */
export function previewEnabled(search = typeof window !== 'undefined' ? window.location.search : '') {
  try { return new URLSearchParams(search).get('preview') !== '0'; } catch { return true; }
}

/** What the picture is of, in words (the one accessible label). @param {string} focus */
export function previewLabel(focus) {
  return {
    slide: 'A preview of a slide on the TV, with the season’s look behind it.',
    welcome: 'A preview of a welcome banner on the TV for a made-up child.',
    pickup: 'A preview of the pickup board along the bottom of the TV, with made-up names.',
    corner: 'A preview of the corner chips on the TV.',
    notice: 'A preview of the notice banner on the TV.',
  }[focus] || 'A preview of the TV.';
}

/**
 * The corner items the form turns on, as the corner would freeze them.
 * @param {Record<string, any>} form
 */
export function cornerItemsFor(form) {
  /** @type {import('../../lib/cornerInfo.js').CornerSnapshot[]} */
  const items = [];
  if (form.showClock) items.push({ id: 'clock', corner: 'bottom', label: 'Right now', value: '7:56', spoken: 'Seven fifty-six PM' });
  if (form.showTally) {
    items.push({
      id: 'tally', corner: 'bottom', label: 'Tonight', value: '23', spoken: '23 checked in tonight',
      note: form.showTallySyncNote !== false ? 'synced with the check-in desk' : null, correction: form.showTallySyncNote !== false ? {} : null,
    });
  }
  if (form.showWeatherChip) items.push({ id: 'weather', corner: 'top', label: 'Cloudy', value: '58°', spoken: '58 degrees, cloudy', glyph: 'cloud' });
  return items;
}

/** The static miniature the preview falls back to (a wave, a plate, a first name, a corner chip). */
export function StaticMiniature({ focus }) {
  return (
    <div className="tv-mini" role="img" aria-label={`${previewLabel(focus)} (a simple drawing: the live preview could not be drawn)`}>
      <span className="tv-mini__wave" />
      <span className="tv-mini__plate"><span className="tv-mini__kicker">WELCOME</span><b>{SAMPLE_CHILD.toUpperCase()}</b></span>
      <span className="tv-mini__chip">RIGHT NOW <b>7:56</b></span>
    </div>
  );
}

let logged = false;

/** Catches a throw in the stage and says so (once) to the console. */
class PreviewBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { throws: 0 };
  }

  static getDerivedStateFromError() { return { thrown: true }; }

  componentDidCatch(error) {
    if (!logged) { logged = true; console.error('TvPreview: the live preview failed, showing the drawing instead:', error); }
    this.setState((s) => ({ throws: (s.throws || 0) + 1 }));
    this.props.onThrow?.();
  }

  componentDidUpdate(prev) {
    // A change of focus or draft gets one fresh try, until it has thrown twice.
    if (prev.resetKey !== this.props.resetKey && this.state.thrown && (this.state.throws || 0) < PREVIEW_MAX_THROWS) {
      this.setState({ thrown: false });
    }
  }

  render() {
    if (this.state.thrown) return this.props.fallback;
    return this.props.children;
  }
}

/** The 1600x900 picture. @param {{ form: Record<string, any>, focus: string, noticeDraft?: { level: string, message: string }, publishedSlide?: any, today: string, tonightTitle?: string | null }} props */
export function Stage({ form, focus, noticeDraft, publishedSlide, today, tonightTitle = null }) {
  const skin = resolveSkin(form.nightTheme, new Date(`${today}T12:00:00`), tonightTitle);
  const scene = sceneForSkin(skin) || 'sky';
  const slide = useMemo(() => (publishedSlide && !isVideoSlide(publishedSlide)
    ? publishedSlide
    : { eyebrow: 'Tonight', text: form.calendarWelcomeText || 'Welcome to Awana!', subtext: 'A sample slide', textSize: 'auto' }),
  [publishedSlide, form.calendarWelcomeText]);
  const [sample] = useState(() => demoCheckout(getAllClubs(), SAMPLE_BOARD_NAMES, Date.now()));
  const decision = decideBoard({ checkout: sample, namesAbove: Number(form.checkoutBoardNamesAbove) || 0, staleMin: 120, now: sample.at, demo: true });
  const items = cornerItemsFor(form);
  const bottom = items.find((i) => i.corner === 'bottom') || null;
  const top = items.find((i) => i.corner === 'top') || null;
  const noticeOn = focus === 'notice' && noticeDraft?.message?.trim();
  const [now] = useState(() => Date.now());

  return (
    <ZeroAnimationContext.Provider value>
      <div className="tv-preview__stage" data-focus={focus} style={{ '--u': '16px', '--lobby-u': '16px', '--band-top': 'calc(1.4 * 16px)' }}>
        <CatalogScene theme={scene} still>
          <div className="lobby-stage manual-slide-copy">
            <SlideCopy frame={slideFrame(slide)} theme={resolveTheme(slide, 0)} sizeClass={resolveSizeClass(slide)} slide still />
          </div>
        </CatalogScene>
        {focus === 'welcome' && (
          <div className="overlay">
            <CheckInMoment
              event={{ id: 'preview', firstName: SAMPLE_CHILD, club: 'Sparks', isBirthday: false, isFirstTimer: false, presentation: 'calm' }}
              audioEnabled={false}
              clubPhrases={form.clubPhrases}
            />
          </div>
        )}
        {focus === 'pickup' && <CheckoutBoard decision={decision} checkout={sample} calm preview demo />}
        {focus === 'corner' && (
          <>
            <div className="corner-bottom"><CornerChip item={bottom} corner="bottom" loads={1} size="calc(3.1 * 16px)" /></div>
            <div className="tv-preview__top"><div className="corner-top"><CornerChip item={top} corner="top" loads={1} size="calc(2.5 * 16px)" /></div></div>
          </>
        )}
        {noticeOn && (
          <NoticeBanner
            notice={{ level: noticeDraft.level, message: noticeDraft.message.trim(), at: now, receivedAt: now }}
            now={now}
            place="centre"
          />
        )}
      </div>
    </ZeroAnimationContext.Provider>
  );
}

/**
 * @param {{ form: Record<string, any>, focus?: string, noticeDraft?: { level: string, message: string }, publishedSlide?: any,
 *   today: string, tonightTitle?: string | null, onHide?: () => void }} props
 */
export default function TvPreview({ form, focus = 'slide', noticeDraft, publishedSlide, today, tonightTitle, onHide }) {
  const frameRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const [scale, setScale] = useState(0.2);
  const [throws, setThrows] = useState(0);
  const fit = () => {
    const w = frameRef.current?.getBoundingClientRect().width;
    if (w) setScale(w / STAGE_W);
  };
  useLayoutEffect(() => {
    fit();
    if (typeof ResizeObserver === 'undefined' || !frameRef.current) return undefined;
    const ro = new ResizeObserver(fit);
    ro.observe(frameRef.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { if (throws >= PREVIEW_MAX_THROWS) onHide?.(); }, [throws, onHide]);

  if (throws >= PREVIEW_MAX_THROWS) return null;
  const resetKey = `${focus}|${noticeDraft?.message || ''}|${form.nightTheme}`;
  return (
    <div className="tv-preview" data-testid="tv-preview">
      <div className="tv-preview__frame" ref={frameRef} role="img" aria-label={previewLabel(focus)}>
        <div
          className="tv-preview__scaler"
          style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})` }}
          aria-hidden="true"
        >
          <PreviewBoundary
            resetKey={resetKey}
            onThrow={() => setThrows((n) => n + 1)}
            fallback={<StaticMiniature focus={focus} />}
          >
            <Stage form={form} focus={focus} noticeDraft={noticeDraft} publishedSlide={publishedSlide} today={today} tonightTitle={tonightTitle} />
          </PreviewBoundary>
        </div>
      </div>
      <p className="hint tv-preview__note">Sample names and a sample slide. It follows the settings as you change them.</p>
    </div>
  );
}
