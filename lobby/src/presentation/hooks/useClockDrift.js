import { useEffect, useState } from 'react';

// A wrong device clock is this tool's worst failure mode — the whole
// screen is a countdown to a wall-clock time. Once at load (and again
// every 6 hours) compare local time against the HTTP Date header of our
// own origin; the header has second granularity and every static host
// (GitHub Pages included) sends it. Fails silently to "no verdict" —
// offline kiosks just don't get the check.
const SKEW_WARN_MS = 2 * 60 * 1000;
const RECHECK_MS = 6 * 60 * 60 * 1000;

async function measureSkewMs() {
  try {
    const res = await fetch(window.location.href, { method: 'HEAD', cache: 'no-store' });
    const header = res.headers.get('date');
    if (!header) return null;
    const serverMs = Date.parse(header);
    if (Number.isNaN(serverMs)) return null;
    // Date headers truncate to the second; only whole-minute-scale skew
    // matters here, so no need to model latency.
    return Date.now() - serverMs;
  } catch {
    return null;
  }
}

/** Milliseconds of local-clock skew (signed), or null when unknown/fine. */
export function useClockDrift() {
  const [skewMs, setSkewMs] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const skew = await measureSkewMs();
      if (!cancelled) setSkewMs(skew !== null && Math.abs(skew) >= SKEW_WARN_MS ? skew : null);
    };
    check();
    const timer = setInterval(check, RECHECK_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  return skewMs;
}
