import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { sanitizeJourney } from '../../lib/syncSpecs.js';

// /settings → Journey (owner 2026-10-12): the room settings every Journey kiosk
// follows (the Worker's one journey document, edited through the shared
// sanitizer, never clobbering tonight's bullets), and every kiosk's saved
// lessons with its download buttons (each one a queued command for that kiosk)
// and its two switches (its own screen settings). The Worker is scripted.

const calls = vi.hoisted(() => []);
const world = vi.hoisted(() => ({ journey: null, screens: [], answer: null, signedIn: true }));
vi.mock('../../hooks/useSync.js', () => ({
  useSync: () => ({ url: 'https://w.test', signedIn: world.signedIn, phase: 'ok', lastSyncAt: 1, template: null, kid: 'k' }),
  syncAuthed: async (path, opts = {}) => {
    calls.push({ path, method: opts.method || 'GET', body: opts.body });
    return world.answer(path, opts);
  },
}));

const { JourneySection } = await import('./sections/JourneySection.jsx');
const { SettingsPageContext } = await import('./fields.jsx');

const KIOSK = 'jk_cccccccccccccccccccc';
const lessons = (over = {}) => ({
  saved: 24, total: 63, bytesSaved: 12 * 1024 ** 3, bytesTotal: 13.9 * 1024 ** 3, downloading: false, waiting: false, paused: false,
  percent: 0, currentWeek: null, lastSavedAt: null, error: null, auto: true, leaders: true, known: true, supported: true, ...over,
});
const kiosk = (over = {}) => ({
  id: KIOSK, kind: 'journey', name: 'Journey room', createdAt: '2026-10-01T00:00:00Z', lastSeen: new Date().toISOString(),
  online: true, live: false, status: { lessons: lessons() }, ...over,
});

const ROOM = {
  savedAt: '2026-10-12T18:00:00.000Z',
  settings: { captions: false, captionSize: '1', slidesAutoAdvanceSec: 30, slideExtras: { questions: false }, slideNotes: { 5: { questions: ['What is grace?'] } } },
};

function serve(path, opts = {}) {
  const method = opts.method || 'GET';
  if (path === '/v1/journey' && method === 'GET') return { ok: true, status: 200, body: { journey: world.journey } };
  if (path === '/v1/journey' && method === 'PUT') {
    world.journey = { savedAt: new Date(Date.parse(world.journey?.savedAt || '2026-10-12T18:00:00Z') + 1000).toISOString(), settings: sanitizeJourney(opts.body.settings) };
    return { ok: true, status: 200, body: world.journey };
  }
  if (path === '/v1/screens' && method === 'GET') return { ok: true, status: 200, body: { screens: world.screens, max: 40 } };
  if (/\/v1\/screens\/[^/]+\/action$/.test(path)) return { ok: true, status: 200, body: { ok: true, delivered: false, queued: true } };
  if (/\/v1\/screens\/[^/]+\/settings$/.test(path) && method === 'PUT') return { ok: true, status: 200, body: { savedAt: 'x', settings: opts.body.settings, dropped: [] } };
  return { ok: false, status: 404, body: null };
}

const mount = (props = {}) => render(<SettingsPageContext.Provider value><JourneySection goTo={vi.fn()} {...props} /></SettingsPageContext.Provider>);
const puts = () => calls.filter((c) => c.path === '/v1/journey' && c.method === 'PUT');
const actions = () => calls.filter((c) => c.path.endsWith('/action'));

