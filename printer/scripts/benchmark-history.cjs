const hs = require('../print-server/history-sync.js');
const cc = require('../print-server/cloud-crypto.js');

async function main() {
  const numNights = 150;

  let requestCount = 0;
  const mockRequest = async (base, path) => {
    requestCount++;
    if (path.startsWith('/v1/history/nights')) {
      const nights = [];
      for(let i=1; i<=numNights; i++) {
        const d = String(i).padStart(2, '0');
        nights.push({ night: `2023-01-${d}`, rows: 1 });
      }
      return { ok: true, status: 200, body: nights };
    }
    if (path.startsWith('/v1/history/rows')) {
      // Simulate multiple pages
      if (!path.includes('after=')) {
        return { ok: true, status: 200, body: { rows: [{ id: '123', night: '2023-01-01', kind: 'checkin', ts: 123 }], next: '123' } };
      } else {
        return { ok: true, status: 200, body: { rows: [{ id: '456', night: '2023-01-01', kind: 'checkin', ts: 124 }], next: null } };
      }
    }
    return { ok: true, status: 200, body: {} };
  };

  const oldOpenRow = cc.openRow;
  cc.openRow = async () => ({ ts: 123, kind: 'checkin' });

  const reader = hs.createAttendanceReader({
    historyRing: async () => ({}),
    signedIn: () => ({ base: 'http://test', session: 'test' }),
    request: mockRequest,
    stationId: () => 'stat',
    merge: () => {},
    now: () => Date.parse('2023-10-14T22:00:00Z')
  });

  const start = Date.now();
  await reader.syncOnce();
  const end = Date.now();

  console.log(`Requests made: ${requestCount}`);
  console.log(`Time taken: ${end - start}ms`);
  cc.openRow = oldOpenRow;
}
main().catch(console.error);
