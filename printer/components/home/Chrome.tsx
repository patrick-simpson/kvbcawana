import React, { useEffect, useRef, useState } from 'react';
import { Ico } from './Icons';
import { Shape } from './Kit';

export const LINKS = {
  repo: 'https://github.com/patrick-simpson/kvbcawana',
  srcPrinter: 'https://github.com/patrick-simpson/kvbcawana/tree/main/printer',
  srcLobby: 'https://github.com/patrick-simpson/kvbcawana/tree/main/lobby',
  srcJourney: 'https://github.com/patrick-simpson/kvbcawana/tree/main/journey',
  download: '/download/kvbc-awana',
  reference: '/capabilities.html',
} as const;

/**
 * The trademark line, word for word as the owner set it (2026-10-11). It is
 * in the disclaimer bar, the footer and both pages' meta description.
 */
export const TRADEMARK = 'Awana® and club marks are trademarks of Awana Clubs International, used here by a member church. Not affiliated with or endorsed by Awana.';

type Page = 'home' | 'help';

const NAV: Record<Page, { href: string; label: string }[]> = {
  home: [
    { href: '#reel', label: 'Watch' },
    { href: '#features', label: 'What it does' },
    { href: '#simulator', label: 'Try it' },
    { href: '/help', label: 'Install & help' },
  ],
  help: [
    { href: '/', label: 'Home' },
    { href: '#install', label: 'Install' },
    { href: '#faq', label: 'Questions' },
    { href: '/#simulator', label: 'Try it' },
  ],
};

/** The wordmark: the app's own name, set in the kit's voices. */
export const Wordmark: React.FC<{ inverse?: boolean }> = ({ inverse }) => (
  <span className={`kv-mark${inverse ? ' kv-mark--inverse' : ''}`}>
    <span className="kv-mark__badge" aria-hidden="true">
      <Shape name="starburst" className="kv-mark__burst" />
      <Ico name="label" className="kv-mark__glyph" />
    </span>
    <span className="kv-mark__words">
      <span className="kv-mark__name">KVBC Awana</span>
      <span className="kv-mark__sub">Club night tools</span>
    </span>
  </span>
);

export const Header: React.FC<{ page: Page }> = ({ page }) => {
  const [stuck, setStuck] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <>
      <p className="kv-disclaimer" role="note">{TRADEMARK}</p>
      <div ref={sentinel} className="kv-sentinel" aria-hidden="true" />
      <header className={`kv-header${stuck ? ' is-stuck' : ''}`}>
        <div className="kv-wrap kv-header__inner">
          <a className="kv-header__home" href="/" aria-label="KVBC Awana home">
            <Wordmark />
          </a>
          <nav className="kv-nav" aria-label={page === 'home' ? 'On this page' : 'Help'}>
            <ul className="kv-nav__list">
              {NAV[page].map((l) => (
                <li key={l.href}><a className="kv-nav__link" href={l.href}>{l.label}</a></li>
              ))}
            </ul>
          </nav>
          <a className="kv-btn kv-btn--hot kv-header__cta" href={LINKS.download}>
            <Ico name="download" />Download<span className="kv-sr"> KVBC Awana for Windows</span>
          </a>
        </div>
      </header>
    </>
  );
};

/** A full-width wave edge between two colour fields (the kit's club wave). */
export const WaveEdge: React.FC<{ className?: string; flip?: boolean }> = ({ className = '', flip }) => (
  <div className={`kv-edge${flip ? ' kv-edge--flip' : ''} ${className}`} aria-hidden="true">
    <Shape name="wave-tnt" className="kv-edge__back" stretch />
    <Shape name="wave-sparks" className="kv-edge__front" stretch />
  </div>
);

export const Footer: React.FC = () => (
  <footer className="kv-footer">
    <WaveEdge className="kv-footer__edge" />
    <div className="kv-wrap kv-footer__inner">
      <div className="kv-footer__lead">
        <Wordmark inverse />
        <p className="kv-footer__credit">
          Built by and for <strong>Kennebec Valley Baptist Church</strong>, so every child at club is welcomed by name.
          Free for any church, with every line of its source on GitHub.
        </p>
      </div>
      <div className="kv-footer__cols">
        <div>
          <h2 className="kv-footer__head">Get started</h2>
          <ul className="kv-footer__list">
            <li><a href="/help#install">Install guide</a></li>
            <li><a href="/help#faq">Questions volunteers ask</a></li>
            <li><a href={LINKS.download}>Download for Windows</a></li>
          </ul>
        </div>
        <div>
          <h2 className="kv-footer__head">Under the hood</h2>
          <ul className="kv-footer__list">
            <li><a href={LINKS.reference}>TwoTimTwo reference</a></li>
            <li><a href={LINKS.srcPrinter}>Label printer source</a></li>
            <li><a href={LINKS.srcLobby}>Lobby and projector source</a></li>
            <li><a href={LINKS.srcJourney}>Journey kiosk source</a></li>
          </ul>
        </div>
      </div>
    </div>
    <div className="kv-wrap kv-footer__legal">
      <p><strong>{TRADEMARK}</strong></p>
      <p>
        KVBC Awana is an independent project made by volunteers at Kennebec Valley Baptist Church for its own club
        nights; it is not sponsored, reviewed or approved by Awana Clubs International. TwoTimTwo is a separate
        service, named here only to describe what these tools work alongside. Screens on this page are drawn for
        illustration, and every child’s name on it is an example.
      </p>
    </div>
  </footer>
);

/**
 * Adds `is-in` to an element the first time it scrolls into view, which starts
 * its entrance (CSS). Without IntersectionObserver, or with reduced motion,
 * it is in at once.
 */
export function useInView<T extends HTMLElement>(threshold = 0.25): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || typeof IntersectionObserver === 'undefined') { setInView(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setInView(true); io.disconnect(); } }, { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, inView];
}
