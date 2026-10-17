/* ── The transcript inside Read Prep ──────────────────────────────────
   Below the summary, collapsed behind one button, every Read Prep carries
   that video's whole transcript in two versions:

     Edited       the readable prose the Leader Handout prints, and
     Exact words  the verbatim cue text from the caption .vtt.

   Both come from public/prep-transcripts/week-NN-<role>.json, built by
   scripts/build-prep-transcripts.mjs from data/<role>-transcript-prose.json
   and that week's VTT. One file per week per role, because leader-prep.json
   is warmed at startup for all 31 weeks and a transcript is tens of KB: it
   is fetched only when a leader actually expands one.

   Which version the leader last chose is a per-device preference, read with
   the same try/catch shape as the caption prefs (kiosk Chromium can throw on
   localStorage rather than returning null).

   Every paragraph carries the start time of its first cue, shown as a
   tappable timestamp: pressing it closes the overlay and starts THAT video
   at that moment, through the same preview path the picker uses. */
const PREP_TRANSCRIPT_MODE_KEY = 'journey.prep.transcriptMode';

function prepTranscriptUrl(week, role) {
  return `prep-transcripts/week-${String(week).padStart(2, '0')}-${role}.json`;
}

function storedPrepTranscriptMode() {
  try {
    return localStorage.getItem(PREP_TRANSCRIPT_MODE_KEY) === 'exact' ? 'exact' : 'edited';
  } catch {
    return 'edited';
  }
}

function storePrepTranscriptMode(mode) {
  try {
    localStorage.setItem(PREP_TRANSCRIPT_MODE_KEY, mode);
  } catch {
    // The choice just won't survive a reload. Nothing else depends on it.
  }
}

let prepTranscriptMode = storedPrepTranscriptMode();

// url -> parsed transcript. Only successes are remembered: memoizing a
// failure would leave a 24/7 kiosk unable to ever load that transcript again
// after one bad evening, the same reason captionsAvailable() only caches
// positive probes.
const prepTranscripts = new Map();

function validPrepTranscript(data) {
  return !!data && typeof data === 'object' && Array.isArray(data.paragraphs);
}

async function loadPrepTranscript(url) {
  const known = prepTranscripts.get(url);
  if (known) return known;
  // caches.match() searches every bucket, so the current week's copy is found
  // whether it arrived with the prefetched bundle (journey-videos-v1) or was
  // stored below after an on-demand fetch for some other week.
  if ('caches' in window) {
    try {
      const hit = await caches.match(url);
      if (hit) {
        const cached = await hit.json();
        if (validPrepTranscript(cached)) {
          prepTranscripts.set(url, cached);
          return cached;
        }
      }
    } catch {
      // fall through to the network
    }
  }
  try {
    const res = await fetchWithTimeout(url, {}, 5000);
    if (!res.ok) throw new Error(`${url} ${res.status}`);
    // Parse and shape-check BEFORE caching, like lessons.json: a 200 carrying
    // a truncated deploy must never become this device's offline copy.
    const text = await res.text();
    const data = JSON.parse(text);
    if (!validPrepTranscript(data)) throw new Error(`${url}: unexpected shape`);
    prepTranscripts.set(url, data);
    if ('caches' in window) {
      try {
        const cache = await caches.open(ASSET_CACHE_NAME);
        await cache.put(url, new Response(text, { headers: { 'content-type': 'application/json' } }));
      } catch {
        // Not storable right now, still usable live.
      }
    }
    return data;
  } catch (err) {
    console.warn('Journey: transcript unavailable', url, err);
    return null;
  }
}

/* Start the video this transcript belongs to, at this paragraph.
   Acknowledge-first: closePrep() and requestPlayback()'s reveal both happen
   synchronously, so the screen has changed before anything is fetched. */
function startPrepAt(lesson, role, seconds) {
  audioUnlocked = true; // a real press, so the video may start with sound
  closePrep();
  if (role === 'leader') {
    if (!lesson.leaderDownloadUrl) return;
    requestPlayback(captionUrlFor(lesson.week, 'leader'), () => playLeaderPreview(lesson, seconds));
    return;
  }
  requestPlayback(captionUrlFor(lesson.week, 'student'), () => playStudentPreview(lesson, seconds));
}

