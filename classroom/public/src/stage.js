// The Sparks remote's half of the classroom screen (owner 2026-10-18;
// worker/src/routes.md 10.13). The remote (../remote/) presses a button; the
// sync Worker keeps the STAGE (what this screen should show); this module
// reads it, sweeps the handbook's arcs across the screen and shows the video,
// picture, PDF page or text underneath, until someone presses Back (the
// remote wins over the schedule, owner). A /settings preview of one look
// (stage.preview) is handed to app.js, which shows that look for its minute.
//
// - Signed in through the embedded lobby's sign-in (the shared slot
//   awanaSyncSession.v1, same origin); not signed in = nothing here runs.
// - Reads GET /v1/classroom/stage when the embedded lobby passes the doorbell
//   up (`awana-display:sync-doorbell`, what 'classroom', checked: its own
//   frame, its own origin) and every POLL_MS as the fallback.
// - Momentary commands (a video's pause, seek, volume; Sparky's flight) are
//   run once by id; ones from before this page loaded are not.
// - Reports what it shows (POST /v1/classroom/now) only while a remote
//   watches (the Worker's `watch`): on a change, and every 10 s in a video.
// - YouTube: the privacy-enhanced player (youtube-nocookie.com) through
//   YouTube's own IFrame API, no controls, no related videos. Its ads are
//   YouTube's (owner accepted). Pictures and PDFs come from the Worker (it
//   copied every link), read with the session into a blob URL; PDFs are drawn
//   by pdf.js (cdnjs, loaded the first time a PDF shows).

const SESSION_KEY = 'awanaSyncSession.v1';
const SESSION_RE = /^v1\.\d+\.\d+\.[A-Za-z0-9_-]{20,}$/;
export const DOORBELL_MESSAGE = 'awana-display:sync-doorbell';
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
const YT_API = 'https://www.youtube.com/iframe_api';
const TUNING = { pollMs: 5000, reportVideoMs: 10000, swoopMs: 1100, swapAtMs: 500, timeoutMs: 8000 };
const tuning = () => Object.assign({}, TUNING, window.classroomStageTuning || {});

/**
 * @param {{
 *   rules: any, root: HTMLElement, frame: HTMLIFrameElement | null, motionOk: () => boolean,
 *   screen: () => { phase: string, board: boolean }, onChange: () => void, onShow: () => void,
 * }} deps
 */
