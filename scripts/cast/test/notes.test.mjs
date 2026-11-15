// Cast: the speaker notes (owner 2026-11-15: "The converter would pull the notes out
// alongside the slides, and they'd show only on the presenter's phone"). A small .pptx is
// BUILT here (a zip written by hand, Node's own zlib), so the reader is tested on the parts
// a real one has: the slide order from presentation.xml (not the file names), each slide's
// rels to its notes slide, the notes placeholder (never the slide picture or number), a
// hidden slide left out as LibreOffice's PDF leaves it out. The notes go to the Worker
// sealed with the job's own key, before the PDF; a deck without notes sends none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateRawSync } from 'node:zlib';
import { NOTES_MAX_BYTES, NOTE_MAX, notesFromPptx, notesText, run, sealNotes, zipEntries } from '../convert.mjs';
import { CAST_NOTES_MAX_BYTES, CAST_NOTE_MAX, sanitizeNotes } from '../../../shared/classroomRemote.js';

/** A zip of { name: text }; `stored` names are written uncompressed. */
function zip(files, stored = []) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, 'utf8');
    const store = stored.includes(name);
    const data = store ? raw : deflateRawSync(raw);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(store ? 0 : 8, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(centrals.length / 2, 8); eocd.writeUInt16LE(centrals.length / 2, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, eocd]));
}

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const slide = (hidden) => `<?xml version="1.0"?><p:sld ${NS}${hidden ? ' show="0"' : ''}><p:cSld><p:spTree/></p:cSld></p:sld>`;
const slideRels = (notes) => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>${notes ? `<Relationship Id="rId2" Type="${REL}/notesSlide" Target="../notesSlides/${notes}"/>` : ''}</Relationships>`;
const notesSlide = (body) => `<?xml version="1.0"?><p:notes ${NS}><p:cSld><p:spTree>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:cNvSpPr/><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${body}</p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="4" name="Number"/><p:cNvSpPr/><p:nvPr><p:ph type="sldNum" idx="5"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:p><a:fld type="slidenum"><a:t>7</a:t></a:fld></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:notes>`;

/** Three slides listed in the order slide3, slide1 (hidden), slide2. */
export function deck() {
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'ppt/presentation.xml': `<?xml version="1.0"?><p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId9"/><p:sldId id="257" r:id="rId7"/><p:sldId id="258" r:id="rId8"/></p:sldIdLst></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="${REL}/slide" Target="slides/slide1.xml"/><Relationship Id="rId8" Type="${REL}/slide" Target="slides/slide2.xml"/><Relationship Id="rId9" Type="${REL}/slide" Target="/ppt/slides/slide3.xml"/><Relationship Id="rId1" Type="${REL}/hyperlink" Target="https://example.com" TargetMode="External"/></Relationships>`,
    'ppt/slides/slide1.xml': slide(true),
    'ppt/slides/slide2.xml': slide(false),
    'ppt/slides/slide3.xml': slide(false),
    'ppt/slides/_rels/slide1.xml.rels': slideRels('notesSlide9.xml'),
    'ppt/slides/_rels/slide2.xml.rels': slideRels(''),
    'ppt/slides/_rels/slide3.xml.rels': slideRels('notesSlide4.xml'),
    'ppt/notesSlides/notesSlide4.xml': notesSlide('<a:p><a:r><a:t>Welcome everyone &amp; thank </a:t></a:r><a:r><a:rPr b="1"/><a:t>you</a:t></a:r></a:p><a:p/><a:p><a:r><a:t>Ask: who has been to camp?</a:t></a:r><a:br/><a:r><a:t xml:space="preserve">Pause &#8212; then John 3:16</a:t></a:r></a:p>'),
    'ppt/notesSlides/notesSlide9.xml': notesSlide('<a:p><a:r><a:t>Hidden slide words</a:t></a:r></a:p>'),
  }, ['ppt/presentation.xml']);
}

const KEY = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
async function open(sealed, key = KEY) {
  const k = await crypto.subtle.importKey('raw', Buffer.from(key, 'base64url'), 'AES-GCM', false, ['decrypt']);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.subarray(0, 12) }, k, sealed.subarray(12))));
}

