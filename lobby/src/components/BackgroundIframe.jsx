import { useEffect, useMemo, useState } from 'react';
import { flagshipOnAir, withFlagship } from '../lib/flagship.js';
import PptxSlideshow from './PptxSlideshow.jsx';
import ManualSlideshow from './ManualSlideshow.jsx';
import CatalogScene from './CatalogScene.jsx';
import SlideCopy from './SlideCopy.jsx';
import VideoBackground from './VideoBackground.jsx';

// The placeholder's words, in the lobby's copy frame (src/lib/lobbyFrame.js).
// The welcome screen needs no kicker: the corner tab already carries the
// Awana Clubs mark, and "Awana" is the headline.
const frame = (headline, { kicker = '', sub = '' } = {}) => ({ kicker, headline, sub, chip: null, textSize: 'auto' });
const WELCOME = frame('Welcome to Awana!', { sub: 'We\u2019re so glad you\u2019re here!' });
const UPLOAD_VIDEO = frame('Upload a video\nin Settings', { kicker: 'Awana Clubs' });
const UPLOAD_PPTX = frame('Upload a PowerPoint\nin Settings', { kicker: 'Awana Clubs' });

/**
 * The lobby with a fixed message on it: the screen is never blank, whatever
 * is or is not set up. `still` (weak hardware) skips the studio's ambient
 * loops and lands the words without motion.
 */
function Placeholder({ words, theme, still, cozy, dim, clubTint }) {
  return (
    <div className="background-placeholder">
      <CatalogScene theme={theme} still={still} cozy={cozy} dim={dim} clubTint={clubTint}>
        <div className="lobby-stage placeholder-copy">
          <SlideCopy frame={words} theme={theme} still={still} />
        </div>
      </CatalogScene>
    </div>
  );
}

const OFFICE_URL = /onedrive\.live\.com|1drv\.ms|sharepoint\.com|officeapps\.live\.com/i;

// SharePoint/OneDrive "view document" URLs (Doc.aspx) refuse to render
// inside third-party iframes unless `action=embedview` is present. A
// novice who pastes the plain file URL sees a blank frame with no
// error, so auto-upgrade the URL here.
//
// Personal OneDrive embed URLs need em=2 to activate slideshow mode;
// without it the viewer just shows a static document.
//
// wdSlideShowDelay (milliseconds) tells Office Online how long each
// slide stays up; 0 means "use the presentation's own timings".
// Without the parameter, OneDrive embeds sit on the first slide forever.
export function normalizeEmbedUrl(url, slideshowDelaySec = 5) {
  if (!url) return url;

  // When users copy the src from an <iframe src="..."> HTML snippet, the &
  // separators are HTML-escaped as &amp;. Decode them so they work as a real URL.
  url = url.replace(/&amp;/gi, '&');

  // Only Office Online viewers understand the parameters below.
  if (!OFFICE_URL.test(url)) return url;

  const sep = () => (url.includes('?') ? '&' : '?');

  // SharePoint Doc.aspx: must have action=embedview to load in an iframe
  if (/\/Doc\.aspx\?/i.test(url) && !/[?&]action=embedview\b/i.test(url)) {
    url += sep() + 'action=embedview';
  }

  // Personal OneDrive: em=2 activates slideshow/embed mode
  if (/onedrive\.live\.com/i.test(url) && !/[?&]em=/i.test(url)) {
    url += sep() + 'em=2';
  }

  if (!/[?&]wdSlideShowDelay=/i.test(url)) {
    const sec = Number(slideshowDelaySec);
    const delayMs = Number.isFinite(sec) && sec >= 0 ? Math.round(sec * 1000) : 5000;
    url += sep() + `wdSlideShowDelay=${delayMs}`;
  }

  return url;
}

// OneDrive URLs that point at a PowerPoint file, which the experimental
// local slideshow knows how to download and parse.
function isOneDrivePptx(url) {
  if (!url) return false;
  return /onedrive|1drv\.ms/i.test(url) && /\.pptx|\/p\/|presentation/i.test(url);
}

