import React, { useEffect, useRef, useState } from 'react';
import { Ico } from './Icons';
import { LOGO, Shape } from './Kit';

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

type Page = 'home' | 'help' | 'classic';

const NAV: Record<Page, { href: string; label: string }[]> = {
  home: [
    { href: '#night', label: 'The night' },
    { href: '#reel', label: 'The film' },
  ],
  // The old home page, kept at /classic (owner, 2026-10-16: "don't trash the old site").
  classic: [
    { href: '#reel', label: 'Watch' },
    { href: '#features', label: 'What it does' },
    { href: '#simulator', label: 'Try it' },
    { href: '/help', label: 'Install & help' },
  ],
  help: [
    { href: '/', label: 'Home' },
    { href: '#install', label: 'Install' },
    { href: '#faq', label: 'Questions' },
    { href: '/#doors', label: 'Try it' },
  ],
};

/**
 * The church's own logo (owner 2026-10-13), in one colour: ink two-line in
 * the header, white in the footer (the full logo, tagline and all, where the
 * column is 520px or wider; two-line where it is not).
 */
export const Wordmark: React.FC<{ inverse?: boolean }> = ({ inverse }) => (
  inverse ? (
    <span className="kv-logo kv-logo--footer">
      <img className="kv-logo__full" src={LOGO.fullWhite} alt={LOGO.alt} width="520" height="133" />
      <img className="kv-logo__narrow" src={LOGO.twoLineWhite} alt={LOGO.alt} width="260" height="55" />
    </span>
  ) : (
    <span className="kv-logo">
      <img className="kv-logo__head" src={LOGO.twoLineInk} alt={LOGO.alt} width="260" height="55" />
    </span>
  )
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
      <header className={`kv-header kv-header--${page}${stuck ? ' is-stuck' : ''}`}>
        <div className="kv-wrap kv-header__inner">
          <a className="kv-header__home" href="/" aria-label="KVBC Awana home">
            <Wordmark />
          </a>
          <nav className="kv-nav" aria-label={page === 'help' ? 'Help' : 'On this page'}>
            <ul className="kv-nav__list">
              {NAV[page].map((l) => (
                <li key={l.href}><a className="kv-nav__link" href={l.href}>{l.label}</a></li>
              ))}
            </ul>
          </nav>
          {page !== 'home' && (
            <a className="kv-btn kv-btn--hot kv-header__cta" href={LINKS.download}>
              <Ico name="download" /><span className="kv-header__cta-word">Download</span><span className="kv-sr"> KVBC Awana for Windows</span>
            </a>
          )}
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

/** The mop that crosses the floor when the lights go out (App.tsx, Lights out). */
const Mop: React.FC = () => (
  <svg className="kv-mop" viewBox="0 0 120 160" aria-hidden="true" focusable="false">
    <rect x="57" y="0" width="7" height="112" rx="3" fill="#C97A08" />
    <rect x="34" y="106" width="53" height="12" rx="4" fill="#9AA4AE" />
    <path d="M30 118h61l6 34c1 5-3 8-8 8H31c-5 0-9-3-8-8z" fill="#E9E4D8" />
    <path d="M38 124v30M48 124v32M58 124v32M68 124v32M78 124v30" stroke="#C9C2B2" strokeWidth="4" strokeLinecap="round" />
  </svg>
);

/**
 * The quiet end of every page: the practical links (install, download, source)
 * and the trademark line. The home page keeps nothing practical above it.
 */
export const Footer: React.FC = () => (
  <footer className="kv-footer">
    <WaveEdge className="kv-footer__edge" />
    <div className="kv-footer__shine" aria-hidden="true" />
    <Mop />
    <div className="kv-wrap kv-footer__inner">
      <div className="kv-footer__lead">
        <Wordmark inverse />
        <p className="kv-footer__credit">
          Built by volunteers at <strong>Kennebec Valley Baptist Church</strong> for their own club nights. Free for any
          church, with every line of it on GitHub.
        </p>
      </div>
      <ul className="kv-footer__list">
        <li><a href="/help#install">Install guide</a></li>
        <li><a href="/help#faq">Questions</a></li>
        <li><a href={LINKS.download}>Download for Windows</a></li>
        <li><a href={LINKS.repo}>Source on GitHub</a></li>
        <li><a href={LINKS.reference}>TwoTimTwo reference</a></li>
      </ul>
    </div>
    <div className="kv-wrap kv-footer__legal">
      <p><strong>{TRADEMARK}</strong></p>
      <p>
        KVBC Awana is an independent project made by volunteers at Kennebec Valley Baptist Church; it is not sponsored,
        reviewed or approved by Awana Clubs International. TwoTimTwo is a separate service, named here only to describe
        what these tools work alongside. The screens on the home page are the real software playing a made-up night:
        every child’s name on them is made up.
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
