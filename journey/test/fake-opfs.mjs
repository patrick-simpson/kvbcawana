// A browser's Origin Private File System, just real enough for the page's
// saved lessons (src/schedule/04-lesson-store.js) inside jsdom: directories,
// files whose writable commits only on close() (as Chromium's swap file does),
// navigator.storage.estimate/persist, and a CDN that answers Range requests
// with a streamed body. The real thing is exercised in Chromium by
// test/lesson-downloads-layout.test.mjs.

function notFound(window, name) {
  return new window.DOMException(`${name} not found`, 'NotFoundError');
}

class FakeFile {
  constructor(name) {
    this.kind = 'file';
    this.name = name;
    this.data = new Uint8Array(0);
  }
}

class FakeDir {
  constructor(name) {
    this.kind = 'directory';
    this.name = name;
    this.entries = new Map();
  }
}

/** Installs navigator.storage + FileSystemFileHandle on `window`. Returns
 * helpers to seed and read files: put(path, bytes|string), read(path),
 * exists(path), usage(), writes (every committed path, in order). */
export function installFakeOpfs(window, { quota = 50 * 1024 ** 3, persisted = false } = {}) {
  const root = new FakeDir('');
  const writes = [];
  const state = { persisted };

  class FileSystemFileHandle {
    constructor(node) {
      this.kind = 'file';
      this.name = node.name;
      this._node = node;
    }
    async getFile() {
      return new window.File([this._node.data], this._node.name);
    }
    async createWritable() {
      const node = this._node;
      const parts = [];
      let open = true;
      return {
        write: async (data) => {
          if (!open) throw new window.DOMException('closed', 'InvalidStateError');
          const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data.buffer ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data);
          parts.push(bytes);
        },
        close: async () => {
          open = false;
          const size = parts.reduce((n, p) => n + p.byteLength, 0);
          const out = new Uint8Array(size);
          let at = 0;
          for (const p of parts) {
            out.set(p, at);
            at += p.byteLength;
          }
          node.data = out;
          writes.push(node.name);
        },
        abort: async () => {
          open = false;
        },
      };
    }
  }

  class FileSystemDirectoryHandle {
    constructor(node) {
      this.kind = 'directory';
      this.name = node.name;
      this._node = node;
    }
    async getDirectoryHandle(name, { create = false } = {}) {
      let child = this._node.entries.get(name);
      if (!child) {
        if (!create) throw notFound(window, name);
        child = new FakeDir(name);
        this._node.entries.set(name, child);
      }
      if (child.kind !== 'directory') throw new window.DOMException(name, 'TypeMismatchError');
      return new FileSystemDirectoryHandle(child);
    }
    async getFileHandle(name, { create = false } = {}) {
      let child = this._node.entries.get(name);
      if (!child) {
        if (!create) throw notFound(window, name);
        child = new FakeFile(name); // created empty at once, as a browser does
        this._node.entries.set(name, child);
      }
      if (child.kind !== 'file') throw new window.DOMException(name, 'TypeMismatchError');
      return new FileSystemFileHandle(child);
    }
    async removeEntry(name, { recursive = false } = {}) {
      const child = this._node.entries.get(name);
      if (!child) throw notFound(window, name);
      if (child.kind === 'directory' && child.entries.size && !recursive) {
        throw new window.DOMException(name, 'InvalidModificationError');
      }
      this._node.entries.delete(name);
    }
    async *keys() {
      for (const name of [...this._node.entries.keys()]) yield name;
    }
  }

  window.FileSystemFileHandle = FileSystemFileHandle;
  window.FileSystemDirectoryHandle = FileSystemDirectoryHandle;

  const walk = (path, create) => {
    const parts = path.split('/').filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      let next = node.entries.get(parts[i]);
      if (!next) {
        if (!create) return null;
        next = new FakeDir(parts[i]);
        node.entries.set(parts[i], next);
      }
      node = next;
    }
    return { dir: node, name: parts[parts.length - 1] };
  };
  const usage = () => {
    let n = 0;
    const visit = (node) => {
      for (const child of node.entries.values()) {
        if (child.kind === 'file') n += child.data.byteLength;
        else visit(child);
      }
    };
    visit(root);
    return n;
  };

  Object.defineProperty(window.navigator, 'storage', {
    configurable: true,
    value: {
      getDirectory: async () => new FileSystemDirectoryHandle(root),
      estimate: async () => ({ usage: usage(), quota }),
      persist: async () => {
        state.persisted = true;
        return true;
      },
      persisted: async () => state.persisted,
    },
  });

  return {
    root,
    writes,
    usage,
    put(path, content) {
      const { dir, name } = walk(path, true);
      const file = new FakeFile(name);
      file.data = typeof content === 'string' ? new TextEncoder().encode(content) : Uint8Array.from(content);
      dir.entries.set(name, file);
    },
    read(path) {
      const at = walk(path, false);
      const node = at && at.dir.entries.get(at.name);
      return node && node.kind === 'file' ? node.data : null;
    },
    exists(path) {
      const at = walk(path, false);
      return !!(at && at.dir.entries.get(at.name));
    },
    list(path) {
      const at = walk(`${path}/x`, false);
      return at ? [...at.dir.entries.keys()].sort() : [];
    },
  };
}

