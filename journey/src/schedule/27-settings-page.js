/* ── The owner's settings page (awana.kvbchurch.org/settings → Journey) ──
   Owner 2026-10-12: "Lessons on this computer" can also be worked from the
   settings page, for every Journey kiosk at once. This kiosk's Settings panel
   keeps every control (it is the fallback at the PC); the settings page sends
   the same presses here, and this file runs them through the panel's own
   functions, so a press from there is exactly a press here.

   - Commands (lobby/src/lib/syncSpecs.js SCREEN_ACTIONS.journey): start,
     pause, resume, stop, delete. They reach this page in the answer to its
     hello (public/src/sync.js, which checks each one against the same list)
     a second or two after the press, or at the next two-minute hello.
     Configure mode, or a browser that cannot save lessons, does nothing.
   - The two switches ("Download lessons automatically", "Include Leader
     Videos") are this kiosk's own settings on the sync service
     (SCREEN_SPECS.journey downloadsAuto / downloadsLeader): sync.js hands
     them to journeySettingsPage.setPrefs, and sends a change made on the
     tick boxes here back up, so both places always show the same.
   Nothing here touches the network. */

/* The two switches as they are on this computer (the stored choice, else
   the default: automatic only in the KVBC Awana app, Leader Videos on). */
function downloadPrefs() {
  return { auto: downloadsAutoWanted(), leaders: downloadsLeadersWanted() };
}

/* Set either switch, as its tick box would (only one that differs). */
function setDownloadPrefs(patch) {
  if (!patch || typeof patch !== 'object') return;
  if (typeof patch.auto === 'boolean' && patch.auto !== downloadsAutoWanted()) setDownloadsAuto(patch.auto);
  if (typeof patch.leaders === 'boolean' && patch.leaders !== downloadsLeadersWanted()) setDownloadsLeaders(patch.leaders);
}

/* One command from the settings page. true when it was run. */
function settingsPageCommand(action) {
  if (CONFIGURE_MODE || !lessonStoreSupported()) return false;
  switch (action) {
    case 'start-downloads':
    case 'resume-downloads':
      // Resume of a run that already ended starts one: both mean "carry on".
      if (downloadsActive()) return false;
      startLessonDownloads(false);
      break;
    case 'pause-downloads':
      if (!downloadsActive()) return false;
      pauseLessonDownloads();
      break;
    case 'stop-downloads':
      if (!downloadsActive() && dl.phase !== 'paused') return false;
      stopLessonDownloads();
      break;
    case 'delete-downloads':
      setDownloadsNote('Deleting (asked from the settings page)…');
      deleteDownloadedLessons();
      break;
    default:
      return false;
  }
  renderDownloads();
  return true;
}

window.journeySettingsPage = { command: settingsPageCommand, prefs: downloadPrefs, setPrefs: setDownloadPrefs };
