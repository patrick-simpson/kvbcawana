// Daily schedule: full-screen the Awana Check-in Display all day, except
// between JOURNEY_START and JOURNEY_END, when the Journey lesson video
// shows. See CLAUDE.md for the conventions around changing these
// constants, and for how the video content itself gets here.
const JOURNEY_START_MINUTES = 18 * 60 + 30; // 6:30 PM
const JOURNEY_END_MINUTES = 19 * 60 + 15; // 7:15 PM
// Club nights only (the lobby's rule, lobby/shared/clubNight.js): Trek's small
// group time, a full-screen title card from 7:00 to 7:30 PM. It takes the
// Journey window's last quarter hour on those nights, but never cuts a lesson
// that is still running (see 25-trek.js).
const TREK_START_MINUTES = 19 * 60; // 7:00 PM
const TREK_END_MINUTES = 19 * 60 + 30; // 7:30 PM
const POLL_INTERVAL_MS = 15000;
const LESSON_REFRESH_MS = 60 * 60 * 1000; // current-lesson.json only changes nightly
const VIDEO_CACHE_NAME = 'journey-videos-v1';
// Small same-origin documents (lessons.json) that make the UI answerable
// offline — kept separate from the video bucket, whose eviction logic
// deliberately clears everything but the current week's bundle.
const ASSET_CACHE_NAME = 'journey-assets-v1';

