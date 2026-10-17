/* ── Self-updating kiosk ──────────────────────────────────────────────
   The kiosk is wall-mounted and nobody wants to find a keyboard to
   press F5 after a deploy. So the page notices a new build and reloads
   itself, with two hard rules: never onto the old page, and never while a
   room is watching something.

   How it knows: deploy.yml runs scripts/stamp-build.mjs, which writes
   version.json and stamps the same commit SHA into the journey-build meta
   of the page that was uploaded (and onto the asset URLs, so the reloaded
   page cannot keep running the previous deploy's schedule.js out of disk
   cache). This page compares the two.

   Missing version.json (a local checkout, a stale Pages cache, a 404) is
   "no news", never a reload: an unstamped page polls harmlessly forever.

   The freshness check exists because Pages' max-age=600 applies to
   index.html too. version.json can report a new build minutes before the
   CDN edge serving this kiosk stops handing back the old page, and a reload
   onto the old page looks exactly like "the deploy did not take". So the
   new SHA has to be visible in a freshly fetched index.html before anything
   reloads; if it is not, the next tick tries again. */
const VERSION_POLL_MS = 3 * 60 * 1000;
const VERSION_BUSY_RECHECK_MS = 15000;
const VERSION_ONLINE_MIN_GAP_MS = 60 * 1000;

// The build this page is running, read fresh rather than cached at load, so
// there is exactly one source for it: the document itself.
function currentBuildId() {
  const meta = document.querySelector(`meta[name="journey-build"]`);
  const value = meta && meta.getAttribute('content');
  return typeof value === 'string' ? value.trim() : '';
}

function buildIdInHtml(html) {
  const tag = /<meta[^>]*name=["']journey-build["'][^>]*>/i.exec(String(html));
  if (!tag) return '';
  const content = /content=["']([^"']*)["']/i.exec(tag[0]);
  return content ? content[1].trim() : '';
}

let pendingBuild = null; // a newer build we have seen and are waiting to take
let versionBusyTimer = null;
let lastVersionCheckMs = 0;

/* Nothing is on screen that a reload would interrupt. A lesson playing, the
   slides up, a preview, a reading overlay, the Settings panel, the caption
   question, someone typing bullets, or the splash waiting for a leader to
   press Begin: all of those are the room's, not ours. In practice this means
   the Check-in Display is showing, or the Journey window has ended. */
function safeToReload() {
  // A club transition's black with no welcome on it is nobody's to watch
  // (the black is only ever up when nothing below is being watched; the
  // splash waiting under it is not on screen yet).
  if (gapBlackUp() && !gapWelcoming()) return true;
  const el = document.activeElement;
  const typing =
    !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  return (
    !previewMode &&
    !slideshowActive() &&
    !lessonIntroActive() &&
    journeyVideo.classList.contains('hidden') &&
    !journeyVideo.hasAttribute('src') &&
    !readerOverlayOpen() &&
    settingsPanel.classList.contains('hidden') &&
    !isCaptionPromptOpen() &&
    !isAwaitingPlay() &&
    !typing
  );
}

// One indirection, so a test can watch for the reload without navigating.
function reloadPage() {
  location.reload();
}

function scheduleBusyRecheck() {
  if (versionBusyTimer) return;
  versionBusyTimer = setTimeout(() => {
    versionBusyTimer = null;
    takeNewBuild();
  }, VERSION_BUSY_RECHECK_MS);
}

async function takeNewBuild() {
  if (!pendingBuild) return;
  if (!safeToReload()) {
    scheduleBusyRecheck();
    return;
  }
  let html;
  try {
    const res = await fetchWithTimeout(`index.html?b=${Date.now()}`, { cache: 'no-store' }, 5000);
    if (!res.ok) return; // try again on the next tick
    html = await res.text();
  } catch {
    return;
  }
  // Still the old page at this edge: reloading now would land back on the
  // build we are already running.
  if (buildIdInHtml(html) !== pendingBuild) return;
  // Re-checked after the await: a leader can have started the lesson while
  // that request was in flight.
  if (!safeToReload()) {
    scheduleBusyRecheck();
    return;
  }
  console.log(`Journey: reloading for build ${pendingBuild}`);
  reloadPage();
}

async function checkForNewBuild() {
  lastVersionCheckMs = Date.now();
  const mine = currentBuildId();
  if (!mine) return; // a page with no build id has nothing to compare
  if (pendingBuild) {
    takeNewBuild(); // already know; this tick is just another chance to take it
    return;
  }
  let data;
  try {
    const res = await fetchWithTimeout(
      `version.json?b=${Date.now()}`,
      { cache: 'no-store' },
      5000
    );
    if (!res.ok) return; // no version.json: nothing to compare, no news
    data = await res.json();
  } catch {
    return;
  }
  const build = data && typeof data.build === 'string' ? data.build.trim() : '';
  if (!build || build === mine) return;
  console.log(`Journey: a newer build is deployed (${build}); this page is ${mine}`);
  pendingBuild = build;
  takeNewBuild();
}

// A configure page never reloads itself under the operator's typing (its
// open panel would hold safeToReload() off anyway); it takes a new build the
// next time it is opened.
if (!CONFIGURE_MODE) {
  setInterval(checkForNewBuild, VERSION_POLL_MS);
  // A kiosk that was offline through a deploy should not wait out the timer.
  // 'online' fires in bursts on flapping WiFi, so it is rate limited.
  window.addEventListener('online', () => {
    if (Date.now() - lastVersionCheckMs < VERSION_ONLINE_MIN_GAP_MS) return;
    checkForNewBuild();
  });
}
