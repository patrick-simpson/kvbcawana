
/* ── The share banner (owner 2026-11-23) ─────────────────────────────
   "When I hand out a share, let's do a cool animation on every screen in the
   building that shows off that they got a share on the bottom third." The
   embedded Check-in Display hands each gift up (lobby hostShares: {type,
   kids: [{firstName, club}], shares}, its own frame and origin only); this
   page shows it in the bottom third over every view, waiting while a lesson
   video plays. The words and the queue are the family's one rule
   (shared/shareBanner.js, a byte copy beside this script). Names in memory
   only. Configure mode: nothing. Test seam: window.journeyShareBannerModule. */
const SHARES_MESSAGE = 'awana-display:shares';
const SHARE_MODULE_URL = (() => {
  const own = document.currentScript && document.currentScript.src;
  const url = new URL('shared/shareBanner.js', own || new URL('src/schedule.js', window.location.href).href);
  if (own) url.search = new URL(own).search;
  return url.href;
})();
const shareState = { rule: null, queue: null, up: false, box: null };

function shareVideoPlaying() {
  return journeyVideo.hasAttribute('src') && !journeyVideo.paused && !journeyVideo.ended;
}

function showShareBanner(gift) {
  const rule = shareState.rule;
  if (!rule) return;
  if (!shareState.box) {
    shareState.box = document.createElement('div');
    shareState.box.id = 'share-banner';
    shareState.box.setAttribute('role', 'status');
    shareState.box.hidden = true;
    document.body.append(shareState.box);
  }
  const box = shareState.box;
  const w = rule.shareWords(gift);
  const say = (t) => (backwardsState.on ? backwardsText(t) : t);
  box.textContent = '';
  const coins = document.createElement('div');
  coins.className = 'share-coins';
  for (let i = 0; i < 3; i += 1) { const c = document.createElement('i'); c.style.setProperty('--i', String(i)); coins.append(c); }
  const copy = document.createElement('div');
  const names = document.createElement('div');
  names.className = 'share-names';
  names.textContent = say(w.names);
  const line = document.createElement('div');
  line.className = 'share-line';
  line.textContent = say(w.line);
  copy.append(names, line);
  box.append(coins, copy);
  box.hidden = false;
  shareState.up = true;
  setTimeout(() => { box.hidden = true; box.textContent = ''; shareState.up = false; }, rule.SHARE_BANNER_MS);
}

if (!CONFIGURE_MODE) {
  (window.journeyShareBannerModule ? Promise.resolve(window.journeyShareBannerModule) : import(SHARE_MODULE_URL)).then((rule) => {
    if (!rule || typeof rule.shareWords !== 'function') return;
    shareState.rule = rule;
    shareState.queue = rule.createShareQueue();
  }).catch(() => { /* no banner without the rule */ });
  window.addEventListener('message', (event) => {
    if (!checkinFrame || event.source !== checkinFrame.contentWindow || event.origin !== location.origin) return;
    const d = event.data;
    if (!d || typeof d !== 'object' || d.type !== SHARES_MESSAGE || !Array.isArray(d.kids) || !shareState.queue) return;
    const kids = d.kids.slice(0, 20)
      .map((k) => ({ firstName: String((k && k.firstName) || '').split(/\s+/)[0].slice(0, 40), club: String((k && k.club) || '').slice(0, 40) }))
      .filter((k) => k.firstName);
    const shares = Number.isInteger(d.shares) && d.shares >= 1 && d.shares <= 20 ? d.shares : 0;
    if (kids.length && shares) shareState.queue.add({ kids, shares }, Date.now());
  });
  setInterval(() => {
    if (shareState.up || !shareState.queue) return;
    const gift = shareState.queue.take(Date.now(), shareVideoPlaying());
    if (gift) showShareBanner(gift);
  }, 1000);
}
