import { describe, expect, it } from 'vitest';
import {
  ADVISORY_MAX_AGE_MS,
  advisedNextMeeting,
  advisoryTitle,
  applyScheduleAdvisory,
  isAdvisoryFresh,
} from './scheduleAdvisory.js';
import { SCHEDULE_CONFIG, localDateKey } from './shared-config.js';

// Wednesday 2026-09-02, 5:00 PM — before that evening's meeting.
const NOW = new Date(2026, 8, 2, 17, 0, 0);
const fresh = (patch) => ({ at: NOW, ...patch });

describe('isAdvisoryFresh', () => {
  it('is false for a missing advisory', () => {
    expect(isAdvisoryFresh(null, NOW)).toBe(false);
    expect(isAdvisoryFresh(undefined, NOW)).toBe(false);
  });

  it('is true just under the max age and false at/after it', () => {
    const advisory = fresh({});
    const justUnder = new Date(NOW.getTime() + ADVISORY_MAX_AGE_MS - 1);
    const atLimit = new Date(NOW.getTime() + ADVISORY_MAX_AGE_MS);
    expect(isAdvisoryFresh(advisory, justUnder)).toBe(true);
    expect(isAdvisoryFresh(advisory, atLimit)).toBe(false);
  });
});

describe('applyScheduleAdvisory', () => {
  it('is a no-op with no advisory', () => {
    expect(applyScheduleAdvisory(SCHEDULE_CONFIG, null, NOW)).toBe(SCHEDULE_CONFIG);
  });

  it('is a no-op when the advisory is stale', () => {
    const stale = fresh({ noClubThisWeek: true });
    const later = new Date(NOW.getTime() + ADVISORY_MAX_AGE_MS + 1);
    expect(applyScheduleAdvisory(SCHEDULE_CONFIG, stale, later)).toBe(SCHEDULE_CONFIG);
  });

  it('is a no-op when noClubThisWeek is not set', () => {
    const advisory = fresh({ title: 'Family Fun Night' });
    expect(applyScheduleAdvisory(SCHEDULE_CONFIG, advisory, NOW)).toBe(SCHEDULE_CONFIG);
  });

  it('marks the next computed meeting date as no-club, labeled from title', () => {
    const advisory = fresh({ noClubThisWeek: true, title: 'Snow Day' });
    const cfg = applyScheduleAdvisory(SCHEDULE_CONFIG, advisory, NOW);
    const key = localDateKey(NOW); // meeting is tonight, 2026-09-02
    expect(cfg.specialDates[key]).toEqual({ noClub: true, label: 'Snow Day' });
    // Canonical data untouched (new object, but same windows).
    expect(cfg.windows).toBe(SCHEDULE_CONFIG.windows);
  });

  it('falls back to a generic label when the broadcast has no title', () => {
    const advisory = fresh({ noClubThisWeek: true });
    const cfg = applyScheduleAdvisory(SCHEDULE_CONFIG, advisory, NOW);
    const key = localDateKey(NOW);
    expect(cfg.specialDates[key].label).toBe('No club this week (announced)');
  });

  it('never overwrites an existing specialDates entry (canonical/local data wins)', () => {
    // A non-noClub special (a replacement window table, e.g. "Store
    // Night") still lands on the same calendar date as the broadcast's
    // computed next meeting — the advisory must leave it alone rather
    // than clobbering it with a noClub marking.
    const key = localDateKey(NOW);
    const cfgWithEntry = {
      ...SCHEDULE_CONFIG,
      specialDates: { [key]: { label: 'Store Night', windows: SCHEDULE_CONFIG.windows } },
    };
    const advisory = fresh({ noClubThisWeek: true, title: 'Conflicting broadcast' });
    const result = applyScheduleAdvisory(cfgWithEntry, advisory, NOW);
    expect(result).toBe(cfgWithEntry);
  });
});

describe('advisedNextMeeting', () => {
  const localTarget = new Date(2026, 8, 2, 18, 0, 0);

  it('is a no-op with no advisory', () => {
    expect(advisedNextMeeting(localTarget, null, SCHEDULE_CONFIG, NOW)).toBe(localTarget);
  });

  it('is a no-op when the advisory has no nextMeetingDate', () => {
    const advisory = fresh({ title: 'x' });
    expect(advisedNextMeeting(localTarget, advisory, SCHEDULE_CONFIG, NOW)).toBe(localTarget);
  });

  it('is a no-op when the broadcast agrees with the local target', () => {
    const advisory = fresh({ nextMeetingDate: '2026-09-02' });
    expect(advisedNextMeeting(localTarget, advisory, SCHEDULE_CONFIG, NOW)).toBe(localTarget);
  });

  it('retargets to the broadcast date at the configured meeting time', () => {
    const advisory = fresh({ nextMeetingDate: '2026-09-16' });
    const advised = advisedNextMeeting(localTarget, advisory, SCHEDULE_CONFIG, NOW);
    expect(localDateKey(advised)).toBe('2026-09-16');
    expect(advised.getHours()).toBe(SCHEDULE_CONFIG.meetingStart.hour);
    expect(advised.getMinutes()).toBe(SCHEDULE_CONFIG.meetingStart.minute);
  });

  it('refuses a corrected date that would already be in the past', () => {
    const advisory = fresh({ nextMeetingDate: '2020-01-01' });
    expect(advisedNextMeeting(localTarget, advisory, SCHEDULE_CONFIG, NOW)).toBe(localTarget);
  });

  it('is a no-op when the advisory is stale', () => {
    const advisory = fresh({ nextMeetingDate: '2026-09-16' });
    const later = new Date(NOW.getTime() + ADVISORY_MAX_AGE_MS + 1);
    expect(advisedNextMeeting(localTarget, advisory, SCHEDULE_CONFIG, later)).toBe(localTarget);
  });
});

describe('advisoryTitle', () => {
  it('returns the title only while fresh', () => {
    const advisory = fresh({ title: 'Family Fun Night' });
    expect(advisoryTitle(advisory, NOW)).toBe('Family Fun Night');
    const later = new Date(NOW.getTime() + ADVISORY_MAX_AGE_MS + 1);
    expect(advisoryTitle(advisory, later)).toBeUndefined();
  });

  it('returns undefined with no advisory or no title', () => {
    expect(advisoryTitle(null, NOW)).toBeUndefined();
    expect(advisoryTitle(fresh({}), NOW)).toBeUndefined();
  });
});
