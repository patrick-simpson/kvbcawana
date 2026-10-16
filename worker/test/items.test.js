// Which TwoTimTwo check-in items go with a child (twotimtwo.js itemsToSend),
// and which clubs the /checkin card offers Bible / Brought a friend for
// (desk.js itemClubs). Kept from the deleted relayed phone check-in's suite.
import { describe, expect, it } from 'vitest';
import { itemsToSend } from '../src/twotimtwo.js';
import { itemClubs } from '../src/desk.js';

// Tonight's items as KVBC has them: Attendance (every club, automatic), Bible
// and Brought a friend (Sparks, T&T, Trek only).
const ITEMS = [
  { id: '40', clubs: ['4', '1', '2', '3', '6'], automatic: true, label: 'Attendance' },
  { id: '707', clubs: ['2', '3', '6'], automatic: false, label: 'Bible' },
  { id: '410', clubs: ['2', '3', '6'], automatic: false, label: 'Brought a friend' },
  { id: '900', clubs: ['2', '3', '6'], automatic: false, label: 'Uniform' },
];

describe('which check-in items go with a child', () => {
  it('Attendance always; Bible and friend only when ticked; only for the child\'s club', () => {
    expect(itemsToSend(ITEMS, '3')).toEqual(['40']);
    expect(itemsToSend(ITEMS, '3', { Bible: true })).toEqual(['40', '707']);
    expect(itemsToSend(ITEMS, '3', { Bible: true, Friend: true })).toEqual(['40', '707', '410']);
    expect(itemsToSend(ITEMS, '3', { Friend: true })).toEqual(['40', '410']);
    // Cubbies have neither, so a tick sends nothing extra.
    expect(itemsToSend(ITEMS, '1', { Bible: true, Friend: true })).toEqual(['40']);
    // Not "true" is not ticked.
    expect(itemsToSend(ITEMS, '3', { Bible: 'yes', Friend: 1 })).toEqual(['40']);
  });

  it('the check-in card offers Bible and friend for the clubs TwoTimTwo has them in', () => {
    expect(itemClubs(ITEMS)).toEqual({ bible: ['Sparks', 'T&T', 'Trek'], friend: ['Sparks', 'T&T', 'Trek'] });
  });
});
