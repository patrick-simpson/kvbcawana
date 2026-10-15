import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as shared from './journeyRemote.js';
import * as specs from '../src/lib/syncSpecs.js';

// The Journey phone remote's one set of rules: the Worker (through
// syncSpecs.js) and the phone page (a byte copy under journey/public/src/shared/)
// both clean presses and kiosk reports with exactly these functions.

const { sanitizeJourneyRemote, sanitizeJourneyNow } = shared;

describe('the same rules for the Worker and the phone page', () => {
  it('syncSpecs.js hands out this very module\'s functions and lists', () => {
    expect(specs.sanitizeJourneyRemote).toBe(sanitizeJourneyRemote);
    expect(specs.sanitizeJourneyNow).toBe(sanitizeJourneyNow);
    expect(specs.JOURNEY_REMOTE_ACTIONS).toBe(shared.JOURNEY_REMOTE_ACTIONS);
    expect(specs.JOURNEY_PICKER_CHOICES).toBe(shared.JOURNEY_PICKER_CHOICES);
  });

  it('the picker choices are the kiosk\'s own PICKER_CHOICES keys', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, '../../journey/src/schedule/19-picker-final-step.js'), 'utf8');
    const block = /const PICKER_CHOICES = \{([\s\S]*?)\n\};/.exec(src)[1];
    const keys = [...block.matchAll(/^ {2}'?([a-z-]+)'?: \(/gm)].map((m) => m[1]);
    expect(keys).toEqual([...shared.JOURNEY_PICKER_CHOICES]);
  });
});