export default function BackgroundIframe({
  url, slideshowDelaySec, useLocalSlideshow, backgroundSource, manualSlides,
  calendarSlides,
  // The season's scene theme, and the weather's atmosphere modifier over it.
  // Both default to today's behaviour so an unthemed install looks unchanged.
  sceneTheme = 'sky', cozy = false, dim = 1,
  // The arriving child's club accent while their banner is up, or null (#349).
  // App.jsx has already decided whether a tint is allowed at all — including
  // that a 'video' or 'pptx' background is never ours to tint — so this is
  // simply handed down to every scene we render ourselves.
  clubTint = null,
  // Skips the lobby's ambient loops (the drifting clouds, twinkling doodles
  // and rolling wave) and lands the placeholder's words without motion: not
  // just freezing them the way config.reduceMotion's zero-animation wiring
  // does, but never starting them, for weak/kiosk hardware.
  reduceMotion = false,
  // The lobby director (App.jsx): pause the typed deck while names are on
  // screen, and hear about each slide so check-ins can wait behind a poster
  // or a slide marked "Hold check-ins". Only the typed deck has slides we
  // can see; a PowerPoint embed or a video never holds anything.
  paused = false,
  onSlide,
}) {
  // One array identity per (calendarSlides, manualSlides) pair — a fresh
  // array every render used to restart ManualSlideshow's hold timer on
  // every App re-render. Unconditional: hooks come before the early returns.
  // The flagship welcome slide leads it (src/lib/flagship.js): permanent,
  // built in, never stored. It is only ever put in front of the typed deck
  // that ManualSlideshow plays, so the video, PowerPoint and embed sources
  // are untouched.
  // Off the air Wednesdays 6:30-8:30 pm (flagshipOnAir): a boolean, so the
  // deck's identity only changes when the window opens or closes.
  const [flagshipOn, setFlagshipOn] = useState(() => flagshipOnAir());
  useEffect(() => {
    const t = setInterval(() => setFlagshipOn(flagshipOnAir()), 30_000);
    return () => clearInterval(t);
  }, []);
  const deck = useMemo(
    () => withFlagship([...(calendarSlides || []), ...(manualSlides || [])], flagshipOn),
    [calendarSlides, manualSlides, flagshipOn]
  );

  // Full-screen looping video (#25): one file uploaded in Settings,
  // stored on this device only. Missing/broken video shows the friendly
  // setup placeholder — the screen is never black.
  if (backgroundSource === 'video') {
    return (
      <VideoBackground
        fallback={(
          <Placeholder words={UPLOAD_VIDEO} theme={sceneTheme} still={reduceMotion} cozy={cozy} dim={dim} clubTint={clubTint} />
        )}
      />
    );
  }

  // Uploaded .pptx deck rendered locally (Settings → Slides →
  // "Uploaded PowerPoint"). Whole-deck failure falls back to the URL
  // embed when one is configured, else the placeholder scene.
  if (backgroundSource === 'pptx') {
    const pptxFallback = url ? (
      <iframe
        className="background-iframe"
        src={normalizeEmbedUrl(url, slideshowDelaySec)}
        title="Awana background presentation"
        allow="autoplay; fullscreen"
        allowFullScreen
        frameBorder="0"
      />
    ) : (
      <Placeholder words={UPLOAD_PPTX} theme={sceneTheme} still={reduceMotion} cozy={cozy} dim={dim} clubTint={clubTint} />
    );
    return <PptxSlideshow source="store" slideshowDelaySec={slideshowDelaySec} fallback={pptxFallback} />;
  }

  // Typed slides: free-typed in the on-screen editor, no PowerPoint.
  // Calendar-derived slides (welcome / next week / nights remaining)
  // lead the rotation; they are generated fresh each render and never
  // stored.
  if (backgroundSource === 'manual') {
    if (deck.length) {
      return (
        <ManualSlideshow
          slides={deck}
          slideshowDelaySec={slideshowDelaySec}
          clubTint={clubTint}
          paused={paused}
          onSlide={onSlide}
          still={reduceMotion}
        />
      );
    }
  }

  // Manual source with nothing typed yet — or no PowerPoint URL — shows
  // the friendly setup placeholder, so the screen is never blank.
  if (backgroundSource === 'manual' || !url) {
    return <Placeholder words={WELCOME} theme={sceneTheme} still={reduceMotion} cozy={cozy} dim={dim} clubTint={clubTint} />;
  }

  const embed = (
    <iframe
      className="background-iframe"
      src={normalizeEmbedUrl(url, slideshowDelaySec)}
      title="Awana background presentation"
      allow="autoplay; fullscreen"
      allowFullScreen
      frameBorder="0"
    />
  );

  // The local PPTX slideshow is experimental and opt-in; if it can't
  // download or parse the deck it falls back to the iframe embed so the
  // signage screen never shows an error.
  if (useLocalSlideshow && isOneDrivePptx(url)) {
    return <PptxSlideshow url={url} source="url" slideshowDelaySec={slideshowDelaySec} fallback={embed} />;
  }

  return embed;
}
