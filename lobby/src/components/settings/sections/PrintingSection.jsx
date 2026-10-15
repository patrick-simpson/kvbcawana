import { useChurch } from '../../../hooks/useChurch.js';
import {
  BarfNightCard, ChurchGate, ClubLabelCard, ClubNightCard, LabelsCard, NameTagsCard, PickupListCard, TonightsPrintsCard,
} from '../ChurchCards.jsx';
import AtTheLaptop from '../AtTheLaptop.jsx';
import { PanelCard } from '../fields.jsx';
import { useSync } from '../../../hooks/useSync.js';

/**
 * BARF Night's card: off since 2026-10-15 (owner: done for the year). Next
 * year: make this true. Tests switch it on with window.AWANA_BARF = true.
 */
const barfOn = () => typeof window !== 'undefined' && /** @type {any} */ (window).AWANA_BARF === true;

/**
 * Printing (docs/SETTINGS-OVERHAUL.md 2.5, reordered 2026-10-13 "Reorganize"),
 * the settings page only: works from anywhere. Club-night tools first
 * (tonight's reprints and name tags, sealed in this browser and printed by the
 * check-in laptop's station), then BARF Night, then what is set once: the
 * church-wide labels, each club's label, the club night schedule and the
 * pickup list, from (and to) the Worker's church document; ONE collapsed card,
 * "At the laptop", holds what needs localhost.
 */
export function PrintingSection({ goTo } = {}) {
  const sync = useSync();
  const church = useChurch();
  if (!sync.signedIn) {
    return (
      <PanelCard title="Printing" tab="var(--brand-tnt)">
        <p className="hint">Sign in under Account &amp; app to change the printing settings from here.</p>
        {goTo && <button type="button" className="secondary section-jump" onClick={() => goTo('account')}>Sign in →</button>}
      </PanelCard>
    );
  }
  return (
    <>
      <ChurchGate church={church} />
      <TonightsPrintsCard />
      <NameTagsCard church={church} />
      {/* BARF is switched off (owner 2026-10-15, done for the year); barfOn() brings the card back. */}
      {barfOn() ? <BarfNightCard church={church} /> : null}
      <LabelsCard church={church} />
      <ClubLabelCard church={church} />
      <ClubNightCard church={church} />
      <PickupListCard church={church} />
      <AtTheLaptop paused={church.state === 'paused'} />
    </>
  );
}
