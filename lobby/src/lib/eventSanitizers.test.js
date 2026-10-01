import { describe, expect, it } from 'vitest';
import vectors from './__fixtures__/contract-vectors.json';
import {
  sanitizeBirthdays,
  sanitizeCanary,
  sanitizeCheckin,
  sanitizeCheckout,
  sanitizeNotice,
  sanitizeOps,
  sanitizePoints,
  sanitizeRecap,
  sanitizeSchedule,
  sanitizeSettings,
  sanitizeSlidesChunk,
  sanitizeTally,
  sanitizeTonight,
} from './eventSanitizers.js';

// Data-driven over the mirrored contract vectors: every valid vector
// must survive its sanitizer with ONLY allowlisted keys; every dirty
// vector's PII must vanish; every reject vector must return null.
const SANITIZERS = {
  checkin: sanitizeCheckin,
  recap: sanitizeRecap,
  checkout: sanitizeCheckout,
  tally: sanitizeTally,
  birthdays: sanitizeBirthdays,
  ops: sanitizeOps,
  canary: sanitizeCanary,
  tonight: sanitizeTonight,
  points: sanitizePoints,
  schedule: sanitizeSchedule,
  notice: sanitizeNotice,
  slides: sanitizeSlidesChunk,
  settings: sanitizeSettings,
};

// The exact key set each sanitizer may emit (checkin `at` becomes epoch
// ms locally, so values differ from the wire shape but keys must not).
const ALLOWED_KEYS = {
  checkin: ['id', 'at', 'firstName', 'club', 'isBirthday', 'isFirstTimer', 'welcomeBack', 'milestone'],
  recap: ['entries', 'at'],
  checkout: ['entries', 'at', 'printed'],
  tally: ['counts', 'total', 'at', 'season', 'rehearsal'],
  birthdays: ['entries'],
  ops: ['type', 'club', 'at', 'version'],
  canary: ['at', 'nonce'],
  tonight: ['checkedIn', 'booksCompleted', 'awardsEarned', 'friendsBrought', 'at'],
  points: ['groups', 'at', 'club'],
  schedule: ['at', 'nextMeetingDate', 'title', 'noClubThisWeek'],
  notice: ['level', 'message', 'at'],
  slides: ['deckRev', 'publishedAt', 'seq', 'total', 'slides'],
  settings: ['rev', 'publishedAt', 'settings'],
};

// Straight from the contract, so a new optional field (holdCheckIns, stage 4)
// is allowed here exactly when the canonical copy allows it.
const SLIDE_ENTRY_KEYS = [...vectors.events.slides.entryFields, ...vectors.events.slides.entryOptionalFields];

describe('contract vectors are the v6 contract', () => {
  it('is contract version 6 on awana-channel', () => {
    expect(vectors.contractVersion).toBe(6);
    expect(vectors.channel).toBe('awana-channel');
  });

  it('covers every sanitizer we ship (and vice versa)', () => {
    expect(Object.keys(vectors.events).sort()).toEqual(Object.keys(SANITIZERS).sort());
  });
});

for (const [event, spec] of Object.entries(vectors.events)) {
  const sanitize = SANITIZERS[event];
  const allowed = ALLOWED_KEYS[event];

  describe(`sanitize ${event}`, () => {
    for (const [i, valid] of (spec.valid || []).entries()) {
      it(`accepts valid[${i}] with only allowlisted keys`, () => {
        const out = sanitize(valid);
        expect(out).not.toBeNull();
        for (const key of Object.keys(out)) {
          expect(allowed).toContain(key);
        }
        // Entries inside container events get the same key discipline.
        if (Array.isArray(out.entries)) {
          const entryAllowed = event === 'recap'
            ? ALLOWED_KEYS.checkin
            : ['firstName', 'club', 'month', 'day'];
          for (const e of out.entries) {
            for (const key of Object.keys(e)) expect(entryAllowed).toContain(key);
          }
        }
        if (event === 'slides') {
          for (const e of out.slides) {
            for (const key of Object.keys(e)) expect(SLIDE_ENTRY_KEYS).toContain(key);
          }
        }
      });
    }

    for (const [i, dirty] of (spec.dirty || []).entries()) {
      it(`scrubs dirty[${i}]: ${dirty.reason}`, () => {
        const out = sanitize(dirty.payload);
        const raw = JSON.stringify(out ?? null);
        for (const banned of dirty.mustNotContain || []) {
          expect(raw).not.toContain(banned);
        }
        if (dirty.expectEntryCount !== undefined) {
          expect((out?.entries ?? out?.slides)?.length ?? 0).toBe(dirty.expectEntryCount);
        }
      });
    }

    for (const [i, rej] of (spec.reject || []).entries()) {
      it(`rejects reject[${i}]: ${rej.reason}`, () => {
        expect(sanitize(rej.payload)).toBeNull();
      });
    }

    it('never throws on hostile input', () => {
      const hostile = [null, undefined, 0, '', 'x', [], [1], { entries: 0 }, { counts: [] }, () => {}, Symbol('x')];
      for (const h of hostile) {
        expect(() => sanitize(h)).not.toThrow();
      }
    });
  });
}

