import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import VideoBackground, { BACKGROUND_VIDEO_CHANGED_EVENT } from './VideoBackground.jsx';
import { BACKGROUND_VIDEO_ID, getVideo } from '../lib/videoStore.js';

vi.mock('../lib/videoStore.js', () => ({
  BACKGROUND_VIDEO_ID: 'v_background',
  getVideo: vi.fn(),
}));

// Resolve the getVideo promise queued in the mount effect.
const flush = () => act(() => Promise.resolve());

describe('VideoBackground', () => {
  beforeEach(() => {
    window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
    URL.createObjectURL = vi.fn(() => 'blob:mock-bg');
    URL.revokeObjectURL = vi.fn();
    getVideo.mockReset();
  });

  afterEach(() => cleanup());

  it('plays the stored background video muted, looping, inline', async () => {
    getVideo.mockResolvedValue(new Blob(['x'], { type: 'video/mp4' }));
    const { container } = render(<VideoBackground fallback={<div>fallback</div>} />);
    await flush();

    expect(getVideo).toHaveBeenCalledWith(BACKGROUND_VIDEO_ID);
    const video = container.querySelector('video.background-video');
    expect(video).toBeTruthy();
    expect(video.getAttribute('src')).toBe('blob:mock-bg');
    // The three attributes autoplay policy and kiosk reloads depend on.
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(screen.queryByText('fallback')).toBeNull();
  });

  it('shows the fallback when no video is stored on this device', async () => {
    getVideo.mockResolvedValue(null);
    const { container } = render(<VideoBackground fallback={<div>fallback</div>} />);
    await flush();

    expect(screen.getByText('fallback')).toBeTruthy();
    expect(container.querySelector('video')).toBeNull();
  });

  it('falls back when the video element reports a decode error', async () => {
    getVideo.mockResolvedValue(new Blob(['x'], { type: 'video/mp4' }));
    const { container } = render(<VideoBackground fallback={<div>fallback</div>} />);
    await flush();

    fireEvent.error(container.querySelector('video'));
    expect(screen.getByText('fallback')).toBeTruthy();
    expect(container.querySelector('video')).toBeNull();
  });

  it('re-reads the slot when Settings announces a change — no reload needed', async () => {
    // The latch bug this pins: source already 'video', slot empty → placeholder;
    // the operator uploads a video and saves — no prop changes, so only the
    // change event can un-latch `broken` and load the new blob.
    getVideo.mockResolvedValue(null);
    const { container } = render(<VideoBackground fallback={<div>fallback</div>} />);
    await flush();
    expect(screen.getByText('fallback')).toBeTruthy();

    getVideo.mockResolvedValue(new Blob(['x'], { type: 'video/mp4' }));
    await act(async () => {
      window.dispatchEvent(new Event(BACKGROUND_VIDEO_CHANGED_EVENT));
      await Promise.resolve();
    });
    expect(container.querySelector('video.background-video')).toBeTruthy();

    // And the reverse: a remove drops back to the fallback.
    getVideo.mockResolvedValue(null);
    await act(async () => {
      window.dispatchEvent(new Event(BACKGROUND_VIDEO_CHANGED_EVENT));
      await Promise.resolve();
    });
    expect(screen.getByText('fallback')).toBeTruthy();
    expect(container.querySelector('video')).toBeNull();
  });

  it('revokes the object URL on unmount so the blob is not leaked', async () => {
    getVideo.mockResolvedValue(new Blob(['x'], { type: 'video/mp4' }));
    const { unmount } = render(<VideoBackground fallback={null} />);
    await flush();

    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-bg');
  });
});
