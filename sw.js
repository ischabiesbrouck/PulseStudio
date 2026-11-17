// Service worker: de app werkt ook offline. Netwerk eerst, met de cache als terugval.
const VERSION = 'pulsestudio-v2';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css', './icons/icon.svg',
  './js/app.js', './js/model.js', './js/state.js', './js/store.js', './js/wav.js',
  './js/audio/engine.js', './js/audio/chain.js', './js/audio/instruments.js', './js/audio/recorder.js',
  './js/audio/plugins.js', './js/audio/plugin-defs.js', './js/audio/library.js',
  './js/ui/dom.js', './js/ui/arrange.js', './js/ui/editor.js', './js/ui/mixer.js', './js/ui/inspector.js', './js/ui/library.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch {
      return (await cache.match(req, { ignoreSearch: true }))
        || (req.mode === 'navigate' ? await cache.match('./index.html') : null)
        || new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