describe('checkin v2 specifics', () => {
  it('keeps id/at optional (v1 producers still work)', () => {
    const out = sanitizeCheckin({ firstName: 'Alice', club: 'Sparks', isBirthday: false, isFirstTimer: false });
    expect(out).toEqual({ firstName: 'Alice', club: 'Sparks', isBirthday: false, isFirstTimer: false });
  });

  it('converts at to epoch ms and caps id length', () => {
    const out = sanitizeCheckin({ firstName: 'Alice', at: '2026-09-16T22:05:11.000Z', id: 'x'.repeat(100) });
    expect(out.at).toBe(Date.parse('2026-09-16T22:05:11.000Z'));
    expect(out.id).toHaveLength(64);
  });
});

describe('recap specifics', () => {
  it('caps at 30 entries', () => {
    const entry = { id: 'a', at: '2026-09-16T22:05:11.000Z', firstName: 'Kid', club: 'Sparks' };
    const out = sanitizeRecap({ entries: Array.from({ length: 60 }, () => entry), at: '2026-09-16T22:07:00.000Z' });
    expect(out.entries).toHaveLength(30);
  });
});

describe('tally specifics', () => {
  it('caps clubs at 30 and floors floats', () => {
    const counts = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`Club${i}`, 1.9]));
    const out = sanitizeTally({ counts, total: 50, at: '2026-09-16T22:07:00.000Z' });
    expect(Object.keys(out.counts)).toHaveLength(30);
    expect(out.counts.Club0).toBe(1);
  });

  it('derives total when the payload omits it', () => {
    const out = sanitizeTally({ counts: { Sparks: 2, Trek: 3 }, at: '2026-09-16T22:07:00.000Z' });
    expect(out.total).toBe(5);
  });
});

describe('slides chunk specifics (contract v5)', () => {
  const base = {
    deckRev: 2,
    publishedAt: '2026-09-16T22:12:00.000Z',
    seq: 0,
    total: 1,
    slides: [{ eyebrow: '', text: 'Hello', theme: 'sky', textSize: 'auto', durationSec: 0 }],
  };

  it('normalizes publishedAt to epoch ms — the ordering authority must be comparable', () => {
    const out = sanitizeSlidesChunk(base);
    expect(out.publishedAt).toBe(Date.parse('2026-09-16T22:12:00.000Z'));
  });

  it('accepts an epoch-ms publishedAt too (producer freedom, one consumer shape)', () => {
    const out = sanitizeSlidesChunk({ ...base, publishedAt: 1789600000000 });
    expect(out.publishedAt).toBe(1789600000000);
  });

  it('drops a video slide however it is spelled, without rejecting the chunk', () => {
    const out = sanitizeSlidesChunk({
      ...base,
      slides: [{ type: 'video', videoId: 'v_x' }, { type: 'hologram', text: 'future' }, { text: 'Kept' }],
    });
    expect(out.slides).toHaveLength(1);
    expect(out.slides[0].text).toBe('Kept');
  });

  it('keeps multi-line slide text', () => {
    const out = sanitizeSlidesChunk({ ...base, slides: [{ text: 'Welcome to\nAwana!' }] });
    expect(out.slides[0].text).toBe('Welcome to\nAwana!');
  });

  // The optional show window (#345). Text only, still: the two new fields are
  // bare dates, and a typed entry is dropped whatever it carries.
  it('keeps a valid show window verbatim', () => {
    const out = sanitizeSlidesChunk({
      ...base,
      slides: [{ text: 'Store night', showFrom: '2026-09-09', showUntil: '2026-09-16' }],
    });
    expect(out.slides[0]).toMatchObject({ showFrom: '2026-09-09', showUntil: '2026-09-16' });
  });

  it('drops a window that is not a real calendar date, keeping the slide', () => {
    const out = sanitizeSlidesChunk({
      ...base,
      slides: [{ text: 'Kept', showFrom: '2026-02-30', showUntil: 'next Wednesday' }],
    });
    expect(out.slides).toHaveLength(1);
    expect('showFrom' in out.slides[0]).toBe(false);
    expect('showUntil' in out.slides[0]).toBe(false);
    expect(JSON.stringify(out)).not.toContain('Wednesday');
  });

  it('a dated VIDEO entry is still dropped — dates do not buy a type a ride', () => {
    const out = sanitizeSlidesChunk({
      ...base,
      slides: [
        { type: 'video', videoId: 'v_x', showFrom: '2026-09-09', showUntil: '2026-09-16' },
        { type: 'hologram', text: 'future', showUntil: '2026-09-16' },
        { text: 'Kept' },
      ],
    });
    expect(out.slides).toHaveLength(1);
    expect(out.slides[0].text).toBe('Kept');
    expect(JSON.stringify(out)).not.toContain('v_x');
  });

  it('a PROMO entry is dropped: the season promos are local art, never wire data', () => {
    // src/lib/promos.js builds the promo slot on the device from the calendar
    // feed. Nothing publishes one, so a `type: 'promo'` on the wire is either a
    // mistake or someone probing for a typed entry the allowlist will render.
    const out = sanitizeSlidesChunk({
      ...base,
      slides: [
        { type: 'promo', promos: [{ kind: 'contest', countdown: 'Tonight!' }], text: 'Poster contest' },
        { text: 'Kept' },
      ],
    });
    expect(out.slides).toHaveLength(1);
    expect(out.slides[0].text).toBe('Kept');
    expect(JSON.stringify(out)).not.toContain('promo');
    expect(JSON.stringify(out)).not.toContain('Poster contest');
  });

  it('a chunk with no dates has exactly the pre-#345 entry shape', () => {
    const out = sanitizeSlidesChunk(base);
    expect(Object.keys(out.slides[0]).sort()).toEqual(['durationSec', 'eyebrow', 'text', 'textSize', 'theme']);
  });

  it('clamps durations and falls back on junk theme/size', () => {
    const out = sanitizeSlidesChunk({
      ...base,
      slides: [{ text: 'x', theme: 'hotdog-stand', textSize: 'banner', durationSec: 99999 }],
    });
    expect(out.slides[0]).toMatchObject({ theme: 'auto', textSize: 'auto', durationSec: 600 });
  });

  it('refuses deckRev below 1 and junk deckRev', () => {
    expect(sanitizeSlidesChunk({ ...base, deckRev: 0 })).toBeNull();
    expect(sanitizeSlidesChunk({ ...base, deckRev: 'seven' })).toBeNull();
  });

  it('refuses fractional seq/total (int discipline, not coercion)', () => {
    expect(sanitizeSlidesChunk({ ...base, seq: 0.5, total: 2 })).toBeNull();
    expect(sanitizeSlidesChunk({ ...base, total: 1.5 })).toBeNull();
  });
});

