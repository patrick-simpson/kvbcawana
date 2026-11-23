import { describe, expect, it } from 'vitest';
import { backwardsText, calendarSaysBackwards, isBackwardsTitle } from './backwards.js';

describe('Backwards Night rules (owner 2026-11-23)', () => {
  it('spells words backwards, whole string, letters kept whole', () => {
    expect(backwardsText('LIAM')).toBe('MAIL');
    expect(backwardsText('GO!')).toBe('!OG');
    expect(backwardsText('BACKWARDS NIGHT')).toBe('THGIN SDRAWKCAB');
    expect(backwardsText('Élisabeth')).toBe('htebasilÉ');
    expect(backwardsText('éa')).toBe('aé');   // a combining accent stays on its letter
    expect(backwardsText('')).toBe('');
    expect(backwardsText(null)).toBe(null);
  });

  it('the calendar says so only for an uncancelled "backwards" event that day', () => {
    expect(isBackwardsTitle('Backwards Night')).toBe(true);
    expect(isBackwardsTitle('BACKWARD night')).toBe(true);
    expect(isBackwardsTitle('Look back at the year')).toBe(false);
    const feed = { events: [{ date: '2027-01-13', title: 'Backwards Night' }, { date: '2027-01-20', title: 'Backwards Night', isCancelled: true }] };
    expect(calendarSaysBackwards(feed, '2027-01-13')).toBe(true);
    expect(calendarSaysBackwards(feed, '2027-01-06')).toBe(false);
    expect(calendarSaysBackwards(feed, '2027-01-20')).toBe(false);
    expect(calendarSaysBackwards(null, '2027-01-13')).toBe(false);
  });
});