export async function createStage(deps) {
  const R = deps.rules;
  const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
  const layer = $('show');
  const swoop = $('swoop');
  const loadedAt = Date.now();
  let base = '';
  let stage = R.sanitizeStage(null);
  let skew = 0; // server clock minus ours
  let watch = false;
  let showKey = ''; // which show is drawn (button id + when it went up)
  let shownPage = 0;
  let pdfDoc = null; // { file, doc }
  let pdfPages = 0;
  let player = null; // the YouTube player
  let playerReady = false;
  let blobUrl = '';
  let lastReport = '';
  let reportTimer = 0;
  let busy = Promise.resolve();
  const ran = new Set();

  const session = () => {
    let s = '';
    try { s = (localStorage.getItem(SESSION_KEY) || '').trim(); } catch { /* none */ }
    return SESSION_RE.test(s) ? s : '';
  };

  async function request(path, opts = {}) {
    const s = session();
    if (!base || !s) return { ok: false, status: 0, body: null };
    try {
      const res = await fetch(base + path, {
        method: opts.method || 'GET',
        headers: { Authorization: `Bearer ${s}`, ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        cache: 'no-store',
        signal: AbortSignal.timeout ? AbortSignal.timeout(tuning().timeoutMs) : undefined,
      });
      if (opts.raw) return { ok: res.ok, status: res.status, res };
      return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
    } catch { return { ok: false, status: 0, body: null }; }
  }

  /* ── The service's address: the site's shared/sync.json ── */
  try {
    if (typeof window.classroomSyncBase === 'string') base = window.classroomSyncBase;
    else {
      const r = await fetch(new URL('../lobby/shared/sync.json', window.location.href).href, { cache: 'no-store' });
      const d = r.ok ? await r.json() : null;
      const url = d && typeof d.url === 'string' ? d.url.trim().replace(/\/+$/, '') : '';
      if (/^https:\/\/[^\s?#]+$/.test(url)) base = url;
    }
  } catch { /* no service: nothing here runs */ }

  /* ── Reading the stage ── */
  async function read() {
    const r = await request('/v1/classroom/stage');
    if (!r.ok || !r.body) return;
    if (typeof r.body.serverNow === 'number') skew = r.body.serverNow - Date.now();
    watch = r.body.watch === true;
    apply(R.sanitizeStage(r.body.stage));
  }
  const serverNow = () => Date.now() + skew;

  function apply(next) {
    stage = next;
    const key = next.show ? `${next.show.button.id}@${next.show.at}` : '';
    if (key !== showKey) {
      const was = showKey;
      showKey = key;
      busy = busy.then(() => change(next.show, Boolean(was))).catch(() => {});
    } else if (next.show && next.show.button.kind === 'pdf' && next.show.page !== shownPage) {
      busy = busy.then(() => drawPdfPage(next.show.page, true)).catch(() => {});
    }
    for (const c of next.cmds) {
      if (ran.has(c.id)) continue;
      ran.add(c.id);
      // A command from before this page loaded (a reload) is not run again.
      if (c.at - skew < loadedAt - 1000) continue;
      if (c.action === 'sparky') sparky();
      if (c.action === 'video') videoCmd(c.data);
    }
    deps.onChange();
    report();
  }

  /* ── The handbook swoop: yellow and teal arcs sweep across; the change happens under them ── */
  function sweep(swap, back) {
    if (!deps.motionOk()) { swap(); return Promise.resolve(); }
    const t = tuning();
    swoop.classList.remove('is-sweeping', 'is-back');
    void swoop.offsetWidth;
    swoop.style.setProperty('--swoop-ms', `${t.swoopMs}ms`);
    swoop.classList.add('is-sweeping');
    if (back) swoop.classList.add('is-back');
    return new Promise((done) => {
      setTimeout(() => { try { swap(); } finally { setTimeout(() => { swoop.classList.remove('is-sweeping', 'is-back'); done(); }, t.swoopMs - t.swapAtMs); } }, t.swapAtMs);
    });
  }

  async function change(show) {
    // Fetch first (a picture or a PDF), so the sweep uncovers it whole.
    let prepared = null;
    if (show && (show.button.kind === 'image' || show.button.kind === 'pdf')) prepared = await fetchFile(show.button.file);
    if (show && showKey !== `${show.button.id}@${show.at}`) return; // replaced while fetching
    await sweep(() => {
      clear();
      if (!show) { layer.hidden = true; root().removeAttribute('data-show'); deps.onShow(); return; }
      layer.hidden = false;
      root().dataset.show = show.button.kind;
      deps.onShow();
      const b = show.button;
      if (b.kind === 'video') playVideo(b);
      else if (b.kind === 'text') drawText(b);
      else if (b.kind === 'image') drawImage(prepared);
      else if (b.kind === 'pdf') { shownPage = 0; openPdf(b.file, prepared, show.page); }
    }, !show);
  }
  const root = () => deps.root;

  function clear() {
    if (player) { try { player.destroy(); } catch { /* gone */ } }
    player = null;
    playerReady = false;
    layer.replaceChildren();
    layer.className = 'cr-layer cr-show';
    if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = ''; }
    pdfPages = 0;
    shownPage = 0;
  }

  async function fetchFile(file) {
    const r = await request(`/v1/classroom/files/${encodeURIComponent(file)}`, { raw: true });
    if (!r.ok) return null;
    try { return await r.res.blob(); } catch { return null; }
  }

  /* ── Text: the handbook page or the black board, as big as fits ── */
  function drawText(b) {
    layer.classList.add(b.look === 'board' ? 'cr-show--board' : 'cr-show--page');
    const page = document.createElement('div');
    page.className = 'cr-show-page';
    if (b.heading) {
      const h = document.createElement('p');
      h.className = 'cr-show-heading';
      h.textContent = b.heading;
      page.append(h);
    }
    const words = document.createElement('p');
    words.className = 'cr-show-words';
    words.textContent = b.text;
    page.append(words);
    layer.append(page);
    fitText(words, page);
  }

  /** The biggest size (in u) at which the words fit their page. */
  function fitText(el, box) {
    let lo = 2;
    let hi = 16;
    for (let i = 0; i < 14; i += 1) {
      const mid = (lo + hi) / 2;
      el.style.setProperty('--words-size', String(mid));
      if (box.scrollHeight <= box.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1) lo = mid; else hi = mid;
    }
    el.style.setProperty('--words-size', String(lo));
  }

  /* ── A picture ── */
  function drawImage(blob) {
    layer.classList.add('cr-show--image');
    if (!blob) { missing('The picture could not be loaded.'); return; }
    blobUrl = URL.createObjectURL(blob);
    const img = document.createElement('img');
    img.className = 'cr-show-img';
    img.alt = '';
    img.src = blobUrl;
    layer.append(img);
  }

  function missing(words) {
    const p = document.createElement('p');
    p.className = 'cr-show-missing';
    p.textContent = words;
    layer.append(p);
  }

  /* ── A PDF, one page at a time ── */
  async function pdfLib() {
    if (window.classroomPdfLib) return window.classroomPdfLib;
    if (window.pdfjsLib) return window.pdfjsLib;
    await new Promise((ok, no) => {
      const s = document.createElement('script');
      s.src = `${PDFJS}pdf.min.js`;
      s.onload = ok;
      s.onerror = no;
      document.head.append(s);
    });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS}pdf.worker.min.js`;
    return window.pdfjsLib;
  }

  async function openPdf(file, blob, page) {
    layer.classList.add('cr-show--pdf');
    if (!blob) { missing('The PDF could not be loaded.'); return; }
    try {
      const lib = await pdfLib();
      const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
      pdfDoc = { file, doc };
      pdfPages = doc.numPages;
      await drawPdfPage(page, false);
    } catch { missing('The PDF could not be opened.'); }
  }

  async function drawPdfPage(page, animate) {
    if (!pdfDoc || !pdfPages) return;
    const n = Math.min(Math.max(1, page), pdfPages);
    const p = await pdfDoc.doc.getPage(n);
    const ratio = window.devicePixelRatio || 1;
    const v1 = p.getViewport({ scale: 1 });
    const scale = Math.min(window.innerWidth / v1.width, window.innerHeight / v1.height) * ratio;
    const viewport = p.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.className = 'cr-show-pdf';
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await p.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const old = layer.querySelector('.cr-show-pdf');
    if (animate && deps.motionOk()) canvas.classList.add('is-turning');
    if (old) old.replaceWith(canvas); else layer.append(canvas);
    shownPage = n;
    report();
  }

  /* ── YouTube ── */
  function ytApi() {
    if (window.classroomYouTube) return Promise.resolve(window.classroomYouTube);
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    return new Promise((ok) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (typeof prev === 'function') prev(); ok(window.YT); };
      if (!document.querySelector(`script[src="${YT_API}"]`)) {
        const s = document.createElement('script');
        s.src = YT_API;
        document.head.append(s);
      }
    });
  }

  async function playVideo(b) {
    layer.classList.add('cr-show--video');
    const host = document.createElement('div');
    host.id = 'cr-yt';
    layer.append(host);
    const YT = await ytApi();
    if (!layer.contains(host)) return;
    player = new YT.Player(host, {
      host: 'https://www.youtube-nocookie.com',
      videoId: b.youtube,
      width: '100%',
      height: '100%',
      playerVars: { autoplay: 1, controls: 0, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3, fs: 0, disablekb: 1, start: b.start || 0, origin: window.location.origin },
      events: {
        onReady: (e) => { playerReady = true; try { e.target.playVideo(); } catch { /* blocked */ } report(); },
        onStateChange: (e) => {
          if (e.data === 0) ended();
          report();
        },
      },
    });
  }

  /** The video finished: back to the schedule for everyone (owner). */
  function ended() {
    const at = stage.show && stage.show.at;
    request('/v1/classroom/remote', { method: 'POST', body: { action: 'back' } }).then((r) => {
      // The service could not be told: take it down here anyway.
      if (!r.ok && stage.show && stage.show.at === at) apply({ ...stage, show: null });
    });
  }

  function videoCmd(d) {
    if (!player || !playerReady || !d) return;
    try {
      const paused = player.getPlayerState() !== 1;
      if (d.op === 'toggle') { if (paused) player.playVideo(); else player.pauseVideo(); }
      if (d.op === 'play') player.playVideo();
      if (d.op === 'pause') player.pauseVideo();
      if (d.op === 'mute') player.mute();
      if (d.op === 'unmute') player.unMute();
      if (d.op === 'seek') player.seekTo(Math.max(0, player.getCurrentTime() + d.by), true);
      if (d.op === 'volume') {
        const v = Math.min(100, Math.max(0, Math.round((player.getVolume() + d.step * R.CLASSROOM_VOLUME_STEP_PCT) / 10) * 10));
        player.setVolume(v);
        if (v > 0 && player.isMuted()) player.unMute();
      }
    } catch { /* the player is not ready */ }
    setTimeout(report, 250);
  }

  /** The black board went up over a video: hold it there. */
  function pauseVideo() {
    if (player && playerReady) { try { player.pauseVideo(); } catch { /* fine */ } }
  }

  /* ── Sparky's flight (the easter egg: a long press on the remote's mark) ── */
  function sparky() {
    if (!deps.motionOk()) return;
    const s = $('sparky-fly');
    s.classList.remove('is-flying');
    void s.offsetWidth;
    s.classList.add('is-flying');
    setTimeout(() => s.classList.remove('is-flying'), 2600);
    whoosh();
  }

  function whoosh() {
    try {
      const ctx = new AudioContext();
      const len = Math.floor(ctx.sampleRate * 1.1);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < len; i += 1) ch[i] = (Math.random() * 2 - 1) * Math.sin((Math.PI * i) / len);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 1.4;
      f.frequency.setValueAtTime(300, ctx.currentTime);
      f.frequency.exponentialRampToValueAtTime(2400, ctx.currentTime + 0.55);
      f.frequency.exponentialRampToValueAtTime(500, ctx.currentTime + 1.1);
      const g = ctx.createGain();
      g.gain.value = 0.22;
      src.connect(f).connect(g).connect(ctx.destination);
      src.start();
      src.onended = () => ctx.close();
    } catch { /* no sound here */ }
  }

  /* ── The report (only while a remote watches) ── */
  function nowReport() {
    const sc = deps.screen();
    const b = stage.show && stage.show.button;
    const out = { view: b ? b.kind : sc.board ? 'board' : sc.phase || 'off' };
    if (b) { out.button = b.id; out.title = b.title; }
    if (b && b.kind === 'pdf' && pdfPages) { out.page = shownPage || 1; out.pages = pdfPages; }
    if (b && b.kind === 'video' && player && playerReady) {
      try { out.video = { t: player.getCurrentTime(), d: player.getDuration(), paused: player.getPlayerState() !== 1, muted: player.isMuted(), volume: player.getVolume() }; } catch { /* not yet */ }
    }
    if (previewLook()) out.preview = previewLook();
    if (sc.board) out.board = true;
    return R.sanitizeClassroomNow(out);
  }

  function report(force) {
    if (!watch) return;
    const now = nowReport();
    if (!now) return;
    const text = JSON.stringify(now);
    if (!force && text === lastReport) return;
    lastReport = text;
    request('/v1/classroom/now', { method: 'POST', body: { now } }).then((r) => { if (r.ok && r.body) watch = r.body.watch === true; });
  }

  function previewLook() {
    return stage.preview && stage.preview.until > serverNow() ? stage.preview.look : '';
  }

  /* ── Wiring ── */
  window.addEventListener('message', (event) => {
    if (!deps.frame || event.source !== deps.frame.contentWindow || event.origin !== window.location.origin) return;
    const d = event.data;
    if (d && typeof d === 'object' && d.type === DOORBELL_MESSAGE && d.what === 'classroom') read();
  });
  window.addEventListener('storage', (e) => { if (e.key === SESSION_KEY) read(); });
  setInterval(read, tuning().pollMs);
  reportTimer = window.setInterval(() => { if (stage.show && stage.show.button.kind === 'video') report(true); }, tuning().reportVideoMs);
  void reportTimer;
  read();

  return {
    /** The look a /settings preview asked for, or ''. */
    previewLook,
    /** What the remote has up ('' = nothing). */
    showing: () => (stage.show ? stage.show.button.kind : ''),
    pauseVideo,
    report: () => report(),
    read,
  };
}
