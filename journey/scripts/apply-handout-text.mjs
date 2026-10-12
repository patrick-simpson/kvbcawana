// Validate drafted page-1 text for Leader Handouts and merge it into
// data/leader-handout-summaries.json (v2).
//
// Input: a folder of week-NN.json files, each EXACTLY
//   { week, title, shortTitle, bigIdea, keyPoints: [], scriptures: [],
//     questions: { forYou: [], forGroup: [] } }
// Only the weeks present are merged; every other week is left as it is.
// Nothing is written unless EVERY file passes (one bad week stops the lot).
//
// Checks:
//   SHAPE      exactly those keys; strings trimmed, one line, non-empty;
//              week = the file's number and a week that has a Leader Video
//              (an entry in the summaries file); title and shortTitle
//              unchanged from the summaries file (they come from lessons.json
//              and the data's own spelling; e.g. week 19 is "Deity").
//   LENGTH     scripts/handout-limits.mjs, the limits page 1 is laid out to
//              hold (render-leader-handouts.mjs --fit-check proves it).
//   SCRIPTURE  each entry is "Book", "Book C", "Book C-C", "Book C:V" or
//              "Book C:V-V" with a real book name; the book must be named in
//              that week's Leader Video (its VTT or its edited prose), the
//              same rule scripts/validate-transcript-prose.py applies to the
//              prose. A chapter the transcript never says next to that book
//              is a WARNING (speech recognition mangles numbers: "acts 420").
//              Any book named in the Big Idea, key points or questions must
//              pass the same rule. `--list N` prints what week N's
//              transcript names, to draft from.
//
// Usage: node scripts/apply-handout-text.mjs <dir> [--check]
//          --check validates only, writes nothing
//        node scripts/apply-handout-text.mjs --list <week>
// Then:  node scripts/render-leader-handouts.mjs && python3 scripts/finalize-handout-pdf.py
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { LIMITS } from './handout-limits.mjs';

const REPO = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const SUMMARIES_PATH = path.join(REPO, 'data', 'leader-handout-summaries.json');
const PROSE_PATH = path.join(REPO, 'data', 'leader-transcript-prose.json');
const pad = (w) => String(w).padStart(2, '0');

// The book list of scripts/validate-transcript-prose.py, word for word.
const BOOK_NAMES =
  'Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|Samuel|Kings|Chronicles|' +
  'Ezra|Nehemiah|Esther|Job|Psalms?|Proverbs|Ecclesiastes|Isaiah|Jeremiah|Lamentations|Ezekiel|' +
  'Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|' +
  'Matthew|Mark|Luke|John|Acts|Romans|Corinthians|Galatians|Ephesians|Philippians|Colossians|' +
  'Thessalonians|Timothy|Titus|Philemon|Hebrews|James|Peter|Jude|Revelation';
const BOOKS = new RegExp(`\\b((?:[123]\\s+|First\\s+|Second\\s+|Third\\s+)?(?:${BOOK_NAMES}))\\b`, 'g');
const NUMBERED = new Set(['Samuel', 'Kings', 'Chronicles', 'Corinthians', 'Thessalonians', 'Timothy', 'Peter', 'John']);
const REF = new RegExp(`^(?:([123]) )?(${BOOK_NAMES})(?: (\\d{1,3})(?:-(\\d{1,3})|:(\\d{1,3})(?:-(\\d{1,3}))?)?)?$`);

/** Everything said in week N's Leader Video: VTT cue text + edited prose. */
export function transcriptText(week) {
  const vtt = path.join(REPO, 'public', 'transcripts', `week-${pad(week)}-leader.vtt`);
  const parts = [];
  if (existsSync(vtt)) {
    const lines = readFileSync(vtt, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim() || line.includes('-->') || /^\d+$/.test(line.trim()) || line.startsWith('WEBVTT')) continue;
      parts.push(line.trim());
    }
  }
  if (existsSync(PROSE_PATH)) {
    const prose = JSON.parse(readFileSync(PROSE_PATH, 'utf8')).weeks[String(week)];
    for (const p of prose?.paragraphs || []) parts.push(p.text);
  }
  return parts.join(' ');
}

/** Books named in a transcript (last word, lower case, as the prose validator keys them). */
function booksSaid(text) {
  const said = new Set();
  // Title-cased first, like the validator: recognition writes "acts", "john".
  const titled = text.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  for (const m of titled.matchAll(BOOKS)) said.add(m[1].split(/\s+/).pop().toLowerCase());
  return said;
}

