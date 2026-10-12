import { MilestoneListField, PanelCard } from '../fields.jsx';

export function CelebrationsSection({ form, set, update }) {
  return (
    <PanelCard title="Celebrations" tab="var(--brand-journey)" scope="shared" preview="welcome">
      <div className="field">
        <label htmlFor="milestone">Room milestone (every N check-ins)</label>
        <input
          id="milestone" type="number" min="0" max="10000" step="5"
          value={form.milestoneEvery}
          onChange={set('milestoneEvery')}
        />
        <span className="hint">
          {form.milestoneEvery > 0
            ? <>Every {form.milestoneEvery} check-ins, a room-wide confetti moment with a &ldquo;{form.milestoneEvery} kids checked in tonight!&rdquo; toast.</>
            : <>Milestone celebrations are off. Set a number (25 is typical) to turn them on.</>}
        </span>
      </div>
      <div className="field">
        <label htmlFor="clubMilestone">Club milestone (every N per club)</label>
        <input
          id="clubMilestone" type="number" min="0" max="1000" step="5"
          value={form.clubMilestoneEvery}
          onChange={set('clubMilestoneEvery')}
        />
        <span className="hint">Uses the printer's live per-club counts — "Sparks 20 kids strong!". 0 turns it off.</span>
      </div>
      <MilestoneListField
        id="bookMilestones"
        label="Books finished tonight (celebrate at)"
        value={form.bookMilestones}
        onChange={(list) => update({ bookMilestones: list }, { apply: false })}
        hint="When the check-in system reports this many handbooks finished tonight, the toast says so. Comma-separated; blank turns it off."
      />
      <MilestoneListField
        id="awardMilestones"
        label="Awards earned tonight (celebrate at)"
        value={form.awardMilestones}
        onChange={(list) => update({ awardMilestones: list }, { apply: false })}
        hint="Same, for awards handed out tonight. Comma-separated; blank turns it off."
      />
    </PanelCard>
  );
}
