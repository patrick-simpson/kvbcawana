/* ── Leader handout viewer ────────────────────────────────────────────
   Each Leader Video has a one-page summary PDF (public/handouts/,
   generated from its transcript in public/transcripts/ — see CLAUDE.md).
   Shown full-screen in an iframe via Chromium's built-in PDF viewer, so
   the kiosk never leaves the page or opens a tab. */
function handoutUrl(week) {
  return `handouts/week-${String(week).padStart(2, '0')}-leader-handout.pdf`;
}

let handoutObjectUrl = null;

// The current week's handout is prefetched into the Cache API by
// cacheLessonBundle(); serving it as a blob URL means opening it needs no
// network. Other weeks fall back to the live URL (Chromium's PDF viewer
// streams it), and the ~55KB PDF is small enough that this stays a
// degraded-not-dead path: the overlay and its Close button appear instantly
// and never wait on the fetch. PURE, like cachedCaptionBlobUrl(): returns a
// fresh blob URL or null, and openHandout() commits it to handoutObjectUrl
// only after confirming the open it belongs to is still the current one.
async function cachedHandoutBlobUrl(url) {
  if (!('caches' in window)) return null;
  try {
    const hit = await caches.match(url);
    if (!hit) return null;
    return URL.createObjectURL(await hit.blob());
  } catch {
    return null;
  }
}

// Identity of the latest open — a slow cache read for handout A must not
// land its PDF into an overlay that has since been closed and reopened
// showing handout B's title.
let handoutRequestId = 0;

function openHandout(lesson) {
  const requestId = ++handoutRequestId;
  handoutTitle.textContent = `Week ${lesson.week} — ${lesson.title} (Leader Handout)`;
  handoutView.classList.remove('hidden');
  handoutCloseBtn.focus();
  const url = handoutUrl(lesson.week);
  cachedHandoutBlobUrl(url).then((blobUrl) => {
    if (requestId !== handoutRequestId) {
      // Closed or replaced while the cache read was in flight — discard our
      // blob rather than clobbering (and revoking) the newer open's.
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      return;
    }
    if (blobUrl) {
      if (handoutObjectUrl) URL.revokeObjectURL(handoutObjectUrl);
      handoutObjectUrl = blobUrl;
      handoutFrame.src = blobUrl;
    } else {
      handoutFrame.src = url;
    }
  });
}

function closeHandout() {
  ++handoutRequestId; // abandon any still-resolving open
  handoutView.classList.add('hidden');
  // Drop the PDF viewer's memory the moment it's closed — same 512MB-Pi
  // hygiene as detaching the <video> element's src.
  handoutFrame.removeAttribute('src');
  if (handoutObjectUrl) {
    URL.revokeObjectURL(handoutObjectUrl);
    handoutObjectUrl = null;
  }
}

handoutCloseBtn.addEventListener('click', closeHandout);

