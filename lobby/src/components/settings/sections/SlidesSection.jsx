import { useContext } from 'react';
import { PREVIEW_PROMOS, SEASON_PROMOS } from '../../../lib/promos.js';
import { inSnowSeason } from '../../../lib/snowAlerts.js';
import {
  PanelCard, PptxUploadField, SettingsPageContext, Toggle, VideoUploadField, RemoteScreenContext,
} from '../fields.jsx';

// Radio order = the setup journey: the typed/published deck is the default
// and the one the check-in laptop can drive; the others are per-device choices.
export const SOURCE_LABELS = {
  manual: 'Typed & published slides',
  powerpoint: 'OneDrive PowerPoint',
  pptx: 'Uploaded PowerPoint',
  video: 'Looping video',
};

// The last day any fall promo can show. Past it, and outside the snow season
// (when the snow-alerts slide rides the same switch), the toggle has nothing
// to turn off, so it leaves the page instead of sitting there all year.
const PROMOS_END = SEASON_PROMOS.reduce((max, p) => (p.eventDate > max ? p.eventDate : max), '');

/** A published deck that arrived but is not the chosen source: say so, with the way back. */
export function IgnoredDeckNotice({ form, update, syncedDeck }) {
  const ignored = syncedDeck && form.backgroundSource !== 'manual';
  if (!ignored) return null;
  return (
    <div className="notice-warn" role="status">
      A published deck has arrived (rev {syncedDeck.deckRev}, {syncedDeck.slides.length} slide
      {syncedDeck.slides.length === 1 ? '' : 's'}) but this screen is set to{' '}
      {SOURCE_LABELS[form.backgroundSource] || form.backgroundSource}, so it is not showing.{' '}
      <button type="button" className="ghost small" onClick={() => update({ backgroundSource: 'manual' })}>
        Show the published slides
      </button>
    </div>
  );
}

