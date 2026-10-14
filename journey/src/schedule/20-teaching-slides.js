/* ── Teaching slides (after the lesson video) ─────────────────────────
   Each Advocates lesson ships a 5-slide "Teaching Slides" deck on the
   course page: title, core verse, misconception, illumination, and a
   blank TEMPLATE (heading + three empty bullets) for the leader to fill.
   scripts/render-teaching-slides.py renders slides 1-4 of every week into
   public/slides/week-NN/slide-N.jpg and extracts the template's bare
   background as template.jpg; public/teaching-slides.json carries the deck
   metadata plus, per week, the three generated "fills" for that template
   (Talk About It / Remember This / This Week), written from the week's
   Leader Video transcript and rendered here as HTML text over the
   background so they stay crisp and editable.

   When any lesson video ends — the scheduled show or a picker preview —
   startTeachingSlides() takes over the Journey layer: the deck's slides,
   then whichever generated slides Settings has ticked. A leader drives it
   (Space / → / Enter next, ← back, tap the slide, or the Prev/Next bar);
   an optional auto-advance interval from Settings ticks it along too, and
   any manual step resets that timer. "Finish" on the last slide (or the
   auto-advance running off the end) hands control to whatever the video's
   own ending used to do: back to the Check-in Display for the scheduled
   show, endPreview() for a preview. The ⇄ button and the 7:15 boundary tear
   the slideshow down through stopJourneyContent() like everything else.

   Preferences live in localStorage (per device, like the caption choice):
   journey.slides.autoAdvanceSec (0 = manual) and journey.slides.extras
   ({questions, takeaways, challenges} booleans, all on by default). */
const TEACHING_SLIDES_URL = 'teaching-slides.json';
const DECK_SLIDE_COUNT_DEFAULT = 4; // every Advocates deck has 4 slides + the template
const SLIDES_AUTO_KEY = 'journey.slides.autoAdvanceSec';
const SLIDES_EXTRAS_KEY = 'journey.slides.extras';
const SLIDE_EXTRA_KINDS = ['questions', 'takeaways', 'challenges'];
const SLIDE_HEADINGS_DEFAULT = {
  questions: 'Talk About It',
  takeaways: 'Remember This',
  challenges: 'This Week',
};


function weekTag(week) {
  return `week-${String(week).padStart(2, '0')}`;
}

// Awana's own decks for lessons 2-2 (Monotheism) and 2-4 (Naturalism) were
// published swapped; weeks 6 and 8 hold the right pictures since 2026-10-14.
// A kiosk keys saved pictures by address and never re-fetches one it has, so
// these two weeks carry a revision in the address: an old copy is never reused.
const SLIDE_REVISIONS = { 6: 2, 8: 2 };

function slideRevision(week) {
  return SLIDE_REVISIONS[week] ? `?r=${SLIDE_REVISIONS[week]}` : '';
}

function slideImageUrl(week, n) {
  return `slides/${weekTag(week)}/slide-${n}.jpg${slideRevision(week)}`;
}

function slideTemplateUrl(week) {
  return `slides/${weekTag(week)}/template.jpg${slideRevision(week)}`;
}

function teachingSlidesFor(week) {
  const weeks = teachingSlides && teachingSlides.weeks;
  return (weeks && weeks[String(week)]) || null;
}

function deckSlideCount(week) {
  const w = teachingSlidesFor(week);
  return w && Number.isInteger(w.slides) && w.slides > 0 ? w.slides : DECK_SLIDE_COUNT_DEFAULT;
}

// Same cache-first shape as lessons.json (see loadAllLessons): a good copy
// is kept in the assets cache so the slide fills work with the network dead.
function adoptTeachingSlides(data) {
  if (!data || typeof data !== 'object' || !data.weeks || typeof data.weeks !== 'object') return false;
  teachingSlides = data;
  return true;
}

async function fetchTeachingSlidesJson() {
  const res = await fetchWithTimeout(TEACHING_SLIDES_URL, {}, 5000);
  if (!res.ok) throw new Error(`${TEACHING_SLIDES_URL} ${res.status}`);
  const text = await res.text();
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || !data.weeks) throw new Error(`${TEACHING_SLIDES_URL}: unexpected shape`);
  if ('caches' in window) {
    try {
      const cache = await caches.open(ASSET_CACHE_NAME);
      await cache.put(TEACHING_SLIDES_URL, new Response(text, { headers: { 'content-type': 'application/json' } }));
    } catch {
      // Not storable right now — still usable live.
    }
  }
  return data;
}

async function loadTeachingSlides() {
  if (teachingSlides) return teachingSlides;
  if ('caches' in window) {
    try {
      const cache = await caches.open(ASSET_CACHE_NAME);
      const hit = await cache.match(TEACHING_SLIDES_URL);
      if (hit && adoptTeachingSlides(await hit.json())) {
        fetchTeachingSlidesJson().then(adoptTeachingSlides, () => {});
        return teachingSlides;
      }
    } catch {
      // fall through to the network
    }
  }
  try {
    adoptTeachingSlides(await fetchTeachingSlidesJson());
  } catch (err) {
    console.warn('Journey: teaching-slides.json unavailable —', err);
  }
  return teachingSlides;
}

function slidesAutoAdvanceSec() {
  try {
    const v = Number(localStorage.getItem(SLIDES_AUTO_KEY));
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

function slidesExtras() {
  const extras = { questions: true, takeaways: true, challenges: true };
  try {
    const stored = JSON.parse(localStorage.getItem(SLIDES_EXTRAS_KEY) || 'null');
    if (stored && typeof stored === 'object') {
      for (const k of SLIDE_EXTRA_KINDS) if (typeof stored[k] === 'boolean') extras[k] = stored[k];
    }
  } catch {
    // unreadable → defaults
  }
  return extras;
}

function storeSlidesPrefs() {
  try {
    localStorage.setItem(SLIDES_AUTO_KEY, String(Number(slidesAutoAdvanceSelect.value) || 0));
    const extras = {};
    for (const k of SLIDE_EXTRA_KINDS) extras[k] = slidesExtraInputs[k].checked;
    localStorage.setItem(SLIDES_EXTRAS_KEY, JSON.stringify(extras));
  } catch {
    // Preference just won't survive a reload. Fine.
  }
}

function syncSlidesPrefInputs() {
  const sec = String(slidesAutoAdvanceSec());
  slidesAutoAdvanceSelect.value = Array.from(slidesAutoAdvanceSelect.options).some((o) => o.value === sec) ? sec : '0';
  const extras = slidesExtras();
  for (const k of SLIDE_EXTRA_KINDS) slidesExtraInputs[k].checked = extras[k];
}

syncSlidesPrefInputs();
slidesAutoAdvanceSelect.addEventListener('change', storeSlidesPrefs);
for (const k of SLIDE_EXTRA_KINDS) {
  slidesExtraInputs[k].addEventListener('change', storeSlidesPrefs);
  // The bullet editor labels each kind with whether it's actually shown.
  slidesExtraInputs[k].addEventListener('change', () => {
    if (!notesEditBody.classList.contains('hidden')) renderNotesEditor();
  });
}

