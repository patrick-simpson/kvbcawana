import React, { useEffect, useRef, useState } from 'react';
import { Ico } from './Icons';
import { Doodle, LOGO, Shape } from './Kit';

/*
 * The demo reel at the top of the home page. The film is ONE small file,
 * /reel/reel.mp4 (960x540, about 1.5 MB), with /reel/poster.jpg as the poster: printer/public/reel/,
 * which the site build streams like Journey's big files (site/build.mjs).
 *
 * - It starts by itself, muted and inline, with a Tap for sound button and a
 *   pause button (anything that moves for more than five seconds can be paused).
 * - When it ends it goes back to the poster, with a Watch again button.
 * - With reduced motion it never starts by itself: the poster and a play
 *   button wait, and that button plays it with sound.
 * - Until the film is there (or if one fails) the frame shows the on-brand
 *   stand-in, which also sits behind the poster while it loads.
 */
const FILM = '/reel/reel.mp4';
export const POSTER = '/reel/poster.jpg';

type Mode = 'waiting' | 'playing' | 'paused' | 'ended' | 'missing';

const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The stand-in: the catalog's cover, drawn in the kit (the six club waves, the church's logo in white). */
const StandIn: React.FC<{ missing: boolean }> = ({ missing }) => (
  <div className={`kv-standin${missing ? ' is-missing' : ''}`} aria-hidden={!missing}>
    <div className="kv-standin__waves" aria-hidden="true">
      {(['journey', 'trek', 'tnt', 'sparks', 'cubbies', 'puggles'] as const).map((c, i) => (
        <Shape key={c} name={i % 2 ? 'wave-sparks' : 'wave-tnt'} stretch className={`kv-standin__wave kv-standin__wave--${c}`} />
      ))}
    </div>
    <Doodle name="sparkle-4pt" className="kv-standin__d1" />
    <Doodle name="ring" className="kv-standin__d2" />
    <Doodle name="loop" className="kv-standin__d3" />
    <img className="kv-standin__awana" src={LOGO.twoLineWhite} alt="" width="260" height="55" />
    {missing && (
      <div className="kv-standin__copy">
        <p className="kv-standin__kicker">Demo reel</p>
        <p className="kv-standin__title">Coming soon</p>
        <p className="kv-standin__line">A short film of one club night: the check-in table, the lobby, the projector and the lesson kiosk.</p>
      </div>
    )}
  </div>
);

export const Reel: React.FC = () => {
  const video = useRef<HTMLVideoElement>(null);
  const [film, setFilm] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('waiting');
  const [muted, setMuted] = useState(true);

  // The film mounts after the first render (the prerendered page has none).
  useEffect(() => { setFilm(FILM); }, []);

  useEffect(() => {
    const v = video.current;
    if (!v || !film) return;
    v.muted = true;
    if (reducedMotion()) return; // the poster and the play button wait for the reader
    v.play()?.catch(() => { /* autoplay refused: the play button is there */ });
  }, [film]);

  const play = (sound: boolean) => {
    const v = video.current;
    if (!v) return;
    v.muted = !sound;
    setMuted(!sound);
    v.play()?.catch(() => setMode('waiting'));
  };
  const toggleSound = () => {
    const v = video.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };
  const togglePause = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) v.play()?.catch(() => undefined); else v.pause();
  };

  const missing = mode === 'missing';
  const showBig = mode === 'waiting' || mode === 'ended';

  return (
    <div className={`kv-reel is-${mode}`}>
      <StandIn missing={missing} />
      {film && !missing && (
        <video
          ref={video}
          className="kv-reel__video"
          src={film}
          poster={POSTER}
          preload="metadata"
          playsInline
          muted
          aria-label="Demo reel: one club night with KVBC Awana"
          onPlay={() => setMode('playing')}
          onPause={(e) => { if (!e.currentTarget.ended) setMode('paused'); }}
          onEnded={(e) => { setMode('ended'); e.currentTarget.load(); /* back to the poster */ }}
          onError={() => setMode('missing')}
        />
      )}
      {!missing && showBig && (
        <button type="button" className="kv-reel__big" onClick={() => play(true)}>
          <span className="kv-reel__bigdisc" aria-hidden="true"><Ico name={mode === 'ended' ? 'replay' : 'play'} /></span>
          <span className="kv-reel__biglabel">{mode === 'ended' ? 'Watch again' : 'Play the reel'}</span>
        </button>
      )}
      {(mode === 'playing' || mode === 'paused') && (
        <div className="kv-reel__bar">
          <button type="button" className="kv-reel__ctl" onClick={togglePause} aria-label={mode === 'paused' ? 'Play' : 'Pause'}>
            <Ico name={mode === 'paused' ? 'play' : 'pause'} />
          </button>
          <button type="button" className={`kv-reel__ctl kv-reel__sound${muted ? ' is-muted' : ''}`} onClick={toggleSound} aria-pressed={!muted}>
            <Ico name={muted ? 'soundOff' : 'soundOn'} />
            <span>{muted ? 'Tap for sound' : 'Sound on'}</span>
          </button>
        </div>
      )}
    </div>
  );
};
