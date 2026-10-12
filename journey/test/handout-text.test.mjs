// Page-1 text of the Leader Handouts: the limits the layout is built for,
// the validator that drafted weeks must pass (scripts/apply-handout-text.mjs),
// and the layout's own proof that a week at every limit still fits one page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { validateWeek } from '../scripts/apply-handout-text.mjs';
import { LIMITS } from '../scripts/handout-limits.mjs';

const REPO = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const DATA = JSON.parse(readFileSync(path.join(REPO, 'data', 'leader-handout-summaries.json'), 'utf8'));
const fileFor = (week) => `week-${String(week).padStart(2, '0')}.json`;
const check = (d) => validateWeek(d, { file: fileFor(d.week), existing: DATA.weeks });
const clone = (week) => structuredClone(DATA.weeks[String(week)]);

test('the summaries file is v2 and every week has both question sets', () => {
  assert.equal(DATA.version, 2);
  for (const [key, d] of Object.entries(DATA.weeks)) {
    assert.ok(Array.isArray(d.questions.forYou) && d.questions.forYou.length, `week ${key} forYou`);
    assert.ok(Array.isArray(d.questions.forGroup), `week ${key} forGroup`);
  }
  assert.equal(DATA.weeks['27'], undefined, 'week 27 has no Leader Video, so no summary');
});

test('every week in the data passes the same checks drafted text must', () => {
  for (const [key, d] of Object.entries(DATA.weeks)) {
    const { errors } = check(d);
    assert.deepEqual(errors, [], `week ${key}`);
  }
});

test('the validator refuses what page 1 cannot hold or the video never said', () => {
  const tooLong = clone(7);
  tooLong.bigIdea = 'x'.repeat(LIMITS.bigIdea.max + 1);
  assert.match(check(tooLong).errors.join('\n'), /bigIdea is \d+ chars/);

  const tooMany = clone(7);
  tooMany.questions.forGroup = Array.from({ length: LIMITS.forGroup.maxItems + 1 }, (_, i) => `Question ${i}?`);
  assert.match(check(tooMany).errors.join('\n'), /forGroup has \d+ items/);

  const invented = clone(7);
  invented.scriptures = ['Romans 8:28'];
  assert.match(check(invented).errors.join('\n'), /Romans is never named in week 7/);

  const inText = clone(7);
  inText.keyPoints[0] += ' Habakkuk agrees.';
  assert.match(check(inText).errors.join('\n'), /names "Habakkuk"/);

  const badRef = clone(20);
  badRef.scriptures = ['Acts four'];
  assert.match(check(badRef).errors.join('\n'), /is not "Book"/);

  const v1 = clone(7);
  v1.questions = ['A plain list'];
  assert.match(check(v1).errors.join('\n'), /questions must be/);

  const renamed = clone(19);
  renamed.title = 'Unit 5, Lesson 3: Diety';
  assert.match(check(renamed).errors.join('\n'), /title .* differs/);

  const extra = { ...clone(7), notes: 'x' };
  assert.match(check(extra).errors.join('\n'), /unexpected keys: notes/);
});

test('Scripture may be a book, a chapter, a chapter range or verses, if the video names the book', () => {
  // Week 20's Leader Video says "Acts 4:20".
  for (const ref of ['Acts', 'Acts 4', 'Acts 4-5', 'Acts 4:20', 'Acts 4:19-20']) {
    const d = clone(20);
    d.scriptures = [ref];
    assert.deepEqual(check(d).errors, [], ref);
  }
  const d = clone(20);
  d.scriptures = ['Acts 9'];
  assert.match(check(d).warnings.join('\n'), /never says Acts 9/);
});

const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';
test('page 1 holds a week at every limit (render --fit-check)', { skip: !existsSync(CHROMIUM) && `no Chromium at ${CHROMIUM}` }, () => {
  const out = execFileSync(process.execPath, [path.join(REPO, 'scripts', 'render-leader-handouts.mjs'), '--fit-check'], {
    encoding: 'utf8',
    env: { ...process.env, HANDOUT_SCREENSHOTS: '' },
  });
  assert.match(out, /both question sets\): fits/);
  assert.match(out, /no "Ask your group"\): fits/);
});