/** Deterministic video bytes for a URL: byte i = (i * 7 + seed) & 255. */
export function videoBytes(size, seed = 1) {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) out[i] = (i * 7 + seed) & 255;
  return out;
}

/**
 * Wraps window.fetch so URLs under `base` are answered like CloudFront:
 * Range (bytes=N-) -> 206 + Content-Range, else 200 + Content-Length, ETag,
 * a body streamed in `piece`-byte reads. files: url -> Uint8Array.
 * `behave(url, attempt)` may return { status } to fail a request, or
 * { stallAfter: n } to stop sending after n bytes (the body then hangs until
 * aborted). Returns { requests } (url, range, at).
 */
export function installFakeCdn(window, base, files, { piece = 5, behave = () => null, etag = '"v1"' } = {}) {
  const requests = [];
  const attempts = new Map();
  const inner = window.fetch;
  window.fetch = (url, options = {}) => {
    const href = String(url);
    if (!href.startsWith(base)) return inner(url, options);
    const headers = options.headers || {};
    const range = headers.Range || headers.range || null;
    requests.push({ url: href, range, cache: options.cache || null });
    const n = (attempts.get(href) || 0) + 1;
    attempts.set(href, n);
    const data = files[href];
    const plan = behave(href, n) || {};
    const signal = options.signal;
    if (signal && signal.aborted) return Promise.reject(new window.DOMException('aborted', 'AbortError'));
    if (!data || plan.status) {
      const status = plan.status || 404;
      return Promise.resolve({ ok: false, status, headers: { get: () => null }, body: { cancel: async () => {} } });
    }
    let start = 0;
    let status = 200;
    const m = /bytes=(\d+)-/.exec(range || '');
    if (m) {
      start = Number(m[1]);
      status = 206;
    }
    const slice = data.subarray(start);
    const head = {
      'content-length': String(slice.byteLength),
      'content-range': status === 206 ? `bytes ${start}-${data.byteLength - 1}/${data.byteLength}` : null,
      etag: typeof etag === 'function' ? etag(href, n) : etag,
    };
    let sent = 0;
    let rejectHang = null;
    let streamController = null;
    const body = new ReadableStream({
      start(controller) {
        streamController = controller;
      },
      pull(controller) {
        if (plan.stallAfter !== undefined && sent >= plan.stallAfter) {
          return new Promise((_, reject) => {
            rejectHang = reject;
          });
        }
        if (sent >= slice.byteLength) {
          controller.close();
          return undefined;
        }
        const size = Math.min(piece, slice.byteLength - sent);
        controller.enqueue(slice.slice(sent, sent + size));
        sent += size;
        return undefined;
      },
    });
    if (signal) {
      signal.addEventListener('abort', () => {
        const err = new window.DOMException('aborted', 'AbortError');
        try { streamController.error(err); } catch { /* already closed */ }
        if (rejectHang) rejectHang(err);
      });
    }
    return Promise.resolve({
      ok: true,
      status,
      headers: { get: (name) => head[name.toLowerCase()] ?? null },
      body,
    });
  };
  return { requests };
}
