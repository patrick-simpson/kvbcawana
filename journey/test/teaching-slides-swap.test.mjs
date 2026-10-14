import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const slides = JSON.parse(readFileSync(path.join(root, 'teaching-slides.json'), 'utf8'));
const source = readFileSync(path.join(root, 'src', 'schedule.js'), 'utf8');

// Awana published its lesson 2-2 (Monotheism) and 2-4 (Naturalism) teaching
// decks swapped: the file named 2-2 holds the Naturalism slides. Weeks 6 and 8
// therefore read each other's deck, and a kiosk that saved the old pictures
// must not reuse them (owner 2026-10-14: "I selected the naturalism slides and
// monotheism showed up").
test('weeks 6 and 8 read each other\'s deck, because Awana\'s files are swapped', () => {
  assert.match(slides.weeks['6'].title, /Monotheism/);
  assert.match(slides.weeks['8'].title, /Naturalism/);
  assert.match(slides.weeks['6'].deckUrl, /advocates-2-4-teaching-slides/);
  assert.match(slides.weeks['8'].deckUrl, /advocates-2-2-teaching-slides/);
});

test('weeks 6 and 8 carry a picture revision, so an old saved copy is never reused', () => {
  assert.match(source, /const SLIDE_REVISIONS = \{ 6: 2, 8: 2 \};/);
  assert.match(source, /slides\/\$\{weekTag\(week\)\}\/slide-\$\{n\}\.jpg\$\{slideRevision\(week\)\}/);
});
