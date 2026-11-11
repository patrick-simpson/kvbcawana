// Scripture by reference: turns what a person types ("John 3:16", "Ps 23",
// "1 cor 13:4-7") into a book, a chapter and a run of verses, and cuts verse
// text into pages that fit the TV.
//
// Pure module. No imports, so a plain static page can load it. It knows nothing
// about the network: the caller hands in the parsed kjv/index.json.

// The most verses sent in one go.
export const MAX_VERSES = 40;

// Each row: [name, extra names]. Names are split on "|". Matching ignores case,
// dots and spaces, so "1 Cor.", "1cor" and "I Cor" all find the same key.
// The 66 books in Protestant order.
const ROWS = [
  ['Genesis', 'gen|ge|gn'],
  ['Exodus', 'ex|exod|exo'],
  ['Leviticus', 'lev|le|lv'],
  ['Numbers', 'num|nu|nm|nb'],
  ['Deuteronomy', 'deut|dt|de'],
  ['Joshua', 'josh|jos'],
  ['Judges', 'judg|jdg|jg'],
  ['Ruth', 'ru|rth'],
  ['1 Samuel', 'samuel|sam|sm'],
  ['2 Samuel', 'samuel|sam|sm'],
  ['1 Kings', 'kings|king|kgs|ki|kin'],
  ['2 Kings', 'kings|king|kgs|ki|kin'],
  ['1 Chronicles', 'chronicles|chron|chr|ch'],
  ['2 Chronicles', 'chronicles|chron|chr|ch'],
  ['Ezra', 'ezr'],
  ['Nehemiah', 'neh|ne'],
  ['Esther', 'est|esth'],
  ['Job', 'jb'],
  ['Psalms', 'psalm|ps|psa|pss|psm|pslm'],
  ['Proverbs', 'proverb|prov|prv|pr'],
  ['Ecclesiastes', 'eccl|eccles|ecc|qoheleth'],
  ['Song of Solomon', 'song of songs|song|songs|song of sol|canticles|cant|sos'],
  ['Isaiah', 'isa|is'],
  ['Jeremiah', 'jer'],
  ['Lamentations', 'lam'],
  ['Ezekiel', 'ezek|eze|ezk'],
  ['Daniel', 'dan|dn'],
  ['Hosea', 'hos'],
  ['Joel', 'jl'],
  ['Amos', 'am'],
  ['Obadiah', 'obad|ob'],
  ['Jonah', 'jon'],
  ['Micah', 'mic'],
  ['Nahum', 'nah'],
  ['Habakkuk', 'hab'],
  ['Zephaniah', 'zeph|zep'],
  ['Haggai', 'hag'],
  ['Zechariah', 'zech|zec'],
  ['Malachi', 'mal'],
  ['Matthew', 'matt|mat|mt'],
  ['Mark', 'mk|mr'],
  ['Luke', 'lk|luk'],
  ['John', 'jn|jhn|joh'],
  ['Acts', 'act|ac'],
  ['Romans', 'rom|ro|rm'],
  ['1 Corinthians', 'corinthians|cor|co'],
  ['2 Corinthians', 'corinthians|cor|co'],
  ['Galatians', 'gal|ga'],
  ['Ephesians', 'eph|ephes'],
  ['Philippians', 'phil|php'],
  ['Colossians', 'col'],
  ['1 Thessalonians', 'thessalonians|thess|thes|th'],
  ['2 Thessalonians', 'thessalonians|thess|thes|th'],
  ['1 Timothy', 'timothy|tim|ti'],
  ['2 Timothy', 'timothy|tim|ti'],
  ['Titus', 'tit'],
  ['Philemon', 'philem|phm'],
  ['Hebrews', 'heb'],
  ['James', 'jas|jam|jm'],
  ['1 Peter', 'peter|pet|pe|pt'],
  ['2 Peter', 'peter|pet|pe|pt'],
  ['1 John', 'john|jn|jhn|joh'],
  ['2 John', 'john|jn|jhn|joh'],
  ['3 John', 'john|jn|jhn|joh'],
  ['Jude', 'jd'],
  ['Revelation', 'revelations|rev|rv|revelation of john'],
];

const slugOf = (name) => name.toLowerCase().replace(/ /g, '-');
const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// How a person may write the number in front of a book.
const PREFIXES = {
  1: ['1', 'i', '1st', 'first'],
  2: ['2', 'ii', '2nd', 'second'],
  3: ['3', 'iii', '3rd', 'third'],
};

// key (squashed name) -> index into BOOKS
const KEYS = new Map();

function addKey(key, i, name) {
  if (KEYS.has(key) && KEYS.get(key) !== i) {
    throw new Error(`reference.js: "${key}" names two books (${name})`);
  }
  KEYS.set(key, i);
}

export const BOOKS = ROWS.map(([name, extra], i) => {
  const book = { n: i + 1, name, slug: slugOf(name), names: [name] };
  const words = extra.split('|');
  if (!/^[123] /.test(name)) {
    // A plain book: its own name and the short forms.
    for (const w of [name.toLowerCase(), ...words]) addKey(squash(w), i, name);
    book.names.push(...words);
  } else {
    // A numbered book: the extras are the word after the number ("samuel", "sam").
    // Any of 1, I, 1st or First may come in front.
    for (const p of PREFIXES[Number(name[0])]) {
      for (const w of [name.slice(2).toLowerCase(), ...words]) {
        addKey(squash(p + w), i, name);
        book.names.push(`${p} ${w}`);
      }
    }
  }
  return book;
});

