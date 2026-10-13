#!/usr/bin/env node
// Builds public/slide-answers.json, the sample answers for each week's "Talk
// About It" questions that the phone remote (public/remote/) shows on the
// LEADER'S PHONE ONLY (owner 2026-10-13; never on the room screen, never on
// the public home page; journey/docs/DECISIONS.md).
//
// Input: data/slide-answers/week-NN.json, one per week 1-32, hand-written from
// that week's own leader lesson content:
//   { "week": N, "questions": [ { "q", "answer", "scripture", "at" } x 3 ] }
//     q          EXACTLY public/teaching-slides.json weeks[N].notes.questions[i]
//                (same order; the phone matches the slide on the wall by this text)
//     answer     one line, 1-220 characters
//     scripture  null, or one line of at most 80 characters ("Romans 12:2")
//     at         null, or whole seconds >= 0 into the week's video
// Output: { "version": 1, "weeks": { "N": [ {q, answer, scripture, at} x 3 ] } },
// weeks in order, two-space JSON, so a rebuild of the same input is the same
// bytes.
//
// It REFUSES to write anything while any week 1-32 is missing or wrong, so a
// half set is never published. Exit codes: 0 built (or, with --check, up to
// date / nothing to publish yet); 1 refused (each problem printed); 2 --check
// found the built file stale or missing.
//
//   node scripts/build-slide-answers.mjs            build
//   node scripts/build-slide-answers.mjs --check    is the committed file what the data builds?
//   (--data DIR, --slides FILE, --out FILE for tests)
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULTS = {
  dataDir: path.join(ROOT, 'data', 'slide-answers'),
  slidesFile: path.join(ROOT, 'public', 'teaching-slides.json'),
  outFile: path.join(ROOT, 'public', 'slide-answers.json'),
};
export const WEEKS = 32;
export const ANSWER_MAX = 220;
export const SCRIPTURE_MAX = 80;
export const AT_MAX = 4 * 60 * 60;
const ITEM_KEYS = ['q', 'answer', 'scripture', 'at'];
const FILE_RE = /^week-(\d{2})\.json$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

const pad = (n) => String(n).padStart(2, '0');
const chars = (s) => [...s].length;
const sameKeys = (obj, keys) => Object.keys(obj).length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(obj, k));
const isPlain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/* One week's file, checked against that week's questions. Problems as lines. */
export function checkWeek(raw, week, questions) {
  const where = `week-${pad(week)}.json`;
  const problems = [];
  if (!isPlain(raw) || !sameKeys(raw, ['week', 'questions'])) return [`${where}: must be exactly {"week", "questions"}`];
  if (raw.week !== week) problems.push(`${where}: "week" is ${JSON.stringify(raw.week)}, not ${week}`);
  if (!Array.isArray(questions) || questions.length !== 3) return [...problems, `${where}: teaching-slides.json has no 3 Talk About It questions for week ${week}`];
  if (!Array.isArray(raw.questions) || raw.questions.length !== 3) return [...problems, `${where}: needs exactly 3 questions`];
  raw.questions.forEach((item, i) => {
    const at = `${where} question ${i + 1}`;
    if (!isPlain(item) || !sameKeys(item, ITEM_KEYS)) { problems.push(`${at}: must be exactly {"q", "answer", "scripture", "at"}`); return; }
    if (item.q !== questions[i]) problems.push(`${at}: "q" must be the slide's question word for word: ${JSON.stringify(questions[i])}`);
    if (typeof item.answer !== 'string' || !item.answer.trim() || chars(item.answer) > ANSWER_MAX || CONTROL_RE.test(item.answer) || item.answer !== item.answer.trim()) {
      problems.push(`${at}: "answer" must be one line of 1 to ${ANSWER_MAX} characters, no spaces at either end`);
    }
    if (!(item.scripture === null || (typeof item.scripture === 'string' && item.scripture.trim() === item.scripture && item.scripture && chars(item.scripture) <= SCRIPTURE_MAX && !CONTROL_RE.test(item.scripture)))) {
      problems.push(`${at}: "scripture" must be null or one line of at most ${SCRIPTURE_MAX} characters`);
    }
    if (!(item.at === null || (Number.isInteger(item.at) && item.at >= 0 && item.at <= AT_MAX))) {
      problems.push(`${at}: "at" must be null or whole seconds from 0`);
    }
  });
  return problems;
}

