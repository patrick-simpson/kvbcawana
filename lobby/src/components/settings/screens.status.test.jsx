import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Every row on the settings page's Screens has one status line under its
// On now / Off line: a Journey kiosk's saved lessons, a computer's KVBC Awana
// version and update, a TV's or projector's page version. The words (pure)
// and the rows themselves, against a stand-in list (worker/test/screens.test.js
// pins what the Worker keeps).

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

const { ScreensSection, agoWords, appStatusWords, lessonBytes, lessonStatusWords, noStatusWords, pageStatusWords } = await import('./screens.jsx');

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
      done: false, phase: 'saving', count: 'Lessons: 24 of 63 saved · 11.2 GB', state: '', error: '', saved: 'last saved 2 h ago',
    });
    expect(lessonStatusWords(lessons({ downloading: true, currentWeek: 7 }), NOW)?.state).toBe('42% · downloading Lesson 7');
    expect(lessonStatusWords(lessons({ paused: true }), NOW)?.state).toBe('paused');
    expect(lessonStatusWords(lessons({ waiting: true }), NOW)?.state).toMatch(/^waiting/);
    expect(lessonStatusWords(lessons({ auto: false }), NOW)?.state).toBe('automatic download is off here');
    expect(lessonStatusWords(lessons({ error: 'Week 8 · Leader: the internet connection dropped' }), NOW)?.error)
      .toBe('Problem: Week 8 · Leader: the internet connection dropped');
    expect(lessonStatusWords(lessons({ lastSavedAt: null }), NOW)?.saved).toBe('');
  });

  it('every lesson saved', () => {
    expect(lessonStatusWords(lessons({ saved: 63, bytesSaved: 13.9 * GB, percent: 100 }), NOW))
      .toMatchObject({ done: true, count: '63 of 63 · 13.9 GB', state: '' });
  });

  it('a browser with nothing saved and automatic download off says so plainly', () => {
    const w = lessonStatusWords(lessons({ saved: 0, bytesSaved: 0, percent: 0, auto: false, lastSavedAt: null }), NOW);
    expect(`${w?.count} · ${w?.state}`).toBe('Lessons: 0 of 63 saved · automatic download is off here');
  });

  it('not known yet, cannot save here, no lesson list: each said plainly, never nothing', () => {
    expect(lessonStatusWords(lessons({ known: false, saved: 0, total: 0 }), NOW)).toMatchObject({ phase: 'checking', count: 'Lessons: checking this computer…', state: '' });
    expect(lessonStatusWords(lessons({ supported: false, known: false, total: 0 }), NOW)).toMatchObject({ phase: 'unsupported', count: "Lessons can't be saved on this device" });
    expect(lessonStatusWords(lessons({ total: 0, saved: 0 }), NOW)?.phase).toBe('no-list');
    // An older kiosk page sends neither switch: it only ever reported once it knew.
    expect(lessonStatusWords(lessons(), NOW)?.phase).toBe('saving');
    expect(lessonStatusWords(undefined, NOW)).toBeNull();
  });

  it('a computer: its KVBC Awana version and how its update is going', () => {
    const app = (state, percent = null) => ({ version: '9.4.0', update: { state, percent, at: '2026-10-12T15:00:00.000Z' } });
    const line = (a) => { const w = appStatusWords(a); return w && `${w.version} · ${w.update}`; };
    expect(line(app('none'))).toBe('KVBC Awana 9.4.0 · up to date');
    expect(line(app('downloading', 42))).toBe('KVBC Awana 9.4.0 · downloading update 42%');
    expect(line(app('ready'))).toBe('KVBC Awana 9.4.0 · update ready, installing when idle');
    expect(line(app('error'))).toBe('KVBC Awana 9.4.0 · update could not finish downloading');
    expect(appStatusWords(app('error'))?.warn).toBe(true);
    expect(appStatusWords(undefined)).toBeNull();
  });

  it('a TV or projector: its page version', () => {
    expect(pageStatusWords({ build: 'a1b2c3d' })).toBe('Page version a1b2c3d');
    expect(pageStatusWords({ build: null })).toBe('Page version unknown');
    expect(pageStatusWords(undefined)).toBeNull();
  });

  it('before the first report: "Checking…" while on; a computer on an older app says why', () => {
    expect(noStatusWords({ kind: 'lobby', online: true })).toBe('Checking…');
    expect(noStatusWords({ kind: 'journey', online: false })).toBe('Nothing reported yet');
    expect(noStatusWords({ kind: 'computer', online: true })).toMatch(/newest KVBC Awana app/);
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
    expect(busy.textContent).toContain('Lessons: 24 of 63 saved · 11.2 GB · 42% · downloading Lesson 7 · last saved');
    expect(busy.querySelector('.screen-row__status--stale')).toBeNull();

    const done = row('jk_bbbbbbbbbbbbbbbbbbbb');
    expect(done.querySelector('.screen-row__done')?.textContent).toBe('All saved ✓');
    expect(done.textContent).toContain('Off');
    expect(done.querySelector('.screen-row__status--stale')).toBeTruthy();

    const fresh = /** @type {HTMLElement} */ (row('jk_cccccccccccccccccccc').querySelector('.screen-row__status'));
    expect(fresh.textContent).toBe('Checking…');
    expect(fresh.dataset.status).toBe('none');
  });

  it('a problem gets its own line', async () => {
    world.screens = [kiosk('jk_aaaaaaaaaaaaaaaaaaaa', 'Journey room', true, { lessons: lessons({ error: 'not enough disk space (3.0 GB needed, 1.2 GB free)' }) })];
    const { container } = render(<ScreensSection onOpen={() => {}} />);
    await screen.findByText('Journey kiosks');
    expect(container.querySelector('.screen-row__problem')?.textContent).toBe('Problem: not enough disk space (3.0 GB needed, 1.2 GB free)');
  });
});

