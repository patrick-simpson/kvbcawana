import { describe, expect, it } from 'vitest';
import { storeNightWords } from './StoreNightCard.jsx';

describe('store night words', () => {
  it('says why it is off', () => {
    expect(storeNightWords({ mode: 'auto', active: false, calendarSaysStore: false })).toMatch(/calendar does not say store night/);
    expect(storeNightWords({ mode: 'off', active: false })).toMatch(/^Off/);
  });
  it('says it is still reading before the first pass', () => {
    expect(storeNightWords({ mode: 'on', active: true, readAt: null })).toMatch(/Reading share balances/);
  });
  it('counts balances, never names one', () => {
    const w = storeNightWords({ mode: 'on', active: true, readAt: new Date().toISOString(), balances: 84, clubsRead: 5, clubs: 5 });
    expect(w).toMatch(/^Switched on\. 84 balances read just now\./);
  });
});