/** Was book `book` (last word) followed closely by chapter `ch` anywhere? */
function chapterSaid(text, book, ch) {
  const re = new RegExp(`\\b${book}\\b[^.?!]{0,40}?\\b(?:chapter\\s+)?${ch}(?:\\b|:|\\d{1,3}\\b)`, 'gi');
  return re.test(text);
}

const isLine = (s) => typeof s === 'string' && s.trim() === s && s.length > 0 && !/[\r\n\t]/.test(s);

export function validateWeek(d, { file, existing }) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  const keys = ['week', 'title', 'shortTitle', 'bigIdea', 'keyPoints', 'scriptures', 'questions'];
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { errors: ['not a JSON object'], warnings };
  const extra = Object.keys(d).filter((k) => !keys.includes(k));
  const missing = keys.filter((k) => !(k in d));
  if (extra.length) err(`unexpected keys: ${extra.join(', ')}`);
  if (missing.length) err(`missing keys: ${missing.join(', ')}`);
  const fileWeek = Number(/week-(\d+)\.json$/.exec(file)?.[1]);
  if (!Number.isInteger(d.week) || d.week !== fileWeek) err(`week ${d.week} does not match file ${path.basename(file)}`);
  const old = existing[String(d.week)];
  if (!old) {
    err(`week ${d.week} has no Leader Video entry to merge into`);
    return { errors, warnings };
  }
  if (d.title !== old.title) err(`title "${d.title}" differs from the data's "${old.title}"`);
  if (d.shortTitle !== old.shortTitle) err(`shortTitle "${d.shortTitle}" differs from the data's "${old.shortTitle}"`);
  if (isLine(d.shortTitle) && d.shortTitle.length > LIMITS.shortTitle.max) err(`shortTitle over ${LIMITS.shortTitle.max} chars`);

  if (!isLine(d.bigIdea)) err('bigIdea must be one trimmed line of text');
  else if (d.bigIdea.length < LIMITS.bigIdea.min || d.bigIdea.length > LIMITS.bigIdea.max) {
    err(`bigIdea is ${d.bigIdea.length} chars (${LIMITS.bigIdea.min}-${LIMITS.bigIdea.max})`);
  }
  const list = (name, value, spec) => {
    if (!Array.isArray(value)) return err(`${name} must be an array`), [];
    if (value.length < spec.minItems || value.length > spec.maxItems) err(`${name} has ${value.length} items (${spec.minItems}-${spec.maxItems})`);
    value.forEach((s, i) => {
      if (!isLine(s)) err(`${name}[${i}] must be one trimmed line of text`);
      else if (s.length > spec.maxEach) err(`${name}[${i}] is ${s.length} chars (max ${spec.maxEach})`);
    });
    const total = value.filter(isLine).reduce((n, s) => n + s.length, 0);
    if (spec.maxTotal && total > spec.maxTotal) err(`${name} totals ${total} chars (max ${spec.maxTotal})`);
    if (new Set(value).size !== value.length) err(`${name} repeats an item`);
    return value.filter(isLine);
  };
  const keyPoints = list('keyPoints', d.keyPoints, LIMITS.keyPoints);
  const scriptures = list('scriptures', d.scriptures, LIMITS.scriptures);
  const q = d.questions;
  let forYou = [];
  let forGroup = [];
  if (!q || typeof q !== 'object' || Array.isArray(q)) err('questions must be { forYou: [...], forGroup: [...] }');
  else {
    const qExtra = Object.keys(q).filter((k) => k !== 'forYou' && k !== 'forGroup');
    if (qExtra.length) err(`questions has unexpected keys: ${qExtra.join(', ')}`);
    forYou = list('questions.forYou', q.forYou, LIMITS.forYou);
    forGroup = list('questions.forGroup', q.forGroup, LIMITS.forGroup);
    if (forGroup.length) {
      const items = forYou.length + forGroup.length;
      const total = [...forYou, ...forGroup].reduce((n, s) => n + s.length, 0);
      const c = LIMITS.questionsCombined;
      if (items > c.maxItems) err(`questions have ${items} items together (max ${c.maxItems} with both sets)`);
      if (total > c.maxTotal) err(`questions total ${total} chars together (max ${c.maxTotal} with both sets)`);
    }
  }

  // SCRIPTURE: only what this week's Leader Video names.
  const said = transcriptText(d.week);
  const books = booksSaid(said);
  for (const ref of scriptures) {
    const m = REF.exec(ref);
    if (!m) {
      err(`scripture "${ref}" is not "Book", "Book C", "Book C-C", "Book C:V" or "Book C:V-V"`);
      continue;
    }
    const [, num, book, ch] = m;
    if (num && !NUMBERED.has(book)) err(`scripture "${ref}": there is no ${num} ${book}`);
    if (!books.has(book.toLowerCase())) {
      err(`scripture "${ref}": ${book} is never named in week ${d.week}'s Leader Video`);
      continue;
    }
    if (ch && !chapterSaid(said, book, ch)) warnings.push(`scripture "${ref}": the transcript never says ${book} ${ch}; check it against the video`);
  }
  for (const text of [d.bigIdea, ...keyPoints, ...forYou, ...forGroup].filter(isLine)) {
    for (const m of text.matchAll(BOOKS)) {
      const book = m[1].split(/\s+/).pop();
      if (!books.has(book.toLowerCase())) err(`text names "${m[1]}", never named in week ${d.week}'s Leader Video`);
    }
  }
  return { errors, warnings };
}