function renderPrepParagraphs(container, data, lesson, role) {
  container.textContent = '';
  for (const para of data.paragraphs) {
    if (para.heading) {
      const h = document.createElement('h4');
      h.className = 'prep-para-heading';
      h.textContent = para.heading;
      container.appendChild(h);
    }
    const p = document.createElement('p');
    p.className = 'prep-para';
    const stamp = document.createElement('button');
    stamp.type = 'button';
    stamp.className = 'prep-time';
    stamp.textContent = formatTime(para.t);
    stamp.setAttribute('aria-label', `Play this video from ${formatTime(para.t)}`);
    stamp.addEventListener('click', () => startPrepAt(lesson, role, para.t));
    const text = document.createElement('span');
    text.className = 'prep-para-text';
    text.textContent = prepTranscriptMode === 'exact' ? para.exact : para.edited;
    p.append(stamp, text);
    container.appendChild(p);
  }
}

/* Edited / Exact words. Both versions of every paragraph are already in the
   one JSON, so switching repaints from memory and never fetches. */
function buildPrepModeRow(lesson, role, container) {
  const row = document.createElement('div');
  row.className = 'prep-transcript-modes';
  const label = document.createElement('span');
  label.className = 'prep-modes-label';
  label.textContent = 'Version';
  row.appendChild(label);
  const buttons = [];
  for (const [mode, text] of [
    ['edited', 'Edited'],
    ['exact', 'Exact words'],
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'prep-mode-btn';
    button.textContent = text;
    button.setAttribute('aria-pressed', String(prepTranscriptMode === mode));
    button.addEventListener('click', () => {
      prepTranscriptMode = mode;
      storePrepTranscriptMode(mode);
      for (const other of buttons) other.el.setAttribute('aria-pressed', String(other.mode === mode));
      const data = prepTranscripts.get(prepTranscriptUrl(lesson.week, role));
      if (data) renderPrepParagraphs(container, data, lesson, role);
    });
    buttons.push({ mode, el: button });
    row.appendChild(button);
  }
  return row;
}

/* `reveal` is false when the transcript is open from the start (the Student
   Prep), where scrolling would hide the top of the overlay nobody asked to
   leave. It is true when a leader pressed the button. */
function expandPrepTranscript(lesson, role, toggle, panel, scrolls = true) {
  const requestId = prepRequestId; // the overlay open this expansion belongs to
  toggle.setAttribute('aria-expanded', 'true');
  toggle.textContent = 'Hide the full transcript';
  panel.classList.remove('hidden');
  panel.textContent = '';
  // The header row and the mode toggle are built now, with nothing awaited:
  // pressing the button has to change the screen this frame.
  const paragraphs = document.createElement('div');
  paragraphs.className = 'prep-paras';
  panel.append(buildPrepModeRow(lesson, role, paragraphs), paragraphs);
  // Put the section the leader just opened at the top of the overlay: the
  // button sits under a screen of summary, so without this the paragraphs
  // appear entirely below the fold. Run once now (the press is acknowledged
  // whether or not a transcript arrives) and again once the paragraphs are
  // in, because until then there is nothing below to scroll up against.
  // Guarded: it is the one call here a non-browser DOM may not implement.
  const reveal = () => {
    if (scrolls && typeof toggle.scrollIntoView === 'function') toggle.scrollIntoView(true);
  };
  reveal();
  const url = prepTranscriptUrl(lesson.week, role);
  const inMemory = prepTranscripts.get(url);
  if (inMemory) {
    renderPrepParagraphs(paragraphs, inMemory, lesson, role);
    reveal();
    return;
  }
  const loading = document.createElement('p');
  loading.className = 'prep-note';
  loading.textContent = 'Loading transcript…';
  paragraphs.appendChild(loading);
  loadPrepTranscript(url).then((data) => {
    // Closed, reopened on another week, or collapsed while the fetch was in
    // flight: paint nothing rather than into a panel nobody is looking at.
    if (requestId !== prepRequestId || !paragraphs.isConnected) return;
    if (!data) {
      paragraphs.textContent = '';
      const failed = document.createElement('p');
      failed.className = 'prep-note';
      failed.textContent =
        'The transcript hasn’t downloaded to this device yet. Check the kiosk’s internet connection, then try again.';
      paragraphs.appendChild(failed);
      return;
    }
    renderPrepParagraphs(paragraphs, data, lesson, role);
    reveal();
  });
}

function appendPrepTranscript(lesson, role, startExpanded) {
  // Week 27 has no Leader Video, so there is no leader transcript to offer.
  if (role === 'leader' && !lesson.leaderDownloadUrl) return;
  const section = document.createElement('section');
  section.className = 'prep-transcript';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'prep-transcript-toggle';
  toggle.textContent = 'Read the full transcript';
  toggle.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('div');
  panel.className = 'prep-transcript-body hidden';
  section.append(toggle, panel);
  prepBody.appendChild(section);
  toggle.addEventListener('click', () => {
    if (toggle.getAttribute('aria-expanded') === 'true') {
      toggle.setAttribute('aria-expanded', 'false');
      toggle.textContent = 'Read the full transcript';
      panel.classList.add('hidden');
      panel.textContent = ''; // a screen of paragraphs has no reason to stay in the DOM
      return;
    }
    expandPrepTranscript(lesson, role, toggle, panel);
  });
  if (startExpanded) expandPrepTranscript(lesson, role, toggle, panel, false);
}


function prepNote(message) {
  prepBody.textContent = '';
  const p = document.createElement('p');
  p.className = 'prep-note';
  p.textContent = message;
  prepBody.appendChild(p);
}

function prepSection(heading, build) {
  const section = document.createElement('section');
  const h = document.createElement('h3');
  h.textContent = heading;
  section.appendChild(h);
  section.appendChild(build());
  prepBody.appendChild(section);
}

// leader-prep.json v2 carries two question sets: the leader's own reflection
// ("For you") and what the leader asks the students ("Ask your group", may be
// empty). A v1 copy still sitting in the asset cache has one plain list,
// which was always the leader's own questions: read it as "For you" until
// the quiet revalidate replaces it.
function prepQuestionSets(questions) {
  const clean = (list) => (Array.isArray(list) ? list.filter((q) => typeof q === 'string' && q.trim()) : []);
  if (Array.isArray(questions)) return { forYou: clean(questions), forGroup: [] };
  if (!questions || typeof questions !== 'object') return { forYou: [], forGroup: [] };
  return { forYou: clean(questions.forYou), forGroup: clean(questions.forGroup) };
}

function renderPrep(lesson, role = 'leader') {
  // The Student Prep has no summary to show: the Big Idea / Key Points /
  // Scripture / Questions are written from the LEADER Video, so putting them
  // here would credit the wrong video. It is the transcript, open already.
  if (role === 'student') {
    prepNote('The Student Video, written out. Summaries live under the Leader Video’s prep.');
    appendPrepTranscript(lesson, role, true);
    return;
  }
  const entry = leaderPrepFor(lesson.week);
  if (!entry) {
    prepNote(
      leaderPrepFailed
        ? 'The leader prep hasn’t downloaded to this device yet — check the kiosk’s internet connection, then try again.'
        : `There’s no leader prep for week ${lesson.week}. (Week 27 has no Leader Video, so it has no summary.)`
    );
    appendPrepTranscript(lesson, role, false);
    return;
  }
  prepBody.textContent = '';
  if (entry.bigIdea) {
    prepSection('Big Idea', () => {
      const p = document.createElement('p');
      p.textContent = entry.bigIdea;
      return p;
    });
  }
  if (Array.isArray(entry.keyPoints) && entry.keyPoints.length) {
    prepSection('Key Points from the Leader Video', () => {
      const ul = document.createElement('ul');
      for (const point of entry.keyPoints) {
        const li = document.createElement('li');
        li.textContent = point;
        ul.appendChild(li);
      }
      return ul;
    });
  }
  if (Array.isArray(entry.scriptures) && entry.scriptures.length) {
    prepSection('Scripture', () => {
      const p = document.createElement('p');
      p.className = 'prep-scripture';
      p.textContent = entry.scriptures.join(' • ');
      return p;
    });
  }
  const sets = prepQuestionSets(entry.questions);
  for (const [heading, questions] of [
    ['For you', sets.forYou],
    ['Ask your group', sets.forGroup],
  ]) {
    if (!questions.length) continue;
    prepSection(heading, () => {
      const ol = document.createElement('ol');
      for (const question of questions) {
        const li = document.createElement('li');
        li.textContent = question;
        ol.appendChild(li);
      }
      return ol;
    });
  }
  appendPrepTranscript(lesson, role, false);
  const footer = document.createElement('p');
  footer.className = 'prep-footer';
  footer.textContent =
    'Summary of this week’s Leader Video, for this church’s Awana® leaders — internal ministry use only.';
  prepBody.appendChild(footer);
}

function openPrep(lesson, role = 'leader') {
  const requestId = ++prepRequestId;
  // Everything visible happens now; the JSON (if it isn't in memory yet) is
  // waited on behind an on-screen note, never in front of the overlay.
  const label = role === 'student' ? 'Student Prep' : 'Leader Prep';
  prepTitle.textContent = `Week ${lesson.week} — ${lesson.title} (${label})`;
  prepView.classList.remove('hidden');
  prepCloseBtn.focus();
  // A Student Prep never reads leader-prep.json, so it never waits on it.
  if (role === 'student' || leaderPrep) {
    renderPrep(lesson, role);
    return;
  }
  prepNote('Loading the leader prep…');
  loadLeaderPrep().then(() => {
    if (requestId !== prepRequestId) return; // closed, or reopened on another week
    renderPrep(lesson, role);
  });
}

function closePrep() {
  ++prepRequestId; // abandon any still-resolving open
  prepView.classList.add('hidden');
  prepBody.textContent = ''; // don't keep a screen of DOM around for the other 23 hours
  prepBody.scrollTop = 0;
}

prepCloseBtn.addEventListener('click', closePrep);

// Both full-screen reading overlays sit above everything else, so the
// playback and settings shortcuts must stay inert while either is up.
function readerOverlayOpen() {
  return !handoutView.classList.contains('hidden') || !prepView.classList.contains('hidden');
}

function openSettingsPanel() {
  audioUnlocked = true;
  resetSettingsPanelToList();
  // The panel appears the instant the gear is pressed — an earlier version
  // awaited lessons.json first, so on a hung request the gear looked broken
  // (nothing on screen, ever). The list fills in when the data arrives, from
  // the Cache API when the network can't answer.
  // The bullet editor starts collapsed on every open (it is a rarely-used
  // detour, not the panel's main job), but its badge is refreshed so an
  // override on this device is visible without opening anything.
  notesEditBody.classList.add('hidden');
  notesEditToggle.setAttribute('aria-expanded', 'false');
  updateNotesEditedBadge();
  settingsPanel.classList.remove('hidden');
  // "Lessons on this computer" (26-lesson-downloads.js): reads the disk in
  // the background, never the network first. A microtask later, because the
  // configure page opens the panel while schedule.js is still running, before
  // that file's own state exists.
  Promise.resolve().then(refreshDownloadsPanel);
  if (allLessons) {
    renderLessonList(allLessons);
    return;
  }
  settingsLessonList.textContent = '';
  const note = document.createElement('p');
  note.className = 'settings-list-note';
  note.textContent = 'Loading lesson list…';
  settingsLessonList.appendChild(note);
  loadAllLessons().then((lessons) => {
    if (settingsPanel.classList.contains('hidden')) return; // closed meanwhile
    if (lessons) {
      // Only replace the loading note if the list hasn't already been
      // rendered by a faster concurrent open.
      if (note.isConnected) renderLessonList(lessons);
    } else {
      note.textContent = CONFIGURE_MODE
        ? 'The lesson list couldn’t load. Check this computer’s internet connection, then reopen this window.'
        : 'The lesson list couldn’t load — check the kiosk’s internet connection, then close and reopen this panel.';
    }
  });
}

function closeSettingsPanel() {
  // The configure page is the panel and nothing else: there is nothing
  // behind it to close onto. (The bullet editor's own debounce and its
  // collapse still save what was typed.)
  if (CONFIGURE_MODE) return;
  // Commit anything typed into the bullet editor first: the panel closes on
  // Escape or a backdrop click without the textarea ever blurring, so the
  // debounced save may still be pending.
  if (!notesEditBody.classList.contains('hidden')) saveNotesEditor();
  settingsPanel.classList.add('hidden');
}

function startPreview(url, title, fallbackUrl = null, week = null) {
  ++journeyRequestToken; // invalidate any in-flight showJourneyContent() call
  cancelLessonIntro();
  stopTeachingSlides();
  previewMode = true;
  playingWeek = null; // a preview is never the scheduled show's resume point
  previewFallbackUrl = fallbackUrl;
  previewWeek = week;
  journeyView.classList.remove('hidden');
  checkinView.classList.add('hidden');
  trekView.classList.add('hidden'); // a lesson or preview over Trek's card takes the screen
  journeyPlaceholder.classList.add('hidden');
  // The splash may be up when a preview starts (picking a lesson while the
  // scheduled window's "Large Group Time" screen is showing) — hide it, or
  // it sits on top of the video. playCurrentLesson() does the same.
  journeySplash.classList.add('hidden');
  journeyVideo.classList.remove('hidden');
  videoControls.classList.remove('hidden');
  showVideoLoading();
  journeyVideo.loop = false;
  setMuted(!audioUnlocked);
  journeyVideo.src = url;
  applyCaptions();
  journeyVideo.play().catch(() => {
    if (!journeyVideo.muted) {
      setMuted(true);
      journeyVideo.play().catch(() => {});
    }
  });
  console.log(`Journey: previewing "${title}"`);
}

function endPreview() {
  if (!previewMode) return;
  previewMode = false;
  previewFallbackUrl = null;
  previewWeek = null;
  // Tear the preview's video down before handing the view back. Without
  // this, ending a preview inside the 6:30 lesson window left the finished
  // video element visible, which made showJourneyContent() early-return
  // (it sees "playback in progress") instead of re-showing the splash.
  stopJourneyContent();
  setView(scheduledPhase());
}

settingsBtn.addEventListener('click', () => {
  audioUnlocked = true;
  openSettingsPanel();
});

settingsCloseBtn.addEventListener('click', closeSettingsPanel);
settingsBackdrop.addEventListener('click', closeSettingsPanel);

settingsVariantBackBtn.addEventListener('click', resetSettingsPanelToList);

/* The picker's third choice: that week's teaching slides on their own, with
   no video at all. It is a preview like any other pick, so previewMode holds
   off the 15s scheduler poll and the hourly refresh, Finish runs endPreview()
   and the ⇄ button tears it down through stopJourneyContent(). previewWeek is
   set for the same reason a video preview sets it: the deck on screen is that
   lesson's, not the scheduled one's. */
function startSlidesPreview(week) {
  ++journeyRequestToken; // invalidate any in-flight playback request
  previewMode = true;
  previewFallbackUrl = null;
  previewWeek = week;
  playingWeek = null; // a preview is never the scheduled show's resume point
  if (startTeachingSlides(week, endPreview)) {
    console.log(`Journey: previewing week ${week} teaching slides`);
    return true;
  }
  // Nothing to show: hand control straight back rather than sitting in a
  // preview with an empty stage.
  previewMode = false;
  previewWeek = null;
  setView(scheduledPhase());
  return false;
}

settingsVariantSlidesBtn.addEventListener('click', () => {
  if (!pendingPreviewLesson) return;
  runPickerChoice('slides', pendingPreviewLesson);
});

/* Both roles' previews live in one function each, because the Read Prep
   overlay's timestamps start the same videos the picker does. `seekTo` is
   the second to open at: it is armed as pendingSeek only AFTER
   startPreview() has bumped journeyRequestToken, so the one permanent
   'loadedmetadata' listener applies it and a superseded request can never
   drop its seek onto a newer video. 0 means "from the top", which also
   clears any mark an abandoned request left behind. */
function armPreviewSeek(seconds) {
  pendingSeek = seconds > 0 ? { token: journeyRequestToken, t: seconds } : null;
}

/* Which file a picked video plays, and what it falls back to once if that
   errors: Awana's original, with the 480p Release copy as the spare (the
   Release copy alone when there is no original). Neither is cached: a Release asset's redirect hop carries no CORS
   header, and an occasional manual pick does not need the nightly bundle's
   machinery, it just needs a file that plays. */
function previewSources(week, variant, originalUrl) {
  const release = transcodedPreviewUrl(week, variant);
  return originalUrl
    ? { url: originalUrl, fallback: release }
    : { url: release, fallback: null };
}

async function playStudentPreview(lesson, seekTo = 0) {
  // The current week's Student Video is the one already pre-downloaded for
  // the 6:30 show, so play the local copy instead of re-streaming it: a
  // same-week preview works with the network dead. (resolveVideoSrc() takes
  // a saved copy first, then the stream, then the bundle.)
  const sameWeek = !!currentLesson && currentLesson.week === lesson.week;
  if (sameWeek) {
    const token = journeyRequestToken;
    const src = await resolveVideoSrc(currentLesson, token);
    if (!src || token !== journeyRequestToken) return; // torn down while reading the cache
    startPreview(
      src,
      `${lesson.title} (Student Video)`,
      transcodedPreviewUrl(lesson.week, 'student'),
      lesson.week
    );
    armPreviewSeek(seekTo);
    return;
  }
  await playSavedOrStreamedPreview(lesson, 'student', 'Student Video', lesson.downloadUrl, seekTo);
}

function playLeaderPreview(lesson, seekTo = 0) {
  return playSavedOrStreamedPreview(lesson, 'leader', 'Leader Video', lesson.leaderDownloadUrl, seekTo);
}

/* Any other picked video: the copy saved on this computer when there is one
   (Settings "Download all lessons"), else Awana's original streamed, with the
   480p Release copy as the one spare either way. A saved copy that will not
   play goes to the original first (fallBackFromSavedCopy()), then the spare.
   The saved-copy lookup is a local disk read, never the network. */
async function playSavedOrStreamedPreview(lesson, role, label, originalUrl, seekTo) {
  const token = journeyRequestToken;
  const saved = await savedLessonObjectUrl(lesson.week, role, token, originalUrl);
  if (token !== journeyRequestToken) return; // something newer took over
  const { url, fallback } = previewSources(lesson.week, role, originalUrl);
  if (saved) {
    startPreview(saved, `${lesson.title} (${label})`, transcodedPreviewUrl(lesson.week, role), lesson.week);
  } else {
    startPreview(url, `${lesson.title} (${label})`, fallback, lesson.week);
  }
  armPreviewSeek(seekTo);
}

// Student is a two-step choice now too: the Student Video's transcript is
// readable in Read Prep, so "which video?" is followed by "video or prep?"
// on both sides rather than only the Leader's.
settingsVariantStudentBtn.addEventListener('click', () => {
  if (!pendingPreviewLesson) return;
  settingsStudentPrompt.textContent = `"${pendingPreviewLesson.title}" (Student): video or prep?`;
  settingsVariantPicker.classList.add('hidden');
  settingsStudentPicker.classList.remove('hidden');
});

settingsStudentVideoBtn.addEventListener('click', () => {
  if (!pendingPreviewLesson) return;
  runPickerChoice('student', pendingPreviewLesson);
});

settingsStudentPrepBtn.addEventListener('click', () => {
  if (!pendingPreviewLesson) return;
  runPickerChoice('student-prep', pendingPreviewLesson);
});

settingsStudentBackBtn.addEventListener('click', () => {
  settingsStudentPicker.classList.add('hidden');
  settingsVariantPicker.classList.remove('hidden');
});

// Leader is a two-step choice: first Leader vs Student, then Video vs
// Handout (the one-page summary PDF generated from the Leader Video's
// transcript).
settingsVariantLeaderBtn.addEventListener('click', () => {
  if (!pendingPreviewLesson || !pendingPreviewLesson.leaderDownloadUrl) return;
  settingsLeaderPrompt.textContent = `"${pendingPreviewLesson.title}" (Leader) — video, handout, or prep?`;
  settingsVariantPicker.classList.add('hidden');
  settingsLeaderPicker.classList.remove('hidden');
});

settingsLeaderVideoBtn.addEventListener('click', () => {
  if (!pendingPreviewLesson || !pendingPreviewLesson.leaderDownloadUrl) return;
  runPickerChoice('leader', pendingPreviewLesson);
});

settingsLeaderHandoutBtn.addEventListener('click', () => {
  if (!pendingPreviewLesson) return;
  runPickerChoice('handout', pendingPreviewLesson);
});

settingsLeaderPrepBtn.addEventListener('click', () => {
  if (!pendingPreviewLesson) return;
  runPickerChoice('leader-prep', pendingPreviewLesson);
});

settingsLeaderBackBtn.addEventListener('click', () => {
  settingsLeaderPicker.classList.add('hidden');
  settingsVariantPicker.classList.remove('hidden');
});

