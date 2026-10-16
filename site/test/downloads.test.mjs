// The stable download links (site/lib/downloads.js): each one follows its
// update feed, and KVBC Awana (9.0.0) answers at its new name and its old one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { downloadRedirects, installerFromFeed } from '../lib/downloads.js';

const RELEASES = 'https://github.com/patrick-simpson/kvbcawana/releases';
const BASE = 'https://github.com/patrick-simpson/kvbcawana/releases/download';
// What printer-release.yml writes for 9.0.0 (absolute URLs, the new installer name).
const PRINTER_9 = `version: 9.0.0
files:
  - url: ${BASE}/printer-v9.0.0/KVBC-Awana-Setup.exe
    sha512: abc==
    size: 245760585
path: ${BASE}/printer-v9.0.0/KVBC-Awana-Setup.exe
sha512: abc==
releaseDate: '2026-10-12T21:02:15.881Z'
`;
const LOBBY_2_1 = `version: 2.1.0
files:
  - url: ${BASE}/desktop-v2.1.0/Awana-Lobby-Display-Setup.exe
    sha512: def==
    size: 1
path: ${BASE}/desktop-v2.1.0/Awana-Lobby-Display-Setup.exe
`;

test('the installer is the feed\'s first absolute .exe url', () => {
  assert.equal(installerFromFeed(PRINTER_9), `${BASE}/printer-v9.0.0/KVBC-Awana-Setup.exe`);
  assert.equal(installerFromFeed('version: 1.0.0\nfiles:\n  - url: Setup.exe\n'), null);
  assert.equal(installerFromFeed(null), null);
});

test('KVBC Awana at /download/kvbc-awana and at the printer\'s old name and the retired sound room app\'s', () => {
  const lines = downloadRedirects((f) => ({ 'printer/latest.yml': PRINTER_9, 'lobby/lobby.yml': LOBBY_2_1 })[f] ?? null, RELEASES);
  assert.deepEqual(lines, [
    `/download/kvbc-awana ${BASE}/printer-v9.0.0/KVBC-Awana-Setup.exe 302`,
    `/download/club-label-printer ${BASE}/printer-v9.0.0/KVBC-Awana-Setup.exe 302`,
    `/download/lobby-display ${BASE}/printer-v9.0.0/KVBC-Awana-Setup.exe 302`,
  ]);
});

test('no feed yet: the releases page', () => {
  assert.deepEqual(downloadRedirects(() => null, RELEASES).map((l) => l.split(' ')[1]), [RELEASES, RELEASES, RELEASES]);
});

test('the feed in the repo today resolves too', () => {
  const live = readFileSync(new URL('../updates/printer/latest.yml', import.meta.url), 'utf8');
  assert.match(installerFromFeed(live), /^https:\/\/github\.com\/patrick-simpson\/kvbcawana\/releases\/download\/printer-v[\d.]+\/[\w.-]+\.exe$/);
});
