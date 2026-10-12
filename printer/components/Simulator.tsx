import React, { useCallback, useRef, useState } from 'react';
import { ClubberList } from './ClubberList';
import { CheckinModal } from './CheckinModal';
import { mockClubbers } from '../data';
import { Clubber } from '../types';
import { Ico } from './home/Icons';
import { Doodle, Shape, clubByName } from './home/Kit';
import { Moment, PrinterArt, Tv } from './home/Screens';

/**
 * A working replica of the TwoTimTwo check-in page. It renders the exact DOM
 * the browser extension watches (#lastCheckin and .clubber rows with .name and
 * .club img, plus #checkin-modal / button#checkin — see src/constants.ts
 * DOM_SELECTORS and chrome-extension/content.js). The extension's content
 * script only runs on *.twotimtwo.com (manifest.json content_scripts), so no
 * label prints from this page: beside the replica, a lobby TV and a printer
 * act out what a real check-in sets off. Restyle freely around it; never
 * change that DOM.
 *
 * The replica keeps TwoTimTwo's own light colours, because it is a picture of
 * somebody else's website.
 */
const first = (name: string) => name.trim().split(/\s+/)[0];

export const Simulator: React.FC = () => {
  const [selectedClubber, setSelectedClubber] = useState<Clubber | null>(null);
  const [lastCheckin, setLastCheckin] = useState<Clubber | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [runs, setRuns] = useState(0);
  const outRef = useRef<HTMLDivElement>(null);

  const visibleClubbers = [...mockClubbers]
    .filter(c => c.name.toLowerCase().includes(filter.toLowerCase().trim()))
    .sort((a, b) => a.name.localeCompare(b.name));

  const handleCheckin = (clubber: Clubber) => {
    setSelectedClubber(null);
    setIsLoading(true);
    // Simulate network delay
    setTimeout(() => {
      setIsLoading(false);
      setLastCheckin(clubber);
      setRuns((r) => r + 1);
      // On a narrow screen the TV and the printer are below the list: bring them up.
      const out = outRef.current;
      if (out && out.getBoundingClientRect().top > window.innerHeight * 0.6) {
        const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        out.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
      }
    }, 600);
  };

  const closeModal = useCallback(() => setSelectedClubber(null), []);

  const handleUndo = (e: React.MouseEvent) => {
    e.preventDefault();
    if (confirm('Are you sure you want to undo this checkin?')) {
      setLastCheckin(null);
    }
  };

  const shown = lastCheckin && !isLoading ? lastCheckin : null;
  const club = shown ? clubByName(shown.club) : null;

  return (
    <section id="simulator" className="kv-sim" aria-labelledby="sim-title">
      <Shape name="wave-sparks" stretch className="kv-sim__edge" />
      <Doodle name="sparkle-4pt" className="kv-sim__d1" />
      <Doodle name="loop" className="kv-sim__d2" />
      <Doodle name="ring" className="kv-sim__d3" />
      <div className="kv-wrap">
        <div className="kv-head kv-head--inverse">
          <p className="kv-tabkicker kv-tabkicker--light">Try it</p>
          <h2 className="kv-h2" id="sim-title">Check a child in</h2>
          <p className="kv-lede">
            Pick a name on this copy of a TwoTimTwo check-in page and press <b>Checkin</b>. On club night a check-in on
            TwoTimTwo prints the label with the KVBC Awana app and greets the child in the lobby.
          </p>
        </div>

        <div className="kv-sim__grid">
          <div className="tt-site">
            <div className="tt-site__chrome" aria-hidden="true">
              <span /><span /><span />
              <code>yourchurch.twotimtwo.com/clubber/checkin</code>
            </div>
            <div className="tt-site__page">
              <div className="tt-filters">
                <label htmlFor="sim-meeting">Meeting:</label>
                <select id="sim-meeting"><option>2026-10-14</option></select>
                <label htmlFor="sim-filter">Only show names that match:</label>
                <input id="sim-filter" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search…" />
              </div>

              <div aria-live="polite">
                {isLoading && <div className="tt-loading">Checking in...</div>}
              </div>

              {/* The DOM the extension watches — keep this structure intact */}
              <div id="lastCheckin" className={shown ? 'tt-last' : ''} style={!shown ? { display: 'none' } : {}}>
                <span className="tt-last__label">Last checked in:</span>
                <div className="tt-last__who">
                  {lastCheckin?.name}
                  <a href="#" onClick={handleUndo} className="tt-last__undo">undo</a>
                </div>
              </div>

              <div className="clubbers">
                <ClubberList clubbers={visibleClubbers} onSelect={setSelectedClubber} />
              </div>
            </div>
          </div>

          <div className="kv-sim__out" aria-live="polite" ref={outRef}>
            <p className="kv-sim__status">
              {shown && club
                ? <><Ico name="sparkle" /><span><b>{first(shown.name)}</b> is checked in: the label prints and the lobby says welcome.</span></>
                : <><Ico name="arrowDown" className="kv-sim__point" /><span>Nothing prints from this page. Pick a name to see what would happen.</span></>}
            </p>
            <Tv className="kv-sim__tv" label={shown && club
              ? `The lobby TV, acted out: ${club.name}'s wave rises and carries the name ${first(shown.name)} under the word Welcome.`
              : 'The lobby TV, acted out: its welcome slide, waiting for a check-in.'}>
              <div className={`kv-scene${shown ? ' is-dim' : ''}`}>
                <span className="kv-scene__blob kv-scene__blob--a" />
                <span className="kv-scene__blob kv-scene__blob--b" />
                <span className="kv-scene__kicker">Tonight</span>
                <span className="kv-scene__title">Welcome to Awana!</span>
              </div>
              {shown && club && <Moment name={first(shown.name)} club={club} run={runs} />}
            </Tv>
            <PrinterArt
              idle={!shown || !club}
              wait="The label prints here"
              run={runs}
              spec={{ first: shown ? first(shown.name) : '', club: club || clubByName('Sparks') }}
              label={shown && club
                ? `The label printer, acted out: a name label for ${first(shown.name)}, ${club.name}, comes out of the top.`
                : 'The label printer, acted out: waiting for a check-in.'} />
          </div>
        </div>
        <p className="kv-sim__note">A copy of a TwoTimTwo check-in page. Names are examples.</p>
      </div>

      <CheckinModal clubber={selectedClubber} onClose={closeModal} onConfirm={handleCheckin} />
    </section>
  );
};
