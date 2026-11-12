// Serves the built library and the harness page for a real-browser check.
//
//   npm run build && npm run harness        http://127.0.0.1:8787/
//
// `collect()` needs a secure context. localhost counts as one; a phone on the
// LAN does not, so put an HTTPS tunnel in front of this server to test phones.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

// Only the build output and the harness are reachable.
const ROUTES = [
  ['/dist/', 'dist'],
  ['/', join('test', 'browser')],
];

function resolve(pathname) {
  for (const [prefix, folder] of ROUTES) {
    if (!pathname.startsWith(prefix)) continue;
    const base = join(ROOT, folder);
    const rest = pathname.slice(prefix.length) || 'harness.html';
    const file = normalize(join(base, rest));
    return file.startsWith(base + sep) ? file : null;
  }
  return null;
}

createServer(async (request, response) => {
  let file = null;
  try {
    file = resolve(decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname));
  } catch {
    // A malformed URL falls through to 404.
  }
  try {
    if (file === null || !(extname(file) in TYPES)) throw new Error('not found');
    const body = await readFile(file);
    response.writeHead(200, { 'content-type': TYPES[extname(file)], 'cache-control': 'no-store' });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}).listen(PORT, HOST, () => {
  console.log(`r-detect harness: http://${HOST}:${PORT}/`);
});
