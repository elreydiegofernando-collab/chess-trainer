// Offline cache for Chess Trainer.
//
// Everything the app needs (including the ~7 MB engine) is cached on install,
// then served from the cache, so the app opens and plays with no connection.
// The deploy workflow replaces 'dev' below with the commit, so every deploy
// installs a fresh cache; the new version shows up the next time the app opens.
const VERSION = 'dev';
const CACHE = 'chess-trainer-' + VERSION;

// Paths are relative to this file. `npm run check` keeps the list in step with site/.
const FILES = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'js/app.js',
  'js/curriculum.js',
  'js/engine.js',
  'js/learn.js',
  'js/openings.js',
  'js/puzzles.js',
  'js/srs.js',
  'js/store.js',
  'vendor/chess.js',
  'vendor/stockfish/stockfish-18-lite-single.js',
  'vendor/stockfish/stockfish-18-lite-single.wasm',
  'vendor/fonts/noto-sans-symbols-2-chess.woff2',
  'icons/apple-touch-icon-180.png',
  'icons/favicon-32.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // no-cache: revalidate with the server so a new deploy never caches stale files.
      .then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'no-cache' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      // Other apps on this github.io origin keep their own caches; only touch ours.
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('chess-trainer-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const shell = await cache.match('./');
        if (shell) return shell;
      }
      return fetch(req);
    })
  );
});
