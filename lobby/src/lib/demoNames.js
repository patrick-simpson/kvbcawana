// @ts-check
// Names used by every simulated / demo event.
//
// Obviously-fake names only: a simulated banner on the lobby TV must never look
// like (or match) a real kid checking in. A volunteer glancing at the screen
// during a training session has to be able to tell instantly that nobody
// actually arrived.
//
// This list deliberately does NOT come from
// `src/lib/__fixtures__/contract-vectors.json`. Those vectors carry realistic
// first names (Alice, Marcos, Nora) because their job is to prove the
// sanitizers handle real-looking traffic — exactly the wrong thing to put on a
// screen in front of families.
//
// It lives in its own module because it had drifted into two copies
// (DebugPanel and SettingsPanel), and two lists of "safe" fake names is one
// list too many.

/** @type {ReadonlyArray<string>} */
export const SAMPLE_NAMES = ['Test Kid', 'Demo Kid', 'Sample Star', 'Pretend Pal', 'Practice Run'];

/**
 * Enough obviously made-up first names to fill a demo pickup board (Settings
 * → Pickup board), no two alike, so the columns read like a real night
 * without ever looking like real children.
 * @type {ReadonlyArray<string>}
 */
export const SAMPLE_BOARD_NAMES = [
  'Sample Sam', 'Demo Dana', 'Test Tess', 'Pretend Pat', 'Practice Pia', 'Example Eli',
  'Sample Sky', 'Demo Drew', 'Test Toby', 'Pretend Pip', 'Practice Max', 'Example Ava',
  'Sample Lou', 'Demo Kit', 'Test Jo', 'Pretend Bo', 'Practice Cy', 'Example Mo',
];

/**
 * Pick a random member of a list.
 * @template T
 * @param {ReadonlyArray<T>} list
 * @returns {T}
 */
export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}
