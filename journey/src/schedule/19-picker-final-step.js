/* ── The picker's last step, here or relayed from a configure page ────
   Every final choice in the picker acts on the SCREEN (plays a lesson, puts
   the slides, a handout or a prep over the wall), so on a configure page it
   is not run at all: it is posted on the 'awana-configure' BroadcastChannel
   as { screen: 'journey', action: 'pick', data: { week, choice } }, the same
   shape as the lobby's relayToScreen(), and the live kiosk in the same
   browser profile runs it through the very same PICKER_CHOICES entry its own
   button would. A BroadcastChannel never leaves this origin in this browser
   profile, and nothing answers it: if no kiosk is open, nothing happens. */
const PICKER_CHOICES = {
  student: (lesson) => {
    closeSettingsPanel();
    requestPlayback(captionUrlFor(lesson.week, 'student'), () => playStudentPreview(lesson));
  },
  leader: (lesson) => {
    closeSettingsPanel();
    requestPlayback(captionUrlFor(lesson.week, 'leader'), () => playLeaderPreview(lesson));
  },
  slides: (lesson) => {
    closeSettingsPanel();
    startSlidesPreview(lesson.week);
  },
  handout: (lesson) => {
    openHandout(lesson);
    closeSettingsPanel();
  },
  'student-prep': (lesson) => {
    openPrep(lesson, 'student');
    closeSettingsPanel();
  },
  'leader-prep': (lesson) => {
    openPrep(lesson, 'leader');
    closeSettingsPanel();
  },
};
// The Leader side of the picker is disabled for a week with no Leader Video
// (27), so a relay may not reach these for one either.
const PICKER_NEEDS_LEADER = ['leader', 'handout', 'leader-prep'];
const PICKER_LABELS = {
  student: 'Student Video',
  leader: 'Leader Video',
  slides: 'teaching slides',
  handout: 'Leader Handout',
  'student-prep': 'Student Prep',
  'leader-prep': 'Leader Prep',
};

function runPickerChoice(choice, lesson) {
  if (!CONFIGURE_MODE) {
    PICKER_CHOICES[choice](lesson);
    return;
  }
  relayToKiosk('pick', { week: lesson.week, choice });
  // The panel stays (it is the page); it goes back to the list and says
  // where the choice went, because nothing changes on this screen.
  resetSettingsPanelToList();
  settingsPreviewNote.textContent =
    `Sent to the Journey screen: Week ${lesson.week}, ${PICKER_LABELS[choice]}.`;
}

function relayToKiosk(action, data) {
  try {
    const channel = new BroadcastChannel(CONFIGURE_CHANNEL);
    channel.postMessage({ screen: 'journey', action, data });
    channel.close();
  } catch {
    // No BroadcastChannel: the button simply does nothing.
  }
}

/* The live kiosk's side. Only 'pick' is allowed, and its data is checked as
   strictly as a click would be: a choice from PICKER_CHOICES, a week this
   kiosk's own lessons.json knows, and a Leader Video for the Leader side.
   Returns whether it acted (the tests read that). */
const RELAY_ACTIONS = ['pick'];

function handleConfigureRelay(message) {
  if (CONFIGURE_MODE) return false;
  if (!message || typeof message !== 'object' || message.screen !== 'journey') return false;
  if (!RELAY_ACTIONS.includes(message.action)) return false;
  const data = message.data;
  if (!data || typeof data !== 'object' || !Number.isInteger(data.week)) return false;
  const choice = data.choice;
  if (typeof choice !== 'string' || !Object.prototype.hasOwnProperty.call(PICKER_CHOICES, choice)) return false;
  if (!allLessons) {
    // Warmed at startup, so this is only a relay in the first seconds after a
    // boot: take it once the list is in.
    loadAllLessons().then((lessons) => { if (lessons) handleConfigureRelay(message); });
    return false;
  }
  const lesson = allLessons.find((l) => l && l.week === data.week);
  if (!lesson) return false;
  if (PICKER_NEEDS_LEADER.includes(choice) && !lesson.leaderDownloadUrl) return false;
  // On the kiosk the picker cannot be reached under a reading overlay, so one
  // left open is closed first rather than covering what was asked for.
  if (readerOverlayOpen()) {
    closeHandout();
    closePrep();
  }
  // The operator's click in the configure page stands in for one on the
  // kiosk. A browser that disagrees refuses the unmuted play, and every play
  // path already falls back to muted.
  audioUnlocked = true;
  PICKER_CHOICES[choice](lesson);
  return true;
}

// Kept in a binding so it is never collected while the kiosk runs.
const configureChannel = (() => {
  if (CONFIGURE_MODE || typeof BroadcastChannel === 'undefined') return null;
  try {
    const channel = new BroadcastChannel(CONFIGURE_CHANNEL);
    channel.onmessage = (event) => handleConfigureRelay(event.data);
    return channel;
  } catch {
    return null;
  }
})();

