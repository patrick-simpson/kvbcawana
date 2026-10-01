import { useEffect, useRef } from 'react';
import {
  BUILD_BUSY_RECHECK_MS, BUILD_CHECK_MS, BUILD_ONLINE_MIN_MS, BUILD_PROBE_TIMEOUT_MS,
} from '../lib/constants.js';
import {
  buildFromHtml, fetchProbe, isTyping, pageBuild, parseVersion, probeUrl, reloadPage,
} from '../lib/buildReload.js';

/**
 * Reload this page when a newer build is live, and never before.
 *
 * Shared by both pages (the presentation page imports it too, per the
 * isolation allowlist in CLAUDE.md) because the hard part is identical on
 * each: knowing when a screen may go dark for a second. What differs is only
 * the answer to "is a room watching this", which each page passes in as
 * `isBusy`.
 *
 * Three properties are the whole point:
 *
 *  - INERT WITHOUT A STAMP. `pageBuild()` is null on the dev server and in the
 *    hermetic e2e run, and then no timer is even started. A missing or
 *    unreadable version.json is likewise "no news", never a change.
 *  - THE HTML IS CHECKED BEFORE RELOADING. GitHub Pages serves everything with
 *    `max-age=600`, so its CDN can still be handing out the previous
 *    index.html minutes after version.json has moved on. A reload that landed
 *    on the old HTML would come straight back here and loop, so the page's own
 *    HTML is fetched first and must already carry the new hash.
 *  - NO DEADLINE. A busy screen is re-asked every BUILD_BUSY_RECHECK_MS for as
 *    long as it takes. A check-in rush is never interrupted to install a
 *    cosmetic fix.
 *
 * @param {() => boolean} isBusy True while something a room is watching is on
 *   screen. Called on every tick, so it must be cheap and must not throw
 *   (a throw is read as busy, which is the safe direction).
 */
export function useBuildReload(isBusy) {
  // Latest-ref so a new `isBusy` identity every clock tick never restarts the
  // poll cycle; the effect below deliberately runs once.
  const busyRef = useRef(isBusy);
  useEffect(() => { busyRef.current = isBusy; });

  useEffect(() => {
    const own = pageBuild();
    if (!own) return undefined;

    let cancelled = false;
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let timer;
    let lastRunAt = 0;
    /** @type {string|null} */
    let pending = null;

    const busy = () => {
      if (isTyping()) return true;
      try {
        return busyRef.current() === true;
      } catch {
        return true;
      }
    };

    const probe = (path) => fetchProbe(probeUrl(path), { timeoutMs: BUILD_PROBE_TIMEOUT_MS });

    const step = async () => {
      lastRunAt = Date.now();

      if (!pending) {
        const next = parseVersion(await probe('version.json'));
        if (cancelled || !next || next === own) return;
        pending = next;
        console.warn(`[build] a newer build is live (${next}); this screen is on ${own} and will reload when the screen is free`);
      }

      if (busy()) return;

      const deployed = buildFromHtml(await probe(window.location.pathname));
      if (cancelled || deployed !== pending) return;

      // Fetching the HTML takes long enough for a check-in to land, so ask once
      // more rather than reloading over a banner that started while we waited.
      if (busy()) return;

      console.warn(`[build] reloading into build ${pending}`);
      reloadPage();
    };

    const run = () => {
      step().finally(() => {
        if (cancelled) return;
        timer = setTimeout(run, pending ? BUILD_BUSY_RECHECK_MS : BUILD_CHECK_MS);
      });
    };

    timer = setTimeout(run, BUILD_CHECK_MS);

    // A screen that was offline all afternoon should not wait out a whole
    // interval, but `online` fires in bursts when church WiFi comes back.
    const onOnline = () => {
      if (cancelled || Date.now() - lastRunAt < BUILD_ONLINE_MIN_MS) return;
      clearTimeout(timer);
      run();
    };
    window.addEventListener('online', onOnline);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener('online', onOnline);
    };
  }, []);
}