export function PreviewPromosCard({ onPreviewPromo }) {
  if (!onPreviewPromo) return null;
  return (
    <PanelCard title="Preview the promos" tab="var(--brand-hot)" scope="screen">
      <p className="hint preview-promos__hint">
        Plays one promo full screen on this TV, start to finish, whatever the date. Names that arrive meanwhile
        wait and then play in full, as they do for the real thing. Click the screen or press Esc to stop early.
      </p>
      {[
        { id: 'fall', label: 'Fall posters', keys: PREVIEW_PROMOS.filter((p) => !p.key.startsWith('snow')) },
        { id: 'snow', label: 'Snow alerts (November to March)', keys: PREVIEW_PROMOS.filter((p) => p.key.startsWith('snow')) },
      ].map((g) => (
        <div className="field" key={g.id}>
          <span className="field-label" id={`preview-${g.id}`}>{g.label}</span>
          <div className="preview-promos" role="group" aria-labelledby={`preview-${g.id}`}>
            {g.keys.map((p) => (
              <button key={p.key} type="button" className="secondary preview-promos__button" onClick={() => onPreviewPromo(p.key)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </PanelCard>
  );
}

export function BackgroundCard({ form, set }) {
  const remote = useContext(RemoteScreenContext);
  return (
    <PanelCard title="What plays behind the names" scope="screen" preview="slide">
      <div className="field">
        <span className="field-label" id="bgsource-label">Background</span>
        <div className="radio-row" role="radiogroup" aria-labelledby="bgsource-label">
          {Object.entries(SOURCE_LABELS).map(([value, label]) => (
            <label className="radio-option" key={value}>
              <input
                type="radio"
                name="backgroundSource"
                value={value}
                checked={form.backgroundSource === value}
                onChange={set('backgroundSource')}
              />
              {label}
            </label>
          ))}
        </div>
        <span className="hint">
          Typed slides are made right here in the app and get the catalog look automatically;
          publish them from any signed-in screen and every screen shows the same deck.
        </span>
      </div>

      {/* An upload lives in the browser it was made in: from the settings
          page it would land on the phone, not on the screen. */}
      {remote && (form.backgroundSource === 'pptx' || form.backgroundSource === 'video') ? (
        <p className="hint">The {form.backgroundSource === 'video' ? 'video' : 'deck'} file is uploaded on {remote.name} itself (its Settings → Slides &amp; look): files stay on the screen that plays them.</p>
      ) : (
        <>
          {form.backgroundSource === 'pptx' && <PptxUploadField />}
          {form.backgroundSource === 'video' && <VideoUploadField />}
        </>
      )}

      {(form.backgroundSource === 'powerpoint' || form.backgroundSource === 'pptx') && (
        <div className="field">
          <label htmlFor="iframe">
            {form.backgroundSource === 'pptx'
              ? 'OneDrive PowerPoint embed URL (fallback if the uploaded deck cannot render)'
              : 'OneDrive PowerPoint embed URL'}
          </label>
          <input
            id="iframe" type="url" value={form.powerpointEmbedUrl}
            onChange={set('powerpointEmbedUrl')}
            placeholder="https://onedrive.live.com/embed?…"
          />
          <span className="hint">
            In OneDrive, open your <code>.pptx</code> → File → Share → Embed, then paste the URL from the{' '}
            <code>&lt;iframe src="…"&gt;</code> snippet here.
          </span>
        </div>
      )}

      {form.backgroundSource !== 'video' && (
        <div className="field">
          <label htmlFor="slideDelay">Seconds per slide</label>
          <input
            id="slideDelay" type="number" min="0" max="120" step="1"
            value={form.slideshowDelaySec}
            onChange={set('slideshowDelaySec')}
          />
          <span className="hint">
            Unless a slide sets its own time. For a PowerPoint, 0 lets the file keep its own timing (typed slides
            then fall back to 8 seconds).
          </span>
        </div>
      )}
    </PanelCard>
  );
}

/** Edit slides…, follow the published deck (a TV, or a screen opened from the page), forget the received deck (a TV). */
export function SlidesCard({ form, set, slideCount, onEditSlides, syncedDeck, onForgetSyncedDeck }) {
  const page = useContext(SettingsPageContext);
  const remote = useContext(RemoteScreenContext);
  const n = slideCount;
  const typedLine = form.backgroundSource === 'manual'
    ? (n === 0
      ? 'No slides typed on this device yet — the welcome slide and calendar slides play on their own.'
      : `${n} slide${n === 1 ? '' : 's'} saved on this device.`)
    : 'Typed and published slides only show while “Typed & published slides” is picked above.';
  return (
    <PanelCard title="Typed & published slides" tab="var(--brand-journey)" scope="screen" keep preview="slide">
      <div className="field">
        <span className="hint">{typedLine}</span>
        <button type="button" className="secondary section-jump" onClick={onEditSlides}>
          Edit slides… (Ctrl+Shift+E)
        </button>
      </div>
      {(!page || remote) && <Toggle
        checked={form.followPublishedSlides !== false}
        onChange={set('followPublishedSlides')}
        title="Follow published slides"
        hint="Show the deck published from any signed-in screen instead of this device’s own typed slides. Video slides saved on this device still play alongside it."
      />}
      {!page && syncedDeck && (
        <div className="field">
          <span className="hint">This screen holds a received deck (rev {syncedDeck.deckRev}).</span>
          <button
            type="button"
            className="ghost section-jump"
            onClick={() => {
              if (window.confirm('Forget the received deck on THIS screen? It falls back to its locally saved slides until the next publish arrives.')) {
                onForgetSyncedDeck?.();
              }
            }}
          >
            Forget received deck
          </button>
        </div>
      )}
    </PanelCard>
  );
}

export function CalendarSlidesCard({ form, set, today }) {
  const fallLive = !PROMOS_END || today <= PROMOS_END;
  const snowLive = inSnowSeason(today);
  const promoHint = [
    fallLive && 'Poster Contest, BARF Night, Parents’ Night: animated, dated, retire themselves.',
    snowLive && 'The snow-alerts sign-up (QR for kvbchurch.org/alerts), Nov to Mar: about one pass in six, every other pass when snow is forecast for club night.',
  ].filter(Boolean).join(' ');
  return (
    <PanelCard title="Calendar slides" tab="var(--brand-trek)" scope="shared" preview="slide">
      <Toggle
        checked={form.calendarEnabled}
        onChange={set('calendarEnabled')}
        title="Calendar-aware slides"
        hint='"Welcome to…", "Next week…" and nights-remaining slides, made from the church calendar. They join the slide rotation.'
      />
      {form.calendarEnabled && (
        <>
          <Toggle checked={form.calendarShowWelcome} onChange={set('calendarShowWelcome')}
            title="Welcome slide" hint="Tonight's greeting — or a pointer to the next club night." />
          <Toggle checked={form.calendarShowNextWeek} onChange={set('calendarShowNextWeek')}
            title="Next-week slide" hint='"Next week…!" announcements and break-week notices.' />
          <Toggle checked={form.calendarShowRemaining} onChange={set('calendarShowRemaining')}
            title="Nights-remaining slide" hint="A countdown nudge once fewer than 10 club nights remain." />
        </>
      )}
      {(fallLive || snowLive) && (
        <Toggle checked={form.seasonPromos} onChange={set('seasonPromos')}
          title="Season promos" hint={promoHint} />
      )}
      <details className="advanced-fields">
        <summary>Calendar source</summary>
        <div className="field">
          <label htmlFor="calurl">Calendar page URL</label>
          <input
            id="calurl" type="url" value={form.calendarUrl}
            onChange={set('calendarUrl')}
            placeholder="https://yourchurch.twotimtwo.com/calendar/index"
          />
          <span className="hint">
            The public club calendar (twotimtwo format). A nightly job turns it into a data file the display reads;
            if that goes stale the display tries this URL directly, then its last good copy.
          </span>
        </div>
      </details>
    </PanelCard>
  );
}
