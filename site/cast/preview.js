// Cast: the phone's preview of the slides on the TV (owner 2026-11-08: "Support pptx
// upload and show a preview on the phone screen"; current + next, like the
// Presentation controls). Shown while a PDF (a PDF, a converted PowerPoint, Google
// Slides) is up on the TV:
//   - the slide on the TV, big, with "Slide 3 of 12";
//   - the next slide, smaller, beside Back / Next;
//   - a strip of every slide; a tap puts that slide on the TV (press page {to}).
// The PDF is the room's own file (GET /v1/cast/files/:id with this page's token, or the
// file the presenter just chose, never fetched twice), drawn by pdf.js (cdnjs, the
// version the TV uses), loaded on the first slides. A press shows at once here and
// the TV's answer (the 2 s state poll) confirms it. Strip thumbnails are drawn only
// when scrolled into view; the big slides keep a few drawn pages so Next is instant.
// No pdf.js (offline, blocked): Back/Next and the slide number still work.

import { slideView } from '/cast/logic.js';

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
/** A press shows here before the TV confirms it, at most this long. */
export const PENDING_MS = 4000;
const BIG_KEEP = 8;
const THUMB_CSS_PX = 128;

let libPromise = null;
function pdfLib() {
  if (window.castPdfLib) return Promise.resolve(window.castPdfLib);
  if (!libPromise) {
    libPromise = new Promise((resolve, reject) => {
      if (window.pdfjsLib) { resolve(window.pdfjsLib); return; }
      const s = document.createElement('script');
      s.src = `${PDFJS}pdf.min.js`;
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS}pdf.worker.min.js`;
        resolve(window.pdfjsLib);
      };
      s.onerror = () => { libPromise = null; reject(new Error('pdf.js')); };
      document.head.append(s);
    });
  }
  return libPromise;
}

/**
 * @param {{
 *   root: HTMLElement,
 *   fetchPdf: (fileId: string) => Promise<ArrayBuffer | null>,
 *   go: (to: number, step?: number) => void,
 * }} o
 */
export function createPreview({ root, fetchPdf, go }) {
  const q = (sel) => /** @type {any} */ (root.querySelector(sel));
  const nowCanvas = q('[data-slide="now"]');
  const nextCanvas = q('[data-slide="next"]');
  const nextBox = q('[data-slide-box="next"]');
  const label = q('[data-slide-label]');
  const strip = q('[data-slide-strip]');
  const backBtn = q('[data-step="-1"]');
  const nextBtn = q('[data-step="1"]');

  /** @type {{ file: string, doc: any, pages: number, big: Map<number, HTMLCanvasElement>, thumbs: Set<number> } | null} */
  let cur = null;
  let loadingFile = '';
  let failedFile = '';
  let tvPage = 1;
  let reported = 0;
  /** @type {{ page: number, until: number } | null} */
  let pending = null;
  let drawn = { now: 0, next: -1 };
  let observer = null;

  const local = new Map(); // fileId -> Blob the presenter chose (never fetched again)

  function pages() { return cur ? cur.pages : reported; }
  function shownPage() {
    if (pending && Date.now() < pending.until && pending.page !== tvPage) return pending.page;
    pending = null;
    return tvPage;
  }

  async function open(file) {
    loadingFile = file;
    root.dataset.preview = 'loading';
    try {
      const lib = await pdfLib();
      const blob = local.get(file);
      const data = blob ? await blob.arrayBuffer() : await fetchPdf(file);
      if (!data) throw new Error('no file');
      const doc = await lib.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
      if (loadingFile !== file) { doc.destroy(); return; }
      if (cur) cur.doc.destroy();
      cur = { file, doc, pages: doc.numPages, big: new Map(), thumbs: new Set() };
      drawn = { now: 0, next: -1 };
      buildStrip();
      root.dataset.preview = 'ready';
      draw();
    } catch {
      if (loadingFile === file) { failedFile = file; root.dataset.preview = 'none'; }
    } finally {
      if (loadingFile === file) loadingFile = '';
    }
  }

  /** One page drawn at a width (CSS px), as its own canvas. */
  async function render(n, cssWidth) {
    const page = await cur.doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scale = Math.min((cssWidth * dpr) / base.width, 1600 / base.width);
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width);
    c.height = Math.round(vp.height);
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    return c;
  }

  async function big(n) {
    const doc = cur;
    if (doc.big.has(n)) return doc.big.get(n);
    const c = await render(n, Math.max(nowCanvas.clientWidth || 360, 320));
    if (cur !== doc) return null;
    doc.big.set(n, c);
    while (doc.big.size > BIG_KEEP) doc.big.delete(doc.big.keys().next().value);
    return c;
  }

  function paint(target, src) {
    if (!src) return;
    target.width = src.width;
    target.height = src.height;
    target.getContext('2d').drawImage(src, 0, 0);
    // The slide eases in (church.css motion; nothing under "reduce motion").
    target.classList.remove('m-again');
    void target.offsetWidth;
    target.classList.add('m-again');
  }

  async function draw() {
    const v = slideView(shownPage(), pages());
    label.textContent = v.label;
    backBtn.disabled = v.first;
    nextBtn.disabled = v.last;
    for (const b of strip.children) b.setAttribute('aria-current', String(Number(b.dataset.page) === v.now));
    nextBox.dataset.end = String(v.last);
    if (!cur) return;
    const doc = cur;
    if (drawn.now !== v.now) {
      drawn.now = v.now;
      const c = await big(v.now).catch(() => null);
      if (cur === doc && drawn.now === v.now) paint(nowCanvas, c);
      const active = strip.querySelector(`[data-page="${v.now}"]`);
      if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }
    if (drawn.next !== v.next) {
      drawn.next = v.next;
      if (v.next) {
        const c = await big(v.next).catch(() => null);
        if (cur === doc && drawn.next === v.next) paint(nextCanvas, c);
      }
    }
    // The one after next, ready before it is asked for.
    if (v.next && v.next < doc.pages) big(v.next + 1).catch(() => {});
  }

  function buildStrip() {
    if (observer) observer.disconnect();
    strip.textContent = '';
    observer = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => { for (const e of entries) if (e.isIntersecting) thumb(Number(e.target.dataset.page), e.target); }, { root: strip, rootMargin: '0px 200px' })
      : null;
    for (let n = 1; n <= cur.pages; n += 1) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'strip-slide';
      b.dataset.page = String(n);
      b.setAttribute('aria-label', `Show slide ${n} on the TV`);
      const c = document.createElement('canvas');
      const num = document.createElement('span');
      num.textContent = String(n);
      b.append(c, num);
      b.addEventListener('click', () => jump(n));
      strip.append(b);
      if (observer) observer.observe(b); else thumb(n, b);
    }
  }

  async function thumb(n, el) {
    const doc = cur;
    if (!doc || doc.thumbs.has(n)) return;
    doc.thumbs.add(n);
    try {
      const c = await render(n, THUMB_CSS_PX);
      if (cur === doc) paint(el.querySelector('canvas'), c);
    } catch { doc.thumbs.delete(n); }
  }

  function jump(n) {
    const v = slideView(n, pages());
    pending = { page: v.now, until: Date.now() + PENDING_MS };
    draw();
    go(v.now);
  }

  backBtn.addEventListener('click', () => {
    const v = slideView(shownPage() - 1, pages());
    pending = { page: v.now, until: Date.now() + PENDING_MS };
    draw();
    go(0, -1);
  });
  nextBtn.addEventListener('click', () => {
    const v = slideView(shownPage() + 1, pages());
    pending = { page: v.now, until: Date.now() + PENDING_MS };
    draw();
    go(0, 1);
  });

  return {
    /** The presenter chose this file (keep it: no download for the preview). @param {string} file @param {Blob} blob */
    remember(file, blob) { local.set(file, blob); },
    /** A PDF is on the TV at this page. @param {string} file @param {number} page @param {number} pagesReported */
    show(file, page, pagesReported) {
      root.hidden = false;
      tvPage = page || 1;
      reported = pagesReported || 0;
      if ((!cur || cur.file !== file) && loadingFile !== file && failedFile !== file) open(file);
      draw();
    },
    hide() {
      root.hidden = true;
      pending = null;
    },
  };
}
