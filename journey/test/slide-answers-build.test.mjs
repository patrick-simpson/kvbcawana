// scripts/build-slide-answers.mjs: the phone remote's sample answers
// (public/slide-answers.json) built from data/slide-answers/week-NN.json,
// strictly, and never a half set. Fixtures are invented here, in a scratch
// folder, from the real teaching-slides.json questions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSlideAnswers, checkWeek, run, DEFAULTS, WEEKS } from '../scripts/build-slide-answers.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SCRIPT = path.join(REPO, 'scripts', 'build-slide-answers.mjs');
const SLIDES_FILE = path.join(REPO, 'public', 'teaching-slides.json');
const SLIDES = JSON.parse(readFileSync(SLIDES_FILE, 'utf8'));
const pad = (n) => String(n).padStart(2, '0');

function weekFixture(week) {
  return {
    week,
    questions: SLIDES.weeks[String(week)].notes.questions.map((q, i) => ({
      q,
      answer: `A sample answer for week ${week}, question ${i + 1}.`,
      scripture: i === 0 ? 'John 14:6' : null,
      at: i === 2 ? null : 60 * week + i,
    })),
  };
}

/* A scratch data folder with every week (or `skip` left out), edited by `edit`. */
function scratch({ skip = [], edit = {} } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'slide-answers-'));
  const data = path.join(dir, 'data');
  mkdirSync(data);
  for (let w = 1; w <= WEEKS; w += 1) {
    if (skip.includes(w)) continue;
    const body = edit[w] ? edit[w](weekFixture(w)) : weekFixture(w);
    writeFileSync(path.join(data, `week-${pad(w)}.json`), typeof body === 'string' ? body : JSON.stringify(body, null, 2));
  }
  return { dir, data, out: path.join(dir, 'slide-answers.json'), done: () => rmSync(dir, { recursive: true, force: true }) };
}

const cli = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

test('a complete set builds one stable file, weeks in order, in the phone\'s shape', () => {
  const s = scratch();
  try {
    const a = buildSlideAnswers({ dataDir: s.data, slidesFile: SLIDES_FILE });
    const b = buildSlideAnswers({ dataDir: s.data, slidesFile: SLIDES_FILE });
    assert.equal(a.ok, true);
    assert.equal(a.text, b.text, 'the same input, the same bytes');
    const out = JSON.parse(a.text);
    assert.equal(out.version, 1);
    assert.deepEqual(Object.keys(out.weeks), Array.from({ length: WEEKS }, (_, i) => String(i + 1)));
    assert.deepEqual(out.weeks['5'], weekFixture(5).questions);
    assert.ok(a.text.endsWith('}\n'));
  } finally {
    s.done();
  }
});

test('refuses a half set: any missing week means nothing is written', () => {
  const s = scratch({ skip: [7, 32] });
  try {
    const r = cli(['--data', s.data, '--out', s.out]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /missing weeks: 7, 32/);
    assert.equal(existsSync(s.out), false, 'nothing published');
  } finally {
    s.done();
  }
});

test('every rule is checked, and each problem is named', () => {
  const qs = SLIDES.weeks['3'].notes.questions;
  const cases = [
    [(w) => ({ ...w, questions: w.questions.slice(0, 2) }), /needs exactly 3 questions/],
    [(w) => ({ ...w, questions: [...w.questions, w.questions[0]] }), /needs exactly 3 questions/],
    [(w) => { w.questions[1].q = `${qs[1]} `; return w; }, /word for word/],
    [(w) => { [w.questions[0], w.questions[1]] = [w.questions[1], w.questions[0]]; return w; }, /question 1: "q" must be/],
    [(w) => { w.questions[0].answer = ''; return w; }, /"answer" must be one line of 1 to 220/],
    [(w) => { w.questions[0].answer = 'x'.repeat(221); return w; }, /"answer"/],
    [(w) => { w.questions[0].answer = 'two\nlines'; return w; }, /"answer"/],
    [(w) => { w.questions[0].scripture = 3; return w; }, /"scripture" must be null/],
    [(w) => { w.questions[0].scripture = ''; return w; }, /"scripture"/],
    [(w) => { w.questions[0].at = -1; return w; }, /"at" must be null or whole seconds/],
    [(w) => { w.questions[0].at = 1.5; return w; }, /"at"/],
    [(w) => { w.questions[0].note = 'extra'; return w; }, /must be exactly \{"q", "answer", "scripture", "at"\}/],
    [(w) => { delete w.questions[0].at; return w; }, /must be exactly/],
    [(w) => ({ ...w, week: 4 }), /"week" is 4, not 3/],
    [(w) => ({ ...w, extra: true }), /must be exactly \{"week", "questions"\}/],
    [() => '{ not json', /not JSON/],
  ];
  for (const [edit, want] of cases) {
    const s = scratch({ edit: { 3: edit } });
    try {
      const r = buildSlideAnswers({ dataDir: s.data, slidesFile: SLIDES_FILE });
      assert.equal(r.ok, false, String(want));
      assert.match(r.problems.join('\n'), want);
      assert.match(r.problems.join('\n'), /week-03\.json/);
    } finally {
      s.done();
    }
  }
  // A stray file beside the weeks is named too.
  const s = scratch();
  try {
    writeFileSync(path.join(s.data, 'week-33.json'), '{}');
    assert.match(buildSlideAnswers({ dataDir: s.data, slidesFile: SLIDES_FILE }).problems.join('\n'), /week-33\.json: not a week-01/);
  } finally {
    s.done();
  }
  assert.deepEqual(checkWeek(weekFixture(9), 9, SLIDES.weeks['9'].notes.questions), []);
});

test('the command: builds, then --check says up to date; stale or missing exits 2; an incomplete set with nothing published passes', () => {
  const s = scratch();
  try {
    let r = cli(['--check', '--data', s.data, '--out', s.out]);
    assert.equal(r.status, 2, 'complete data, no file: stale');
    assert.match(r.stderr, /missing: run node scripts\/build-slide-answers\.mjs/);
    r = cli(['--data', s.data, '--out', s.out]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /wrote slide-answers\.json \(32 weeks\)/);
    assert.equal(cli(['--check', '--data', s.data, '--out', s.out]).status, 0);
    const edited = weekFixture(12);
    edited.questions[0].answer = 'A better answer.';
    writeFileSync(path.join(s.data, 'week-12.json'), JSON.stringify(edited));
    r = cli(['--check', '--data', s.data, '--out', s.out]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /stale/);
  } finally {
    s.done();
  }
  const half = scratch({ skip: [20] });
  try {
    assert.equal(cli(['--check', '--data', half.data, '--out', half.out]).status, 0, 'not complete yet: nothing to check');
    writeFileSync(half.out, '{"version":1,"weeks":{}}\n');
    assert.equal(cli(['--check', '--data', half.data, '--out', half.out]).status, 1, 'a published file with broken data fails');
  } finally {
    half.done();
  }
});

test('the committed public/slide-answers.json is what the committed data builds (or neither is complete yet)', () => {
  const r = run(['--check'], DEFAULTS);
  assert.equal(r.code, 0, r.lines.join('\n'));
});
