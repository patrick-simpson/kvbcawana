// The phone remote's words and choices (public/remote/logic.js), pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  answersFor, beginWords, cleanAnswersFile, describeNow, formatTime, lastWords, needsConfirm, pickKiosk, videoPosition, REASON_WORDS, CHOICES,
} from '../public/remote/logic.js';
import { JOURNEY_PICKER_CHOICES, JOURNEY_REMOTE_REASONS } from '../../lobby/shared/journeyRemote.js';

const slides = (n, of, kind = 'title', lines = []) => ({ view: 'slides', week: 5, title: 'Unit 2, Lesson 1: Worldview', preview: false, wait: null, slide: { n, of, kind, heading: null, lines }, last: null, at: null });

test('which screen the readout follows', () => {
  const off = { id: 'a', name: 'A', online: false, now: slides(1, 5) };
  const idle = { id: 'b', name: 'B', online: true, now: { view: 'checkin' } };
  const lesson = { id: 'c', name: 'C', online: true, now: slides(2, 5) };
  assert.equal(pickKiosk([off, idle, lesson]).id, 'c', 'the first online one showing a lesson');
  assert.equal(pickKiosk([off, idle]).id, 'b', 'else the first online');
  assert.equal(pickKiosk([off]).id, 'a', 'else the first');
  assert.equal(pickKiosk([]), null);
});

test('the readout in plain words', () => {
  const k = (now, online = true) => ({ id: 'x', name: 'Journey kiosk', online, now });
  assert.equal(describeNow(k(slides(3, 5, 'misconception'))).main, 'Slides 3 of 5');
  assert.equal(describeNow(k(slides(3, 5, 'misconception'))).sub, 'Week 5 · Unit 2, Lesson 1: Worldview');
  assert.equal(describeNow(k(slides(3, 5, 'misconception'))).detail, 'Misconception');
  const at = '2026-10-13T23:00:00.000Z';
  const video = { view: 'video', week: 5, title: 'T', video: { t: 765, d: 902, paused: false, muted: true }, at };
  const d = describeNow(k(video), { serverNowMs: Date.parse(at) + 5000 });
  assert.equal(d.main, 'Video 12:50 / 15:02', 'a playing video runs on from its report');
  assert.equal(d.detail, 'Playing · muted');
  assert.equal(describeNow(k({ ...video, video: { ...video.video, paused: true } }), { serverNowMs: Date.parse(at) + 5000 }).main, 'Video 12:45 / 15:02');
  assert.equal(describeNow(k({ view: 'checkin', week: 5, title: 'T' })).main, 'Check-in display');
  assert.equal(describeNow(k({ view: 'trek' })).main, 'Trek card');
  assert.equal(describeNow(k({ view: 'splash', week: 5, title: 'T', resume: 252 })).detail, 'It can resume at 4:12.');
  assert.equal(describeNow(k(null)).main, 'Asking the screen…');
  assert.equal(describeNow(k(null, false)).main, 'Screen offline');
  assert.equal(describeNow(null).main, 'No Journey screen yet');
  assert.equal(beginWords({ view: 'splash', resume: 252 }), 'Resume at 4:12');
  assert.equal(beginWords({ view: 'checkin' }), 'Begin lesson');
});

test('a report is never run on for long, nor past the end', () => {
  const at = '2026-10-13T23:00:00.000Z';
  const now = { video: { t: 890, d: 902, paused: false }, at };
  assert.equal(videoPosition(now, Date.parse(at) + 60000), 902);
  assert.equal(videoPosition({ video: { t: 10, d: 902, paused: false }, at }, Date.parse(at) + 600000), 40);
  assert.equal(formatTime(3725), '1:02:05');
});

test('every skip reason the kiosk can give has words', () => {
  for (const r of JOURNEY_REMOTE_REASONS) assert.equal(typeof REASON_WORDS[r], 'string', r);
  assert.equal(lastWords({ last: { action: 'slide-next', ok: true } }), 'Next: done ✓');
  assert.equal(lastWords({ last: { action: 'unmute', ok: false, reason: 'sound-blocked' } }), `Unmute skipped: ${REASON_WORDS['sound-blocked']}`);
  assert.deepEqual(CHOICES.map((c) => c.choice).sort(), [...JOURNEY_PICKER_CHOICES].sort());
});

test('a pick asks first only over a running lesson (a screen waiting for a person skips it anyway)', () => {
  assert.equal(needsConfirm({ view: 'video' }), true);
  assert.equal(needsConfirm({ view: 'slides' }), true);
  assert.equal(needsConfirm({ view: 'intro' }), true);
  assert.equal(needsConfirm({ view: 'checkin', wait: 'reader' }), false, 'the kiosk skips it as reader-open, confirmed or not');
  assert.equal(needsConfirm({ view: 'splash' }), false);
  assert.equal(needsConfirm({ view: 'checkin' }), false);
  assert.equal(needsConfirm(null), false);
});

test('sample answers match the wall by exact text; an edit hides them; no file, no section', () => {
  const file = cleanAnswersFile({
    version: 1,
    weeks: { 5: [{ q: 'One?', answer: 'A', scripture: 'John 1:1', at: 60 }, { q: 'Two?', answer: 'B', scripture: null, at: null }, { q: 'Three?', answer: 'C', scripture: null, at: 5 }] },
  });
  const q = (lines) => slides(5, 7, 'questions', lines);
  assert.deepEqual(answersFor(file, q(['Three?', 'One?'])).items.map((a) => a.answer), ['C', 'A'], 'in the wall\'s order');
  assert.deepEqual(answersFor(file, q(['One?', 'Two (edited)?', 'Three?'])), { edited: true });
  assert.deepEqual(answersFor(file, q(['one?'])), { edited: true }, 'exact text, case included');
  assert.equal(answersFor(null, q(['One?'])), null);
  assert.equal(answersFor(file, slides(3, 7, 'misconception')), null);
  assert.equal(answersFor(file, { ...q(['One?']), week: 6 }), null);
  assert.equal(cleanAnswersFile({ version: 2, weeks: {} }), null);
  assert.deepEqual(cleanAnswersFile({ version: 1, weeks: { 5: [{ q: 'x', answer: 1 }], abc: [] } }).weeks, {});
});
