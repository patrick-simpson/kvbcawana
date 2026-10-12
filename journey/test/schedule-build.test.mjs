// public/src/schedule.js is a build output of src/schedule/*.js (see
// scripts/build-schedule.mjs). This fails when someone edits one and forgets
// to rebuild, so the kiosk never ships a different script than the sources.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSchedule } from '../scripts/build-schedule.mjs';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'src', 'schedule.js');

test('public/src/schedule.js is up to date with src/schedule/', () => {
  assert.ok(readFileSync(out, 'utf8') === buildSchedule(), 'stale: run `npm run build` in journey/');
});
