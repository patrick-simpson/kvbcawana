import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import StickerChip from './StickerChip.jsx';

describe('StickerChip', () => {
  afterEach(cleanup);

  it('renders children inside the sticker with the label tab', () => {
    const { container } = render(
      <StickerChip label="Tonight">
        <span>42</span>
      </StickerChip>
    );
    const chip = container.querySelector('.sticker-chip');
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain('42');
    const label = container.querySelector('.sticker-chip-label');
    expect(label.textContent).toBe('Tonight');
    // Decorative: the tab must never be announced alongside the content.
    expect(label.getAttribute('aria-hidden')).toBe('true');
  });

  it('omits the label tab and sparkle unless asked for', () => {
    const { container } = render(<StickerChip>hi</StickerChip>);
    expect(container.querySelector('.sticker-chip-label')).toBeNull();
    expect(container.querySelector('.sticker-chip-spark')).toBeNull();
  });

  it('renders the corner sparkle when requested', () => {
    const { container } = render(<StickerChip sparkle>hi</StickerChip>);
    expect(container.querySelector('.sticker-chip-spark')).not.toBeNull();
  });

  it('forwards role and aria attributes to the root', () => {
    render(
      <StickerChip role="status" aria-label="Connection status: connected">
        connected
      </StickerChip>
    );
    const chip = screen.getByRole('status');
    expect(chip.getAttribute('aria-label')).toBe('Connection status: connected');
    expect(chip.classList.contains('sticker-chip')).toBe(true);
  });

  it('merges extra class names for widget-specific styling', () => {
    const { container } = render(<StickerChip className="tally">1</StickerChip>);
    const chip = container.querySelector('.sticker-chip');
    expect(chip.classList.contains('tally')).toBe(true);
  });
});
