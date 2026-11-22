import { describe, expect, it } from 'vitest';
import { storeNightWords } from './StoreNightCard.jsx';

describe('store night words', () => {
  it('says why it is off', () => {
    expect(storeNightWords({ mode: 'auto', active: false })).toMatch(/^Tonight is not store night\./);
    expect(storeNightWords({ mode: 'off', active: false })).toMatch(/^Off/);
  });
  it('says the balances come at club opening before they are read', () => {
    expect(storeNightWords({ mode: 'on', active: true, readAt: null })).toMatch(/when club opens/);
  });
  it('names which calendar turned it on, counts balances, never names one', () => {
    const w = storeNightWords({ mode: 'auto', active: true, twotimtwoSaysStore: true, readAt: new Date().toISOString(), balances: 84, minimum: 10 });
    expect(w).toMatch(/^TwoTimTwo says store night\. 84 balances read from TwoTimTwo just now\./);
    expect(w).toMatch(/never under 10/);
  });
});
