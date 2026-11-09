// The entry point (src/index.js): what it lets through to the Durable Object. The
// other suites call SyncCore directly and so never saw the edge's body cap.
import { describe, expect, it } from 'vitest';
import worker, { BODY_CAPS, bodyCapFor, readCapped } from '../src/index.js';
import { BODY_MAX } from '../src/sync.js';
import { CLASSROOM_CLIP_PART_BYTES, CLASSROOM_FILE_MAX_BYTES } from '../../shared/classroomRemote.js';
import { IMPORT_BODY_MAX, ROWS_BODY_MAX } from '../src/history.js';

/** A stand-in Durable Object namespace that records what reached it. */
function rig() {
  const seen = [];
  const env = {
    SYNC: {
      idFromName: () => 'main',
      get: () => ({
        fetch: async (req) => {
          const buf = req.method === 'GET' ? null : new Uint8Array(await req.arrayBuffer());
          seen.push({ method: req.method, path: new URL(req.url).pathname, bytes: buf ? buf.length : 0, ip: req.headers.get('x-client-ip') });
          return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
        },
      }),
    },
  };
  return { env, seen };
}

const call = (env, method, path, body, headers = {}) => worker.fetch(new Request(`https://sync.example${path}`, { method, body, headers, ...(body instanceof ReadableStream ? { duplex: 'half' } : {}) }), env);

/** A body with no Content-Length (chunked), `n` bytes in 64 KiB pieces. */
function chunked(n) {
  let left = n;
  return new ReadableStream({
    pull(c) {
      if (left <= 0) { c.close(); return; }
      const k = Math.min(left, 64 * 1024);
      left -= k;
      c.enqueue(new Uint8Array(k));
    },
  });
}

describe('the edge body caps', () => {
  it('gives each big route its own cap and every other route BODY_MAX', () => {
    expect(bodyCapFor('PUT', '/v1/cast/files/fabc/3')).toBe(CLASSROOM_CLIP_PART_BYTES);
    expect(bodyCapFor('PUT', '/v1/classroom/files/fabc/0')).toBe(CLASSROOM_CLIP_PART_BYTES);
    expect(bodyCapFor('PUT', '/v1/cast/convert/cabc/result')).toBe(CLASSROOM_FILE_MAX_BYTES);
    expect(bodyCapFor('POST', '/v1/history/rows')).toBe(ROWS_BODY_MAX);
    expect(bodyCapFor('POST', '/v1/history/import')).toBe(IMPORT_BODY_MAX);
    expect(bodyCapFor('PUT', '/v1/cast/convert/cabc/2')).toBe(BODY_MAX);
    expect(bodyCapFor('POST', '/v1/login')).toBe(BODY_MAX);
    expect(bodyCapFor('POST', '/v1/cast/files/fabc/3')).toBe(BODY_MAX);
    expect(BODY_CAPS.length).toBe(4);
  });

  it('lets a video clip part (960 KiB) through to the object', async () => {
    const { env, seen } = rig();
    const res = await call(env, 'PUT', '/v1/cast/files/fabc/0', new Uint8Array(CLASSROOM_CLIP_PART_BYTES), { 'CF-Connecting-IP': '1.2.3.4' });
    expect(res.status).toBe(200);
    expect(seen).toEqual([{ method: 'PUT', path: '/v1/cast/files/fabc/0', bytes: CLASSROOM_CLIP_PART_BYTES, ip: '1.2.3.4' }]);
  });

  it('lets the converted PowerPoint (a whole PDF, up to 20 MB) through', async () => {
    const { env, seen } = rig();
    const res = await call(env, 'PUT', '/v1/cast/convert/cabc/result', new Uint8Array(CLASSROOM_FILE_MAX_BYTES));
    expect(res.status).toBe(200);
    expect(seen[0].bytes).toBe(CLASSROOM_FILE_MAX_BYTES);
  });

  it('lets a history import (1 MiB) through but not more', async () => {
    const { env, seen } = rig();
    expect((await call(env, 'POST', '/v1/history/import', new Uint8Array(IMPORT_BODY_MAX))).status).toBe(200);
    expect((await call(env, 'POST', '/v1/history/import', new Uint8Array(IMPORT_BODY_MAX + 1))).status).toBe(413);
    expect((await call(env, 'POST', '/v1/history/rows', new Uint8Array(ROWS_BODY_MAX))).status).toBe(200);
    expect(seen.length).toBe(2);
  });

  it('refuses a body over its route cap by Content-Length, before the object sees it', async () => {
    const { env, seen } = rig();
    const res = await call(env, 'POST', '/v1/login', new Uint8Array(BODY_MAX + 1));
    expect(res.status).toBe(413);
    expect((await res.json()).reason).toBe('too-big');
    expect((await call(env, 'PUT', '/v1/cast/files/fabc/0', new Uint8Array(CLASSROOM_CLIP_PART_BYTES + 1))).status).toBe(413);
    expect(seen).toEqual([]);
  });

  it('stops reading a chunked body (no Content-Length) the moment it passes the cap', async () => {
    const { env, seen } = rig();
    const res = await call(env, 'POST', '/v1/login', chunked(BODY_MAX + 10));
    expect(res.status).toBe(413);
    expect(seen).toEqual([]);
    const ok = await call(env, 'POST', '/v1/login', chunked(1000));
    expect(ok.status).toBe(200);
    expect(seen[0].bytes).toBe(1000);
  });

  it('readCapped gives up past the cap and keeps every byte under it', async () => {
    expect(await readCapped(new Request('https://x', { method: 'POST', body: chunked(300 * 1024), duplex: 'half' }), 256 * 1024)).toBeNull();
    const got = await readCapped(new Request('https://x', { method: 'POST', body: chunked(200 * 1024), duplex: 'half' }), 256 * 1024);
    expect(got?.length).toBe(200 * 1024);
  });
});
