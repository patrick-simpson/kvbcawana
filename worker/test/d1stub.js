// A stand-in for Cloudflare D1 built on Node's own SQLite (node:sqlite, Node
// 22), so the tests run the REAL migrations and the real SQL. It has D1's
// shape: prepare().bind().run() / all() / first(), and batch(), which is
// atomic (one transaction, rolled back whole on any error). `down` makes every
// call fail like an outage; `dump()` returns every stored byte so a test can
// assert on what actually reached the database.
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS = new URL('../migrations/', import.meta.url);

export function d1Stub() {
  const sql = new DatabaseSync(':memory:');
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) {
    sql.exec(readFileSync(new URL(f, MIGRATIONS), 'utf8'));
  }
  const stub = {
    down: false,
    batches: 0,
    check() { if (stub.down) throw new Error('D1 is down'); },
    prepare(text) {
      const st = { text, args: [] };
      st.bind = (...args) => { st.args = args; return st; };
      st.run = async () => { stub.check(); return exec(st); };
      st.all = async () => { stub.check(); return { results: sql.prepare(text).all(...st.args), success: true }; };
      st.first = async () => { stub.check(); return sql.prepare(text).get(...st.args) ?? null; };
      return st;
    },
    async batch(stmts) {
      stub.check();
      stub.batches += 1;
      sql.exec('BEGIN');
      try {
        const out = stmts.map(exec);
        sql.exec('COMMIT');
        return out;
      } catch (err) {
        sql.exec('ROLLBACK');
        throw err;
      }
    },
    /** Every value in every table, as one string (for "no plaintext reached D1"). */
    dump() {
      const tables = sql.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
      return tables.map((t) => JSON.stringify(sql.prepare(`SELECT * FROM ${t}`).all())).join('\n');
    },
    query(text, ...args) { return sql.prepare(text).all(...args); },
  };
  function exec(st) {
    const r = sql.prepare(st.text).run(...st.args);
    return { results: [], success: true, meta: { changes: Number(r.changes) } };
  }
  return stub;
}
