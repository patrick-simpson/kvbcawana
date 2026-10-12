/* ── Leader prep: the handout's summary as text, not a PDF ────────────
   "View Handout" is the right thing on the TV and the wrong thing on a
   phone — a Letter-sized PDF page in Chromium's viewer, pinch-zoomed, is
   the worst reading experience a leader preparing on the way to church
   could be handed. "Read Prep" renders the same page-1 content (Big Idea,
   Key Points, Scripture, Discussion Questions) as plain text this page
   lays out itself, so it reflows on any screen.

   public/leader-prep.json is GENERATED from data/leader-handout-summaries
   .json by scripts/build-leader-prep.mjs (which render-leader-handouts.mjs
   also runs) — that data file stays the single hand-edited source and stays
   a build input. Only the summaries travel: they are this church's own
   writing about each video, not Awana's material, and the spoken transcript
   is already published as the caption .vtt.

   Loaded cache-first out of ASSET_CACHE_NAME exactly like lessons.json and
   teaching-slides.json, and warmed at startup, so after one successful load
   the prep opens with the network dead. */
const LEADER_PREP_URL = 'leader-prep.json';
let leaderPrep = null;
// Set once a load has been tried and produced nothing usable, so the panel
// can tell "not fetched yet" from "we tried and there is no data".
let leaderPrepFailed = false;

function adoptLeaderPrep(data) {
  if (!data || typeof data !== 'object' || !data.weeks || typeof data.weeks !== 'object') return false;
  leaderPrep = data;
  return true;
}

async function fetchLeaderPrepJson() {
  const res = await fetchWithTimeout(LEADER_PREP_URL, {}, 5000);
  if (!res.ok) throw new Error(`${LEADER_PREP_URL} ${res.status}`);
  // Parse and shape-check BEFORE caching: a 200 carrying a truncated deploy
  // must never replace a known-good offline copy.
  const text = await res.text();
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || !data.weeks) throw new Error(`${LEADER_PREP_URL}: unexpected shape`);
  if ('caches' in window) {
    try {
      const cache = await caches.open(ASSET_CACHE_NAME);
      await cache.put(LEADER_PREP_URL, new Response(text, { headers: { 'content-type': 'application/json' } }));
    } catch {
      // Not storable right now — still usable live.
    }
  }
  return data;
}

async function loadLeaderPrep() {
  if (leaderPrep) return leaderPrep;
  if ('caches' in window) {
    try {
      const cache = await caches.open(ASSET_CACHE_NAME);
      const hit = await cache.match(LEADER_PREP_URL);
      if (hit && adoptLeaderPrep(await hit.json())) {
        fetchLeaderPrepJson().then(adoptLeaderPrep, () => {});
        return leaderPrep;
      }
    } catch {
      // fall through to the network
    }
  }
  try {
    adoptLeaderPrep(await fetchLeaderPrepJson());
  } catch (err) {
    console.warn('Journey: leader-prep.json unavailable —', err);
  }
  if (!leaderPrep) leaderPrepFailed = true;
  return leaderPrep;
}

function leaderPrepFor(week) {
  const weeks = leaderPrep && leaderPrep.weeks;
  const entry = weeks && weeks[String(week)];
  return entry && typeof entry === 'object' ? entry : null;
}

// Identity of the latest open, same reason as handoutRequestId: a slow load
// for week A must not paint into an overlay showing week B.
let prepRequestId = 0;

