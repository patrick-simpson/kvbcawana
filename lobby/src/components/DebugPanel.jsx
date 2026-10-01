import { useRef } from 'react';
import { getAllClubs } from '../lib/clubs.js';
import { SAMPLE_NAMES, pick } from '../lib/demoNames.js';
import awanaClubsMark from '../../shared/brand/logos/awana-clubs-white.svg';

export default function DebugPanel({
  onSimulate, onSimulateRecap, onSimulateOps, onSimulateTonight, onSimulateNotice, onClearNotice,
  onSimulateTally, onSimulateCheckout, onSimulateBirthdays, onClose,
  status, lastEventAt, pending, phase, seenStats, opsFailures, wakeLockStatus,
}) {
  const standard = () => onSimulate({
    firstName: pick(SAMPLE_NAMES),
    club: pick(getAllClubs()),
  });

  const birthday = () => onSimulate({
    firstName: pick(SAMPLE_NAMES),
    club: pick(getAllClubs()),
    isBirthday: true,
  });

  const firstTimer = () => onSimulate({
    firstName: pick(SAMPLE_NAMES),
    club: pick(getAllClubs()),
    isFirstTimer: true,
  });

  const fiveAtOnce = () => {
    for (let i = 0; i < 5; i++) {
      onSimulate({ firstName: pick(SAMPLE_NAMES), club: pick(getAllClubs()) });
    }
  };

  // Simulates the after-dinner carpool wave: 20 kids scanning in seconds.
  // The wave stays up and each name flips in for its full hold.
  const bigRush = () => {
    for (let i = 0; i < 20; i++) {
      onSimulate({ firstName: pick(SAMPLE_NAMES), club: pick(getAllClubs()) });
    }
  };

  const everyClub = () => {
    for (const club of getAllClubs()) {
      onSimulate({ firstName: pick(SAMPLE_NAMES), club });
    }
  };

  // A recap the way the printer would send it: fresh ids, recent
  // timestamps — proves the quiet "also joined us" replay path.
  const recap = () => onSimulateRecap?.({
    entries: Array.from({ length: 3 }, (_, i) => ({
      id: `debug-recap-${Date.now()}-${i}`,
      at: Date.now() - (i + 1) * 60 * 1000,
      firstName: pick(SAMPLE_NAMES),
      club: pick(getAllClubs()),
      isBirthday: false,
      isFirstTimer: false,
    })),
    at: Date.now(),
  });

  // Who's-still-here board. Two buttons on purpose: the interesting behaviour is
  // the SHORT list, where the board must stop naming individuals — that is the
  // safeguard, and it should be easy for an operator to see it working rather
  // than take it on trust.
  const checkoutBoard = (n) => () => {
    const clubs = getAllClubs();
    onSimulateCheckout?.({
      entries: Array.from({ length: n }, (_, i) => ({
        firstName: SAMPLE_NAMES[i % SAMPLE_NAMES.length],
        club: clubs[i % clubs.length],
      })),
      printed: 43,
      at: new Date().toISOString(),
    });
  };
  const checkoutEmpty = () => onSimulateCheckout?.({
    entries: [], printed: 43, at: new Date().toISOString(),
  });

  const printFailure = () => onSimulateOps?.({
    type: 'print-failure',
    club: pick(getAllClubs()),
    at: Date.now(),
  });

  // The tonight ticker and announcement banner are driven by the check-in
  // system's own reports, so before club there is nothing on the wire to look
  // at. These let an operator confirm both render correctly on the actual TV.
  //
  // The count RAMPS on each press (63 → 103 → 143 …) for two reasons: the first
  // payload is only a baseline by design, so a fixed number could never
  // demonstrate a night milestone; and walking it upward is the only way to
  // watch the 100-kid celebration actually fire before club night.
  //
  // Books and awards ramp for the same reason (#358): they drive their own
  // milestone toasts off the same baseline-then-crossing rule, and a fixed
  // `booksCompleted: 4` could never demonstrate one. Each press adds 4 books
  // and 8 awards, so the second press crosses the default 5-book threshold
  // and the room can be checked before club night.
  const tonightCount = useRef(23);
  const tonightBooks = useRef(0);
  const tonightAwards = useRef(3);
  const tonight = () => {
    tonightCount.current += 40;
    tonightBooks.current += 4;
    tonightAwards.current += 8;
    onSimulateTonight?.({
      checkedIn: tonightCount.current,
      booksCompleted: tonightBooks.current,
      awardsEarned: tonightAwards.current,
      friendsBrought: 2,
      at: Date.now(),
    });
  };

  const noticeCritical = () => onSimulateNotice?.({
    level: 'critical', message: 'CLUB CANCELLED TONIGHT — icy roads. See you next week!', at: Date.now(),
  });

  const noticeInfo = () => onSimulateNotice?.({
    level: 'info', message: 'Bring your Bible next week for double shares!', at: Date.now(),
  });

  // A tally is what drives the per-club milestone path and the corner counter.
  // Numbers only — this event structurally cannot carry a name.
  //
  // Every press after the first RAMPS each club by 10, for the same reason the
  // tonight button ramps: a club milestone fires on a CROSSING, and the first
  // tally of the night is only a baseline (App.jsx handleTally), so repeating
  // one fixed set of counts could never demonstrate a club celebration. The
  // first press deliberately still sends 9 / 16 / 23 / 30 (total 78).
  const tallyBumps = useRef(0);
  const tally = () => {
    const clubs = getAllClubs().slice(0, 4);
    const counts = {};
    let total = 0;
    clubs.forEach((club, i) => {
      const n = 9 + i * 7 + tallyBumps.current * 10;
      counts[club] = n;
      total += n;
    });
    tallyBumps.current += 1;
    onSimulateTally?.({ counts, total, at: Date.now() });
  };

  // The weekly `birthdays` ROSTER broadcast. The projector page has always
  // consumed it; the signage page does too now, for the "Birthday this
  // Friday!" ribbon (src/lib/birthdayWeek.js). The ribbon needs the roster
  // entry and the arriving check-in to name the SAME child and club, so these
  // three buttons use one fixed pair rather than the random picks above —
  // otherwise the path could never be driven end to end from here.
  const RIBBON_KID = SAMPLE_NAMES[0];
  const RIBBON_CLUB = 'Sparks';
  const birthdayWeekRoster = () => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    onSimulateBirthdays?.({
      entries: [{
        firstName: RIBBON_KID, club: RIBBON_CLUB, month: d.getMonth() + 1, day: d.getDate(),
      }],
      at: new Date().toISOString(),
    });
  };
  const birthdayWeekWelcome = () => onSimulate({ firstName: RIBBON_KID, club: RIBBON_CLUB });
  const birthdayWeekCake = () => onSimulate({
    firstName: RIBBON_KID, club: RIBBON_CLUB, isBirthday: true,
  });

  const seen = seenStats?.() ?? { size: 0 };

  return (
    <div className="debug">
      {/* The operator panels' header band: the mark, the title and the live
          readouts as keyline chips. The simulators scroll under it; Close
          stays pinned at the foot, so a 720p screen can always get out. */}
      <div className="debug-header">
        <img className="panel-mark" src={awanaClubsMark} alt="" draggable="false" />
        <h3>Debug · Simulate check-ins</h3>
        <div className="debug-stats">
          <span>pusher: {status ?? 'unknown'}</span>
          <span>
            last event: {lastEventAt
              ? new Date(lastEventAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
              : 'none'}
          </span>
          <span>queued: {pending ?? 0}</span>
          <span>phase: {phase ?? 'unknown'}</span>
          <span>seen ids: {seen.size}</span>
          <span>printer problems: {opsFailures?.length ?? 0}</span>
          <span>wake lock: {wakeLockStatus ?? 'unknown'}</span>
        </div>
      </div>
      <div className="debug-actions">
      <button onClick={standard}>Standard welcome</button>
      <button onClick={birthday}>Birthday welcome</button>
      <button onClick={firstTimer}>First-timer welcome</button>
      <button onClick={fiveAtOnce}>Trigger 5 simultaneous</button>
      <button onClick={bigRush}>Trigger 20-kid rush (scoreboard flip)</button>
      <button onClick={everyClub}>Trigger every club</button>
      {onSimulateRecap && <button onClick={recap}>Simulate recap replay (quiet banners)</button>}
      {onSimulateOps && <button onClick={printFailure}>Simulate print failure (ops)</button>}
      {onSimulateTally && <button onClick={tally}>Simulate club tally (counts)</button>}
      {onSimulateBirthdays && (
        <>
          <button onClick={birthdayWeekRoster}>Seed birthday-week roster (Test Kid · Sparks)</button>
          <button onClick={birthdayWeekWelcome}>Welcome the birthday-week kid (ribbon)</button>
          <button onClick={birthdayWeekCake}>Birthday banner for that kid (ribbon)</button>
        </>
      )}
      {onSimulateCheckout && (
        <>
          <button onClick={checkoutBoard(9)}>Still-here board: 9 children (names)</button>
          <button onClick={checkoutBoard(2)}>Still-here board: 2 children (names hidden)</button>
          <button onClick={checkoutEmpty}>Still-here board: everyone picked up</button>
        </>
      )}
      {onSimulateTonight && <button onClick={tonight}>Show tonight ticker (+40 kids, +4 books each press)</button>}
      {onSimulateNotice && <button onClick={noticeCritical}>Show cancellation alert</button>}
      {onSimulateNotice && <button onClick={noticeInfo}>Show info notice</button>}
      {/* The simulated cancellation bar holds for four hours like a real one
          would — without this there was no way to take it off a public
          screen short of a reload. */}
      {onClearNotice && <button onClick={onClearNotice}>Clear notice banner</button>}
      </div>
      <div className="debug-footer">
        <span className="close-hint">Toggle with <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd></span>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
