import { useState } from 'react';
import { geocodeLocation } from '../../../lib/weather.js';
import { CORNER_CLUB_IDS, getClubPalette } from '../../../lib/clubs.js';
import { PanelCard, Toggle } from '../fields.jsx';

export function SimplifiedModeCard({ panicMode, onPanic }) {
  return (
    <PanelCard title="Simplified mode" tab="var(--brand-sparks-deep)" scope="screen" local>
      <Toggle
        checked={panicMode}
        onChange={(e) => onPanic(e.target.checked)}
        title="Strip the screen to the basics"
        hint="For when something on screen looks wrong and the room is full: a plain background and the clock, while welcomes keep working. Takes effect at once. Also Ctrl+Shift+X."
      />
    </PanelCard>
  );
}

/** The corner's three switches (clock, counter + its note, corner weather). */
export function CornerToggles({ form, set }) {
  return (
    <>
      <p className="hint panel-intro">
        One item at a time — the time, tonight's tally or the weather — changing with each slide. They step
        aside while a poster or a slide marked “Hold check-ins” is up. A connection or printer problem always shows.
      </p>
      <Toggle checked={form.showClock} onChange={set('showClock')}
        title="Wall clock" hint="The time of day, bottom-right, as of each slide." />
      <Toggle checked={form.showTally} onChange={set('showTally')}
        title="Tonight's check-in counter" hint='A "checked in tonight" tally. Counts only a number, resets daily.' />
      {form.showTally && (
        <div className="toggle-nested">
          <Toggle
            checked={form.showTallySyncNote !== false}
            onChange={set('showTallySyncNote')}
            title="Explain corrections to the counter"
            hint={<>When the check-in desk's count jumps by more than one, or goes down after an undo, the counter
              says &ldquo;synced with the check-in desk&rdquo; so it reads as a correction, not a glitch.</>}
          />
        </div>
      )}
      <Toggle checked={form.showWeatherChip} onChange={set('showWeatherChip')}
        title="Corner weather" hint="The temperature and the sky, top-right. Refreshes every 15 minutes." />
    </>
  );
}

/** The weather location (with its Look up button) and the units. */
export function WeatherFields({ form, set, update, where = 'Look & season' }) {
  const [lookup, setLookup] = useState({ state: 'idle', message: '' });
  const lookUpLocation = async () => {
    setLookup({ state: 'busy', message: 'Looking up…' });
    const hit = await geocodeLocation(form.weatherLocationName);
    if (hit) {
      update({ weatherLocationName: hit.name, weatherLat: hit.lat, weatherLon: hit.lon });
      setLookup({ state: 'done', message: `Found: ${hit.name} (${hit.lat.toFixed(2)}, ${hit.lon.toFixed(2)})` });
    } else {
      setLookup({ state: 'error', message: 'No match found — try "Town, State".' });
    }
  };
  return (
    <>
      <div className="field">
        <label htmlFor="wloc">Weather location</label>
        <div className="lookup-row">
          <input
            id="wloc" type="text" value={form.weatherLocationName}
            onChange={set('weatherLocationName')}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); lookUpLocation(); } }}
            placeholder="Waterville, Maine"
          />
          <button type="button" className="ghost" onClick={lookUpLocation} disabled={lookup.state === 'busy'} title={lookup.state === 'busy' ? 'Looking up location...' : undefined}>
            Look up
          </button>
        </div>
        {lookup.message ? (
          <span className={`hint lookup-${lookup.state}`} role="status">{lookup.message}</span>
        ) : (
          <span className="hint">
            Type a town and press <strong>Look up</strong> (currently {Number(form.weatherLat).toFixed(2)},{' '}
            {Number(form.weatherLon).toFixed(2)}). Used by the corner weather, the ambient particles and the
            weather mood ({where}).
          </span>
        )}
      </div>
      <div className="field">
        <label htmlFor="wunits">Temperature units</label>
        <select id="wunits" value={form.weatherUnits} onChange={set('weatherUnits')}>
          <option value="fahrenheit">Fahrenheit (°F)</option>
          <option value="celsius">Celsius (°C)</option>
        </select>
      </div>
    </>
  );
}

/** This TV's own switches: chime, keep awake, club count, numbers strip, confetti, motion, connection sticker. */
export function ThisTvCard({ form, set, update, wakeLockStatus, lowPowerForced }) {
  const wakeTrouble = wakeLockStatus && !['active', 'off', 'requesting'].includes(wakeLockStatus);
  return (
    <PanelCard title="This TV" tab="var(--brand-trek)" scope="screen">
      <Toggle
        checked={!form.audioMuted}
        onChange={(e) => update({ audioMuted: !e.target.checked })}
        title="Play a chime with each welcome"
        hint="Browsers stay silent until someone has clicked the page once."
      />
      <Toggle
        checked={form.keepScreenAwake}
        onChange={set('keepScreenAwake')}
        title="Keep screen awake"
        hint={wakeTrouble
          ? <strong>{wakeLockStatus === 'unsupported'
            ? 'This browser cannot keep the screen awake — turn off sleep in the device’s own settings.'
            : 'The browser refused (battery saver?) — the TV may sleep mid-club.'}</strong>
          : 'Asks the browser to stop the TV or monitor from sleeping while the display is open.'}
      />
      <div className="field">
        <label htmlFor="cornerClub">Club count (upper right)</label>
        <select id="cornerClub" value={form.cornerClub} onChange={set('cornerClub')}>
          <option value="">None</option>
          {CORNER_CLUB_IDS.map((id) => <option key={id} value={id}>{getClubPalette(id).name}</option>)}
        </select>
        <span className="hint">For a TV at one club&apos;s door: that club&apos;s count, all night, in the top-right corner, from the check-in desk&apos;s tally (children checked out are already taken off). The weather leaves the corner on this screen while it shows.</span>
      </div>
      <Toggle
        checked={form.showTonightTicker === true}
        onChange={set('showTonightTicker')}
        title="Tonight's numbers strip"
        hint="A strip at the bottom of the screen with tonight's check-ins, books finished, awards and friends brought."
      />
      <div className="field">
        <label htmlFor="confettiLevel">Confetti</label>
        <select id="confettiLevel" value={form.confettiLevel} onChange={set('confettiLevel')}>
          <option value="full">Full celebration</option>
          <option value="reduced">Reduced (half the particles)</option>
          <option value="off">Off (banners and chimes only)</option>
        </select>
        <span className="hint">Every burst — welcomes, birthdays, milestones. "Reduced" helps weak TV sticks keep up on busy nights.</span>
      </div>
      <Toggle
        checked={form.reduceMotion}
        onChange={set('reduceMotion')}
        title="Reduce motion on this screen"
        hint={lowPowerForced
          ? <>Freezes every animation — banners still appear, just instantly. <strong>This page’s address has <code>?lowPower=1</code>, which is forcing it on (and confetti off) whatever these say.</strong></>
          : 'Freezes every animation — banners still appear, just instantly. For weak TV sticks, or when the movement is distracting.'}
      />
      <Toggle checked={form.showConnectionStatus} onChange={set('showConnectionStatus')}
        title="Always show the connection sticker"
        hint="Useful while setting up. Even when off, it appears by itself if the connection drops or the screen is not set up." />
    </PanelCard>
  );
}
