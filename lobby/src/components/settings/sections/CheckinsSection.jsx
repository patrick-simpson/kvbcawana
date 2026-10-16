import { getAllClubs, getClubPalette } from '../../../lib/clubs.js';
import { PanelCard, Toggle } from '../fields.jsx';

/** A duration kept in milliseconds, typed in seconds. */
function SecondsField({ id, label, hint, ms, min, max, onChange }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id} type="number" min={min} max={max} step="0.5" inputMode="decimal"
        value={Number.isFinite(ms) ? ms / 1000 : ''}
        onChange={(e) => onChange(Math.round(Number(e.target.value) * 1000))}
      />
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function WelcomeBannersCard({ form, update, onPreview }) {
  return (
      <PanelCard title="Welcome banners" scope="shared" preview="welcome">
        <SecondsField
          id="std" label="How long each name stays up (seconds)" min="2" max="20"
          ms={form.standardDisplayMs}
          onChange={(ms) => update({ standardDisplayMs: ms }, { apply: false })}
          hint="Every child gets the full time, even in a rush: the banner stays up and the next name flips in."
        />
        <SecondsField
          id="special" label="Birthdays and first-timers (seconds)" min="3" max="25"
          ms={form.specialDisplayMs}
          onChange={(ms) => update({ specialDisplayMs: ms }, { apply: false })}
          hint="The extra-celebratory banners hold a little longer."
        />
        {onPreview && (
          <button type="button" className="secondary section-jump" onClick={onPreview}
            title="Shows a sample welcome on this screen. It marks the screen ‘demo mode’ (red badge at the top) until it is reloaded.">
            Preview a check-in
          </button>
        )}
      </PanelCard>
  );
}

export function WelcomeExtrasCard({ form, set }) {
  return (
      <PanelCard title="Welcome extras" tab="var(--brand-journey)" scope="shared" preview="welcome">
        <Toggle
          checked={form.firstArrivalMoment}
          onChange={set('firstArrivalMoment')}
          title="First arrival of the night"
          hint={<>
            The very first child checked in each night gets a one-time &ldquo;Doors are open&rdquo; flourish — the
            cue that check-in has started. Skipped on a screen that boots after the program is underway.
          </>}
        />
        <Toggle
          checked={form.showBirthdayWeekRibbon !== false}
          onChange={set('showBirthdayWeekRibbon')}
          title="Birthday-this-week ribbon"
          hint={<>
            When a child’s birthday falls later this week, their banner names the day (&ldquo;Birthday this
            Friday!&rdquo;). Needs the screen to be signed in: birthdays arrive encrypted.
          </>}
        />
        <Toggle
          checked={form.clubTintBackground === true}
          onChange={set('clubTintBackground')}
          title="Wash the background in the arriving club's color"
          hint="While a name is up the scene briefly breathes that club's color. Off by default because it competes with a night skin you chose on purpose."
        />
      </PanelCard>
  );
}

export function ClubLinesCard({ form, update }) {
  return (
      <PanelCard title="Club lines" tab="var(--brand-trek)" scope="shared" preview="welcome">
        <span className="hint panel-intro">
          A short line under the child’s name on their welcome, one per club. Leave a club blank for no line. Up to
          80 characters.
        </span>
        <div className="panel-phrases">
          {getAllClubs().map((name) => {
            const key = name.toLowerCase();
            const id = `phrase-${key.replace(/[^a-z0-9]/g, '-')}`;
            const club = getClubPalette(name);
            return (
              <div className="field" key={key}>
                {/* The club's own chip: the label still reads "Puggles phrase". */}
                <label htmlFor={id}>
                  <span className="club-chip" style={{ '--club': club.primary, '--club-deep': club.deep }}>{name}</span>
                  {' '}phrase
                </label>
                <input
                  id={id}
                  type="text"
                  maxLength={80}
                  value={form.clubPhrases[key] || ''}
                  onChange={(e) => update((f) => ({ ...f, clubPhrases: { ...f.clubPhrases, [key]: e.target.value } }), { apply: false })}
                  placeholder="Shine bright tonight!"
                />
              </div>
            );
          })}
        </div>
      </PanelCard>
  );
}
