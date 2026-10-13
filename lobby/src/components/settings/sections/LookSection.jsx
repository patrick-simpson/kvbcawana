import { useContext, useState } from 'react';
import { skinOptions } from '../../../lib/skins.js';
import { seasonChoice, seasonLine, seasonOptions, seasonWrites } from '../../../lib/season.js';
import { useChurch } from '../../../hooks/useChurch.js';
import { PanelCard, SettingsPageContext, Toggle } from '../fields.jsx';
import {
  BackgroundCard, CalendarSlidesCard, IgnoredDeckNotice, PreviewPromosCard, SlidesCard,
} from './SlidesSection.jsx';

/** Ambient particles and the weather mood. */
export function WeatherEffectsCard({ form, set, where = 'What screens show → Corner' }) {
  return (
    <PanelCard title="Weather effects" tab="var(--brand-trek)" scope="shared" preview="slide">
      <div className="field">
        <label htmlFor="particleEffect">Ambient particles</label>
        <select id="particleEffect" value={form.particleEffect} onChange={set('particleEffect')}>
          <option value="auto">Auto — match the weather</option>
          <option value="off">Off</option>
          <option value="snow">Snow</option>
          <option value="rain">Rain</option>
          <option value="sparkle">Sparkles</option>
        </select>
        <span className="hint">
          A gentle full-screen effect. Auto mirrors the sky outside, using the weather location under {where}. Or
          force one: snowfall for a Christmas party, sparkles for awards night.
        </span>
      </div>
      <Toggle
        checked={form.weatherTheme === true}
        onChange={set('weatherTheme')}
        title="Let the weather set the mood"
        hint="A rainy or snowy night cools and dims the background. The season still picks the colors."
      />
    </PanelCard>
  );
}

export function JustForFunFold({ form, set }) {
  return (
    <details className="advanced-fields panel-fold">
      <summary>Just for fun</summary>
      <Toggle
        checked={form.aprilFools === true}
        onChange={set('aprilFools')}
        title="April Fools: flip this screen upside down"
        hint="Only does anything on April 1st. Labels and the printer stay serious, and this settings panel stays right-side up so you can always turn it off."
      />
    </details>
  );
}

/**
 * The ONE Season control (docs/SETTINGS-OVERHAUL.md 2.4). One select; on the
 * settings page a press makes two independent writes, each logged, each able
 * to fail alone: the church-wide screen settings (nightTheme, followPrinterTheme)
 * and the printing settings' seasonTheme (what the labels' tally says). A TV's
 * own panel writes the first only: the page is the one writer of seasonTheme.
 */
export function SeasonCard({ form, update, today, tonightTitle }) {
  const page = useContext(SettingsPageContext);
  const church = useChurch({ load: page });
  const [note, setNote] = useState(/** @type {{ text: string, warn?: boolean } | null} */ (null));
  const choice = seasonChoice(form.nightTheme);

  const pick = async (e) => {
    const next = e.target.value;
    const w = seasonWrites(next);
    update(w.shared);
    setNote(null);
    if (!page) return;
    if (church.state !== 'ready') {
      setNote({ text: 'The screens took the new season. The labels’ season (Printing) is not connected yet, so it keeps what it had.' });
      return;
    }
    const r = await church.save(w.church);
    if (r.ok) setNote({ text: 'Saved for the screens and for the labels’ season.' });
    else if (r.kind === 'stale') setNote({ warn: true, text: 'The screens took the new season, but someone else changed the printing settings a moment ago. Press again to set the labels’ season too.' });
    else setNote({ warn: true, text: `The screens took the new season, but the labels’ season did not save: ${r.message}` });
  };

  return (
    <PanelCard title="Season" tab="var(--brand-journey)" scope="shared" preview="slide">
      <div className="field">
        <label htmlFor="nightTheme">Season</label>
        <select id="nightTheme" value={choice} onChange={pick}>
          {seasonOptions().map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span className="hint">
          Dresses the stage for the season, and the labels follow. Banners always keep their club colors. Auto reads
          tonight&apos;s calendar title (Easter, VBS, Thanksgiving&hellip;) and falls back to the month.
        </span>
        <span className="hint season-line" data-testid="season-line">{seasonLine(form.nightTheme, today, tonightTitle)}</span>
        {note && <span className={`hint${note.warn ? ' hint--warn' : ''}`} role="status">{note.text}</span>}
      </div>
    </PanelCard>
  );
}

/** Slides & look (docs/SETTINGS-OVERHAUL.md 2.4): slides, calendar, background, season. */
export function LookSection({
  form, set, update, slideCount, onEditSlides, syncedDeck, today, tonightTitle, onPreviewPromo, onForgetSyncedDeck,
}) {
  return (
    <>
      <IgnoredDeckNotice form={form} update={update} syncedDeck={syncedDeck} />
      <PreviewPromosCard onPreviewPromo={onPreviewPromo} />
      <BackgroundCard form={form} set={set} />
      <SlidesCard form={form} set={set} slideCount={slideCount} onEditSlides={onEditSlides} syncedDeck={syncedDeck} onForgetSyncedDeck={onForgetSyncedDeck} />
      <CalendarSlidesCard form={form} set={set} today={today} />
      <SeasonCard form={form} update={update} today={today} tonightTitle={tonightTitle} />
      <WeatherEffectsCard form={form} set={set} />
      <JustForFunFold form={form} set={set} />
    </>
  );
}

// The classic rail's Look & season section (?rail=classic): its own Season select.
export function ClassicLookSection({ form, set }) {
  return (
    <>
      <PanelCard title="Season" tab="var(--brand-journey)" scope="shared">
        <div className="field">
          <label htmlFor="nightTheme">Themed night skin</label>
          <select id="nightTheme" value={form.nightTheme} onChange={set('nightTheme')}>
            <option value="none">None (classic)</option>
            {/* Generated from SKIN_TABLE so a new season needs one edit, not five. */}
            {skinOptions().filter((o) => o.value !== 'none').map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <span className="hint">
            Dresses the stage for the season. Banners always keep their club colors. Auto reads tonight&apos;s calendar
            title (Easter, VBS, Thanksgiving&hellip;) and falls back to the month.
          </span>
        </div>
        {form.nightTheme === 'auto' && (
          <Toggle
            checked={form.followPrinterTheme === true}
            onChange={set('followPrinterTheme')}
            title="Follow the printer's season"
            hint="When the label printer broadcasts its season theme, this screen wears the matching skin so labels and screens switch together."
          />
        )}
      </PanelCard>
      <WeatherEffectsCard form={form} set={set} where="Screen & corner" />
      <JustForFunFold form={form} set={set} />
    </>
  );
}