// Sealed celebration flags (#9/#10): the fixture proves the keys are ALLOWED;
// these prove the values actually SURVIVE both directions of the contract.
import { sanitizeCheckin as sc } from './eventSanitizers.js';

describe('checkin celebration flags (#9/#10)', () => {
  const base = { firstName: 'Noah', club: 'T&T', isBirthday: false, isFirstTimer: false };

  it('passes welcomeBack and milestone through intact', () => {
    const out = sc({ ...base, welcomeBack: true, milestone: 25 });
    expect(out.welcomeBack).toBe(true);
    expect(out.milestone).toBe(25);
  });

  it('drops junk without rejecting the checkin', () => {
    const out = sc({ ...base, welcomeBack: 'yes', milestone: 'Alice Smith' });
    expect(out).not.toBeNull();
    expect(out.welcomeBack).toBeUndefined();
    expect(out.milestone).toBeUndefined();
  });

  it('drops out-of-range milestones', () => {
    expect(sc({ ...base, milestone: 0 }).milestone).toBeUndefined();
    expect(sc({ ...base, milestone: 2.5 }).milestone).toBeUndefined();
    expect(sc({ ...base, milestone: 1000 }).milestone).toBeUndefined();
  });

  it('a plain checkin stays flag-free (legacy shape)', () => {
    const out = sc(base);
    expect('welcomeBack' in out).toBe(false);
    expect('milestone' in out).toBe(false);
  });
});

describe('slides: holdCheckIns (stage 4)', () => {
  it('carries a literal true through, and the valid vector that marks one', () => {
    const marked = vectors.events.slides.valid.find((v) => v.slides.some((e) => e.holdCheckIns === true));
    expect(marked).toBeTruthy();
    const out = SANITIZERS.slides(marked);
    expect(out.slides.filter((e) => e.holdCheckIns === true)).toHaveLength(1);
    expect(out.slides.some((e) => 'holdCheckIns' in e && e.holdCheckIns !== true)).toBe(false);
  });

  it('drops every other value instead of coercing it', () => {
    const chunk = {
      deckRev: 1, publishedAt: '2026-09-28T12:00:00.000Z', seq: 0, total: 1,
      slides: [false, 'true', 1, null, {}].map((v, i) => ({ text: `Slide ${i}`, holdCheckIns: v })),
    };
    const out = SANITIZERS.slides(chunk);
    expect(out.slides).toHaveLength(5);
    for (const e of out.slides) expect('holdCheckIns' in e).toBe(false);
  });
});
