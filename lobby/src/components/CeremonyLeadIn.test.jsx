import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { CeremonyLeadIn, LEAD_IN } from './CeremonyLeadIn.jsx';
import { ZeroAnimationContext } from '../lib/motion.jsx';

// The opening ceremony's see-through lead-in (owner 2026-11-01), in the five
// seconds before every screen turns over to copy the gym projector.

afterEach(cleanup);

describe('CeremonyLeadIn', () => {
  it('is loaded but hidden until it plays (mounted with the mirror, two minutes early)', () => {
    const { container } = render(<CeremonyLeadIn playing={false} />);
    const root = container.querySelector('[data-testid="ceremony-lead-in"]');
    expect(root.dataset.playing).toBe('0');
    expect(root.getAttribute('aria-hidden')).toBe('true');
    const v = root.querySelector('video');
    expect(v.getAttribute('src')).toBe(LEAD_IN.src);
    expect(v.getAttribute('preload')).toBe('auto');
    expect(v.muted).toBe(true);
    expect(root.querySelector('img')).toBeNull();
  });

  it('plays from the start when its five seconds come, and says what it is', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    const { container, rerender } = render(<CeremonyLeadIn playing={false} />);
    rerender(<CeremonyLeadIn playing />);
    const root = container.querySelector('[data-testid="ceremony-lead-in"]');
    expect(root.dataset.playing).toBe('1');
    expect(root.getAttribute('aria-label')).toBe('Opening ceremony');
    expect(play).toHaveBeenCalledTimes(1);
    play.mockRestore();
  });

  it('under zero animation is its card at rest (a still), no video', () => {
    const { container } = render(
      <ZeroAnimationContext.Provider value={true}><CeremonyLeadIn playing /></ZeroAnimationContext.Provider>,
    );
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('img').getAttribute('src')).toBe(LEAD_IN.still);
  });

  it('a film that can\'t play gives way to the same still', () => {
    const { container } = render(<CeremonyLeadIn playing />);
    act(() => { fireEvent(container.querySelector('video'), new Event('error')); });
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('img').getAttribute('src')).toBe(LEAD_IN.still);
  });
});
