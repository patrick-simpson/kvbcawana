import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  BalloonArt, CakeArt, GarlandArt, GiftArt, PartyHatArt, StarArt, StreamerArt,
} from './BirthdayArt.jsx';

const PIECES = [
  ['CakeArt', CakeArt],
  ['GiftArt', GiftArt],
  ['BalloonArt', BalloonArt],
  ['StarArt', StarArt],
  ['StreamerArt', StreamerArt],
  ['PartyHatArt', PartyHatArt],
  ['GarlandArt', GarlandArt],
];

// Emoji are banned throughout the birthday art on purpose: they render
// differently on every TV and streaming stick, which is why these were drawn by
// hand in the first place. The banner test guards its own output; this guards
// each piece in isolation so a new one can't reintroduce them.
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

describe('birthday art', () => {
  it.each(PIECES)('%s renders an inline svg', (_name, Piece) => {
    const { container } = render(<Piece />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg.getAttribute('viewBox')).toBeTruthy();
  });

  it.each(PIECES)('%s contains no emoji', (_name, Piece) => {
    const { container } = render(<Piece />);
    expect(container.textContent).not.toMatch(EMOJI);
  });

  it.each(PIECES)('%s is hidden from assistive tech', (_name, Piece) => {
    // Purely decorative — a screen reader announcing "star star star" eighteen
    // times would be worse than silence.
    const { container } = render(<Piece />);
    expect(container.querySelector('svg').getAttribute('aria-hidden')).not.toBeNull();
  });

  it.each([
    ['GiftArt', GiftArt],
    ['BalloonArt', BalloonArt],
    ['StarArt', StarArt],
    ['StreamerArt', StreamerArt],
    ['PartyHatArt', PartyHatArt],
  ])('%s honours its color prop', (_name, Piece) => {
    // The falling pieces cycle a bright palette, so colour has to ride props
    // rather than being baked into each drawing.
    const { container } = render(<Piece color="#123456" />);
    expect(container.innerHTML).toContain('#123456');
  });

  it('GarlandArt hangs its flags off the string, not above it', () => {
    // The flags follow the string's sag; a straight row would read as a border.
    const { container } = render(<GarlandArt />);
    const flags = [...container.querySelectorAll('path')]
      .map((p) => p.getAttribute('d'))
      .filter((d) => d && d.startsWith('M') && d.includes('Z'));
    expect(flags.length).toBeGreaterThanOrEqual(4);
    const ys = flags.map((d) => Number(d.split(' ')[1]));
    // Middle flags hang lower than the outer ones.
    expect(Math.max(...ys)).toBeGreaterThan(Math.min(...ys));
  });
});
