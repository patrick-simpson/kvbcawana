/* The phone remote's words and choices, with nothing to do with the page:
   which screen the readout follows, what it says, which sample answers fit
   the slide on the wall, and when a lesson pick needs a confirm tap. Pure
   (no DOM, no network), so test/remote-logic.test.mjs runs it as it is. */

/* The views in which a screen is showing a lesson (the readout prefers one). */
export const LESSON_VIEWS = ['video', 'slides', 'intro', 'splash'];
/* Views where a lesson is running: a pick there asks first. */
const RUNNING_VIEWS = ['video', 'slides', 'intro'];

const SLIDE_WORDS = {
  title: 'Title slide',
  verse: 'Verse',
  misconception: 'Misconception',
  illumination: 'Illumination',
  questions: 'Talk About It',
  template: '',
};

export const WAIT_WORDS = {
  captions: 'The screen is asking “Show captions?”. Someone at the screen has to answer it.',
  reader: 'A handout or Read Prep is open on the screen. Close it there first.',
  settings: 'Settings is open on the screen. Close it there first.',
  loading: 'The video is loading…',
};

export const REASON_WORDS = {
  'no-slides': 'No teaching slides are showing.',
  'first-slide': 'Already on the first slide.',
  'no-video': 'No video is showing.',
  already: 'It was already doing that.',
  starting: 'The lesson is still starting.',
  'not-splash': 'Begin works when the lesson’s start screen is showing.',
  'settings-open': WAIT_WORDS.settings,
  'reader-open': WAIT_WORDS.reader,
  'captions-question': WAIT_WORDS.captions,
  'lesson-running': 'A lesson is running, so nothing was replaced.',
  'unknown-week': 'That screen does not have that week.',
  'no-leader': 'That week has no Leader Video.',
  'lessons-loading': 'The screen was still loading its lesson list. Press again.',
  'sound-blocked': 'That screen’s browser blocks sound until someone taps the screen once.',
  configure: 'That window is a settings window, not a screen.',
  unknown: 'The screen could not do that.',
};

export const ACTION_WORDS = {
  'slide-next': 'Next',
  'slide-prev': 'Back',
  'slides-start': 'Start teaching slides',
  play: 'Play',
  pause: 'Pause',
  'toggle-pause': 'Play/Pause',
  seek: 'Skip',
  mute: 'Mute',
  unmute: 'Unmute',
  volume: 'Volume',
  begin: 'Begin lesson',
  pick: 'Lesson',
};

/* The six picker choices, as the kiosk's own picker names them. */
export const CHOICES = [
  { choice: 'student', label: 'Student video', leader: false },
  { choice: 'student-prep', label: 'Student Read Prep', leader: false },
  { choice: 'slides', label: 'Teaching slides', leader: false },
  { choice: 'leader', label: 'Leader video', leader: true },
  { choice: 'handout', label: 'Leader handout', leader: true },
  { choice: 'leader-prep', label: 'Leader Read Prep', leader: true },
];

/* The volume control's words and state for the report's video (or null: no
   video showing). `text` is what sits between the - and + buttons:
   "Volume 60%" (plus " · muted"); a kiosk too old to report a level just
   says "Volume". `down` / `up` say whether each button can do anything now
   (raising while muted still unmutes, so + stays on at 100% then). */
export function volumeView(video) {
  if (!video) return { text: 'Volume: no video', pct: null, down: false, up: false };
  const pct = Number.isFinite(video.volume) ? Math.max(0, Math.min(100, Math.round(video.volume))) : null;
  if (pct === null) return { text: video.muted ? 'Volume · muted' : 'Volume', pct, down: true, up: true };
  return {
    text: `Volume ${pct}%${video.muted ? ' · muted' : ''}`,
    pct,
    down: pct > 0,
    up: pct < 100 || video.muted === true,
  };
}

/* m:ss (or h:mm:ss) from seconds. */
export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/* Which screen the readout follows: the first online one showing a lesson,
   else the first online, else the first. null when there is none. */
export function pickKiosk(kiosks) {
  if (!Array.isArray(kiosks) || !kiosks.length) return null;
  const online = kiosks.filter((k) => k && k.online);
  return online.find((k) => k.now && LESSON_VIEWS.includes(k.now.view)) || online[0] || kiosks[0];
}

/* Where a playing video has got to: the report's position plus the time
   since the service received it (both on the SERVICE's clock). */
export function videoPosition(now, serverNowMs) {
  const v = now && now.video;
  if (!v) return 0;
  const at = Date.parse(now.at || '');
  const ran = !v.paused && Number.isFinite(at) && Number.isFinite(serverNowMs) ? Math.max(0, (serverNowMs - at) / 1000) : 0;
  const t = v.t + Math.min(ran, 30); // a report is never trusted to run on for long
  return v.d > 0 ? Math.min(t, v.d) : t;
}

function weekLine(now) {
  if (!now) return '';
  const week = Number.isInteger(now.week) ? `Week ${now.week}` : '';
  return [week, now.title || ''].filter(Boolean).join(' · ');
}

