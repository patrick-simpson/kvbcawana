// @ts-check
// One rule for which network a request counts against (sign-in guesses in sync.js,
// Cast's wrong codes in cast.js).

/**
 * The network a guess is counted against: an IPv4 address as it is, an IPv6 address's
 * /64 (one home or phone is handed a whole /64, so per address would be no limit).
 * @param {string} ip
 */
export function netOf(ip) {
  const s = String(ip || '').trim().toLowerCase();
  if (!s.includes(':')) return s;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) return mapped[1];
  const [head, tail = ''] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = s.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return `${groups.slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16)).join(':')}::/64`;
}
