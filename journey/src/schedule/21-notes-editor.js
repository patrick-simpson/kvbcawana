/* ── Tonight's bullets, editable on the kiosk ─────────────────────────
   The three generated slides (Talk About It / Remember This / This Week)
   are written from the Leader Video's transcript into
   public/teaching-slides.json, so changing one word costs a repo edit, a
   deploy, and the ten-minute Pages cache. A leader who wants to ask a
   different question tonight — or who spots an awkward line five minutes
   before club — has neither.

   So: a per-device override, stored under journey.slides.notesOverride and
   keyed by week and kind, which buildSlideItems() prefers over the written
   text. public/teaching-slides.json is never touched and stays the
   canonical, hand-edited source; an override is this device's own copy of
   tonight's bullets, exactly like the caption and auto-advance
   preferences. Only kinds that actually DIFFER from the written bullets
   are stored, so a later correction to the JSON still reaches every kind
   the leader left alone. Nothing marks an override on the slide itself
   (the wall must look the same either way), so Settings carries an
   "Edited on this device" badge and a Reset instead — an override that
   nobody can see is worse than no override at all. */
const SLIDE_NOTES_OVERRIDE_KEY = 'journey.slides.notesOverride';
const SLIDE_BULLET_MAX_CHARS = 80; // the deck's own limit, which fitTemplateText() assumes
const SLIDE_BULLETS_PER_KIND = 3;

// One slide bullet is one line: a textarea's newlines would otherwise turn
// into an unpredictable wrap on a 4:3 stage read from across a room.
function cleanBullet(value) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SLIDE_BULLET_MAX_CHARS);
}

