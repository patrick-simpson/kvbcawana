// Scripture by reference (site/cast/bible/): the King James text and the reference parser.
// The text is read from the committed files; the parser is pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOOKS, MAX_VERSES, fileFor, pagesFor, parseReference } from '../cast/bible/reference.js';

const SITE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const KJV = path.join(SITE, 'cast', 'bible', 'kjv');
const index = JSON.parse(readFileSync(path.join(KJV, 'index.json'), 'utf8'));
const book = (name) => {
  const e = index.find((b) => b.name === name);
  return JSON.parse(readFileSync(path.join(KJV, e.file), 'utf8'));
};

test('the text: 66 books, 1,189 chapters, 31,102 verses, clean', () => {
  assert.equal(index.length, 66);
  let chapters = 0;
  let verses = 0;
  for (const e of index) {
    const data = JSON.parse(readFileSync(path.join(KJV, e.file), 'utf8'));
    assert.equal(data.book, e.name);
    assert.deepEqual(e.chapters, data.chapters.map((c) => c.length));
    chapters += data.chapters.length;
    for (const ch of data.chapters) {
      for (const v of ch) {
        verses += 1;
        assert.ok(v.length > 0, `${e.name} has an empty verse`);
        assert.equal(v, v.trim());
        assert.ok(!/[<>{}]/.test(v), `${e.name}: markup in ${v}`);
        assert.ok(!/\d{3,}|[GH]\d+/.test(v), `${e.name}: Strong's number in ${v}`);
      }
    }
  }
  assert.equal(chapters, 1189);
  assert.equal(verses, 31102);
});

test('the text: spot checks', () => {
  assert.equal(book('Genesis').chapters[0][0], 'In the beginning God created the heaven and the earth.');
  assert.equal(
    book('John').chapters[2][15],
    'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.',
  );
  assert.equal(book('Psalms').chapters[116].length, 2);
  assert.equal(book('Psalms').chapters[118].length, 176);
  assert.equal(book('John').chapters[10][34], 'Jesus wept.');
  const rev = book('Revelation').chapters;
  const last = rev[rev.length - 1];
  assert.ok(last[last.length - 1].startsWith('The grace of our Lord Jesus Christ'));
  assert.equal(book('3 John').chapters[0].length, 14);
});

test('the index names each book file in canon order', () => {
  index.forEach((e, i) => {
    assert.equal(e.n, i + 1);
    assert.equal(e.file, `${String(i + 1).padStart(2, '0')}-${e.slug}.json`);
    assert.equal(fileFor(BOOKS[i]), e.file);
    assert.equal(BOOKS[i].name, e.name);
  });
  assert.equal(index[0].slug, 'genesis');
  assert.equal(index[21].slug, 'song-of-solomon');
  assert.equal(index[8].slug, '1-samuel');
  assert.equal(index[65].slug, 'revelation');
});

