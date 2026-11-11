// Checks the committed King James text. Run it from the repo root:
//   node site/cast/bible/verify.mjs
// It exits with a failure if anything is off. It prints the counts and sizes.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'kjv');
const problems = [];
const fail = (msg) => problems.push(msg);

const index = JSON.parse(readFileSync(path.join(DIR, 'index.json'), 'utf8'));
if (index.length !== 66) fail(`index has ${index.length} books, expected 66`);

let chapters = 0;
let verses = 0;
let bytes = 0;
let biggest = { file: '', size: 0 };
const books = {};

for (const entry of index) {
  const file = path.join(DIR, entry.file);
  const raw = readFileSync(file, 'utf8');
  const size = statSync(file).size;
  bytes += size;
  if (size > biggest.size) biggest = { file: entry.file, size };
  if (raw.includes('\r')) fail(`${entry.file} has a CR`);
  if (!raw.endsWith('\n') || raw.indexOf('\n') !== raw.length - 1) fail(`${entry.file} should be one line ending in LF`);
  const data = JSON.parse(raw);
  books[entry.name] = data.chapters;
  if (data.book !== entry.name) fail(`${entry.file} book name ${data.book} != ${entry.name}`);
  if (entry.file !== `${String(entry.n).padStart(2, '0')}-${entry.slug}.json`) fail(`${entry.file} is not named for entry ${entry.n}`);
  if (JSON.stringify(entry.chapters) !== JSON.stringify(data.chapters.map((c) => c.length))) fail(`${entry.file} chapter counts differ from the index`);
  chapters += data.chapters.length;
  data.chapters.forEach((ch, ci) => {
    verses += ch.length;
    ch.forEach((v, vi) => {
      const where = `${entry.name} ${ci + 1}:${vi + 1}`;
      if (typeof v !== 'string' || v.length === 0) fail(`${where} is empty`);
      else {
        if (v !== v.trim()) fail(`${where} has outer spaces`);
        if (/[<>{}]/.test(v)) fail(`${where} has markup`);
        if (/\d{3,}/.test(v) || /[GH]\d+/.test(v)) fail(`${where} looks like a Strong's number`);
      }
    });
  });
}

// The folder holds the 66 books and the index, nothing else.
const files = readdirSync(DIR);
if (files.length !== 67) fail(`kjv folder has ${files.length} files, expected 67`);

if (chapters !== 1189) fail(`${chapters} chapters, expected 1189`);
if (verses !== 31102) fail(`${verses} verses, expected 31102`);

const same = (got, want, what) => { if (got !== want) fail(`${what}: got ${JSON.stringify(got)}`); };
same(books.Genesis[0][0], 'In the beginning God created the heaven and the earth.', 'Genesis 1:1');
same(books.John[2][15], 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.', 'John 3:16');
same(books.Psalms[116].length, 2, 'Psalm 117 verse count');
same(books.Psalms[118].length, 176, 'Psalm 119 verse count');
same(books.John[10][34], 'Jesus wept.', 'John 11:35');
const rev = books.Revelation;
const last = rev[rev.length - 1];
if (!last[last.length - 1].startsWith('The grace of our Lord Jesus Christ')) fail('Revelation 22:21 is wrong');
same(rev.length, 22, 'Revelation chapter count');
same(last.length, 21, 'Revelation 22 verse count');
same(books['3 John'][0].length, 14, '3 John verse count');

console.log(`books ${index.length}, chapters ${chapters}, verses ${verses}`);
console.log(`total bytes ${bytes}, largest ${biggest.file} (${biggest.size} bytes)`);
if (problems.length) {
  console.error(problems.slice(0, 40).join('\n'));
  console.error(`${problems.length} problem(s)`);
  process.exit(1);
}
console.log('spot checks and shape checks: ok');
