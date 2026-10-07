// ─────────────────────────────────────────────────────────────
// EDIT-ME CONFIG
//
// This is the file most users will change. Anything here can ALSO be
// overridden at runtime via the on-screen Settings panel (gear icon,
// bottom-left), which stores your overrides in the browser's
// localStorage so you can tweak without committing new code.
//
// All keys are optional — leave one blank and the app falls back to
// a sensible default.
// ─────────────────────────────────────────────────────────────

// Resolve a path relative to wherever this app is being served from —
// so forks and mirrors read their own /shared/ files instead of the
// original deployment's. (Guarded for non-browser contexts like tests.)
const fromSiteRoot = (path) => {
  try {
    return new URL(path, window.location.href).href;
  } catch {
    return '';
  }
};

const config = {
  // Pusher credentials. Sign up free at https://pusher.com, create a
  // Channels app, and copy these two values from its "App Keys" page.
  //
  // A fleet can bake them into the build so a brand-new screen connects
  // with nothing typed: set the GitHub repository VARIABLES
  // PUSHER_APP_KEY and PUSHER_CLUSTER (Settings → Secrets and variables →
  // Actions → Variables) and deploy.yml passes them in as VITE_PUSHER_*.
  // The app key is Pusher's PUBLIC subscribe key — it ships in every
  // display's bundle regardless — so a variable, not a secret, is the
  // right home; a fork that sets neither starts blank, exactly as before.
  // Per-device Settings, a ?config= file and ?key= still override these —
  // all of that layering happens in src/hooks/useConfig.js.
  pusherAppKey: import.meta.env.VITE_PUSHER_APP_KEY || '',
  pusherCluster: import.meta.env.VITE_PUSHER_CLUSTER || 'us2',

  // What plays behind the check-in banners:
  //   'manual'     — the typed/published slide deck plus the calendar
  //                  slides. THE DEFAULT: a freshly logged-in screen shows
  //                  the deck published from the check-in machine with
  //                  nothing else set. (Settings → Slides, or Ctrl+Shift+E)
  //   'powerpoint' — the OneDrive PowerPoint embed URL below. A saved URL
  //                  with no source chosen still means this, for screens set
  //                  up before 'manual' became the default — see
  //                  resolveStoredConfig in src/hooks/useConfig.js.
  //   'pptx'       — a .pptx you upload in Settings, rendered locally
  //                  on this device (no OneDrive, no iframe)
  //   'video'      — one video file you upload in Settings, playing
  //                  full-screen on a loop (muted). Stored on this
  //                  device only, never uploaded anywhere.
  backgroundSource: 'manual',

  // Typed slides live here when you use the 'manual' source. Edit them
  // with the on-screen editor rather than by hand — they're saved per
  // device in the browser, and the editor can export/import them as a
  // JSON file to move a deck between computers.
  manualSlides: [],

  // The OneDrive "Embed" URL for your looping PowerPoint.
  // Go to OneDrive → open .pptx → File → Share → Embed → copy the <iframe src="…"> value.
  // Leave blank to show a friendly placeholder instead.
  powerpointEmbedUrl: '',

  // How many seconds between slide advances (sets wdSlideShowDelay in the embed URL).
  // Set to 0 to let the PowerPoint file control its own slide timing.
  slideshowDelaySec: 5,

  // Download the .pptx from the OneDrive URL above and render it locally
  // instead of using the Office Online iframe. Local rendering covers
  // backgrounds, text, pictures and solid/gradient shapes (with rotation
  // and per-slide timings); it does NOT render animations, SmartArt,
  // charts or tables, and fonts substitute to the system stack. Applies
  // only to this URL-fetch path — the primary way to use local rendering
  // is uploading a deck in Settings (backgroundSource: 'pptx'), which
  // avoids OneDrive's CORS blocks entirely. If the download or parse
  // fails, the app falls back to the iframe embed automatically.
  useLocalSlideshow: false,

  // RETIRED: the corner countdown card moved to the presentation tool
  // (countdown.html), which owns countdown duty for the program. The
  // key is kept so older saved settings still validate; it no longer
  // drives anything on the signage page.
  countdownTargetTime: '18:30',

  // How long each check-in banner stays on screen (milliseconds).
  standardDisplayMs: 6000,
  specialDisplayMs: 8000, // birthday / first-timer banners hold longer

  // Small gap between banners so the animation in/out doesn't clip.
  gapBetweenBannersMs: 400,

  // Play a little chime alongside the banner? The user can flip this
  // at runtime in the Settings panel; this is just the initial default.
  // Browsers block autoplay until the user interacts with the page
  // at least once, so the chime is silent on first load either way.
  audioEnabledByDefault: false,

  // The corner info (time, tonight's tally, weather) shows ONE item at a
  // time, moving on with each slide (src/lib/cornerInfo.js); there is no
  // layout or interval to choose any more. Any saved widgetDisplayMode or
  // cycleIntervalSec is dropped by the validator like any unknown key.

  // Show a tiny "● connected" dot in the corner? Useful while setting up,
  // distracting during club. Defaults to hidden. (If the connection drops
  // mid-club the dot appears on its own either way, so a dead pipe is
  // never silent.)
  showConnectionStatus: false,

  // Show tonight's check-in counter in the corner. Counts only a number —
  // no names are stored — and resets automatically each day.
  showTally: true,

  // Celebrate every Nth check-in with a room-wide confetti moment and a
  // "25 kids tonight!" toast. Set to 0 to turn milestones off.
  milestoneEvery: 25,

  // When the check-in desk's broadcast moves the corner counter by more than
  // one — an operator undo, or a catch-up after this screen was offline — show
  // a short "synced with the check-in desk" note under the number, so a jump
  // (or a count going DOWN) reads as a correction rather than a glitch. A
  // delta of exactly one is always silent; ordinary broadcast ordering
  // produces those constantly.
  showTallySyncNote: true,

  // The "tonight" strip at the bottom centre ("N checked in", books, awards,
  // friends). Off unless a screen turns it on (owner, 2026-10-07: "I don't want
  // it to show the number in the center"); per screen, Settings → Screen &
  // corner → This TV.
  showTonightTicker: false,

  // Handbook milestones (#358): the `tonight` broadcast already carries how
  // many books were finished and awards earned this evening, and nothing
  // rendered them — so the only thing the screen ever cheered was heads
  // through the door. These are the thresholds that earn their own toast.
  // Smaller than the attendance ones on purpose: ten books finished in one
  // night is a bigger deal than the hundredth kid arriving. An empty list
  // turns that half off.
  bookMilestones: [5, 10, 25],
  awardMilestones: [10, 25, 50],

  // Show the current time of day (the countdown shows time-until-start;
  // this is a plain wall clock). Bottom-right, in the one-item corner
  // rotation, frozen at each slide load (src/lib/cornerInfo.js).
  showClock: true,

  // Weather: the temperature and the sky's one-word label, top-right, in
  // the one-item corner rotation. Refreshes every 15 minutes
  // from Open-Meteo (free, keyless). Works over any background source;
  // hides itself whenever no reading is available.
  showWeatherChip: true,

  // Ask the browser to keep the TV/projector screen awake while the
  // display is open (Screen Wake Lock API; ignored where unsupported).
  keepScreenAwake: true,

  // ── Calendar-aware slides ─────────────────────────────────
  // The display can read the church's Awana calendar and auto-generate
  // slides in the typed-slides rotation: "Welcome to Water Night!",
  // "Next week is Backwards Night!", and "N nights remaining". A nightly
  // GitHub Action turns the calendar page into calendar-feed.json;
  // if that file is missing or stale the app falls back to fetching
  // the calendar page live through the CORS proxy below.
  calendarEnabled: true,

  // ── Church profile ────────────────────────────────────────
  // Everything specific to YOUR church lives in this block — if you
  // forked this repo for a different church, these are the values to
  // change (all of them can also be overridden at runtime in Settings).

  // The public calendar page to read (twotimtwo format).
  calendarUrl: 'https://kvbchurch.twotimtwo.com/calendar/index',

  // The shared program schedule (shared/ at the repo root →
  // dist/shared/ on build) — the single source of truth for the whole
  // Awana app family. Drives "phase awareness": calm late-arrival
  // banners + ducked chimes once the ceremony starts. Resolved against
  // wherever this site is served from, so forks automatically read
  // their own copy; blank disables the fetch (baked KVBC schedule
  // still applies).
  sharedScheduleUrl: fromSiteRoot('shared/schedule.json'),

  // The shared per-club theme (catalog colors + official club art),
  // also served from this site's shared/. Blank keeps the baked palette.
  sharedThemeUrl: fromSiteRoot('shared/theme.json'),

  // Where the weather chip looks. Use Settings → Screen & corner →
  // "Look up" to fill the coordinates from a town name.
  weatherLocationName: 'Waterville, Maine',
  weatherLat: 44.552,
  weatherLon: -69.6317,
  weatherUnits: 'fahrenheit', // or 'celsius'

  // ── End church profile ────────────────────────────────────

  // Recap replay: how far back (minutes) a replayed check-in may be and
  // still get its quiet "also joined us" banner after a reconnect.
  recapMaxAgeMin: 20,

  // Celebrate when a single club's tally (from the printer's live
  // broadcasts) crosses a multiple of this. 0 disables.
  clubMilestoneEvery: 10,

  // Give the very first child checked in each night a one-time "Doors are
  // open" flourish instead of an ordinary banner-only arrival — the cue that
  // tells volunteers check-in has actually started. Only a screen that was
  // already awake before doors can know who was first, so this is skipped
  // entirely on a screen that boots mid-program (see lib/firstOfNight.js).
  firstArrivalMoment: true,

  // While a child's banner is on screen, briefly wash the background scene in
  // that child's own club colour, so the whole display belongs to the arriving
  // kid for a few seconds instead of only the banner doing.
  //
  // OFF by default on purpose: it competes with a themed night skin, which is
  // a look somebody chose deliberately. Skipped automatically in overlay and
  // panic mode, and over a video/uploaded-PowerPoint background (there is
  // nothing of ours to tint there). See src/lib/clubTint.js.
  clubTintBackground: false,

  // A small "Birthday this Friday!" ribbon on an arriving child's banner
  // when the printer's weekly `birthdays` roster says their birthday falls
  // later this week (never on the day itself — that day's banner already
  // says the right thing). The roster arrives sealed, so a screen with no
  // display key simply never shows one.
  showBirthdayWeekRibbon: true,

  // ── Who's still here board ────────────────────────────────────────────
  // Shows which children have not been checked out yet, from the printer's
  // `checkout` broadcast.
  //
  // 'off' (default) | 'pickup' (only in the last stretch of club and just
  // after) | 'always' (whenever fresh data is arriving).
  //
  // OFF BY DEFAULT ON PURPOSE. This is the only widget whose data is a list
  // of children who are NOT yet with a parent, and no default is right for
  // every church — so it takes a deliberate choice rather than appearing
  // because someone updated the app.
  checkoutBoardMode: 'off',

  // Stop naming individuals at or below this many children still here, and
  // show a neutral "almost everyone has been picked up" line instead.
  //
  // This is the real safeguard. A long list is anonymising — one name among
  // forty tells a stranger nothing useful. A list of two names is a
  // statement about two specific unattended children, at the exact moment
  // the room is emptying out and a stranger is most conspicuous. 0 disables
  // the guard entirely (not recommended).
  checkoutBoardNamesAbove: 3,

  // Minutes before the board is treated as stale. The scraper only runs
  // while a volunteer has the TwoTimTwo tab open, so going quiet is normal
  // and must show as an AGE rather than as a silently frozen list.
  checkoutBoardStaleMin: 8,

  // 'pickup' mode's window, local 24-hour "HH:MM" (owner, 2026-10-01): the
  // board comes up at checkoutBoardFrom, stays until the list empties (then
  // says "Everyone has been checked out" for a minute and steps away), and is
  // gone by checkoutBoardUntil whatever the list says. Also when the corner
  // counter counts down and an "always" board takes the middle of the room.
  checkoutBoardFrom: '19:35',
  checkoutBoardUntil: '20:30',

  // During that window, while the board is naming children, the corner's
  // "Tonight" counter switches to how many are not checked out yet and counts
  // down as they are. Never while the board withholds names (a small number on
  // a public wall singles children out), and never from a stale list.
  cornerStillHere: true,

  // Themed night skin: 'none' | 'auto' | a skin id. The ids live in ONE
  // place — SKIN_TABLE in src/lib/skins.js — which also carries each
  // skin's accent colors, its scene theme, and the calendar-title
  // keywords that select it.
  //
  // 'auto' reads tonight's church calendar title first (so Easter, VBS,
  // Thanksgiving and back-to-school work — none of which a month table
  // can express, being lunar, floating or church-scheduled) and falls
  // back to the month. The skin dresses the room; banners always keep
  // their club colors.
  nightTheme: 'none',

  // Unified theming (#18): when the print server broadcasts its season (an
  // optional field on every tally), follow it — labels and screens switch
  // together. Only consulted while nightTheme is 'auto'; a hand-pinned skin
  // or 'none' always wins locally. Turn off to let this screen do its own
  // calendar guessing even when the printer is broadcasting.
  followPrinterTheme: true,

  // Slide sync (#27): when the print server has published a typed slide deck
  // (sealed `slides` event), show THAT deck instead of this device's own —
  // the operator edits slides once and every screen follows. Turn off to pin
  // this one screen to its locally-saved deck (a special-purpose display in a
  // classroom, say). Only the typed deck syncs; pptx and video backgrounds
  // stay per-device by design.
  followPublishedSlides: true,

  // Shared settings (contract v6, owner 2026-10-01): when the check-in
  // computer publishes the screens' shared settings (banner times, the
  // celebrations, the pickup board, the look, the calendar and weather; the
  // list is src/lib/sharedSettings.js), follow them. Turn off to keep this
  // one screen on its own values. Per-screen settings never travel either way.
  followSharedSettings: true,

  // April Fools (#21): flips this screen upside down. SCREENS ONLY - labels
  // and the printer dashboard stay serious - and the flip only actually
  // happens on April 1st, so a toggle left on is inert the rest of the year.
  // The settings panel stays right-side up so you can always turn it off.
  aprilFools: false,

  // Ambient particles (#26): a gentle full-screen effect behind the corner
  // widgets - 'auto', 'snow', 'rain', 'sparkle', or 'off'. 'auto' (the
  // default) matches the real weather outside: snowfall when it's snowing,
  // rainfall when it's raining or storming, nothing otherwise. The named
  // effects force one on regardless (snowfall for a Christmas party,
  // sparkles for awards night). Pure CSS animation on a fixed particle
  // set (no per-frame JS); skipped automatically under reduce-motion and
  // panic mode.
  particleEffect: 'auto',

  // Let the weather add atmosphere over whatever the season chose: a
  // rainy or snowy night cools and dims the background scene. On by
  // default — the room should feel like the evening outside. The season
  // still owns the palette, so a chosen VBS skin doesn't disappear when
  // it rains. Needs a weather location (Settings → Screen & corner) but NOT the
  // corner chip — either one being on is enough to fetch.
  weatherTheme: true,

  // Per-club banner flavor text, shown under the kid's name on their
  // welcome banner. Keys match the club name the printer sends
  // (case-insensitive); missing clubs just get no subtitle. Example:
  //   clubPhrases: { sparks: 'Shine bright tonight!', 't&t': 'Bring it!' },
  clubPhrases: {},

  // Room-wide confetti intensity: 'full' | 'reduced' | 'off'.
  // 'reduced' halves the particle counts (weak hardware / busy nights);
  // 'off' keeps banners and chimes but never fires the cannons.
  // Full by default — every device gets full effects unless it opts out,
  // either here in Settings or via ?lowPower=1 for a specific weak-hardware
  // embed (see src/lib/urlFlags.js) without changing anyone else's default.
  confettiLevel: 'full',

  // Forces framer-motion's `reducedMotion="always"` mode regardless of the
  // OS-level `prefers-reduced-motion` setting. Off by default (motion
  // follows the OS setting, same as always); turn on here for a specific
  // device, or see ?lowPower=1 in src/lib/urlFlags.js for embedding on
  // hardware too weak to animate smoothly without changing this default.
  reduceMotion: false,

  // Panic mode strips the screen to its reliable core (placeholder
  // background, clock only) while banners keep working. Toggle it live
  // with Ctrl+Shift+X when something looks wrong mid-event.
  panicMode: false,

  // What the welcome slide says on an ordinary club night (special
  // nights use their calendar title instead).
  calendarWelcomeText: 'Welcome to Awana!',

  // Turn individual auto-slides off without losing the others.
  calendarShowWelcome: true,
  calendarShowNextWeek: true,
  calendarShowRemaining: true,

  // This season's three hardcoded event promos (the DEFEND poster
  // contest, BARF Night, Parents' Night) — animated recreations of the
  // printed fall posters, sharing ONE slot in the background rotation.
  // They are dated: each one retires itself the day after its event, and
  // the last of them is gone after Nov 4, 2026. See src/lib/promos.js.
  seasonPromos: true,

  // Self-heal watchdog: reload the page automatically after this many
  // minutes of continuously-lost realtime connection (never more than
  // twice an hour). 0 disables. Only fires when Pusher is configured —
  // a display that was never set up is left alone.
  watchdogReloadMin: 30,
};

export default config;
