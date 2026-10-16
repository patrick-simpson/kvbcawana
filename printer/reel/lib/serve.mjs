// A tiny static server for the reel: the built site (site/dist, the same files
// awana.kvbchurch.org serves, with Pages' pretty addresses), the film page
// (printer/reel/film) under /film/, the work folder (recorded footage,
// rendered labels) under /work/ and the family's shared folder (shared:
// the brand kit, chipGeometry.js) under /shared/. A JSON file asked for by a
// module script is answered as a module (`export default ...`), so the shared
// modules' bare JSON imports load in the browser as they do in the bundler.
// Loopback only, any free port.
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.txt': 'text/plain',
  '.md': 'text/markdown', '.wasm': 'application/wasm', '.vtt': 'text/vtt',
};

/** Resolve a request path inside `root` the way Cloudflare Pages does. */
function resolveIn(root, rel) {
  const clean = path.normalize(decodeURIComponent(rel)).replace(/^(\.\.[/\\])+/, '');
  let file = path.join(root, clean);
  if (!file.startsWith(root)) return null;
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!existsSync(file) && !path.extname(file) && existsSync(`${file}.html`)) file = `${file}.html`;
  return existsSync(file) && statSync(file).isFile() ? file : null;
}

/**
 * @param {{ site: string, film: string, work: string, shared?: string }} roots
 * @returns {Promise<{ origin: string, close: () => Promise<void> }>}
 */
export function serve(roots) {
  const server = createServer((req, res) => {
    res.sendDate = false; // no Date header: the pages' clock checks must not see the real date
    const url = new URL(req.url, 'http://x');
    let file = null;
    if (url.pathname.startsWith('/film/')) file = resolveIn(roots.film, url.pathname.slice(6));
    else if (url.pathname.startsWith('/work/')) file = resolveIn(roots.work, url.pathname.slice(6));
    else if (roots.shared && url.pathname.startsWith('/shared/')) file = resolveIn(roots.shared, url.pathname.slice(8));
    else file = resolveIn(roots.site, url.pathname.slice(1));
    if (!file) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    if (file.endsWith('.json') && req.headers['sec-fetch-dest'] === 'script') {
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-cache' });
      res.end(`export default ${readFileSync(file, 'utf8')};`);
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        origin: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