/* Build from the data: { ok: true, text } or { ok: false, problems, missing }. Pure apart from reading. */
export function buildSlideAnswers({ dataDir = DEFAULTS.dataDir, slidesFile = DEFAULTS.slidesFile } = {}) {
  const problems = [];
  const missing = [];
  let slides;
  try {
    slides = JSON.parse(readFileSync(slidesFile, 'utf8'));
  } catch (err) {
    return { ok: false, problems: [`cannot read ${path.basename(slidesFile)}: ${err.message}`], missing };
  }
  const names = existsSync(dataDir) ? readdirSync(dataDir).filter((f) => f.endsWith('.json')).sort() : [];
  for (const name of names) {
    const m = FILE_RE.exec(name);
    const n = m ? Number(m[1]) : 0;
    if (!m || n < 1 || n > WEEKS) problems.push(`${name}: not a week-01.json … week-${pad(WEEKS)}.json file`);
  }
  const weeks = {};
  for (let week = 1; week <= WEEKS; week += 1) {
    const file = path.join(dataDir, `week-${pad(week)}.json`);
    if (!existsSync(file)) { missing.push(week); continue; }
    let raw;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      problems.push(`week-${pad(week)}.json: not JSON (${err.message})`);
      continue;
    }
    const questions = slides && slides.weeks && slides.weeks[String(week)] && slides.weeks[String(week)].notes
      ? slides.weeks[String(week)].notes.questions : null;
    const found = checkWeek(raw, week, questions);
    if (found.length) { problems.push(...found); continue; }
    weeks[String(week)] = raw.questions.map((q) => ({ q: q.q, answer: q.answer, scripture: q.scripture, at: q.at }));
  }
  if (missing.length) problems.push(`missing week${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`);
  if (problems.length) return { ok: false, problems, missing };
  return { ok: true, text: `${JSON.stringify({ version: 1, weeks }, null, 2)}\n` };
}

/* The CLI's decision, separated for the tests: { code, lines, write? }. */
export function run(args, paths = DEFAULTS) {
  const check = args.includes('--check');
  const opt = (flag, fallback) => { const i = args.indexOf(flag); return i >= 0 && args[i + 1] ? path.resolve(args[i + 1]) : fallback; };
  const dataDir = opt('--data', paths.dataDir);
  const slidesFile = opt('--slides', paths.slidesFile);
  const outFile = opt('--out', paths.outFile);
  const built = buildSlideAnswers({ dataDir, slidesFile });
  const have = existsSync(outFile) ? readFileSync(outFile, 'utf8') : null;
  const rel = path.basename(outFile);
  if (!built.ok) {
    const onlyMissing = built.problems.length === 1 && built.missing.length > 0;
    if (check && have === null && onlyMissing) {
      return { code: 0, lines: [`slide answers: not complete yet (${WEEKS - built.missing.length} of ${WEEKS} weeks), so nothing is published.`] };
    }
    return { code: 1, lines: ['slide answers: NOT built (a half or wrong set is never published):', ...built.problems.map((p) => `  - ${p}`)] };
  }
  if (check) {
    if (have === built.text) return { code: 0, lines: [`slide answers: ${rel} is up to date.`] };
    return { code: 2, lines: [`slide answers: ${rel} is ${have === null ? 'missing' : 'stale'}: run node scripts/build-slide-answers.mjs in journey/`] };
  }
  return { code: 0, lines: [`slide answers: wrote ${rel} (${WEEKS} weeks).`], write: { file: outFile, text: built.text } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = run(process.argv.slice(2));
  if (result.write) writeFileSync(result.write.file, result.write.text);
  for (const line of result.lines) (result.code ? console.error : console.log)(line);
  process.exit(result.code);
}