test('reference.js has no import statement', () => {
  const src = readFileSync(path.join(SITE, 'cast', 'bible', 'reference.js'), 'utf8');
  assert.ok(!/^\s*import\s/m.test(src));
  assert.ok(!/\bimport\s*\(/.test(src));
});

const ok = (text) => {
  const r = parseReference(text, index);
  assert.equal(r.ok, true, `${text}: ${JSON.stringify(r)}`);
  return r;
};
const no = (text, reason) => {
  const r = parseReference(text, index);
  assert.equal(r.ok, false, text);
  assert.equal(r.reason, reason, `${text}: ${JSON.stringify(r)}`);
  assert.ok(typeof r.hint === 'string' && r.hint.length > 0);
  return r;
};

test('single verses in every spelling', () => {
  for (const t of ['John 3:16', 'john 3 16', 'Jn 3.16', 'JOHN  3 : 16', 'John 3 v16', 'John 3 v. 16', 'John chapter 3 verse 16', 'Jhn 3:16']) {
    const r = ok(t);
    assert.equal(r.book.name, 'John');
    assert.equal(r.book.file, '43-john.json');
    assert.deepEqual([r.chapter, r.from, r.to, r.label], [3, 16, 16, 'John 3:16']);
  }
});

test('ranges, with hyphen, en dash and spaces', () => {
  for (const t of ['John 3:16-18', 'John 3:16–18', 'John 3:16 - 18', 'john 3 16-18', 'John 3:16—18']) {
    const r = ok(t);
    assert.deepEqual([r.chapter, r.from, r.to, r.label], [3, 16, 18, 'John 3:16-18']);
  }
});

test('whole chapters, and the singular Psalm', () => {
  let r = ok('Ps 23');
  assert.deepEqual([r.book.name, r.chapter, r.from, r.to, r.label], ['Psalms', 23, 1, 6, 'Psalm 23']);
  r = ok('Psalm 23:1-3');
  assert.equal(r.label, 'Psalm 23:1-3');
  r = ok('Psalms 117');
  assert.equal(r.label, 'Psalm 117');
  r = ok('psa 100:1');
  assert.equal(r.label, 'Psalm 100:1');
  r = ok('John 3');
  assert.deepEqual([r.from, r.to, r.label], [1, 36, 'John 3']);
});

test('numbered books in every spelling', () => {
  for (const t of ['1 cor 13:4-7', '1Cor 13:4-7', 'I Cor 13:4-7', 'i cor. 13:4-7', 'First Corinthians 13:4-7', '1st Corinthians 13:4-7', '1corinthians 13 4-7', '1 Corinthians 13:4-7']) {
    const r = ok(t);
    assert.equal(r.book.name, '1 Corinthians');
    assert.equal(r.label, '1 Corinthians 13:4-7');
  }
  assert.equal(ok('II Tim 3:16').book.name, '2 Timothy');
  assert.equal(ok('2nd Peter 1:3').book.name, '2 Peter');
  assert.equal(ok('Third John 4').book.name, '3 John');
  assert.equal(ok('1 Sam 17:45').book.name, '1 Samuel');
  assert.equal(ok('2 Kgs 2:11').book.name, '2 Kings');
  assert.equal(ok('1 Jn 4:8').book.name, '1 John');
  assert.equal(ok('1 Thess 4:16').book.name, '1 Thessalonians');
  assert.equal(ok('2 Chron 7:14').book.name, '2 Chronicles');
});

test('names and short forms', () => {
  const want = {
    Gen: 'Genesis', Ge: 'Genesis', Gn: 'Genesis', Ex: 'Exodus', Exod: 'Exodus', Ps: 'Psalms', Psa: 'Psalms',
    Psalm: 'Psalms', Psalms: 'Psalms', Prov: 'Proverbs', Pr: 'Proverbs', Song: 'Song of Solomon',
    'Song of Songs': 'Song of Solomon', Canticles: 'Song of Solomon', SoS: 'Song of Solomon', Isa: 'Isaiah',
    Jer: 'Jeremiah', Matt: 'Matthew', Mt: 'Matthew', Mk: 'Mark', Lk: 'Luke', Jn: 'John', Rom: 'Romans',
    Phil: 'Philippians', Phm: 'Philemon', Philem: 'Philemon', Rev: 'Revelation', Revelation: 'Revelation',
    Revelations: 'Revelation', Jas: 'James', Jude: 'Jude', Judg: 'Judges', Heb: 'Hebrews', Eccl: 'Ecclesiastes',
    Ezek: 'Ezekiel', Hab: 'Habakkuk', Zech: 'Zechariah', Deut: 'Deuteronomy', Acts: 'Acts',
  };
  for (const [abbr, name] of Object.entries(want)) {
    const r = parseReference(`${abbr} 1:1`, index);
    assert.equal(r.ok, true, `${abbr} 1:1: ${JSON.stringify(r)}`);
    assert.equal(r.book.name, name, abbr);
  }
});

test('every book is found by its full name and by no other book', () => {
  for (const b of BOOKS) {
    for (const nm of b.names) {
      const r = parseReference(`${nm} 1:1`, index);
      assert.equal(r.ok, true, `${nm}: ${JSON.stringify(r)}`);
      assert.equal(r.book.n, b.n, nm);
    }
  }
});

test('one-chapter books take a lone number as a verse', () => {
  let r = ok('Jude 5');
  assert.deepEqual([r.book.name, r.chapter, r.from, r.to, r.label], ['Jude', 1, 5, 5, 'Jude 1:5']);
  r = ok('Obadiah 3');
  assert.deepEqual([r.chapter, r.from, r.to], [1, 3, 3]);
  r = ok('3 John 4');
  assert.deepEqual([r.book.name, r.chapter, r.from, r.to], ['3 John', 1, 4, 4]);
  r = ok('Philemon 1:5');
  assert.deepEqual([r.chapter, r.from, r.to], [1, 5, 5]);
  r = ok('Jude 3-5');
  assert.deepEqual([r.from, r.to], [3, 5]);
  r = ok('2 John 1:6-8');
  assert.deepEqual([r.from, r.to], [6, 8]);
  no('Jude 26', 'verse');
  no('Jude 2:1', 'chapter');
});

test('every failure reason, with a plain hint', () => {
  assert.equal(no('', 'empty').reason, 'empty');
  no('   ', 'empty');
  no('Hezekiah 3:1', 'book');
  no('3:16', 'book');
  no('John', 'chapter');
  assert.equal(no('John 22', 'chapter').hint, 'John has 21 chapters.');
  assert.equal(no('John 0', 'chapter').reason, 'chapter');
  assert.equal(no('Obadiah 1:1-2:3', 'range').reason, 'range');
  assert.equal(no('John 3:99', 'verse').hint, 'John 3 has 36 verses.');
  assert.equal(no('John 3:0', 'verse').reason, 'verse');
  no('John 3:30-99', 'verse');
  no('John 3:', 'verse');
  no('John 3:16-', 'verse');
  no('John 3:16-18-20', 'verse');
  no('John 3:18-16', 'range');
  no('John 3:16-4:2', 'range');
  assert.match(no('John 3-4', 'range').hint, /one chapter at a time/);
  assert.match(no('John 3:16-4:2', 'range').hint, /one chapter at a time/);
  assert.equal(no('Psalm 119', 'too-long').hint, 'Send part of it, like Psalm 119:1-16.');
  assert.match(no('Psalm 119:1-60', 'too-long').hint, /40 verses/);
  assert.equal(ok('Psalm 119:1-40').to, 40);
  assert.equal(MAX_VERSES, 40);
});

test('a chapter of exactly 40 or fewer verses is fine, longer is too long', () => {
  for (const e of index) {
    e.chapters.forEach((count, i) => {
      const r = parseReference(`${e.name} ${i + 1}`, index);
      if (e.chapters.length === 1) return;
      if (count > MAX_VERSES) assert.equal(r.reason, 'too-long', `${e.name} ${i + 1}`);
      else assert.equal(r.ok, true, `${e.name} ${i + 1}`);
    });
  }
});

test('pagesFor: limits, order, no verse lost', () => {
  const verses = book('John').chapters[2];
  const pages = pagesFor(verses.slice(15, 18), 16);
  assert.ok(pages.length >= 1);
  assert.ok(pages[0].startsWith('16 For God so loved'));
  for (const max of [60, 120, 380]) {
    const out = pagesFor(verses, 1, { max });
    for (const p of out) assert.ok(p.length <= max, `page of ${p.length} over ${max}`);
    // Every verse number appears, in order, once.
    const joined = out.join(' ');
    let at = 0;
    verses.forEach((v, i) => {
      const found = joined.indexOf(`${i + 1} ${v.slice(0, 20)}`, at);
      assert.ok(found >= at, `verse ${i + 1} missing at max ${max}`);
      at = found + 1;
    });
    // Nothing added or lost: the words are the same.
    const want = verses.map((v, i) => `${i + 1} ${v}`).join(' ');
    assert.equal(out.join(' '), want);
  }
  assert.deepEqual(pagesFor(verses, 1), pagesFor(verses, 1));
});

test('pagesFor: whole verses are kept together and joined by one space', () => {
  const out = pagesFor(['aaa', 'bbb', 'ccc'], 5, { max: 30 });
  assert.deepEqual(out, ['5 aaa 6 bbb 7 ccc']);
  const two = pagesFor(['aaaaaaaaaa', 'bbbbbbbbbb'], 1, { max: 24 });
  assert.deepEqual(two, ['1 aaaaaaaaaa', '2 bbbbbbbbbb']);
  assert.deepEqual(pagesFor([], 1), []);
});

test('pagesFor: a verse longer than a page is split at a space', () => {
  const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
  const out = pagesFor([long, 'Short.'], 9, { max: 100 });
  assert.ok(out.length >= 3);
  for (const p of out) assert.ok(p.length <= 100);
  assert.ok(out[0].startsWith('9 word0 '));
  // The pieces after the first carry no number; the next verse starts with its own.
  assert.ok(!/^\d+ word/.test(out[1]));
  assert.equal(out.join(' '), `9 ${long} 10 Short.`);
  assert.ok(out[0].endsWith(' ') === false);
  // The real longest verse (Esther 8:9) fits in pages of 380.
  const esther = book('Esther').chapters[7][8];
  const pages = pagesFor([esther], 9);
  assert.ok(pages.every((p) => p.length <= 380));
  assert.equal(pages.join(' '), `9 ${esther}`);
});
