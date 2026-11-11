# Scripture by reference: the King James text and the reference parser

## The text

- Version: the King James Version (KJV).
- It is in the public domain in the United States.
- Source, downloaded 2026-11-11:
  https://raw.githubusercontent.com/thiagobodruk/bible/master/json/en_kjv.json
  (one JSON file of all 66 books).
- Cleaning: outer spaces trimmed. The source already had plain verse text, with no
  braces, pilcrows, Strong's numbers or HTML.
- Files: `kjv/<NN>-<slug>.json`, NN = 01 to 66 in Protestant order, for example
  `kjv/43-john.json`. Each is one compact line:
  `{"book":"John","chapters":[["verse 1","verse 2",...],...]}`.
  Index 0 is chapter 1 and verse 1.
- `kjv/index.json` lists the 66 books as `{n, slug, file, name, chapters}`, where
  `chapters` is the number of verses in each chapter. A page can check a reference
  and find the file name without loading a book.

## The parser

`reference.js` is a pure ES module with no imports. It exports `BOOKS`,
`parseReference(text, index)`, `pagesFor(verses, from, opts)`, `fileFor(book)` and
`MAX_VERSES` (40).

## Re-verify

From the repo root:

    node site/cast/bible/verify.mjs
    node --test site/test/cast-bible.test.mjs

`verify.mjs` checks 66 books, 1,189 chapters, 31,102 verses, some known verses, and
that no verse is empty or holds markup.