/* The readout: { kicker, main, sub, detail } in plain words. */
export function describeNow(kiosk, { serverNowMs } = {}) {
  if (!kiosk) return { kicker: 'On the screen now', main: 'No Journey screen yet', sub: 'Sign a Journey screen in with the passphrase (its Settings → Sync).', detail: '' };
  const now = kiosk.now;
  const kicker = now && now.preview ? 'On the screen now · picked lesson' : 'On the screen now';
  if (!kiosk.online && !now) return { kicker, main: 'Screen offline', sub: `${kiosk.name || 'The Journey screen'} has not checked in lately.`, detail: '' };
  if (!now) return { kicker, main: 'Asking the screen…', sub: 'Its first report arrives in a second or two.', detail: '' };
  const sub = weekLine(now);
  switch (now.view) {
    case 'slides': {
      const s = now.slide;
      if (!s) return { kicker, main: 'Teaching slides', sub, detail: '' };
      const label = s.kind === 'template' ? (s.heading || '') : SLIDE_WORDS[s.kind] || '';
      return { kicker, main: `Slides ${s.n} of ${s.of}`, sub, detail: label };
    }
    case 'video': {
      const v = now.video;
      if (!v) return { kicker, main: 'Video', sub, detail: '' };
      const t = formatTime(videoPosition(now, serverNowMs));
      const main = v.d > 0 ? `Video ${t} / ${formatTime(v.d)}` : `Video ${t}`;
      return { kicker, main, sub, detail: `${v.paused ? 'Paused' : 'Playing'}${v.muted ? ' · muted' : ''}` };
    }
    case 'splash':
      return { kicker, main: 'Ready to begin', sub, detail: now.resume ? `It can resume at ${formatTime(now.resume)}.` : 'Press Begin lesson.' };
    case 'intro':
      return { kicker, main: 'Lesson starting…', sub, detail: '' };
    case 'checkin':
      return { kicker, main: 'Check-in display', sub: '', detail: sub ? `Tonight: ${sub}` : '' };
    case 'trek':
      return { kicker, main: 'Trek card', sub: '', detail: '' };
    default:
      return { kicker, main: 'Journey screen', sub, detail: 'Nothing is playing.' };
  }
}

/* What the screen says about the last press, or ''. */
export function lastWords(now) {
  const l = now && now.last;
  if (!l) return '';
  const what = ACTION_WORDS[l.action] || 'Press';
  return l.ok ? `${what}: done ✓` : `${what} skipped: ${REASON_WORDS[l.reason] || REASON_WORDS.unknown}`;
}

/* Does a pick need the confirm tap (a lesson is up)? A screen waiting for a
   person (Settings, a handout / Read Prep, the caption question) skips every
   press, a confirmed pick too, so asking first there would only mislead. */
export function needsConfirm(now) {
  return Boolean(now && RUNNING_VIEWS.includes(now.view));
}

/* The Begin button's words: what the splash's primary button would do. */
export function beginWords(now) {
  return now && now.view === 'splash' && now.resume ? `Resume at ${formatTime(now.resume)}` : 'Begin lesson';
}

/* The sample answers that fit the questions slide on the wall, matched by
   EXACT question text for that week:
     null                     no answers to show (not the questions slide, no file, no week)
     { edited: true }         the screen's questions differ (edited there): hide them all
     { items: [{q, answer, scripture, at}] }  one per line on the wall, in its order */
export function answersFor(file, now) {
  if (!file || typeof file !== 'object' || !file.weeks || !now || now.view !== 'slides') return null;
  const s = now.slide;
  if (!s || s.kind !== 'questions' || !Array.isArray(s.lines) || !s.lines.length) return null;
  const list = file.weeks[String(now.week)];
  if (!Array.isArray(list) || !list.length) return null;
  const items = [];
  for (const line of s.lines) {
    const hit = list.find((a) => a && a.q === line);
    if (!hit) return { edited: true };
    items.push(hit);
  }
  return { items };
}

/* One sample-answers file, checked before anything of it is drawn: version 1,
   weeks of {q, answer, scripture|null, at|null}. null for anything else. */
export function cleanAnswersFile(raw) {
  if (!raw || typeof raw !== 'object' || raw.version !== 1 || !raw.weeks || typeof raw.weeks !== 'object') return null;
  const weeks = {};
  for (const [week, list] of Object.entries(raw.weeks)) {
    if (!/^\d{1,2}$/.test(week) || !Array.isArray(list)) continue;
    const ok = list.filter((a) => a && typeof a.q === 'string' && typeof a.answer === 'string'
      && (a.scripture === null || typeof a.scripture === 'string')
      && (a.at === null || (Number.isInteger(a.at) && a.at >= 0)))
      .map((a) => ({ q: a.q, answer: a.answer.slice(0, 400), scripture: a.scripture ? a.scripture.slice(0, 120) : null, at: a.at }));
    if (ok.length) weeks[week] = ok;
  }
  return { version: 1, weeks };
}

/* One short line per screen for the Screens strip. */
export function kioskLine(kiosk, opts) {
  if (!kiosk.online) return 'Offline';
  const d = describeNow(kiosk, opts);
  return [d.main, d.sub].filter(Boolean).join(' · ');
}
