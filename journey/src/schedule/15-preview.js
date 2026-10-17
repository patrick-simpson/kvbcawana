/* ── Manual video preview (Settings panel) ────────────────────────────
   Lets an operator browse every lesson in public/lessons.json and play
   any one of them right now — always a one-off: it never changes what
   the schedule above will automatically show at the next 6:30 PM, and
   never touches current-lesson.json. Plays Awana's original, falling
   back once to the lesson's 480p copy from videos/ on this site (see
   transcodedPreviewUrl below) if the original errors. Skips the Cache
   API: an occasional manual action doesn't need the nightly
   lesson's pre-caching machinery, it just needs a decodable file. Picking
   a lesson ALWAYS asks Leader or Student Video first (lessons with no
   Leader Video — week 27 — have that choice disabled); see the comment in
   onLessonPicked() for why this is deliberately unconditional. */

let pendingPreviewLesson = null;
// Set alongside each preview: the lesson's 480p copy, tried once if the
// original errors.
let previewFallbackUrl = null;
// The week of the lesson being previewed — the teaching slides shown after
// a preview video are that lesson's, not the scheduled one's.
let previewWeek = null;

// Every lesson (Student and Leader) has a 480p re-encode uploaded as a
// GitHub Release asset by scripts/transcode-all-lessons.mjs, the one-shot
// fallback when a picked original will not play. (Release asset URLs 302-redirect, which <video>
// follows fine; no crossorigin attribute means CORS never applies.)
// Since 2026-10-03 they are served from this site itself, under videos/ (the
// kvbcawana `journey-videos-v2` release, every file under 25 MiB, streamed by
// site/functions/journey with Range, so a video can seek), so they are
// same-origin like everything else here.
const TRANSCODED_VIDEO_BASE = 'videos/';

function transcodedPreviewUrl(week, variant) {
  return `${TRANSCODED_VIDEO_BASE}week-${String(week).padStart(2, '0')}-${variant}.mp4`;
}

/* lessons.json is a static file that changes ~never, yet an earlier version
   fetched it with {cache:'no-store'} at the moment the Settings gear was
   pressed — a forced network round-trip standing between the click and the
   panel's contents. Now it's cache-first: a good copy is kept in the Cache
   API (stored by fetchLessonsJson below, refreshed in the background), so
   after the first successful load ever, the lesson list works with the
   network fully dead. GitHub Pages' own max-age=600 means a plain fetch is
   at most 10 minutes stale, same as every other asset on the site. */
function adoptLessonsData(data) {
  if (!data || !Array.isArray(data.lessons)) return false;
  allLessons = data.lessons;
  buildCaptionManifest(allLessons);
  return true;
}

async function fetchLessonsJson() {
  const res = await fetchWithTimeout('lessons.json', {}, 5000);
  if (!res.ok) throw new Error(`lessons.json ${res.status}`);
  // Parse and shape-check BEFORE caching: a 200 carrying garbage (a truncated
  // deploy, a hand-edit typo) must never replace the known-good offline copy.
  const text = await res.text();
  const data = JSON.parse(text); // throws on invalid JSON
  if (!data || !Array.isArray(data.lessons)) throw new Error('lessons.json: unexpected shape');
  if ('caches' in window) {
    try {
      const cache = await caches.open(ASSET_CACHE_NAME);
      await cache.put(
        'lessons.json',
        new Response(text, { headers: { 'content-type': 'application/json' } })
      );
    } catch {
      // Not storable right now (quota, private mode) — still usable live.
    }
  }
  return data;
}

async function cachedLessonsJson() {
  if (!('caches' in window)) return null;
  try {
    const cache = await caches.open(ASSET_CACHE_NAME);
    const hit = await cache.match('lessons.json');
    return hit ? await hit.json() : null;
  } catch {
    return null;
  }
}

async function loadAllLessons() {
  if (allLessons) return allLessons;
  const cached = await cachedLessonsJson();
  if (cached && adoptLessonsData(cached)) {
    // Serve the cached copy instantly; revalidate quietly for next time.
    fetchLessonsJson().then(adoptLessonsData, () => {});
    return allLessons;
  }
  try {
    if (adoptLessonsData(await fetchLessonsJson())) return allLessons;
  } catch {
    // Offline with nothing cached yet — the caller shows the error state.
  }
  return null;
}

function renderLessonList(lessons) {
  settingsLessonList.textContent = '';
  for (const lesson of lessons.slice().sort((a, b) => a.week - b.week)) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'settings-lesson-row';
    row.setAttribute('role', 'option');
    if (currentLesson && currentLesson.week === lesson.week) {
      row.classList.add('settings-lesson-current');
    }
    const week = document.createElement('span');
    week.className = 'settings-lesson-week';
    week.textContent = `Week ${lesson.week}`;
    const title = document.createElement('span');
    title.textContent = lesson.title;
    row.append(week, title);
    row.addEventListener('click', () => onLessonPicked(lesson));
    settingsLessonList.appendChild(row);
  }
}

function onLessonPicked(lesson) {
  // Always ask Leader or Student — an earlier version skipped the question
  // inside the 6:30 lesson window (playing the Student Video directly, like
  // the scheduled show), but the two behaviors read as the picker being
  // flaky rather than as a deliberate rule ("it's not asking me
  // consistently" — reported from the live kiosk 2026-08-22). One
  // consistent extra click beats a clever inconsistency.
  pendingPreviewLesson = lesson;
  settingsVariantPrompt.textContent = `"${lesson.title}" — which video?`;
  // The deck is generated for every week, including 27, which has no Leader
  // Video, so this choice is never disabled.
  settingsVariantSlidesBtn.disabled = false;
  settingsVariantLeaderBtn.disabled = !lesson.leaderDownloadUrl;
  settingsLessonList.classList.add('hidden');
  settingsVariantPicker.classList.remove('hidden');
}

function resetSettingsPanelToList() {
  pendingPreviewLesson = null;
  settingsVariantPicker.classList.add('hidden');
  settingsStudentPicker.classList.add('hidden');
  settingsLeaderPicker.classList.add('hidden');
  settingsLessonList.classList.remove('hidden');
}

