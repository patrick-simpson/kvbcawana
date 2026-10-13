import { describe, expect, it } from 'vitest';
import { DOWNLOAD_ACTIONS, DOWNLOAD_BUTTON_WORDS, JOURNEY_DEFAULTS, downloadButtons, journeyDocFrom, journeyView, mergeJourney } from './journeyClient.js';
import { SCREEN_ACTIONS, sanitizeJourney } from './syncSpecs.js';

const L = (over = {}) => ({ saved: 3, total: 63, bytesSaved: 3e9, bytesTotal: 14e9, downloading: false, waiting: false, paused: false, known: true, supported: true, ...over });

describe('the Journey room document', () => {
  it('a change lays only its keys over the newest copy, through the shared sanitizer', () => {
    const current = { captions: true, slideNotes: { 5: { questions: ['Q'] } }, slideExtras: { takeaways: false }, junk: 1 };
    const out = mergeJourney(current, { captionSize: '1.3', slideExtras: { questions: false }, other: 'x' });
    expect(out).toEqual(sanitizeJourney(out));
    expect(out).toEqual({
      captions: true, captionSize: '1.3', slideExtras: { questions: false, takeaways: false, challenges: true }, slideNotes: { 5: { questions: ['Q'] } },
    });
    expect(mergeJourney(null, { captionSize: '9' })).toEqual({});   // a size the kiosk has no choice for is never sent
    expect(mergeJourney({}, { slidesAutoAdvanceSec: 9999 })).toEqual({ slidesAutoAdvanceSec: 600 });
  });

  it('reads a document (or none) and shows the kiosk defaults where it says nothing', () => {
    expect(journeyDocFrom(null)).toBeNull();
    expect(journeyDocFrom({ settings: {} })).toBeNull();
    expect(journeyDocFrom({ savedAt: 'x', settings: { captions: 'yes', captionSize: '1.6' } })).toEqual({ savedAt: 'x', settings: { captionSize: '1.6' } });
    expect(journeyView(null)).toEqual({ captions: null, ...JOURNEY_DEFAULTS, slideExtras: { ...JOURNEY_DEFAULTS.slideExtras } });
    expect(journeyView({ savedAt: 'x', settings: { captions: false, slideExtras: { challenges: false } } })).toMatchObject({
      captions: false, slideExtras: { questions: true, takeaways: true, challenges: false },
    });
  });
});

describe("a kiosk's download buttons", () => {
  it('are the five Journey actions, worded', () => {
    expect(DOWNLOAD_ACTIONS).toBe(SCREEN_ACTIONS.journey);
    for (const a of DOWNLOAD_ACTIONS) expect(DOWNLOAD_BUTTON_WORDS[a]).toBeTruthy();
  });

  const shown = (l, online = true) => downloadButtons(l, online).buttons.map((b) => b.action);
  it('show what the status calls for', () => {
    expect(shown(L())).toEqual(['start-downloads', 'delete-downloads']);
    expect(shown(L({ downloading: true }))).toEqual(['pause-downloads', 'stop-downloads', 'delete-downloads']);
    expect(shown(L({ waiting: true }))).toEqual(['pause-downloads', 'stop-downloads', 'delete-downloads']);
    expect(shown(L({ paused: true }))).toEqual(['resume-downloads', 'stop-downloads', 'delete-downloads']);
    expect(shown(L({ saved: 0, bytesSaved: 0 }))).toEqual(['start-downloads']);
  });

  it('are disabled while the kiosk is off, checking, unable to save, or silent, and say why', () => {
    expect(downloadButtons(L(), false)).toEqual({ why: 'It is off: these work when it is on.', buttons: [{ action: 'start-downloads', disabled: true }, { action: 'delete-downloads', disabled: true }] });
    expect(downloadButtons(L({ known: false }), true).why).toBe('It is still checking what is saved.');
    expect(downloadButtons(L({ supported: false }), true).why).toBe('This device cannot save lessons.');
    expect(downloadButtons(null, true).why).toBe('It has not reported its lessons yet.');
    expect(downloadButtons(null, true).buttons.every((b) => b.disabled)).toBe(true);
    expect(downloadButtons(L(), true)).toEqual({ why: '', buttons: [{ action: 'start-downloads', disabled: false }, { action: 'delete-downloads', disabled: false }] });
    // All saved: nothing for Start to do.
    expect(downloadButtons(L({ saved: 63 }), true).buttons[0]).toEqual({ action: 'start-downloads', disabled: true });
  });
});