// The file name a book's text lives in, such as "43-john.json".
export function fileFor(book) {
  return `${String(book.n).padStart(2, '0')}-${book.slug}.json`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// Psalms is "Psalm" once you name a chapter of it.
const refName = (book) => (book.name === 'Psalms' ? 'Psalm' : book.name);

const bad = (reason, hint) => ({ ok: false, reason, hint });

// Reads what a person typed. `index` is the parsed kjv/index.json.
export function parseReference(text, index) {
  let s = String(text == null ? '' : text).toLowerCase().trim();
  if (!s) return bad('empty', 'Type a verse, like John 3:16.');
  // One kind of dash, and plain words out of the way.
  s = s.replace(/[‐-―−]/g, '-');
  s = s.replace(/\bchapter\b|\bchap\b/g, ' ');
  s = s.replace(/\bverses\b|\bverse\b|\bvv?\b\.?|\bvv?(?=\d)/g, ':');

  // Book part (an optional leading number, then letters), then the numbers.
  const m = s.match(/^((?:[123]\s*)?[a-z][a-z.\s]*?)\s*(\d[\s\S]*)?$/);
  const i = m ? KEYS.get(squash(m[1])) : undefined;
  if (i === undefined) {
    return bad('book', "I don't know that book. Try a name like John, 1 Cor or Ps.");
  }
  const meta = BOOKS[i];
  const entry = index.find((b) => b.n === meta.n);
  if (!entry) return bad('book', "I don't know that book. Try a name like John, 1 Cor or Ps.");
  const chapterCounts = entry.chapters;
  const book = { n: entry.n, name: entry.name, slug: entry.slug, file: entry.file };
  const nameOut = refName(book);
  const oneChapter = chapterCounts.length === 1;

  // Tidy the numbers: "3 : 16 - 18" and "3.16" and "3 16" all become "3:16-18".
  let rest = (m[2] || '').trim();
  rest = rest.replace(/\s*-\s*/g, '-').replace(/\s*[:.,]\s*/g, ':').replace(/\s+/g, ':');
  // A stray colon at either end is a mistake: mark it so it fails to match.
  rest = rest.replace(/:+/g, ':').replace(/^:|:$/g, '#');

  let chapter;
  let from;
  let to;
  let whole = false;
  const verseHint = `I could not read the verses. Try ${nameOut} ${oneChapter ? '' : '3:'}16 or ${nameOut} ${oneChapter ? '' : '3:'}16-18.`;

  if (rest === '') {
    if (oneChapter) {
      chapter = 1;
      whole = true;
    } else {
      return bad('chapter', `Which chapter of ${book.name}? Try ${nameOut} 1.`);
    }
  } else if (/^\d+$/.test(rest)) {
    const n = Number(rest);
    if (oneChapter) {
      chapter = 1;
      from = to = n;
    } else {
      chapter = n;
      whole = true;
    }
  } else if (/^\d+-\d+$/.test(rest)) {
    const [a, b] = rest.split('-').map(Number);
    if (oneChapter) {
      chapter = 1;
      from = a;
      to = b;
    } else {
      return bad('range', `Send one chapter at a time, like ${nameOut} ${a}.`);
    }
  } else if (/^\d+:\d+(-\d+)?$/.test(rest)) {
    const parts = rest.split(/[:-]/).map(Number);
    chapter = parts[0];
    from = parts[1];
    to = parts.length > 2 ? parts[2] : parts[1];
  } else if (/^\d+:\d+-\d+:\d+$/.test(rest)) {
    const [c1] = rest.split(/[:-]/).map(Number);
    return bad('range', `Send one chapter at a time, like ${nameOut} ${c1}.`);
  } else {
    return bad('verse', verseHint);
  }

  if (chapter < 1 || chapter > chapterCounts.length) {
    return bad('chapter', `${book.name} has ${plural(chapterCounts.length, 'chapter')}.`);
  }
  const verseCount = chapterCounts[chapter - 1];
  if (whole) {
    from = 1;
    to = verseCount;
  }
  if (from < 1 || from > verseCount) {
    const where = oneChapter ? book.name : `${nameOut} ${chapter}`;
    return bad('verse', `${where} has ${plural(verseCount, 'verse')}.`);
  }
  if (to < from) return bad('range', 'The second verse should come after the first.');
  if (to > verseCount) {
    const where = oneChapter ? book.name : `${nameOut} ${chapter}`;
    return bad('verse', `${where} has ${plural(verseCount, 'verse')}.`);
  }
  if (to - from + 1 > MAX_VERSES) {
    if (whole) {
      return bad('too-long', `Send part of it, like ${nameOut} ${chapter}:1-16.`);
    }
    return bad('too-long', `Send ${MAX_VERSES} verses or fewer at a time, like ${nameOut} ${chapter}:${from}-${from + MAX_VERSES - 1}.`);
  }

  let label = `${nameOut} ${chapter}`;
  if (!whole) label += `:${from}${to > from ? `-${to}` : ''}`;
  return { ok: true, book, chapter, from, to, label };
}

// Cuts verse text into pages of at most `opts.max` characters (default 380).
// Each verse starts with its number. A verse is only split when it is longer
// than a whole page by itself; the rest of it carries on, with no number.
export function pagesFor(verses, from, opts) {
  const max = Math.max(20, (opts && opts.max) || 380);
  const pages = [];
  let cur = '';
  const flush = () => {
    if (cur) pages.push(cur);
    cur = '';
  };
  (verses || []).forEach((v, i) => {
    let text = `${from + i} ${String(v).trim()}`;
    if (cur && cur.length + 1 + text.length <= max) {
      cur += ` ${text}`;
      return;
    }
    flush();
    while (text.length > max) {
      let cut = text.lastIndexOf(' ', max);
      if (cut <= 0) cut = max;
      pages.push(text.slice(0, cut));
      text = text.slice(cut).trimStart();
    }
    cur = text;
  });
  flush();
  return pages;
}
