import { useEffect } from 'react';
import { sanitizeTheme } from '../lib/theme.js';
import { applyClubOverrides } from '../lib/clubs.js';

// Fetch the shared theme.json (published by the countdown repo's Pages
// site), preload any club art it references, then apply the overrides
// to clubs.js. Cache-first so banner colors are right from the first
// paint even offline; 6-hour refresh matches useSchedule.
const CACHE_KEY = 'awanaTheme.v1';
const REFRESH_MS = 6 * 60 * 60 * 1000;

function preloadImages(overrides) {
  const urls = Object.values(overrides).map((o) => o.logoUrl).filter(Boolean);
  return Promise.all(urls.map((url) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  })));
}

export function useTheme(config) {
  const url = config.sharedThemeUrl;

  useEffect(() => {
    // Apply the cached copy immediately (no flash of baked colors).
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
      const clean = sanitizeTheme(cached?.raw, cached?.baseUrl || url || 'https://invalid.example/');
      if (clean) applyClubOverrides(clean);
    } catch { /* no cache */ }

    if (!url) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) return;
        const raw = await res.json();
        const clean = sanitizeTheme(raw, url);
        if (!clean || cancelled) return;
        // Preload art before applying so a banner never pops a broken img.
        await preloadImages(clean);
        if (cancelled) return;
        applyClubOverrides(clean);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ raw, baseUrl: url, fetchedAt: Date.now() })); } catch { /* ignore */ }
      } catch { /* offline — cache/baked values carry on */ }
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [url]);
}