function listWeek(week) {
  const said = transcriptText(week);
  if (!said) return console.log(`week ${week}: no leader transcript`), 1;
  const titled = said.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  const seen = new Map();
  for (const m of titled.matchAll(BOOKS)) {
    const book = m[1].split(/\s+/).pop();
    if (!seen.has(book)) seen.set(book, []);
    const context = said.slice(m.index, m.index + m[0].length + 30).split(/[.?!]/)[0].trim();
    if (seen.get(book).length < 4) seen.get(book).push(context);
  }
  console.log(`week ${week}: books its Leader Video names (with what follows each, up to 4):`);
  for (const [book, ctx] of seen) console.log(`  ${book}\n    ${ctx.map((c) => JSON.stringify(c)).join('\n    ')}`);
  if (!seen.size) console.log('  (none: this week cites no Scripture)');
  return 0;
}

function main(argv) {
  if (argv[0] === '--list') return listWeek(Number(argv[1]));
  const dir = argv.find((a) => !a.startsWith('--'));
  const checkOnly = argv.includes('--check');
  if (!dir) {
    console.error('usage: node scripts/apply-handout-text.mjs <dir> [--check] | --list <week>');
    return 2;
  }
  const data = JSON.parse(readFileSync(SUMMARIES_PATH, 'utf8'));
  if (data.version !== 2) throw new Error(`summaries file is version ${data.version}, expected 2`);
  const files = readdirSync(dir).filter((f) => /^week-\d+\.json$/.test(f)).sort();
  if (!files.length) {
    console.error(`${dir}: no week-NN.json files`);
    return 1;
  }
  let bad = 0;
  const ready = [];
  for (const f of files) {
    const file = path.join(dir, f);
    let d;
    try {
      d = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      bad++;
      console.log(`FAIL ${f}: not valid JSON (${e.message})`);
      continue;
    }
    const { errors, warnings } = validateWeek(d, { file, existing: data.weeks });
    if (errors.length) bad++;
    console.log(`${errors.length ? 'FAIL' : 'ok  '} ${f}`);
    for (const e of errors) console.log(`       - ${e}`);
    for (const w of warnings) console.log(`       ~ ${w}`);
    if (!errors.length) ready.push(d);
  }
  if (bad) {
    console.log(`\n${bad} of ${files.length} file(s) failing: nothing written.`);
    return 1;
  }
  if (checkOnly) {
    console.log(`\n${files.length} file(s) pass (--check: nothing written).`);
    return 0;
  }
  for (const d of ready) {
    data.weeks[String(d.week)] = {
      week: d.week,
      title: d.title,
      shortTitle: d.shortTitle,
      bigIdea: d.bigIdea,
      keyPoints: d.keyPoints,
      scriptures: d.scriptures,
      questions: { forYou: d.questions.forYou, forGroup: d.questions.forGroup },
    };
  }
  writeFileSync(SUMMARIES_PATH, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`\nmerged ${ready.length} week(s) into ${path.relative(REPO, SUMMARIES_PATH)}: ${ready.map((d) => d.week).join(', ')}`);
  console.log('next: node scripts/render-leader-handouts.mjs && python3 scripts/finalize-handout-pdf.py');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  process.exitCode = main(process.argv.slice(2));
}
