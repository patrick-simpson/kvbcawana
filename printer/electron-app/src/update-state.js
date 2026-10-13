'use strict';
// The app's update state as one small pure state machine. main.js hands every
// electron-updater event to it, so each transition sets every field of the
// state together and a stale field (an old download error above all) can
// never outlive the event that made it untrue. No Electron, no timers.
//
// The state object (the one main.js shows in the tray and the status window,
// and src/update-progress.js turns into the word /settings shows):
//   checking     a feed check is running
//   available    version being downloaded, or already downloaded
//   downloaded   version ready to install
//   upToDate     the last check found nothing newer
//   error        text, only after a DOWNLOAD that was under way failed
//   percent, progressLine, progressDetail   download progress, null otherwise
//
// Events (main.js maps electron-updater onto them):
//   checking, available {version}, not-available, progress {percent...},
//   downloaded {version}, error, plus the two for the status window's own
//   "check now": check-requested (forget "up to date") and check-failed (the
//   check could not reach the feed: stop spinning, say nothing).

const { createProgress } = require('./update-progress');

const DOWNLOAD_ERROR = 'The update could not finish downloading. It will try again soon.';

function initialState() {
  return {
    checking: false, available: null, downloaded: null, upToDate: false, error: null,
    percent: null, progressLine: null, progressDetail: null,
  };
}

// Pure: the next state for an event. `downloading` says whether a download
// was under way (progress had arrived), which is how a failed download is told
// from a failed check: only the first is worth a message, a check that fails
// while offline stays quiet. `progress` is already reflected in `next`'s
// percent/lines by the caller (see createUpdateState), so reducers leave it be.
function transition(state, event, payload, { downloading = false } = {}) {
  const s = { ...state };
  const version = payload && payload.version != null ? payload.version : null;
  switch (event) {
    case 'check-requested':
      s.upToDate = false;
      break;
    case 'checking':
      s.checking = true;
      s.error = null;
      break;
    case 'available':
      s.checking = false;
      s.available = version;
      s.upToDate = false;
      s.error = null;
      break;
    case 'not-available':
      s.checking = false;
      s.available = null;
      s.upToDate = true;
      s.error = null;
      break;
    case 'downloaded':
      s.checking = false;
      s.downloaded = version;
      s.upToDate = false;
      s.error = null;
      break;
    case 'check-failed':
      s.checking = false;
      break;
    case 'error':
      s.checking = false;
      if (downloading) {
        s.error = DOWNLOAD_ERROR;
        s.available = null;
        s.upToDate = false;
      }
      break;
    default:
      break;
  }
  return s;
}

// Events after which no download is under way, so no progress to show.
const ENDS_DOWNLOAD = new Set(['not-available', 'downloaded', 'error']);

// A holder with ONE long-lived state object (main.js passes it around by
// reference: the status window's IPC, the /settings report), updated in place.
function createUpdateState({ progress = createProgress() } = {}) {
  const state = initialState();
  function apply(event, payload) {
    let repaint = false;
    const downloading = progress.active();
    if (event === 'progress') {
      repaint = progress.update(payload);
    } else {
      Object.assign(state, transition(state, event, payload, { downloading }));
      if (ENDS_DOWNLOAD.has(event)) progress.reset();
    }
    state.percent = progress.percent();
    state.progressLine = progress.line();
    state.progressDetail = progress.detail();
    return { repaint };
  }
  return { state, apply };
}

module.exports = { createUpdateState, transition, initialState, DOWNLOAD_ERROR, ENDS_DOWNLOAD };
