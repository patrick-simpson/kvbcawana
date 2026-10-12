import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// A Journey kiosk's row on the settings page shows how saving the
// full-quality lessons is going: the words (pure) and the row itself, against
// a stand-in list (worker/test/screens.test.js pins what the Worker keeps).

const world = vi.hoisted(() => ({ screens: /** @type {any[]} */ ([]) }));
vi.mock('../../hooks/useSync.js', () => ({ useSync: () => ({ signedIn: true, url: 'https://sync.test' }) }));
vi.mock('../../hooks/useScreenSync.js', () => ({
  listScreens: async () => ({ ok: true, screens: world.screens }),
  loadScreen: async () => ({ ok: true, settings: null }),
  saveScreenSettings: async () => ({ ok: true }),
  renameScreen: async () => ({ ok: true }),
  forgetScreen: async () => ({ ok: true }),
  sendScreenAction: async () => ({ ok: true }),
}));

const { ScreensSection, agoWords, lessonBytes, lessonStatusWords } = await import('./screens.jsx');

afterEach(cleanup);

const NOW = Date.parse('2026-10-12T16:00:00Z');
const GB = 1024 ** 3;
const lessons = (patch = {}) => ({
  saved: 24, total: 63, bytesSaved: 11.2 * GB, bytesTotal: 13.9 * GB, downloading: false, waiting: false, paused: false,
  percent: 42, currentWeek: null, lastSavedAt: '2026-10-12T14:00:00.000Z', error: null, auto: true, ...patch,
});

describe('the words', () => {
  it('how long ago, in hours past the first hour', () => {
    expect(agoWords('2026-10-12T15:59:50Z', NOW)).toBe('just now');
    expect(agoWords('2026-10-12T15:48:00Z', NOW)).toBe('12 min ago');
    expect(agoWords('2026-10-12T14:00:00Z', NOW)).toBe('2 h ago');
    expect(agoWords('2026-10-09T16:00:00Z', NOW)).toBe('3 days ago');
    expect(agoWords(null, NOW)).toBe('');
  });

  it('sizes as the kiosk counts them', () => {
    expect(lessonBytes(11.2 * GB)).toBe('11.2 GB');
    expect(lessonBytes(640 * 1024 * 1024)).toBe('640 MB');
  });

  it('saving, downloading, paused, waiting, off, a problem', () => {
    expect(lessonStatusWords(lessons(), NOW)).toEqual({
      done: false, count: 'Lessons saved: 24 of 63 · 11.2 GB', state: '', error: '', saved: 'last saved 2 h ago',
    });
    expect(lessonStatusWords(lessons({ downloading: true, currentWeek: 7 }), NOW)?.state).toBe('42% · downloading Lesson 7');
    expect(lessonStatusWords(lessons({ paused: true }), NOW)?.state).toBe('Paused');
    expect(lessonStatusWords(lessons({ waiting: true }), NOW)?.state).toMatch(/^Waiting/);
    expect(lessonStatusWords(lessons({ auto: false }), NOW)?.state).toBe('Automatic download is off');
    expect(lessonStatusWords(lessons({ error: 'Week 8 · Leader: the internet connection dropped' }), NOW)?.error)
      .toBe('Problem: Week 8 · Leader: the internet connection dropped');
    expect(lessonStatusWords(lessons({ lastSavedAt: null }), NOW)?.saved).toBe('');
  });

  it('every lesson saved', () => {
    expect(lessonStatusWords(lessons({ saved: 63, bytesSaved: 13.9 * GB, percent: 100 }), NOW))
      .toMatchObject({ done: true, count: '63 of 63 · 13.9 GB', state: '' });
  });

  it('nothing to say without a status or a lesson list', () => {
    expect(lessonStatusWords(undefined, NOW)).toBeNull();
    expect(lessonStatusWords(lessons({ total: 0, saved: 0 }), NOW)).toBeNull();
  });
});

describe('the Journey kiosks group', () => {
  const kiosk = (id, name, online, status) => ({
    id, kind: 'journey', name, online, live: false, createdAt: '2026-10-01T00:00:00.000Z',
    lastSeen: new Date(online ? Date.now() : Date.now() - 3 * 60 * 60 * 1000).toISOString(), ...(status ? { status } : {}),
  });

  it('shows each kiosk\'s saved lessons, "All saved ✓" when done, greyed when it is off', async () => {
    world.screens = [
      kiosk('jk_aaaaaaaaaaaaaaaaaaaa', 'Journey room', true, { lessons: lessons({ downloading: true, currentWeek: 7 }) }),
      kiosk('jk_bbbbbbbbbbbbbbbbbbbb', 'Spare kiosk', false, { lessons: lessons({ saved: 63, bytesSaved: 13.9 * GB, percent: 100 }) }),
      kiosk('jk_cccccccccccccccccccc', 'New kiosk', true, null),
    ];
    const { container } = render(<ScreensSection onOpen={() => {}} />);
    await screen.findByText('Journey kiosks');
    const row = (id) => /** @type {HTMLElement} */ (container.querySelector(`[data-screen="${id}"]`));

    const busy = row('jk_aaaaaaaaaaaaaaaaaaaa');
    expect(busy.textContent).toContain('Lessons saved: 24 of 63 · 11.2 GB · 42% · downloading Lesson 7 · last saved');
    expect(busy.querySelector('.screen-row__status--stale')).toBeNull();

    const done = row('jk_bbbbbbbbbbbbbbbbbbbb');
    expect(done.querySelector('.screen-row__done')?.textContent).toBe('All saved ✓');
    expect(done.textContent).toContain('Off');
    expect(done.querySelector('.screen-row__status--stale')).toBeTruthy();

    expect(row('jk_cccccccccccccccccccc').querySelector('.screen-row__status')).toBeNull();
  });

  it('a problem gets its own line', async () => {
    world.screens = [kiosk('jk_aaaaaaaaaaaaaaaaaaaa', 'Journey room', true, { lessons: lessons({ error: 'not enough disk space (3.0 GB needed, 1.2 GB free)' }) })];
    const { container } = render(<ScreensSection onOpen={() => {}} />);
    await screen.findByText('Journey kiosks');
    expect(container.querySelector('.screen-row__problem')?.textContent).toBe('Problem: not enough disk space (3.0 GB needed, 1.2 GB free)');
  });
});
