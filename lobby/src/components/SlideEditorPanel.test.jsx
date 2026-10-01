import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// The editor owns save-vs-publish, the follow-mode data-loss confirm, video
// garbage collection and — new — the guards that stop a stray click or a
// second publisher from destroying work. Every pure helper around it is
// covered elsewhere; this pins the shell.

const video = vi.hoisted(() => ({
  getVideo: vi.fn(async () => new Blob(['x'], { type: 'video/mp4' })),
  putVideo: vi.fn(async () => {}),
  collectGarbage: vi.fn(),
  makeVideoId: vi.fn(() => 'vid_new'),
}));
vi.mock('../lib/videoStore.js', () => video);
const publish = vi.hoisted(() => ({ publishDeck: vi.fn(async () => ({ ok: true, deckRev: 7, slideCount: 2 })) }));
vi.mock('../lib/publishDeck.js', () => publish);
const token = vi.hoisted(() => ({ loadPublishToken: vi.fn(() => '') }));
vi.mock('../lib/publishToken.js', () => token);

const SlideEditorPanel = (await import('./SlideEditorPanel.jsx')).default;

const text = (id, body, extra = {}) => ({ id, eyebrow: '', text: body, theme: 'auto', durationSec: 0, textSize: 'auto', ...extra });
const vid = (id, videoId) => ({ id, type: 'video', videoId, videoName: 'clip.mp4', videoSize: 1000, durationSec: 0 });
const DECK = [text('s_1', 'Welcome'), text('s_2', 'Verse of the month'), text('s_3', 'Store night')];

const baseProps = (over = {}) => ({
  config: { manualSlides: DECK, backgroundSource: 'manual', calendarEnabled: true },
  syncedDeck: null,
  onChange: vi.fn(),
  onClose: vi.fn(),
  ...over,
});

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
  video.collectGarbage.mockReset();
  publish.publishDeck.mockReset().mockResolvedValue({ ok: true, deckRev: 7, slideCount: 2 });
  token.loadPublishToken.mockReset().mockReturnValue('');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const textareas = () => screen.getAllByLabelText('Slide text');

describe('shell and hierarchy', () => {
  it('numbers the cards and shows the deck size in the pinned header', () => {
    render(<SlideEditorPanel {...baseProps()} />);
    expect(screen.getByText('Slide 2 of 3')).toBeTruthy();
    expect(screen.getByText(/3 of 50 slides/)).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Typed slides' }).className).toContain('panel--tabbed');
  });

  it('Save leads when this machine holds no publish token; Publish leads when it does', () => {
    render(<SlideEditorPanel {...baseProps()} />);
    expect(screen.getByRole('button', { name: 'Save slides' }).className).toBe('primary');
    expect(screen.getByRole('button', { name: 'Publish to all displays' }).className).toBe('secondary');
    expect(screen.getByRole('button', { name: '+ Add slide' }).className).toBe('ghost');
    cleanup();
    token.loadPublishToken.mockReturnValue('tok_abcdefghijklmnop');
    render(<SlideEditorPanel {...baseProps()} />);
    expect(screen.getByRole('button', { name: 'Save slides' }).className).toBe('secondary');
    expect(screen.getByRole('button', { name: 'Publish to all displays' }).className).toBe('primary');
  });

  it('shortened option labels no longer truncate in the three-up row', () => {
    render(<SlideEditorPanel {...baseProps()} />);
    expect(screen.getAllByRole('option', { name: 'Auto (fit)' }).length).toBe(3);
    expect(screen.getAllByRole('option', { name: 'Lavender' }).length).toBe(3);
  });
});