beforeEach(() => {
  calls.length = 0;
  world.journey = structuredClone(ROOM);
  world.screens = [kiosk()];
  world.answer = serve;
  world.signedIn = true;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('the room settings (Captions, Teaching slides)', () => {
  it('shows the document, falling back to what a kiosk does when it says nothing', async () => {
    mount();
    await waitFor(() => expect(screen.getByLabelText('Auto-advance').value).toBe('30'));
    expect(screen.getByRole('heading', { name: 'Captions' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Teaching slides' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Show captions on the lesson videos' }).checked).toBe(false);
    expect(screen.getByLabelText('Text size').value).toBe('1');
    expect(screen.getByRole('checkbox', { name: 'Dark backdrop' }).checked).toBe(false);   // not in the document: the kiosk's default
    expect(screen.getByRole('checkbox', { name: 'Talk About It' }).checked).toBe(false);
    expect(screen.getByRole('checkbox', { name: 'Remember This' }).checked).toBe(true);    // the default for a kind not named
    expect(screen.getAllByText('Every Journey kiosk')).toHaveLength(2);
  });

  it('a change sends the WHOLE newest document, through the shared sanitizer, keeping tonight\'s bullets', async () => {
    mount();
    await waitFor(() => expect(screen.getByLabelText('Auto-advance').value).toBe('30'));
    // Someone edits the bullets on a kiosk meanwhile: the page reads the newest before it writes.
    world.journey = { ...world.journey, savedAt: '2026-10-12T18:30:00.000Z', settings: { ...world.journey.settings, slideNotes: { 5: { takeaways: ['Grace is a gift'] } } } };
    fireEvent.click(screen.getByRole('checkbox', { name: 'Dark backdrop' }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    const sent = puts()[0].body.settings;
    expect(sent).toEqual(sanitizeJourney(sent));
    expect(sent).toMatchObject({ captions: false, captionBackdrop: true, slidesAutoAdvanceSec: 30, slideNotes: { 5: { takeaways: ['Grace is a gift'] } } });
    expect(await screen.findByText(/Saved\. Every Journey kiosk takes it within seconds/)).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Talk About It' }));
    await waitFor(() => expect(puts()).toHaveLength(2));
    // One extra ticked keeps the other two as they were.
    expect(puts()[1].body.settings.slideExtras).toEqual({ questions: true, takeaways: true, challenges: true });

    fireEvent.change(screen.getByLabelText('Text size'), { target: { value: '1.6' } });
    fireEvent.change(screen.getByLabelText('Auto-advance'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show captions on the lesson videos' }));
    await waitFor(() => expect(puts()).toHaveLength(5));
    expect(world.journey.settings).toMatchObject({ captionSize: '1.6', slidesAutoAdvanceSec: 0, captions: true, captionBackdrop: true });
    expect(world.journey.settings.slideNotes).toEqual({ 5: { takeaways: ['Grace is a gift'] } });
  });

  it('a refused save says so on the card it came from', async () => {
    mount();
    await waitFor(() => expect(screen.getByLabelText('Auto-advance').value).toBe('30'));
    world.answer = (path, opts) => (path === '/v1/journey' && opts.method === 'PUT' ? { ok: false, status: 413, body: { error: 'That is too big to save.' } } : serve(path, opts));
    fireEvent.change(screen.getByLabelText('Auto-advance'), { target: { value: '60' } });
    const slides = screen.getByRole('heading', { name: 'Teaching slides' }).closest('.panel-card');
    expect(await within(slides).findByText('Not saved: That is too big to save.')).toBeTruthy();
    const captions = screen.getByRole('heading', { name: 'Captions' }).closest('.panel-card');
    expect(within(captions).queryByText(/Not saved/)).toBeNull();
  });

  it('an older Worker without GET /v1/journey: the same document is read from /v1/state', async () => {
    world.answer = (path, opts = {}) => {
      if (path === '/v1/journey' && (opts.method || 'GET') === 'GET') return { ok: false, status: 404, body: null };
      if (path === '/v1/state') return { ok: true, status: 200, body: { journey: ROOM, slides: null } };
      return serve(path, opts);
    };
    mount();
    await waitFor(() => expect(screen.getByLabelText('Auto-advance').value).toBe('30'));
  });

  it('signed out: one card that says to sign in, and no Worker call', () => {
    world.signedIn = false;
    mount();
    expect(screen.getByText(/Sign in under Account & app to change the Journey kiosks/)).toBeTruthy();
    expect(calls).toEqual([]);
  });
});

describe('the phone remote', () => {
  it('a card at the top links to the phone remote page, on this site, in a new tab', async () => {
    mount();
    const link = screen.getByRole('link', { name: /Open the phone remote/ });
    expect(link.getAttribute('href')).toBe('/journey/remote/');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    const titles = [...document.querySelectorAll('.panel-card h3')].map((h) => h.textContent);
    expect(titles[0]).toBe('Phone remote');
    expect(screen.getByText(/Every press goes to every Journey kiosk/)).toBeTruthy();
    await screen.findByText('Journey room');
  });

  it('signed out: no link (the one sign-in card only)', () => {
    world.signedIn = false;
    mount();
    expect(screen.queryByRole('link', { name: /Open the phone remote/ })).toBeNull();
  });
});

describe('Lessons on the Journey PCs', () => {
  const row = async () => {
    await screen.findByText('Journey room');
    return screen.getByText('Journey room').closest('li');
  };

  it('lists every Journey kiosk (and only those) with its progress in words and as a bar', async () => {
    world.screens = [
      kiosk({ status: { lessons: lessons({ downloading: true, percent: 42, currentWeek: 7 }) } }),
      { id: 'tv_aaaaaaaaaaaaaaaaaaaa', kind: 'lobby', name: 'Front door TV', online: true, lastSeen: new Date().toISOString() },
    ];
    mount();
    const r = await row();
    expect(screen.queryByText('Front door TV')).toBeNull();
    expect(within(r).getByTestId('kiosk-lessons-words').textContent).toBe('Lessons: 24 of 63 saved · 12.0 GB · 42% · downloading Lesson 7');
    const bar = within(r).getByRole('progressbar', { name: 'Lessons saved on Journey room' });
    expect(bar.getAttribute('aria-valuenow')).toBe('86');
    expect(within(r).getByText(/86% of 13\.9 GB saved · now Lesson 7 at 42%/)).toBeTruthy();
  });

  it('each button sends its command to that kiosk; Delete asks first', async () => {
    mount();
    let r = await row();
    fireEvent.click(within(r).getByRole('button', { name: 'Start downloading' }));
    await waitFor(() => expect(actions()).toHaveLength(1));
    expect(actions()[0]).toEqual({ path: `/v1/screens/${KIOSK}/action`, method: 'POST', body: { action: 'start-downloads' } });
    expect(await within(r).findByText(/Sent\. Journey room does it within a few seconds/)).toBeTruthy();

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(within(r).getByRole('button', { name: 'Delete downloaded lessons' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/^Delete every downloaded lesson on Journey room\?/));
    await new Promise((res) => setTimeout(res, 10));
    expect(actions()).toHaveLength(1);   // "Cancel" sends nothing
    fireEvent.click(within(r).getByRole('button', { name: 'Delete downloaded lessons' }));
    await waitFor(() => expect(actions()).toHaveLength(2));
    expect(actions()[1].body).toEqual({ action: 'delete-downloads' });

    // Running: Pause and Stop. Paused: Resume and Stop.
    cleanup();
    calls.length = 0;
    world.screens = [kiosk({ status: { lessons: lessons({ downloading: true, percent: 10, currentWeek: 3 }) } })];
    mount();
    r = await row();
    expect(within(r).queryByRole('button', { name: 'Start downloading' })).toBeNull();
    fireEvent.click(within(r).getByRole('button', { name: 'Pause' }));
    // One press at a time: the buttons wait for the answer, so a double tap sends once.
    expect(within(r).getByRole('button', { name: 'Stop' }).disabled).toBe(true);
    await waitFor(() => expect(within(r).getByRole('button', { name: 'Stop' }).disabled).toBe(false));
    fireEvent.click(within(r).getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(actions().map((a) => a.body.action)).toEqual(['pause-downloads', 'stop-downloads']));
    cleanup();
    calls.length = 0;
    world.screens = [kiosk({ status: { lessons: lessons({ paused: true }) } })];
    mount();
    r = await row();
    fireEvent.click(within(r).getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(actions().map((a) => a.body.action)).toEqual(['resume-downloads']));
    expect(within(r).getByRole('button', { name: 'Stop' })).toBeTruthy();
  });

  it('every button is disabled while the kiosk is Off (and says why); so while it is checking or cannot save', async () => {
    world.screens = [kiosk({ online: false })];
    mount();
    let r = await row();
    const buttons = within(r).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Start downloading', 'Delete downloaded lessons']);
    expect(buttons.every((b) => b.disabled)).toBe(true);
    expect(within(r).getByText('It is off: these work when it is on.')).toBeTruthy();
    cleanup();
    world.screens = [kiosk({ status: { lessons: lessons({ known: false, saved: 0, total: 0, bytesSaved: 0, bytesTotal: 0 }) } })];
    mount();
    r = await row();
    expect(within(r).getAllByRole('button').every((b) => b.disabled)).toBe(true);
    expect(within(r).getByText('It is still checking what is saved.')).toBeTruthy();
    cleanup();
    world.screens = [kiosk({ status: { lessons: lessons({ supported: false, known: false, saved: 0, total: 0 }) } })];
    mount();
    r = await row();
    expect(within(r).getByText('This device cannot save lessons.')).toBeTruthy();
    expect(within(r).getByRole('checkbox', { name: 'Download lessons automatically' }).disabled).toBe(true);
    // Everything saved: Start has nothing left to do.
    cleanup();
    world.screens = [kiosk({ status: { lessons: lessons({ saved: 63, bytesSaved: 13.9 * 1024 ** 3 }) } })];
    mount();
    r = await row();
    expect(within(r).getByTestId('kiosk-lessons-words').textContent).toMatch(/^All saved ✓ · 63 of 63/);
    expect(within(r).getByRole('button', { name: 'Start downloading' }).disabled).toBe(true);
  });

  it('the two switches are that kiosk\'s own settings: both values written together, from what it reported', async () => {
    world.screens = [kiosk({ status: { lessons: lessons({ auto: true, leaders: false }) } })];
    mount();
    const r = await row();
    const auto = within(r).getByRole('checkbox', { name: 'Download lessons automatically' });
    const leaders = within(r).getByRole('checkbox', { name: 'Include Leader Videos' });
    expect([auto.checked, leaders.checked]).toEqual([true, false]);
    fireEvent.click(auto);
    await waitFor(() => expect(calls.filter((c) => c.path.endsWith('/settings'))).toHaveLength(1));
    expect(calls.find((c) => c.path.endsWith('/settings'))).toEqual({
      path: `/v1/screens/${KIOSK}/settings`, method: 'PUT', body: { settings: { downloadsAuto: false, downloadsLeader: false } },
    });
    expect(auto.checked).toBe(false);
    expect(await within(r).findByText(/Saved\. Journey room takes it within seconds/)).toBeTruthy();
  });

  it('no kiosk yet: says how one shows up', async () => {
    world.screens = [];
    mount();
    expect(await screen.findByText(/No Journey kiosk has signed in yet/)).toBeTruthy();
  });
});
