import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

/*
 * One REAL screen on the home page (owner, 2026-10-16): a showcase twin of the
 * lobby, the projector, Journey, /checkin or /settings (site/build.mjs makes
 * them; site/showcase/stub.js stands in for the Worker, the clock and storage).
 *
 * - Drawn at its own native size (a 1600x900 TV, a 390x844 phone) and scaled to
 *   the frame it sits in, so it lays out exactly as it does in the room.
 * - Loaded only near the viewport and let go when far away (`keep` keeps it), so
 *   a phone runs the one or two in front of it.
 * - Talks by postMessage, same origin only: `send()` hands it a clock, a live
 *   frame or a click; `onEvent` hears what it tells (a check-in on /checkin).
 * - Only the check-in phone takes the reader's taps; the rest are pictures.
 */
export type TwinKind = 'lobby' | 'projector' | 'settings' | 'journey' | 'checkin';

const SRC: Record<TwinKind, string> = {
  lobby: '/lobby/showcase.html',
  projector: '/lobby/countdown-showcase.html',
  settings: '/lobby/settings-showcase.html',
  journey: '/journey/showcase.html',
  checkin: '/checkin/showcase.html',
};

export interface TwinHandle {
  send: (msg: Record<string, unknown>) => void;
  loaded: () => boolean;
}

interface Props {
  kind: TwinKind;
  /** Wall-clock start time on the night, e.g. '2026-10-14T18:00:30'. */
  at: string;
  width: number;
  height: number;
  title: string;
  interactive?: boolean;
  onEvent?: (what: string, data: Record<string, unknown>) => void;
  onReady?: () => void;
  className?: string;
}

export const Twin = forwardRef<TwinHandle, Props>(({ kind, at, width, height, title, interactive, onEvent, onReady, className = '' }, ref) => {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  const [near, setNear] = useState(false);
  const [scale, setScale] = useState(0);

  // Near the viewport: load. Far away: let go (a fresh night next time).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return; }
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin: '60% 0px 60% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / width);
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  useEffect(() => { if (!near) ready.current = false; }, [near]);

  const handlers = useRef({ onEvent, onReady });
  handlers.current = { onEvent, onReady };
  useEffect(() => {
    const listen = (e: MessageEvent) => {
      const win = frame.current && frame.current.contentWindow;
      if (!win || e.source !== win || e.origin !== window.location.origin) return;
      const m = e.data;
      if (!m || m.type !== 'showcase:event' || typeof m.what !== 'string') return;
      if (m.what === 'ready') { ready.current = true; handlers.current.onReady?.(); }
      handlers.current.onEvent?.(m.what, m.data || {});
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, []);

  const send = useCallback((msg: Record<string, unknown>) => {
    const win = frame.current && frame.current.contentWindow;
    if (win && ready.current) win.postMessage(msg, window.location.origin);
  }, []);
  useImperativeHandle(ref, () => ({ send, loaded: () => ready.current }), [send]);

  return (
    <div ref={box} className={`kv-twin kv-twin--${kind} ${className}`} style={{ aspectRatio: `${width} / ${height}` }}>
      {near && scale > 0 && (
        <iframe
          ref={frame}
          className="kv-twin__frame"
          src={`${SRC[kind]}?at=${encodeURIComponent(at)}`}
          title={title}
          width={width}
          height={height}
          loading="lazy"
          tabIndex={interactive ? 0 : -1}
          aria-hidden={interactive ? undefined : true}
          allow="autoplay"
          style={{ width, height, transform: `scale(${scale})`, pointerEvents: interactive ? 'auto' : 'none' }}
        />
      )}
    </div>
  );
});
Twin.displayName = 'Twin';
