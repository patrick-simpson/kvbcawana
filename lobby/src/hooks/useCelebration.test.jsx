import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useCelebration } from './useCelebration.js';

function Harness({ eventId, audioEnabled, confetti, chime }) {
  useCelebration(eventId, audioEnabled, { confetti, chime });
  return null;
}

describe('useCelebration', () => {
  afterEach(cleanup);

  it('fires confetti and chime once on mount', () => {
    const confetti = vi.fn();
    const chime = vi.fn();
    render(<Harness eventId={1} audioEnabled confetti={confetti} chime={chime} />);
    expect(confetti).toHaveBeenCalledTimes(1);
    expect(chime).toHaveBeenCalledTimes(1);
  });

  it('skips the chime when audio is muted', () => {
    const confetti = vi.fn();
    const chime = vi.fn();
    render(<Harness eventId={1} audioEnabled={false} confetti={confetti} chime={chime} />);
    expect(confetti).toHaveBeenCalledTimes(1);
    expect(chime).not.toHaveBeenCalled();
  });

  it('never re-fires when audio is toggled mid-banner', () => {
    const confetti = vi.fn();
    const chime = vi.fn();
    const { rerender } = render(
      <Harness eventId={7} audioEnabled confetti={confetti} chime={chime} />
    );
    rerender(<Harness eventId={7} audioEnabled={false} confetti={confetti} chime={chime} />);
    rerender(<Harness eventId={7} audioEnabled confetti={confetti} chime={chime} />);
    expect(confetti).toHaveBeenCalledTimes(1);
    expect(chime).toHaveBeenCalledTimes(1);
  });

  it('survives parent re-renders swapping callback identities', () => {
    const confetti = vi.fn();
    const chime = vi.fn();
    const { rerender } = render(
      <Harness eventId={7} audioEnabled confetti={() => confetti()} chime={() => chime()} />
    );
    rerender(<Harness eventId={7} audioEnabled confetti={() => confetti()} chime={() => chime()} />);
    expect(confetti).toHaveBeenCalledTimes(1);
  });

  it('fires again for a new event id', () => {
    const confetti = vi.fn();
    const chime = vi.fn();
    const { rerender } = render(
      <Harness eventId={1} audioEnabled confetti={confetti} chime={chime} />
    );
    rerender(<Harness eventId={2} audioEnabled confetti={confetti} chime={chime} />);
    expect(confetti).toHaveBeenCalledTimes(2);
  });
});