describe('every row has a status line', () => {
  const row = (id, kind, name, online, status) => ({
    id, kind, name, online, live: false, createdAt: '2026-10-01T00:00:00.000Z',
    lastSeen: new Date(online ? Date.now() : Date.now() - 3 * 60 * 60 * 1000).toISOString(), ...(status ? { status } : {}),
  });
  const app = (state, percent = null) => ({ app: { version: '9.4.0', update: { state, percent, at: '2026-10-12T15:00:00.000Z' } } });

  it('TVs, projectors, kiosks and computers, each in its own words, greyed when Off', async () => {
    world.screens = [
      row('tv_aaaaaaaaaaaaaaaaaaaa', 'lobby', 'Lobby TV', true, { page: { build: 'a1b2c3d' } }),
      row('tv_bbbbbbbbbbbbbbbbbbbb', 'lobby', 'Old TV', true, null),
      row('pj_aaaaaaaaaaaaaaaaaaaa', 'projector', 'Projector', false, { page: { build: '0f9e8d7' } }),
      row('jk_aaaaaaaaaaaaaaaaaaaa', 'journey', 'Mac in the office', true, { lessons: lessons({ supported: false, known: false, saved: 0, total: 0 }) }),
      row('jk_bbbbbbbbbbbbbbbbbbbb', 'journey', 'Journey room', true, { lessons: lessons({ known: false, saved: 0, total: 0 }) }),
      row('pc_aaaaaaaaaaaaaaaaaaaa', 'computer', 'Check-in laptop', true, app('downloading', 42)),
      row('pc_bbbbbbbbbbbbbbbbbbbb', 'computer', 'Sound room', true, app('error')),
      row('pc_cccccccccccccccccccc', 'computer', 'Office PC', false, app('ready')),
      row('pc_dddddddddddddddddddd', 'computer', 'Old app', true, null),
    ];
    const { container } = render(<ScreensSection onOpen={() => {}} />);
    await screen.findByText('Computers');
    const line = (id) => /** @type {HTMLElement} */ (container.querySelector(`[data-screen="${id}"] .screen-row__status`));

    // Exactly one line in every row.
    for (const s of world.screens) expect(container.querySelectorAll(`[data-screen="${s.id}"] .screen-row__status`)).toHaveLength(1);

    expect(line('tv_aaaaaaaaaaaaaaaaaaaa').textContent).toBe('Page version a1b2c3d');
    expect(line('tv_bbbbbbbbbbbbbbbbbbbb').textContent).toBe('Checking…');
    expect(line('pj_aaaaaaaaaaaaaaaaaaaa').textContent).toBe('Page version 0f9e8d7');
    expect(line('pj_aaaaaaaaaaaaaaaaaaaa').classList.contains('screen-row__status--stale')).toBe(true);
    expect(line('jk_aaaaaaaaaaaaaaaaaaaa').textContent).toBe("Lessons can't be saved on this device");
    expect(line('jk_bbbbbbbbbbbbbbbbbbbb').textContent).toBe('Lessons: checking this computer…');
    expect(line('pc_aaaaaaaaaaaaaaaaaaaa').textContent).toBe('KVBC Awana 9.4.0 · downloading update 42%');
    expect(line('pc_aaaaaaaaaaaaaaaaaaaa').classList.contains('screen-row__status--stale')).toBe(false);
    expect(line('pc_bbbbbbbbbbbbbbbbbbbb').querySelector('.screen-row__warn')?.textContent).toBe('update could not finish downloading');
    expect(line('pc_cccccccccccccccccccc').textContent).toBe('KVBC Awana 9.4.0 · update ready, installing when idle');
    expect(line('pc_cccccccccccccccccccc').classList.contains('screen-row__status--stale')).toBe(true);
    expect(line('pc_dddddddddddddddddddd').textContent).toMatch(/newest KVBC Awana app/);
  });

  it('another kind\'s status is never worded on the wrong row', async () => {
    world.screens = [row('tv_aaaaaaaaaaaaaaaaaaaa', 'lobby', 'Lobby TV', true, app('none'))];
    const { container } = render(<ScreensSection onOpen={() => {}} />);
    await screen.findByText('Lobby TVs');
    expect(container.querySelector('.screen-row__status')?.textContent).toBe('Checking…');
  });
});