test('the notes come out per slide, in the deck\'s order, the hidden slide left out', () => {
  assert.ok(zipEntries(deck()).has('ppt/presentation.xml'));
  assert.deepEqual(notesFromPptx(deck()), [
    'Welcome everyone & thank you\n\nAsk: who has been to camp?\nPause — then John 3:16',
    '',
  ]);
  // Not a zip, or a zip that is no PowerPoint: none.
  assert.equal(notesFromPptx(new Uint8Array([1, 2, 3])), null);
  assert.equal(notesFromPptx(zip({ 'a.txt': 'hello' })), null);
});

test('only the notes placeholder is read (never the slide picture or the slide number), cut to its limit', () => {
  assert.equal(notesText(notesSlide('<a:p><a:r><a:t>Only this</a:t></a:r></a:p>')), 'Only this');
  assert.equal(notesText(notesSlide(`<a:p><a:r><a:t>${'x'.repeat(NOTE_MAX + 50)}</a:t></a:r></a:p>`)).length, NOTE_MAX);
  assert.equal(notesText('<p:notes/>'), '');
});

test('sealed with the job\'s own key; none when the deck has none; the limits are the Worker\'s and the page\'s', async () => {
  const sealed = await sealNotes(['One', '', 'Three'], KEY);
  assert.deepEqual(await open(sealed), { v: 1, notes: ['One', '', 'Three'] });
  assert.equal(await sealNotes(['', ''], KEY), null);
  assert.equal(await sealNotes(null, KEY), null);
  // A long deck still fits: each note is cut shorter rather than the notes dropped.
  const long = await sealNotes(Array.from({ length: 300 }, () => 'y'.repeat(NOTE_MAX)), KEY);
  assert.ok(long.length <= NOTES_MAX_BYTES);
  assert.equal((await open(long)).notes.length, 300);
  assert.equal(NOTES_MAX_BYTES, CAST_NOTES_MAX_BYTES);
  assert.equal(NOTE_MAX, CAST_NOTE_MAX);
  // What the page opens passes the shared rules as it is.
  assert.deepEqual(sanitizeNotes((await open(sealed)).notes), ['One', '', 'Three']);
});

test('the job sends the sealed notes before the PDF; a .ppt sends none; a failed notes call never fails the job', async () => {
  const PDF = Uint8Array.from(Buffer.from('%PDF-1.7\n% test\n'));
  const scramble = async (bytes) => {
    const k = await crypto.subtle.importKey('raw', Buffer.from(KEY, 'base64url'), 'AES-GCM', false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, bytes));
    const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
    return out;
  };
  const ID = 'cabcdefghijklmnop';
  const stand = (ct, notesStatus = 200) => {
    const calls = [];
    const get = async (url, init = {}) => {
      const u = String(url).replace(`https://awana.kvbchurch.org/api/v1/cast/convert/${ID}/`, '');
      calls.push({ u, method: init.method || 'GET', body: init.body });
      if (u === 'job') return new Response(ct);
      if (u === 'notes') return new Response('{}', { status: notesStatus });
      return new Response('{"ok":true}');
    };
    return { calls, get };
  };
  let w = stand(await scramble(deck()));
  assert.equal(await run({ JOB: `${ID}.${KEY}`, PRINT_FETCH_TOKEN: 'm' }, { get: w.get, convert: async () => PDF }), 'done');
  assert.deepEqual(w.calls.map((c) => `${c.method} ${c.u}`), ['GET job', 'PUT notes', 'PUT result']);
  assert.deepEqual((await open(new Uint8Array(w.calls[1].body))).notes[0].split('\n')[0], 'Welcome everyone & thank you');

  w = stand(await scramble(deck()), 500);
  assert.equal(await run({ JOB: `${ID}.${KEY}`, PRINT_FETCH_TOKEN: 'm' }, { get: w.get, convert: async () => PDF }), 'done');

  const ppt = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0]);
  w = stand(await scramble(ppt));
  assert.equal(await run({ JOB: `${ID}.${KEY}`, PRINT_FETCH_TOKEN: 'm' }, { get: w.get, convert: async () => PDF }), 'done');
  assert.deepEqual(w.calls.map((c) => `${c.method} ${c.u}`), ['GET job', 'PUT result']);
});
