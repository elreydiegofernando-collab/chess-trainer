// Serves site/ on this computer: `npm start`, then open http://localhost:8080/
// No dependencies. Set PORT to change the port, HOST=0.0.0.0 to test from a
// phone on the same network.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../site/', import.meta.url)));
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent((req.url || '/').split(/[?#]/)[0]);
    if (path.endsWith('/')) path += 'index.html';
    const file = resolve(ROOT, '.' + path);
    if (!file.startsWith(ROOT + sep)) {
      res.writeHead(403).end();
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}).listen(PORT, HOST, () => {
  console.log(`Chess Trainer is running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/ (Ctrl+C to stop)`);
});