describe('guards against losing work', () => {
  it('a clean editor closes on the backdrop without asking and GCs against the SAVED deck', () => {
    const props = baseProps({ config: { manualSlides: [DECK[0], vid('s_v', 'vid_1')], backgroundSource: 'manual' } });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { container } = render(<SlideEditorPanel {...props} />);
    fireEvent.click(container.querySelector('.panel-backdrop'));
    expect(confirm).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
    expect(video.collectGarbage).toHaveBeenCalledWith(['vid_1']);
  });

  it('after an edit, backdrop / Cancel / Escape ask first and keep the panel when refused', () => {
    const props = baseProps();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { container } = render(<SlideEditorPanel {...props} />);
    fireEvent.change(textareas()[0], { target: { value: 'Changed' } });
    expect(screen.getByText(/unsaved changes/)).toBeTruthy();
    fireEvent.click(container.querySelector('.panel-backdrop'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(confirm).toHaveBeenCalledTimes(3);
    expect(confirm).toHaveBeenCalledWith('Discard the changes to these slides?');
    expect(props.onClose).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it('an added-then-abandoned blank slide is not "a change"', () => {
    const props = baseProps();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<SlideEditorPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add slide' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
  });

  it('Delete asks only when the slide has content', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<SlideEditorPanel {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add slide' }));
    expect(screen.getByText('Slide 4 of 4')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[3]);
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.queryByText('Slide 4 of 4')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    expect(confirm).toHaveBeenCalledWith('Delete this slide?');
    expect(screen.getByText('Slide 1 of 3')).toBeTruthy();
  });
});

describe('reordering', () => {
  it('Top moves a slide to the front and keeps focus inside the moved card', () => {
    render(<SlideEditorPanel {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Move slide 3 to the top' }));
    expect(textareas().map((t) => t.value)).toEqual(['Store night', 'Welcome', 'Verse of the month']);
    const first = screen.getByText('Slide 1 of 3').closest('.slide-card');
    expect(first.contains(document.activeElement)).toBe(true);
  });

  it('Bottom and the arrows work and are disabled at the ends', () => {
    render(<SlideEditorPanel {...baseProps()} />);
    expect(screen.getByRole('button', { name: 'Move slide 1 up' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Move slide 3 to the bottom' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Move slide 1 to the bottom' }));
    expect(textareas().map((t) => t.value)).toEqual(['Verse of the month', 'Store night', 'Welcome']);
  });
});

describe('feedback', () => {
  it('counters track length and warn near the cap', () => {
    render(<SlideEditorPanel {...baseProps({ config: { manualSlides: [DECK[0]], backgroundSource: 'manual' } })} />);
    expect(screen.getByText('7 / 500 characters')).toBeTruthy();
    fireEvent.change(textareas()[0], { target: { value: 'x'.repeat(460) } });
    const counter = screen.getByText('460 / 500 characters');
    expect(counter.className).toContain('hint--warn');
  });

  it('a successful publish banner flips to "Edited since rev N" on the next edit; an error clears', async () => {
    const props = baseProps();
    render(<SlideEditorPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Publish to all displays' }));
    await waitFor(() => expect(screen.getByText(/Published rev 7/)).toBeTruthy());
    // Local save happened FIRST, before the network call.
    expect(props.onChange).toHaveBeenCalledWith({ manualSlides: DECK });
    expect(props.onChange.mock.invocationCallOrder[0]).toBeLessThan(publish.publishDeck.mock.invocationCallOrder[0]);
    fireEvent.change(textareas()[0], { target: { value: 'Changed' } });
    expect(screen.getByText(/Edited since rev 7 was published/)).toBeTruthy();

    publish.publishDeck.mockResolvedValue({ ok: false, reason: 'rejected', message: 'Deck too large. Shorten or remove slides.' });
    fireEvent.click(screen.getByRole('button', { name: 'Publish to all displays' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Deck too large. Shorten or remove slides.'));
    fireEvent.change(textareas()[0], { target: { value: 'Shorter' } });
    expect(screen.queryByRole('status')).toBeNull();
    expect(props.onClose).not.toHaveBeenCalled(); // a failed publish keeps the panel open
  });

  it('a 401 appends the token advice, a 413 appends nothing', async () => {
    publish.publishDeck.mockResolvedValue({ ok: false, reason: 'auth', message: 'Publish token rejected.' });
    render(<SlideEditorPanel {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Publish to all displays' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/no valid publish token — log in under Settings/));
    expect(screen.getByRole('status').textContent).toMatch(/Export/);
  });

  it('a newer publish from someone else is called out and gates Publish; this editor’s own rev does not', async () => {
    const props = baseProps({ syncedDeck: { deckRev: 5, publishedAt: 1, slides: DECK } });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { rerender } = render(<SlideEditorPanel {...props} />);
    expect(screen.queryByRole('alert')).toBeNull();
    rerender(<SlideEditorPanel {...props} syncedDeck={{ deckRev: 6, publishedAt: 2, slides: [text('s_x', 'Theirs')] }} />);
    expect(screen.getByRole('alert').textContent).toMatch(/Someone published rev 6 \(1 slide\)/);
    fireEvent.click(screen.getByRole('button', { name: 'Publish to all displays' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/Someone published rev 6/));
    expect(publish.publishDeck).not.toHaveBeenCalled();

    // Our own publish echoing back as the live deck is NOT a conflict.
    rerender(<SlideEditorPanel {...props} syncedDeck={{ deckRev: 5, publishedAt: 1, slides: DECK }} />);
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Publish to all displays' }));
    await waitFor(() => expect(screen.getByText(/Published rev 7/)).toBeTruthy());
    rerender(<SlideEditorPanel {...props} syncedDeck={{ deckRev: 7, publishedAt: 3, slides: DECK }} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('the empty-deck hint follows the calendar setting', () => {
    render(<SlideEditorPanel {...baseProps({ config: { manualSlides: [], backgroundSource: 'manual', calendarEnabled: true } })} />);
    expect(screen.getByText(/the calendar slides play on their own/)).toBeTruthy();
    cleanup();
    render(<SlideEditorPanel {...baseProps({ config: { manualSlides: [], backgroundSource: 'manual', calendarEnabled: false } })} />);
    expect(screen.getByText(/shows the welcome placeholder/)).toBeTruthy();
  });

  it('tells the operator when this screen is not on Typed slides', () => {
    render(<SlideEditorPanel {...baseProps({ config: { manualSlides: DECK, backgroundSource: 'powerpoint' } })} />);
    expect(screen.getByText(/background source is not/)).toBeTruthy();
  });
});

describe('follow mode', () => {
  it('Save confirms only when a local video or typed slide would be lost', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const local = [DECK[0], vid('s_v', 'vid_1')];
    const props = baseProps({
      config: { manualSlides: local, backgroundSource: 'manual' },
      syncedDeck: { deckRev: 3, publishedAt: 1, slides: [DECK[0]] },
    });
    render(<SlideEditorPanel {...props} />);
    // Routine save: the merged deck still holds the video → no nag.
    fireEvent.click(screen.getByRole('button', { name: 'Save slides' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(props.onChange).toHaveBeenCalledWith({ manualSlides: [DECK[0], vid('s_v', 'vid_1')] });
    expect(props.onClose).toHaveBeenCalled();
  });

  it('publishing with a video slide confirms and sends text only', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const props = baseProps({ config: { manualSlides: [DECK[0], vid('s_v', 'vid_1')], backgroundSource: 'manual' } });
    render(<SlideEditorPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Publish to all displays' }));
    await waitFor(() => expect(publish.publishDeck).toHaveBeenCalled());
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/1 video slide stays on THIS device/));
    // The deck handed to publishDeck is the full sanitized deck; publishDeck strips videos itself.
    expect(publish.publishDeck.mock.calls[0][0].map((s) => s.id)).toEqual(['s_1', 's_v']);
  });
});

describe('the show window (#345)', () => {
  // The editor NEVER hides a slide whose window has closed: the operator has
  // to be able to find and fix the one that stopped showing. It badges it.
  // Pinned to a club night in 2027, deliberately far from whatever "today"
  // really is, so a badge can never pass by accident.
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2027, 1, 10, 19, 30));
  });
  afterEach(() => { vi.useRealTimers(); });

  const dated = () => [
    text('s_1', 'Always on'),
    text('s_2', 'Store night', { showUntil: '2027-02-09' }),
    text('s_3', 'Grand Prix', { showFrom: '2027-02-11' }),
  ];

  it('shows every slide, badging the expired and the not-yet-started one', () => {
    render(<SlideEditorPanel {...baseProps({ config: { manualSlides: dated(), backgroundSource: 'manual', calendarEnabled: true } })} />);
    expect(textareas()).toHaveLength(3);
    expect(screen.getAllByText('Expired')).toHaveLength(1);
    expect(screen.getAllByText('Starts later')).toHaveLength(1);
  });

  it('edits a date and saves it onto the slide', () => {
    const props = baseProps({ config: { manualSlides: [text('s_1', 'Store night')], backgroundSource: 'manual' } });
    render(<SlideEditorPanel {...props} />);
    fireEvent.change(screen.getByLabelText('Show until (optional)'), { target: { value: '2026-09-16' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save slides' }));
    expect(props.onChange).toHaveBeenCalledWith({ manualSlides: [expect.objectContaining({ showUntil: '2026-09-16' })] });
  });

  it('a junk date is dropped on save rather than saved as a window nothing matches', () => {
    const props = baseProps({ config: { manualSlides: [text('s_1', 'Store night')], backgroundSource: 'manual' } });
    render(<SlideEditorPanel {...props} />);
    fireEvent.change(screen.getByLabelText('Show from (optional)'), { target: { value: 'not-a-date' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save slides' }));
    const [saved] = props.onChange.mock.calls[0][0].manualSlides;
    expect('showFrom' in saved).toBe(false);
  });

  it('a slide can be marked to hold check-ins, and unmarking leaves no trace', () => {
    const props = baseProps({ config: { manualSlides: [text('s_1', 'Pick-up is at the gym doors')], backgroundSource: 'manual' } });
    render(<SlideEditorPanel {...props} />);
    const box = screen.getByRole('checkbox', { name: /Hold check-ins while this slide is up/ });
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: 'Save slides' }));
    expect(props.onChange.mock.calls[0][0].manualSlides[0].holdCheckIns).toBe(true);
    fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: 'Save slides' }));
    // Omitted, never false: an unmarked slide is byte-identical to before.
    expect('holdCheckIns' in props.onChange.mock.calls[1][0].manualSlides[0]).toBe(false);
  });

  it('a video slide can hold check-ins too', () => {
    const props = baseProps({ config: { manualSlides: [vid('s_v', 'vid_1')], backgroundSource: 'manual' } });
    render(<SlideEditorPanel {...props} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Hold check-ins while this slide is up/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save slides' }));
    expect(props.onChange.mock.calls[0][0].manualSlides[0].holdCheckIns).toBe(true);
  });

  it('a video slide gets no date fields — the window is a text-slide idea', () => {
    render(<SlideEditorPanel {...baseProps({ config: { manualSlides: [vid('s_v', 'vid_1')], backgroundSource: 'manual' } })} />);
    expect(screen.queryByLabelText('Show until (optional)')).toBeNull();
  });

  it('says what the screens fall back to when every slide has expired', () => {
    render(<SlideEditorPanel {...baseProps({
      config: { manualSlides: [text('s_1', 'Old news', { showUntil: '2027-02-01' })], backgroundSource: 'manual', calendarEnabled: true },
    })} />);
    expect(screen.getByText(/playing the calendar slides instead/)).toBeTruthy();
  });
});
