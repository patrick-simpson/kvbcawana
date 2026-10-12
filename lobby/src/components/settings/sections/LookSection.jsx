import { skinOptions } from '../../../lib/skins.js';
import { PanelCard, Toggle } from '../fields.jsx';

export function LookSection({ form, set }) {
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

      <PanelCard title="Weather effects" tab="var(--brand-trek)" scope="shared">
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
            A gentle full-screen effect. Auto mirrors the sky outside, using the weather location under Screen &amp;
            corner. Or force one: snowfall for a Christmas party, sparkles for awards night.
          </span>
        </div>
        <Toggle
          checked={form.weatherTheme === true}
          onChange={set('weatherTheme')}
          title="Let the weather set the mood"
          hint="A rainy or snowy night cools and dims the background. The season still picks the colors."
        />
      </PanelCard>

      <details className="advanced-fields panel-fold">
        <summary>Just for fun</summary>
        <Toggle
          checked={form.aprilFools === true}
          onChange={set('aprilFools')}
          title="April Fools: flip this screen upside down"
          hint="Only does anything on April 1st. Labels and the printer stay serious, and this settings panel (plus its gear) stays right-side up so you can always turn it off."
        />
      </details>
    </>
  );
}