// fetch() has no timeout of its own: on the kiosk's flaky connection a hung
// request can sit unresolved for minutes, which is how "you click buttons and
// it doesn't respond" happened. Anything the UI is (indirectly) waiting on
// goes through this instead. AbortController is feature-checked because this
// runs on an oldish kiosk Chromium.
function fetchWithTimeout(url, options, timeoutMs) {
  if (typeof AbortController === 'undefined') return fetch(url, options);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

/* Configure mode (`?configure=1`, exactly '1'): the sound room app's Settings
   window loads this page beside the live kiosk, in the same browser profile,
   and here the page is ONLY the Settings panel. Nothing of the kiosk runs:
   no schedule, no video, no splash, no bundle download, no wake lock, no
   self-update, and the Check-in Display frame is removed by index.html before
   it can load. What the panel saves goes to localStorage, which the live
   kiosk picks up through its storage listener; what the panel would DO to
   the screen (play a lesson, open a handout or a prep) is relayed to the
   live kiosk instead (relayToKiosk / handleConfigureRelay below). The same
   protocol as the lobby's (lobby/src/lib/configureRelay.js). */
const CONFIGURE_MODE = (() => {
  try {
    return new URLSearchParams(window.location.search).get('configure') === '1';
  } catch {
    return false;
  }
})();
const CONFIGURE_CHANNEL = 'awana-configure';
if (CONFIGURE_MODE) document.documentElement.classList.add('configure-mode');

const checkinView = document.getElementById('checkin-view');
const checkinFrame = document.getElementById('checkin-frame');
const journeyView = document.getElementById('journey-view');
const journeyPlaceholder = document.getElementById('journey-placeholder');
const journeySplash = document.getElementById('journey-splash');
const journeySplashWeek = document.getElementById('journey-splash-week');
const journeySplashTitle = document.getElementById('journey-splash-title');
const journeySplashPlayBtn = document.getElementById('journey-splash-play-btn');
const journeySplashResumeBtn = document.getElementById('journey-splash-resume-btn');
const journeySplashResumeLabel = document.getElementById('journey-splash-resume-label');
const journeySplashStartOverBtn = document.getElementById('journey-splash-startover-btn');
const journeySplashSlidesBtn = document.getElementById('journey-splash-slides-btn');
const journeySplashQuality = document.getElementById('journey-splash-quality');
const journeyVideo = document.getElementById('journey-video');
const journeyLoading = document.getElementById('journey-loading');
const journeyLoadingNote = document.getElementById('journey-loading-note');
const videoControls = document.getElementById('video-controls');
const pauseBtn = document.getElementById('pause-btn');
const back15Btn = document.getElementById('back15-btn');
const fwd15Btn = document.getElementById('fwd15-btn');
const unmuteBtn = document.getElementById('unmute-btn');
const videoScrubber = document.getElementById('video-scrubber');
const videoTime = document.getElementById('video-time');
const toggleBtn = document.getElementById('toggle-btn');
const settingsBtn = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const settingsBackdrop = document.getElementById('settings-backdrop');
const settingsCloseBtn = document.getElementById('settings-close-btn');
const settingsPreviewNote = document.getElementById('settings-preview-note');
const settingsLessonList = document.getElementById('settings-lesson-list');
const settingsVariantPicker = document.getElementById('settings-variant-picker');
const settingsVariantPrompt = document.getElementById('settings-variant-prompt');
const settingsVariantStudentBtn = document.getElementById('settings-variant-student');
const settingsVariantLeaderBtn = document.getElementById('settings-variant-leader');
const settingsVariantSlidesBtn = document.getElementById('settings-variant-slides');
const settingsVariantBackBtn = document.getElementById('settings-variant-back');
const settingsStudentPicker = document.getElementById('settings-student-picker');
const settingsStudentPrompt = document.getElementById('settings-student-prompt');
const settingsStudentVideoBtn = document.getElementById('settings-student-video');
const settingsStudentPrepBtn = document.getElementById('settings-student-prep');
const settingsStudentBackBtn = document.getElementById('settings-student-back');
const settingsLeaderPicker = document.getElementById('settings-leader-picker');
const settingsLeaderPrompt = document.getElementById('settings-leader-prompt');
const settingsLeaderVideoBtn = document.getElementById('settings-leader-video');
const settingsLeaderHandoutBtn = document.getElementById('settings-leader-handout');
const settingsLeaderPrepBtn = document.getElementById('settings-leader-prep');
const settingsLeaderBackBtn = document.getElementById('settings-leader-back');
const handoutView = document.getElementById('handout-view');
const handoutTitle = document.getElementById('handout-title');
const handoutCloseBtn = document.getElementById('handout-close-btn');
const handoutFrame = document.getElementById('handout-frame');
const prepView = document.getElementById('prep-view');
const prepTitle = document.getElementById('prep-title');
const prepBody = document.getElementById('prep-body');
const prepCloseBtn = document.getElementById('prep-close-btn');
const ccBtn = document.getElementById('cc-btn');
const captionPrompt = document.getElementById('caption-prompt');
const captionYesBtn = document.getElementById('caption-yes');
const captionNoBtn = document.getElementById('caption-no');
const captionOverlay = document.getElementById('caption-overlay');
const captionText = document.getElementById('caption-text');
const captionsSizeSelect = document.getElementById('captions-size');
const captionsBackdropInput = document.getElementById('captions-backdrop');
const slidesView = document.getElementById('slides-view');
const slideStage = document.getElementById('slide-stage');
const slideImage = document.getElementById('slide-image');
const slideTemplate = document.getElementById('slide-template');
const slideTemplateHeading = document.getElementById('slide-template-heading');
const slideTemplateBullets = document.getElementById('slide-template-bullets');
const slidePrevBtn = document.getElementById('slide-prev-btn');
const slideNextBtn = document.getElementById('slide-next-btn');
const slideCounter = document.getElementById('slide-counter');
const slidesAutoAdvanceSelect = document.getElementById('slides-auto-advance');
const slidesExtraInputs = {
  questions: document.getElementById('slides-extra-questions'),
  takeaways: document.getElementById('slides-extra-takeaways'),
  challenges: document.getElementById('slides-extra-challenges'),
};
const notesEditToggle = document.getElementById('notes-edit-toggle');
const notesEditBody = document.getElementById('notes-edit-body');
const notesEditWeek = document.getElementById('notes-edit-week');
const notesEditGroups = document.getElementById('notes-edit-groups');
const notesEditStatus = document.getElementById('notes-edit-status');
const notesEditedBadge = document.getElementById('notes-edited-badge');
const notesResetBtn = document.getElementById('notes-reset-btn');
const qualityButtons = {
  auto: document.getElementById('quality-auto'),
  full: document.getElementById('quality-full'),
  low: document.getElementById('quality-low'),
};
const qualityStatus = document.getElementById('quality-status');
const trekView = document.getElementById('trek-view');
const trekChip = document.getElementById('trek-chip');
const trekChipCount = document.getElementById('trek-chip-count');
const trekLesson = document.getElementById('trek-lesson');
const trekLessonTitle = document.getElementById('trek-lesson-title');

// What the Trek card knows about tonight (25-trek.js fills it in). Declared up
// here because scheduledPhase() reads it from the very first setView() call,
// long before that file's own lines have run. `ready` stays false until the
// club-night rule itself has loaded: until then no night is a club night.
const trekNight = { ready: false, rule: null, schedule: null, feed: null };

