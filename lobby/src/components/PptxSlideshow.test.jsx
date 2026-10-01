import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import PptxSlideshow from './PptxSlideshow.jsx';
import { getStoredDeckModel } from '../lib/pptxModel.js';

vi.mock('../lib/pptxModel.js', () => ({
  getStoredDeckModel: vi.fn(),
}));

// The placeholder scene runs perpetual framer-motion loops; a stub keeps
// the fake-timer tests deterministic and gives us a hook to assert on.
vi.mock('./CatalogScene.jsx', () => ({
  default: () => <div data-testid="catalog-scene" />,
}));

// Pass-through motion primitives: AnimatePresence's exit choreography
// would otherwise hold unmounting slides alive across timer advances.
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }) => children,
  motion: new Proxy({}, {
    get: (_, tag) => {
      const Tag = typeof tag === 'string' ? tag : 'div';
      return ({ children, className, style }) => (
        <Tag className={className} style={style}>{children}</Tag>
      );
    },
  }),
}));

const EMU_W = 12192000;
const EMU_H = 6858000;

const cannedModel = () => ({
  widthEmu: EMU_W,
  heightEmu: EMU_H,
  images: { 'ppt/media/image1.png': new Blob(['png'], { type: 'image/png' }) },
  slides: [
    {
      durationMs: null,
      background: { type: 'solid', color: '#112233' },
      shapes: [
        {
          type: 'text',
          x: 0, y: 0, w: EMU_W / 2, h: EMU_H / 4,
          rot: 0, flipH: false, flipV: false,
          anchor: 'b', fill: null,
          paragraphs: [
            {
              align: 'ctr',
              runs: [
                { text: 'Hello', bold: true, italic: false, underline: true, sizePt: 44, color: '#ffcc00' },
                { br: true },
                { text: 'Awana', bold: false, italic: false, underline: false, sizePt: null, color: null },
              ],
            },
            { align: 'l', runs: [] }, // blank paragraph for vertical rhythm
          ],
        },
        {
          type: 'image',
          x: 0, y: EMU_H / 2, w: EMU_W / 4, h: EMU_H / 4,
          rot: 0, flipH: false, flipV: false,
          imageKey: 'ppt/media/image1.png',
        },
        {
          type: 'shape',
          x: EMU_W / 2, y: 0, w: EMU_W / 4, h: EMU_H / 4,
          rot: 90, flipH: true, flipV: false,
          fill: { type: 'solid', color: '#e14b4b' },
          geom: 'ellipse',
        },
      ],
    },
    { durationMs: null, background: null, shapes: [], error: true },
  ],
});

describe('PptxSlideshow (store source)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
    getStoredDeckModel.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders the fallback when the deck model cannot be loaded', async () => {
    getStoredDeckModel.mockRejectedValue(new Error('No uploaded deck on this device'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <PptxSlideshow source="store" slideshowDelaySec={5} fallback={<div data-testid="fallback" />} />,
    );
    await act(async () => {});
    expect(screen.getByTestId('fallback')).toBeTruthy();
    errSpy.mockRestore();
  });

  it('renders text, image and fill-only shape boxes from the model', async () => {
    getStoredDeckModel.mockResolvedValue(cannedModel());
    const { container } = render(<PptxSlideshow source="store" slideshowDelaySec={5} />);
    await act(async () => {});

    // Text: runs with underline/bold, a <br>-driven newline, anchor=b.
    const hello = screen.getByText('Hello');
    expect(hello.style.textDecoration).toBe('underline');
    expect(hello.style.fontWeight).toBe('700');
    expect(screen.getByText('Awana')).toBeTruthy();
    const textBox = hello.closest('div').parentElement;
    expect(textBox.style.justifyContent).toBe('flex-end');
    expect(hello.parentElement.style.whiteSpace).toBe('pre-wrap');
    // The blank paragraph still occupies a line (nbsp under pre-wrap).
    expect(textBox.children).toHaveLength(2);

    // Image: object URL minted from the model's blob.
    const img = container.querySelector('img');
    expect(img.getAttribute('src')).toBe('blob:mock');

    // Fill-only shape: ellipse → 50% radius, rot/flip → CSS transform.
    const shape = container.querySelector('[data-pptx-shape="ellipse"]');
    expect(shape.style.background).toBe('rgb(225, 75, 75)');
    expect(shape.style.borderRadius).toBe('50%');
    expect(shape.style.transform).toBe('rotate(90deg) scale(-1, 1)');
  });

  it('advances on the timer and shows CatalogScene for an error slide', async () => {
    getStoredDeckModel.mockResolvedValue(cannedModel());
    render(<PptxSlideshow source="store" slideshowDelaySec={5} />);
    await act(async () => {});
    expect(screen.getByText('Hello')).toBeTruthy();
    expect(screen.queryByTestId('catalog-scene')).toBeNull();

    // durationMs is null on both slides → the configured 5s delay rules.
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByText('Hello')).toBeNull();
    expect(screen.getByTestId('catalog-scene')).toBeTruthy();

    // …and wraps back around to the renderable slide.
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByText('Hello')).toBeTruthy();
  });

  it('contains a runtime render crash to that slide and keeps advancing', async () => {
    const model = cannedModel();
    // paragraphs:null makes SlideView throw at render time — the per-slide
    // ErrorBoundary must swallow it and show the placeholder instead.
    model.slides[0] = {
      durationMs: null,
      background: null,
      shapes: [{ type: 'text', x: 0, y: 0, w: 1, h: 1, paragraphs: null }],
    };
    model.slides[1] = {
      durationMs: null,
      background: { type: 'solid', color: '#112233' },
      shapes: [],
    };
    getStoredDeckModel.mockResolvedValue(model);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Quiet jsdom's window-level report of the (intentional) crash.
    const swallow = (e) => e.preventDefault();
    window.addEventListener('error', swallow);

    const { container } = render(<PptxSlideshow source="store" slideshowDelaySec={5} />);
    await act(async () => {});
    expect(screen.getByTestId('catalog-scene')).toBeTruthy();

    // The advance timer survived the crash: next slide renders normally.
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByTestId('catalog-scene')).toBeNull();
    expect(container.querySelector('.pptx-slide')).toBeTruthy();
    window.removeEventListener('error', swallow);
    errSpy.mockRestore();
  });
});