describe('a press', () => {
  it('only the allowlisted actions; data dropped except a seek\'s and a pick\'s', () => {
    expect(sanitizeJourneyRemote('slide-next', { evil: 1 })).toEqual({ action: 'slide-next' });
    expect(sanitizeJourneyRemote('format-disk')).toBeNull();
    expect(sanitizeJourneyRemote('Slide-Next')).toBeNull();
    expect(sanitizeJourneyRemote(undefined)).toBeNull();
    expect(sanitizeJourneyRemote('__proto__')).toBeNull();
  });

  it('a seek: signed whole seconds, at most 15 either way, never 0', () => {
    expect(sanitizeJourneyRemote('seek', { by: 15 })).toEqual({ action: 'seek', data: { by: 15 } });
    expect(sanitizeJourneyRemote('seek', { by: -600 })).toEqual({ action: 'seek', data: { by: -15 } });
    expect(sanitizeJourneyRemote('seek', { by: 4.6 })).toEqual({ action: 'seek', data: { by: 5 } });
    expect(sanitizeJourneyRemote('seek', { by: 0.2 })).toBeNull();
    expect(sanitizeJourneyRemote('seek', { by: '15' })).toBeNull();
    expect(sanitizeJourneyRemote('seek', { by: Infinity })).toBeNull();
    expect(sanitizeJourneyRemote('seek')).toBeNull();
  });

  it('a volume press: exactly one step up or down, nothing else', () => {
    expect(shared.JOURNEY_REMOTE_ACTIONS).toContain('volume');
    expect(shared.JOURNEY_VOLUME_STEP_PCT).toBe(10);
    expect(sanitizeJourneyRemote('volume', { step: 1 })).toEqual({ action: 'volume', data: { step: 1 } });
    expect(sanitizeJourneyRemote('volume', { step: -1, extra: 'x' })).toEqual({ action: 'volume', data: { step: -1 } });
    for (const bad of [undefined, null, {}, { step: 0 }, { step: 2 }, { step: -5 }, { step: '1' }, { step: 0.5 }, { step: NaN }, { level: 50 }, 1]) {
      expect(sanitizeJourneyRemote('volume', bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('a press as the doorbell carries it: a url-safe id (at most 40) and a clean press, else null', () => {
    const clean = shared.sanitizeJourneyPress;
    expect(specs.sanitizeJourneyPress).toBe(clean);
    expect(clean({ id: 'r1abc', action: 'slide-next', junk: 1 })).toEqual({ id: 'r1abc', action: 'slide-next' });
    expect(clean({ id: 'r1abc', action: 'volume', data: { step: -1, x: 1 } })).toEqual({ id: 'r1abc', action: 'volume', data: { step: -1 } });
    expect(clean({ id: 'r1', action: 'seek', data: { by: 99 } })).toEqual({ id: 'r1', action: 'seek', data: { by: 15 } });
    expect(clean({ id: 'r1', action: 'pick', data: { week: 5, choice: 'slides', force: true } }))
      .toEqual({ id: 'r1', action: 'pick', data: { week: 5, choice: 'slides', force: true } });
    for (const bad of [null, 'x', 7, [], {}, { id: 'r1' }, { action: 'slide-next' }, { id: '', action: 'slide-next' }, { id: 'a b', action: 'slide-next' },
      { id: 'x'.repeat(41), action: 'slide-next' }, { id: 5, action: 'slide-next' }, { id: 'r1', action: 'format-disk' },
      { id: 'r1', action: 'volume', data: { step: 3 } }, { id: 'r1', action: 'seek' }, { id: 'r1', action: 'pick', data: { week: 0, choice: 'slides' } }]) {
      expect(clean(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('a pick: a week 1..99 and a known choice; force only when literally true', () => {
    expect(sanitizeJourneyRemote('pick', { week: 5, choice: 'slides' })).toEqual({ action: 'pick', data: { week: 5, choice: 'slides' } });
    expect(sanitizeJourneyRemote('pick', { week: 5, choice: 'leader-prep', force: true, extra: 'x' }))
      .toEqual({ action: 'pick', data: { week: 5, choice: 'leader-prep', force: true } });
    expect(sanitizeJourneyRemote('pick', { week: 5, choice: 'slides', force: 'true' })).toEqual({ action: 'pick', data: { week: 5, choice: 'slides' } });
    for (const bad of [{ week: 0, choice: 'slides' }, { week: 100, choice: 'slides' }, { week: 2.5, choice: 'slides' },
      { week: '5', choice: 'slides' }, { week: 5, choice: 'video' }, { week: 5 }, null, 'week 5']) {
      expect(sanitizeJourneyRemote('pick', bad)).toBeNull();
    }
  });
});

describe('a kiosk\'s report of its screen', () => {
  const slides = {
    view: 'slides', week: 12, title: 'Unit 3, Lesson 1: Evidence', preview: false, wait: null,
    slide: { n: 5, of: 7, kind: 'questions', heading: 'Talk About It', lines: ['One?', 'Two?', 'Three?', 'Four?'] },
    last: { id: 'rabc1', action: 'slide-next', ok: true, reason: 'no-slides' },
    at: '2026-10-14T23:00:00Z',
  };

  it('keeps the one fixed shape, cleaned', () => {
    expect(sanitizeJourneyNow({ ...slides, url: 'https://cdn.example/video.mp4', video: { t: 1 } })).toEqual({
      view: 'slides', week: 12, title: 'Unit 3, Lesson 1: Evidence', preview: false, wait: null,
      slide: { n: 5, of: 7, kind: 'questions', heading: 'Talk About It', lines: ['One?', 'Two?', 'Three?'] },
      last: { id: 'rabc1', action: 'slide-next', ok: true, reason: null },
      at: '2026-10-14T23:00:00.000Z',
    });
  });

  it('a video readout carries the volume in whole percent, clamped, only when it is a number', () => {
    const v = (volume) => sanitizeJourneyNow({ view: 'video', video: { t: 1, d: 2, paused: false, muted: false, volume } }).video;
    expect(v(60)).toEqual({ t: 1, d: 2, paused: false, muted: false, volume: 60 });
    expect(v(59.6).volume).toBe(60);
    expect(v(400).volume).toBe(100);
    expect(v(-3).volume).toBe(0);
    for (const bad of ['60', null, NaN, Infinity, undefined]) expect(v(bad)).not.toHaveProperty('volume');
  });

  it('a video readout is numbers and switches; a splash may offer a resume point', () => {
    expect(sanitizeJourneyNow({ view: 'video', week: 3, video: { t: 754.333, d: 1e9, paused: 'no', muted: true }, slide: slides.slide }))
      .toEqual({ view: 'video', week: 3, title: null, preview: false, wait: null, last: null, at: null, video: { t: 754.3, d: 36000, paused: false, muted: true } });
    expect(sanitizeJourneyNow({ view: 'splash', resume: 251.9 }).resume).toBe(251);
    expect(sanitizeJourneyNow({ view: 'video', resume: 251 }).resume).toBeUndefined();
  });

  it('strings are one line of at most 80 characters; junk views, kinds and reasons do not pass', () => {
    const long = sanitizeJourneyNow({ view: 'checkin', title: `a\nb\u2028c\u0000${'x'.repeat(200)}` });
    expect(long.title).toMatch(/^a b c x+$/);
    expect([...long.title].length).toBe(80);
    expect(sanitizeJourneyNow({ view: 'dancing' })).toBeNull();
    expect(sanitizeJourneyNow([])).toBeNull();
    expect(sanitizeJourneyNow({ view: 'slides', slide: { n: 6, of: 5, kind: 'questions' } }).slide).toBeUndefined();
    expect(sanitizeJourneyNow({ view: 'slides', slide: { n: 1, of: 5, kind: 'poster' } }).slide).toBeUndefined();
    expect(sanitizeJourneyNow({ view: 'idle', wait: 'coffee' }).wait).toBeNull();
    expect(sanitizeJourneyNow({ view: 'idle', last: { action: 'slide-next', ok: false, reason: 'gremlins', id: 'has space' } }).last)
      .toEqual({ id: null, action: 'slide-next', ok: false, reason: 'unknown' });
    expect(sanitizeJourneyNow({ view: 'idle', last: { action: 'reboot', ok: true } }).last).toBeNull();
  });
});