// The whole override blob, shape-checked on the way out and capped on both
// axes: this is device storage, which a browser (or a person with devtools)
// can leave in any state at all.
function slideNotesOverrides() {
  try {
    const raw = JSON.parse(localStorage.getItem(SLIDE_NOTES_OVERRIDE_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return {};
    const out = {};
    for (const week of Object.keys(raw)) {
      const byKind = raw[week];
      if (!/^\d+$/.test(week) || !byKind || typeof byKind !== 'object') continue;
      const kinds = {};
      for (const kind of SLIDE_EXTRA_KINDS) {
        if (!Array.isArray(byKind[kind])) continue;
        const bullets = byKind[kind]
          .map(cleanBullet)
          .filter(Boolean)
          .slice(0, SLIDE_BULLETS_PER_KIND);
        if (bullets.length) kinds[kind] = bullets;
      }
      if (Object.keys(kinds).length) out[week] = kinds;
    }
    return out;
  } catch {
    return {}; // unreadable/blocked storage → the written bullets, as if never edited
  }
}

function slideNotesOverrideFor(week) {
  return slideNotesOverrides()[String(week)] || null;
}

/* Replaces one week's whole override (a falsy/empty `kinds` clears it).
   Returns whether anything is stored for that week afterward — or null if
   the write itself failed, which the editor has to say out loud: the
   slideshow reads these back out of storage, so an edit that could not be
   stored did not take at all. */
function storeSlideNotesOverride(week, kinds) {
  const all = slideNotesOverrides();
  const key = String(week);
  if (kinds && Object.keys(kinds).length) all[key] = kinds;
  else delete all[key];
  try {
    if (Object.keys(all).length) {
      localStorage.setItem(SLIDE_NOTES_OVERRIDE_KEY, JSON.stringify(all));
    } else {
      localStorage.removeItem(SLIDE_NOTES_OVERRIDE_KEY);
    }
  } catch {
    return null; // storage blocked (kiosk/private mode) or full
  }
  return !!all[key];
}

// The written bullets for a week, normalised the same way a typed one is so
// the two can be compared honestly.
function writtenSlideNotesFor(week) {
  const w = teachingSlidesFor(week);
  const notes = w && w.notes && typeof w.notes === 'object' ? w.notes : {};
  const out = {};
  for (const kind of SLIDE_EXTRA_KINDS) {
    if (!Array.isArray(notes[kind])) continue;
    out[kind] = notes[kind].map(cleanBullet).filter(Boolean).slice(0, SLIDE_BULLETS_PER_KIND);
  }
  return out;
}

/* What buildSlideItems() should actually show: the written bullets, with any
   kind this device has overridden replacing that kind wholesale. Pure — it
   reads storage but never writes it. */
function slideNotesFor(week) {
  const w = teachingSlidesFor(week);
  const written = w && w.notes && typeof w.notes === 'object' ? w.notes : {};
  const override = slideNotesOverrideFor(week);
  const notes = {};
  for (const kind of SLIDE_EXTRA_KINDS) {
    if (override && override[kind]) notes[kind] = override[kind];
    else if (Array.isArray(written[kind])) notes[kind] = written[kind].map(String);
  }
  return notes;
}

/* Only tonight's lesson is editable. It is the one that will be on the wall
   in a few minutes, and naming a single week keeps the panel honest about
   what "Edited on this device" and Reset actually refer to. */
function editableNotesWeek() {
  return currentLesson && Number.isInteger(currentLesson.week) ? currentLesson.week : null;
}

let notesEditSaveTimer = null;

function updateNotesEditedBadge() {
  const week = editableNotesWeek();
  const edited = week !== null && !!slideNotesOverrideFor(week);
  notesEditedBadge.classList.toggle('hidden', !edited);
  notesResetBtn.classList.toggle('hidden', !edited);
}

function renderNotesEditor() {
  notesEditGroups.textContent = '';
  notesEditStatus.textContent = '';
  const week = editableNotesWeek();
  if (week === null) {
    notesEditWeek.textContent =
      'Tonight’s lesson hasn’t loaded yet, so there are no bullets to edit.';
    updateNotesEditedBadge();
    return;
  }
  if (!teachingSlides) {
    // Nothing is awaited before the editor renders — it says so and fills
    // itself in if teaching-slides.json turns up.
    notesEditWeek.textContent = `Week ${week} — loading the written bullets…`;
    loadTeachingSlides().then(() => {
      if (!settingsPanel.classList.contains('hidden') && !notesEditBody.classList.contains('hidden')) {
        renderNotesEditor();
      }
    });
    updateNotesEditedBadge();
    return;
  }
  const title = currentLesson && currentLesson.title ? ` — ${currentLesson.title}` : '';
  notesEditWeek.textContent =
    `Week ${week}${title}. Saved on this kiosk only; the written bullets are left alone. ` +
    `Clear a line to drop it, or clear all three to go back to what was written.`;
  const headings = Object.assign({}, SLIDE_HEADINGS_DEFAULT, (teachingSlides && teachingSlides.headings) || {});
  const notes = slideNotesFor(week);
  const extras = slidesExtras();
  for (const kind of SLIDE_EXTRA_KINDS) {
    const group = document.createElement('div');
    group.className = 'notes-edit-group';
    const heading = document.createElement('p');
    heading.className = 'notes-edit-heading';
    heading.textContent = extras[kind]
      ? headings[kind]
      : `${headings[kind]} (not ticked — this slide isn’t shown)`;
    group.appendChild(heading);
    const existing = Array.isArray(notes[kind]) ? notes[kind] : [];
    for (let i = 0; i < SLIDE_BULLETS_PER_KIND; i++) {
      const field = document.createElement('textarea');
      field.className = 'notes-edit-input';
      field.rows = 2;
      field.maxLength = SLIDE_BULLET_MAX_CHARS;
      field.dataset.kind = kind;
      field.value = existing[i] || ''; // a value, never innerHTML
      field.setAttribute('aria-label', `${headings[kind]} — bullet ${i + 1}`);
      field.addEventListener('input', scheduleNotesSave);
      group.appendChild(field);
    }
    notesEditGroups.appendChild(group);
  }
  updateNotesEditedBadge();
}

function saveNotesEditor() {
  clearTimeout(notesEditSaveTimer);
  notesEditSaveTimer = null;
  const week = editableNotesWeek();
  const fields = notesEditGroups.querySelectorAll('textarea');
  if (week === null || !fields.length) return; // never rendered — nothing to commit
  const typed = {};
  for (const field of fields) {
    const bullet = cleanBullet(field.value);
    if (!bullet) continue; // a blank line is simply one fewer bullet
    const kind = field.dataset.kind;
    (typed[kind] || (typed[kind] = [])).push(bullet);
  }
  const written = writtenSlideNotesFor(week);
  const kinds = {};
  for (const kind of SLIDE_EXTRA_KINDS) {
    const bullets = (typed[kind] || []).slice(0, SLIDE_BULLETS_PER_KIND);
    if (!bullets.length) continue; // all three cleared → back to the written bullets
    if ((written[kind] || []).join('\n') === bullets.join('\n')) continue; // unchanged
    kinds[kind] = bullets;
  }
  const stored = storeSlideNotesOverride(week, kinds);
  notesEditStatus.textContent =
    stored === null
      ? 'This kiosk’s browser won’t store settings, so the edit didn’t take.'
      : stored
        ? 'Saved on this device'
        : 'Using the written bullets';
  updateNotesEditedBadge();
}

// Typing writes through a short debounce rather than on every keystroke —
// JSON.stringify per character is silly.
function scheduleNotesSave() {
  clearTimeout(notesEditSaveTimer);
  notesEditSaveTimer = setTimeout(saveNotesEditor, 500);
}

notesEditToggle.addEventListener('click', () => {
  const opening = notesEditBody.classList.contains('hidden');
  notesEditToggle.setAttribute('aria-expanded', String(opening));
  if (opening) renderNotesEditor(); // built from memory + localStorage; nothing awaited
  else saveNotesEditor(); // collapsing commits whatever is in the boxes
  notesEditBody.classList.toggle('hidden', !opening);
});

notesResetBtn.addEventListener('click', () => {
  const week = editableNotesWeek();
  if (week === null) return;
  clearTimeout(notesEditSaveTimer);
  notesEditSaveTimer = null;
  storeSlideNotesOverride(week, null);
  renderNotesEditor();
  notesEditStatus.textContent = 'Reset to the written bullets';
});

function buildSlideItems(week) {
  if (!Number.isInteger(week) || week < 1) return [];
  const items = [];
  const count = deckSlideCount(week);
  for (let n = 1; n <= count; n++) items.push({ type: 'image', url: slideImageUrl(week, n) });
  // slideNotesFor() is the written bullets with this device's own edits
  // layered on top (see the block above) — teaching-slides.json itself is
  // never modified.
  const notes = slideNotesFor(week);
  const headings = Object.assign({}, SLIDE_HEADINGS_DEFAULT, (teachingSlides && teachingSlides.headings) || {});
  const extras = slidesExtras();
  for (const kind of SLIDE_EXTRA_KINDS) {
    if (!extras[kind] || !notes || !Array.isArray(notes[kind]) || !notes[kind].length) continue;
    items.push({
      type: 'template',
      kind, // which fill (the phone remote reports it: 28-phone-remote.js)
      heading: headings[kind],
      bullets: notes[kind].map(String),
      url: slideTemplateUrl(week),
    });
  }
  return items;
}


function slideshowActive() {
  return slideshow !== null;
}

/* Serve a prefetched slide from the cache as a blob URL (memoized per
   slideshow, all revoked in stopTeachingSlides), else the plain URL. */
function resolveSlideUrl(show, url) {
  if (show.blobUrls.has(url)) return show.blobUrls.get(url);
  const pending = (async () => {
    if ('caches' in window) {
      try {
        const hit = await caches.match(url);
        if (hit) {
          const blobUrl = URL.createObjectURL(await hit.blob());
          if (slideshow !== show) {
            URL.revokeObjectURL(blobUrl); // torn down while reading
            return url;
          }
          return blobUrl;
        }
      } catch {
        // fall through to the live URL
      }
    }
    return url;
  })();
  show.blobUrls.set(url, pending); // memoized as a promise: one blob per URL, ever
  return pending;
}

/* A slide's picture, fetched (cache first, above) AND decoded, memoized per
   slideshow: { src } once the browser can paint it without a decode on the
   frame it appears (the decoded Image is kept in the map so it stays warm).
   A picture that will not decode still resolves, so the element gets its
   src and its own 'error' handling (skip ahead) runs as before. showSlide()
   puts a picture on screen only through this, the next slide is decoded
   ahead through it, and the slide-change motion (24-motion.js) holds its
   carry on the same promise, so a step never uncovers a half-loaded slide. */
function slidePicture(show, url) {
  if (!show.pictures) show.pictures = new Map();
  if (show.pictures.has(url)) return show.pictures.get(url).ready;
  const entry = { img: null, ready: null };
  entry.ready = Promise.resolve(resolveSlideUrl(show, url)).then((src) => {
    if (slideshow !== show || typeof Image !== 'function') return { src };
    const img = new Image();
    entry.img = img;
    img.src = src;
    if (typeof img.decode !== 'function') return { src };
    return img.decode().then(() => ({ src }), () => ({ src }));
  });
  show.pictures.set(url, entry);
  return entry.ready;
}

function startTeachingSlides(week, onFinish) {
  const items = buildSlideItems(week);
  if (!items.length) return false;
  stopTeachingSlides();
  ++journeyRequestToken; // nothing in flight should touch the video now
  cancelLessonIntro();
  slideshow = { week, items, index: 0, onFinish, blobUrls: new Map(), pictures: new Map(), errors: 0 };
  // Release the video the same way stopJourneyContent() does — a decoded
  // ~17MB blob has no business staying resident behind a slideshow.
  journeyVideo.pause();
  journeyVideo.removeAttribute('src');
  journeyVideo.load();
  journeyVideo.classList.add('hidden');
  videoControls.classList.add('hidden');
  videoControls.classList.remove('force-visible');
  hideVideoLoading();
  removeCaptionTracks();
  ccBtn.classList.add('hidden');
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  journeySplash.classList.add('hidden');
  journeyPlaceholder.classList.add('hidden');
  journeyView.classList.remove('hidden');
  checkinView.classList.add('hidden');
  trekView.classList.add('hidden'); // a lesson or preview over Trek's card takes the screen
  slidesView.classList.remove('hidden');
  showSlide(0);
  return true;
}

function showSlide(index) {
  const show = slideshow;
  if (!show) return;
  show.index = index;
  const item = show.items[index];
  clearTimeout(slideAutoTimer);
  slideAutoTimer = null;
  slideCounter.textContent = `Slide ${index + 1} of ${show.items.length}`;
  slidePrevBtn.disabled = index === 0;
  slideNextBtn.textContent = index === show.items.length - 1 ? 'Finish ✓' : 'Next →';
  if (item.type === 'image') {
    slideTemplate.classList.add('hidden');
    slideTemplate.style.backgroundImage = '';
    slideImage.classList.remove('hidden');
    slidePicture(show, item.url).then(({ src }) => {
      if (slideshow !== show || show.index !== index) return;
      slideImage.src = src;
    });
  } else {
    slideImage.classList.add('hidden');
    slideImage.removeAttribute('src');
    slideTemplateHeading.textContent = item.heading;
    slideTemplateBullets.textContent = '';
    for (const bullet of item.bullets) {
      const li = document.createElement('li');
      li.textContent = bullet;
      slideTemplateBullets.appendChild(li);
    }
    slideTemplate.classList.remove('hidden');
    fitTemplateText();
    slidePicture(show, item.url).then(({ src }) => {
      if (slideshow !== show || show.index !== index) return;
      slideTemplate.style.backgroundImage = `url("${src}")`;
    });
  }
  // Fetch and decode the next slide now, so the step lands instantly.
  const next = show.items[index + 1];
  if (next) slidePicture(show, next.url);
  const sec = slidesAutoAdvanceSec();
  if (sec > 0) slideAutoTimer = setTimeout(nextSlide, sec * 1000);
}

/* Three long bullets can outgrow the 4:3 stage on a short screen; step the
   list's type down until it fits rather than letting it spill off the
   slide (each bullet is capped at 80 characters, so this rarely fires). */
function fitTemplateText() {
  slideTemplateBullets.style.fontSize = '';
  const base = parseFloat(getComputedStyle(slideTemplateBullets).fontSize) || 24;
  let size = base;
  let guard = 12;
  while (guard-- > 0 && slideTemplateBullets.scrollHeight > slideTemplateBullets.clientHeight + 1 && size > base * 0.55) {
    size *= 0.92;
    slideTemplateBullets.style.fontSize = `${size}px`;
  }
}

window.addEventListener('resize', () => {
  if (slideshow && !slideTemplate.classList.contains('hidden')) fitTemplateText();
});

function nextSlide() {
  if (!slideshow) return;
  if (slideshow.index >= slideshow.items.length - 1) {
    finishTeachingSlides();
    return;
  }
  showSlide(slideshow.index + 1);
}

function prevSlide() {
  if (!slideshow || slideshow.index === 0) return;
  showSlide(slideshow.index - 1);
}

function finishTeachingSlides() {
  const show = slideshow;
  stopTeachingSlides();
  // The whole showing (video + slides) is done. Not for a preview: its
  // slides say nothing about where the scheduled lesson got to, and
  // previewMode is still set until onFinish() runs endPreview().
  if (!previewMode) clearResumePoint();
  if (show && typeof show.onFinish === 'function') show.onFinish();
}

function stopTeachingSlides() {
  clearTimeout(slideAutoTimer);
  slideAutoTimer = null;
  if (!slideshow) return;
  const show = slideshow;
  slideshow = null;
  slidesView.classList.add('hidden');
  slideImage.removeAttribute('src');
  slideTemplate.classList.add('hidden');
  slideTemplate.style.backgroundImage = '';
  slideTemplateBullets.textContent = '';
  slideTemplateBullets.style.fontSize = '';
  for (const pending of show.blobUrls.values()) {
    pending.then((u) => {
      if (typeof u === 'string' && u.startsWith('blob:')) URL.revokeObjectURL(u);
    }, () => {});
  }
}

// A slide image that can't load (never rendered, storage evicted, offline
// and uncached) skips ahead instead of leaving a black frame — bounded so a
// deck with nothing loadable ends instead of spinning.
slideImage.addEventListener('error', () => {
  if (!slideshow || slideImage.classList.contains('hidden')) return;
  const item = slideshow.items[slideshow.index];
  if (!item || item.type !== 'image') return; // a stale error for a slide we already left
  slideshow.errors += 1;
  if (slideshow.errors > slideshow.items.length) {
    finishTeachingSlides();
    return;
  }
  nextSlide();
});

slidePrevBtn.addEventListener('click', prevSlide);
slideNextBtn.addEventListener('click', () => {
  audioUnlocked = true;
  nextSlide();
});
// Tap/click the slide itself: left third steps back, the rest steps forward.
slideStage.addEventListener('click', (e) => {
  if (!slideshow) return;
  const rect = slideStage.getBoundingClientRect();
  if (e.clientX - rect.left < rect.width / 3) prevSlide();
  else nextSlide();
});

// Warm the lesson list + captions manifest at startup rather than on the
// first Settings press, and store lessons.json for offline use. Failure is
// fine — openSettingsPanel() retries and shows its own error state. (Kept at
// the very end of the script: it reads `allLessons`, a `let` that must be
// past its declaration before any call runs.)
loadAllLessons();
loadTeachingSlides();
// Small (~58KB) and only read when a leader presses "Read Prep" — but warmed
// here, because the whole point is that it opens on a dead connection. (A
// configure page never opens a prep itself: it relays the choice.)
if (!CONFIGURE_MODE) loadLeaderPrep();

